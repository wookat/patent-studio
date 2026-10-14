"""案件工作项、分派/期限状态机与持久化通知。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import Document, DocumentError, _ensure_case_access
from patent_studio.domain.figures import FigureDocument
from patent_studio.domain.identity import Notification, Principal
from patent_studio.domain.operations import Operation
from patent_studio.domain.organization import Case, CaseParticipant, OrganizationMembership
from patent_studio.domain.proposals import Proposal
from patent_studio.domain.releases import Release
from patent_studio.infra.db import Base

WORK_ITEM_TYPES = ("draft", "review", "figure", "oa-response", "search", "client-confirm", "deliver")
WORK_ITEM_STATUSES = ("open", "in_progress", "blocked", "in_review", "done", "canceled")
_TRANSITIONS = {
    "open": {"in_progress", "canceled"},
    "in_progress": {"blocked", "in_review", "done", "canceled"},
    "blocked": {"in_progress", "canceled"},
    "in_review": {"in_progress", "done", "canceled"},
    "done": set(),
    "canceled": set(),
}


class WorkItemError(DocumentError):
    """工作项领域错误。"""


class WorkItemNotFound(WorkItemError):
    """工作项不存在。"""


class WorkItemConflict(WorkItemError):
    """工作项状态或关联对象冲突。"""


class WorkItemAuthorizationError(WorkItemError):
    """工作项操作或分派未获授权。"""


class NotificationError(WorkItemError):
    """通知落库或读取未获授权。"""


class WorkItem(Base):
    __tablename__ = "work_items"
    __table_args__ = (
        CheckConstraint(
            "type IN ('draft', 'review', 'figure', 'oa-response', 'search', 'client-confirm', 'deliver')",
            name="type",
        ),
        CheckConstraint("status IN ('open', 'in_progress', 'blocked', 'in_review', 'done', 'canceled')", name="status"),
        CheckConstraint("priority BETWEEN 1 AND 5", name="priority"),
        CheckConstraint("oa_deadline IS NULL OR type = 'oa-response'", name="oa_deadline_type"),
        Index("ix_work_items_case_status_deadline", "case_id", "status", "deadline"),
        Index("ix_work_items_assignee_status", "assignee_principal_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    assignee_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    reporter_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3, server_default="3")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", server_default="open")
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="RESTRICT"), nullable=True
    )
    figure_document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("figure_documents.id", ondelete="RESTRICT"), nullable=True
    )
    release_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("releases.id", ondelete="RESTRICT"), nullable=True
    )
    source_operation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("operations.id", ondelete="SET NULL"), nullable=True
    )
    source_run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    official_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    oa_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response_document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="RESTRICT"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def is_overdue(self) -> bool:
        """逾期只反映期限事实，不改变工作项状态。"""
        return (
            self.deadline is not None
            and datetime.now(UTC) > self.deadline
            and self.status not in {"done", "canceled"}
        )

    @property
    def oa_is_overdue(self) -> bool:
        return (
            self.oa_deadline is not None
            and datetime.now(UTC) > self.oa_deadline
            and self.status not in {"done", "canceled"}
        )


def _work_item_for(session: Session, work_item_id: uuid.UUID, principal_id: uuid.UUID) -> WorkItem:
    item = session.get(WorkItem, work_item_id)
    if item is None:
        raise WorkItemNotFound("work item does not exist")
    try:
        _ensure_case_access(session, item.case_id, principal_id)
    except DocumentError as exc:
        raise WorkItemAuthorizationError(str(exc)) from exc
    return item


def _assignable(session: Session, case_id: uuid.UUID, principal_id: uuid.UUID) -> bool:
    member = session.scalar(
        select(OrganizationMembership.principal_id)
        .join(Case, Case.organization_id == OrganizationMembership.organization_id)
        .where(
            Case.id == case_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    )
    participant = session.scalar(
        select(CaseParticipant.principal_id).where(
            CaseParticipant.case_id == case_id,
            CaseParticipant.principal_id == principal_id,
            CaseParticipant.status == "active",
        )
    )
    return member is not None or participant is not None


def _check_assignee(session: Session, case_id: uuid.UUID, principal_id: uuid.UUID | None) -> None:
    if principal_id is not None and not _assignable(session, case_id, principal_id):
        raise WorkItemAuthorizationError("assignee is not an active case participant or organization member")


def _check_target_case(session: Session, case_id: uuid.UUID, *, document_id, figure_document_id, release_id) -> None:
    targets = [document_id, figure_document_id, release_id]
    if sum(value is not None for value in targets) > 1:
        raise WorkItemConflict("at most one document, figure or release target is supported")
    if document_id is not None:
        target = session.get(Document, document_id)
        if target is None or target.case_id != case_id:
            raise WorkItemConflict("document target is outside the case")
    if figure_document_id is not None:
        target = session.get(FigureDocument, figure_document_id)
        if target is None or target.case_id != case_id:
            raise WorkItemConflict("figure target is outside the case")
    if release_id is not None:
        target = session.get(Release, release_id)
        if target is None or target.case_id != case_id:
            raise WorkItemConflict("release target is outside the case")


def create_work_item(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    type: Literal["draft", "review", "figure", "oa-response", "search", "client-confirm", "deliver"],
    title: str,
    assignee_principal_id: uuid.UUID | None = None,
    deadline: datetime | None = None,
    priority: int = 3,
    document_id: uuid.UUID | None = None,
    figure_document_id: uuid.UUID | None = None,
    release_id: uuid.UUID | None = None,
    source_operation_id: uuid.UUID | None = None,
    source_run_id: uuid.UUID | None = None,
    official_no: str | None = None,
    oa_deadline: datetime | None = None,
    response_document_id: uuid.UUID | None = None,
) -> WorkItem:
    try:
        _ensure_case_access(session, case_id, principal_id)
    except DocumentError as exc:
        raise WorkItemAuthorizationError(str(exc)) from exc
    if type not in WORK_ITEM_TYPES or not title.strip():
        raise WorkItemConflict("work item type and title are required")
    if not 1 <= priority <= 5:
        raise WorkItemConflict("priority must be between 1 and 5")
    _check_assignee(session, case_id, assignee_principal_id)
    _check_target_case(
        session, case_id, document_id=document_id, figure_document_id=figure_document_id, release_id=release_id
    )
    if type != "oa-response" and (
        official_no is not None or oa_deadline is not None or response_document_id is not None
    ):
        raise WorkItemConflict("OA fields require an oa-response work item")
    if response_document_id is not None:
        target = session.get(Document, response_document_id)
        if target is None or target.case_id != case_id:
            raise WorkItemConflict("response document is outside the case")
    if source_operation_id is not None:
        operation = session.get(Operation, source_operation_id)
        if operation is None or operation.case_id != case_id:
            raise WorkItemConflict("source operation is outside the case")
    item = WorkItem(
        case_id=case_id,
        type=type,
        title=title.strip(),
        assignee_principal_id=assignee_principal_id,
        reporter_principal_id=principal_id,
        deadline=deadline,
        priority=priority,
        document_id=document_id,
        figure_document_id=figure_document_id,
        release_id=release_id,
        source_operation_id=source_operation_id,
        source_run_id=source_run_id,
        official_no=official_no,
        oa_deadline=oa_deadline,
        response_document_id=response_document_id,
    )
    session.add(item)
    session.flush()
    return item


def assign_work_item(
    session: Session,
    work_item_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    assignee_principal_id: uuid.UUID | None,
) -> WorkItem:
    item = _work_item_for(session, work_item_id, principal_id)
    if item.status in {"done", "canceled"}:
        raise WorkItemConflict("terminal work item cannot be assigned")
    _check_assignee(session, item.case_id, assignee_principal_id)
    item.assignee_principal_id = assignee_principal_id
    item.updated_at = datetime.now(UTC)
    session.flush()
    return item


def reschedule_work_item(
    session: Session, work_item_id: uuid.UUID, *, principal_id: uuid.UUID, deadline: datetime | None
) -> WorkItem:
    item = _work_item_for(session, work_item_id, principal_id)
    if item.status in {"done", "canceled"}:
        raise WorkItemConflict("terminal work item cannot be rescheduled")
    item.deadline = deadline
    item.updated_at = datetime.now(UTC)
    session.flush()
    return item


def transition_work_item(
    session: Session, work_item_id: uuid.UUID, *, principal_id: uuid.UUID, status: str
) -> WorkItem:
    item = session.scalar(select(WorkItem).where(WorkItem.id == work_item_id).with_for_update())
    if item is None:
        raise WorkItemNotFound("work item does not exist")
    try:
        _ensure_case_access(session, item.case_id, principal_id)
    except DocumentError as exc:
        raise WorkItemAuthorizationError(str(exc)) from exc
    if status not in WORK_ITEM_STATUSES or status not in _TRANSITIONS[item.status]:
        raise WorkItemConflict(f"invalid work item transition {item.status} -> {status}")
    item.status = status
    item.updated_at = datetime.now(UTC)
    item.completed_at = item.updated_at if status in {"done", "canceled"} else None
    session.flush()
    return item


def record_notification(
    session: Session,
    *,
    case_id: uuid.UUID,
    recipient_principal_id: uuid.UUID,
    notification_type: str,
    payload: dict[str, Any] | None = None,
    work_item_id: uuid.UUID | None = None,
    proposal_id: uuid.UUID | None = None,
    release_id: uuid.UUID | None = None,
    dedupe_key: str | None = None,
) -> Notification:
    if not _assignable(session, case_id, recipient_principal_id):
        raise NotificationError("recipient is outside the case")
    if dedupe_key is not None:
        existing = session.scalar(select(Notification).where(Notification.dedupe_key == dedupe_key))
        if existing is not None:
            if existing.case_id != case_id or existing.recipient_principal_id != recipient_principal_id:
                raise NotificationError("notification dedupe key is bound to another scope")
            return existing
    if work_item_id is not None:
        item = session.get(WorkItem, work_item_id)
        if item is None or item.case_id != case_id:
            raise NotificationError("work item is outside the case")
    if proposal_id is not None:
        proposal = session.get(Proposal, proposal_id)
        if proposal is None or proposal.case_id != case_id:
            raise NotificationError("proposal is outside the case")
    if release_id is not None:
        release = session.get(Release, release_id)
        if release is None or release.case_id != case_id:
            raise NotificationError("release is outside the case")
    if not notification_type.strip():
        raise NotificationError("notification_type is required")
    recipient = session.get(Principal, recipient_principal_id)
    if recipient is None:
        raise NotificationError("recipient does not exist")
    notice = Notification(
        id=uuid.uuid4().hex[:24],
        user_id=recipient.user_id,
        kind=notification_type[:16],
        title=notification_type[:200],
        body="",
        case_id=case_id,
        recipient_principal_id=recipient_principal_id,
        notification_type=notification_type,
        payload=payload or {},
        work_item_id=work_item_id,
        proposal_id=proposal_id,
        release_id=release_id,
        dedupe_key=dedupe_key,
    )
    session.add(notice)
    session.flush()
    return notice


def mark_notification_read(
    session: Session, notification_id: uuid.UUID | str, *, principal_id: uuid.UUID
) -> Notification:
    notice = session.scalar(select(Notification).where(Notification.id == str(notification_id)).with_for_update())
    if notice is None:
        raise NotificationError("notification does not exist")
    if notice.recipient_principal_id != principal_id:
        raise NotificationError("only the recipient may mark notification read")
    if notice.read_at is None:
        notice.read_at = datetime.now(UTC)
        session.flush()
    return notice


# Short aliases kept explicit for application-layer callers.
create_notification = record_notification
read_notification = mark_notification_read
