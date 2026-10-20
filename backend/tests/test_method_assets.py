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


def _raw_engine(pg_schema):
    from sqlalchemy import create_engine

    from patent_studio.infra.db import database_url

    return create_engine(database_url(pg_schema))


def test_migration_0015_demotes_legacy_authorized_and_requires_reauth(on, pg_schema):
    """复核追加：0014 的 authorized 旧卡升级 0015 后被降为 draft（旧授权人/时间清空），
    revoked 保持撤销不复活；旧卡不可检索/使用，须补登确认 + 重新授权才恢复。"""
    import os

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    client = _user(on, "mig")
    org = _org(client, "mig")
    pid = client.get("/api/v1/principals/me").json()["id"]
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config(os.path.join(backend, "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", pg_schema.replace("%", "%%"))
    aid, rid, did = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    eng = _raw_engine(pg_schema)
    try:
        # 回到 0014 形态（治理列未建），按旧 schema 直接插行
        command.downgrade(cfg, "0014")
        insert = text(
            "INSERT INTO method_assets (id, organization_id, title, body, source, status, "
            "authorized_by_principal_id, authorized_at, created_by_principal_id) "
            "VALUES (:id, :o, :t, 'b', 'manual', :st, :ab, now(), :p)"
        )
        with eng.begin() as c:
            for row_id, title, status, authorized_by in (
                (aid, "旧已授权卡", "authorized", pid),
                (rid, "旧撤销卡", "revoked", pid),
                (did, "旧草稿卡", "draft", None),
            ):
                c.execute(
                    insert,
                    {
                        "id": row_id,
                        "o": uuid.UUID(org["id"]),
                        "t": title,
                        "st": status,
                        "ab": uuid.UUID(authorized_by) if authorized_by else None,
                        "p": uuid.UUID(pid),
                    },
                )
        command.upgrade(cfg, "head")
        with eng.connect() as c:
            rows = {
                str(r.id): r
                for r in c.execute(
                    text(
                        "SELECT id, status, authorized_by_principal_id, authorized_at, "
                        "deidentified_confirmed, provenance, authorized_scope, asset_type FROM method_assets"
                    )
                )
            }
        # authorized→draft 且旧授权痕迹清空；revoked 不复活；草稿原样未确认
        a = rows[str(aid)]
        assert a.status == "draft" and a.authorized_by_principal_id is None and a.authorized_at is None
        assert a.deidentified_confirmed is False and a.provenance is None and a.authorized_scope is None
        assert rows[str(rid)].status == "revoked" and rows[str(did)].status == "draft"
        assert a.asset_type == "method"  # 新列按 server_default 回填
    finally:
        eng.dispose()

    # 迁移后：默认检索不可见、使用被拒；管理者 all_states 可见为 draft
    assert client.get(f"/api/v1/organizations/{org['id']}/method-assets").json() == []
    states = {
        x["id"]: x["status"]
        for x in client.get(f"/api/v1/organizations/{org['id']}/method-assets", params={"all_states": "true"}).json()
    }
    assert states[str(aid)] == "draft" and states[str(rid)] == "revoked" and states[str(did)] == "draft"
    r = client.post(f"/api/v1/method-assets/{aid}/use", headers={"Idempotency-Key": "mig-u"}, json={})
    assert r.status_code == 403
    # 补登确认 + 重新授权后才恢复检索/使用
    rc = client.post(
        f"/api/v1/method-assets/{aid}/confirm",
        headers={"Idempotency-Key": "mig-c"},
        json={
            "asset_type": "method",
            "provenance": "本所历史培训材料（脱敏改写）",
            "authorized_scope": "本机构撰写参考",
            "deidentified_confirmed": True,
        },
    )
    assert rc.status_code == 200, rc.text
    ra = client.post(f"/api/v1/method-assets/{aid}/authorize", headers={"Idempotency-Key": "mig-a"})
    assert ra.status_code == 200 and ra.json()["status"] == "authorized"
    assert [x["id"] for x in client.get(f"/api/v1/organizations/{org['id']}/method-assets").json()] == [str(aid)]
    ru = client.post(f"/api/v1/method-assets/{aid}/use", headers={"Idempotency-Key": "mig-u2"}, json={})
    assert ru.status_code == 201


def test_authorized_without_governance_is_fail_closed(on, pg_schema):
    """复核追加：库里直接残留 authorized+未确认/缺元数据的错误组合（绕过 authorize 入口）——
    默认检索不返回、record_use 403，fail-closed 不只靠授权入口闸。"""
    from sqlalchemy import text

    client = _user(on, "fc")
    org = _org(client, "fc")
    aid = _mk(client, org, "fc").json()["id"]
    assert _auth(client, aid, "fc-a").status_code == 200
    assert len(client.get(f"/api/v1/organizations/{org['id']}/method-assets").json()) == 1

    eng = _raw_engine(pg_schema)
    try:
        # 变体1：authorized + 未确认 + 来源/范围 NULL（0015 前的错误组合直写）
        with eng.begin() as c:
            c.execute(
                text(
                    "UPDATE method_assets SET provenance = NULL, authorized_scope = NULL, "
                    "deidentified_confirmed = false WHERE id = :id"
                ),
                {"id": uuid.UUID(aid)},
            )
    finally:
        eng.dispose()
    assert client.get(f"/api/v1/organizations/{org['id']}/method-assets").json() == []
    assert (
        client.post(f"/api/v1/method-assets/{aid}/use", headers={"Idempotency-Key": "fc-u"}, json={}).status_code == 403
    )

    eng = _raw_engine(pg_schema)
    try:
        # 变体2：confirmed=true 但 provenance 为空串——length(trim())>0 同样拦下
        with eng.begin() as c:
            c.execute(
                text(
                    "UPDATE method_assets SET deidentified_confirmed = true, provenance = '', "
                    "authorized_scope = 'x' WHERE id = :id"
                ),
                {"id": uuid.UUID(aid)},
            )
    finally:
        eng.dispose()
    assert client.get(f"/api/v1/organizations/{org['id']}/method-assets").json() == []
    assert (
        client.post(f"/api/v1/method-assets/{aid}/use", headers={"Idempotency-Key": "fc-u2"}, json={}).status_code
        == 403
    )
