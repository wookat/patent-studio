# -*- coding: utf-8 -*-
"""B1-access-log（docs/plan/14 §2.1 / §2.2 / §4 / §8 B1 行）：
project_access 去抖 upsert、GET /access（viewed / not_viewed / online）、collab-settings 默认与合并、AUTH=off 501。
夹具复用 test_auth（on / client / _register / _login）与 test_collab（env / serve / client：真实 WebSocket 在线）。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import test_auth
import test_collab
from fastapi.testclient import TestClient

from app.auth import access

on = test_auth.on
client = test_auth.client
env = test_collab.env
_register, _login = test_auth._register, test_auth._login
_assert_501 = test_auth._assert_501


def test_debounce_constant_and_defaults():
    assert access.ACCESS_DEBOUNCE.total_seconds() == 30 * 60
    assert access.DEFAULT_SETTINGS == {
        "allow_download": True,
        "allow_copy": True,
        "allow_comment": True,
    }


def test_off_routes_are_501_with_unit_name(client):
    c, _ = client
    _assert_501(c.get("/api/projects/method/access"), "B1-access-log")
    _assert_501(c.get("/api/projects/method/collab-settings"), "B1-access-log")
    _assert_501(c.put("/api/projects/method/collab-settings", json={"allow_download": False}), "B1-access-log")


def _viewed(c, pid="method"):
    r = c.get(f"/api/projects/{pid}/access")
    assert r.status_code == 200, r.text
    return r.json()


def test_touch_debounce(on, monkeypatch):
    """首开 count=1；30 分钟内再开只更 last_seen；≥30 分钟 count+1；first_seen 不变。"""
    anon = TestClient(on.app)
    su_id = _register(anon, "su@example.com", display_name="管理员")["id"]
    su = _login(on, "su@example.com")
    assert _viewed(su) == {"viewed": [], "not_viewed": []}  # 列访问记录本身不算访问

    assert su.get("/api/projects/method").status_code == 200
    (row,) = _viewed(su)["viewed"]
    assert row["user"] == {
        "user_id": su_id,
        "email": "su@example.com",
        "display_name": "管理员",
        "avatar_color": "",
        "role": "owner",
    }
    assert row["count"] == 1 and row["online"] is False
    first_seen, last_seen = row["first_seen"], row["last_seen"]
    assert datetime.fromisoformat(first_seen).tzinfo is not None  # ISO 带 UTC 时区
    assert datetime.now(UTC) - datetime.fromisoformat(last_seen) < timedelta(seconds=30)

    assert su.get("/api/projects/method").status_code == 200  # 去抖窗口内
    (row,) = _viewed(su)["viewed"]
    assert row["count"] == 1 and row["first_seen"] == first_seen and row["last_seen"] >= last_seen

    monkeypatch.setattr(access, "ACCESS_DEBOUNCE", timedelta(0))  # 视作已过 30 分钟
    assert su.get("/api/projects/method").status_code == 200
    (row,) = _viewed(su)["viewed"]
    assert row["count"] == 2 and row["first_seen"] == first_seen and row["last_seen"] > last_seen

    # 直接调 touch：无行 ⇒ 新建 count=1（另一案子），不影响 method 的行
    asyncio.run(access.touch("other", type("U", (), {"id": uuid.UUID(su_id)})()))
    assert _viewed(su, "other")["viewed"][0]["count"] == 1
    assert _viewed(su)["viewed"][0]["count"] == 2


def test_access_viewed_not_viewed_and_share_accept(on):
    """两用户访问；未访问成员 / 待接受邀请列在 not_viewed；经链接进入者被记录；owner 门槛。"""
    anon = TestClient(on.app)
    su_id = _register(anon, "su@example.com")["id"]
    ed_id = _register(anon, "editor@example.com", display_name="代理人")["id"]
    vw_id = _register(anon, "viewer@example.com")["id"]
    _register(anon, "guest@example.com", display_name="客人")
    su, ed, vw, guest = (_login(on, f"{n}@example.com") for n in ("su", "editor", "viewer", "guest"))
    for email, role in (("editor@example.com", "editor"), ("viewer@example.com", "viewer")):
        assert su.put("/api/projects/method/members", json={"email": email, "role": role}).status_code == 200

    # 权限：owner 才能看访问记录；匿名 401
    assert ed.get("/api/projects/method/access").status_code == 403
    assert vw.get("/api/projects/method/access").status_code == 403
    assert anon.get("/api/projects/method/access").status_code == 401

    assert ed.get("/api/projects/method").status_code == 200
    assert su.get("/api/projects/method").status_code == 200

    # 待接受邀请（pending_invites 由 B2 写入；这里直接落行）
    from app.auth.db import SessionLocal
    from app.auth.models import PendingInvite

    async def _invite():
        async with SessionLocal() as s:
            s.add(
                PendingInvite(
                    project_id="method", email="new@example.com", role="reviewer", invited_by=uuid.UUID(su_id)
                )
            )
            await s.commit()

    asyncio.run(_invite())

    rep = _viewed(su)
    assert [(r["user"]["user_id"], r["user"]["role"], r["count"]) for r in rep["viewed"]] == [
        (su_id, "owner", 1),
        (ed_id, "editor", 1),
    ]  # 按 last_seen 倒序
    assert rep["viewed"][1]["user"]["display_name"] == "代理人"
    assert rep["not_viewed"] == [
        {
            "user": {
                "user_id": vw_id,
                "email": "viewer@example.com",
                "display_name": "",
                "avatar_color": "",
                "role": "viewer",
            },
            "email": "viewer@example.com",
            "via": "member",
        },
        {"user": None, "email": "new@example.com", "via": "invite"},
    ]

    # 经分享链接进入：accept ⇒ ACL 行 + 访问记录 + accepted_by
    link = su.post("/api/projects/method/share", json={"role": "reviewer", "expires_in_days": 7}).json()
    r = guest.post(f"/api/share/{link['token']}/accept")
    assert r.status_code == 200 and r.json() == {"pid": "method", "role": "reviewer"}
    rep = _viewed(su)
    top = rep["viewed"][0]
    assert top["user"]["email"] == "guest@example.com" and top["user"]["role"] == "reviewer" and top["count"] == 1
    assert [x["email"] for x in su.get("/api/projects/method/share").json()[0]["accepted_by"]] == ["guest@example.com"]

    # 同一用户再领取同一链接：去抖窗口内不重复计数
    assert guest.post(f"/api/share/{link['token']}/accept").status_code == 200
    assert _viewed(su)["viewed"][0]["count"] == 1

    # 移除成员后访问记录仍在（历史事实）；再清掉访问行 ⇒ 作为链接领取人列入 not_viewed via=link
    gid = top["user"]["user_id"]
    assert su.delete(f"/api/projects/method/members/{gid}").status_code == 200
    assert _viewed(su)["viewed"][0]["user"]["role"] is None
    from app.auth.models import ProjectAccess

    async def _forget():
        async with SessionLocal() as s:
            await s.delete(await s.get(ProjectAccess, ("method", uuid.UUID(gid))))
            await s.commit()

    asyncio.run(_forget())
    rep = _viewed(su)
    assert [r["user"]["user_id"] for r in rep["viewed"]] == [su_id, ed_id]
    assert [(r["via"], r["email"]) for r in rep["not_viewed"]] == [
        ("member", "viewer@example.com"),
        ("link", "guest@example.com"),
        ("invite", "new@example.com"),
    ]
    assert rep["not_viewed"][1]["user"] == {
        "user_id": gid,
        "email": "guest@example.com",
        "display_name": "客人",
        "avatar_color": "",
        "role": None,
    }


def test_online_from_collab_room(env):
    """online = 该用户在本案任一 Yjs 房间有活动连接（rooms.online_user_ids）。"""
    c, _pdir, _ = env("on", auth=True)
    with test_collab.serve(c.app) as base:
        test_collab._register(base, "su@example.com")
        test_collab._register(base, "editor@example.com")
        su, ed = test_collab._login(base, "su@example.com"), test_collab._login(base, "editor@example.com")
        r = httpx.put(
            f"{base}/api/projects/method/members",
            json={"email": "editor@example.com", "role": "editor"},
            cookies={"studio_session": su},
        )
        assert r.status_code == 200, r.text
        assert httpx.get(f"{base}/api/projects/method", cookies={"studio_session": ed}).status_code == 200

        def online():
            rep = httpx.get(f"{base}/api/projects/method/access", cookies={"studio_session": su}).json()
            return {row["user"]["email"]: row["online"] for row in rep["viewed"]}

        assert online() == {"editor@example.com": False}

        async def flow():
            async with test_collab.client(base, "claims", cookie=ed):
                assert online() == {"editor@example.com": True}
            await test_collab.until(lambda: online() == {"editor@example.com": False})

        asyncio.run(flow())


def test_collab_settings(on):
    """缺行默认全 true；PUT 只合并给出的字段；viewer 可 GET、不可 PUT；owner（非超管）可 PUT。"""
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "owner2@example.com")
    _register(anon, "viewer@example.com")
    su, owner2, vw = (_login(on, f"{n}@example.com") for n in ("su", "owner2", "viewer"))
    for email, role in (("owner2@example.com", "owner"), ("viewer@example.com", "viewer")):
        assert su.put("/api/projects/method/members", json={"email": email, "role": role}).status_code == 200

    assert vw.get("/api/projects/method/collab-settings").json() == access.DEFAULT_SETTINGS
    assert anon.get("/api/projects/method/collab-settings").status_code == 401
    r = vw.put("/api/projects/method/collab-settings", json={"allow_download": False})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "owner"
    assert vw.get("/api/projects/method/collab-settings").json() == access.DEFAULT_SETTINGS  # 被拒的写不落库

    r = owner2.put("/api/projects/method/collab-settings", json={"allow_download": False})
    assert r.status_code == 200
    assert r.json() == {"allow_download": False, "allow_copy": True, "allow_comment": True}
    r = su.put("/api/projects/method/collab-settings", json={"allow_comment": False})
    assert r.json() == {"allow_download": False, "allow_copy": True, "allow_comment": False}
    assert su.put("/api/projects/method/collab-settings", json={}).json() == r.json()  # 空 patch 不改
    assert vw.get("/api/projects/method/collab-settings").json() == r.json()
    assert su.get("/api/projects/other/collab-settings").json() == access.DEFAULT_SETTINGS  # 各案独立
    assert su.put("/api/projects/method/collab-settings", json={"allow_download": "x"}).status_code == 422


def test_concurrent_first_write_no_integrity_error(on):
    """R84：并发首写同一 PK（touch/collab-settings/邀请）——插入撞 UNIQUE 时回滚重取而非冒 500。"""
    from app.auth import invites

    async def go():
        uid = uuid.uuid4()
        user = type("U", (), {"id": uid})()
        await asyncio.gather(
            access.touch("race", user),
            access.touch("race", user),
            invites.create_pending("race", "a@b.co", "viewer", uid),
            invites.create_pending("race", "a@b.co", "editor", uid),
            access.put_settings("race", {"allow_copy": False}),
            access.put_settings("race", {"allow_download": False}),
        )
        assert str(uid) in await access.last_seen_by_user("race")
        pending = await invites.list_pending("race")
        assert len(pending) == 1 and pending[0]["email"] == "a@b.co"

    asyncio.run(go())
