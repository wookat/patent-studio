# -*- coding: utf-8 -*-
"""B5：/api/v1 提案 / 附图 / release 封存面 scoped 冒烟。

提案状态机（submit→accept 产 agent_suggested_accepted 修订）、非授权 accept、
release 封存不可变（sealed 后不可加项、不可二次封存）、跨 case fail-closed。
改自参照分支 test_rest_routes.py 的 proposal/release 段。
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from test_infra_rest_org_case import _rest_case, _rest_user

from patent_studio.domain.agents import issue_agent_token, provision_agent
from patent_studio.domain.organization import CaseParticipant, OrganizationMembership
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import object_ref

pytest_plugins = ("test_infra_auth",)


def _ref(value: str):
    ref = object_ref(value.encode(), "text/markdown")
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _doc_revision(client, case, tag):
    document = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": f"{tag}-doc"},
        json={"book": "claims"},
    ).json()
    revision = client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": f"{tag}-rev"},
        json={"content_ref": _ref(f"{tag} v1")},
    ).json()
    return document, revision


def _agent_client(on, pg_schema, organization, case, owner_client, agent_key):
    """在库里配一个 agent Principal（org member + case drafter），签发 Bearer token。"""
    owner_principal_id = uuid.UUID(owner_client.get("/api/v1/principals/me").json()["id"])
    engine = create_engine(database_url(pg_schema))
    try:
        with Session(engine) as session, session.begin():
            agent = provision_agent(session, agent_key=agent_key, display_name="REST 提案代理")
            session.add(
                OrganizationMembership(
                    organization_id=uuid.UUID(organization["id"]),
                    principal_id=agent.id,
                    role="member",
                    status="active",
                )
            )
            session.add(CaseParticipant(case_id=uuid.UUID(case["id"]), principal_id=agent.id, role="drafter"))
            token = issue_agent_token(
                session,
                principal_id=agent.id,
                issuer_principal_id=owner_principal_id,
                organization_id=uuid.UUID(organization["id"]),
                case_id=uuid.UUID(case["id"]),
            )
    finally:
        engine.dispose()
    return token


def test_proposal_flow_accept_produces_accepted_revision_and_replays(on, pg_schema):
    owner = _rest_user(on, "b5-prop-owner")
    organization, case = _rest_case(owner, "b5prop")
    _document, revision = _doc_revision(owner, case, "b5prop")

    # agent 提案（Bearer agt_ token）→ owner 采纳 → 修订 source=agent_suggested_accepted
    token = _agent_client(on, pg_schema, organization, case, owner, "b5-drafter")
    agent = TestClient(on.app)
    proposal = agent.post(
        f"/api/v1/cases/{case['id']}/proposals",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "b5-prop-create"},
        json={
            "target_kind": "document",
            "target_revision_id": revision["id"],
            "result_content_ref": _ref("agent 改稿"),
        },
    ).json()
    assert proposal["status"] == "draft"

    # draft 状态不可 accept（状态机拒绝非法迁移）
    early = owner.post(
        f"/api/v1/proposals/{proposal['id']}/accept",
        headers={"Idempotency-Key": "b5-prop-early"},
        json={},
    )
    assert early.status_code == 409 and early.json()["detail"]["kind"] == "conflict"

    submitted = owner.post(
        f"/api/v1/proposals/{proposal['id']}/submit",
        headers={"Idempotency-Key": "b5-prop-submit"},
        json={},
    )
    assert submitted.status_code == 200 and submitted.json()["status"] == "submitted"

    accepted = owner.post(
        f"/api/v1/proposals/{proposal['id']}/accept",
        headers={"Idempotency-Key": "b5-prop-accept"},
        json={},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    accepted_revision_id = accepted.json()["accepted_document_revision_id"]
    assert accepted_revision_id is not None

    # 采纳修订落在目标文稿上且 source=agent_suggested_accepted
    revisions = owner.get(f"/api/v1/documents/{_document['id']}/revisions").json()
    adopted = [r for r in revisions if r["id"] == accepted_revision_id]
    assert len(adopted) == 1 and adopted[0]["source"] == "agent_suggested_accepted"
    assert adopted[0]["parent_revision_id"] == revision["id"]

    # 同 key 重放返回同一 DTO
    replay = owner.post(
        f"/api/v1/proposals/{proposal['id']}/accept",
        headers={"Idempotency-Key": "b5-prop-accept"},
        json={},
    )
    assert replay.status_code == 200 and replay.json() == accepted.json()


def test_proposal_decision_by_outsider_is_fail_closed(on, pg_schema):
    owner = _rest_user(on, "b5-dec-owner")
    outsider = _rest_user(on, "b5-dec-outsider")
    _org, case = _rest_case(owner, "b5dec")
    _document, revision = _doc_revision(owner, case, "b5dec")

    proposal = owner.post(
        f"/api/v1/cases/{case['id']}/proposals",
        headers={"Idempotency-Key": "b5-dec-create"},
        json={
            "target_kind": "document",
            "target_revision_id": revision["id"],
            "result_content_ref": _ref("v2"),
        },
    ).json()
    owner.post(
        f"/api/v1/proposals/{proposal['id']}/submit",
        headers={"Idempotency-Key": "b5-dec-submit"},
        json={},
    )

    # outsider 对提案做任何动作均 fail-closed（域层授权失败 → 403 denied，不泄露内容）
    for decision in ("submit", "accept", "reject"):
        denied = outsider.post(
            f"/api/v1/proposals/{proposal['id']}/{decision}",
            headers={"Idempotency-Key": f"b5-dec-{decision}-{uuid.uuid4().hex[:8]}"},
            json={},
        )
        assert denied.status_code == 403 and denied.json()["detail"]["kind"] == "denied"

    # outsider 看不到该 case 的提案列表 / 附图列表 / release 列表
    for path in ("proposals", "figures", "releases"):
        denied = outsider.get(f"/api/v1/cases/{case['id']}/{path}")
        assert denied.status_code == 403 and denied.json()["detail"]["kind"] == "denied"

    bogus = owner.post(
        f"/api/v1/proposals/{proposal['id']}/bogus",
        headers={"Idempotency-Key": "b5-dec-bogus"},
        json={},
    )
    assert bogus.status_code == 404


def test_figures_and_release_seal_freezes_items(on, pg_schema):
    owner = _rest_user(on, "b5-rel-owner")
    _org, case = _rest_case(owner, "b5rel")
    _document, revision = _doc_revision(owner, case, "b5rel")

    figure = owner.post(
        f"/api/v1/cases/{case['id']}/figures",
        headers={"Idempotency-Key": "b5-rel-fig"},
        json={"figure_no": 1, "title": "流程图"},
    )
    assert figure.status_code == 201 and figure.json()["figure_no"] == 1
    assert [f["id"] for f in owner.get(f"/api/v1/cases/{case['id']}/figures").json()] == [figure.json()["id"]]

    release = owner.post(
        f"/api/v1/cases/{case['id']}/releases",
        headers={"Idempotency-Key": "b5-rel-create"},
        json={},
    )
    assert release.status_code == 201 and release.json()["status"] == "created"

    item = owner.post(
        f"/api/v1/releases/{release.json()['id']}/items",
        headers={"Idempotency-Key": "b5-rel-item"},
        json={"item_kind": "document", "revision_id": revision["id"]},
    )
    assert item.status_code == 201 and item.json()["item_kind"] == "document"

    sealed = owner.post(
        f"/api/v1/releases/{release.json()['id']}/seal",
        headers={"Idempotency-Key": "b5-rel-seal"},
        json={},
    )
    assert sealed.status_code == 200 and sealed.json()["status"] == "sealed"

    # sealed 后不可改：加项与二次封存都 409
    late = owner.post(
        f"/api/v1/releases/{release.json()['id']}/items",
        headers={"Idempotency-Key": "b5-rel-late"},
        json={"item_kind": "document", "revision_id": revision["id"]},
    )
    assert late.status_code == 409 and late.json()["detail"]["kind"] == "conflict"
    again = owner.post(
        f"/api/v1/releases/{release.json()['id']}/seal",
        headers={"Idempotency-Key": "b5-rel-seal2"},
        json={},
    )
    assert again.status_code == 409
