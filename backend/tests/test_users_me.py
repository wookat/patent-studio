# -*- coding: utf-8 -*-
"""W4-E E2（docs/plan/17 §3.2）：PUT /api/users/me 个人资料 + 改密码契约。off 形状仍由 test_w4e_prep 锁。"""
import time

import test_auth
from fastapi.testclient import TestClient
from test_auth import _login, _register

on = test_auth.on  # pytest fixture


def _err(r, status, kind):
    assert r.status_code == status, r.text
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"} and d["kind"] == kind
    return d


def test_anon_is_401(on):
    r = TestClient(on.app).put("/api/users/me", json={"display_name": "x"})
    assert r.status_code == 401


def test_put_profile_fields_partial_and_persisted(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="张代理")
    c = _login(on, "su@example.com")

    r = c.put("/api/users/me", json={"title": "代理师", "avatar_color": "teal"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "张代理" and body["title"] == "代理师" and body["avatar_color"] == "teal"
    assert set(body) >= {"id", "email", "is_superuser"} and "is_active" not in body and "hashed_password" not in body

    r = c.put("/api/users/me", json={"display_name": "  李代理 ", "avatar_color": ""})
    assert r.json()["display_name"] == "李代理" and r.json()["avatar_color"] == ""
    assert r.json()["title"] == "代理师"  # 未带的字段不动
    me = c.get("/api/users/me").json()
    assert (me["display_name"], me["title"], me["avatar_color"]) == ("李代理", "代理师", "")
    assert c.put("/api/users/me", json={}).status_code == 200  # 空 patch 幂等


def test_put_profile_validation(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    c = _login(on, "su@example.com")
    _err(c.put("/api/users/me", json={"avatar_color": "#ff0000"}), 422, "validation")
    _err(c.put("/api/users/me", json={"avatar_color": "Blue"}), 422, "validation")
    _err(c.put("/api/users/me", json={"display_name": "名" * 65}), 422, "validation")
    _err(c.put("/api/users/me", json={"title": "衔" * 33}), 422, "validation")
    assert c.put("/api/users/me", json={"display_name": "名" * 64}).status_code == 200


def test_change_password_checks_current_and_ends_sessions(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    c = _login(on, "su@example.com")

    r = c.put("/api/users/me", json={"password": {"current": "wrong-pass", "new": "new-pass-123"}})
    d = _err(r, 403, "forbidden")
    assert d["detail"] == "password"
    _err(c.put("/api/users/me", json={"password": {"current": "pw-123456", "new": "short"}}), 422, "validation")
    # 旧密码仍有效（上面两次都没写库）
    _login(on, "su@example.com")

    r = c.put("/api/users/me",
              json={"password": {"current": "pw-123456", "new": "new-pass-123"}, "display_name": "改密同时改名"})
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "改密同时改名"
    time.sleep(1.05)  # exp 秒精度：跨秒保证签发时刻判定确定
    # R71-01：改密后此前签发的会话一律失效（含本会话）
    assert c.get("/api/users/me").status_code == 401
    assert TestClient(on.app).post("/api/auth/cookie/login",
                                   data={"username": "su@example.com", "password": "pw-123456"}).status_code == 400
    c2 = _login(on, "su@example.com", password="new-pass-123")
    assert c2.get("/api/users/me").status_code == 200


def test_password_body_shape_is_validated(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    c = _login(on, "su@example.com")
    _err(c.put("/api/users/me", json={"password": {"new": "new-pass-123"}}), 422, "validation")
    _err(c.put("/api/users/me", json={"password": "new-pass-123"}), 422, "validation")
