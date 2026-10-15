# -*- coding: utf-8 -*-
"""W5 notify-audit-backend：站内通知（events → notifications 表）+ 催办 + 可选 SMTP。"""

import asyncio
import logging
import os
from datetime import timedelta

import test_legacy_auth as test_auth
from fastapi.testclient import TestClient
from test_legacy_auth import _login, _register

from app import notify
from app.domain import cases, events
from app.notify import mail

client = test_auth.client  # pytest fixture
on = test_auth.on  # pytest fixture


def _seed(on):
    """su 是案 method 的责任人；staff 是 agent（催办门槛，acl.ROUTE_ROLE）。返回 (su_c, staff_c, su, staff)。"""
    notify.install()  # test_w5_prep 会 events.reset()，这里保证订阅在位
    anon = TestClient(on.app)
    su = _register(anon, "su@example.com", display_name="王管理员")
    staff = _register(anon, "staff@example.com", display_name="小李")
    su_c = _login(on, "su@example.com")
    staff_c = _login(on, "staff@example.com")
    r = su_c.put("/api/projects/method/members", json={"email": "staff@example.com", "role": "agent"})
    assert r.status_code == 200, r.text
    d = _project_dir("method")
    cases.claim_owner(d, su["id"])
    return su_c, staff_c, su, staff


def _project_dir(pid: str) -> str:
    from app import config

    return os.path.join(config.PROJECTS_DIR, pid)


def _unread(c) -> int:
    return c.get("/api/notify?unread=1").json()["unread"]


# ---------------------------------------------------------------- off ----


def test_off_mode_lists_empty_and_writes_nothing(client):
    c, tmp = client
    notify.install()
    assert c.get("/api/notify").json() == {"items": [], "unread": 0, "has_more": False}
    assert c.post("/api/notify/read-all").json() == {"updated": 0}
    assert c.post("/api/notify/x/read").status_code == 404
    events.emit("deadline.due", pid="method", data={"due": "2026-10-01", "days_left": 6})
    assert not os.path.exists(os.path.join(tmp, "studio.db"))  # off 不建库
    assert c.post("/api/projects/method/nudge", json={}).json() == {"notified": 0}


# ---------------------------------------------------------------- 期限 → 责任人 ----


def test_deadline_due_notifies_owner_once(on, caplog):
    su_c, staff_c, su, staff = _seed(on)
    d = _project_dir("method")
    due = (cases.local_today() + timedelta(days=6)).isoformat()
    case = cases.load_case(d)
    case.deadlines.append(cases.Deadline(kind="oa_reply", due=due, note="答复一通"))
    cases.save_case(d, case)
    assert _unread(su_c) == 0

    with caplog.at_level(logging.WARNING):
        events.emit(
            "deadline.due",
            pid="method",
            data={"kind": "oa_reply", "title": "答复一通", "due": due, "days_left": 6, "threshold": 7},
        )
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], caplog.text  # 未配 SMTP：静默

    r = su_c.get("/api/notify?unread=1")
    assert r.status_code == 200, r.text
    assert r.json()["unread"] == 1 and len(r.json()["items"]) == 1
    n = r.json()["items"][0]
    assert n["kind"] == "deadline" and n["pid"] == "method" and n["read"] is False
    assert "6 天" in n["title"] and "答复一通" in n["title"] and due in n["body"]
    assert n["href"] == "#/p/method?panel=deadlines" and n["actor"] is None
    assert set(n) == {"id", "kind", "title", "body", "href", "pid", "actor", "read", "created_at"}
    assert _unread(staff_c) == 1  # 非责任人不收（基线 = _seed 加成员那条 system 通知）

    # 指定 user_id 时只发给他；带 deadline_id ⇒ href 落点精确到期限行（?panel=deadlines&dl=<id>）
    events.emit(
        "deadline.due",
        pid="method",
        data={"due": due, "days_left": 0, "user_id": staff["id"], "deadline_id": "oa_reply:r2"},
    )
    assert _unread(su_c) == 1 and _unread(staff_c) == 2
    n2 = staff_c.get("/api/notify").json()["items"][0]
    assert "今天到期" in n2["title"] and n2["href"] == "#/p/method?panel=deadlines&dl=oa_reply:r2"


# ---------------------------------------------------------------- 已读 ----


def test_read_one_and_read_all_are_per_user(on):
    su_c, staff_c, su, staff = _seed(on)
    events.emit(
        "comment.mention",
        pid="method",
        actor={"id": staff["id"], "display_name": "小李", "avatar_color": ""},
        data={"cid": "c9", "user_ids": [su["id"], staff["id"]], "quote": "请确认权利要求 3"},
    )
    items = su_c.get("/api/notify").json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "mention"
    assert items[0]["href"] == "#/p/method?c=c9" and items[0]["body"] == "请确认权利要求 3"
    assert items[0]["actor"] == {"id": staff["id"], "display_name": "小李", "avatar_color": ""}
    assert _unread(staff_c) == 1  # 自己 @ 自己不收（1 = _seed 的 member.changed）

    nid = items[0]["id"]
    assert staff_c.post(f"/api/notify/{nid}/read").status_code == 404  # 别人的通知
    r = su_c.post(f"/api/notify/{nid}/read")
    assert r.status_code == 200 and r.json()["read"] is True and r.json()["id"] == nid
    assert su_c.post(f"/api/notify/{nid}/read").json()["read"] is True  # 幂等
    assert _unread(su_c) == 0
    assert su_c.get("/api/notify?unread=1").json()["items"] == []
    assert len(su_c.get("/api/notify").json()["items"]) == 1  # 全部列表仍在

    events.emit("comment.assign", pid="method", actor={"id": staff["id"]}, data={"cid": "c1", "user_id": su["id"]})
    events.emit(
        "ai.proposal",
        pid="method",
        actor={"id": staff["id"], "display_name": "小李", "avatar_color": ""},
        data={"proposal_id": "p1", "action": "applied", "title": "补充实施例", "block_id": "b7"},
    )
    events.emit("ai.proposal", pid="method", actor={"id": staff["id"]}, data={"proposal_id": "p2", "action": "created"})
    events.emit("share.confirmed", pid="method", data={"name": "张客户", "version": 2})
    r = su_c.get("/api/notify?unread=1").json()
    assert r["unread"] == 3 and [i["kind"] for i in r["items"]] == ["confirm", "ai", "assign"]
    assert r["items"][1]["href"] == "#/p/method?focus=b7" and "已采纳" in r["items"][1]["title"]
    assert r["items"][0]["title"] == "张客户 已确认第 2 版"
    assert su_c.post("/api/notify/read-all").json() == {"updated": 3}
    assert su_c.post("/api/notify/read-all").json() == {"updated": 0}
    assert _unread(su_c) == 0

    assert TestClient(on.app).get("/api/notify").status_code == 401
    assert TestClient(on.app).post("/api/notify/read-all").status_code == 401


# ---------------------------------------------------------------- 客户免登录批注 / 确认 → 代理师（W7 domain-03）----


def test_client_comment_and_confirm_notify_staff_without_owner(on):
    """案目录直接拷进 PROJECTS_DIR（无 owner_user_id、无 ACL 成员）：超管兜底收到「客户批注」「客户确认」两条通知。
    兜底链要异步查 ACL，用 with TestClient 保住事件循环并在其上 drain。"""
    notify.install()
    with TestClient(on.app) as anon:

        def drain():
            anon.portal.call(notify.drain)

        _register(anon, "su@example.com", display_name="王管理员")
        _register(anon, "other@example.com", display_name="路人")
        su_c = _login(on, "su@example.com")
        other_c = _login(on, "other@example.com")
        assert cases.load_case(_project_dir("method")).owner_user_id is None
        tok = su_c.post(
            "/api/projects/method/public-links", json={"scope": "confirm", "ttl_days": 7, "allow_download": False}
        ).json()["token"]
        assert _unread(su_c) == 0

        anchor = {"book": "abstract", "block_id": "abstract/1", "line": 3}
        r = anon.post(
            f"/api/public/{tok}/comments",
            json={"name": "王经理（客户）", "body": "摘要第二句请改为「系统」", "anchor": anchor},
        )
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        drain()
        items = su_c.get("/api/notify?unread=1").json()["items"]
        assert [i["kind"] for i in items] == ["mention"]
        assert items[0]["title"] == "客户 王经理（客户） 提交了批注" and items[0]["body"] == "摘要第二句请改为「系统」"
        assert items[0]["href"] == f"#/p/method?c={cid}" and items[0]["pid"] == "method" and items[0]["actor"] is None

        r = anon.post(f"/api/public/{tok}/confirm", json={"name": "王经理", "note": "同意定稿"})
        assert r.status_code == 200, r.text
        drain()
        items = su_c.get("/api/notify?unread=1").json()["items"]
        assert [i["kind"] for i in items] == ["confirm", "mention"]
        assert items[0]["title"].startswith("王经理 已确认") and items[0]["body"] == "同意定稿"
        assert _unread(other_c) == 0  # 非超管、非成员不收

        # 有 owner 成员时只发 owner（不再兜底给超管）
        r = su_c.put("/api/projects/method/members", json={"email": "other@example.com", "role": "owner"})
        assert r.status_code == 200, r.text
        anon.post(f"/api/public/{tok}/comments", json={"name": "王经理", "body": "再补一句", "anchor": anchor})
        drain()
        assert _unread(other_c) == 2 and _unread(su_c) == 2  # other：owner 变更通知 + 客户批注


# ---------------------------------------------------------------- 催办 ----


def test_list_pagination_before_id(on):
    """before_id 游标翻页：limit+1 探 has_more；页间不重不漏；锚点无效回首页（前端去重）"""
    su_c, staff_c, su, staff = _seed(on)
    for i in range(5):
        events.emit(
            "comment.mention",
            pid="method",
            actor={"id": staff["id"], "display_name": "小李"},
            data={"cid": f"cp{i}", "user_ids": [su["id"]], "quote": f"q{i}"},
        )
    # member.changed 发给被加的 staff 不发 su：su 收件箱 = 5 条提及
    r1 = su_c.get("/api/notify?limit=3").json()
    assert len(r1["items"]) == 3 and r1["has_more"] is True
    r2 = su_c.get(f"/api/notify?limit=3&before_id={r1['items'][-1]['id']}").json()
    ids1, ids2 = {i["id"] for i in r1["items"]}, {i["id"] for i in r2["items"]}
    assert not ids1 & ids2 and len(r2["items"]) == 2 and r2["has_more"] is False
    assert r2["unread"] == r1["unread"]  # 未读数不随翻页变
    # 未读流也分页
    ru = su_c.get(f"/api/notify?unread=1&limit=2&before_id={r1['items'][-1]['id']}").json()
    assert all(not i["read"] for i in ru["items"]) and len(ru["items"]) == 2
    # 锚点不存在/非法（通知 id 是 token_urlsafe 非 uuid，任意 str 都合法）→ 回首页
    for bad in ("zzz-nonexistent", "garbage", r1["items"][-1]["id"] + "x"):
        r3 = su_c.get(f"/api/notify?limit=3&before_id={bad}").json()
        assert {i["id"] for i in r3["items"]} == ids1, bad
    # 锚点属他人 → 同样回首页
    foreign = staff_c.get("/api/notify?limit=1").json()["items"][0]["id"]
    r4 = su_c.get(f"/api/notify?limit=3&before_id={foreign}").json()
    assert {i["id"] for i in r4["items"]} == ids1


def test_nudge_notifies_target_once(on):
    su_c, staff_c, su, staff = _seed(on)
    got = []
    off = events.subscribe("deadline.nudge", lambda e: got.append(e))

    # staff（agent）催责任人 su：不带 user_id ⇒ 案责任人
    r = staff_c.post("/api/projects/method/nudge", json={"message": "今天能出稿吗"})
    assert r.status_code == 200, r.text
    assert r.json() == {"notified": 1}
    assert _unread(su_c) == 1 and _unread(staff_c) == 1  # staff 基线 1 = member.changed
    n = su_c.get("/api/notify").json()["items"][0]
    assert n["kind"] == "nudge" and n["body"] == "今天能出稿吗" and n["title"].startswith("小李 催办：")
    assert n["actor"]["id"] == staff["id"] and n["href"] == "#/p/method?panel=deadlines"
    assert len(got) == 1 and got[0].pid == "method" and got[0].data["user_id"] == su["id"]

    # su 指定 staff 催办 ⇒ staff 未读 +1（su 自己不变）
    r = su_c.post("/api/projects/method/nudge", json={"user_id": staff["id"], "deadline_id": "d-none"})
    assert r.json() == {"notified": 1}
    assert _unread(staff_c) == 2 and _unread(su_c) == 1

    # 边界
    r = su_c.post("/api/projects/method/nudge", json={})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"  # 责任人就是自己
    r = su_c.post("/api/projects/method/nudge", json={"user_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    assert su_c.post("/api/projects/nope/nudge", json={}).status_code in (403, 404)
    assert TestClient(on.app).post("/api/projects/method/nudge", json={}).status_code == 401
    # editor / viewer 低于 agent 门槛（acl.ROUTE_ROLE，权限语义不变）
    for email, role in (("ed@example.com", "editor"), ("vw@example.com", "viewer")):
        _register(TestClient(on.app), email)
        su_c.put("/api/projects/method/members", json={"email": email, "role": role})
        assert _login(on, email).post("/api/projects/method/nudge", json={}).status_code == 403
    off()
    assert _unread(staff_c) == 2 and _unread(su_c) == 1  # 被拒的催办不落库


# ---------------------------------------------------------------- 机构默认协作 → 新案 ----


def test_case_created_applies_org_default_collab(on):
    su_c, staff_c, su, staff = _seed(on)
    assert su_c.put("/api/admin/settings", json={"default_collab": {"allow_viewer_comment": False}}).status_code == 200
    r = su_c.post("/api/projects", json={"id": "newcase", "title": "新案"})
    assert r.status_code == 201, r.text
    s = su_c.get("/api/projects/newcase/collab-settings").json()
    assert s == {"allow_download": True, "allow_copy": True, "allow_comment": False}
    assert su_c.get("/api/projects/method/collab-settings").json()["allow_comment"] is True  # 旧案不动


# ---------------------------------------------------------------- SMTP ----


def test_mail_unconfigured_is_silent(monkeypatch, caplog):
    monkeypatch.delenv(mail.ENV, raising=False)
    assert mail.configured() is False and mail.status() is None
    with caplog.at_level(logging.DEBUG):
        assert asyncio.run(mail.send("a@example.com", "s", "b")) is False
    assert [r for r in caplog.records if r.name.startswith("patent_studio")] == []


def test_mail_status_hides_password_and_failure_is_warning_only(monkeypatch, caplog):
    monkeypatch.setenv(mail.ENV, "smtps://bot%40ip.example:s3cret-pw@127.0.0.1:1?from=noreply@ip.example")
    st = mail.status()
    assert st.model_dump(by_alias=True) == {
        "host": "127.0.0.1",
        "port": 1,
        "user": "bot@ip.example",
        "from": "noreply@ip.example",
        "enabled": True,
    }
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(mail.send("a@example.com", "s", "b")) is False  # 端口 1 连不上
    assert len(caplog.records) == 1 and "s3cret-pw" not in caplog.text
    monkeypatch.setenv(mail.ENV, "smtp://[bad")
    assert mail.status().enabled is False


def test_mail_sent_with_notification_when_configured(on, monkeypatch):
    su_c, staff_c, su, staff = _seed(on)
    sent = []
    monkeypatch.setenv(mail.ENV, "smtp://u:p@127.0.0.1:2525")
    monkeypatch.setattr(mail, "_send_sync", lambda url, to, subject, body: sent.append((to, subject, body)))
    events.emit(
        "comment.assign",
        pid="method",
        actor={"id": staff["id"], "display_name": "小李", "avatar_color": ""},
        data={"user_id": su["id"], "due": "2026-10-01"},
    )
    asyncio.run(notify.drain())
    assert _unread(su_c) == 1
    assert sent == [("su@example.com", "[Patent Studio] 小李 指派你审阅", "截止 2026-10-01")]


def test_comment_mention_href_deep_links_to_comment(on):
    """R56-01：@成员 → 收件人通知 href 带 ?c=<批注 id>（emit 契约键是 cid，曾发 comment_id 丢落点）。"""
    su_c, staff_c, _su, _staff = _seed(on)
    r = su_c.post(
        "/api/projects/method/comments",
        json={"anchor": {"block_id": "claims/1", "line": 10, "quote": "请复核"}, "body": "@小李 看一下"},
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    items = staff_c.get("/api/notify").json()["items"]
    assert [i["kind"] for i in items] == ["mention", "system"]  # system = _seed 的 member.changed
    assert items[0]["href"] == f"#/p/method?c={cid}"


def test_member_changed_notifies_target(on):
    """R61-01：成员角色变更 / 移除 → 被变更者收 system 通知（前端轮询到即刷新 project.role）。"""
    su_c, staff_c, _su, staff = _seed(on)
    # 案名取 case_no（load_case 收目录非 pid——传 pid 会静默落回默认案、永远显示 pid）
    d = _project_dir("method")
    case = cases.load_case(d)
    case.case_no = "202610012345.6"
    cases.save_case(d, case)
    # _seed 里 PUT /members 把 staff 加成 agent → 已有一条变更通知
    items = staff_c.get("/api/notify").json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "system"
    assert "代理人" in items[0]["title"] and items[0]["pid"] == "method" and items[0]["href"] == "#/p/method"
    assert su_c.get("/api/notify").json()["items"] == []  # 操作者不收自己触发的
    # 降级 reviewer → 再收一条，案名显示申请号
    r = su_c.put(f"/api/projects/method/members/{staff['id']}", json={"role": "reviewer"})
    assert r.status_code == 200, r.text
    items = staff_c.get("/api/notify").json()["items"]
    assert len(items) == 2 and "审阅者" in items[0]["title"] and "202610012345.6" in items[0]["title"]
    # 移除 → 「移出」通知、无 href（已无访问权）
    r = su_c.delete(f"/api/projects/method/members/{staff['id']}")
    assert r.status_code == 200, r.text
    items = staff_c.get("/api/notify").json()["items"]
    assert len(items) == 3 and "移出" in items[0]["title"] and items[0]["href"] is None


def test_comment_mention_email_localpart_and_ambiguity(on):
    """R64-02：无 display_name 的成员可按 email 本地段被 @；本地段撞名（多人命中）该条跳过不盲发。"""
    notify.install()
    anon = TestClient(on.app)
    _register(anon, "su@example.com", display_name="管理员")
    _register(anon, "solo@x.cn")  # 无显示名——只能按本地段 'solo' @
    _register(anon, "dup@a.cn")
    _register(anon, "dup@b.cn")
    su_c = _login(on, "su@example.com")
    solo_c = _login(on, "solo@x.cn")
    dupa_c = _login(on, "dup@a.cn")
    dupb_c = _login(on, "dup@b.cn")
    for email in ("solo@x.cn", "dup@a.cn", "dup@b.cn"):
        assert su_c.put("/api/projects/method/members", json={"email": email, "role": "viewer"}).status_code == 200

    anchor = {"block_id": "claims/1", "line": 9, "quote": "其特征在于"}

    def post(body: str):
        return su_c.post("/api/projects/method/comments", json={"anchor": anchor, "body": body})

    assert post("@solo 看下这条").status_code == 201  # 本地段命中
    assert post("@dup 这条撞名").status_code == 201  # 撞名——不应给任何一方发通知

    solo_kinds = [i["kind"] for i in solo_c.get("/api/notify").json()["items"]]
    assert "mention" in solo_kinds, solo_kinds  # 本地段命中
    for c in (dupa_c, dupb_c):  # 撞名 → 两人都不收
        assert not [i for i in c.get("/api/notify").json()["items"] if i["kind"] == "mention"]
