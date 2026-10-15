# -*- coding: utf-8 -*-
"""share-confirm-backend：案件时间线 / 备注 @ / 审阅指派（docs/plan/21 §2.2 R-CASE-05）。夹具复用 test_auth。"""

import json
import os
from datetime import timedelta

import pytest
import test_legacy_auth as test_auth
from fastapi.testclient import TestClient

from app import config
from app.domain import cases, events, timeline
from app.mcp import audit
from app.routes import timeline as routes_timeline

on = test_auth.on
client = test_auth.client
_register, _login = test_auth._register, test_auth._login


@pytest.fixture(autouse=True)
def _bus():
    timeline.subscribe()  # 其它测试文件可能 events.reset() 过
    yield


def _events(kind):
    got = []
    events.subscribe(kind, lambda ev: got.append(ev))
    return got


def _items(c, pid="method", q=""):
    r = c.get(f"/api/projects/{pid}/timeline{q}")
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------- off：合并来源 ----------------


def test_off_merges_status_audit_case_and_notes(client):
    c, tmp = client
    d = str(tmp / "projects" / "method")
    assert _items(c) == []  # 全新案子：无历史、无 audit、无确认

    # 1) 状态提交 → case.status（来自 git 历史）
    r = c.post("/api/projects/method/case/status", json={"status": "review", "note": "送客户"})
    assert r.status_code == 200, r.text
    # 2) MCP 写工具审计 → ai.proposal；读工具不进时间线
    audit.record(d, who="codex", tool="patch_block", args={"block_id": "claims/1"}, result="ok")
    audit.record(d, who="codex", tool="read_book", args={}, result="ok")
    # 3) case.json：递交日 + 确认
    case = cases.ensure_case(d)
    case.dates.filed = "2026-09-01"
    case.case_no = "CN2026100001"
    case.confirmations.append(
        cases.Confirmation(
            name="王总",
            actor="client:王总",
            version=3,
            sha="abc1234",
            confirmed_at=1_800_000_000.0,
            ip="1.2.3.4",
            ua="ua",
            token="t",
        )
    )
    cases.save_case(d, case)
    # 4) 备注（@ 解析）+ 总线事件落盘
    r = c.post("/api/projects/method/notes", json={"body": "@张律师 请复核权 1"})
    assert r.status_code == 201, r.text
    note = r.json()
    assert note["kind"] == "note" and note["mentions"] == ["张律师"] and note["actor"] is None
    events.emit("share.created", pid="method", data={"token": "tok"})
    events.emit("export.downloaded", pid="nope-pid", data={})  # 不存在的案子：忽略

    items = _items(c)
    kinds = [it["kind"] for it in items]
    assert set(kinds) == {"case.status", "ai.proposal", "deliver.filed", "share.confirmed", "note", "share.created"}
    assert kinds.count("ai.proposal") == 1 and kinds.count("share.created") == 1
    assert [it["ts"] for it in items] == sorted((it["ts"] for it in items), reverse=True)  # 新→旧
    st = next(it for it in items if it["kind"] == "case.status")
    assert st["text"] == "状态：drafting → review（送客户）" and st["data"]["to"] == "review"
    filed = next(it for it in items if it["kind"] == "deliver.filed")
    assert "2026-09-01" in filed["text"] and "CN2026100001" in filed["text"]
    cf = next(it for it in items if it["kind"] == "share.confirmed")
    assert cf["text"] == "王总 确认定稿（v3）" and cf["data"]["sha"] == "abc1234"
    ai = next(it for it in items if it["kind"] == "ai.proposal")
    assert ai["text"] == "MCP 工具 patch_block" and ai["actor"]["display_name"] == "codex"
    # kind 筛选（多值）
    assert {it["kind"] for it in _items(c, q="?kind=note&kind=share.confirmed")} == {"note", "share.confirmed"}
    assert c.get("/api/projects/method/timeline?kind=bogus").status_code == 422
    # 落盘文件
    lines = (tmp / "projects" / "method" / ".studio" / "timeline.jsonl").read_text(encoding="utf-8").splitlines()
    assert [json.loads(ln)["kind"] for ln in lines] == ["note", "share.created"]


def test_off_review_assign_writes_case_deadline(client):
    c, tmp = client
    d = str(tmp / "projects" / "method")
    assigned = _events("comment.assign")
    r = c.post("/api/projects/method/review-assign", json={"user_id": "u-1"})
    assert r.status_code == 200, r.text
    assert r.json() == {"deadline_id": None}
    due = (cases.local_today() + timedelta(days=timeline_default_days())).isoformat()
    case = cases.load_case(d)
    assert [(x.kind, x.due, x.done) for x in case.deadlines] == [("review_due", due, False)]
    assert len(assigned) == 1 and assigned[0].data == {"user_id": "u-1", "display_name": "u-1", "due": due}
    it = _items(c)[0]
    assert it["kind"] == "review.assigned" and it["data"] == {"user_id": "u-1", "due": due} and due in it["text"]

    r = c.post("/api/projects/method/review-assign", json={"user_id": "u-2", "due": "2026-12-31"})
    assert r.status_code == 200 and cases.load_case(d).deadlines[1].due == "2026-12-31"
    assert c.post("/api/projects/method/review-assign", json={"user_id": "u", "due": "not-a-date"}).status_code == 422
    assert c.post("/api/projects/method/notes", json={"body": ""}).status_code == 422


def timeline_default_days():

    return routes_timeline.DEFAULT_REVIEW_DAYS


# ---------------- on：成员 @ / 指派 / 权限 ----------------


def test_on_mention_emits_and_assign_requires_member(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="所长")
    ed_id = _register(anon, "editor@example.com", display_name="张律师")["id"]
    _register(anon, "guest@example.com", display_name="客人")
    su, ed, guest = (_login(on, f"{n}@example.com") for n in ("su", "editor", "guest"))
    r = su.put("/api/projects/method/members", json={"email": "editor@example.com", "role": "editor"})
    assert r.status_code == 200

    mentioned = _events("comment.mention")
    r = su.post("/api/projects/method/notes", json={"body": "@张律师 @不存在的人 看一下"})
    assert r.status_code == 201, r.text
    assert r.json()["mentions"] == ["张律师", "不存在的人"] and r.json()["actor"]["display_name"] == "所长"
    assert len(mentioned) == 1
    ev = mentioned[0]
    assert ev.pid == "method" and ev.data["user_ids"] == [ed_id] and ev.data["note_id"] == r.json()["id"]
    assert ev.actor["display_name"] == "所长"
    # 批注里 @ 同样发事件（comment.mention 是 events.py 的枚举名；规格写作 comment.mentioned）
    r = su.post(
        "/api/projects/method/comments",
        json={"anchor": {"block_id": "claims/1", "line": 9, "quote": "其特征在于"}, "body": "@张律师 权1"},
    )
    assert r.status_code == 201 and len(mentioned) == 2 and mentioned[1].data["comment_id"] == r.json()["id"]
    # 无命中不发
    su.post("/api/projects/method/notes", json={"body": "@路人 看"})
    assert len(mentioned) == 2

    # 指派：成员 ok；非成员 404；viewer 以下不能指派（reviewer 门槛由 acl 表决定）
    assigned = _events("comment.assign")
    r = su.post("/api/projects/method/review-assign", json={"user_id": ed_id, "due": "2026-10-01"})
    assert r.status_code == 200, r.text
    assert assigned[0].data["display_name"] == "张律师" and assigned[0].actor["display_name"] == "所长"
    r = su.post("/api/projects/method/review-assign", json={"user_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    assert guest.post("/api/projects/method/review-assign", json={"user_id": ed_id}).status_code == 403
    assert guest.get("/api/projects/method/timeline").status_code == 403
    assert anon.get("/api/projects/method/timeline").status_code == 401
    assert ed.get("/api/projects/method/timeline").status_code == 200
    # 不存在的 pid：非成员 404（不泄露存在性只对已存在 pid 生效）
    r = guest.get("/api/projects/ghost/timeline")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    assert su.get("/api/projects/ghost/timeline").status_code == 404  # 超管：真正的 404（案子不存在）


def test_deadline_undone_kind_roundtrip_and_unknown_kind_filtered(on):
    """R57-01：撤销完成发的 deadline.undone 会落盘 timeline.jsonl；未声明 kind 曾把 GET /timeline 毒化成永久 500。
    现在 kind 入契约（merged 顺带丢弃未声明行做前向兼容）。"""
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="所长")
    su = _login(on, "su@example.com")
    # 种一条期限并完成 → 撤销完成（agent 门槛由超管兜底满足）
    r = su.put(
        "/api/projects/method/case",
        json={"deadlines": [{"id": "oa1", "kind": "oa_reply", "due": "2026-10-10", "note": "一通"}]},
    )
    assert r.status_code == 200, r.text
    assert su.post("/api/projects/method/deadlines/oa1/done").status_code == 200
    assert su.post("/api/projects/method/deadlines/oa1/done", json={"done": False}).status_code == 200
    r = su.get("/api/projects/method/timeline")
    assert r.status_code == 200, r.text  # 曾 500：deadline.undone 不在 TimelineEventKind
    kinds = {it["kind"] for it in r.json()["items"]}
    assert {"deadline.done", "deadline.undone"} <= kinds

    # 前向兼容：jsonl 混入未声明 kind 不毒化整表（直接落盘模拟旧版本写入）
    tl = os.path.join(config.PROJECTS_DIR, "method", ".studio", "timeline.jsonl")
    with open(tl, "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": "x-future", "kind": "future.kind", "ts": 1, "text": "未来事件"}) + "\n")
    r = su.get("/api/projects/method/timeline")
    assert r.status_code == 200 and "future.kind" not in {i["kind"] for i in r.json()["items"]}


def test_deadline_override_lands_in_timeline(on):
    """批72：人工改期（法定追溯面）原不 emit——时间线与机构审计均不可见。现 PUT 落 timeline.jsonl。"""
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="所长")
    su = _login(on, "su@example.com")
    r = su.put(
        "/api/projects/method/case",
        json={"deadlines": [{"id": "oa1", "kind": "oa_reply", "due": "2026-10-10", "note": "一通"}]},
    )
    assert r.status_code == 200, r.text
    r = su.put("/api/projects/method/deadlines/oa1", json={"due": "2026-11-01", "override_reason": "证据补充需要"})
    assert r.status_code == 200, r.text
    items = su.get("/api/projects/method/timeline").json()["items"]
    ov = next(i for i in items if i["kind"] == "deadline.override")
    assert "2026-11-01" in ov["text"] and "证据补充需要" in ov["text"]
    assert ov["data"] == {
        "id": "oa1",
        "kind": "oa_reply",
        "from": "2026-10-10",
        "to": "2026-11-01",
        "reason": "证据补充需要",
    }
    assert ov["actor"]["display_name"] == "所长"
