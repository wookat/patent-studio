# -*- coding: utf-8 -*-
"""W5 骨架锁（docs/plan/21 §7.4.8）：错误码表、事件总线、schemas、agent 场景表 / 注册表（S8 禁止）、
JobStore steps / queue_key FIFO / 取消语义、W5 占位路由 501 形状 + ACL 映射、新表建表、CNIPA 资产 MD5 基线、
OA PDF 与 agent 事件 fixture。单元落地后把对应 501 断言改成正式契约测试（各自的 test_*.py）。"""
import asyncio
import hashlib
import json
import os
import re

import pytest
import test_auth
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pypdf import PdfReader
from test_auth import _login, _register

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(BACKEND, "tests", "fixtures")


# ---------------------------------------------------------------- errors ----

def test_error_kinds_and_status_map():
    from fastapi import HTTPException

    from app import errors

    assert {"not_implemented", "share.expired", "oa.pdf_no_text", "deadline.rule", "budget"} <= errors.ERROR_KINDS
    assert set(errors.KIND_STATUS) <= errors.ERROR_KINDS
    assert errors.KIND_STATUS["share.expired"] == 410 and errors.KIND_STATUS["budget"] == 429
    e = errors.kind_error("share.revoked", "链接已撤销", detail="tok")
    assert isinstance(e, HTTPException) and e.status_code == 410
    assert e.detail == {"kind": "share.revoked", "message": "链接已撤销", "line": None, "detail": "tok"}
    with pytest.raises(ValueError):
        errors.kind_error("nope", "x")
    assert errors.kind_error("build", "x", status=400).status_code == 400


# ---------------------------------------------------------------- events ----

def test_event_bus_sync_async_wildcard_and_isolation():
    from app.domain import events

    events.reset()
    got: list[tuple[str, str]] = []

    async def async_h(e):
        got.append(("async", e.kind))

    def boom(e):
        raise RuntimeError("consumer bug must not break producer")

    events.subscribe("case.created", lambda e: got.append(("sync", e.kind)))
    events.subscribe("*", async_h)
    events.subscribe("*", boom)
    off = events.subscribe("case.deleted", lambda e: got.append(("gone", e.kind)))
    off()

    async def run():
        e = events.emit("case.created", pid="p1", actor={"id": "u"}, data={"title": "t"})
        assert e.pid == "p1" and e.data == {"title": "t"} and e.ts > 0
        events.emit("case.deleted", pid="p1")
        await events.drain()

    asyncio.run(run())
    assert ("sync", "case.created") in got and ("async", "case.created") in got
    assert ("async", "case.deleted") in got and not any(k == "gone" for k, _ in got)
    with pytest.raises(ValueError):
        events.emit("not.an.event")
    events.reset()


def test_create_project_emits_case_created_and_runs_hooks(client):
    from app import main
    from app.domain import events

    c, _ = client
    seen = []
    events.reset()
    events.subscribe("case.created", lambda e: seen.append(e))

    async def hook(project, user):
        seen.append(("hook", project.id, user))

    main.PROJECT_CREATED_HOOKS.append(hook)
    try:
        r = c.post("/api/projects", json={"id": "w5-evt", "title": "事件测试"})
        assert r.status_code == 201, r.text
    finally:
        main.PROJECT_CREATED_HOOKS.remove(hook)
        events.reset()
    assert ("hook", "w5-evt", None) in seen
    ev = [e for e in seen if not isinstance(e, tuple)]
    assert len(ev) == 1 and ev[0].pid == "w5-evt" and ev[0].data["title"] == "事件测试"


# ---------------------------------------------------------------- schemas ----

def test_schemas_shapes_match_frontend_types():
    """字段名 / 枚举值与 frontend/src/types/w5.ts 一致（前后端共享形状；单元不得另造同名模型）。"""
    from app import schemas as s

    d = s.DeadlineItem(id="d1", pid="p", title="答复 OA1", kind="oa_reply", due="2026-03-01", source="auto",
                       status="due_soon", days_left=10, legal_basis=s.LegalBasis(text="细则", url="https://x"))
    dd = d.model_dump()
    assert {"case_no", "base_date", "rule", "override_reason", "owner", "client", "done", "done_at",
            "extensions"} <= set(dd)
    assert dd["done"] is False and dd["extensions"] == []
    assert set(s.DeadlineKind.__args__) == {"oa_reply", "exam_request", "priority", "annual_fee", "review_due",
                                            "divisional", "reexam", "publication", "custom"}
    assert set(s.DeadlineStatus.__args__) == {"upcoming", "due_soon", "overdue", "done"}
    n = s.Notification(id="n1", kind="mention", title="t", created_at=1.0)
    assert n.read is False and n.body == "" and n.href is None
    link = s.PublicShareLink(token="t" * 32, pid="p", scope="confirm", created_by={"id": "u", "display_name": "甲"},
                             created_at=1.0)
    assert link.allow_download is False and link.visits == 0
    with pytest.raises(ValidationError):
        s.PublicShareLinkIn(scope="write")
    oa = s.OaRound(id="r1", kind="first", issued_on="2026-01-05", delivery="electronic", created_at=1.0)
    assert oa.items == 0 and oa.deadline_id is None
    assert set(s.OaRoundKind.__args__) == {"first", "subsequent", "reexam", "rejection"}
    assert s.BuildTagged().pdf_tagged is False
    # 与前端领域契约的字面量枚举逐一对齐（文本级校验，防止某一侧改了枚举值另一侧不知道）
    tdir = os.path.join(BACKEND, "..", "frontend", "src", "types")
    ts = "".join(open(os.path.join(tdir, n), encoding="utf-8").read()
                 for n in ("deadlines.ts", "notify.ts", "public-share.ts", "oa.ts"))
    for name in ("DeadlineKind", "DeadlineStatus", "DeadlineRange", "NotificationKind", "PublicShareScope",
                 "OaRoundKind", "OaDelivery"):
        m = re.search(rf"export type {name} = ([^\n]+)", ts)
        assert m, name
        front = set(re.findall(r"'([^']+)'", m.group(1)))
        assert front == set(getattr(s, name).__args__), name


# ---------------------------------------------------------------- agent ----

def test_agent_scenarios_s8_unsealed_and_registry():
    """s8 解封（契约刻意变更）：待检索查新笔记场景，不伪造检索结论。"""
    from app.agent import registry, types

    assert "s8" in types.SCENARIO_IDS and types.FORBIDDEN_SCENARIOS == frozenset()
    assert [x.id for x in types.SCENARIOS] == list(types.SCENARIO_IDS)
    assert types.CONTEXT_MAX_CHARS == 40_000 and types.CONCURRENCY_DEFAULT == 2
    assert types.heavy_queue_key("p1") == "p1:heavy" and types.job_kind("s2") == "agent:s2"
    registry.reset()
    assert registry.registered() == () and registry.available() == []

    @registry.register("s2")
    async def s2(ctx):
        return ctx

    assert registry.get("s2") is s2 and registry.registered() == ("s2",)
    assert [x.id for x in registry.available()] == ["s2"]
    with pytest.raises(ValueError):
        registry.register("s2")(s2)
    for bad in ("s11", ""):  # s8 已解封为注册场景，不再属非法 ID
        with pytest.raises(ValueError):
            registry.validate_scenario(bad)
    registry.reset()


def test_agent_events_fixture_is_valid_step_stream():
    from app.agent.types import StepEvent

    with open(os.path.join(FIX, "agent", "agent_events_s2.jsonl"), encoding="utf-8") as f:
        steps = [StepEvent.model_validate_json(line) for line in f if line.strip()]
    assert [s.seq for s in steps] == list(range(len(steps)))
    assert steps[0].kind == "plan" and steps[-1].kind == "done"
    assert any(s.kind == "gen_delta" for s in steps) and any(s.kind == "proposal" for s in steps)
    assert steps[-1].data["proposals"] == 1


# ---------------------------------------------------------------- jobs ----

def test_jobstore_steps_fifo_and_cancel(tmp_path):
    from app.ai.jobs import JobStore

    store = JobStore(str(tmp_path))
    order: list[str] = []

    async def scenario():
        def work(job):
            async def go():
                order.append(job.id)
                store.add_step(job.id, "plan", {"n": 1})
                store.add_step(job.id, "gen_delta", {"text": "x"})  # 瞬态：推送不落盘
                store.add_step(job.id, "done")
                await asyncio.sleep(0)
                return {"ok": True}

            return go

        a = store.create("agent:s2", "p1", queue_key="p1:heavy")
        b = store.create("agent:s3", "p1", queue_key="p1:heavy")
        other = store.create("agent:s2", "p2", queue_key="p2:heavy")
        assert a.steps == [] and a.queue_key == "p1:heavy"

        gate = asyncio.Event()

        async def slow():
            order.append(a.id)
            await gate.wait()
            return {"ok": True}

        store.run(a, slow)
        store.run(b, work(b))
        store.run(other, work(other))
        await asyncio.sleep(0.05)
        assert store.get(a.id).status == "running"
        assert store.get(b.id).status == "queued" and store.queued_ahead(b.id) == 1
        assert store.get(other.id).status in ("running", "done")  # 不同 queue_key 不互相排队
        gate.set()
        for _ in range(50):
            await asyncio.sleep(0.01)
            if store.get(b.id).status == "done":
                break
        assert store.get(a.id).status == "done" and store.get(b.id).status == "done"
        assert order.index(a.id) < order.index(b.id)
        kinds = [s["kind"] for s in store.get(b.id).steps]
        assert kinds == ["plan", "done"] and [s["seq"] for s in store.get(b.id).steps] == [0, 2]

        # 取消排队中的任务：队头结束后下一个仍能拿到 turn
        gate2 = asyncio.Event()

        async def slow2():
            await gate2.wait()
            return {}

        h = store.create("agent:s2", "p3", queue_key="p3:heavy")
        q1 = store.create("agent:s2", "p3", queue_key="p3:heavy")
        q2 = store.create("agent:s2", "p3", queue_key="p3:heavy")
        store.run(h, slow2)
        store.run(q1, work(q1))
        store.run(q2, work(q2))
        await asyncio.sleep(0.02)
        assert store.cancel(q1.id)
        assert store.get(q1.id).status == "interrupted"
        gate2.set()
        for _ in range(50):
            await asyncio.sleep(0.01)
            if store.get(q2.id).status == "done":
                break
        assert store.get(q2.id).status == "done" and store.get(h.id).status == "done"

    asyncio.run(scenario())
    # 旧 JSON（无 steps / queue_key）可加载
    from app.ai.jobs import JOBS_DIR

    p = os.path.join(str(tmp_path), "p1", JOBS_DIR)
    files = [f for f in os.listdir(p) if f.startswith("job_") and f.endswith(".json")]
    assert files
    with open(os.path.join(p, files[0]), encoding="utf-8") as f:
        raw = json.load(f)
    raw.pop("steps", None)
    raw.pop("queue_key", None)
    raw["id"] = "job_legacy1"
    with open(os.path.join(p, "job_legacy1.json"), "w", encoding="utf-8") as f:
        json.dump(raw, f)
    store2 = JobStore(str(tmp_path))
    j = store2.get("job_legacy1")
    assert j is not None and j.steps == [] and j.queue_key is None


def test_watch_steps_ends_on_terminal(tmp_path):
    from app.ai.jobs import JobStore

    store = JobStore(str(tmp_path))

    async def scenario():
        j = store.create("agent:s2", "p1", queue_key="p1:heavy")

        async def work():
            store.add_step(j.id, "plan")
            await asyncio.sleep(0.01)
            store.add_step(j.id, "done")
            return {}

        store.run(j, work)
        seen = []
        async for ev in store.watch_steps(j.id):
            seen.append(ev["kind"])
        return seen

    seen = asyncio.run(scenario())
    assert seen[:2] == ["plan", "done"]


# ---------------------------------------------------------------- routes ----

W5_LANDED = {
    "deadlines-backend": [("GET", "/api/deadlines"), ("POST", "/api/projects/{pid}/deadlines/compute"),
                          ("PUT", "/api/projects/{pid}/deadlines/d1"),
                          ("POST", "/api/projects/{pid}/deadlines/d1/done")],
}


def test_w5_placeholders_replaced_by_units(client):
    """prep 期的 501 占位已被各单元实现：路由存在（≠404/501），空体走各自校验而非 not_implemented。"""
    c, _ = client
    r = c.post("/api/projects", json={"id": "w5p", "title": "占位"})
    assert r.status_code == 201, r.text
    for _unit, routes in W5_LANDED.items():
        for method, path in routes:
            r = c.request(method, path.replace("{pid}", "w5p"), json={})
            assert r.status_code != 501, (method, path, r.status_code, r.text)
            if r.status_code == 404:  # 路由存在但资源不存在（期限 d1），而非 FastAPI 的 Not Found
                assert r.json()["detail"]["kind"] == "not_found", r.text


def test_w5_acl_routes_mapped_and_public_prefix():
    from app import auth
    from app.auth import required_role

    assert auth.PUBLIC_PATH_PREFIXES == ("/api/public/",)
    assert required_role("GET", "/api/projects/{pid}/timeline") == "viewer"
    assert required_role("GET", "/api/projects/{pid}/oa/rounds") == "viewer"
    assert required_role("POST", "/api/projects/{pid}/oa/rounds") == "agent"
    assert required_role("POST", "/api/projects/{pid}/public-links") == "owner"
    assert required_role("POST", "/api/projects/{pid}/agent/proposals/{proposal_id}/apply") == "reviewer"
    assert required_role("POST", "/api/projects/{pid}/deadlines/compute") == "agent"


def test_w5_on_public_is_anonymous_and_tables_exist(on):
    """AUTH=on：/api/public/* 匿名可达（501 而非 401）；带 pid 的 W5 路由未登录 401；三张新表已建。"""
    main = on
    c = TestClient(main.app)
    assert c.get("/api/public/tok/meta").status_code == 404  # 匿名可达：token 不存在 → 404 而非 401
    assert c.post("/api/public/tok/comments", json={}).status_code in (404, 422)
    assert c.get("/api/projects/x/timeline").status_code == 401
    assert c.get("/api/notify").status_code == 401
    _register(c, "w5@x.io")
    u = _login(main, "w5@x.io")
    r = u.post("/api/projects", json={"id": "w5on", "title": "t"})
    assert r.status_code == 201, r.text
    assert u.get("/api/projects/w5on/timeline").status_code == 200
    assert u.get("/api/notify").json() == {"items": [], "unread": 0, "has_more": False}
    from sqlalchemy import inspect

    from app.notify import sink

    insp = inspect(sink.engine())
    names = set(insp.get_table_names())
    assert {"notifications", "public_share_links", "org_audit_events"} <= names
    idx = {i["name"] for t in names for i in insp.get_indexes(t)}
    assert {"ix_notifications_user_read_created", "ix_public_share_links_project_revoked",
            "ix_org_audit_events_ts_kind"} <= idx


# ---------------------------------------------------------------- fixtures / golden ----

def test_cnipa_assets_md5_golden():
    root = os.path.join(BACKEND, "src", "patent_studio", "kernel", "cnipa_dtd")
    with open(os.path.join(BACKEND, "tests", "golden", "cnipa_assets_md5.json"), encoding="utf-8") as f:
        golden = json.load(f)
    actual = {n: hashlib.md5(open(os.path.join(root, n), "rb").read()).hexdigest() for n in sorted(os.listdir(root))}
    assert actual == golden, "CNIPA DTD/XSL 资产变了：这是冻结资产，若确属官方更新请同步更新 golden 并说明来源"


def test_oa_pdf_fixtures():
    text = PdfReader(os.path.join(FIX, "oa", "oa_text.pdf")).pages[0].extract_text()
    assert "Office Action" in text and "Claim 1" in text
    assert PdfReader(os.path.join(FIX, "oa", "oa_scan.pdf")).pages[0].extract_text().strip() == ""


def test_holidays_verified_and_fail_closed():
    from app import deadlines

    h = deadlines.load_holidays(2026)
    assert h["year"] == 2026 and h["verified"] is True and "2026-05-01" in h["holidays"]
    assert deadlines.load_holidays(1999)["verified"] is False
