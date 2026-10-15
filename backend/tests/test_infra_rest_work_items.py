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
