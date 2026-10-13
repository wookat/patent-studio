# -*- coding: utf-8 -*-
"""agent-core-backend（docs/plan/21 §6.2 / §6.3 / §6.5）：循环 / 预算 / Proposal / 路由 / SSE。mock 提供方，无 key。"""
import asyncio
import glob
import hashlib
import importlib
import json
import os
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from app.agent import budget, loop, proposals, registry
from app.agent.types import CONTEXT_MAX_CHARS, SCENARIO_BY_ID, BlocksPatch, FileAnchor, PatchBlock, Proposal
from app.ai import client as client_mod
from app.ai.client import AiClient, append_usage, usage_record
from app.ai.jobs import JobStore
from app.ai.mock import MockProvider
from app.ai.prompts_agent import AgentMockProvider
from app.domain import events
from app.domain.projects import ProjectStore
from app.mcp import audit
from app.routes import ai as routes_ai
from patent_docx import critic

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEAVY = client_mod.MODELS["heavy"]
INTERACTIVE = client_mod.MODELS["interactive"]
FALLBACK = client_mod.MODELS["fallback"]


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    return main.app, projects


@pytest.fixture()
def client(app_env):
    app, projects = app_env
    with TestClient(app) as c:
        yield c, projects, app


def _enable(c):
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_enabled": True}).status_code == 200


def _sse_events(resp):
    out = []
    for line in resp.iter_lines():
        if line.startswith("data:"):
            out.append(json.loads(line[5:].strip()))
    return out


def _md5s(project_dir):
    files = [os.path.join(project_dir, "content.md"), *glob.glob(os.path.join(project_dir, "docs", "*.md"))]
    return {f: hashlib.md5(open(f, "rb").read()).hexdigest() for f in files}


def _burn(project_dir, tokens):
    append_usage(project_dir, usage_record(pid="method", purpose="heavy", kind="agent", model=HEAVY,
                                          requested_model=HEAVY, fallback=False, stream=False,
                                          usage=client_mod.Usage(tokens, 0, tokens), ms=1, ok=True))


# ---------------- budget.clip ----------------

def test_clip_caps_and_hard_limit():
    text = "甲" * 50_000
    assert budget.clip("短", "s1") == ("短", False)
    for scenario, cap in (("s1", 20_000), ("s2", 12_000), ("s7", 16_000), ("s3", 8_000), (None, 8_000)):
        out, truncated = budget.clip(text, scenario)
        assert truncated and len(out) <= cap and out.endswith(budget.CLIP_MARK)
    assert budget.cap_for("s1") <= CONTEXT_MAX_CHARS and budget.HARD_CAP == CONTEXT_MAX_CHARS
    assert all(budget.cap_for(s) <= CONTEXT_MAX_CHARS for s in registry.SCENARIO_IDS)


def test_daily_budget_reads_usage_today_only(tmp_path):
    d = str(tmp_path)
    assert budget.daily_budget(None) == 200_000 and budget.daily_budget({"ai_daily_tokens": 5}) == 5
    _burn(d, 100)
    old = usage_record(pid="x", purpose="heavy", kind="agent", model=HEAVY, requested_model=HEAVY, fallback=False,
                       stream=False, usage=client_mod.Usage(999, 0, 999), ms=1, ok=True)
    old["ts"] = time.time() - 3 * 86400
    append_usage(d, old)
    assert budget.today_tokens(d) == 100
    assert budget.status(d, {"ai_daily_tokens": 150}) == {"today_tokens": 100, "budget": 150}
    assert not budget.exhausted(d, {"ai_daily_tokens": 150})
    _burn(d, 50)
    assert budget.exhausted(d, {"ai_daily_tokens": 150})
    with pytest.raises(Exception) as ei:
        budget.check_heavy(d, {"ai_daily_tokens": 150})
    assert ei.value.status_code == 429 and ei.value.detail["kind"] == "budget"


# ---------------- loop：直接跑（不经 HTTP） ----------------

@pytest.fixture()
def world(app_env):
    _app, projects = app_env
    store = ProjectStore(str(projects))
    return store, JobStore(str(projects)), AiClient(AgentMockProvider())  # 与 ai.client.from_env(mock) 一致


def _run(store, jobs, ai, scenario, params=None):
    async def go():
        job = jobs.create(f"agent:{scenario}", "method", queue_key=None)
        await jobs.run(job, lambda: loop.run_scenario("method", scenario, params or {}, job,
                                                      store=store, jobs=jobs, ai=ai))
        return jobs.get(job.id)

    return asyncio.run(go())


# 场景单元（agent/plans）的真实 handler 需要的入口参数；其余场景无参数
SCENARIO_PARAMS = {
    "s1": {"text": "一种基于多模态融合的赌场投注监控方法，通过图像识别与传感器数据融合识别投注行为。",
           "target": "current"},
    "s7": {"items": [{"id": "oa-1", "claims": [1], "kind": "novelty",
                      "text": "关于权利要求 1：对比文件 1 公开了相同的技术方案，请申请人陈述意见。"}]},
}


def _inject_inconsistent_mark(store, pid="method"):
    """轮8 图例归一后 method 案的 1034 截短名不再不一致——s4/s5 需要至少一条真不一致标记才有差分对象。"""
    store.save_content(pid, store.read_content(pid) + "\n\n进给轴201驱动刀具，夹持机构201夹持工件。")


@pytest.mark.parametrize("scenario", sorted(registry.SCENARIO_IDS))
def test_every_scenario_tool_gen_check_then_proposal_and_docs_untouched(world, scenario):
    store, jobs, ai = world
    p = store.get("method")
    store.read_content("method")
    if scenario in ("s4", "s5"):
        _inject_inconsistent_mark(store)
    before = _md5s(p.dir)
    j = _run(store, jobs, ai, scenario, SCENARIO_PARAMS.get(scenario))
    assert j.status == "done", j.error
    kinds = [s["kind"] for s in j.steps]
    assert kinds[0] == "plan" and kinds[-1] == "done"
    first = {k: kinds.index(k) for k in ("tool_call", "check") if k in kinds}
    assert first["tool_call"] < first["check"]
    assert "proposal" in kinds and "gen_delta" not in kinds  # gen_delta 是瞬时步，不持久化
    assert _md5s(p.dir) == before
    props = proposals.load(p.dir, "method", None)
    assert props and all(q.job_id == j.id and q.scenario == scenario for q in props)
    assert j.result["proposals"] == [q.id for q in props]
    rows = [json.loads(ln) for ln in open(audit.path(p.dir), encoding="utf-8")]
    assert rows and all(r["who"] == f"agent:{j.id}" for r in rows)
    assert all(m not in ("claude-sonnet-4.6",) for m in [c["model"] for c in ai.provider.calls])


def test_model_routing_plan_critique_draft(world):
    store, jobs, ai = world
    _run(store, jobs, ai, "s2")
    assert {c["model"] for c in ai.provider.calls} == {HEAVY}
    ai.provider.calls.clear()
    _run(store, jobs, ai, "s6")
    assert {c["model"] for c in ai.provider.calls} == {INTERACTIVE}


def test_heavy_fifo_second_stays_queued_until_first_done(world):
    store, jobs, ai = world
    key = "method:heavy"

    async def go():
        j1 = jobs.create("agent:s2", "method", queue_key=key)
        j2 = jobs.create("agent:s2", "method", queue_key=key)
        gate = asyncio.Event()

        async def slow():
            await gate.wait()
            return await loop.run_scenario("method", "s2", {}, j1, store=store, jobs=jobs, ai=ai)

        t1 = jobs.run(j1, slow)
        t2 = jobs.run(j2, lambda: loop.run_scenario("method", "s2", {}, j2, store=store, jobs=jobs, ai=ai))
        await asyncio.sleep(0.05)
        assert jobs.get(j1.id).status == "running" and jobs.get(j2.id).status == "queued"
        assert jobs.queued_ahead(j2.id) == 1
        gate.set()
        await t1
        assert jobs.get(j1.id).status == "done"
        await t2
        assert jobs.get(j2.id).status == "done"
        return j1, j2

    j1, j2 = asyncio.run(go())
    assert [s["kind"] for s in jobs.get(j2.id).steps][-1] == "done"


def test_cancel_before_step_interrupted(world):
    store, jobs, ai = world

    async def go():
        job = jobs.create("agent:s2", "method", queue_key="method:heavy")
        started = asyncio.Event()

        class Slow(MockProvider):
            async def complete(self, model, messages, **kw):  # 场景计划走非流式 chat
                started.set()
                await asyncio.sleep(0.2)
                return await super().complete(model, messages, **kw)

            async def stream(self, model, messages, **kw):
                started.set()
                await asyncio.sleep(0.2)
                async for item in super().stream(model, messages, **kw):
                    yield item

        t = jobs.run(job, lambda: loop.run_scenario("method", "s2", {}, job, store=store, jobs=jobs,
                                                     ai=AiClient(Slow())))
        await started.wait()
        jobs.cancel(job.id)
        with pytest.raises(asyncio.CancelledError):
            await t
        return jobs.get(job.id)

    j = asyncio.run(go())
    assert j.status == "interrupted"
    assert not proposals.load(store.get("method").dir, "method", None)


def test_critic_apply_roundtrip_bytes_and_events(world):
    store, jobs, ai = world
    p = store.get("method")
    original = store.read_content("method")
    j = _run(store, jobs, ai, "s6")
    props = [q for q in proposals.load(p.dir, "method", None) if q.kind == "critic"]
    assert props and props[0].state == "pending"
    seen = []
    events.reset()
    events.subscribe("ai.proposal", seen.append)
    r = asyncio.run(proposals.apply(store, "method", props[0].id))
    now = store.read_content("method")
    assert r.content == now and "{~~" in now or "{++" in now or "{--" in now
    assert critic.reject(now) == original
    assert critic.accept(now) != original
    assert r.proposal.state == "applied" and r.backup
    assert proposals.get(p.dir, "method", props[0].id).state == "applied"
    assert [e.data["state"] for e in seen] == ["applied"]
    rows = [json.loads(ln) for ln in open(audit.path(p.dir), encoding="utf-8")]
    assert rows[-1]["tool"] == "proposal.apply" and rows[-1]["who"] == f"agent:{j.id}"
    # 二次应用 ⇒ 409
    with pytest.raises(Exception) as ei:
        asyncio.run(proposals.apply(store, "method", props[0].id))
    assert ei.value.status_code == 409


def test_patch_apply_uses_insertion_marks_and_dismiss(world):
    store, jobs, ai = world
    p = store.get("method")
    original = store.read_content("method")
    _run(store, jobs, ai, "s6")
    critics = [q for q in proposals.load(p.dir, "method", "pending") if q.kind == "critic"]
    assert critics
    _run(store, jobs, ai, "s1", SCENARIO_PARAMS["s1"])
    props = proposals.load(p.dir, "method", "pending")
    patches = [q for q in props if q.kind == "patch"]
    assert patches
    r = asyncio.run(proposals.apply(store, "method", patches[0].id))
    now = store.read_content("method")
    assert "{++" in now and critic.reject(now).replace("\n", "") == original.replace("\n", "")
    assert r.changed_lines.start >= 1
    _run(store, jobs, ai, "s9")
    files = [q for q in proposals.load(p.dir, "method", "pending") if q.kind == "patch"]
    assert files and files[0].anchor.file.startswith("docs/")
    r2 = asyncio.run(proposals.apply(store, "method", files[0].id))
    assert os.path.isfile(os.path.join(p.dir, *files[0].anchor.file.split("/")))
    assert r2.proposal.state == "applied" and r2.content is None
    saved = store.read_content("method")
    _inject_inconsistent_mark(store)
    j5 = _run(store, jobs, ai, "s5")
    store.save_content("method", saved)  # 注入行只为 s5 造差分对象，复原以保 now 快照断言
    # comment 提案即批注，落地即 applied
    assert j5.result["proposals"] and all(q.kind != "comment" for q in proposals.load(p.dir, "method", "pending"))
    left = proposals.load(p.dir, "method", "pending")
    assert [q.id for q in left] == [critics[0].id]
    d = proposals.dismiss(store, "method", left[0].id)
    assert d.state == "dismissed" and proposals.load(p.dir, "method", "dismissed")[0].id == left[0].id
    assert store.read_content("method") == now


def test_patch_apply_orders_anchors_descending_and_chains_same_anchor(world):
    """实应用路径与虚拟应用同一不变量：升序锚点提案也能完整应用
    （靠前插入会重排后段块 id，必须倒序）；同一锚点后的多块保持给出顺序不倒置。"""
    store, jobs, ai = world
    p = store.get("method")
    original = store.read_content("method")
    prop = Proposal(
        id=proposals.new_id(), job_id="job_test", scenario="s1", kind="patch",
        anchor=FileAnchor(file="content.md"), model="test", created_at=time.time(),
        patch=BlocksPatch(blocks=[
            PatchBlock(after_block_id="description/技术领域/p0001", markdown="技术领域补充段"),
            PatchBlock(after_block_id="description/背景技术/p0002", markdown="背景技术补充段"),
            PatchBlock(after_block_id="description/具体实施方式/p0048", markdown="实施方式补充段"),
            PatchBlock(after_block_id="claims/9", markdown="12.新增权项甲"),
            PatchBlock(after_block_id="claims/9", markdown="13.新增权项乙"),
        ]),
    )
    proposals.append(p.dir, "method", prop, "test")
    r = asyncio.run(proposals.apply(store, "method", prop.id))
    now = store.read_content("method")
    assert critic.reject(now).replace("\n", "") == original.replace("\n", "")
    for sec, marker in (("技术领域", "技术领域补充段"), ("背景技术", "背景技术补充段"),
                        ("具体实施方式", "实施方式补充段")):
        seg = now.split("### " + sec)[1].split("### ")[0]
        assert marker in seg, sec
    assert now.index("新增权项甲") < now.index("新增权项乙")
    assert r.changed_lines.start < r.changed_lines.end


def test_patch_apply_replace_block_sandwiches_reversible_marks(world):
    """replace_block_id 落地为 {--旧块--}{++新块--} 同块三明治：拒绝还原原文，接受得新内容。"""
    store, jobs, ai = world
    p = store.get("method")
    original = store.read_content("method")
    old_para = "本发明涉及时间序列预测与机器学习模型部署技术领域"
    assert old_para in original
    prop = Proposal(
        id=proposals.new_id(), job_id="job_test", scenario="s1", kind="patch",
        anchor=FileAnchor(file="content.md"), model="test", created_at=time.time(),
        patch=BlocksPatch(blocks=[
            PatchBlock(after_block_id="description/技术领域/p0001",
                       replace_block_id="description/技术领域/p0001", markdown="替换后的技术领域段。"),
            PatchBlock(after_block_id="description/技术领域/p0001", markdown="替换块之后追加段。"),
            PatchBlock(after_block_id="claims/9", replace_block_id="claims/9",
                       markdown="9.替换后的权项文本。"),
        ]),
    )
    proposals.append(p.dir, "method", prop, "test")
    r = asyncio.run(proposals.apply(store, "method", prop.id))
    now = store.read_content("method")
    assert "{--" in now and "{++" in now
    assert critic.reject(now).replace("\n", "") == original.replace("\n", "")
    acc = critic.accept(now)
    assert "替换后的技术领域段。" in acc and old_para not in acc
    assert "替换后的权项文本。" in acc
    assert acc.index("替换后的技术领域段。") < acc.index("替换块之后追加段。")
    assert r.changed_lines.start < r.changed_lines.end


def test_registry_handler_overrides_default(world):
    store, jobs, ai = world
    registry.reset()
    hits = []

    async def handler(ctx):
        hits.append(ctx.scenario)
        r = await ctx.tool("noop", lambda: {"n": 1})
        ctx.check("custom", r["n"] == 1)

    try:
        registry.register("s4")(handler)
        j = _run(store, jobs, ai, "s4")
        assert hits == ["s4"] and j.status == "done"
        assert [s["kind"] for s in j.steps] == ["tool_call", "tool_result", "check", "done"]
    finally:
        registry.reset()


def test_handler_error_becomes_done_error_not_silent(world):
    store, jobs, ai = world
    registry.reset()

    async def boom(ctx):
        raise RuntimeError("坏了")

    try:
        registry.register("s5")(boom)
        j = _run(store, jobs, ai, "s5")
        assert j.status == "error" and "坏了" in j.error["message"]
        assert j.steps[-1]["kind"] == "done" and "坏了" in j.steps[-1]["data"]["error"]
    finally:
        registry.reset()


# ---------------- 路由 ----------------

def test_run_route_202_jobs_events_and_proposals(client):
    c, projects, app = client
    _enable(c)
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s6", "params": {}})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job_id"] == body["id"] and body["kind"] == "agent:s6" and body["status"] in ("queued", "running")
    for _ in range(100):
        j = c.get(f"/api/ai/jobs/{body['id']}").json()
        if j["status"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert j["status"] == "done", j
    with c.stream("GET", f"/api/ai/jobs/{body['id']}/events") as r:
        assert r.status_code == 200
        evs = _sse_events(r)
    kinds = [e["kind"] for e in evs]
    assert kinds[0] == "plan" and kinds[-1] == "done" and "check" in kinds and "proposal" in kinds
    assert c.get("/api/projects/method/agent/jobs").json()["jobs"][0]["id"] == body["id"]
    props = c.get("/api/projects/method/agent/proposals", params={"state": "pending"}).json()["proposals"]
    assert props and props[0]["kind"] == "critic"
    pid = props[0]["id"]
    a = c.post(f"/api/projects/method/agent/proposals/{pid}/apply")
    assert a.status_code == 200 and a.json()["proposal"]["state"] == "applied"
    assert "content" in a.json()
    applied = c.get("/api/projects/method/agent/proposals", params={"state": "applied"}).json()["proposals"]
    assert applied[0]["id"] == pid
    assert c.post(f"/api/projects/method/agent/proposals/{pid}/dismiss").status_code == 409
    assert c.post("/api/projects/method/agent/proposals/nope/apply").status_code == 404
    assert c.get("/api/projects/method/ai/budget").json()["budget"] == 200_000


def test_run_route_duplicate_scenario_409(client):
    """同场景重复投递（超时重试 / 双击）→ 409 job_busy；异场景不受阻。"""
    c, _, app = client
    _enable(c)
    jobs = app.state.jobs
    jobs.create("agent:s6", "method")  # queued ⇒ busy
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s6", "params": {}})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "job_busy", r.text
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s4", "params": {}})
    assert r.status_code == 202, r.text


def test_run_route_validation_disabled_and_bad_scenario(client):
    """s8 已解封（契约刻意变更）：非法场景样例改 s11。"""
    c, projects, app = client
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s6", "params": {}})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "ai_disabled"
    _enable(c)
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s11", "params": {}})
    assert r.status_code == 422
    assert c.get("/api/projects/method/agent/proposals", params={"state": "bogus"}).status_code == 422


def test_budget_exhausted_heavy_429_chat_allowed(client):
    c, projects, app = client
    _enable(c)
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_daily_tokens": 100}).status_code == 200
    _burn(str(projects / "method"), 120)
    u = c.get("/api/projects/method/ai/usage").json()
    assert u["today_tokens"] == 120 and u["budget"] == 100
    assert c.get("/api/projects/method/ai/budget").json() == {"today_tokens": 120, "budget": 100}
    assert SCENARIO_BY_ID["s2"].weight == "heavy"
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s2", "params": {}})
    assert r.status_code == 429 and r.json()["detail"]["kind"] == "budget"
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s6", "params": {}})
    assert r.status_code == 202
    with c.stream("POST", "/api/projects/method/ai/chat",
                  json={"messages": [{"role": "user", "content": "你好"}],
                        "context": {"book": "claims", "line_start": 2, "line_end": 2,
                                    "terms": True, "checks": True, "claim_tree": True}}) as r:
        assert r.status_code == 200
        evs = _sse_events(r)
    assert evs[-1]["done"] is True and isinstance(evs[-1]["truncated"], bool)


def test_chat_context_semantic_parts_clipped(app_env):
    _app, projects = app_env
    store = ProjectStore(str(projects))
    p = store.get("method")
    content = store.read_content("method")
    text, truncated = routes_ai._chat_context(p, content, {"terms": True, "checks": True, "claim_tree": True},
                                              store, "method")
    assert "术语表：" in text and "检查结果：" in text and "权项树：" in text
    assert len(text) <= budget.INTERACTIVE_CHARS
    small, t2 = routes_ai._chat_context(p, content, {"terms": [{"name": "安全锚"}]}, store, "method")
    assert "安全锚" in small and t2 is False
    assert truncated is True
