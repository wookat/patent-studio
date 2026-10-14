# -*- coding: utf-8 -*-
"""平台 /api/v1 org/case 面（B3）：认证 fail-closed、组织/案件/参与者 CRUD、
邀请→接受生命周期、幂等重放。改自参照分支 test_rest_routes.py 的 org/case 段。

`on`/`client`/`_register`/`_login` 基建复用 test_infra_auth（pytest_plugins 引用）。
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from test_infra_auth import _login, _register

pytest_plugins = ("test_infra_auth",)


def _rest_user(on, tag):
    client = TestClient(on.app)
    email = f"{tag}-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    return _login(on, email)


def _rest_case(client, tag):
    organization = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": f"{tag}-org"},
        json={"slug": f"{tag}-{uuid.uuid4().hex[:8]}", "name": "Org"},
    ).json()
    case = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": f"{tag}-case"},
        json={"case_key": f"{tag.upper()}-1", "title": "Case", "kind": "invention"},
    ).json()
    return organization, case


# ------------------------------------------------------- fail-closed ----


def test_platform_route_requires_authenticated_principal(client):
    client, _ = client
    response = client.get("/api/v1/principals/me")
    assert response.status_code == 401
    assert response.json()["detail"]["kind"] == "auth"


def test_platform_openapi_is_exposed(client):
    client, _ = client
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/organizations" in paths
    assert "/api/v1/cases/{case_id}/participants" in paths


def test_case_access_fail_closed(on):
    owner = _rest_user(on, "fc-owner")
    outsider = _rest_user(on, "fc-outsider")
    _organization, case = _rest_case(owner, "fc")

    r = outsider.get(f"/api/v1/cases/{case['id']}")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"
    r = outsider.get("/api/v1/cases/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    # 外部参与者不能直接 add（必须先走邀请→接受）
    outsider_pid = outsider.get("/api/v1/principals/me").json()["id"]
    r = owner.post(
        f"/api/v1/cases/{case['id']}/participants",
        headers={"Idempotency-Key": "fc-denied"},
        json={"principal_id": outsider_pid, "role": "drafter"},
    )
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"


# ------------------------------------------------------- happy path ----


def test_org_case_participant_crud_and_invitation_flow(on):
    owner = _rest_user(on, "hp-owner")
    invitee = _rest_user(on, "hp-invitee")

    organization, case = _rest_case(owner, "hp")
    assert case["organization_id"] == organization["id"]

    # 建案自动给创建者 case_manager 参与行
    parts = owner.get(f"/api/v1/cases/{case['id']}/participants").json()
    assert [p["role"] for p in parts] == ["case_manager"]

    # invitee 先要激活 Principal（transaction() 惰性建行）
    invitee_pid = invitee.get("/api/v1/principals/me").json()["id"]

    # 案件级邀请：owner 发 → invitee 接受 → CaseParticipant 落行
    inv = owner.post(
        f"/api/v1/organizations/{organization['id']}/invitations",
        headers={"Idempotency-Key": "hp-inv"},
        json={
            "invitee_principal_id": invitee_pid,
            "case_id": case["id"],
            "role": "drafter",
            "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
        },
    )
    assert inv.status_code == 201, inv.text
    acc = invitee.post(f"/api/v1/invitations/{inv.json()['id']}/accept", headers={"Idempotency-Key": "hp-acc"})
    assert acc.status_code == 200, acc.text
    assert acc.json()["status"] == "accepted"

    roles = sorted(p["role"] for p in owner.get(f"/api/v1/cases/{case['id']}/participants").json())
    assert roles == ["case_manager", "drafter"]
    # 接受后 invitee 可见案件
    assert [c["id"] for c in invitee.get("/api/v1/cases").json()] == [case["id"]]


def test_org_memberships_scoped_to_members(on):
    owner = _rest_user(on, "mb-owner")
    outsider = _rest_user(on, "mb-outsider")
    organization, _case = _rest_case(owner, "mb")
    rows = owner.get(f"/api/v1/organizations/{organization['id']}/memberships").json()
    assert [r["role"] for r in rows] == ["owner"]
    r = outsider.get(f"/api/v1/organizations/{organization['id']}/memberships")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"


# ------------------------------------------------------- 幂等重放 ----


def test_command_idempotency_replays_and_conflicts(on):
    owner = _rest_user(on, "idem")
    slug = f"idem-{uuid.uuid4().hex[:8]}"
    body = {"slug": slug, "name": "Org"}
    first = owner.post("/api/v1/organizations", headers={"Idempotency-Key": "idem-org"}, json=body)
    assert first.status_code == 201, first.text
    # 同 key 同载荷：重放原始 DTO（不建行；状态码沿用路由声明）
    replay = owner.post("/api/v1/organizations", headers={"Idempotency-Key": "idem-org"}, json=body)
    assert replay.status_code == 201 and replay.json() == first.json()
    # 同 key 不同载荷：409
    conflict = owner.post(
        "/api/v1/organizations", headers={"Idempotency-Key": "idem-org"}, json={"slug": slug + "x", "name": "Org"}
    )
    assert conflict.status_code == 409 and conflict.json()["detail"]["kind"] == "conflict"
