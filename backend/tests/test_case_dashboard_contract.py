# -*- coding: utf-8 -*-
"""W4-A prep 骨架（docs/plan/13-w4a-case-dashboard-design.md §9）：case.json 默认值 / 零漂移边界 /
GET /api/projects 向后兼容扩展 / 501 占位形状 / ACL 门槛 / history 事件通道 / 列表状态表。
单元 A1 的功能测试见 test_cases.py。
"""

import importlib
import os
import shutil
import sys
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.domain import cases, history

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"


def _reload_app():
    import app.auth
    import app.auth.router
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
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app()
    yield main
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app()


def _snapshot(d):
    out = {}
    for name in ("content.md", "studio.json", "project.json"):
        p = os.path.join(d, name)
        out[name] = open(p, "rb").read() if os.path.isfile(p) else None
    return out


# ---------------------------------------------------------------- 数据层 ----


def test_default_case_uses_dir_mtime_and_drafting(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    os.utime(d, (1_700_000_000, 1_700_000_000))
    c = cases.default_case(str(d))
    assert c.status == "drafting" and c.kind == "invention" and c.archived is False
    assert c.dates.opened == date.fromtimestamp(1_700_000_000).isoformat()
    assert c.case_no == "" and c.tags == [] and c.deadlines == [] and c.owner_user_id is None


def test_ensure_case_writes_once_and_load_without_file_does_not_write(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    assert not cases.has_case(str(d))
    cases.load_case(str(d))
    assert not cases.has_case(str(d))  # load 不落盘
    c1 = cases.ensure_case(str(d))
    assert cases.has_case(str(d))
    c2 = cases.ensure_case(str(d))
    assert c1 == c2


def test_case_schema_validation():
    with pytest.raises(ValueError):
        cases.Case.model_validate({"status": "unknown"})
    with pytest.raises(ValueError):
        cases.Case.model_validate({"dates": {"opened": "2026/01/01"}})
    with pytest.raises(ValueError):
        cases.Deadline.model_validate({"kind": "filing"})
    c = cases.Case.model_validate({"deadlines": [{"kind": "filing", "due": "2026-03-01"}]})
    assert c.deadlines[0].note == "" and c.deadlines[0].done is False
    assert set(cases.STATUSES) == set(cases.CaseStatus.__args__) and len(cases.STATUSES) == 10


def test_apply_patch_only_touches_given_fields():
    c = cases.Case(case_no="P-1", client="甲方", tags=["AI"])
    out = cases.apply_patch(c, cases.CasePatch(client="乙方"))
    assert out.client == "乙方" and out.case_no == "P-1" and out.tags == ["AI"]
    out = cases.apply_patch(c, cases.CasePatch(owner_user_id=None))
    assert out.owner_user_id is None
    assert "status" not in cases.CasePatch.model_fields  # 状态只走 POST /case/status


def test_deadline_levels_and_next_deadline():
    today = date(2026, 9, 5)
    assert cases.deadline_level(-1) == "overdue"
    assert cases.deadline_level(0) == "red" and cases.deadline_level(3) == "red"
    assert cases.deadline_level(4) == "yellow" and cases.deadline_level(14) == "yellow"
    assert cases.deadline_level(15) == "normal"
    c = cases.Case(
        deadlines=[
            cases.Deadline(kind="filing", due="2026-09-30"),
            cases.Deadline(kind="client_review", due="2026-09-07"),
            cases.Deadline(kind="old", due="2026-01-01", done=True),
        ]
    )
    n = cases.next_deadline(c, today)
    assert n == {"kind": "client_review", "due": "2026-09-07", "note": "", "days_left": 2, "level": "red"}
    assert cases.next_deadline(cases.Case(), today) is None
    assert cases.summary(cases.Case(), today)["next_deadline"] is None


def test_tags_file_roundtrip(tmp_path):
    assert cases.load_tags(str(tmp_path)) == []
    cases.save_tags([cases.Tag(name="AI"), cases.Tag(name="加急", color="#ef4444")], str(tmp_path))
    p = tmp_path / ".studio" / "tags.json"
    assert p.is_file()
    assert [t.model_dump() for t in cases.load_tags(str(tmp_path))] == [
        {"name": "AI", "color": cases.TAG_COLORS[5]},
        {"name": "加急", "color": "#ef4444"},
    ]
    with pytest.raises(ValueError):
        cases.Tag(name="  ")


def test_list_state_table(tmp_path):
    db = str(tmp_path / "studio.db")
    assert cases.list_states("u1", db) == {}
    assert cases.set_state("u1", "method", "archived", db) == "archived"
    cases.set_state("u1", "system", "trashed", db)
    cases.set_state("u2", "method", "trashed", db)
    assert cases.list_states("u1", db) == {"method": "archived", "system": "trashed"}
    assert cases.get_state("u2", "method", db) == "trashed" and cases.get_state("u2", "system", db) == "active"
    cases.set_state("u1", "method", "active", db)
    assert cases.list_states("u1", db) == {"system": "trashed"}
    cases.forget_project("system", db)
    assert cases.list_states("u1", db) == {}
    with pytest.raises(cases.CaseError):
        cases.set_state("u1", "method", "gone", db)
    assert cases.user_key(None) == "local"


# ---------------------------------------------------------------- history 事件通道 ----


def test_commit_case_is_separate_from_save(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("# t\n", encoding="utf-8")
    assert history.commit(str(d), "save") is not None
    assert history.commit_case(str(d), "case: status") is None  # 无 case.json
    cases.save_case(str(d), cases.Case(status="review"))
    assert history.commit(str(d), "save") is None  # 台账不混进 save
    sha = history.commit_case(str(d), "case: status drafting → review", author="alice")
    assert sha is not None and history.commit_case(str(d), "case: again") is None
    log = history.log(str(d))
    assert log[0]["message"] == "case: status drafting → review" and log[0]["author"] == "alice"
    assert log[0]["added"] == 0 and log[0]["deleted"] == 0 and len(log) == 2
    assert history.last_author(str(d)) == "alice"


def test_ensure_repo_upgrades_old_exclude(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    (d / "content.md").write_text("# t\n", encoding="utf-8")
    history.commit(str(d), "save")
    exclude = os.path.join(history.git_dir(str(d)), "info", "exclude")
    with open(exclude, "w", encoding="utf-8") as f:
        f.write("*\n!content.md\n!docs/\n!docs/**\n")
    cases.save_case(str(d), cases.Case())
    assert history.commit_case(str(d), "case: init") is not None
    assert "!case.json" in open(exclude, encoding="utf-8").read()


# ---------------------------------------------------------------- 路由（off） ----


def test_list_projects_backward_compatible_and_generates_case_json(client):
    c, projects = client
    before = {pid: _snapshot(projects / pid) for pid in ("method", "system")}
    rows = c.get("/api/projects").json()
    assert [r["id"] for r in rows] == ["method", "system"]
    for r in rows:
        assert {"id", "title", "mtime"} <= set(r)  # 旧字段不动
        assert set(r) == {
            "id",
            "title",
            "mtime",
            "case",
            "owner",
            "collaborators",
            "last_modified_by",
            "my_role",
            "list_state",
        }
        assert r["case"]["status"] == "drafting" and r["case"]["next_deadline"] is None
        assert r["owner"] is None and r["collaborators"] == [] and r["my_role"] is None and r["list_state"] == "active"
        assert (projects / r["id"] / "case.json").is_file()
        assert _snapshot(projects / r["id"]) == before[r["id"]]  # 不改 content.md / studio.json / project.json
    assert cases.load_case(str(projects / "method")).dates.opened is not None


def test_get_case_and_project_detail_include_case(client):
    c, projects = client
    r = c.get("/api/projects/method/case")
    assert r.status_code == 200 and r.json()["status"] == "drafting" and r.json()["next_deadline"] is None
    assert c.get("/api/projects/method").json()["case"]["status"] == "drafting"
    assert c.get("/api/projects/nope/case").status_code == 404
    assert c.get("/api/tags").json() == {"tags": []}


def test_create_project_writes_case(client):
    c, projects = client
    r = c.post(
        "/api/projects",
        json={
            "id": "new1",
            "title": "一种新方法",
            "case": {"case_no": "ZL-2026-001", "client": "甲方", "tags": ["AI"]},
        },
    )
    assert r.status_code == 201, r.text
    case = r.json()["case"]
    assert case["case_no"] == "ZL-2026-001" and case["client"] == "甲方" and case["status"] == "drafting"
    assert (projects / "new1" / "case.json").is_file()
    r = c.post("/api/projects", json={"id": "new2", "title": "无台账"})
    assert r.status_code == 201 and r.json()["case"]["case_no"] == ""


def test_case_writes_validate_body(client):
    """写路由的请求体校验（行为覆盖在 tests/test_cases.py）：非法状态 / 列表状态 422。"""
    c, _ = client
    assert c.post("/api/projects/method/case/status", json={"status": "nope"}).status_code == 422
    assert c.post("/api/projects/method/list-state", json={"state": "gone"}).status_code == 422


# ---------------------------------------------------------------- ACL（on） ----


def _register(c, email, password="pw-123456"):
    r = c.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    assert c.post("/api/auth/cookie/login", data={"username": email, "password": password}).status_code == 204
    return c


def test_on_case_writes_need_agent(on):
    su = TestClient(on.app)
    _register(su, "boss@example.com")
    su = _login(on, "boss@example.com")
    members = (("agent@example.com", "agent"), ("editor@example.com", "editor"), ("viewer@example.com", "viewer"))
    for email, role in members:
        _register(TestClient(on.app), email)
        assert su.put("/api/projects/method/members", json={"email": email, "role": role}).status_code == 200
    agent, editor, viewer = (_login(on, e) for e in ("agent@example.com", "editor@example.com", "viewer@example.com"))

    assert viewer.get("/api/projects/method/case").status_code == 200  # 读：viewer 可见
    assert viewer.get("/api/projects/method").status_code == 200  # 打开工作台 ⇒ access.touch
    rows = viewer.get("/api/projects").json()
    assert rows[0]["my_role"] == "viewer"
    assert {m["role"] for m in rows[0]["collaborators"]} == {"agent", "editor", "viewer"}
    assert [r["id"] for r in rows] == ["method"]  # system 未授权不可见
    # W4 集成：头像行带 B 的访问 / 在线数据——viewer 刚开过工作台有 last_seen，其余人没有；无人连协同房间 ⇒ 全部离线
    by_role = {m["role"]: m for m in rows[0]["collaborators"]}
    assert by_role["viewer"]["last_seen"] and by_role["agent"]["last_seen"] is None
    assert all(m["online"] is False for m in by_role.values())
    # W11-5：成员行带账户头像色（未选 = ''），owner 不经 ACL 直查——superuser 不在成员表里台账也要显姓名 / 同色
    assert all(m["avatar_color"] == "" for m in by_role.values())
    assert su.put("/api/users/me", json={"avatar_color": "purple"}).status_code == 200
    me = su.get("/api/users/me").json()
    assert su.put("/api/projects/method/case", json={"owner_user_id": me["id"]}).status_code == 200
    row = viewer.get("/api/projects").json()[0]
    assert me["id"] not in {m["user_id"] for m in row["collaborators"]}
    assert row["owner"] == {
        "user_id": me["id"],
        "email": "boss@example.com",
        "display_name": me["display_name"],
        "avatar_color": "purple",
    }
    # 已删 / 非法账号 ⇒ owner=null（前端显「已离开的成员」，不露 id）
    gone = "00000000-0000-4000-8000-000000000001"
    assert su.put("/api/projects/method/case", json={"owner_user_id": gone}).status_code == 200
    assert viewer.get("/api/projects").json()[0]["owner"] is None

    body = {"status": "review"}
    for c in (viewer, editor):
        r = c.post("/api/projects/method/case/status", json=body)
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["kind"] == "forbidden" and r.json()["detail"]["detail"] == "agent"
        r = c.put("/api/projects/method/case", json={"client": "x"})
        assert r.status_code == 403 and r.json()["detail"]["detail"] == "agent"
        r = c.post("/api/projects/method/list-state", json={"state": "archived"})
        assert r.status_code == 403 and r.json()["detail"]["detail"] == "agent"
    assert agent.post("/api/projects/method/case/status", json=body).status_code == 200  # agent 过门槛
    assert su.post("/api/projects/method/case/status", json={"status": "filed"}).status_code == 200  # 超管
    assert agent.delete("/api/projects/method").status_code == 403  # 永久删除仅 owner
    assert su.delete("/api/projects/method").status_code == 409  # owner 门槛过了，但未先进回收站
    assert viewer.post("/api/projects/method/leave").status_code == 204  # 退出：viewer 也能到达路由
    assert TestClient(on.app).get("/api/projects/method/case").status_code == 401
    # 面板「新建案卷」：匿名 401（否则会产出无 owner 行的案子，任何人都进不去）；登录者 ⇒ owner + attachments/
    projects = os.environ["PATENT_PROJECTS_DIR"]
    r = TestClient(on.app).post("/api/projects", json={"id": "anon", "title": "x"})
    assert r.status_code == 401 and not os.path.isdir(os.path.join(projects, "anon"))
    assert editor.post("/api/projects", json={"id": "mine", "title": "x"}).status_code == 201
    assert os.path.isdir(os.path.join(projects, "mine", "attachments"))
    assert editor.get("/api/projects/mine").json()["role"] == "owner"
