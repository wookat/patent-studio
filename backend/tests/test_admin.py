# -*- coding: utf-8 -*-
"""W4-E E2（docs/plan/17 §3.3）：/api/admin/users 成员表（超管）+ /api/admin/org 机构名称（org.json）；
W5 notify-audit-backend：/api/admin/settings（ai_enabled / default_collab / smtp 只读 / ai_daily_tokens）
+ org.require_org_ai。
"""

import asyncio
import json
import os

import pytest
import test_legacy_auth as test_auth
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_legacy_auth import _login, _register

from app.domain import org
from app.notify import mail

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture


def _err(r, status, kind):
    assert r.status_code == status, r.text
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"} and d["kind"] == kind
    return d


def _seed(on):
    """首个注册 = 超管；再注册一名普通成员并登录。返回 (su_client, staff_client, staff_user, su_user)。"""
    anon = TestClient(on.app)
    su = _register(anon, "su@example.com", display_name="王管理员")
    staff = _register(anon, "staff@example.com", display_name="小李")
    su_c = _login(on, "su@example.com")
    staff_c = _login(on, "staff@example.com")
    return su_c, staff_c, staff, su


# ---------------------------------------------------------------- 权限 ----


def test_users_routes_require_superuser(on):
    su_c, staff_c, staff, _ = _seed(on)
    assert TestClient(on.app).get("/api/admin/users").status_code == 401
    d = _err(staff_c.get("/api/admin/users"), 403, "forbidden")
    assert d["detail"] == "superuser"
    d = _err(staff_c.put(f"/api/admin/users/{staff['id']}", json={"title": "x"}), 403, "forbidden")
    assert d["detail"] == "superuser"
    assert su_c.get("/api/admin/users").status_code == 200


# ---------------------------------------------------------------- 列表 ----


def test_list_users_includes_inactive_sorted_by_last_login(on):
    su_c, staff_c, staff, su = _seed(on)
    _register(TestClient(on.app), "never@example.com")  # 注册但从未登录

    rows = su_c.get("/api/admin/users").json()
    assert [r["email"] for r in rows] == ["staff@example.com", "su@example.com", "never@example.com"]
    assert set(rows[0]) == {
        "id",
        "email",
        "display_name",
        "title",
        "avatar_color",
        "is_superuser",
        "is_active",
        "last_login_at",
    }
    assert rows[1]["is_superuser"] is True and rows[0]["is_superuser"] is False
    assert rows[0]["last_login_at"] and rows[2]["last_login_at"] is None
    assert rows[0]["display_name"] == "小李"

    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    rows = su_c.get("/api/admin/users").json()
    assert [r["email"] for r in rows if not r["is_active"]] == ["staff@example.com"]  # 禁用成员仍在列表


# ---------------------------------------------------------------- 更新 ----


def test_update_user_fields_and_disabled_session_dies(on):
    su_c, staff_c, staff, _ = _seed(on)
    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"title": " 发明人 ", "is_superuser": True})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "发明人" and r.json()["is_superuser"] is True
    assert staff_c.get("/api/users/me").json()["title"] == "发明人"
    assert staff_c.get("/api/admin/users").status_code == 200  # 升为超管后立刻可管

    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"is_superuser": False, "is_active": False})
    assert r.status_code == 200 and r.json()["is_superuser"] is False and r.json()["is_active"] is False
    assert staff_c.get("/api/users/me").status_code == 401  # 禁用即掉线
    assert (
        TestClient(on.app)
        .post("/api/auth/cookie/login", data={"username": "staff@example.com", "password": "pw-123456"})
        .status_code
        == 400
    )
    r = su_c.put(f"/api/admin/users/{staff['id']}", json={"is_active": True})
    assert r.json()["is_active"] is True
    _login(on, "staff@example.com")  # 重新启用后可登录


def test_update_user_guards(on):
    su_c, staff_c, staff, su = _seed(on)
    _err(su_c.put(f"/api/admin/users/{su['id']}", json={"is_active": False}), 409, "conflict")
    _err(su_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": False}), 409, "conflict")
    r = su_c.put(f"/api/admin/users/{su['id']}", json={"title": "管理员"})
    assert r.json()["title"] == "管理员"  # 自己改头衔可以
    assert su_c.put(f"/api/admin/users/{su['id']}", json={"is_active": True, "is_superuser": True}).status_code == 200

    # 最后一个可用超管不能被另一个超管禁用/降级：先把 staff 升为超管，再由 staff 操作 su
    su_c.put(f"/api/admin/users/{staff['id']}", json={"is_superuser": True})
    assert staff_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": False}).status_code == 200  # 还有 staff
    _err(su_c.put(f"/api/admin/users/{staff['id']}", json={"is_active": False}), 403, "forbidden")  # su 已非超管
    _err(staff_c.put(f"/api/admin/users/{staff['id']}", json={"is_superuser": False}), 409, "conflict")  # 自己
    su_c2 = _login(on, "su@example.com")
    su_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": True})  # 403，无效
    staff_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": True})
    assert su_c2.get("/api/admin/users").status_code == 200
    # 现在两位超管；su 禁用 staff 可以；再禁用自己不行；staff 被禁后只剩 su，staff（已掉线）无法反制
    assert su_c2.put(f"/api/admin/users/{staff['id']}", json={"is_active": False}).status_code == 200
    _err(su_c2.put(f"/api/admin/users/{su['id']}", json={"is_superuser": False}), 409, "conflict")

    _err(su_c2.put("/api/admin/users/not-a-uuid", json={"title": "x"}), 404, "not_found")
    _err(su_c2.put("/api/admin/users/00000000-0000-0000-0000-000000000000", json={"title": "x"}), 404, "not_found")
    _err(su_c2.put(f"/api/admin/users/{staff['id']}", json={"title": "衔" * 33}), 422, "validation")


def test_last_superuser_cannot_be_disabled_by_peer(on):
    """两位超管，A 先降级 B 成功后，B 已是普通成员；若再有第三位超管 C 试图禁用 A ⇒ 409（A 是最后一个）。"""
    su_c, staff_c, staff, su = _seed(on)
    third = _register(TestClient(on.app), "third@example.com")
    su_c.put(f"/api/admin/users/{third['id']}", json={"is_superuser": True})
    third_c = _login(on, "third@example.com")
    assert third_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": False}).status_code == 200
    assert su_c.get("/api/admin/users").status_code == 403
    # third 是唯一超管：任何人（含 su 重新登录也不行，403）都不能把它降级；third 自己 ⇒ 409
    _err(third_c.put(f"/api/admin/users/{third['id']}", json={"is_active": False}), 409, "conflict")
    third_c.put(f"/api/admin/users/{su['id']}", json={"is_superuser": True})
    # su 恢复超管后才能把 third 降级
    assert su_c.put(f"/api/admin/users/{third['id']}", json={"is_superuser": False}).status_code == 200
    _err(su_c.put(f"/api/admin/users/{su['id']}", json={"is_active": False}), 409, "conflict")


# ---------------------------------------------------------------- 机构 ----


def test_org_roundtrip_off_mode_writes_studio_org_json(client):
    c, tmp = client
    from app import config

    assert c.get("/api/admin/org").json() == {"name": ""}
    r = c.put("/api/admin/org", json={"name": "  某某知识产权代理事务所 "})
    assert r.status_code == 200 and r.json() == {"name": "某某知识产权代理事务所"}
    p = os.path.join(config.PROJECTS_DIR, ".studio", "org.json")
    with open(p, encoding="utf-8") as f:
        saved = json.load(f)
    assert saved["name"] == "某某知识产权代理事务所"
    assert set(saved) == {"name", "ai_enabled", "default_collab", "ai_daily_tokens"}  # 机构设置同文件（默认值）
    assert c.get("/api/admin/org").json() == {"name": "某某知识产权代理事务所"}
    d = _err(c.put("/api/admin/org", json={"name": "机" * 65}), 422, "validation")
    assert "过长" in d["message"]
    assert c.put("/api/admin/org", json={"name": ""}).json() == {"name": ""}


def test_org_on_mode_anyone_reads_only_superuser_writes(on):
    su_c, staff_c, _, _ = _seed(on)
    assert TestClient(on.app).get("/api/admin/org").status_code == 401
    assert staff_c.get("/api/admin/org").json() == {"name": ""}  # 登录成员可读（顶栏/导出展示）
    d = _err(staff_c.put("/api/admin/org", json={"name": "x"}), 403, "forbidden")
    assert d["detail"] == "superuser"
    assert su_c.put("/api/admin/org", json={"name": "甲乙丙知识产权"}).json() == {"name": "甲乙丙知识产权"}
    assert staff_c.get("/api/admin/org").json() == {"name": "甲乙丙知识产权"}


# ---------------------------------------------------------------- W5 机构设置 ----

DEFAULT_SETTINGS = {
    "ai_enabled": True,
    "default_collab": {"editor_mode": "edit", "allow_viewer_comment": True},
    "smtp": None,
    "ai_daily_tokens": 200_000,
}


def test_settings_defaults_and_patch_persist_alongside_name(client, monkeypatch):
    c, tmp = client
    monkeypatch.delenv(mail.ENV, raising=False)
    assert c.get("/api/admin/settings").json() == DEFAULT_SETTINGS
    assert c.put("/api/admin/org", json={"name": "甲所"}).status_code == 200

    r = c.put("/api/admin/settings", json={"ai_enabled": False, "ai_daily_tokens": 5000})
    assert r.status_code == 200, r.text
    assert r.json() == {**DEFAULT_SETTINGS, "ai_enabled": False, "ai_daily_tokens": 5000}
    r = c.put("/api/admin/settings", json={"default_collab": {"editor_mode": "review", "allow_viewer_comment": False}})
    assert r.json()["default_collab"] == {"editor_mode": "review", "allow_viewer_comment": False}
    assert r.json()["ai_enabled"] is False  # 未给字段不动
    assert c.get("/api/admin/org").json() == {"name": "甲所"}  # 名称不受影响
    with open(os.path.join(tmp, "projects", ".studio", "org.json"), encoding="utf-8") as f:
        assert json.load(f) == {
            "name": "甲所",
            "ai_enabled": False,
            "ai_daily_tokens": 5000,
            "default_collab": {"editor_mode": "review", "allow_viewer_comment": False},
        }

    # smtp 只读：PUT 里给了也忽略；状态来自环境变量且不含密码
    monkeypatch.setenv(mail.ENV, "smtp://bot%40ip.example:pw-secret@mail.ip.example:2525?from=noreply@ip.example")
    r = c.put("/api/admin/settings", json={"smtp": {"host": "evil", "enabled": False}})
    assert r.json()["smtp"] == {
        "host": "mail.ip.example",
        "port": 2525,
        "user": "bot@ip.example",
        "from": "noreply@ip.example",
        "enabled": True,
    }
    assert "pw-secret" not in r.text
    assert c.get("/api/admin/settings").json()["smtp"]["enabled"] is True

    _err(c.put("/api/admin/settings", json={"ai_daily_tokens": -1}), 422, "validation")
    _err(c.put("/api/admin/settings", json={"default_collab": {"editor_mode": "x"}}), 422, "validation")


def test_settings_on_mode_members_read_superuser_writes(on):
    su_c, staff_c, _, _ = _seed(on)
    assert TestClient(on.app).get("/api/admin/settings").status_code == 401
    assert staff_c.get("/api/admin/settings").json()["ai_enabled"] is True
    d = _err(staff_c.put("/api/admin/settings", json={"ai_enabled": False}), 403, "forbidden")
    assert d["detail"] == "superuser"
    assert su_c.put("/api/admin/settings", json={"ai_enabled": False}).json()["ai_enabled"] is False
    assert staff_c.get("/api/admin/settings").json()["ai_enabled"] is False


def test_require_org_ai_raises_403_when_disabled(client):
    c, tmp = client
    asyncio.run(org.require_org_ai())  # 默认开
    assert c.put("/api/admin/settings", json={"ai_enabled": False}).status_code == 200
    with pytest.raises(HTTPException) as ei:
        asyncio.run(org.require_org_ai())
    assert ei.value.status_code == 403
    assert ei.value.detail["kind"] == "ai_disabled_by_org" and ei.value.detail["detail"] == "org"
    assert c.put("/api/admin/settings", json={"ai_enabled": True}).status_code == 200
    asyncio.run(org.require_org_ai())
