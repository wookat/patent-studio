# -*- coding: utf-8 -*-
"""场景计划（docs/plan/21 §6.1；19 §2 A2「固定序列 + 有限槽位」）。

每个场景一个模块 s<N>.py：声明 PLAN = Plan{scenario, steps: [ToolStep|GenStep|CheckStep], model_route,
budget_key, output_kind} 并实现 `async def run(ctx: RunContext)`；`install()` 把 run 挂到 agent.registry。
S8 曾因无合规检索源封印；现以「待检索」诚实版落地（plans/s8.py：只产检索式+笔记框架不伪造结论）。

工具步直接调用 app/mcp/tools_semantic.* 与 routes_* 内部函数（不走 MCP 协议），每次经 ctx.tool() 写
audit.jsonl（who=agent:<job_id>）。所有产出都是 Proposal（critic / comment / patch），永不改 content.md 与
docs/*.md；ctx.finish() 用 checks.no_direct_write 对 job 前后 md5 快照复核并写进 done 事件。

RunContext 是本单元给 agent-core loop 的最小契约（loop 可继承或按同名属性自建）：
  store, pid, ai, job_id, params, user, scenario, cancelled()
  emit(kind, data) / tool(name, fn, **args) / gen(step, messages, purpose) / check(result) / propose(...)
  proposals, events, usage, truncated, calls, project_dir
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.agent import checks, registry
from app.agent.types import (
    CONTEXT_MAX_CHARS,
    Anchor,
    CheckResult,
    Patch,
    Proposal,
    ProposalKind,
    StepEvent,
    Usage,
    step_event,
)
from app.ai.client import AiClient, ChatResult, Purpose
from app.mcp import audit

# 19 §4.4：每场景送模型的上下文字符预算；硬上限 types.CONTEXT_MAX_CHARS（agent-core budget.py 落地后以其为唯一裁剪点）
BUDGET_CHARS: dict[str, int] = {"interactive": 8_000, "s2": 12_000, "s7": 16_000, "s1": 20_000}
MAX_MODEL_CALLS = 6  # 每 job 模型调用上限（S7 每条意见 +1，见 s7.py）


@dataclass(frozen=True)
class ToolStep:
    name: str
    label: str


@dataclass(frozen=True)
class GenStep:
    name: str
    label: str
    purpose: Purpose


@dataclass(frozen=True)
class CheckStep:
    name: str
    label: str
    checks: tuple[str, ...]


Step = ToolStep | GenStep | CheckStep


@dataclass(frozen=True)
class Plan:
    scenario: str
    steps: tuple[Step, ...]
    model_route: Purpose
    budget_key: str
    output_kind: tuple[ProposalKind, ...]

    @property
    def labels(self) -> list[str]:
        return [s.label for s in self.steps]

    @property
    def gen_slots(self) -> int:
        return sum(1 for s in self.steps if isinstance(s, GenStep))


class Interrupted(Exception):
    """ctx.cancelled() 为真时在下一步前抛出；loop 据此把 job 置 interrupted。"""


class BudgetExceeded(Exception):
    """模型调用次数超过每任务上限（19 §4.4）。"""


class RunContext:
    def __init__(
        self,
        *,
        store,
        pid: str,
        ai: AiClient,
        scenario: str,
        job_id: str | None = None,
        params: dict | None = None,
        user: str | None = None,
        emit: Callable[[StepEvent], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
    ):
        self.store = store
        self.pid = pid
        self.ai = ai
        self.scenario = scenario
        self.job_id = job_id or uuid.uuid4().hex[:12]
        self.params = dict(params or {})
        self.user = user
        self._emit = emit
        self._cancelled = cancelled or (lambda: False)
        self.project_dir: str = store._dir(pid)
        self.events: list[StepEvent] = []
        self.proposals: list[Proposal] = []
        self.usage = Usage()
        self.truncated = False
        self.calls = 0
        self.max_calls = MAX_MODEL_CALLS
        self.plan: Plan | None = None
        self.model: str = ""
        store.read_content(pid)  # 先派生 docs/ 镜像，快照才不会把镜像首次生成误判为直写
        self._snapshot = checks.snapshot(self.project_dir)

    # ---- 事件 ----
    def emit(self, kind: str, data: dict | None = None) -> StepEvent:
        ev = step_event(len(self.events), kind, data)
        self.events.append(ev)
        if self._emit is not None:
            self._emit(ev)
        return ev

    def cancelled(self) -> bool:
        return bool(self._cancelled())

    def _guard(self) -> None:
        if self.cancelled():
            raise Interrupted(self.scenario)

    def start(self, plan: Plan) -> None:
        self.plan = plan
        self.emit(
            "plan",
            {
                "scenario": plan.scenario,
                "steps": plan.labels,
                "model_route": plan.model_route,
                "budget_key": plan.budget_key,
            },
        )

    # ---- 工具步：同步内部函数 + 审计 ----
    def tool(self, name: str, fn: Callable, **args):
        self._guard()
        self.emit("tool_call", {"tool": name, "args": _scalar(args)})
        t0 = time.monotonic()
        try:
            out = fn(**args)
        except Exception as e:
            audit.record(self.project_dir, f"agent:{self.job_id}", name, _scalar(args), f"error:{type(e).__name__}")
            raise
        ms = int((time.monotonic() - t0) * 1000)
        chars = len(out) if isinstance(out, str) else len(str(out))
        audit.record(self.project_dir, f"agent:{self.job_id}", name, _scalar(args), "ok")
        self.emit("tool_result", {"tool": name, "chars": chars, "ms": ms})
        return out

    # ---- 生成槽 ----
    def clip(self, text: str, key: str | None = None) -> str:
        limit = min(
            BUDGET_CHARS.get(key or (self.plan.budget_key if self.plan else "interactive"), 8_000), CONTEXT_MAX_CHARS
        )
        if len(text) <= limit:
            return text
        self.truncated = True
        return text[:limit]

    async def gen(self, step: str, messages: list[dict], purpose: Purpose | None = None) -> ChatResult:
        self._guard()
        if self.calls >= self.max_calls:
            raise BudgetExceeded(f"模型调用超过每任务上限 {self.max_calls} 次")
        purpose = purpose or (self.plan.model_route if self.plan else "interactive")
        self.calls += 1
        res = await self.ai.chat(messages, purpose, project_dir=self.project_dir, job_id=self.job_id, user=self.user)
        self.usage = Usage(
            prompt=self.usage.prompt + res.usage.prompt_tokens,
            completion=self.usage.completion + res.usage.completion_tokens,
        )
        self.model = res.model
        self.emit("gen_delta", {"step": step, "text": res.text, "model": res.model})
        return res

    # ---- 自检与提案 ----
    def check(self, result: CheckResult) -> bool:
        self.emit("check", {"name": result.name, "ok": result.ok, "why": result.why})
        return result.ok

    def new_proposal_id(self) -> str:
        """提案 id；运行时（agent-core loop）覆盖为全局唯一 id。"""
        return f"prop_{self.scenario}_{len(self.proposals) + 1:04d}"

    def propose(
        self,
        kind: ProposalKind,
        anchor: Anchor,
        *,
        critic_markdown: str | None = None,
        comment_body: str | None = None,
        patch: Patch | None = None,
        checks_: list[CheckResult] | None = None,
        usage: Usage | None = None,
    ) -> Proposal:
        p = Proposal(
            id=self.new_proposal_id(),
            job_id=self.job_id,
            scenario=self.scenario,
            kind=kind,
            anchor=anchor,
            critic_markdown=critic_markdown,
            comment_body=comment_body,
            patch=patch,
            checks=list(checks_ or []),
            model=self.model or "deterministic",
            usage=usage or Usage(),
            created_at=time.time(),
        )
        self.proposals.append(p)
        self.emit(
            "proposal",
            {
                "id": p.id,
                "kind": kind,
                "anchor": anchor.model_dump(),
                "preview": _preview(critic_markdown or comment_body or (patch.model_dump_json() if patch else "")),
            },
        )
        return p

    def finish(self, error: str | None = None, **extra) -> CheckResult:
        guard = checks.no_direct_write(self._snapshot, checks.snapshot(self.project_dir))
        self.check(guard)
        data = {
            "proposals": [p.id for p in self.proposals],
            "usage": self.usage.model_dump(),
            "truncated": self.truncated,
            "calls": self.calls,
            **extra,
        }
        if error:
            data["error"] = error
        self.emit("done", data)
        return guard


def _scalar(args: dict) -> dict:
    return {
        k: (v if isinstance(v, (int, float, bool, str)) and len(str(v)) <= 80 else f"<{type(v).__name__}>")
        for k, v in args.items()
    }


def _preview(text: str, n: int = 120) -> str:
    return text if len(text) <= n else text[:n] + "…"


# ---------------------------------------------------------------- 注册 ----


def _modules():
    from app.agent.plans import s1, s2, s3, s4, s5, s6, s7, s8, s9, s10

    return (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10)


def plans() -> dict[str, Plan]:
    return {m.PLAN.scenario: m.PLAN for m in _modules()}


def is_plan_handler(handler: Callable) -> bool:
    """handler 是否本包某场景模块的 run（loop 据此给 plans.RunContext 而非 core RunContext）。"""
    return any(handler is m.run for m in _modules())


def install() -> tuple[str, ...]:
    """把各场景 run 挂到 registry（已挂的跳过，可在 registry.reset() 后重复调用）；返回本次新注册的场景。"""
    added = []
    for m in _modules():
        if registry.get(m.PLAN.scenario) is None:
            registry.register(m.PLAN.scenario)(m.run)
            added.append(m.PLAN.scenario)
    return tuple(added)
