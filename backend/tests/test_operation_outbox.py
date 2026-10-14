"""Operation/outbox 事务、幂等与领取 fencing 回归。"""

import os
import uuid

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from patent_studio.domain.documents import WorkingCopyConflict, create_document, create_revision, open_working_copy
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.operations import (
    Operation,
    OperationAuthorizationError,
    OperationConflict,
    OutboxEvent,
    append_outbox_event,
    claim_outbox_batch,
    commit_working_copy_with_outbox,
    mark_outbox_published,
    record_operation,
    transition_operation,
)
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import object_ref

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"),
    reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL",
)


@pytest.fixture()
def db(pg_schema):
    engine = create_engine(database_url(pg_schema))
    try:
        yield engine
    finally:
        engine.dispose()


def _case(session: Session, label: str):
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:12]}@operations.example",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
        display_name=label,
    )
    session.add(user)
    session.flush()
    principal = Principal(kind="human", user_id=user.id, display_name=label)
    session.add(principal)
    session.flush()
    organization = Organization(
        slug=f"op-{uuid.uuid4().hex[:10]}", name=f"机构-{label}", created_by_principal_id=principal.id
    )
    session.add(organization)
    session.flush()
    session.add(OrganizationMembership(organization_id=organization.id, principal_id=principal.id, role="owner"))
    session.flush()
    case = Case(
        organization_id=organization.id,
        case_key=f"OP-{uuid.uuid4().hex[:8]}",
        title=f"案件-{label}",
        created_by_principal_id=principal.id,
    )
    session.add(case)
    session.flush()
    session.add(CaseParticipant(case_id=case.id, principal_id=principal.id, role="attorney"))
    session.commit()
    return organization, case, principal


def _ref(text: str):
    return object_ref(text.encode(), "text/markdown")


def _working_copy(session: Session, case: Case, principal: Principal):
    document = create_document(session, case.id, book="claims", principal_id=principal.id)
    create_revision(
        session, document.id, author_principal_id=principal.id, content_ref=_ref("v1"), source="manual"
    )
    working_copy = open_working_copy(session, document.id, principal_id=principal.id)
    session.commit()
    return working_copy


def test_commit_is_idempotent_and_writes_one_event(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "owner")
        working_copy = _working_copy(session, case, principal)
        first = commit_working_copy_with_outbox(
            session,
            working_copy.id,
            operation_id="op-commit-1",
            principal_id=principal.id,
            organization_id=organization.id,
            expected_version=1,
        )
        session.commit()
        second = commit_working_copy_with_outbox(
            session,
            working_copy.id,
            operation_id="op-commit-1",
            principal_id=principal.id,
            organization_id=organization.id,
            expected_version=1,
        )
        assert second.id == first.id
        assert session.scalar(select(func.count()).select_from(Operation)) == 1
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1
        session.rollback()


def test_operation_and_outbox_rollback_together(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "rollback")
        record_operation(
            session,
            "op-rollback",
            operation_type="test.write",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        append_outbox_event(session, "op-rollback", event_type="test.created", payload_json={"x": 1})
        session.rollback()
        assert session.scalar(select(Operation).where(Operation.operation_id == "op-rollback")) is None
        assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_claim_is_non_overlapping_and_publish_is_fenced(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "worker")
        operation = record_operation(
            session,
            "op-event",
            operation_type="test.event",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        append_outbox_event(session, operation.id, event_type="test.created", payload_json={"x": 1})
        session.commit()
    with Session(db) as first, Session(db) as second:
        claimed = claim_outbox_batch(first, worker_id="worker-a")
        assert len(claimed) == 1
        first.commit()
        assert claim_outbox_batch(second, worker_id="worker-b") == []
        with pytest.raises(OperationConflict):
            mark_outbox_published(second, claimed[0].event_id, worker_id="worker-b")
        mark_outbox_published(second, claimed[0].event_id, worker_id="worker-a")
        second.commit()
        assert claim_outbox_batch(second, worker_id="worker-b") == []


def test_operation_state_machine_rejects_invalid_transition(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "states")
        record_operation(
            session,
            "op-state",
            operation_type="test.state",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        with pytest.raises(OperationConflict):
            transition_operation(session, "op-state", "succeeded")
        transition_operation(session, "op-state", "running")
        transition_operation(session, "op-state", "succeeded")
        with pytest.raises(OperationConflict):
            transition_operation(session, "op-state", "running")
        session.rollback()


def test_commit_fencing_and_cross_case_are_fail_closed(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "fence")
        working_copy = _working_copy(session, case, principal)
        with pytest.raises(WorkingCopyConflict):
            commit_working_copy_with_outbox(
                session,
                working_copy.id,
                operation_id="op-stale",
                principal_id=principal.id,
                organization_id=organization.id,
                expected_version=99,
            )
        assert session.scalar(select(Operation).where(Operation.operation_id == "op-stale")) is None
        other_org, other_case, _other_principal = _case(session, "other")
        with pytest.raises(OperationAuthorizationError):
            record_operation(
                session,
                "op-cross-case",
                operation_type="test.scope",
                principal_id=principal.id,
                organization_id=other_org.id,
                case_id=other_case.id,
            )
