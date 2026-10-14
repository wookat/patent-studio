# -*- coding: utf-8 -*-
"""R6 账号地基（docs/plan/07 §3–4.1）。off 模式契约 + on 模式（monkeypatch env + tmp studio.db）。"""

import importlib
import os
import shutil
import sys
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth import ROLE_RANK, required_role, role_at_least

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SECRET = "test-secret-not-for-production-32bytes+"


def _reload_app():
    """按依赖顺序重载：config → 丢弃 auth 子模块（on 时由 router 按新 DB_PATH 重新 import）→ auth 包 → router → main。

    子模块要同时从 sys.modules 与包属性删掉：否则 `from app.auth import acl` 命中旧属性，engine 仍指向上个 tmp 的 db。
    """
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
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    return projects


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app()
    return TestClient(main.app), tmp_path


@pytest.fixture()
def on(tmp_path, monkeypatch):
    """AUTH=on：tmp PROJECTS_DIR + 同级 studio.db；用完恢复 off 状态的模块，后续测试文件不受影响。"""
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app()
    yield main
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app()


def _assert_501(r, unit="C1-auth"):
    assert r.status_code == 501
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"}
    assert d["kind"] == "not_implemented" and d["detail"] == unit


def test_off_is_default_and_creates_no_db(client):
    c, tmp = client
    from app import config

    assert config.AUTH_ON is False
    assert config.DB_PATH == str(tmp / "studio.db")
    assert c.get("/api/health").json()["ok"] is True
    assert c.get("/api/projects/method").status_code == 200
    assert not os.path.exists(config.DB_PATH)
    assert "fastapi_users" not in sys.modules or "app.auth.db" not in sys.modules


def test_off_me_is_204_no_user(client):
    c, _ = client
    r = c.get("/api/users/me")
    assert r.status_code == 204
    assert r.content == b""


def test_off_auth_routes_are_501_with_error_shape(client):
    c, _ = client
    _assert_501(c.post("/api/auth/register", json={"email": "a@b.cn", "password": "x"}))
    _assert_501(c.post("/api/auth/cookie/login", data={"username": "a@b.cn", "password": "x"}))
    _assert_501(c.get("/api/projects/method/members"))
    _assert_501(c.post("/api/projects/method/share", json={"role": "viewer"}))
    _assert_501(c.post("/api/share/tok/accept"))


def test_off_global_dependency_adds_no_openapi_params(client):
    c, _ = client
    spec = c.get("/openapi.json").json()
    params = spec["paths"]["/api/projects/{pid}/content"]["get"].get("parameters", [])
    assert [p["name"] for p in params] == ["pid"]


def test_roles():
    assert ROLE_RANK["owner"] > ROLE_RANK["agent"] > ROLE_RANK["editor"] > ROLE_RANK["viewer"]
    assert role_at_least("agent", "editor") and not role_at_least("viewer", "editor")
    assert not role_at_least(None, "viewer")
    assert required_role("GET", "/api/projects/{pid}/content") == "viewer"
    assert required_role("PUT", "/api/projects/{pid}/content") == "reviewer"  # W4-B：正文校验在 check_source_write
    assert required_role("PUT", "/api/projects/{pid}/settings") == "editor"
    assert required_role("POST", "/api/projects/{pid}/comments") == "viewer"
    assert required_role("POST", "/api/projects/{pid}/critic") == "viewer"  # reviewer 回读自己的修订标记
    assert required_role("PUT", "/api/projects/{pid}/members") == "owner"
    assert required_role("GET", "/api/projects/{pid}/case") == "viewer"
    assert required_role("PUT", "/api/projects/{pid}/case") == "agent"
    assert required_role("POST", "/api/projects/{pid}/list-state") == "agent"


# ---------------------------------------------------------------- on 模式 ----


def _register(c, email, password="pw-123456", display_name=""):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": display_name})
    assert r.status_code == 201, r.text
    return r.json()


def _login(main, email, password="pw-123456"):
    """独立 TestClient = 独立 cookie jar（多用户并行）。"""
    c = TestClient(main.app)
    r = c.post("/api/auth/cookie/login", data={"username": email, "password": password})
    assert r.status_code == 204, r.text
    assert r.cookies.get("studio_session")
    return c


def test_on_missing_secret_fails_at_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.delenv("PATENT_STUDIO_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="PATENT_STUDIO_SECRET"):
        _reload_app()
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    _reload_app()


def test_on_register_invalid_email_is_chinese_validation_detail(on):
    """保留域名 / 非邮箱 → 422，detail 与结构错误同形且 message 为中文（不透出 email-validator 英文原文）。"""
    anon = TestClient(on.app)
    for email in ("qa@r3.test", "not-an-email"):
        r = anon.post("/api/auth/register", json={"email": email, "password": "pw-123456"})
        assert r.status_code == 422, r.text
        d = r.json()["detail"]
        assert set(d) == {"kind", "message", "line", "detail"}
        assert d["kind"] == "validation" and d["message"].startswith("邮箱格式不正确")
        assert isinstance(d["detail"], list) and d["detail"][0]["loc"][-1] == "email"
    r = anon.post("/api/auth/register", json={"password": "pw-123456"})
    assert r.status_code == 422 and r.json()["detail"]["message"] == "缺少字段：邮箱"


def test_on_register_login_me_change_password_logout(on):
    from app import config

    anon = TestClient(on.app)
    assert anon.get("/api/users/me").status_code == 401
    assert anon.get("/api/projects/method").status_code == 401
    assert anon.get("/api/projects/method").json()["detail"]["kind"] == "auth"
    assert anon.get("/api/health").status_code == 200  # 无 pid 路由不校验

    u = _register(anon, "boss@example.com", display_name="老板")
    assert set(u) == {"id", "email", "display_name", "is_superuser", "title", "avatar_color"}  # W4-E E2 加 2 字段
    assert u["is_superuser"] is True  # 第一个用户
    assert os.path.exists(config.DB_PATH)
    assert _register(anon, "second@example.com")["is_superuser"] is False

    bad = anon.post("/api/auth/cookie/login", data={"username": "boss@example.com", "password": "wrong"})
    assert bad.status_code == 400

    c = _login(on, "boss@example.com")
    me = c.get("/api/users/me")
    assert me.status_code == 200 and me.json()["email"] == "boss@example.com" and me.json()["display_name"] == "老板"

    # fastapi-users 原生 PATCH 已下线（W4-E）：改密只走 PUT + 旧密码核对
    assert c.patch("/api/users/me", json={"password": "new-pass-789"}).status_code == 405
    r = c.put(
        "/api/users/me", json={"password": {"current": "pw-123456", "new": "new-pass-789"}, "display_name": "Boss"}
    )
    assert r.status_code == 200 and r.json()["display_name"] == "Boss"
    # R71-01：改密后旧会话立即失效（JWT iat 早于 password_changed_at）
    time.sleep(1.05)  # iat 秒精度：等过签发秒，保证判定确定性
    assert c.get("/api/users/me").status_code == 401
    assert c.post("/api/auth/cookie/logout").status_code == 401
    assert (
        TestClient(on.app)
        .post("/api/auth/cookie/login", data={"username": "boss@example.com", "password": "pw-123456"})
        .status_code
        == 400
    )
    c2 = _login(on, "boss@example.com", "new-pass-789")
    assert c2.get("/api/users/me").status_code == 200


def test_on_acl_roles_and_members(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")  # superuser
    _register(anon, "owner@example.com")
    _register(anon, "viewer@example.com")
    _register(anon, "stranger@example.com")
    su, owner, viewer, stranger = (_login(on, f"{n}@example.com") for n in ("su", "owner", "viewer", "stranger"))

    # 切到 on 前已有的案子无 ACL：superuser 可见并可指派 owner；其他人 403
    assert su.get("/api/projects/method").status_code == 200
    r = owner.get("/api/projects/method")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden"
    assert owner.get("/api/projects/method/members").status_code == 403
    r = su.put("/api/projects/method/members", json={"email": "owner@example.com", "role": "owner"})
    assert r.status_code == 200, r.text
    assert r.json() == [
        {
            "user_id": r.json()[0]["user_id"],
            "email": "owner@example.com",
            "display_name": "",
            "avatar_color": "",
            "role": "owner",
        }
    ]

    # owner 读写 / 管成员；viewer 读可写不可；stranger 一律 403
    assert owner.get("/api/projects/method/content").status_code == 200
    assert owner.put("/api/projects/method/content", json={"content": "# 新标题\n\n## 摘要\n\nx"}).status_code == 200
    r = owner.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert r.status_code == 200 and [m["role"] for m in r.json()] == ["owner", "viewer"]
    assert viewer.get("/api/projects/method/content").status_code == 200
    assert viewer.get("/api/projects/method").json()["role"] == "viewer"
    assert owner.get("/api/projects/method").json()["role"] == "owner"
    assert su.get("/api/projects/method").json()["role"] == "owner"
    r = viewer.put("/api/projects/method/content", json={"content": "# 改"})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"  # W4-B：源文档写入门槛 reviewer
    # viewer 可预览：构建 / lint 只渲染不改源（不走 403），且源码不变
    before = viewer.get("/api/projects/method/content").json()["content"]
    assert viewer.post("/api/projects/method/lint", json={"content": "# x\n\n## 摘要\n\ny"}).status_code == 200
    body = {"pdf": False, "content": "# x\n\n## 摘要\n\ny"}
    assert viewer.post("/api/projects/method/build", json=body).status_code == 200
    assert viewer.get("/api/projects/method/content").json()["content"] == before
    assert viewer.put("/api/projects/method/docs/claims", json={"content": "1. 改"}).status_code == 403
    assert viewer.post("/api/projects/method/blocks", json={}).status_code == 403
    assert viewer.get("/api/projects/method/members").status_code == 403
    assert viewer.post("/api/projects/method/comments", json={"anchor": {}, "body": "x"}).status_code != 403
    assert stranger.get("/api/projects/method/content").status_code == 403
    assert stranger.post("/api/projects/method/build", json={"pdf": False}).status_code == 403

    # 未注册邮箱 ⇒ pending 邀请 201（W4-B D7）；非法角色 422；不能拿掉最后一个 owner（409）
    def put_member(email, role):
        return owner.put("/api/projects/method/members", json={"email": email, "role": role}).status_code

    assert put_member("nobody@example.com", "viewer") == 201
    assert put_member("nobody@example.com", "owner") == 422
    assert [i["email"] for i in owner.get("/api/projects/method/invites").json()] == ["nobody@example.com"]
    assert put_member("viewer@example.com", "god") == 422
    assert put_member("owner@example.com", "editor") == 409
    owner_id = owner.get("/api/users/me").json()["id"]
    assert owner.delete(f"/api/projects/method/members/{owner_id}").status_code == 409
    viewer_id = viewer.get("/api/users/me").json()["id"]
    r = owner.delete(f"/api/projects/method/members/{viewer_id}")
    assert r.status_code == 200 and [m["role"] for m in r.json()] == ["owner"]
    assert viewer.get("/api/projects/method/content").status_code == 403
    assert owner.delete(f"/api/projects/method/members/{viewer_id}").status_code == 404


def test_on_share_links_accept_and_expiry(on):
    from app.auth import acl

    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "guest@example.com")
    su, guest = _login(on, "su@example.com"), _login(on, "guest@example.com")

    assert TestClient(on.app).post("/api/share/whatever/accept").status_code == 401
    assert su.post("/api/projects/method/share", json={"role": "owner"}).status_code == 422
    assert su.post("/api/projects/method/share", json={"role": "viewer", "expires_in_days": 0}).status_code == 422

    r = su.post("/api/projects/method/share", json={"role": "editor", "expires_in_days": 7})
    assert r.status_code == 201
    link = r.json()
    assert set(link) == {"token", "role", "expires_at", "url", "created_at", "accepted_by"}
    assert link["url"].endswith(f"/#/share/{link['token']}") and link["expires_at"] is not None
    # 站点前缀取浏览器实际访问地址（经 Vite 代理 / 隧道时 Host 已被改写为后端地址）：Origin → Referer → X-Forwarded-*
    body = {"role": "viewer", "expires_in_days": 7}
    for headers, prefix in (
        ({"Origin": "https://patent.example.com"}, "https://patent.example.com/#/share/"),
        ({"Referer": "https://ref.example.com/#/method"}, "https://ref.example.com/#/share/"),
        ({"X-Forwarded-Host": "fwd.example.com", "X-Forwarded-Proto": "https"}, "https://fwd.example.com/#/share/"),
    ):
        assert su.post("/api/projects/method/share", json=body, headers=headers).json()["url"].startswith(prefix)
    assert (
        su.get("/api/projects/method/share", headers={"Origin": "https://patent.example.com"})
        .json()[0]["url"]
        .startswith("https://patent.example.com/")
    )
    for x in su.get("/api/projects/method/share").json()[1:]:
        su.delete(f"/api/projects/method/share/{x['token']}")
    forever = su.post("/api/projects/method/share", json={"role": "viewer", "expires_in_days": None}).json()
    assert forever["expires_at"] is None
    assert [x["token"] for x in su.get("/api/projects/method/share").json()] == [link["token"], forever["token"]]

    assert guest.get("/api/projects/method/content").status_code == 403
    assert guest.post("/api/share/nope/accept").status_code == 404
    r = guest.post(f"/api/share/{link['token']}/accept")
    assert r.status_code == 200 and r.json() == {"pid": "method", "role": "editor"}
    assert guest.put("/api/projects/method/content", json={"content": "# by guest"}).status_code == 200
    # 再领一个更低角色的链接：不降级
    r = guest.post(f"/api/share/{forever['token']}/accept")
    assert r.json() == {"pid": "method", "role": "editor"}
    assert [m["role"] for m in su.get("/api/projects/method/members").json()] == ["editor"]

    # 过期 410（直接改库把 expires_at 拨到过去）
    import asyncio

    async def _expire():
        async with acl.SessionLocal() as s:
            row = await s.get(acl.ShareLink, link["token"])
            row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await s.commit()

    asyncio.run(_expire())
    r = guest.post(f"/api/share/{link['token']}/accept")
    assert r.status_code == 410 and r.json()["detail"]["kind"] == "expired"

    # 撤销
    r = su.delete(f"/api/projects/method/share/{link['token']}")
    assert r.status_code == 200 and [x["token"] for x in r.json()] == [forever["token"]]
    assert su.delete(f"/api/projects/method/share/{link['token']}").status_code == 404
    assert guest.delete(f"/api/projects/method/share/{forever['token']}").status_code == 403


def test_on_grant_owner_and_visible_pids(on):
    """给 integrate 用的两个钩子：新建案子写 owner；列表按 ACL 过滤。"""
    import asyncio

    from app import auth
    from app.auth import acl

    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "u@example.com")
    u = _login(on, "u@example.com")

    async def _flow():
        user = await acl.user_by_email("u@example.com")
        su = await acl.user_by_email("su@example.com")
        assert await auth.visible_pids(user, ["method", "other"]) == []
        assert await auth.visible_pids(su, ["method", "other"]) == ["method", "other"]
        await auth.grant_owner("other", user)
        assert await auth.visible_pids(user, ["method", "other"]) == ["other"]
        assert await acl.role_for("other", user.id) == "owner"

    asyncio.run(_flow())
    assert u.get("/api/projects/other/members").status_code == 200  # owner 门槛过了（案子目录不存在也先过 ACL）


def test_on_share_accept_duplicate_insert_is_idempotent(on, monkeypatch):
    """W12 R14-02：分享领取并发重复提交（前端 StrictMode 双效应）——set_role 插入分支撞
    UNIQUE(pid,user_id) 时回滚回读既有角色幂等返回，端点不冒 500。"""
    import asyncio

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.auth import acl

    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "guest@example.com")
    su, guest = _login(on, "su@example.com"), _login(on, "guest@example.com")
    link = su.post("/api/projects/method/share", json={"role": "editor"}).json()

    async def _flow():
        user = await acl.user_by_email("guest@example.com")
        await acl.set_role("method", user.id, "editor", upgrade_only=True)  # 并发另一请求已提交该行
        real_get = AsyncSession.get
        calls = 0

        async def fake_get(self, entity, ident, *a, **kw):
            nonlocal calls
            calls += 1
            if calls == 1:
                return None  # 竞态重放：本会话读到行写入前的快照 → 走插入分支撞 UNIQUE
            return await real_get(self, entity, ident, *a, **kw)

        monkeypatch.setattr(AsyncSession, "get", fake_get)
        # 撞 UNIQUE → rollback → 回读既有 editor（upgrade_only 不降级）；修前此处 IntegrityError → 500
        assert await acl.set_role("method", user.id, "viewer", upgrade_only=True) == "editor"

    asyncio.run(_flow())
    r = guest.post(f"/api/share/{link['token']}/accept")
    assert r.status_code == 200 and r.json() == {"pid": "method", "role": "editor"}


def test_on_record_share_accept_duplicate_insert_is_idempotent(on, monkeypatch):
    """W12 R17-01：与 R14-02 同族——record_share_accept 的 check-then-insert 撞
    UNIQUE(token,user_id)（StrictMode 双发竞态）→ 回滚幂等返回，不冒 500。"""
    import asyncio

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.auth import acl
    from app.auth.db import SessionLocal
    from app.auth.models import ShareAccept

    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "guest@example.com")
    su = _login(on, "su@example.com")
    link = su.post("/api/projects/method/share", json={"role": "viewer"}).json()

    async def _flow():
        user = await acl.user_by_email("guest@example.com")
        await acl.record_share_accept(link["token"], user.id)  # 并发另一请求已提交
        real_get = AsyncSession.get
        calls = 0

        async def fake_get(self, entity, ident, *a, **kw):
            nonlocal calls
            calls += 1
            if calls == 1:
                return None  # 竞态重放：本会话读到行写入前的快照 → 插入撞 UNIQUE
            return await real_get(self, entity, ident, *a, **kw)

        monkeypatch.setattr(AsyncSession, "get", fake_get)
        await acl.record_share_accept(link["token"], user.id)  # 修前 IntegrityError 冒泡

        async with SessionLocal() as s:
            rows = (await s.scalars(select(ShareAccept).where(ShareAccept.token == link["token"]))).all()
            assert len(rows) == 1

    asyncio.run(_flow())


def test_on_create_user_cli(on, tmp_path, capsys):
    from app.auth import create_user

    assert create_user.main(["admin@example.com", "pw-123456", "--display-name", "管理员"]) == 0
    assert "superuser=True" in capsys.readouterr().out
    assert create_user.main(["admin@example.com", "pw-123456"]) == 1
    assert create_user.main(["admin@example.com", "pw-654321", "--reset"]) == 0
    assert create_user.main(["ghost@example.com", "x", "--reset"]) == 1
    assert (
        TestClient(on.app)
        .post("/api/auth/cookie/login", data={"username": "admin@example.com", "password": "pw-123456"})
        .status_code
        == 400
    )
    c = _login(on, "admin@example.com", "pw-654321")
    assert c.get("/api/users/me").json()["display_name"] == "管理员"


def test_import_requires_login_under_auth_on(on):
    """R42-01：AUTH=on 下匿名 POST /projects/import/docx 此前能建案（漏 require_login）→ 现在 401。"""
    main = on
    c = TestClient(main.app)
    files = {"file": ("x.docx", b"PK\x03\x04fake", "application/octet-stream")}
    assert c.post("/api/projects/import/docx", files=files).status_code == 401
    assert c.post("/api/import/docx/styles", files=files).status_code == 401


def test_convert_requires_login_and_editor_under_auth_on(on):
    """R44-01：/api/projects/convert 无 {pid} → 全局 ACL 不生效。匿名此前能建新案+对任意 pid 排队转换。"""
    main = on
    c = TestClient(main.app)
    files = {"file": ("a.txt", b"some paper text here", "text/plain")}
    data = {"questionnaire": "{}", "target": "new", "ai_ack": "true"}
    assert c.post("/api/projects/convert", files=files, data=data).status_code == 401
    assert c.post("/api/projects/convert", files=files, data={**data, "target": "method"}).status_code == 401

    _register(c, "admin@x.cn")  # 第一个用户是 superuser
    _register(c, "outsider@x.cn")
    outsider = _login(main, "outsider@x.cn")
    # 登录但非本案成员 → target=pid 应 403（editor 门槛）
    r = outsider.post("/api/projects/convert", files=files, data={**data, "target": "method"})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "forbidden"
    # target=new 登录用户仍走 ai_ack 分支（不被 editor 门槛误伤）
    r = outsider.post("/api/projects/convert", files=files, data={**data, "ai_ack": "false"})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "ai_disabled"


def test_templates_router_requires_login_under_auth_on(on):
    """R44-02：/api/templates* CRUD 无任何门槛（无 {pid} → project_access 不生效）——匿名可读改删机构模板。"""
    main = on
    c = TestClient(main.app)
    for m, url in (
        ("get", "/api/templates"),
        ("post", "/api/templates"),
        ("put", "/api/templates/x"),
        ("delete", "/api/templates/x"),
    ):
        body = {} if m in ("post", "put") else None
        r = getattr(c, m)(url, json=body) if body is not None else getattr(c, m)(url)
        assert r.status_code == 401, f"{m} {url} → {r.status_code}"


def test_templates_write_requires_org_editor(on):
    """R76-01：模板库是机构级共享资源——纯 viewer 登录者曾可经 UI 存/删全机构模板。
    写路由（POST/PUT/DELETE）门槛 = 任一案 editor+ 或超管；读仍 require_login。"""
    main = on
    anon = TestClient(main.app)
    _register(anon, "su@example.com")  # superuser
    _register(anon, "ed@example.com")
    _register(anon, "vw@example.com")
    su, ed, vw = (_login(main, f"{n}@example.com") for n in ("su", "ed", "vw"))
    # ed 在 method 拿 editor 角色；vw 只有 viewer
    assert su.put("/api/projects/method/members", json={"email": "ed@example.com", "role": "editor"}).status_code == 200
    assert su.put("/api/projects/method/members", json={"email": "vw@example.com", "role": "viewer"}).status_code == 200

    tpl = {"name": "r76-tpl", "settings": {"style": {}}}
    # viewer：读 200，写/删 403
    assert vw.get("/api/templates").status_code == 200
    assert vw.post("/api/templates", json=tpl).status_code == 403
    assert vw.put("/api/templates/r76-tpl", json=tpl).status_code == 403
    assert vw.delete("/api/templates/r76-tpl").status_code == 403
    # editor（任一案）：可写可删
    assert ed.post("/api/templates", json=tpl).status_code == 201
    assert ed.delete("/api/templates/r76-tpl").status_code == 204
    # 超管不在任何案也可写
    assert su.post("/api/templates", json=tpl).status_code == 201


def test_deadlines_items_carry_my_role(on):
    """R77-01：聚合期限行补 my_role——viewer 行前端禁用完成/催办（写端点门槛 agent）。"""
    main = on
    anon = TestClient(main.app)
    _register(anon, "su@example.com")
    _register(anon, "vw@example.com")
    su, vw = _login(main, "su@example.com"), _login(main, "vw@example.com")
    assert su.put("/api/projects/method/members", json={"email": "vw@example.com", "role": "viewer"}).status_code == 200
    assert (
        su.put(
            "/api/projects/method/case", json={"deadlines": [{"id": "d1", "kind": "oa_reply", "due": "2099-01-01"}]}
        ).status_code
        == 200
    )
    items = vw.get("/api/deadlines").json()["items"]
    assert items and all(i["pid"] == "method" and i["my_role"] == "viewer" for i in items)
    assert {i["my_role"] for i in su.get("/api/deadlines").json()["items"]} == {"owner"}


def test_ai_jobs_acl_and_glob_guards(on):
    """R45-01/02：/api/ai/jobs/{id} 三条端点此前无鉴权；job_id 通配符可枚举全站任务。"""
    import json as _json
    import time as _time

    main = on
    c = TestClient(main.app)
    # 造一份落盘的 method 案任务（job_<12hex> 形态）
    pid, jid = "method", "job_deadbeef0123"
    jdir = os.path.join(os.environ["PATENT_PROJECTS_DIR"], pid, ".studio", "ai-jobs")
    os.makedirs(jdir, exist_ok=True)
    now = _time.time()
    job = {
        "id": jid,
        "kind": "review",
        "pid": pid,
        "status": "done",
        "progress": 1.0,
        "message": "完成",
        "result": {"comments": 3},
        "error": None,
        "created_at": now,
        "updated_at": now,
        "steps": [],
        "queue_key": None,
    }
    with open(os.path.join(jdir, jid + ".json"), "w", encoding="utf-8") as f:
        _json.dump(job, f)

    # 匿名：读/取消/事件流全 401
    assert c.get(f"/api/ai/jobs/{jid}").status_code == 401
    assert c.post(f"/api/ai/jobs/{jid}/cancel").status_code == 401
    assert c.get(f"/api/ai/jobs/{jid}/events").status_code == 401
    # 通配符 id：不再命中 glob（404 而非泄露别人的任务）
    assert c.get("/api/ai/jobs/%2A").status_code == 404
    assert c.get("/api/ai/jobs/job_%3F%3F%3F%3F%3F%3F%3F%3F").status_code == 404

    _register(c, "admin@x.cn")
    _register(c, "outsider@x.cn")
    outsider = _login(main, "outsider@x.cn")
    admin = _login(main, "admin@x.cn")
    # 非成员：读 403、取消 403；superuser 可读
    assert outsider.get(f"/api/ai/jobs/{jid}").status_code == 403
    assert outsider.post(f"/api/ai/jobs/{jid}/cancel").status_code == 403
    r = admin.get(f"/api/ai/jobs/{jid}")
    assert r.status_code == 200 and r.json()["result"]["comments"] == 3


def test_on_comment_mutations_require_author_or_role(on):
    """R64-01：批注 PATCH/DELETE 需作者本人或 editor+；resolve/reopen 需作者或 reviewer+；
    viewer 可发帖/回帖（viewer 门槛是讨论通道）但不能动他人批注。"""
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "owner@example.com")
    _register(anon, "viewer@example.com")
    _register(anon, "rev@example.com")
    su, owner, viewer, rev = (_login(on, f"{n}@example.com") for n in ("su", "owner", "viewer", "rev"))
    r = su.put("/api/projects/method/members", json={"email": "owner@example.com", "role": "owner"})
    assert r.status_code == 200
    owner.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    owner.put("/api/projects/method/members", json={"email": "rev@example.com", "role": "reviewer"})

    anchor = {"block_id": "claims/1", "line": 9, "quote": "其特征在于"}
    cid = owner.post("/api/projects/method/comments", json={"anchor": anchor, "body": "权1表述不清"}).json()["id"]

    # viewer 对他人批注：可回帖（viewer 门槛仍是讨论通道），改/删/解决/重开全 403
    assert viewer.post(f"/api/projects/method/comments/{cid}/replies", json={"body": "收到"}).status_code == 200
    r = viewer.patch(f"/api/projects/method/comments/{cid}", json={"body": "篡改"})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "editor"
    assert viewer.delete(f"/api/projects/method/comments/{cid}").status_code == 403
    r = viewer.post(f"/api/projects/method/comments/{cid}/resolve", json={"resolved": True})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    assert viewer.post(f"/api/projects/method/comments/{cid}/reopen").status_code == 403
    # 上面那个 PATCH 真没写进去
    assert owner.get("/api/projects/method/comments").json()[0]["body"] == "权1表述不清"

    # reviewer 可解决/重开他人批注（审阅工作流动作），不可改/删
    assert rev.post(f"/api/projects/method/comments/{cid}/resolve", json={"resolved": True}).status_code == 200
    assert rev.post(f"/api/projects/method/comments/{cid}/reopen").status_code == 200
    assert rev.delete(f"/api/projects/method/comments/{cid}").status_code == 403

    # viewer 对自己发的批注全操作放行（作者本人豁免）
    own = viewer.post("/api/projects/method/comments", json={"anchor": anchor, "body": "我的疑问"}).json()["id"]
    assert viewer.patch(f"/api/projects/method/comments/{own}", json={"body": "改后"}).status_code == 200
    assert viewer.post(f"/api/projects/method/comments/{own}/resolve", json={"resolved": True}).status_code == 200
    assert viewer.delete(f"/api/projects/method/comments/{own}").status_code == 204

    # editor+（owner）可管他人批注；客户批注（author.id=None）只能角色管
    pub = owner.post("/api/projects/method/comments", json={"anchor": anchor, "body": "客户批注"}).json()["id"]
    from app.domain import comments as _cm

    d = os.path.join(os.environ["PATENT_PROJECTS_DIR"], "method")
    pool = _cm.load(d)
    pool[-1].author = _cm.Author(id=None, name="客户甲")
    pool[-1].source = "client"
    _cm.save(d, pool)
    assert viewer.patch(f"/api/projects/method/comments/{pub}", json={"body": "x"}).status_code == 403
    assert rev.post(f"/api/projects/method/comments/{pub}/resolve", json={"resolved": True}).status_code == 200
    assert owner.delete(f"/api/projects/method/comments/{cid}").status_code == 204
