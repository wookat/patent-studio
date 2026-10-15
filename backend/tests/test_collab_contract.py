# -*- coding: utf-8 -*-
"""W4-B 骨架锁（docs/plan/14）：角色表、AUTH=off 下单元路由 501 形状、共享面（accepted_by / PUT members/{uid} /
collab mode / reviewer 直接改字 403 / 在线来源）。单元细节见 test_access / test_reviewer / test_invites。"""

import test_legacy_auth as test_auth
from fastapi.testclient import TestClient
from test_legacy_auth import _assert_501, _login, _register

from app.auth import ROLE_RANK, ROLES, required_role, role_at_least
from app.collab import rooms

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture


def test_reviewer_between_viewer_and_editor():
    assert ROLES == ("viewer", "reviewer", "editor", "agent", "owner")
    assert ROLE_RANK["viewer"] < ROLE_RANK["reviewer"] < ROLE_RANK["editor"] < ROLE_RANK["agent"] < ROLE_RANK["owner"]
    assert role_at_least("reviewer", "viewer") and not role_at_least("reviewer", "editor")
    # 源文档写路由：读仍 viewer，写放 reviewer 进门（正文校验在路由内 check_source_write）
    for path in (
        "/api/projects/{pid}/content",
        "/api/projects/{pid}/docs/{book}",
        "/api/projects/{pid}/blocks",
        "/api/projects/{pid}/blocks/{block_id:path}",
    ):
        assert required_role("GET", path) == "viewer"
        assert required_role("PUT", path) == "reviewer" and required_role("POST", path) == "reviewer"
    assert required_role("GET", "/api/projects/{pid}/access") == "owner"
    assert required_role("POST", "/api/projects/{pid}/invites") == "owner"
    assert required_role("GET", "/api/projects/{pid}/collab-settings") == "viewer"
    assert required_role("PUT", "/api/projects/{pid}/members/{user_id}") == "owner"
    assert required_role("PUT", "/api/projects/{pid}/settings") == "editor"  # 其他写路由不变


def test_off_placeholders_are_501_with_unit_name(client):
    c, _ = client
    _assert_501(c.get("/api/projects/method/access"), "B1-access-log")
    _assert_501(c.get("/api/projects/method/collab-settings"), "B1-access-log")
    _assert_501(c.put("/api/projects/method/collab-settings", json={"allow_download": False}), "B1-access-log")
    _assert_501(c.get("/api/projects/method/invites"), "B2-reviewer-invites")
    _assert_501(
        c.post("/api/projects/method/invites", json={"email": "a@b.cn", "role": "reviewer"}), "B2-reviewer-invites"
    )
    _assert_501(c.put("/api/projects/method/invites/a@b.cn", json={"role": "viewer"}), "B2-reviewer-invites")
    _assert_501(c.delete("/api/projects/method/invites/a@b.cn"), "B2-reviewer-invites")
    _assert_501(c.put("/api/projects/method/members/x", json={"role": "viewer"}))
    assert c.get("/api/projects/method/collab").json()["mode"] == "edit"
    assert rooms.online_user_ids("method") == set()


def test_on_unit_routes_live_and_reviewer_share_role(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    su = _login(on, "su@example.com")
    assert su.get("/api/projects/method/access").status_code == 200  # B1 已实现，详见 test_access
    assert su.get("/api/projects/method/collab-settings").status_code == 200
    assert su.get("/api/projects/method/invites").json() == []  # B2 已实现，详见 test_invites
    r = su.post("/api/projects/method/share", json={"role": "reviewer", "expires_in_days": 7})
    assert r.status_code == 201 and r.json()["role"] == "reviewer" and r.json()["accepted_by"] == []


def test_on_accepted_by_and_member_role_by_uid(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "guest@example.com", display_name="客户")
    su, guest = _login(on, "su@example.com"), _login(on, "guest@example.com")
    link = su.post("/api/projects/method/share", json={"role": "viewer", "expires_in_days": None}).json()
    assert guest.post(f"/api/share/{link['token']}/accept").status_code == 200
    assert guest.post(f"/api/share/{link['token']}/accept").status_code == 200  # 重复领取只记一次
    links = su.get("/api/projects/method/share").json()
    assert len(links) == 1
    acc = links[0]["accepted_by"]
    assert len(acc) == 1 and acc[0]["email"] == "guest@example.com" and acc[0]["display_name"] == "客户"
    assert set(acc[0]) == {"user_id", "email", "display_name", "avatar_color", "accepted_at"}

    uid = acc[0]["user_id"]
    assert su.put(f"/api/projects/method/members/{uid}", json={"role": "nope"}).status_code == 422
    assert su.put("/api/projects/method/members/not-a-uuid", json={"role": "viewer"}).status_code == 404
    r = su.put(f"/api/projects/method/members/{uid}", json={"role": "reviewer"})
    assert r.status_code == 200 and [m["role"] for m in r.json()] == ["reviewer"]
    assert guest.get("/api/projects/method/collab").json()["mode"] == "review"
    assert guest.put(f"/api/projects/method/members/{uid}", json={"role": "owner"}).status_code == 403
    # 最后一个 owner 不能降级
    r = su.put(f"/api/projects/method/members/{uid}", json={"role": "owner"})
    assert r.status_code == 200
    assert su.put(f"/api/projects/method/members/{uid}", json={"role": "editor"}).status_code == 409


def test_on_reviewer_source_writes_are_403_until_b2(on):
    """reviewer 对三条写路由直接改字一律 403 detail=reviewer（纯建议通过见 test_reviewer）；
    viewer 403 detail=reviewer 门槛。"""
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "rev@example.com")
    _register(anon, "view@example.com")
    su, rev, view = _login(on, "su@example.com"), _login(on, "rev@example.com"), _login(on, "view@example.com")
    su.put("/api/projects/method/members", json={"email": "rev@example.com", "role": "reviewer"})
    su.put("/api/projects/method/members", json={"email": "view@example.com", "role": "viewer"})
    content = rev.get("/api/projects/method/content").json()["content"]

    r = rev.put("/api/projects/method/content", json={"content": content.replace("方法", "方案", 1)})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    r = rev.put("/api/projects/method/docs/abstract", json={"content": "x"})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    block = rev.get("/api/projects/method/ast").json()["claims"][0]["id"]
    r = rev.post(f"/api/projects/method/blocks/{block}", json={"markdown": "1. 改了"})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    assert rev.get("/api/projects/method/content").json()["content"] == content  # 没落盘

    r = view.put("/api/projects/method/content", json={"content": content})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    assert su.put("/api/projects/method/content", json={"content": content}).status_code == 200
