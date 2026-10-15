# -*- coding: utf-8 -*-
"""单元 A1-case-api（docs/plan/13-w4a-case-dashboard-design.md §2 / §5）：
PUT /case、POST /case/status（history 事件）、标签 CRUD（级联）、用户视角 list-state、永久删除、退出、批量。
auth off（单机）与 on（viewer / editor / agent / owner / 超管）都覆盖；骨架级用例在 test_w4a_prep.py。
"""

import importlib
import json
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

from app.domain import cases, history
from app.routes import cases as routes_cases

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"


def _reload_app():
    import app.auth
    import app.auth.router
    import app.routes
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    for name in ("db", "users", "acl", "schemas", "create_user"):
        sys.modules.pop(f"app.auth.{name}", None)
        app.auth.__dict__.pop(name, None)
    importlib.reload(app.auth)
    importlib.reload(app.auth.router)
    importlib.reload(projects_mod)
    importlib.reload(app.routes)  # project_or_404 的 ProjectError 同样要重绑
    importlib.reload(routes_cases)  # 重绑 ProjectError（projects 已重载）
    importlib.reload(build)
    importlib.reload(xml_export)
    return importlib.reload(main)


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in ("method", "system"):
        shutil.copytree(
            os.path.join(ROOT, "examples", pid),
            projects / pid,
            ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
        )
    return projects


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app()
    return TestClient(main.app), projects


@pytest.fixture()
def on(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app()
    yield main, projects
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app()


def _snapshot(d):
    return {name: open(os.path.join(d, name), "rb").read() for name in ("content.md", "studio.json")}


def _messages(project_dir):
    return [v["message"] for v in history.log(str(project_dir))]


# ---------------------------------------------------------------- off：台账 ----


def test_put_case_patches_only_given_fields_and_commits(client):
    c, projects = client
    r = c.put(
        "/api/projects/method/case",
        json={"case_no": "P-001", "client": "甲方", "deadlines": [{"kind": "filing", "due": "2099-01-01"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["case_no"] == "P-001" and body["client"] == "甲方" and body["status"] == "drafting"
    assert body["next_deadline"]["kind"] == "filing" and body["next_deadline"]["level"] == "normal"
    r = c.put("/api/projects/method/case", json={"tags": ["AI"]})
    assert r.json()["case_no"] == "P-001" and r.json()["tags"] == ["AI"]  # 未给的字段不动
    assert _messages(projects / "method") == ["case: update tags", "case: update case_no, client, deadlines"]
    # 空 patch：不写盘不提交
    assert c.put("/api/projects/method/case", json={}).status_code == 200
    assert len(_messages(projects / "method")) == 2
    # 校验：坏日期 422；不存在的案 404；status 不能从 PUT 改（未知键 422，不静默忽略）
    assert c.put("/api/projects/method/case", json={"dates": {"opened": "2026/1/1"}}).status_code == 422
    assert c.put("/api/projects/nope/case", json={"client": "x"}).status_code == 404
    assert c.put("/api/projects/method/case", json={"status": "review"}).status_code == 422
    assert c.get("/api/projects/method/case").json()["status"] == "drafting"
    # 台账写入不碰正文 / 排版
    assert _snapshot(projects / "method") == _snapshot(os.path.join(ROOT, "examples", "method"))


def test_put_case_dates_persist_and_unknown_date_keys_rejected(client):
    """审计 I-2：申请日 / 公开日 / 实审 / 授权日走 dates.*，写后重读不丢；
    旧的顶层 filing_date 类字段名 422 而不是 200 丢弃。"""
    c, _projects = client
    r = c.put(
        "/api/projects/method/case",
        json={
            "dates": {
                "filed": "2026-03-01",
                "publication": "2027-09-01",
                "exam_request": "2026-03-02",
                "grant": "2028-01-01",
            }
        },
    )
    assert r.status_code == 200, r.text
    got = c.get("/api/projects/method/case").json()["dates"]
    assert (got["filed"], got["publication"], got["exam_request"], got["grant"]) == (
        "2026-03-01",
        "2027-09-01",
        "2026-03-02",
        "2028-01-01",
    )
    # 只改一个子字段，其余日期不动
    assert c.put("/api/projects/method/case", json={"dates": {"grant": None}}).status_code == 200
    got = c.get("/api/projects/method/case").json()["dates"]
    assert got["grant"] is None and got["filed"] == "2026-03-01"
    bads = ({"filing_date": "2026-03-01"}, {"publication_date": "2027-09-01"}, {"dates": {"filing_date": "2026-03-01"}})
    for bad in bads:
        assert c.put("/api/projects/method/case", json=bad).status_code == 422, bad


def test_status_transitions_write_history_events(client):
    c, projects = client
    r = c.post("/api/projects/method/case/status", json={"status": "review"})
    assert r.status_code == 200 and r.json()["status"] == "review"
    r = c.post("/api/projects/method/case/status", json={"status": "review"})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"
    # 任意跳转（回退 / 跳档）均可，note 拼进事件文案
    assert c.post("/api/projects/method/case/status", json={"status": "granted", "note": "已授权"}).status_code == 200
    assert c.post("/api/projects/method/case/status", json={"status": "intake"}).status_code == 200
    assert _messages(projects / "method") == [
        "case: status granted → intake",
        "case: status review → granted · 已授权",
        "case: status drafting → review",
    ]
    assert history.last_author(str(projects / "method")) == history.DEFAULT_AUTHOR
    assert cases.load_case(str(projects / "method")).status == "intake"
    assert c.get("/api/projects").json()[0]["case"]["status"] == "intake"
    assert c.post("/api/projects/method/case/status", json={"status": "nope"}).status_code == 422
    assert c.post("/api/projects/nope/case/status", json={"status": "review"}).status_code == 404


def test_status_event_does_not_pollute_content_save(client):
    c, projects = client
    assert c.post("/api/projects/method/case/status", json={"status": "review"}).status_code == 200
    log = history.log(str(projects / "method"))
    assert log[0]["added"] == 0 and log[0]["deleted"] == 0
    md = (projects / "method" / "content.md").read_text(encoding="utf-8")
    assert c.put("/api/projects/method/content", json={"content": md + "\n"}).status_code == 200
    assert history.commit(str(projects / "method"), "save") is None  # 正文 save 不带 case.json


# ---------------------------------------------------------------- off：标签 ----


def test_tags_crud_with_cascade(client):
    c, projects = client
    r = c.post("/api/tags", json={"name": " AI "})
    assert r.status_code == 201 and r.json() == {"tags": [{"name": "AI", "color": cases.TAG_COLORS[5]}]}
    assert c.post("/api/tags", json={"name": "AI"}).status_code == 409
    assert c.post("/api/tags", json={"name": ""}).status_code == 422
    assert c.post("/api/tags", json={"name": "加急", "color": "#ef4444"}).status_code == 201
    assert [t["name"] for t in c.get("/api/tags").json()["tags"]] == ["AI", "加急"]

    c.put("/api/projects/method/case", json={"tags": ["AI", "加急"]})
    c.put("/api/projects/system/case", json={"tags": ["加急", "手改"]})
    n_events = len(_messages(projects / "method"))

    # 改色不动 case.json
    r = c.put("/api/tags/AI", json={"color": "#000000"})
    assert r.status_code == 200 and r.json()["tags"][0] == {"name": "AI", "color": "#000000"}
    # 改名级联；重名 409；不存在 404
    r = c.put("/api/tags/加急", json={"name": "紧急"})
    assert r.status_code == 200 and [t["name"] for t in r.json()["tags"]] == ["AI", "紧急"]
    assert cases.load_case(str(projects / "method")).tags == ["AI", "紧急"]
    assert cases.load_case(str(projects / "system")).tags == ["紧急", "手改"]
    assert c.put("/api/tags/紧急", json={"name": "AI"}).status_code == 409
    assert c.put("/api/tags/紧急", json={"name": "紧急"}).status_code == 200  # 同名 = 只改自己
    assert c.put("/api/tags/nope", json={"color": "#fff"}).status_code == 404
    # 删除级联
    assert c.delete("/api/tags/紧急").status_code == 204
    assert c.delete("/api/tags/紧急").status_code == 404
    assert [t["name"] for t in c.get("/api/tags").json()["tags"]] == ["AI"]
    assert cases.load_case(str(projects / "method")).tags == ["AI"]
    assert cases.load_case(str(projects / "system")).tags == ["手改"]  # 字典外标签保留
    # 级联是机构元数据重写，不写 history 事件
    assert len(_messages(projects / "method")) == n_events


def test_retag_helpers():
    case = cases.Case(tags=["a", "b"])
    assert cases.retag(case, add=["b", "c", "c"], remove=["a"]).tags == ["b", "c"]
    assert cases.retag(case, add=["a"], remove=["a"]).tags == ["b"]
    assert cases.status_message("a", "b") == "case: status a → b"
    assert cases.status_message("a", "b", " 备注 ") == "case: status a → b ·  备注 "
    assert cases.patched_fields(cases.CasePatch(client="x", case_no="1")) == ["case_no", "client"]


# ---------------------------------------------------------------- off：列表状态 / 删除 / 退出 ----


def test_list_state_delete_and_leave_off(client):
    c, projects = client
    r = c.post("/api/projects/method/list-state", json={"state": "archived"})
    assert r.status_code == 200 and r.json() == {"pid": "method", "list_state": "archived"}
    rows = {r["id"]: r["list_state"] for r in c.get("/api/projects").json()}
    assert rows == {"method": "archived", "system": "active"}
    assert c.post("/api/projects/nope/list-state", json={"state": "archived"}).status_code == 404

    # 永久删除须先在回收站
    r = c.delete("/api/projects/method")
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"
    assert c.post("/api/projects/method/list-state", json={"state": "trashed"}).json()["list_state"] == "trashed"
    assert c.delete("/api/projects/method").status_code == 204
    assert not (projects / "method").exists()
    assert c.delete("/api/projects/method").status_code == 404
    assert [r["id"] for r in c.get("/api/projects").json()] == ["system"]
    assert cases.list_states("local") == {}  # 行已清
    # 单机没有成员关系
    r = c.post("/api/projects/system/leave")
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"


# ---------------------------------------------------------------- off：批量 ----


def test_bulk_mixed_results_off(client):
    c, projects = client
    r = c.post(
        "/api/projects/bulk", json={"pids": ["method", "nope", "system"], "action": "status", "status": "review"}
    )
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert [x["ok"] for x in res] == [True, False, True] and "nope" in res[1]["error"]
    assert cases.load_case(str(projects / "method")).status == "review"
    # 已是目标状态 ⇒ 幂等 ok，不再写事件
    n = len(_messages(projects / "method"))
    r = c.post("/api/projects/bulk", json={"pids": ["method"], "action": "status", "status": "review"})
    assert r.json()["results"] == [{"pid": "method", "ok": True}] and len(_messages(projects / "method")) == n

    r = c.post(
        "/api/projects/bulk",
        json={"pids": ["method", "system"], "action": "tags", "add_tags": ["AI"], "remove_tags": ["x"]},
    )
    assert all(x["ok"] for x in r.json()["results"])
    assert cases.load_case(str(projects / "system")).tags == ["AI"]
    assert _messages(projects / "system")[0] == "case: update tags"

    r = c.post("/api/projects/bulk", json={"pids": ["system"], "action": "owner", "owner_user_id": "u-1"})
    assert r.json()["results"][0]["ok"] and cases.load_case(str(projects / "system")).owner_user_id == "u-1"
    r = c.post("/api/projects/bulk", json={"pids": ["system"], "action": "owner"})  # 清空责任人
    assert r.json()["results"][0]["ok"] and cases.load_case(str(projects / "system")).owner_user_id is None

    r = c.post("/api/projects/bulk", json={"pids": ["method", "system"], "action": "list_state", "state": "archived"})
    assert all(x["ok"] for x in r.json()["results"])
    assert {r["id"]: r["list_state"] for r in c.get("/api/projects").json()} == {
        "method": "archived",
        "system": "archived",
    }
    # 缺参数 422；非法 action 422
    for bad in (
        {"pids": ["method"], "action": "status"},
        {"pids": ["method"], "action": "list_state"},
        {"pids": ["method"], "action": "tags"},
        {"pids": ["method"], "action": "rename"},
    ):
        assert c.post("/api/projects/bulk", json=bad).status_code == 422, bad


# ---------------------------------------------------------------- on：ACL ----


def _register(main, email, password="pw-123456"):
    c = TestClient(main.app)
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    return r.json()


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    assert c.post("/api/auth/cookie/login", data={"username": email, "password": password}).status_code == 204
    return c


def _team(main):
    """超管 boss；method 成员：owner2（第二个 owner）/ agent / editor / viewer；system 只有 boss 建的 ACL。"""
    users = {}
    for email in ("boss", "owner2", "agent", "editor", "viewer"):
        users[email] = _register(main, f"{email}@example.com")["id"]
    su = _login(main, "boss@example.com")
    for email, role in (("owner2", "owner"), ("agent", "agent"), ("editor", "editor"), ("viewer", "viewer")):
        r = su.put("/api/projects/method/members", json={"email": f"{email}@example.com", "role": role})
        assert r.status_code == 200, r.text
    clients = {e: _login(main, f"{e}@example.com") for e in ("owner2", "agent", "editor", "viewer")}
    clients["boss"] = su
    return users, clients


def test_on_write_routes_require_agent(on):
    main, projects = on
    users, c = _team(main)
    for who in ("viewer", "editor"):
        for r in (
            c[who].put("/api/projects/method/case", json={"client": "x"}),
            c[who].post("/api/projects/method/case/status", json={"status": "review"}),
            c[who].post("/api/projects/method/list-state", json={"state": "archived"}),
        ):
            assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden", r.text
        assert c[who].get("/api/projects/method/case").status_code == 200  # 读仍可
    assert c["agent"].put("/api/projects/method/case", json={"client": "甲方"}).status_code == 200
    r = c["agent"].post("/api/projects/method/case/status", json={"status": "review"})
    assert r.status_code == 200
    assert c["owner2"].post("/api/projects/method/case/status", json={"status": "final"}).status_code == 200
    assert c["boss"].post("/api/projects/method/case/status", json={"status": "filed"}).status_code == 200
    log = history.log(str(projects / "method"))
    assert [(v["message"], v["author"]) for v in log] == [
        ("case: status final → filed", "boss"),
        ("case: status review → final", "owner2"),
        ("case: status drafting → review", "agent"),
        ("case: update client", "agent"),
    ]
    assert c["viewer"].get("/api/projects").json()[0]["last_modified_by"] == "boss"
    # system 未授权：agent 连读都 403
    assert c["agent"].post("/api/projects/system/case/status", json={"status": "review"}).status_code == 403
    assert TestClient(main.app).put("/api/projects/method/case", json={"client": "x"}).status_code == 401


def test_on_tags_write_only_superuser(on):
    main, projects = on
    users, c = _team(main)
    for who in ("owner2", "agent", "viewer"):
        r = c[who].post("/api/tags", json={"name": "AI"})
        assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden"
        assert c[who].put("/api/tags/AI", json={"color": "#000"}).status_code == 403
        assert c[who].delete("/api/tags/AI").status_code == 403
        assert c[who].get("/api/tags").status_code == 200
    assert c["boss"].post("/api/tags", json={"name": "AI"}).status_code == 201
    assert c["agent"].put("/api/projects/method/case", json={"tags": ["AI"]}).status_code == 200
    assert c["boss"].put("/api/tags/AI", json={"name": "人工智能"}).status_code == 200
    assert c["viewer"].get("/api/projects/method/case").json()["tags"] == ["人工智能"]
    assert c["boss"].delete("/api/tags/人工智能").status_code == 204
    assert c["viewer"].get("/api/projects/method/case").json()["tags"] == []
    anon = TestClient(main.app)
    assert anon.get("/api/tags").status_code == 401
    assert anon.post("/api/tags", json={"name": "x"}).status_code == 401


def test_on_list_state_is_per_user(on):
    main, projects = on
    users, c = _team(main)
    assert c["agent"].post("/api/projects/method/list-state", json={"state": "archived"}).status_code == 200
    assert c["agent"].get("/api/projects").json()[0]["list_state"] == "archived"
    # A 归档不影响 B
    assert c["owner2"].get("/api/projects").json()[0]["list_state"] == "active"
    assert c["boss"].get("/api/projects").json()[0]["list_state"] == "active"
    assert cases.list_states(users["agent"]) == {"method": "archived"}
    assert c["agent"].post("/api/projects/method/list-state", json={"state": "active"}).status_code == 200
    assert cases.list_states(users["agent"]) == {}


def test_on_delete_owner_only_and_clears_acl(on):
    main, projects = on
    users, c = _team(main)
    from app.auth import acl

    assert c["agent"].delete("/api/projects/method").status_code == 403
    assert c["viewer"].delete("/api/projects/method").status_code == 403
    # owner 但未进回收站 ⇒ 409（回收站是本人视角：agent 的回收站不算）
    c["agent"].post("/api/projects/method/list-state", json={"state": "trashed"})
    assert c["owner2"].delete("/api/projects/method").status_code == 409
    assert c["owner2"].post("/api/projects/method/list-state", json={"state": "trashed"}).status_code == 200
    assert c["owner2"].post("/api/projects/method/share", json={"role": "viewer"}).status_code == 201
    assert c["owner2"].delete("/api/projects/method").status_code == 204
    assert not (projects / "method").exists()
    assert await_(acl.list_members("method")) == [] and await_(acl.list_share_links("method")) == []
    assert cases.list_states(users["agent"]) == {} and cases.list_states(users["owner2"]) == {}
    assert c["viewer"].get("/api/projects").json() == []
    assert c["owner2"].delete("/api/projects/method").status_code == 404  # ACL 行已清且案子已删 ⇒ 404 not_found（W5）
    # 超管天然 owner，仍须先进自己的回收站
    assert c["boss"].delete("/api/projects/system").status_code == 409
    c["boss"].post("/api/projects/system/list-state", json={"state": "trashed"})
    assert c["boss"].delete("/api/projects/system").status_code == 204
    assert c["boss"].get("/api/projects").json() == []


def await_(coro):
    import asyncio

    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def test_on_leave_non_owner_only(on):
    main, projects = on
    users, c = _team(main)
    r = c["owner2"].post("/api/projects/method/leave")
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"
    assert c["boss"].post("/api/projects/method/leave").status_code == 404  # 超管无 ACL 行：不是成员
    c["viewer"].post("/api/projects/method/list-state", json={"state": "archived"})
    assert c["viewer"].post("/api/projects/method/leave").status_code == 204
    assert c["viewer"].get("/api/projects/method/case").status_code == 403
    assert c["viewer"].get("/api/projects").json() == []
    assert cases.list_states(users["viewer"]) == {}
    assert {m["role"] for m in c["boss"].get("/api/projects/method/members").json()} == {"owner", "agent", "editor"}
    assert c["viewer"].post("/api/projects/method/leave").status_code == 403  # 已非成员：全局门槛拦下
    assert c["agent"].post("/api/projects/method/leave").status_code == 204


def test_on_bulk_checks_each_project(on):
    main, projects = on
    users, c = _team(main)
    # agent：method 有 agent 角色，system 无权限 ⇒ 混合结果，不回滚
    r = c["agent"].post(
        "/api/projects/bulk", json={"pids": ["method", "system", "nope"], "action": "status", "status": "review"}
    )
    res = r.json()["results"]
    assert res[0] == {"pid": "method", "ok": True}
    assert res[1]["ok"] is False and "权限不足" in res[1]["error"]
    assert res[2]["ok"] is False and "不存在" in res[2]["error"]  # 非成员 ∧ pid 不存在 ⇒ 404 not_found（W5）
    assert cases.load_case(str(projects / "system")).status == "drafting"
    # editor 全部 403
    r = c["editor"].post("/api/projects/bulk", json={"pids": ["method"], "action": "list_state", "state": "archived"})
    assert r.json()["results"][0]["ok"] is False
    # 超管全过；list_state 落在超管自己的视角
    r = c["boss"].post(
        "/api/projects/bulk", json={"pids": ["method", "system"], "action": "list_state", "state": "archived"}
    )
    assert all(x["ok"] for x in r.json()["results"])
    assert {row["id"]: row["list_state"] for row in c["boss"].get("/api/projects").json()} == {
        "method": "archived",
        "system": "archived",
    }
    assert c["agent"].get("/api/projects").json()[0]["list_state"] == "active"
    r = c["boss"].post(
        "/api/projects/bulk", json={"pids": ["method"], "action": "owner", "owner_user_id": users["agent"]}
    )
    assert r.json()["results"][0]["ok"]
    assert cases.load_case(str(projects / "method")).owner_user_id == users["agent"]
    assert (
        TestClient(main.app)
        .post("/api/projects/bulk", json={"pids": ["method"], "action": "status", "status": "review"})
        .status_code
        == 401
    )


def test_on_import_docx_sets_case_owner_and_acl(on):
    """Word 导入建案与新建案一致：case.owner_user_id = 导入者，ACL owner 行落库（非超管也能在列表里看到）。"""
    from tests.test_import import build_native_fixture

    main, projects = on
    users = {}
    for email in ("boss", "agent"):
        users[email] = _register(main, f"{email}@example.com")["id"]
    agent = _login(main, "agent@example.com")
    r = agent.post("/api/projects/import/docx", files={"file": ("imp.docx", build_native_fixture())})
    assert r.status_code == 201, r.text
    pid = r.json()["project"]["id"]
    assert cases.load_case(str(projects / pid)).owner_user_id == users["agent"]
    assert [row["id"] for row in agent.get("/api/projects").json()] == [pid]
    assert agent.get(f"/api/projects/{pid}").json()["role"] == "owner"


def test_save_case_atomic_write_no_tmp_residue(tmp_path):
    """R36-01：case.json 落盘走 tmp+os.replace——写完后不留 .tmp，内容可读。"""

    case = cases.default_case(str(tmp_path))
    cases.save_case(str(tmp_path), case)
    p = cases.case_path(str(tmp_path))
    assert json.loads(open(p, encoding="utf-8").read())["version"] == 1
    assert not os.path.exists(p + ".tmp")
    # 复写仍是原子替换
    cases.save_case(str(tmp_path), case.model_copy(update={"client": "甲公司"}))
    assert cases.load_case(str(tmp_path)).client == "甲公司"


def test_write_json_helper(tmp_path):
    """atomic.write_json：目录自动建、JSON 可读、无残留。"""
    from app import atomic

    p = str(tmp_path / "sub" / "dir" / "x.json")
    atomic.write_json(p, {"a": 1})
    assert json.loads(open(p, encoding="utf-8").read()) == {"a": 1}
    atomic.write_json(p, {"a": 2})
    assert json.loads(open(p, encoding="utf-8").read()) == {"a": 2}
    assert os.listdir(tmp_path / "sub" / "dir") == ["x.json"]


def test_case_file_lock_serializes_writers(tmp_path):
    """R93：case.json 的 load→mutate→save 包 studio_lock 后并发写方不丢更新。"""
    from concurrent.futures import ThreadPoolExecutor

    from app import atomic

    d = str(tmp_path)
    cases.save_case(d, cases.default_case(d))

    def add(i):
        with atomic.studio_lock(d, "case"):
            c = cases.load_case(d)
            c.deadlines.append(cases.Deadline(kind="check", due=f"2026-01-{(i % 28) + 1:02d}", note=f"n{i}"))
            cases.save_case(d, c)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(add, range(20)))
    assert len(cases.load_case(d).deadlines) == 20


def test_related_cases_round_trip_and_divisional_backlink(client):
    """W19 批7 ⑪c：related 经 PUT /case 落地持久化；parent_pid 建分案自动双向互链。"""
    c, projects = client
    r = c.put("/api/projects/method/case", json={"related": [{"pid": "sys", "kind": "associated", "note": "同族"}]})
    assert r.status_code == 200, r.text
    got = c.get("/api/projects/method/case").json()
    assert got["related"] == [{"pid": "sys", "kind": "associated", "note": "同族"}]
    # 未给 related 的 patch 不动既有关联
    r = c.put("/api/projects/method/case", json={"client": "丙方"})
    assert r.json()["related"][0]["pid"] == "sys"
    # 未知 kind / 空 pid 均 422
    assert c.put("/api/projects/method/case", json={"related": [{"pid": "x", "kind": "nope"}]}).status_code == 422
    assert c.put("/api/projects/method/case", json={"related": [{"pid": ""}]}).status_code == 422

    # 建分案：子案落 related(parent)，母案自动追加 related(divisional)
    r = c.post("/api/projects", json={"id": "div-1", "title": "分案", "parent_pid": "method"})
    assert r.status_code == 201, r.text
    rel_child = c.get("/api/projects/div-1/case").json()["related"]
    assert rel_child == [{"pid": "method", "kind": "parent", "note": ""}]
    rel_parent = c.get("/api/projects/method/case").json()["related"]
    assert {"pid": "div-1", "kind": "divisional", "note": ""} in rel_parent
    # 第二件分案：去重按 pid+kind，母案关联表单调增长
    assert c.post("/api/projects", json={"id": "div-2", "parent_pid": "method"}).status_code == 201
    rel_parent = c.get("/api/projects/method/case").json()["related"]
    assert [r["pid"] for r in rel_parent if r["kind"] == "divisional"] == ["div-1", "div-2"]
    # 自引用 422；母案不存在 404（且不产生子案目录）
    assert c.post("/api/projects", json={"id": "self-p", "parent_pid": "self-p"}).status_code == 422
    assert c.post("/api/projects", json={"id": "orphan", "parent_pid": "nope"}).status_code == 404
    assert not (projects / "orphan").exists()
