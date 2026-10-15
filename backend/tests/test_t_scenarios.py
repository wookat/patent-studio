"""T-scenario end-to-end orchestration tests over the platform domain + REST surface.

Each test composes already-verified mechanisms into a spec-level scenario (T07/T10/T11/
T13/T16/T17/T18/T19). Real PostgreSQL + file:// object storage where bytes matter.
"""

import asyncio
import hashlib
import io
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from test_rest_routes import _ref, _rest_case, _rest_user

pytest_plugins = ("test_auth",)

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)

ABSTRACT = "本发明公开一种仅基于注意力机制的序列转导模型。"
CLAIMS = (
    "1.一种序列转导模型，其特征在于，包括编码器与解码器，信息传递完全由注意力机制实现。\n\n"
    "2.根据权利要求1所述的模型，编码器包括堆叠的编码层。"
)
DESCRIPTION = "### 技术领域\n\n本发明涉及序列建模。\n\n### 发明内容\n\n完全基于注意力机制。"


def _session(pg_schema):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from patent_studio.infra.db import database_url

    engine = create_engine(database_url(pg_schema))
    return engine, Session(engine)


def _seed_agent(pg_schema, organization_id, case_id, issuer_principal_id, *, key="t-scen"):
    """Seed an agent principal + membership + participant + token; return (principal_id, raw_token)."""
    from patent_studio.domain.agents import issue_agent_token, provision_agent
    from patent_studio.domain.organization import CaseParticipant, OrganizationMembership

    engine, session = _session(pg_schema)
    try:
        with session.begin():
            agent = provision_agent(session, agent_key=f"{key}-{uuid.uuid4().hex[:6]}", display_name="T Agent")
            session.add(
                OrganizationMembership(
                    organization_id=uuid.UUID(organization_id),
                    principal_id=agent.id,
                    role="member",
                    status="active",
                )
            )
            session.add(CaseParticipant(case_id=uuid.UUID(case_id), principal_id=agent.id, role="drafter"))
            token = issue_agent_token(
                session,
                principal_id=agent.id,
                issuer_principal_id=uuid.UUID(issuer_principal_id),
                organization_id=uuid.UUID(organization_id),
                case_id=uuid.UUID(case_id),
            )
            return str(agent.id), token
    finally:
        engine.dispose()


def _store_text(store_url, text):
    from patent_studio.infra.storage import object_ref, open_store

    data = text.encode()
    ref = object_ref(data, "text/markdown")
    asyncio.run(open_store(store_url).put(data, ref.content_type))
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _doc_with_revision(client, case_id, book, ref, tag):
    document = client.post(
        f"/api/v1/cases/{case_id}/documents",
        headers={"Idempotency-Key": f"{tag}-doc-{book}"},
        json={"book": book},
    ).json()
    revision = client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": f"{tag}-rev-{book}"},
        json={"content_ref": ref},
    )
    assert revision.status_code == 201, revision.text
    return document, revision.json()


def test_t07_run_approval_idempotent_and_collab_seq_continuity(on, pg_schema):
    """T07: approval decision is single-shot; fencing epochs reject stale writes;
    collab updates keep a contiguous seq across reconnect batches."""
    from sqlalchemy import select

    from patent_studio.domain.collab import (
        CollabConflict,
        CollabUpdateInput,
        append_collab_updates,
        create_collab_room,
        read_collab_updates,
    )
    from patent_studio.domain.runs import (
        Run,
        RunConflict,
        append_run_event,
        cancel_run,
        request_approval,
        transition_run,
    )
    from patent_studio.infra.storage import object_ref

    owner = _rest_user(on, "t07-owner")
    principal_id = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "t07")
    run = owner.post(
        f"/api/v1/cases/{case['id']}/runs",
        headers={"Idempotency-Key": "t07-run"},
        json={"run_type": "draft"},
    )
    assert run.status_code == 201, run.text
    run_id = run.json()["run_id"]

    # working copy + collab room for the seq part
    document, _rev = _doc_with_revision(owner, case["id"], "claims", _ref("claims t07"), "t07")
    copy = owner.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": "t07-wc"},
        json={},
    ).json()

    engine, session = _session(pg_schema)
    try:
        with session.begin():
            transition_run(session, run_id, principal_id=uuid.UUID(principal_id), status="running")
            approval = request_approval(
                session,
                run_id,
                principal_id=uuid.UUID(principal_id),
                approver_principal_id=uuid.UUID(principal_id),
            )
            approval_id = str(approval.id)
            room = create_collab_room(session, uuid.UUID(copy["id"]), principal_id=uuid.UUID(principal_id))
            room_id = room.id
            batch1 = append_collab_updates(
                session,
                room_id,
                principal_id=uuid.UUID(principal_id),
                updates=[
                    CollabUpdateInput(clock=1, content_ref=object_ref(b"u1", "application/octet-stream")),
                    CollabUpdateInput(clock=2, content_ref=object_ref(b"u2", "application/octet-stream")),
                ],
            )
            assert [u.seq for u in batch1] == [1, 2]

        # approve via REST (approver inbox path), then a duplicate decide must conflict
        decision = owner.post(
            f"/api/v1/approvals/{approval_id}/decision",
            headers={"Idempotency-Key": "t07-approve"},
            json={"decision": "approved"},
        )
        assert decision.status_code == 200, decision.text
        duplicate = owner.post(
            f"/api/v1/approvals/{approval_id}/decision",
            headers={"Idempotency-Key": "t07-approve-2"},
            json={"decision": "rejected"},
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["kind"] == "conflict"

        with session.begin():
            # reconnect batch: seq continues monotonically
            batch2 = append_collab_updates(
                session,
                room_id,
                principal_id=uuid.UUID(principal_id),
                updates=[CollabUpdateInput(clock=3, content_ref=object_ref(b"u3", "application/octet-stream"))],
            )
            assert [u.seq for u in batch2] == [3]
            rows = read_collab_updates(session, room_id, principal_id=uuid.UUID(principal_id), after_seq=0)
            assert [r.seq for r in rows] == [1, 2, 3]
        # lamport clock moving backwards is rejected (block exits → rollback)
        with pytest.raises(CollabConflict), session.begin():
            append_collab_updates(
                session,
                room_id,
                principal_id=uuid.UUID(principal_id),
                updates=[CollabUpdateInput(clock=1, content_ref=object_ref(b"old", "application/octet-stream"))],
            )

        # fencing: cancel bumps epoch; writes carrying the stale epoch are refused
        with session.begin():
            run_row = session.scalar(select(Run).where(Run.run_id == run_id))
            old_epoch = run_row.fencing_epoch
            canceled = cancel_run(session, run_id, principal_id=uuid.UUID(principal_id), expected_epoch=old_epoch)
            assert canceled.fencing_epoch == old_epoch + 1
        with pytest.raises(RunConflict), session.begin():
            append_run_event(
                session,
                run_id,
                principal_id=uuid.UUID(principal_id),
                event_type="stale.writer",
                expected_epoch=old_epoch,
            )
        # terminal (canceled) run rejects further transitions
        with pytest.raises(RunConflict), session.begin():
            transition_run(session, run_id, principal_id=uuid.UUID(principal_id), status="running")
    finally:
        engine.dispose()


def test_t10_human_only_full_case_flow_to_docx(on, tmp_path, monkeypatch):
    """T10: AUTH=on human principal drives 建案→三书→修订→提案自裁→release→build→DOCX
    with zero agent/LLM involvement; every revision source stays 'manual'."""
    from patent_studio.settings import get_settings

    store_url = f"file://{tmp_path / 'objects'}"
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", store_url)
    get_settings.cache_clear()
    try:
        client = _rest_user(on, "t10-human")
        _org, case = _rest_case(client, "t10")
        revisions = {}
        for book, text in (("abstract", ABSTRACT), ("claims", CLAIMS), ("description", DESCRIPTION)):
            _doc, rev = _doc_with_revision(client, case["id"], book, _store_text(store_url, text), "t10")
            revisions[book] = rev
            assert rev["source"] == "manual"

        # human self-decides a proposal on claims
        proposal = client.post(
            f"/api/v1/cases/{case['id']}/proposals",
            headers={"Idempotency-Key": "t10-prop"},
            json={
                "target_kind": "document",
                "target_revision_id": revisions["claims"]["id"],
                "result_content_ref": _store_text(store_url, CLAIMS + "\n\n3.根据权利要求2所述的模型。"),
            },
        ).json()
        assert (
            client.post(
                f"/api/v1/proposals/{proposal['id']}/submit", headers={"Idempotency-Key": "t10-sub"}, json={}
            ).status_code
            == 200
        )
        accepted = client.post(
            f"/api/v1/proposals/{proposal['id']}/accept", headers={"Idempotency-Key": "t10-acc"}, json={}
        )
        assert accepted.status_code == 200, accepted.text
        accepted_revision = client.get(f"/api/v1/revisions/{accepted.json()['accepted_document_revision_id']}").json()
        assert accepted_revision["source"] == "manual"  # human proposer → manual lineage

        release = client.post(
            f"/api/v1/cases/{case['id']}/releases", headers={"Idempotency-Key": "t10-rel"}, json={}
        ).json()
        for i, rid in enumerate(
            (
                accepted.json()["accepted_document_revision_id"],
                revisions["description"]["id"],
                revisions["abstract"]["id"],
            ),
            1,
        ):
            item = client.post(
                f"/api/v1/releases/{release['id']}/items",
                headers={"Idempotency-Key": f"t10-item-{i}"},
                json={"item_kind": "document", "revision_id": rid, "ordinal": i},
            )
            assert item.status_code == 201, item.text
        assert (
            client.post(
                f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "t10-seal"}, json={}
            ).json()["status"]
            == "sealed"
        )
        built = client.post(f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "t10-build"})
        assert built.status_code == 201, built.text
        data = client.get(f"/api/v1/artifacts/{built.json()['id']}/content")
        assert data.status_code == 200
        assert hashlib.sha256(data.content).hexdigest() == built.json()["content_ref"]["sha256"]
        import docx

        text = "\n".join(p.text for p in docx.Document(io.BytesIO(data.content)).paragraphs)
        for marker in ("本发明公开", "1.一种序列转导模型", "本发明涉及序列建模"):
            assert marker in text, marker
    finally:
        get_settings.cache_clear()


def test_t11_invited_author_sees_only_invited_case(on):
    """T11: case-scoped invitation yields visibility of exactly the invited case."""
    owner = _rest_user(on, "t11-owner")
    invitee = _rest_user(on, "t11-invitee")
    organization, case_a = _rest_case(owner, "t11a")
    case_b = owner.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "t11-case-b"},
        json={"case_key": "T11-B", "title": "受邀案件", "kind": "invention"},
    ).json()
    invitee_principal = invitee.get("/api/v1/principals/me").json()["id"]

    invitation = owner.post(
        f"/api/v1/organizations/{organization['id']}/invitations",
        headers={"Idempotency-Key": "t11-inv"},
        json={
            "invitee_principal_id": invitee_principal,
            "role": "author",
            "case_id": case_b["id"],
            "expires_at": "2099-01-01T00:00:00Z",
        },
    )
    assert invitation.status_code == 201, invitation.text
    accepted = invitee.post(
        f"/api/v1/invitations/{invitation.json()['id']}/accept",
        headers={"Idempotency-Key": "t11-acc"},
        json={},
    )
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted"

    visible = invitee.get("/api/v1/cases")
    assert visible.status_code == 200
    assert [c["id"] for c in visible.json()] == [case_b["id"]]
    assert invitee.get(f"/api/v1/cases/{case_b['id']}").status_code == 200
    denied = invitee.get(f"/api/v1/cases/{case_a['id']}")
    assert denied.status_code in (403, 404)
    denied_docs = invitee.get(f"/api/v1/cases/{case_a['id']}/documents")
    assert denied_docs.status_code in (403, 404)
    denied_write = invitee.post(
        f"/api/v1/cases/{case_a['id']}/documents",
        headers={"Idempotency-Key": "t11-oos"},
        json={"book": "claims"},
    )
    assert denied_write.status_code in (403, 404)
    # but the invited case is fully usable
    document = invitee.post(
        f"/api/v1/cases/{case_b['id']}/documents",
        headers={"Idempotency-Key": "t11-doc"},
        json={"book": "claims"},
    )
    assert document.status_code == 201, document.text


def test_t13_stale_agent_proposal_conflicts_after_human_advances(on, pg_schema):
    """T13: agent proposal pinned to an old base revision; after humans advance the
    document, accept must conflict instead of silently forking history."""
    from patent_studio.domain.agents import ProposalCreateInput, create_agent_proposal
    from patent_studio.infra.storage import object_ref

    owner = _rest_user(on, "t13-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    organization, case = _rest_case(owner, "t13")
    _doc, rev1 = _doc_with_revision(owner, case["id"], "claims", _ref("claims v1"), "t13")

    agent_id, _token = _seed_agent(pg_schema, organization["id"], case["id"], owner_pid, key="t13")
    result = object_ref("agent 提案结果 v2".encode(), "text/markdown")
    engine, session = _session(pg_schema)
    try:
        with session.begin():
            output = create_agent_proposal(
                session,
                principal_id=uuid.UUID(agent_id),
                case_id=uuid.UUID(case["id"]),
                request=ProposalCreateInput(
                    target_kind="document",
                    target_revision_id=uuid.UUID(rev1["id"]),
                    result_content_key=result.key,
                    result_content_sha256=result.sha256,
                    result_content_size=result.size,
                    result_content_type=result.content_type,
                ),
            )
            proposal_id = str(output.proposal_id)
    finally:
        engine.dispose()

    submitted = owner.post(f"/api/v1/proposals/{proposal_id}/submit", headers={"Idempotency-Key": "t13-sub"}, json={})
    assert submitted.status_code == 200, submitted.text

    # human advances the document past the proposal's base
    rev2 = owner.post(
        f"/api/v1/documents/{_doc['id']}/revisions",
        headers={"Idempotency-Key": "t13-rev2"},
        json={"content_ref": _ref("claims v2 人工推进")},
    )
    assert rev2.status_code == 201 and rev2.json()["revision_no"] == 2

    accept = owner.post(f"/api/v1/proposals/{proposal_id}/accept", headers={"Idempotency-Key": "t13-acc"}, json={})
    assert accept.status_code == 409, accept.text
    assert accept.json()["detail"]["kind"] == "conflict"
    assert owner.get(f"/api/v1/cases/{case['id']}/proposals").json()[0]["status"] == "submitted"


def test_t16_terminal_run_and_done_work_item_reject_further_writes(on, pg_schema):
    """T16: once a work item completes and a run reaches a terminal state, write
    paths (transitions, approvals, stale-epoch events) are refused."""
    from patent_studio.domain.runs import RunConflict, append_run_event, request_approval, transition_run

    owner = _rest_user(on, "t16-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "t16")
    item = owner.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "t16-item"},
        json={"type": "draft", "title": "撰写权利要求", "priority": 2},
    ).json()
    assert (
        owner.put(
            f"/api/v1/work-items/{item['id']}/status",
            headers={"Idempotency-Key": "t16-wip"},
            json={"status": "in_progress"},
        ).status_code
        == 200
    )
    done = owner.put(
        f"/api/v1/work-items/{item['id']}/status",
        headers={"Idempotency-Key": "t16-done"},
        json={"status": "done"},
    )
    assert done.status_code == 200 and done.json()["status"] == "done"
    # done item rejects backwards/illegal transitions
    illegal = owner.put(
        f"/api/v1/work-items/{item['id']}/status",
        headers={"Idempotency-Key": "t16-illegal"},
        json={"status": "in_progress"},
    )
    assert illegal.status_code == 409

    run = owner.post(
        f"/api/v1/cases/{case['id']}/runs",
        headers={"Idempotency-Key": "t16-run"},
        json={"run_type": "draft"},
    ).json()
    engine, session = _session(pg_schema)
    try:
        with session.begin():
            transition_run(session, run["run_id"], principal_id=uuid.UUID(owner_pid), status="running")
            transition_run(session, run["run_id"], principal_id=uuid.UUID(owner_pid), status="succeeded")
        # terminal run: no more transitions, no approval requests
        with pytest.raises(RunConflict), session.begin():
            transition_run(session, run["run_id"], principal_id=uuid.UUID(owner_pid), status="running")
        with pytest.raises(RunConflict), session.begin():
            request_approval(
                session,
                run["run_id"],
                principal_id=uuid.UUID(owner_pid),
                approver_principal_id=uuid.UUID(owner_pid),
            )
        # stale fencing epoch write refused
        with pytest.raises(RunConflict), session.begin():
            append_run_event(
                session,
                run["run_id"],
                principal_id=uuid.UUID(owner_pid),
                event_type="stale",
                expected_epoch=99,
            )
    finally:
        engine.dispose()


def test_t17_grant_revocation_denies_capability_and_token_revoke_401(on, pg_schema):
    """T17: mid-flight revocation — capability invoke denied after grant revoke;
    bearer token revoked → REST entries 401."""
    from datetime import UTC, datetime

    from pydantic import BaseModel, ConfigDict
    from sqlalchemy import select

    from patent_studio.capabilities.registry import (
        CapabilityAuthorizationError,
        CapabilityKind,
        CapabilityRegistry,
        CapabilityRisk,
        CapabilityScope,
        CapabilitySpec,
        InvocationContext,
    )
    from patent_studio.domain.agents import AgentAccessToken, revoke_agent_token
    from patent_studio.domain.authorization import Grant, authorize_grant, revoke_grant

    owner = _rest_user(on, "t17-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    organization, case = _rest_case(owner, "t17")
    agent_id, token = _seed_agent(pg_schema, organization["id"], case["id"], owner_pid, key="t17")

    class In(BaseModel):
        model_config = ConfigDict(extra="forbid", revalidate_instances="always")

        value: str

    class Out(BaseModel):
        model_config = ConfigDict(extra="forbid", revalidate_instances="always")

        echo: str

    registry = CapabilityRegistry()
    registry.register(
        CapabilitySpec(
            id="t17.echo",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=In,
            output_model=Out,
            handler=lambda _s, p, _c: Out(echo=p.value),
        )
    )

    engine, session = _session(pg_schema)
    try:
        with session.begin():
            grant = Grant(
                organization_id=uuid.UUID(organization["id"]),
                case_id=uuid.UUID(case["id"]),
                grantor_principal_id=uuid.UUID(owner_pid),
                subject_principal_id=uuid.UUID(agent_id),
                capabilities=["t17.echo"],
                expires_at=datetime(2099, 1, 1, tzinfo=UTC),
            )
            session.add(grant)
            session.flush()
            grant_id, epoch = grant.id, grant.fencing_epoch
        ctx = InvocationContext(
            principal_id=uuid.UUID(agent_id),
            organization_id=uuid.UUID(organization["id"]),
            case_id=uuid.UUID(case["id"]),
            grant_id=grant_id,
            expected_epoch=epoch,
            at=datetime.now(UTC),
        )
        with session.begin():
            allowed = registry.invoke(session, "t17.echo", {"value": "x"}, context=ctx)
            assert allowed.echo == "x"
        # revoke mid-flight
        with session.begin():
            revoked = revoke_grant(session, grant_id, uuid.UUID(owner_pid), epoch)
            assert revoked.fencing_epoch == epoch + 1
        with session.begin():
            revoked_decision = authorize_grant(
                session,
                uuid.UUID(agent_id),
                uuid.UUID(organization["id"]),
                "t17.echo",
                case_id=uuid.UUID(case["id"]),
                grant_id=grant_id,
            )
            assert not revoked_decision.allowed and revoked_decision.reason == "grant_revoked"
            stale_epoch = authorize_grant(
                session,
                uuid.UUID(agent_id),
                uuid.UUID(organization["id"]),
                "t17.echo",
                case_id=uuid.UUID(case["id"]),
                grant_id=grant_id,
                expected_epoch=epoch,
            )
            assert not stale_epoch.allowed and stale_epoch.reason == "grant_epoch_conflict"
        with pytest.raises(CapabilityAuthorizationError), session.begin():
            registry.invoke(session, "t17.echo", {"value": "x"}, context=ctx)
        # token revoke → REST bearer entry denied (401 fail-closed)
        with session.begin():
            row = session.scalar(select(AgentAccessToken).where(AgentAccessToken.principal_id == uuid.UUID(agent_id)))
            revoke_agent_token(session, row.id)
    finally:
        engine.dispose()

    agent = TestClient(on.app)
    denied = agent.get("/api/v1/principals/me", headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 401
    denied_write = agent.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "t17-doc"},
        json={"book": "claims"},
    )
    assert denied_write.status_code == 401


def test_t18_figure_and_document_proposals_then_sealed_release_is_immutable(on, pg_schema, tmp_path):
    """T18: figure proposal accepted → figure revision; document+figure items in a
    release seal; sealed release rejects any item mutation."""
    from patent_studio.domain.figures import create_figure_revision
    from patent_studio.infra.storage import object_ref

    owner = _rest_user(on, "t18-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "t18")
    _doc, rev = _doc_with_revision(owner, case["id"], "claims", _ref("claims t18"), "t18")

    figure = owner.post(
        f"/api/v1/cases/{case['id']}/figures",
        headers={"Idempotency-Key": "t18-fig"},
        json={"figure_no": 1, "title": "系统架构图"},
    )
    assert figure.status_code == 201, figure.text

    # seed a figure revision (PNG-ish bytes via object ref; domain path, REST lacks the endpoint)
    png = b"\x89PNG\r\n\x1a\n" + b"fake-image-bytes"
    engine, session = _session(pg_schema)
    try:
        with session.begin():
            fig_rev = create_figure_revision(
                session,
                uuid.UUID(figure.json()["id"]),
                author_principal_id=uuid.UUID(owner_pid),
                content_ref=object_ref(png, "image/png"),
            )
            fig_rev_id = str(fig_rev.id)
    finally:
        engine.dispose()

    # figure proposal: human self-decide
    fproposal = owner.post(
        f"/api/v1/cases/{case['id']}/proposals",
        headers={"Idempotency-Key": "t18-fprop"},
        json={
            "target_kind": "figure",
            "target_revision_id": fig_rev_id,
            "result_content_ref": _ref("新图二进制"),
        },
    )
    assert fproposal.status_code == 201, fproposal.text
    owner.post(
        f"/api/v1/proposals/{fproposal.json()['id']}/submit",
        headers={"Idempotency-Key": "t18-fsub"},
        json={},
    )
    faccept = owner.post(
        f"/api/v1/proposals/{fproposal.json()['id']}/accept",
        headers={"Idempotency-Key": "t18-facc"},
        json={},
    )
    assert faccept.status_code == 200, faccept.text
    accepted_fig_rev = faccept.json()["accepted_figure_revision_id"]
    assert accepted_fig_rev

    release = owner.post(f"/api/v1/cases/{case['id']}/releases", headers={"Idempotency-Key": "t18-rel"}, json={}).json()
    for i, (kind, rid) in enumerate((("document", rev["id"]), ("figure", accepted_fig_rev)), 1):
        item = owner.post(
            f"/api/v1/releases/{release['id']}/items",
            headers={"Idempotency-Key": f"t18-item-{i}"},
            json={"item_kind": kind, "revision_id": rid, "ordinal": i},
        )
        assert item.status_code == 201, item.text
    sealed = owner.post(f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "t18-seal"}, json={})
    assert sealed.status_code == 200 and sealed.json()["status"] == "sealed"

    # sealed release: adding items and re-sealing are both refused
    add_after = owner.post(
        f"/api/v1/releases/{release['id']}/items",
        headers={"Idempotency-Key": "t18-late"},
        json={"item_kind": "document", "revision_id": rev["id"], "ordinal": 3},
    )
    assert add_after.status_code == 409
    assert add_after.json()["detail"]["kind"] == "conflict"
    reseal = owner.post(f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "t18-reseal"}, json={})
    assert reseal.status_code == 409


def test_t19_mixed_agent_human_chain_preserves_source_lineage(on, pg_schema):
    """T19: agent-drafted revision → agent proposal → human accept
    (agent_suggested_accepted) → human manual edit → release seal; source chain
    is auditable end to end."""
    from patent_studio.domain.agents import ProposalCreateInput, create_agent_proposal
    from patent_studio.infra.storage import object_ref

    owner = _rest_user(on, "t19-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    organization, case = _rest_case(owner, "t19")
    document = owner.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": "t19-doc"},
        json={"book": "claims"},
    ).json()

    agent_id, token = _seed_agent(pg_schema, organization["id"], case["id"], owner_pid, key="t19")
    agent = TestClient(on.app)
    drafted = agent.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "t19-draft"},
        json={"content_ref": _ref("agent 起草的权利要求 v1")},
    )
    assert drafted.status_code == 201 and drafted.json()["source"] == "agent"
    rev1 = drafted.json()

    result = object_ref("agent 建议 v2".encode(), "text/markdown")
    engine, session = _session(pg_schema)
    try:
        with session.begin():
            output = create_agent_proposal(
                session,
                principal_id=uuid.UUID(agent_id),
                case_id=uuid.UUID(case["id"]),
                request=ProposalCreateInput(
                    target_kind="document",
                    target_revision_id=uuid.UUID(rev1["id"]),
                    result_content_key=result.key,
                    result_content_sha256=result.sha256,
                    result_content_size=result.size,
                    result_content_type=result.content_type,
                ),
            )
            proposal_id = str(output.proposal_id)
    finally:
        engine.dispose()

    owner.post(f"/api/v1/proposals/{proposal_id}/submit", headers={"Idempotency-Key": "t19-sub"}, json={})
    accepted = owner.post(f"/api/v1/proposals/{proposal_id}/accept", headers={"Idempotency-Key": "t19-acc"}, json={})
    assert accepted.status_code == 200, accepted.text
    accepted_rev = owner.get(f"/api/v1/revisions/{accepted.json()['accepted_document_revision_id']}").json()
    assert accepted_rev["source"] == "agent_suggested_accepted"
    assert accepted_rev["parent_revision_id"] == rev1["id"]

    # human manual revision on top → source manual
    manual = owner.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": "t19-manual"},
        json={"content_ref": _ref("人工最终稿 v3")},
    )
    assert manual.status_code == 201 and manual.json()["source"] == "manual"
    assert manual.json()["parent_revision_id"] == accepted_rev["id"]

    release = owner.post(f"/api/v1/cases/{case['id']}/releases", headers={"Idempotency-Key": "t19-rel"}, json={}).json()
    item = owner.post(
        f"/api/v1/releases/{release['id']}/items",
        headers={"Idempotency-Key": "t19-item"},
        json={"item_kind": "document", "revision_id": manual.json()["id"]},
    )
    assert item.status_code == 201
    sealed = owner.post(f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "t19-seal"}, json={})
    assert sealed.json()["status"] == "sealed"

    lineage = [r["source"] for r in owner.get(f"/api/v1/documents/{document['id']}/revisions").json()]
    assert lineage == ["agent", "agent_suggested_accepted", "manual"]
