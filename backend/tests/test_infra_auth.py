# -*- coding: utf-8 -*-
"""平台认证（patent_studio.infra.auth + api.auth_routes），改自参照分支 test_auth.py：

off：注册/登录 501 not_implemented、/api/users/me → 204、不加载 fastapi-users/不建库；
on（真 PG）：注册校验（中文 422）、首个注册用户 superuser、登录/登出/me、改密吊销旧会话。
`on` fixture 与 _register/_login 是全测试目录共享基建（pytest 模块间引用）。

B2 裁剪：去掉 test_rest_routes_require_login_when_on（/api/v1 平台路由尚未挂载，属后续批次）；
新增 User/Principal ORM ↔ 迁移 DDL 直测。
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from patent_studio.asgi import create_app
from patent_studio.settings import get_settings

SECRET = "test-secret-key-for-auth-suite-32b"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    monkeypatch.delenv("PATENT_STUDIO_SECRET", raising=False)
    get_settings.cache_clear()
    yield TestClient(create_app()), tmp_path
    get_settings.cache_clear()


@pytest.fixture()
def on(tmp_path, monkeypatch, pg_schema):
    """AUTH=on + pg_schema 已迁移空库；结束后恢复 off。"""
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    get_settings.cache_clear()
    yield SimpleNamespace(app=create_app())
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    get_settings.cache_clear()


def _register(c, email, password="pw-123456", display_name=""):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": display_name})
    assert r.status_code == 201, r.text
    return r.json()


def _login(on, email, password="pw-123456"):
    """独立 TestClient = 独立 cookie jar（多用户并行）。"""
    c = TestClient(on.app)
    r = c.post("/api/auth/cookie/login", data={"username": email, "password": password})
    assert r.status_code == 204, r.text
    return c


# ------------------------------------------------------------------ off ----


def _assert_501(r):
    assert r.status_code == 501
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"}
    assert d["kind"] == "not_implemented"


def test_off_is_default_and_never_touches_db(client):
    c, _ = client
    from patent_studio.infra import auth as infra_auth

    assert get_settings().auth == "off"
    assert c.get("/api/health").json()["ok"] is True
    assert c.get("/api/users/me").status_code == 204
    # off 不初始化认证栈、不建任何 DB 引擎（fastapi-users 包可能被 domain.identity 间接导入，不算触碰）
    assert infra_auth._STACK is None and infra_auth._engines == {}


def test_off_auth_routes_are_501_with_error_shape(client):
    c, _ = client
    _assert_501(c.post("/api/auth/register", json={"email": "a@b.cn", "password": "x"}))
    _assert_501(c.post("/api/auth/cookie/login", data={"username": "a@b.cn", "password": "x"}))
    _assert_501(c.post("/api/auth/cookie/logout"))
    _assert_501(c.put("/api/users/me", json={"display_name": "x"}))


# ------------------------------------------------------------------- on ----


def test_register_validation_and_first_superuser(on):
    anon = TestClient(on.app)
    r = anon.post("/api/auth/register", json={"email": "bad", "password": "pw-123456"})
    assert r.status_code == 422
    assert "邮箱" in r.json()["detail"]["message"]
    assert anon.post("/api/auth/register", json={"email": "a@b.cn", "password": "short"}).status_code == 422
    u = _register(anon, "boss@example.com", display_name="老板")
    assert u["is_superuser"] is True and u["display_name"] == "老板"
    assert "is_active" not in u and "hashed_password" not in u
    assert _register(anon, "second@example.com")["is_superuser"] is False
    r = anon.post("/api/auth/register", json={"email": "boss@example.com", "password": "pw-123456"})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"


def test_login_logout_me(on):
    anon = TestClient(on.app)
    _register(anon, "boss@example.com")
    r = anon.post("/api/auth/cookie/login", data={"username": "boss@example.com", "password": "wrong-pass"})
    assert r.status_code == 400
    assert TestClient(on.app).get("/api/users/me").status_code == 401
    c = _login(on, "boss@example.com")
    me = c.get("/api/users/me")
    assert me.status_code == 200 and me.json()["email"] == "boss@example.com"
    assert c.post("/api/auth/cookie/logout").status_code == 204
    assert c.get("/api/users/me").status_code == 401


# ------------------------------------------------------- ORM ↔ 迁移 DDL ----


@pytest.mark.skipif(
    not __import__("os").environ.get("PATENT_STUDIO_TEST_DATABASE_URL"),
    reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL",
)
def test_identity_models_persist_on_migrated_schema(pg_schema):
    """User/Principal ORM 直接落迁移后的真库：验证模型定义与 0002 DDL 对齐（可逆性由 test_infra_db 覆盖）。"""
    import asyncio
    import uuid

    from sqlalchemy import text

    from patent_studio.domain.identity import Principal, User
    from patent_studio.infra.db import Database

    async def run():
        db = Database(pg_schema)
        try:
            async with db.transaction() as s:
                u = User(email="orm@example.com", hashed_password="x", display_name="ORM")
                s.add(u)
                await s.flush()
                s.add(Principal(kind="human", user_id=u.id, display_name="ORM"))
                s.add(Principal(kind="agent", agent_key="agent:bot-1", display_name="机器人"))
            async with db.transaction() as s:
                n_users = (await s.execute(text("SELECT count(*) FROM users"))).scalar()
                n_principals = (await s.execute(text("SELECT count(*) FROM principals"))).scalar()
                # identity_source 检查约束：agent 带 user_id 必拒
                from sqlalchemy.exc import IntegrityError

                with pytest.raises(IntegrityError):
                    async with db.transaction() as s2:
                        s2.add(Principal(kind="agent", user_id=uuid.uuid4(), agent_key="agent:bad", display_name="坏"))
                return n_users, n_principals
        finally:
            await db.dispose()

    assert asyncio.run(run()) == (1, 2)
