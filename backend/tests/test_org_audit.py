# -*- coding: utf-8 -*-
"""W5 notify-audit-backend：机构审计（events "*" → org_audit_events）+ GET /api/admin/audit(.csv) 筛选（超管）。"""
import csv
import io
import time
from datetime import UTC, datetime, timedelta

import test_auth
from fastapi.testclient import TestClient
from test_auth import _login, _register

from app.domain import events, org_audit

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture

CSV_COLS = ["ts", "kind", "actor_id", "actor_name", "pid", "data"]


def _seed(on):
    # 集成后登录本身会 emit auth.login（auth.db.on_after_login）：建种子账号期间先停审计，计数只看用例自己发的事件
    events.subscribe("*", org_audit.on_event)()
    anon = TestClient(on.app)
    su = _register(anon, "su@example.com", display_name="王管理员")
    staff = _register(anon, "staff@example.com", display_name="小李")
    out = _login(on, "su@example.com"), _login(on, "staff@example.com"), su, staff
    org_audit.install()  # test_w5_prep 会 events.reset()
    return out


def _actor(u):
    return {"id": u["id"], "display_name": u["display_name"]}


def _rows_csv(text: str) -> list[dict]:
    assert text.startswith("\ufeff")
    return list(csv.DictReader(io.StringIO(text.lstrip("\ufeff"))))


# ---------------------------------------------------------------- off ----

def test_off_mode_writes_nothing_and_routes_501(client):
    c, tmp = client
    org_audit.install()
    events.emit("export.downloaded", pid="method", data={"fmt": "docx"})
    assert not (tmp / "studio.db").exists()  # off 不建库（本地不再有 sqlite 文件）
    assert c.get("/api/admin/audit").status_code == 501
    assert c.get("/api/admin/audit.csv").status_code == 501


# ---------------------------------------------------------------- 写入 ----

def test_export_download_event_becomes_audit_row(on):
    su_c, staff_c, su, staff = _seed(on)
    before = time.time()
    ev = events.emit("export.downloaded", pid="method", actor=_actor(staff), data={"fmt": "docx", "book": "all"})
    # deadline.due 非机构审计事件（批72 起 case.status 入审计，换本 kind 守 KINDS 闸）
    events.emit("deadline.due", pid="method", actor=_actor(staff), data={"id": "d1"})
    events.emit("comment.mention", pid="method", actor=_actor(staff), data={"user_id": su["id"]})

    r = su_c.get("/api/admin/audit")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1 and len(body["items"]) == 1
    row = body["items"][0]
    assert set(row) == {"id", "ts", "kind", "actor", "pid", "data"}
    assert row["kind"] == "export.downloaded" and row["pid"] == "method"
    assert row["actor"] == {"id": staff["id"], "display_name": "小李", "avatar_color": ""}
    assert row["data"] == {"fmt": "docx", "book": "all"}
    assert before - 1 <= row["ts"] <= time.time() + 1 and abs(row["ts"] - ev.ts) < 1

    # 匿名 actor（如公开链接访客）也可入账
    events.emit("share.confirmed", pid="method", data={"name": "张客户", "version": 1})
    items = su_c.get("/api/admin/audit").json()["items"]
    assert items[0]["kind"] == "share.confirmed" and items[0]["actor"] is None


def test_case_ops_kinds_now_audited(on):
    """批72：已 emit 却被 KINDS 闸丢弃的案务操作入审计——期限完成/撤销/改期/催办、
    OA 轮次、案卷状态、批注指派都是「谁动了义务」的法定追溯面。"""
    su_c, staff_c, su, staff = _seed(on)
    for kind in ("deadline.done", "deadline.undone", "deadline.override", "deadline.nudge",
                 "oa.round", "case.status", "comment.assign"):
        events.emit(kind, pid="method", actor=_actor(staff), data={"probe": kind})
    kinds = {r["kind"] for r in su_c.get("/api/admin/audit").json()["items"]}
    assert {"deadline.done", "deadline.undone", "deadline.override", "deadline.nudge",
            "oa.round", "case.status", "comment.assign"} <= kinds


def test_admin_user_update_emits_audit(on):
    """R50-01：授/撤超管、禁用、改头衔这类最高权限成员管理必须落机构审计。"""
    su_c, staff_c, su, staff = _seed(on)
    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"is_superuser": True, "title": "代理师"})
    assert r.status_code == 200, r.text
    items = su_c.get("/api/admin/audit", params={"kind": "admin.user"}).json()["items"]
    assert len(items) == 1
    row = items[0]
    assert row["kind"] == "admin.user" and row["pid"] is None
    assert row["actor"] == {"id": su["id"], "display_name": "王管理员", "avatar_color": ""}
    assert row["data"]["user_id"] == staff["id"] and row["data"]["email"] == "staff@example.com"
    assert row["data"]["changes"] == {"is_superuser": True, "title": "代理师"}
    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"is_active": False})
    assert r.status_code == 200
    items = su_c.get("/api/admin/audit", params={"kind": "admin.user"}).json()["items"]
    assert items[0]["data"]["changes"] == {"is_active": False}
    # 无字段变化的空调用不记行
    r = su_c.put(f"/api/admin/users/{staff['id']}", json={})
    assert r.status_code == 200
    assert su_c.get("/api/admin/audit", params={"kind": "admin.user"}).json()["total"] == 2


# ---------------------------------------------------------------- 权限 ----

def test_audit_is_superuser_only(on):
    su_c, staff_c, su, staff = _seed(on)
    assert TestClient(on.app).get("/api/admin/audit").status_code == 401
    r = staff_c.get("/api/admin/audit")
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "superuser"
    assert staff_c.get("/api/admin/audit.csv").status_code == 403
    assert su_c.get("/api/admin/audit").json() == {"items": [], "total": 0}
    assert su_c.get("/api/admin/audit.csv").text == "\ufeff" + ",".join(CSV_COLS) + "\r\n"


# ---------------------------------------------------------------- 筛选 + CSV ----

def test_filters_and_csv_row_count_matches(on):
    su_c, staff_c, su, staff = _seed(on)
    t0 = time.time()
    events.emit("case.created", pid="a", actor=_actor(su), data={"title": "甲"})
    events.emit("case.created", pid="b", actor=_actor(staff), data={"title": "乙"})
    events.emit("export.downloaded", pid="a", actor=_actor(staff), data={"fmt": "pdf"})
    events.emit("export.downloaded", pid="b", actor=_actor(staff), data={"fmt": "docx"})
    events.emit("ai.sent", pid="a", actor=_actor(su), data={"model": "swe-2-max", "tokens": 1200})
    events.emit("auth.login", actor=_actor(staff), data={"email": "staff@example.com"})
    events.emit("case.deleted", pid="b", actor=_actor(su), data={"title": "乙"}, ts=t0 - 10 * 86400)  # 十天前

    def q(**params):
        return su_c.get("/api/admin/audit", params=params).json()

    assert q()["total"] == 7
    assert [i["kind"] for i in q()["items"]][:2] == ["auth.login", "ai.sent"]  # 新 → 旧
    assert q()["items"][-1]["kind"] == "case.deleted"
    assert q(actor=staff["id"])["total"] == 4
    assert q(pid="a")["total"] == 3
    assert q(kind="export.downloaded")["total"] == 2
    assert q(kind="export.downloaded", pid="b")["items"][0]["data"] == {"fmt": "docx"}
    assert q(actor=su["id"], pid="a")["total"] == 2
    assert q(**{"from": datetime.fromtimestamp(t0 - 60, UTC).date().isoformat()})["total"] == 6
    assert q(to=str(t0 - 5 * 86400))["total"] == 1
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    assert q(to=yesterday)["total"] == 1
    assert q(limit=2)["total"] == 7 and len(q(limit=2)["items"]) == 2
    assert q(actor="not-a-uuid") == {"items": [], "total": 0}
    assert q(actor="小李")["total"] == 4  # 非 id ⇒ 按姓名 / 邮箱包含匹配
    assert q(actor="SU@example")["total"] == 3
    r = su_c.get("/api/admin/audit", params={"kind": "nope"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "validation"
    r = su_c.get("/api/admin/audit", params={"from": "昨天"})
    assert r.status_code == 422

    # CSV：行数 = 同一筛选的 total；列固定；data 为 JSON
    for params, n in (({}, 7), ({"actor": staff["id"]}, 4), ({"kind": "export.downloaded", "pid": "b"}, 1),
                      ({"to": yesterday}, 1)):
        r = su_c.get("/api/admin/audit.csv", params=params)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert "org-audit.csv" in r.headers["content-disposition"]
        rows = _rows_csv(r.text)
        assert len(rows) == n == q(**params)["total"], params
        assert list(rows[0]) == CSV_COLS
    rows = _rows_csv(su_c.get("/api/admin/audit.csv", params={"kind": "export.downloaded", "pid": "b"}).text)
    assert rows[0]["actor_name"] == "小李" and rows[0]["actor_id"] == staff["id"] and rows[0]["pid"] == "b"
    assert rows[0]["data"] == '{"fmt": "docx"}' and rows[0]["ts"].endswith("+00:00")
    rows = _rows_csv(su_c.get("/api/admin/audit.csv", params={"kind": "auth.login"}).text)
    assert rows[0]["pid"] == "" and rows[0]["data"] == '{"email": "staff@example.com"}'


def test_corrupt_org_json_422(tmp_path, monkeypatch):
    """R38-03：org.json 损坏 → 422 而非 500。"""
    import json as _json

    from fastapi import HTTPException

    from app.domain import org as org_mod

    org_dir = tmp_path / "projects"
    (org_dir / ".studio").mkdir(parents=True)
    p = org_dir / ".studio" / "org.json"
    p.write_text("{bad", encoding="utf-8")
    try:
        org_mod.load_org(str(org_dir))
        raise AssertionError("应当 422")
    except HTTPException as e:
        assert e.status_code == 422
    # 坏 schema（JSON 合法但结构不合法）同样 422
    p.write_text(_json.dumps({"name": {"x": 1}}), encoding="utf-8")
    try:
        org_mod.load_org(str(org_dir))
        raise AssertionError("应当 422")
    except HTTPException as e:
        assert e.status_code == 422
