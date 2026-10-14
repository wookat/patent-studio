"""WorkItem、OA 字段、分派期限与通知的 PostgreSQL 回归。"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from patent_studio.domain.documents import create_document
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.domain.work_items import (
    Notification,
    NotificationError,
    WorkItemAuthorizationError,
    WorkItemConflict,
    assign_work_item,
    create_notification,
    create_work_item,
    mark_notification_read,
    record_notification,
    transition_work_item,
)
from patent_studio.infra.db import database_url

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
        email=f"{uuid.uuid4().hex[:12]}@work-items.example",
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
        slug=f"wi-{uuid.uuid4().hex[:10]}", name=f"机构-{label}", created_by_principal_id=principal.id
    )
    session.add(organization)
    session.flush()
    session.add(OrganizationMembership(organization_id=organization.id, principal_id=principal.id, role="owner"))
    session.flush()
    case = Case(
        organization_id=organization.id,
        case_key=f"WI-{uuid.uuid4().hex[:8]}",
        title=f"案件-{label}",
        created_by_principal_id=principal.id,
    )
    session.add(case)
    session.flush()
    session.add(CaseParticipant(case_id=case.id, principal_id=principal.id, role="attorney"))
    session.commit()
    return organization, case, principal


def test_work_item_and_notification_tables_migrated(db):
    assert {"work_items", "notifications"} <= set(inspect(db).get_table_names())


def test_work_item_state_machine_deadline_and_oa_fields(db):
    with Session(db) as session:
        _organization, case, principal = _case(session, "owner")
        item = create_work_item(
            session,
            case.id,
            principal_id=principal.id,
            type="oa-response",
            title="答复审查意见",
            deadline=datetime.now(UTC) - timedelta(days=1),
            official_no="审查意见通知书-1",
            oa_deadline=datetime.now(UTC) - timedelta(days=1),
        )
        assert item.status == "open"
        assert item.is_overdue is True and item.oa_is_overdue is True
        with pytest.raises(WorkItemConflict):
            transition_work_item(session, item.id, principal_id=principal.id, status="done")
        transition_work_item(session, item.id, principal_id=principal.id, status="in_progress")
        transition_work_item(session, item.id, principal_id=principal.id, status="in_review")
        transition_work_item(session, item.id, principal_id=principal.id, status="done")
        assert item.status == "done"
        assert item.is_overdue is False
        session.commit()


def test_assignment_requires_case_or_org_scope_and_cross_case_targets_fail(db):
    with Session(db) as session:
        _organization, case, principal = _case(session, "owner")
        _other_org, other_case, other_principal = _case(session, "other")
        item = create_work_item(
            session, case.id, principal_id=principal.id, type="review", title="复核"
        )
        with pytest.raises(WorkItemAuthorizationError):
            assign_work_item(
                session, item.id, principal_id=principal.id, assignee_principal_id=other_principal.id
            )
        document = create_document(session, other_case.id, book="claims", principal_id=other_principal.id)
        with pytest.raises(WorkItemConflict):
            create_work_item(
                session,
                case.id,
                principal_id=principal.id,
                type="draft",
                title="跨案件",
                document_id=document.id,
            )
        session.rollback()


def test_notification_dedupe_and_read_are_idempotent(db):
    with Session(db) as session:
        _organization, case, principal = _case(session, "recipient")
        item = create_work_item(session, case.id, principal_id=principal.id, type="draft", title="起草")
        first = record_notification(
            session,
            case_id=case.id,
            recipient_principal_id=principal.id,
            notification_type="work_item.assigned",
            work_item_id=item.id,
            payload={"title": "起草"},
            dedupe_key="work-item-assigned-1",
        )
        second = create_notification(
            session,
            case_id=case.id,
            recipient_principal_id=principal.id,
            notification_type="work_item.assigned",
            work_item_id=item.id,
            dedupe_key="work-item-assigned-1",
        )
        assert first.id == second.id
        read = mark_notification_read(session, first.id, principal_id=principal.id)
        first_read_at = read.read_at
        assert mark_notification_read(session, first.id, principal_id=principal.id).read_at == first_read_at
        assert session.scalar(select(Notification.id).where(Notification.id == first.id)) == first.id
        session.commit()


def test_notification_and_assignment_fail_closed_for_other_case(db):
    with Session(db) as session:
        _organization, case, principal = _case(session, "owner")
        _other_org, _other_case, other_principal = _case(session, "other")
        item = create_work_item(session, case.id, principal_id=principal.id, type="review", title="复核")
        with pytest.raises(NotificationError):
            record_notification(
                session,
                case_id=case.id,
                recipient_principal_id=other_principal.id,
                notification_type="work_item.assigned",
                work_item_id=item.id,
            )
        with pytest.raises(NotificationError):
            mark_notification_read(session, uuid.uuid4(), principal_id=principal.id)
        session.rollback()
