# -*- coding: utf-8 -*-
"""Z30 机构私有方法库：录入→授权→检索→使用留痕→撤销 全链路 + 跨机构隔离。

需要 PATENT_STUDIO_TEST_DATABASE_URL（pg_schema 基建）；无 PG 时按既有约定 skip。
"""

import uuid

from fastapi.testclient import TestClient
from test_auth import _login, _register

pytest_plugins = ("test_auth",)


def _user(on, tag):
    client = TestClient(on.app)
    email = f"{tag}-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    return _login(on, email)


def _org(client, tag):
    return client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": f"{tag}-org"},
        json={"slug": f"{tag}-{uuid.uuid4().hex[:8]}", "name": "Org"},
    ).json()


def _mk(client, org, tag, title="方法卡", body="撰写步骤…", **extra):
    payload = {
        "title": title,
        "body": body,
        "source": "manual",
        "asset_type": "method",
        "provenance": "本所内部撰写培训材料整理",
        "authorized_scope": "仅限本机构案件撰写参考",
        "deidentified_confirmed": True,
    }
    payload.update(extra)
    return client.post(
        f"/api/v1/organizations/{org['id']}/method-assets",
        headers={"Idempotency-Key": f"{tag}-m"},
        json=payload,
    )


def _auth(client, aid, tag):
    return client.post(f"/api/v1/method-assets/{aid}/authorize", headers={"Idempotency-Key": tag})


def test_method_asset_lifecycle_and_retrieval(on):
    client = _user(on, "ml-a")
    org = _org(client, "ml-a")
    # 录入 → draft：不在默认检索视图（仅 authorized）
    a = _mk(client, org, "m1", title="独权布局法").json()
    assert a["status"] == "draft" and a["source"] == "manual"
    assert client.get(f"/api/v1/organizations/{org['id']}/method-assets").json() == []
    assert (
        client.get(f"/api/v1/organizations/{org['id']}/method-assets", params={"all_states": "true"}).json()[0]["id"]
        == a["id"]
    )
    # 未授权不能使用
    r = client.post(f"/api/v1/method-assets/{a['id']}/use", headers={"Idempotency-Key": "u0"}, json={})
    assert r.status_code == 403
    # 授权 → 检索可见
    a = _auth(client, a["id"], "au1").json()
    assert a["status"] == "authorized" and a["authorized_by_principal_id"]
    got = client.get(f"/api/v1/organizations/{org['id']}/method-assets").json()
    assert [x["id"] for x in got] == [a["id"]]
    assert (
        client.get(f"/api/v1/organizations/{org['id']}/method-assets", params={"q": "布局"}).json()[0]["id"] == a["id"]
    )
    # 使用留痕（附同机构 case）
    case = client.post(
        f"/api/v1/organizations/{org['id']}/cases",
        headers={"Idempotency-Key": "c1"},
        json={"case_key": "ML-1", "title": "案", "kind": "invention"},
    ).json()
    u = client.post(
        f"/api/v1/method-assets/{a['id']}/use",
        headers={"Idempotency-Key": "u1"},
        json={"case_id": case["id"], "note": "权利要求1套用"},
    ).json()
    assert u["case_id"] == case["id"]
    uses = client.get(f"/api/v1/method-assets/{a['id']}/uses").json()
    assert [x["id"] for x in uses] == [u["id"]]
    # 撤销 → 检索即刻不可见，且不能再用
    client.post(f"/api/v1/method-assets/{a['id']}/revoke", headers={"Idempotency-Key": "rv1"})
    assert client.get(f"/api/v1/organizations/{org['id']}/method-assets").json() == []
    r = client.post(f"/api/v1/method-assets/{a['id']}/use", headers={"Idempotency-Key": "u2"}, json={})
    assert r.status_code == 403


def test_method_assets_cross_org_isolation(on):
    a_client = _user(on, "ml-b")
    b_client = _user(on, "ml-c")
    org_a = _org(a_client, "ml-b")
    org_b = _org(b_client, "ml-c")
    a = _mk(a_client, org_a, "b1").json()
    _auth(a_client, a["id"], "b-au")
    # B 机构成员：不可见 / 不可授权 / 不可使用 / 不可查 uses
    assert b_client.get(f"/api/v1/organizations/{org_a['id']}/method-assets").status_code == 403
    assert (
        b_client.post(f"/api/v1/method-assets/{a['id']}/authorize", headers={"Idempotency-Key": "x1"}).status_code
        == 403
    )
    assert (
        b_client.post(f"/api/v1/method-assets/{a['id']}/revoke", headers={"Idempotency-Key": "x2"}).status_code == 403
    )
    assert (
        b_client.post(f"/api/v1/method-assets/{a['id']}/use", headers={"Idempotency-Key": "x3"}, json={}).status_code
        == 403
    )
    assert b_client.get(f"/api/v1/method-assets/{a['id']}/uses").status_code == 403
    assert b_client.get(f"/api/v1/organizations/{org_b['id']}/method-assets").json() == []


def test_method_asset_use_rejects_cross_org_case(on):
    a_client = _user(on, "ml-d")
    b_client = _user(on, "ml-e")
    org_a = _org(a_client, "ml-d")
    org_b = _org(b_client, "ml-e")
    a = _mk(a_client, org_a, "d1").json()
    _auth(a_client, a["id"], "d-au")
    case_b = b_client.post(
        f"/api/v1/organizations/{org_b['id']}/cases",
        headers={"Idempotency-Key": "e-c"},
        json={"case_key": "B-1", "title": "B案", "kind": "invention"},
    ).json()
    # 本机构成员可引用，但 case 必须同机构（防跨机构引用留痕）
    # 先把 a_client 加入 org_b？不需要——case_b 是外机构的 ⇒ record_use 拒绝
    # 但 a_client 并非 org_b 成员也无妨：资产属 org_a，校验 case.organization_id == asset.organization_id
    other_case = a_client.post(
        f"/api/v1/organizations/{org_a['id']}/cases",
        headers={"Idempotency-Key": "d-c"},
        json={"case_key": "A-1", "title": "A案", "kind": "invention"},
    ).json()
    ok = a_client.post(
        f"/api/v1/method-assets/{a['id']}/use", headers={"Idempotency-Key": "d-u1"}, json={"case_id": other_case["id"]}
    )
    assert ok.status_code == 201
    bad = a_client.post(
        f"/api/v1/method-assets/{a['id']}/use", headers={"Idempotency-Key": "d-u2"}, json={"case_id": case_b["id"]}
    )
    assert bad.status_code == 403


def test_create_requires_governance_metadata(on):
    """复核项6：缺来源/范围/脱敏确认一律 422——服务端强制，不靠前端复选框。"""
    client = _user(on, "meta")
    org = _org(client, "meta")
    r = client.post(
        f"/api/v1/organizations/{org['id']}/method-assets",
        headers={"Idempotency-Key": "meta-1"},
        json={"title": "卡", "body": "正文", "source": "manual"},  # 三个新字段全缺
    )
    assert r.status_code == 422
    r2 = client.post(
        f"/api/v1/organizations/{org['id']}/method-assets",
        headers={"Idempotency-Key": "meta-2"},
        json={
            "title": "卡",
            "body": "正文",
            "source": "manual",
            "asset_type": "method",
            "provenance": "内部培训",
            "authorized_scope": "本机构",
            "deidentified_confirmed": False,  # 必须是字面 True
        },
    )
    assert r2.status_code == 422


def test_legacy_unconfirmed_draft_cannot_be_authorized(on, pg_schema):
    """复核项6：迁移前旧卡（来源/范围 NULL、脱敏未声明）授权被拒；补登确认后可授权。"""
    client = _user(on, "leg")
    org = _org(client, "leg")
    aid = _mk(client, org, "leg").json()["id"]
    # 模拟 0015 之前的旧草稿：直接回写库为未确认态
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from patent_studio.domain.methods import MethodAsset
    from patent_studio.infra.db import database_url

    eng = create_engine(database_url(pg_schema))
    try:
        with Session(eng) as s:
            a = s.get(MethodAsset, uuid.UUID(aid))
            a.provenance = None
            a.authorized_scope = None
            a.deidentified_confirmed = False
            s.commit()
    finally:
        eng.dispose()
    r = client.post(f"/api/v1/method-assets/{aid}/authorize", headers={"Idempotency-Key": "leg-a"})
    assert r.status_code == 403
    rc = client.post(
        f"/api/v1/method-assets/{aid}/confirm",
        headers={"Idempotency-Key": "leg-c"},
        json={
            "asset_type": "expression",
            "provenance": "资深代理师经验沉淀（脱敏改写）",
            "authorized_scope": "全机构撰写参考",
            "deidentified_confirmed": True,
        },
    )
    assert rc.status_code == 200, rc.text
    assert rc.json()["asset_type"] == "expression" and rc.json()["deidentified_confirmed"] is True
    r2 = client.post(f"/api/v1/method-assets/{aid}/authorize", headers={"Idempotency-Key": "leg-b"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["authorized_by_principal_id"] and r2.json()["authorized_at"]


def test_confirm_requires_draft_state(on):
    """复核项6：confirm 仅草稿可补登；已授权卡不可重复确认。"""
    client = _user(on, "cnf")
    org = _org(client, "cnf")
    aid = _mk(client, org, "cnf").json()["id"]
    body = {"asset_type": "method", "provenance": "x", "authorized_scope": "y", "deidentified_confirmed": True}
    assert client.post(f"/api/v1/method-assets/{aid}/authorize", headers={"Idempotency-Key": "c1"}).status_code == 200
    r = client.post(f"/api/v1/method-assets/{aid}/confirm", headers={"Idempotency-Key": "c2"}, json=body)
    assert r.status_code == 422


def test_method_assets_manage_gates_and_source_validation(on):
    owner = _user(on, "ml-f")
    member = _user(on, "ml-g")
    org = _org(owner, "ml-f")
    # member 加入 org（owner 邀请 → member 接受）
    inv = owner.post(
        f"/api/v1/organizations/{org['id']}/invitations",
        headers={"Idempotency-Key": "f-inv"},
        json={
            "invitee_principal_id": member.get("/api/v1/principals/me").json()["id"],
            "role": "member",
            "expires_at": "2999-01-01T00:00:00Z",
        },
    ).json()
    member.post(f"/api/v1/invitations/{inv['id']}/accept", headers={"Idempotency-Key": "f-acc"})
    a = _mk(owner, org, "f1").json()
    # 普通成员：可读 authorized / 可录入 / 可检索；不可授权、不可看全部状态
    assert (
        member.get(f"/api/v1/organizations/{org['id']}/method-assets", params={"all_states": "true"}).status_code == 403
    )
    assert (
        member.post(f"/api/v1/method-assets/{a['id']}/authorize", headers={"Idempotency-Key": "g-au"}).status_code
        == 403
    )
    assert (
        member.post(
            f"/api/v1/organizations/{org['id']}/method-assets",
            headers={"Idempotency-Key": "g-m"},
            json={
                "title": "成员卡",
                "body": "步骤",
                "source": "curated",
                "asset_type": "expression",
                "provenance": "成员个人整理撰写经验",
                "authorized_scope": "本机构参考",
                "deidentified_confirmed": True,
            },
        ).status_code
        == 201
    )
    # source 白名单：拒绝 auto/其它来源（不自动收录）
    bad = owner.post(
        f"/api/v1/organizations/{org['id']}/method-assets",
        headers={"Idempotency-Key": "f-bad"},
        json={"title": "x", "body": "y", "source": "auto"},
    )
    assert bad.status_code == 422
