# -*- coding: utf-8 -*-
"""阶段6收口：GET /api/v1/proposals 跨案提案收件箱服务端分页。

沿用 /work-items 的可见性谓词（_visible_case_predicate，与逐条 case_access 读路径等价）：
跨机构隔离、scoped token 收窄、机构 suspended 即消失、membership 撤销后不可见、
created_by 不扩权；status/q 先于分页过滤，total 与筛选口径一致。
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from test_infra_rest_org_case import _rest_case, _rest_user
from test_infra_rest_work_items import _direct_session

from patent_studio.domain.agents import issue_agent_token, provision_agent
from patent_studio.domain.organization import Case, Organization, OrganizationMembership
from patent_studio.infra.storage import object_ref

pytest_plugins = ("test_auth",)


def _ref(value: str):
    ref = object_ref(value.encode(), "text/markdown")
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _revision(client, case, tag):
    document = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": f"{tag}-doc"},
        json={"book": "claims"},
    ).json()
    return client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": f"{tag}-rev"},
        json={"content_ref": _ref(tag)},
    ).json()


def _new_proposal(client, case, revision_id, tag):
    r = client.post(
        f"/api/v1/cases/{case['id']}/proposals",
        headers={"Idempotency-Key": tag},
        json={
            "target_kind": "document",
            "target_revision_id": revision_id,
            "result_content_ref": _ref(f"{tag} result"),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _submit(client, proposal, tag):
    r = client.post(f"/api/v1/proposals/{proposal['id']}/submit", headers={"Idempotency-Key": tag}, json={})
    assert r.status_code == 200, r.text


def test_proposals_inbox_pagination_filters_and_case_metadata(on, pg_schema):
    """limit/offset 分页 + status/q 先于分页过滤；created_at DESC→id 稳定排序；
    items 随附 case 元数据；案内 GET 与 mutation 口径不变。"""
    owner = _rest_user(on, "p6p-owner")
    outsider = _rest_user(on, "p6p-out")
    org, case_a = _rest_case(owner, "p6pa")
    case_b = owner.post(
        f"/api/v1/organizations/{org['id']}/cases",
        headers={"Idempotency-Key": "p6pb-case"},
        json={"case_key": "P6PB-7", "title": "检索标记案", "kind": "utility"},
    ).json()
    rev_a = _revision(owner, case_a, "p6p-ra")
    rev_b = _revision(owner, case_b, "p6p-rb")

    props = [_new_proposal(owner, case_a, rev_a["id"], f"p6p-a{i}") for i in range(2)]
    props.append(_new_proposal(owner, case_b, rev_b["id"], "p6p-b0"))
    # 分页排序证据：显式 created_at 递减，最新在前
    engine, session = _direct_session(pg_schema)
    try:
        base = datetime(2026, 10, 1, tzinfo=UTC)
        with session.begin():
            from patent_studio.domain.proposals import Proposal

            for i, prop in enumerate(props):
                session.get(Proposal, uuid.UUID(prop["id"])).created_at = base + timedelta(hours=i)
    finally:
        session.close()
        engine.dispose()
    _submit(owner, props[2], "p6p-submit-b0")

    page = owner.get("/api/v1/proposals?limit=2&offset=0")
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 3 and body["limit"] == 2 and body["offset"] == 0
    assert [i["id"] for i in body["items"]] == [props[2]["id"], props[1]["id"]], "created_at DESC 应最新在前"
    page2 = owner.get("/api/v1/proposals?limit=2&offset=2").json()
    assert page2["total"] == 3 and [i["id"] for i in page2["items"]] == [props[0]["id"]]
    # items 随附 case 元数据
    assert all(i["case"]["case_key"] for i in body["items"])
    assert body["items"][0]["case"]["id"] == case_b["id"]

    # status 先于分页：total 随口径缩小
    by_status = owner.get("/api/v1/proposals?status=submitted").json()
    assert [i["id"] for i in by_status["items"]] == [props[2]["id"]] and by_status["total"] == 1
    # q 命中案件号与案件标题子串（不分大小写）
    by_key = owner.get("/api/v1/proposals?q=p6pb-7").json()
    assert [i["id"] for i in by_key["items"]] == [props[2]["id"]]
    by_title = owner.get("/api/v1/proposals?q=检索标记").json()
    assert [i["id"] for i in by_title["items"]] == [props[2]["id"]]
    assert owner.get("/api/v1/proposals?q=不存在").json()["total"] == 0
    # 非法 status fail-closed；limit/offset clamp 不报错
    assert owner.get("/api/v1/proposals?status=bogus").status_code == 422
    assert owner.get("/api/v1/proposals?limit=0&offset=-9").status_code == 200
    # 跨机构隔离：筛选项也不泄露行与 case 元数据
    assert outsider.get("/api/v1/proposals").json()["total"] == 0

    # 案内列表与 mutation 维持 ProposalOut 口径（无 case 字段）
    case_rows = owner.get(f"/api/v1/cases/{case_a['id']}/proposals").json()
    assert case_rows and "case" not in case_rows[0]


def test_proposals_inbox_token_scope_and_visibility_gating(on, pg_schema):
    """与 case_access 等价的可见域：org-scoped token 跨机构收窄、participant 结束后消失、
    机构 suspended 全空；仅 created_by（非成员/非参与者）不扩权。"""
    owner = _rest_user(on, "p6p-scope-owner")
    org_a, case_a = _rest_case(owner, "p6psa")
    org_b = owner.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "p6p-org-b"},
        json={"slug": f"p6pb-{uuid.uuid4().hex[:8]}", "name": "OrgB"},
    ).json()
    case_b = owner.post(
        f"/api/v1/organizations/{org_b['id']}/cases",
        headers={"Idempotency-Key": "p6p-case-b"},
        json={"case_key": "P6PB-ORG2", "title": "第二机构案", "kind": "invention"},
    ).json()
    prop_a = _new_proposal(owner, case_a, _revision(owner, case_a, "p6p-sa")["id"], "p6p-prop-a")
    prop_b = _new_proposal(owner, case_b, _revision(owner, case_b, "p6p-sb")["id"], "p6p-prop-b")
    owner_pid = uuid.UUID(owner.get("/api/v1/principals/me").json()["id"])

    # org-scoped agent token 跨机构收窄：同一 agent 在两个机构都有成员身份，
    # token 限定 org_a → 若谓词不带 token 收窄，org_b 的 prop_b 会漏进来
    engine, session = _direct_session(pg_schema)
    try:
        with session.begin():
            agent = provision_agent(session, agent_key="p6p-agent", display_name="提案代理")
            for oid in (org_a["id"], org_b["id"]):
                session.add(
                    OrganizationMembership(
                        organization_id=uuid.UUID(oid), principal_id=agent.id, role="member", status="active"
                    )
                )
            token = issue_agent_token(
                session,
                principal_id=agent.id,
                issuer_principal_id=owner_pid,
                organization_id=uuid.UUID(org_a["id"]),
                case_id=None,
            )
    finally:
        session.close()
        engine.dispose()
    agent = TestClient(on.app)
    rows = agent.get("/api/v1/proposals", headers={"Authorization": f"Bearer {token}"})
    assert rows.status_code == 200, rows.text
    assert [i["id"] for i in rows.json()["items"]] == [prop_a["id"]]
    assert rows.json()["total"] == 1

    # 仅 membership 的非参与者成员可见；撤销 membership 后消失（该用户不是参与者）
    member_only = _rest_user(on, "p6p-scope-member")
    member_pid = uuid.UUID(member_only.get("/api/v1/principals/me").json()["id"])
    engine, session = _direct_session(pg_schema)
    try:
        with session.begin():
            session.add(
                OrganizationMembership(
                    organization_id=uuid.UUID(org_a["id"]), principal_id=member_pid, role="member", status="active"
                )
            )
    finally:
        session.close()
        engine.dispose()
    assert [i["id"] for i in member_only.get("/api/v1/proposals").json()["items"]] == [prop_a["id"]]
    engine, session = _direct_session(pg_schema)
    try:
        with session.begin():
            m = session.get(OrganizationMembership, (uuid.UUID(org_a["id"]), member_pid))
            m.status = "removed"
    finally:
        session.close()
        engine.dispose()
    assert member_only.get("/api/v1/proposals").json()["total"] == 0

    # created_by 不扩权：把 case_a 的 created_by 改成 member_only（其无参与者行、membership 已撤销）
    # —— _visible_cases_stmt 的 created_by 放宽若被误用，此处仍能看见，必须保持 0。
    engine, session = _direct_session(pg_schema)
    try:
        with session.begin():
            session.get(Case, uuid.UUID(case_a["id"])).created_by_principal_id = member_pid
    finally:
        session.close()
        engine.dispose()
    assert member_only.get("/api/v1/proposals").json()["total"] == 0
    assert prop_b["id"] and owner.get("/api/v1/proposals").json()["total"] == 2

    # 机构 suspended：case_access 对全机构 403 —— 收件箱里 org_a 的提案消失、org_b 保留
    engine, session = _direct_session(pg_schema)
    try:
        with session.begin():
            session.get(Organization, uuid.UUID(org_a["id"])).status = "suspended"
    finally:
        session.close()
        engine.dispose()
    body = owner.get("/api/v1/proposals").json()
    assert body["total"] == 1 and [i["id"] for i in body["items"]] == [prop_b["id"]]
