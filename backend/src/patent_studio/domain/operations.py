"""幂等业务操作与事务 outbox。

Operation、业务写入和 outbox event 由调用方放在同一个 SQLAlchemy 事务中；本模块
只负责记录、状态推进和安全领取，不连接 broker。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.identity import Principal
from patent_studio.domain.organization import Case, OrganizationMembership
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef

OPERATION_STATUSES = ("pending", "running", "succeeded", "failed", "canceled")
_TERMINAL = {"succeeded", "failed", "canceled"}
_TRANSITIONS = {
    "pending": {"running", "canceled"},
    "running": {"succeeded", "failed", "canceled"},
    "succeeded": set(),
    "failed": set(),
    "canceled": set(),
}


class OperationError(ValueError):
    """Operation/outbox 领域错误。"""


class OperationConflict(OperationError):
    """幂等键已被不同操作占用，或操作正在执行。"""


class OperationNotFound(OperationError):
    """操作或事件不存在。"""


class OperationAuthorizationError(OperationError):
    """操作的 principal 与机构/案件范围不匹配。"""


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')", name="status"),
        CheckConstraint("payload_size IS NULL OR payload_size >= 0", name="payload_size"),
        Index("ix_operations_scope_status", "organization_id", "case_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    operation_type: Mapped[str] = mapped_column("type", String(128), nullable=False)
    principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    payload_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    payload_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint("payload_size IS NULL OR payload_size >= 0", name="payload_size"),
        CheckConstraint("attempt_count >= 0", name="attempt_count"),
        Index("ix_outbox_claimable", "published_at", "lease_until", "created_at"),
        Index("ix_outbox_operation", "operation_id"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("operations.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    payload_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    payload_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _payload_columns(payload_ref: ObjectRef | None) -> dict[str, object]:
    if payload_ref is None:
        return {}
    if not isinstance(payload_ref, ObjectRef) or not payload_ref.key.strip() or len(payload_ref.sha256) != 64:
        raise OperationError("payload_ref must be a valid ObjectRef")
    if payload_ref.size < 0 or not payload_ref.content_type.strip():
        raise OperationError("payload_ref has invalid size or content type")
    return {
        "payload_key": payload_ref.key,
        "payload_sha256": payload_ref.sha256,
        "payload_size": payload_ref.size,
        "payload_type": payload_ref.content_type,
    }


def _scope_check(
    session: Session, *, principal_id: uuid.UUID, organization_id: uuid.UUID, case_id: uuid.UUID | None
) -> None:
    if session.get(Principal, principal_id) is None:
        raise OperationAuthorizationError("principal does not exist")
    if session.scalar(
        select(OrganizationMembership.principal_id).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    ) is None:
        raise OperationAuthorizationError("principal is not an active organization member")
    if case_id is not None:
        case = session.get(Case, case_id)
        if case is None or case.organization_id != organization_id:
            raise OperationAuthorizationError("case is outside operation organization")
        from patent_studio.domain.documents import _ensure_case_access

        _ensure_case_access(session, case_id, principal_id)


def record_operation(
    session: Session,
    operation_id: str,
    *,
    operation_type: str,
    principal_id: uuid.UUID,
    organization_id: uuid.UUID,
    case_id: uuid.UUID | None = None,
    payload_ref: ObjectRef | None = None,
) -> Operation:
    """创建或返回幂等键对应的 Operation；范围/类型不一致时 fail-closed。"""
    if not operation_id.strip() or len(operation_id) > 128 or not operation_type.strip():
        raise OperationError("operation_id and operation_type are required")
    _scope_check(session, principal_id=principal_id, organization_id=organization_id, case_id=case_id)
    existing = session.scalar(
        select(Operation).where(Operation.operation_id == operation_id).with_for_update()
    )
    if existing is not None:
        if (
            existing.operation_type != operation_type
            or existing.principal_id != principal_id
            or existing.organization_id != organization_id
            or existing.case_id != case_id
        ):
            raise OperationConflict("operation_id is already bound to another scope or type")
        return existing
    operation = Operation(
        operation_id=operation_id,
        operation_type=operation_type,
        principal_id=principal_id,
        organization_id=organization_id,
        case_id=case_id,
        **_payload_columns(payload_ref),
    )
    session.add(operation)
    session.flush()
    return operation


def transition_operation(
    session: Session,
    operation_id: str,
    status: str,
    *,
    error_summary: str | None = None,
) -> Operation:
    if status not in OPERATION_STATUSES:
        raise OperationError(f"unsupported operation status: {status}")
    operation = session.scalar(select(Operation).where(Operation.operation_id == operation_id).with_for_update())
    if operation is None:
        raise OperationNotFound(operation_id)
    if status not in _TRANSITIONS[operation.status]:
        raise OperationConflict(f"invalid operation transition {operation.status} -> {status}")
    now = datetime.now(UTC)
    operation.status = status
    if status == "running":
        operation.started_at = now
    if status in _TERMINAL:
        operation.finished_at = now
        operation.error_summary = error_summary[:1000] if error_summary else None
    session.flush()
    return operation


def append_outbox_event(
    session: Session,
    operation_id: str | uuid.UUID,
    *,
    event_type: str,
    payload_json: dict[str, Any] | None = None,
    payload_ref: ObjectRef | None = None,
) -> OutboxEvent:
    if not event_type.strip():
        raise OperationError("event_type is required")
    operation = (
        session.get(Operation, operation_id)
        if isinstance(operation_id, uuid.UUID)
        else session.scalar(select(Operation).where(Operation.operation_id == operation_id))
    )
    if operation is None:
        raise OperationNotFound(str(operation_id))
    event = OutboxEvent(
        operation_id=operation.id,
        event_type=event_type,
        payload_json=payload_json,
        **_payload_columns(payload_ref),
    )
    session.add(event)
    session.flush()
    return event


def claim_outbox_batch(
    session: Session,
    *,
    worker_id: str,
    limit: int = 50,
    lease_seconds: int = 60,
) -> list[OutboxEvent]:
    if not worker_id.strip() or limit < 1 or lease_seconds < 1:
        raise OperationError("worker_id, positive limit and lease_seconds are required")
    now = datetime.now(UTC)
    rows = list(
        session.scalars(
            select(OutboxEvent)
            .where(
                OutboxEvent.published_at.is_(None),
                (OutboxEvent.lease_until.is_(None) | (OutboxEvent.lease_until <= now)),
            )
            .order_by(OutboxEvent.created_at, OutboxEvent.event_id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    )
    until = now + timedelta(seconds=lease_seconds)
    for row in rows:
        row.claimed_by = worker_id
        row.lease_until = until
        row.attempt_count += 1
    session.flush()
    return rows


def mark_outbox_published(session: Session, event_id: uuid.UUID, *, worker_id: str) -> OutboxEvent:
    event = session.scalar(select(OutboxEvent).where(OutboxEvent.event_id == event_id).with_for_update())
    if event is None:
        raise OperationNotFound(str(event_id))
    if event.published_at is not None:
        return event
    if event.claimed_by != worker_id:
        raise OperationConflict("outbox event is fenced to another worker")
    event.published_at = datetime.now(UTC)
    event.claimed_by = None
    event.lease_until = None
    session.flush()
    return event


def commit_working_copy_with_outbox(
    session: Session,
    working_copy_id: uuid.UUID,
    *,
    operation_id: str,
    principal_id: uuid.UUID,
    organization_id: uuid.UUID,
    expected_version: int | None = None,
    author_principal_id: uuid.UUID | None = None,
    source: str = "manual",
    force: bool = False,
    force_reason: str | None = None,
) -> Operation:
    """WorkingCopy commit 样板：业务写入、事件和状态推进共用调用方事务。"""
    from patent_studio.domain.documents import Document, commit_working_copy, get_working_copy

    working_copy = get_working_copy(session, working_copy_id, principal_id=principal_id)
    document = session.get(Document, working_copy.document_id)
    if document is None:
        raise OperationNotFound(str(working_copy.document_id))
    operation = record_operation(
        session,
        operation_id,
        operation_type="working_copy.commit",
        principal_id=principal_id,
        organization_id=organization_id,
        case_id=document.case_id,
    )
    if operation.status == "succeeded":
        return operation
    if operation.status != "pending":
        raise OperationConflict(f"operation is already {operation.status}")
    transition_operation(session, operation_id, "running")
    try:
        revision = commit_working_copy(
            session,
            working_copy.id,
            principal_id=principal_id,
            expected_version=expected_version,
            author_principal_id=author_principal_id,
            source=source,  # type: ignore[arg-type]
            force=force,
            force_reason=force_reason,
        )
        append_outbox_event(
            session,
            operation_id,
            event_type="working_copy.committed",
            payload_json={"revision_id": str(revision.id), "working_copy_id": str(working_copy.id)},
        )
        return transition_operation(session, operation_id, "succeeded")
    except Exception:
        session.rollback()
        raise
