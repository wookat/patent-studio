# -*- coding: utf-8 -*-
"""B2-reviewer-invites：邮箱邀请 pending（docs/plan/14 §2 §4 D6 D7）。

CRUD / 邮箱大小写归一 / 已注册邮箱 POST ⇒ 直接成员 / 注册与登录消费 pending 并 upgrade_only 写 ACL / owner 角色 422。
"""

import asyncio
import uuid

import test_auth
from fastapi.testclient import TestClient

on = test_auth.on  # pytest fixture
_register, _login = test_auth._register, test_auth._login
INV = "/api/projects/method/invites"


def _su(on):
    anon = TestClient(on.app)
    su_user = _register(anon, "su@example.com")
    return _login(on, "su@example.com"), su_user


def test_invites_crud(on):
    su, su_user = _su(on)
    assert su.get(INV).json() == []

    r = su.post(INV, json={"email": "  Guest@Example.COM ", "role": "reviewer"})
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["email"] == "guest@example.com" and inv["role"] == "reviewer"
    assert inv["invited_by"] == su_user["id"] and inv["created_at"]
    assert set(inv) == {"email", "role", "invited_by", "created_at"}

    # 再邀一次同邮箱（不同大小写）⇒ upsert，不重复
    r = su.post(INV, json={"email": "GUEST@example.com", "role": "viewer"})
    assert r.status_code == 201 and r.json()["role"] == "viewer"
    assert [(i["email"], i["role"]) for i in su.get(INV).json()] == [("guest@example.com", "viewer")]

    # 改角色（路径邮箱大小写归一）；不存在 ⇒ 404
    r = su.put(f"{INV}/Guest@example.com", json={"role": "editor"})
    assert r.status_code == 200 and r.json()["role"] == "editor"
    assert su.put(f"{INV}/nobody@example.com", json={"role": "editor"}).status_code == 404

    # 非法 / owner 角色 ⇒ 422
    assert su.post(INV, json={"email": "x@example.com", "role": "owner"}).status_code == 422
    assert su.post(INV, json={"email": "x@example.com", "role": "boss"}).status_code == 422
    assert su.put(f"{INV}/guest@example.com", json={"role": "owner"}).status_code == 422
    assert [i["email"] for i in su.get(INV).json()] == ["guest@example.com"]

    # 撤销 ⇒ 返回剩余列表；再撤 ⇒ 404
    r = su.delete(f"{INV}/GUEST@example.com")
    assert r.status_code == 200 and r.json() == []
    assert su.delete(f"{INV}/guest@example.com").status_code == 404


def test_invites_owner_gate(on):
    su, _ = _su(on)
    anon = TestClient(on.app)
    _register(anon, "ed@example.com")
    assert su.put("/api/projects/method/members", json={"email": "ed@example.com", "role": "editor"}).status_code == 200
    ed = _login(on, "ed@example.com")
    assert ed.get(INV).status_code == 403
    assert ed.post(INV, json={"email": "z@example.com", "role": "viewer"}).status_code == 403
    assert ed.put(f"{INV}/z@example.com", json={"role": "viewer"}).status_code == 403
    assert ed.delete(f"{INV}/z@example.com").status_code == 403
    assert anon.get(INV).status_code == 401


def test_invite_registered_email_becomes_member(on):
    su, _ = _su(on)
    anon = TestClient(on.app)
    reg = _register(anon, "reg@example.com", display_name="已注册")
    r = su.post(INV, json={"email": "Reg@Example.com", "role": "reviewer"})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "member": {
            "user_id": reg["id"],
            "email": "reg@example.com",
            "display_name": "已注册",
            "avatar_color": "",
            "role": "reviewer",
        }
    }
    assert su.get(INV).json() == []
    roles = {m["email"]: m["role"] for m in su.get("/api/projects/method/members").json()}
    assert roles["reg@example.com"] == "reviewer"
    # 已注册邮箱走 set_role 是覆盖（不是 upgrade_only）：owner 把 reviewer 改 viewer 生效
    assert su.post(INV, json={"email": "reg@example.com", "role": "viewer"}).json()["member"]["role"] == "viewer"


def test_invite_consumed_on_register_and_login(on):
    su, _ = _su(on)
    anon = TestClient(on.app)

    # 注册消费：pending(reviewer) ⇒ 成员 reviewer，pending 删除
    assert su.post(INV, json={"email": "New@Example.com", "role": "reviewer"}).status_code == 201
    _register(anon, "new@example.com")
    assert su.get(INV).json() == []
    roles = {m["email"]: m["role"] for m in su.get("/api/projects/method/members").json()}
    assert roles["new@example.com"] == "reviewer"
    assert _login(on, "new@example.com").get("/api/projects/method/collab").json()["mode"] == "review"

    # 登录消费 + upgrade_only：已注册邮箱走 POST /invites 会直接成员，所以用 create_pending 直接写 pending
    # （router.set_member 未注册分支的入口），登录后 editor 不被 viewer 降级
    from app.auth import invites

    su_id = uuid.UUID(su.get("/api/users/me").json()["id"])
    members = "/api/projects/method/members"
    assert su.put(members, json={"email": "new@example.com", "role": "editor"}).status_code == 200
    asyncio.run(invites.create_pending("method", "NEW@example.com", "viewer", su_id))
    assert [i["email"] for i in su.get(INV).json()] == ["new@example.com"]
    _login(on, "new@example.com")
    assert su.get(INV).json() == []
    roles = {m["email"]: m["role"] for m in su.get("/api/projects/method/members").json()}
    assert roles["new@example.com"] == "editor"

    # 登录消费 upgrade：viewer 成员 + pending(editor) ⇒ 登录后 editor
    _register(anon, "up@example.com")
    assert su.put(members, json={"email": "up@example.com", "role": "viewer"}).status_code == 200
    asyncio.run(invites.create_pending("method", "up@example.com", "editor", su_id))
    _login(on, "up@example.com")
    roles = {m["email"]: m["role"] for m in su.get("/api/projects/method/members").json()}
    assert roles["up@example.com"] == "editor" and su.get(INV).json() == []
