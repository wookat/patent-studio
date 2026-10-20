# -*- coding: utf-8 -*-
"""B9：/api/v1 work-items / notifications 面 scoped 冒烟。

分派落通知（record_notification 同事务写库）、通知列表+已读幂等、
期限/状态更新、越权 fail-closed、幂等重放。
"""

import uuid
from datetime import UTC, datetime, timedelta

from test_infra_rest_org_case import _rest_case, _rest_user

pytest_plugins = ("test_auth",)


def test_work_item_assignment_writes_notification_and_read_is_idempotent(on, pg_schema):
    owner = _rest_user(on, "b9-wi-owner")
    _org, case = _rest_case(owner, "b9wi")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]

    item = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "b9-wi-create"},
        json={"type": "review", "title": "审阅权利要求书", "priority": 2},
    )
    assert item.status_code == 201 and item.json()["status"] == "open"
    item_id = item.json()["id"]

    assigned = owner.put(
        f"/api/v1/work-items/{item_id}/assignment",
        headers={"Idempotency-Key": "b9-wi-assign"},
        json={"assignee_principal_id": owner_pid},
    )
    assert assigned.status_code == 200 and assigned.json()["assignee_principal_id"] == owner_pid

    # 分派产生 work_item.assigned 通知（同事务入库）
    notices = owner.get("/api/v1/notifications").json()
    mine = [n for n in notices if n.get("work_item_id") == item_id]
    assert len(mine) == 1 and mine[0]["notification_type"] == "work_item.assigned"
    assert mine[0]["read_at"] is None

    read = owner.post(
        f"/api/v1/notifications/{mine[0]['id']}/read",
        headers={"Idempotency-Key": "b9-wi-read"},
        json={},
    )
    assert read.status_code == 200 and read.json()["read_at"] is not None

    # 幂等重放：同 key 再 read 不重写
    replay = owner.post(
        f"/api/v1/notifications/{mine[0]['id']}/read",
        headers={"Idempotency-Key": "b9-wi-read"},
        json={},
    )
    assert replay.status_code == 200 and replay.json() == read.json()

    # 期限 + 状态机
    deadline = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    moved = owner.put(
        f"/api/v1/work-items/{item_id}/deadline",
        headers={"Idempotency-Key": "b9-wi-deadline"},
        json={"deadline": deadline},
    )
    assert moved.status_code == 200 and moved.json()["deadline"] is not None
    transit = owner.put(
        f"/api/v1/work-items/{item_id}/status",
        headers={"Idempotency-Key": "b9-wi-status"},
        json={"status": "in_progress"},
    )
    assert transit.status_code == 200 and transit.json()["status"] == "in_progress"

    # 列表口径：case 内 + 跨案件队列均可见
    assert [i["id"] for i in owner.get(f"/api/v1/cases/{case['id']}/work-items").json()] == [item_id]
    assert item_id in [i["id"] for i in owner.get("/api/v1/work-items").json()]


def _invite_org_member(owner, organization_id, invitee, role="member"):
    """org-scope 邀请→接受，invitee 成为机构成员。返回 invitee principal_id。"""
    from datetime import UTC, datetime, timedelta

    invitee_pid = invitee.get("/api/v1/principals/me").json()["id"]
    inv = owner.post(
        f"/api/v1/organizations/{organization_id}/invitations",
        headers={"Idempotency-Key": f"wi-org-inv-{uuid.uuid4().hex[:8]}"},
        json={
            "invitee_principal_id": invitee_pid,
            "role": role,
            "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
        },
    )
    assert inv.status_code == 201, inv.text
    acc = invitee.post(
        f"/api/v1/invitations/{inv.json()['id']}/accept",
        headers={"Idempotency-Key": f"wi-org-acc-{uuid.uuid4().hex[:8]}"},
    )
    assert acc.status_code == 200, acc.text
    return invitee_pid


def test_assignee_only_can_start_assigned_work_item(on, pg_schema):
    """Z12：登记→分派（Participant role=agent）→ 只有承办人本人能 in_progress。"""
    owner = _rest_user(on, "z12-owner")
    agent = _rest_user(on, "z12-agent")
    org, case = _rest_case(owner, "z12")
    agent_pid = _invite_org_member(owner, org["id"], agent)

    # 机构列表：成员可见
    assert org["id"] in [o["id"] for o in owner.get("/api/v1/organizations").json()]
    assert org["id"] in [o["id"] for o in agent.get("/api/v1/organizations").json()]
    memberships = owner.get(f"/api/v1/organizations/{org['id']}/memberships").json()
    mine = [m for m in memberships if m["principal_id"] == agent_pid]
    assert mine and mine[0]["role"] == "member" and mine[0]["display_name"]

    # 分派为案件 Participant role=agent
    part = owner.post(
        f"/api/v1/cases/{case['id']}/participants",
        headers={"Idempotency-Key": "z12-part"},
        json={"principal_id": agent_pid, "role": "agent"},
    )
    assert part.status_code == 201, part.text
    assert case["status"] == "intake"

    item = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "z12-wi"},
        json={"type": "draft", "title": "撰写三书", "priority": 2, "assignee_principal_id": agent_pid},
    )
    assert item.status_code == 201, item.text
    item_id = item.json()["id"]

    # 管理者（非承办人）不能代开 in_progress
    denied = owner.put(
        f"/api/v1/work-items/{item_id}/status",
        headers={"Idempotency-Key": "z12-mgr-start"},
        json={"status": "in_progress"},
    )
    assert denied.status_code == 403, denied.text

    # 承办人开始处理；但终态仍归管理者
    started = agent.put(
        f"/api/v1/work-items/{item_id}/status",
        headers={"Idempotency-Key": "z12-start"},
        json={"status": "in_progress"},
    )
    assert started.status_code == 200 and started.json()["status"] == "in_progress"
    denied = agent.put(
        f"/api/v1/work-items/{item_id}/status",
        headers={"Idempotency-Key": "z12-done"},
        json={"status": "done"},
    )
    assert denied.status_code == 403, denied.text

    # 未分派工作项仍由管理者流转
    free = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "z12-free"},
        json={"type": "search", "title": "查新", "priority": 3},
    ).json()
    free_start = owner.put(
        f"/api/v1/work-items/{free['id']}/status",
        headers={"Idempotency-Key": "z12-free-start"},
        json={"status": "in_progress"},
    )
    assert free_start.status_code == 200

    # 非成员承办人对他人工作项一律 fail-closed
    other = _rest_user(on, "z12-other")
    denied = other.put(
        f"/api/v1/work-items/{item_id}/status",
        headers={"Idempotency-Key": "z12-other"},
        json={"status": "in_progress"},
    )
    assert denied.status_code in (403, 404), denied.text


def test_work_items_and_notifications_fail_closed_for_outsider(on, pg_schema):
    owner = _rest_user(on, "b9-out-owner")
    outsider = _rest_user(on, "b9-out-side")
    _org, case = _rest_case(owner, "b9out")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]

    item = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "b9-out-create"},
        json={"type": "review", "title": "审阅", "priority": 3},
    ).json()
    owner.put(
        f"/api/v1/work-items/{item['id']}/assignment",
        headers={"Idempotency-Key": "b9-out-assign"},
        json={"assignee_principal_id": owner_pid},
    )

    # outsider：case 列表 403、跨案件队列不泄露该行
    denied = outsider.get(f"/api/v1/cases/{case['id']}/work-items")
    assert denied.status_code == 403 and denied.json()["detail"]["kind"] == "denied"
    assert item["id"] not in [i["id"] for i in outsider.get("/api/v1/work-items").json()]

    # outsider：逐项写操作 fail-closed
    outsider_pid = outsider.get("/api/v1/principals/me").json()["id"]
    for path, payload in (
        (f"/api/v1/work-items/{item['id']}/assignment", {"assignee_principal_id": outsider_pid}),
        (f"/api/v1/work-items/{item['id']}/deadline", {"deadline": "2030-01-01T00:00:00+00:00"}),
        (f"/api/v1/work-items/{item['id']}/status", {"status": "done"}),
    ):
        denied = outsider.put(
            path,
            headers={"Idempotency-Key": f"b9-out-{uuid.uuid4().hex[:8]}"},
            json=payload,
        )
        assert denied.status_code in (403, 404), denied.text

    # outsider 的通知列表为空、审批收件箱不含该案项
    assert outsider.get("/api/v1/notifications").json() == []
    assert item["id"] not in [a.get("work_item_id") for a in outsider.get("/api/v1/approvals").json()]

    # 他人的通知不可读（owner 的通知 id 对 outsider 报 403）
    notice_id = owner.get("/api/v1/notifications").json()[0]["id"]
    denied = outsider.post(
        f"/api/v1/notifications/{notice_id}/read",
        headers={"Idempotency-Key": "b9-out-read"},
        json={},
    )
    assert denied.status_code == 403


def test_work_items_queue_list_embeds_case_metadata(on, pg_schema):
    """Z29 收口：GET /work-items 队列项随附 case 元数据（前端不再回拉全量 /cases）；越权案仍被过滤。"""
    owner = _rest_user(on, "z29q-owner")
    outsider = _rest_user(on, "z29q-out")
    _org, case = _rest_case(owner, "z29q")

    item = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "z29q-wi"},
        json={"type": "review", "title": "台账关联复核", "priority": 2},
    )
    assert item.status_code == 201, item.text
    item_id = item.json()["id"]

    rows = owner.get("/api/v1/work-items").json()
    hit = [r for r in rows if r["id"] == item_id]
    assert hit, "owner 的跨案队列应包含其工作项"
    assert hit[0]["case"]["id"] == case["id"]
    assert hit[0]["case"]["case_key"] == case["case_key"]
    assert hit[0]["case"]["title"] == case["title"]
    assert hit[0]["case"]["organization_id"] == _org["id"]

    # 无权限机构/案件的工作项仍被逐条过滤，不泄露行也不泄露 case 元数据
    outsider_rows = outsider.get("/api/v1/work-items").json()
    assert item_id not in [r["id"] for r in outsider_rows]
    assert case["id"] not in [r.get("case", {}).get("id") for r in outsider_rows]

    # 案件内列表维持原 WorkItemOut 口径（不随附 case）
    case_rows = owner.get(f"/api/v1/cases/{case['id']}/work-items").json()
    assert case_rows and "case" not in case_rows[0]
