# -*- coding: utf-8 -*-
"""平台认证（patent_studio.infra.auth + api.auth_routes）：

off：注册/登录 501 not_implemented、/api/users/me → 204、不加载 fastapi-users/不建库；
on（真 PG）：注册校验（中文 422）、首个注册用户 superuser、登录/登出/me、改密吊销旧会话。
`on` fixture 与 _register/_login 是全测试目录共享基建（pytest_plugins 引用）。
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
    r = c.post("/api/auth/register",
               json={"email": email, "password": password, "display_name": display_name})
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
    assert anon.post("/api/auth/register",
                     json={"email": "a@b.cn", "password": "short"}).status_code == 422
    u = _register(anon, "boss@example.com", display_name="老板")
    assert u["is_superuser"] is True and u["display_name"] == "老板"
    assert "is_active" not in u and "hashed_password" not in u
    assert _register(anon, "second@example.com")["is_superuser"] is False
    r = anon.post("/api/auth/register", json={"email": "boss@example.com", "password": "pw-123456"})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"


def test_login_logout_me(on):
    anon = TestClient(on.app)
    _register(anon, "boss@example.com")
    r = anon.post("/api/auth/cookie/login",
                  data={"username": "boss@example.com", "password": "wrong-pass"})
    assert r.status_code == 400
    assert TestClient(on.app).get("/api/users/me").status_code == 401
    c = _login(on, "boss@example.com")
    me = c.get("/api/users/me")
    assert me.status_code == 200 and me.json()["email"] == "boss@example.com"
    assert c.post("/api/auth/cookie/logout").status_code == 204
    assert c.get("/api/users/me").status_code == 401


def test_rest_routes_require_login_when_on(on):
    """on 模式下 /api/v1 走同一 cookie 会话：未登录 401，登录后可建机构。"""
    anon = TestClient(on.app)
    assert anon.get("/api/v1/cases").status_code == 401
    _register(anon, "owner@example.com")
    c = _login(on, "owner@example.com")
    r = c.post("/api/v1/organizations", headers={"Idempotency-Key": "org-1"},
               json={"slug": "acme", "name": "Acme"})
    assert r.status_code == 201, r.text
