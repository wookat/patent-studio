"""Durable Run state, event stream and approval inbox.

This module is the database contract used by Temporal activities. Workflow code
never mutates business aggregates directly; activities call these fenced services.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import DocumentError, _ensure_case_access
from patent_studio.domain.operations import Operation
from patent_studio.domain.organization import Case, CaseParticipant, OrganizationMembership
from patent_studio.infra.db import Base

RUN_STATUSES = ("queued", "running", "waiting_approval", "succeeded", "failed", "canceled")
APPROVAL_STATUSES = ("pending", "approved", "rejected")
_RUN_TRANSITIONS = {
    "queued": {"running", "failed", "canceled"},
    "running": {"waiting_approval", "succeeded", "failed", "canceled"},
    "waiting_approval": {"running", "succeeded", "failed", "canceled"},
    "succeeded": set(),
    "failed": set(),
    "canceled": set(),
}


class RunError(DocumentError):
    """Run/approval domain error."""


class RunNotFound(RunError):
    """Run or approval does not exist."""


class RunConflict(RunError):
    """Invalid state or fencing epoch."""


class RunAuthorizationError(RunError):
    """Caller is outside the run scope."""


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'canceled')", name="status"
        ),
        CheckConstraint("fencing_epoch > 0", name="fencing_epoch"),
        Index("ix_runs_case_status", "case_id", "status"),
        Index("ix_runs_principal_created", "triggered_by_principal_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    run_type: Mapped[str] = mapped_column("type", String(64), nullable=False)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    triggered_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    operation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("operations.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", server_default="queued")
    fencing_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    temporal_workflow_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    temporal_run_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunEvent(Base):
    __tablename__ = "run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),
        UniqueConstraint("run_id", "activity_key", name="uq_run_events_activity"),
        CheckConstraint("seq > 0", name="seq"),
        Index("ix_run_events_run_seq", "run_id", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    activity_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Approval(Base):
    __tablename__ = "approvals"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="status"),
        Index("ix_approvals_approver_status", "approver_principal_id", "status"),
        Index("ix_approvals_run_status", "run_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    approver_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    decided_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _run_for(session: Session, run_id: uuid.UUID | str, principal_id: uuid.UUID, *, lock=False) -> Run:
    query = select(Run).where(Run.id == run_id if isinstance(run_id, uuid.UUID) else Run.run_id == run_id)
    if lock:
        query = query.with_for_update()
    run = session.scalar(query)
    if run is None:
        raise RunNotFound("run does not exist")
    try:
        _ensure_case_access(session, run.case_id, principal_id)
    except DocumentError as exc:
        raise RunAuthorizationError(str(exc)) from exc
    return run


def _assignable(session: Session, case_id: uuid.UUID, principal_id: uuid.UUID) -> bool:
    return (
        session.scalar(
            select(OrganizationMembership.principal_id)
            .join(Case, Case.organization_id == OrganizationMembership.organization_id)
            .where(
                Case.id == case_id,
                OrganizationMembership.principal_id == principal_id,
                OrganizationMembership.status == "active",
            )
        )
        is not None
        or session.scalar(
            select(CaseParticipant.principal_id).where(
                CaseParticipant.case_id == case_id,
                CaseParticipant.principal_id == principal_id,
                CaseParticipant.status == "active",
            )
        )
        is not None
    )


def create_run(
    session: Session,
    run_id: str,
    *,
    run_type: str,
    case_id: uuid.UUID,
    principal_id: uuid.UUID,
    operation_id: str | None = None,
    temporal_workflow_id: str | None = None,
) -> Run:
    _ensure_case_access(session, case_id, principal_id)
    if not run_id.strip() or not run_type.strip():
        raise RunConflict("run_id and run_type are required")
    existing = session.scalar(select(Run).where(Run.run_id == run_id).with_for_update())
    if existing is not None:
        if (
            existing.case_id != case_id
            or existing.triggered_by_principal_id != principal_id
            or existing.run_type != run_type
        ):
            raise RunConflict("run_id is bound to another scope or type")
        return existing
    operation = None
    if operation_id is not None:
        operation = session.scalar(select(Operation).where(Operation.operation_id == operation_id))
        if operation is None or operation.case_id != case_id or operation.principal_id != principal_id:
            raise RunConflict("operation is outside run scope")
    run = Run(
        run_id=run_id,
        run_type=run_type,
        case_id=case_id,
        triggered_by_principal_id=principal_id,
        operation_id=operation.id if operation else None,
        temporal_workflow_id=temporal_workflow_id,
    )
    session.add(run)
    session.flush()
    append_run_event(session, run.id, principal_id=principal_id, event_type="run.queued", payload={})
    return run


def transition_run(
    session: Session,
    run_id: uuid.UUID | str,
    *,
    principal_id: uuid.UUID,
    status: str,
    expected_epoch: int | None = None,
    error_summary: str | None = None,
) -> Run:
    run = _run_for(session, run_id, principal_id, lock=True)
    if status not in RUN_STATUSES or status not in _RUN_TRANSITIONS[run.status]:
        raise RunConflict(f"invalid run transition {run.status} -> {status}")
    if expected_epoch is not None and run.fencing_epoch != expected_epoch:
        raise RunConflict("run fencing epoch changed")
    now = datetime.now(UTC)
    run.status = status
    if status == "running" and run.started_at is None:
        run.started_at = now
    if status in {"succeeded", "failed", "canceled"}:
        run.finished_at = now
        run.error_summary = error_summary[:1000] if error_summary else None
    if status == "canceled":
        run.fencing_epoch += 1
    session.flush()
    append_run_event(session, run.id, principal_id=principal_id, event_type=f"run.{status}", payload={})
    return run


def append_run_event(
    session: Session,
    run_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    event_type: str,
    payload: dict[str, Any] | None = None,
    expected_epoch: int | None = None,
    activity_key: str | None = None,
) -> RunEvent:
    run = _run_for(session, run_id, principal_id, lock=True)
    if expected_epoch is not None and run.fencing_epoch != expected_epoch:
        raise RunConflict("run fencing epoch changed")
    if activity_key is not None:
        existing = session.scalar(
            select(RunEvent).where(RunEvent.run_id == run.id, RunEvent.activity_key == activity_key)
        )
        if existing is not None:
            return existing
    latest = (
        session.scalar(select(RunEvent.seq).where(RunEvent.run_id == run.id).order_by(RunEvent.seq.desc()).limit(1))
        or 0
    )
    event = RunEvent(
        run_id=run.id,
        seq=latest + 1,
        event_type=event_type,
        payload=payload or {},
        activity_key=activity_key,
    )
    session.add(event)
    session.flush()
    return event


def request_approval(
    session: Session,
    run_id: uuid.UUID | str,
    *,
    principal_id: uuid.UUID,
    approver_principal_id: uuid.UUID,
) -> Approval:
    run = _run_for(session, run_id, principal_id, lock=True)
    if run.status == "running":
        transition_run(
            session, run.id, principal_id=principal_id, status="waiting_approval", expected_epoch=run.fencing_epoch
        )
    elif run.status != "waiting_approval":
        raise RunConflict("approval can only be requested by an active run")
    if not _assignable(session, run.case_id, approver_principal_id):
        raise RunAuthorizationError("approver is outside the case scope")
    approval = Approval(
        run_id=run.id,
        case_id=run.case_id,
        approver_principal_id=approver_principal_id,
    )
    session.add(approval)
    session.flush()
    append_run_event(
        session,
        run.id,
        principal_id=principal_id,
        event_type="approval.requested",
        payload={"approval_id": str(approval.id)},
    )
    return approval


def decide_approval(
    session: Session,
    approval_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    decision: str,
    reason: str | None = None,
) -> Approval:
    approval = session.scalar(select(Approval).where(Approval.id == approval_id).with_for_update())
    if approval is None:
        raise RunNotFound("approval does not exist")
    if approval.status != "pending":
        raise RunConflict("approval is already decided")
    if approval.approver_principal_id != principal_id:
        raise RunAuthorizationError("principal is not the assigned approver")
    if decision not in {"approved", "rejected"}:
        raise RunConflict("approval decision is invalid")
    run = _run_for(session, approval.run_id, principal_id, lock=True)
    approval.status = decision
    approval.decided_by_principal_id = principal_id
    approval.decided_at = datetime.now(UTC)
    approval.reason = reason[:1000] if reason else None
    session.flush()
    if decision == "approved":
        transition_run(session, run.id, principal_id=principal_id, status="running", expected_epoch=run.fencing_epoch)
    else:
        transition_run(
            session,
            run.id,
            principal_id=principal_id,
            status="failed",
            expected_epoch=run.fencing_epoch,
            error_summary=reason or "approval rejected",
        )
    return approval


def cancel_run(session: Session, run_id: uuid.UUID | str, *, principal_id: uuid.UUID, expected_epoch: int) -> Run:
    return transition_run(session, run_id, principal_id=principal_id, status="canceled", expected_epoch=expected_epoch)
