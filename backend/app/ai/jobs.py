# -*- coding: utf-8 -*-
"""后台任务（docs/plan/09 §2.3）：内存表 + <project>/.studio/ai-jobs/<id>.json 落盘。

create / get / update / list 同步可测；run() 用 asyncio.create_task 执行协程，异常 → status=error；
watch() 是 SSE 订阅（每次 update 唤醒，终态后结束）；cancel() 取消任务 → interrupted。
进行中任务在重启后被读到时标 interrupted。

W5（docs/plan/21 §6.2）：
- Job 增 steps（StepEvent 摘要，不含 gen_delta 全文）与 queue_key；kind 增 `agent:<scenario>`。
- create(kind, pid, queue_key=...)：同 queue_key 的任务 FIFO 串行（heavy 场景 `{pid}:heavy`）；None 不排队。
- add_step(job_id, kind, data) 追加步骤并推给 watch_steps() 订阅者；gen_delta 只推不存。
- cancel() 对排队中任务同样有效（出队 → interrupted）；运行中任务 CancelledError 传到每一步与 AI 流。

阶段3 Z14/Z27：
- Job 增 payload（续跑入参：agent:* 记 {scenario, params}；review 记 {scope}）与 proposal_ids
  （产出提案检查点——提案在 propose 时即落盘，中断后已产出部分不丢、不重跑）。
- resume(job_id)：interrupted / error → queued 重排，steps / proposal_ids 保留；路由层按 payload
  重建协程再 run()。任务详情 / 事件经 proposal_ids 追到提案（audit trail）。
"""

import asyncio
import glob
import json
import logging
import os
import secrets
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import asdict, dataclass, field, replace
from typing import Literal

from app import atomic
from app.ai.client import AiError
from app.errors import error_detail

log = logging.getLogger(__name__)

JobKind = Literal["review", "convert", "oa_answer", "rewrite"]  # 另有 f"agent:{scenario}"（agent.types.job_kind）
JobStatus = Literal["queued", "running", "done", "error", "interrupted"]
JOBS_DIR = os.path.join(".studio", "ai-jobs")
FINAL: frozenset[str] = frozenset({"done", "error", "interrupted"})
TRANSIENT_STEPS: frozenset[str] = frozenset({"gen_delta"})  # 只推流不落盘


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    pid: str
    status: str
    progress: float
    message: str
    result: dict | None
    error: dict | None
    created_at: float
    updated_at: float
    steps: list[dict] = field(default_factory=list)
    queue_key: str | None = None
    payload: dict | None = None  # 续跑入参（无 ⇒ 重启后只能整任务重做）
    proposal_ids: list[str] = field(default_factory=list)  # 已落盘提案（产出检查点 / 诊断链）

    def to_dict(self) -> dict:
        return asdict(self)


def _job_path(projects_dir: str, pid: str, job_id: str) -> str:
    return os.path.join(projects_dir, pid, JOBS_DIR, job_id + ".json")


class JobStore:
    def __init__(self, projects_dir: str):
        self.projects_dir = projects_dir
        self._jobs: dict[str, Job] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._subs: dict[str, list[asyncio.Queue]] = {}
        self._step_subs: dict[str, list[asyncio.Queue]] = {}
        self._queues: dict[str, deque[str]] = {}
        self._turn: dict[str, asyncio.Event] = {}
        self._seq: dict[str, int] = {}  # 下一个 StepEvent.seq（含不落盘的 gen_delta）

    def create(self, kind: str, pid: str, queue_key: str | None = None, payload: dict | None = None) -> Job:
        now = time.time()
        job = Job(
            "job_" + secrets.token_hex(6),
            kind,
            pid,
            "queued",
            0.0,
            "排队中",
            None,
            None,
            now,
            now,
            queue_key=queue_key,
            payload=payload,
        )
        self._jobs[job.id] = job
        self._persist(job)
        return job

    def get(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            for p in glob.glob(os.path.join(self.projects_dir, "*", JOBS_DIR, glob.escape(job_id) + ".json")):
                job = self._load(p)
                break
        return job

    def update(self, job: Job, **fields) -> Job:
        job = replace(job, **fields, updated_at=time.time())
        self._jobs[job.id] = job
        self._persist(job)
        for q in self._subs.get(job.id, ()):
            q.put_nowait(job)
        if job.status in FINAL:
            for q in self._step_subs.get(job.id, ()):
                q.put_nowait(None)
        return job

    def add_step(self, job_id: str, kind: str, data: dict | None = None) -> dict | None:
        """追加 StepEvent{seq kind ts data}；gen_delta 只推给 watch_steps 不写入 job.steps。终态 / 不存在则忽略。"""
        job = self._jobs.get(job_id)
        if job is None or job.status in FINAL:
            return None
        seq = self._seq.get(job_id, (job.steps[-1]["seq"] + 1) if job.steps else 0)
        self._seq[job_id] = seq + 1
        ev = {"seq": seq, "kind": kind, "ts": time.time(), "data": dict(data or {})}
        if kind not in TRANSIENT_STEPS:
            self.update(job, steps=[*job.steps, ev])
        for q in self._step_subs.get(job_id, ()):
            q.put_nowait(ev)
        return ev

    def queued_ahead(self, job_id: str) -> int:
        """同 queue_key 排在前面的任务数（前端「排队中（前面 N 个）」）。"""
        job = self._jobs.get(job_id)
        if job is None or job.queue_key is None:
            return 0
        q = self._queues.get(job.queue_key, ())
        return list(q).index(job_id) if job_id in q else 0

    def progress(self, job_id: str, progress: float, message: str) -> Job | None:
        """任务协程内汇报阶段；已被取消/终态则忽略。"""
        job = self._jobs.get(job_id)
        if job is None or job.status in FINAL:
            return job
        return self.update(job, status="running", progress=max(0.0, min(1.0, progress)), message=message)

    def list(self, pid: str) -> list[Job]:
        seen: dict[str, Job] = {j.id: j for j in self._jobs.values() if j.pid == pid}
        for p in glob.glob(os.path.join(self.projects_dir, pid, JOBS_DIR, "job_*.json")):
            jid = os.path.splitext(os.path.basename(p))[0]
            if jid not in seen:
                seen[jid] = self._load(p)
        return sorted(seen.values(), key=lambda j: j.created_at, reverse=True)

    def busy(self, pid: str, kind: str) -> bool:
        return any(j.kind == kind and j.status in ("queued", "running") for j in self._jobs.values() if j.pid == pid)

    def create_unless_busy(
        self, kind: str, pid: str, queue_key: str | None = None, payload: dict | None = None
    ) -> Job | None:
        """busy ⇒ None；busy 判定与 create 在同一同步调用内完成——R75-01：路由层 check→await→create 的
        TOCTOU 窗口会让并发请求双双过闸产重复 job，把闸门并进 create 才原子。"""
        if self.busy(pid, kind):
            return None
        return self.create(kind, pid, queue_key, payload)

    def run(self, job: Job, coro_factory: Callable[[], Awaitable[dict | None]]) -> asyncio.Task:
        """create_task；协程返回 dict ⇒ done+result；AiError ⇒ error{kind:ai_<kind>}；其他异常 ⇒ error{internal}。

        job.queue_key 非空时先排同 key FIFO：前面任务终态（含取消）后才开始；排队期间 status 保持 queued。"""
        task = asyncio.get_running_loop().create_task(self._run(job.id, coro_factory), name=job.id)
        self._tasks[job.id] = task
        return task

    async def _wait_turn(self, job: Job) -> None:
        key = job.queue_key
        if key is None:
            return
        q = self._queues.setdefault(key, deque())
        q.append(job.id)
        ev = self._turn[job.id] = asyncio.Event()
        if q[0] == job.id:
            ev.set()
        else:
            self.update(job, message=f"排队中（前面 {len(q) - 1} 个）")
        await ev.wait()

    def _leave_queue(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        self._turn.pop(job_id, None)
        if job is None or job.queue_key is None:
            return
        q = self._queues.get(job.queue_key)
        if not q:
            return
        was_head = q[0] == job_id
        if job_id in q:
            q.remove(job_id)
        if not q:
            self._queues.pop(job.queue_key, None)
        elif was_head:
            nxt = self._turn.get(q[0])
            if nxt is not None:
                nxt.set()

    async def _run(self, job_id: str, coro_factory) -> None:
        try:
            await self._wait_turn(self._jobs[job_id])
            self.progress(job_id, 0.0, "开始")
            result = await coro_factory()
        except asyncio.CancelledError:
            job = self._jobs.get(job_id)
            if job is not None and job.status not in FINAL:
                self.update(job, status="interrupted", message="已取消")
            raise
        except AiError as e:
            self.update(self._jobs[job_id], status="error", message="失败", error=error_detail(f"ai_{e.kind}", str(e)))
        except Exception as e:  # noqa: BLE001 — 任务失败必须落成 error，不能让 Task 静默吞掉
            log.exception("AI 任务 %s 失败", job_id)
            self.update(
                self._jobs[job_id],
                status="error",
                message="失败",
                error=error_detail("internal", f"{e.__class__.__name__}: {e}"),
            )
        else:
            job = self._jobs[job_id]
            if job.status not in FINAL:
                self.update(job, status="done", progress=1.0, message="完成", result=result or {})
        finally:
            self._tasks.pop(job_id, None)
            self._seq.pop(job_id, None)
            self._leave_queue(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job is None or job.status in FINAL:
            return job
        task = self._tasks.get(job_id)
        if task is not None:
            task.cancel()
        return self.update(job, status="interrupted", message="已取消")

    def resume(self, job_id: str) -> Job | None:
        """interrupted / error → queued 重排（steps 与 proposal_ids 断点保留）；其余状态原样返回。
        协程由路由层按 job.payload 重建后再 run()——JobStore 不知道任务怎么跑。"""
        job = self.get(job_id)
        if job is None or job.status not in ("interrupted", "error"):
            return job
        return self.update(job, status="queued", progress=0.0, message="续跑排队中", error=None)

    async def watch(self, job_id: str) -> AsyncIterator[Job]:
        """先发当前状态，再逐次更新；终态发出后结束。"""
        q: asyncio.Queue[Job] = asyncio.Queue()
        self._subs.setdefault(job_id, []).append(q)
        try:
            job = self.get(job_id)
            if job is None:
                return
            yield job
            while job.status not in FINAL:
                job = await q.get()
                yield job
        finally:
            subs = self._subs.get(job_id, [])
            if q in subs:
                subs.remove(q)
            if not subs:
                self._subs.pop(job_id, None)

    async def watch_steps(self, job_id: str) -> AsyncIterator[dict]:
        """StepEvent 流（SSE `GET /ai/jobs/{id}/events` 对 agent:* 任务用）：先回放已存步骤，再逐帧推送
        （含 gen_delta），任务终态后结束。取消 ⇒ 无 done 帧、job.status=interrupted；模型错误 ⇒ done{error}。"""
        q: asyncio.Queue[dict | None] = asyncio.Queue()
        self._step_subs.setdefault(job_id, []).append(q)
        try:
            job = self.get(job_id)
            if job is None:
                return
            for ev in job.steps:
                yield ev
            if job.status in FINAL:
                return
            while True:
                ev = await q.get()
                if ev is None:
                    return
                yield ev
        finally:
            subs = self._step_subs.get(job_id, [])
            if q in subs:
                subs.remove(q)
            if not subs:
                self._step_subs.pop(job_id, None)

    def _load(self, path: str) -> Job:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        job = Job(**d)
        if job.status in ("queued", "running"):
            job = replace(job, status="interrupted", message="服务重启，任务中断", updated_at=time.time())
            self._persist(job)
        self._jobs[job.id] = job
        return job

    def _persist(self, job: Job) -> None:
        atomic.write_json(_job_path(self.projects_dir, job.pid, job.id), job.to_dict())
