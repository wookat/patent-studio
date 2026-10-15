# -*- coding: utf-8 -*-
"""W4-E 骨架锁（docs/plan/17）：E1 递交包 / E2 账户·管理 / E3 MCP 工具三单元的占位路由形状、User 加列迁移、
工具名表与注册顺序、理解实验题库与判分器。单元实现后把对应 501 断言改成正式契约测试（各自的 test_*.py）。"""

import asyncio
import importlib
import json
import os
import sqlite3
import sys
import uuid

import test_legacy_auth as test_auth
from fastapi.testclient import TestClient
from mcp.client.client import Client
from test_legacy_auth import _assert_501, _login, _register

from app.auth import required_role
from app.mcp import schemas

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- E1 ----


def test_e1_deliver_manifest_and_role(client):
    """E1 已落地（详见 test_deliver.py）：GET 清单 200 六项；未打包时 bundle.zip 404。"""
    c, _ = client
    from app.routes.deliver import KINDS

    r = c.get("/api/projects/method/deliver")
    assert r.status_code == 200
    assert [it["kind"] for it in r.json()["items"]] == list(KINDS)
    assert c.get("/api/projects/method/deliver/bundle.zip").status_code == 404
    assert required_role("POST", "/api/projects/{pid}/deliver/bundle") == "viewer"  # 与 /build /export/xml 同门槛
    assert required_role("GET", "/api/projects/{pid}/deliver") == "viewer"


def test_e1_manifest_kinds_match_urls():
    from app.routes.deliver import KINDS, URLS, ExportEntry

    assert set(KINDS) == set(URLS) == set(ExportEntry.model_fields["kind"].annotation.__args__)


# ---------------------------------------------------------------- E2 ----


def test_e2_off_placeholders(client):
    c, _ = client
    assert c.get("/api/users/me").status_code == 204  # off：无用户，保持 C1 行为
    _assert_501(c.put("/api/users/me", json={"display_name": "x"}), "E2-account-admin")
    _assert_501(c.get("/api/admin/users"), "E2-account-admin")
    _assert_501(c.put("/api/admin/users/abc", json={"is_active": False}), "E2-account-admin")
    # E2 落地：机构名不依赖账号（.studio/org.json），off 也可读写（test_admin.py 锁细节）
    assert c.get("/api/admin/org").json() == {"name": ""}
    assert c.put("/api/admin/org", json={"name": "某某知识产权代理"}).json() == {"name": "某某知识产权代理"}
    assert "app.auth.db" not in sys.modules  # off 下新路由不得把 DB 拉进来


def test_e2_user_read_has_profile_fields_and_login_stamps(on):
    from app.auth.db import SessionLocal, User

    anon = TestClient(on.app)
    u = _register(anon, "su@example.com", display_name="张代理")
    assert u["title"] == "" and u["avatar_color"] == ""
    c = _login(on, "su@example.com")
    assert c.get("/api/users/me").json()["display_name"] == "张代理"

    async def stamp():
        async with SessionLocal() as s:
            return (await s.get(User, uuid.UUID(u["id"]))).last_login_at

    assert asyncio.run(stamp()) is not None  # on_after_login 写最近登录


def test_e2_init_db_adds_columns_to_legacy_user_table(tmp_path, monkeypatch):
    """R6 时期的 studio.db（user 表无 title / avatar_color / last_login_at）→ init_db 补列且不动旧行。"""
    from app.auth.models import USER_ADDED_COLUMNS

    db = tmp_path / "studio.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE user (id CHAR(32) NOT NULL PRIMARY KEY, email VARCHAR(320) NOT NULL UNIQUE,"
        " hashed_password VARCHAR(1024) NOT NULL, is_active BOOLEAN NOT NULL, is_superuser BOOLEAN NOT NULL,"
        " is_verified BOOLEAN NOT NULL, display_name VARCHAR(64) NOT NULL);"
        "INSERT INTO user VALUES ('11111111111111111111111111111111', 'old@example.com', 'h', 1, 1, 0, '老用户');"
    )
    con.commit()
    con.close()
    (tmp_path / "projects").mkdir()
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(tmp_path / "projects"))  # DB_PATH = 同级 studio.db
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", test_auth.SECRET)
    test_auth._reload_app()
    from app.auth import db as auth_db

    asyncio.run(auth_db.init_db())
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(user)")}
    assert {n for n, _ in USER_ADDED_COLUMNS} <= cols
    row = con.execute("SELECT display_name, title, avatar_color, last_login_at FROM user").fetchone()
    con.close()
    assert row == ("老用户", "", "", None)
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    test_auth._reload_app()


def test_e2_inactive_user_cannot_login_and_session_dies(on):
    """禁用 = is_active=false：fastapi-users 登录 400 LOGIN_BAD_CREDENTIALS；
    已发 cookie 下一请求 401（read_cookie_user 过滤）。"""
    from app.auth.db import SessionLocal, User

    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    u = _register(anon, "staff@example.com")
    c = _login(on, "staff@example.com")
    assert c.get("/api/users/me").status_code == 200

    async def disable():
        async with SessionLocal() as s:
            user = await s.get(User, uuid.UUID(u["id"]))
            user.is_active = False
            await s.commit()

    asyncio.run(disable())
    assert c.get("/api/users/me").status_code == 401
    r = TestClient(on.app).post(
        "/api/auth/cookie/login", data={"username": "staff@example.com", "password": "pw-123456"}
    )
    assert r.status_code == 400


# ---------------------------------------------------------------- E3 ----


def test_e3_tool_names_registration_order_and_no_duplicates():
    from app.mcp import server as mcp_server

    names = [t.name for t in asyncio.run(mcp_server.server.list_tools())]
    assert names == list(schemas.TOOL_NAMES)
    assert len(set(names)) == len(names) == 74
    assert names.count("list_figures") == 1  # 附图三工具只在 tools_figures 注册一次


def test_e3_tools_implemented_and_missing_pid_is_not_found(tmp_path, monkeypatch):
    """stdio 客户端调 9 个 E3 工具：全部已实现（不再是 not_implemented 占位）；不存在的 pid → not_found。
    契约细节见 test_mcp_w4.py。"""
    import test_mcp

    projects = test_mcp._projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)

    async def run():
        out = {}
        async with Client(test_mcp._stdio_params(projects)) as c:
            for name, args in (
                ("get_case", {"pid": "method"}),
                ("set_case_status", {"pid": "method", "status": "filed"}),
                ("list_attachments", {"pid": "method"}),
                ("get_claim_tree", {"pid": "method"}),
                ("get_support_map", {"pid": "method"}),
                ("get_figures", {"pid": "method"}),
                ("get_terms", {"pid": "method"}),
                ("context_pack", {"pid": "method", "claim_id": "1"}),
            ):
                out[name] = await c.call_tool(name, args)
            out["read_attachment_text"] = test_mcp._tool_error(
                await c.call_tool("read_attachment_text", {"pid": "method", "name": "x.docx"})
            )
            out["missing"] = test_mcp._tool_error(await c.call_tool("get_claim_tree", {"pid": "nope"}))
            out["figs"] = (await c.call_tool("list_figures", {"pid": "method"})).structured_content
        return out

    out = asyncio.run(run())
    for name in schemas.TOOL_NAMES[19:28]:  # W4-E 9 件（W16 图源 4 件在其前；其后为批1 生命周期面，另测）
        if name == "read_attachment_text":
            assert out[name]["kind"] == "not_found"  # 附件不存在，不是 not_implemented
        else:
            assert not out[name].is_error and out[name].structured_content is not None, name
    assert out["missing"]["kind"] == "not_found"
    assert len(out["figs"]["figures"]) == 3  # 搬家后附图工具行为不变


def test_e3_context_pack_schema_fields():
    fields = set(schemas.ContextPack.model_fields)
    assert fields == {"pid", "claim", "chain", "support", "figures", "terms", "comments", "issues", "truncated"}
    assert set(schemas.ClaimNode.model_fields) >= {"num", "kind", "refs", "line", "text", "children"}


def test_e3_eval_bank_and_grader():
    sys.path.insert(0, os.path.join(BACKEND, "scripts"))
    mcp_eval = importlib.import_module("mcp_eval")
    bank = mcp_eval.load_questions()
    mcp_eval.self_test()
    assert [c["pid"] for c in bank["cases"]] == ["method", "system"]
    types = {q["type"] for c in bank["cases"] for q in c["questions"]}
    assert types == {"dependency", "terminology", "support", "figure_marker", "defect"}
    assert mcp_eval.main(["--grade-only"]) == 0
    assert set(mcp_eval.SEMANTIC) <= set(schemas.TOOL_NAMES)
    with open(os.path.join(BACKEND, "scripts", "mcp_eval_questions.json"), encoding="utf-8") as f:
        assert json.load(f)["version"] == 1
