# -*- coding: utf-8 -*-
"""Yjs update log 持久化边界与 WorkingCopy/Release 提交屏障。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import (
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
    update,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import (
    DocumentError,
    DocumentNotFound,
    Revision,
    WorkingCopy,
    _content_columns,
    _ensure_case_access,
)
from patent_studio.domain.proposals import Proposal
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef


class CollabError(DocumentError):
    """协作日志操作被拒绝。"""


class CollabNotFound(CollabError):
    """协作房间不存在。"""


class CollabConflict(CollabError):
    """协作日志序列、时钟或 checkpoint 冲突。"""


class SubmissionBarrierError(CollabError):
    """提交屏障阻止提交或封存。"""

    def __init__(self, reasons: tuple[str, ...]) -> None:
        self.reasons = reasons
        super().__init__("submission barrier blocked: " + ", ".join(reasons))


@dataclass(frozen=True)
class CollabUpdateInput:
    clock: int
    content_ref: ObjectRef


@dataclass(frozen=True)
class BarrierDecision:
    allowed: bool
    reasons: tuple[str, ...] = ()


class CollabRoom(Base):
    __tablename__ = "collab_rooms"
    __table_args__ = (
        UniqueConstraint("working_copy_id", name="uq_collab_rooms_working_copy"),
        CheckConstraint("last_seq >= 0", name="last_seq"),
        CheckConstraint("last_clock >= 0", name="last_clock"),
        CheckConstraint("checkpoint_seq >= 0", name="checkpoint_seq"),
        Index("ix_collab_rooms_case", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    working_copy_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("working_copies.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    last_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_clock: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checkpoint_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checkpoint_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    checkpoint_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    checkpoint_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checkpoint_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def checkpoint_ref(self) -> ObjectRef | None:
        if self.checkpoint_key is None:
            return None
        if self.checkpoint_sha256 is None or self.checkpoint_size is None or self.checkpoint_type is None:
            raise CollabConflict("checkpoint reference is incomplete")
        return ObjectRef(self.checkpoint_key, self.checkpoint_sha256, self.checkpoint_size, self.checkpoint_type)


class CollabUpdate(Base):
    __tablename__ = "collab_updates"
    __table_args__ = (
        UniqueConstraint("room_id", "seq", name="uq_collab_updates_room_seq"),
        CheckConstraint("seq > 0", name="seq"),
        CheckConstraint("clock >= 0", name="clock"),
        CheckConstraint("payload_size >= 0", name="payload_size"),
        Index("ix_collab_updates_room_seq", "room_id", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("collab_rooms.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    clock: Mapped[int] = mapped_column(Integer, nullable=False)
    author_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    payload_key: Mapped[str] = mapped_column(String(512), nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_size: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_type: Mapped[str] = mapped_column(String(128), nullable=False)
    flushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef:
        return ObjectRef(self.payload_key, self.payload_sha256, self.payload_size, self.payload_type)


def _room_for(session: Session, room_id: uuid.UUID, principal_id: uuid.UUID) -> CollabRoom:
    room = session.get(CollabRoom, room_id)
    if room is None:
        raise CollabNotFound("collaboration room does not exist")
    _ensure_case_access(session, room.case_id, principal_id)
    return room


def create_collab_room(session: Session, working_copy_id: uuid.UUID, *, principal_id: uuid.UUID) -> CollabRoom:
    working_copy = session.get(WorkingCopy, working_copy_id)
    if working_copy is None:
        raise DocumentNotFound("working copy does not exist")
    from patent_studio.domain.documents import Document

    document = session.get(Document, working_copy.document_id)
    if document is None:
        raise DocumentNotFound("working copy document does not exist")
    _ensure_case_access(session, document.case_id, principal_id)
    existing = session.scalar(select(CollabRoom).where(CollabRoom.working_copy_id == working_copy.id))
    if existing is not None:
        return existing
    room = CollabRoom(working_copy_id=working_copy.id, case_id=document.case_id)
    session.add(room)
    session.flush()
    return room


def get_collab_room(session: Session, room_id: uuid.UUID, *, principal_id: uuid.UUID) -> CollabRoom:
    return _room_for(session, room_id, principal_id)


def append_collab_updates(
    session: Session,
    room_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    updates: Iterable[CollabUpdateInput],
) -> list[CollabUpdate]:
    room = _room_for(session, room_id, principal_id)
    room = session.scalar(
        select(CollabRoom).where(CollabRoom.id == room.id).with_for_update().execution_options(populate_existing=True)
    )
    assert room is not None
    batch = list(updates)
    if not batch:
        raise CollabConflict("append requires at least one update")
    seq = room.last_seq
    clock = room.last_clock
    result: list[CollabUpdate] = []
    for item in batch:
        if item.clock < clock:
            raise CollabConflict("lamport clock moved backwards")
        seq += 1
        clock = max(clock, item.clock)
        payload = _content_columns(item.content_ref)
        update_row = CollabUpdate(
            room_id=room.id,
            seq=seq,
            clock=clock,
            author_principal_id=principal_id,
            payload_key=payload["content_key"],
            payload_sha256=payload["content_sha256"],
            payload_size=payload["content_size"],
            payload_type=payload["content_type"],
        )
        session.add(update_row)
        result.append(update_row)
    room.last_seq = seq
    room.last_clock = clock
    room.updated_at = datetime.now(UTC)
    session.flush()
    return result


def read_collab_updates(
    session: Session,
    room_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    after_seq: int = 0,
    through_seq: int | None = None,
) -> list[CollabUpdate]:
    room = _room_for(session, room_id, principal_id)
    rows = list(
        session.scalars(
            select(CollabUpdate)
            .where(CollabUpdate.room_id == room.id, CollabUpdate.seq > after_seq)
            .order_by(CollabUpdate.seq)
        ).all()
    )
    expected = after_seq + 1
    for row in rows:
        if row.seq != expected:
            raise CollabConflict("collaboration update sequence has a gap")
        expected += 1
    if through_seq is not None and expected - 1 != through_seq:
        raise CollabConflict("requested collaboration update range has a gap")
    return rows


def flush_collab_updates(
    session: Session,
    room_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    through_seq: int | None = None,
) -> int:
    room = _room_for(session, room_id, principal_id)
    through = room.last_seq if through_seq is None else through_seq
    if through < 0 or through > room.last_seq:
        raise CollabConflict("flush sequence is outside room log")
    read_collab_updates(session, room.id, principal_id=principal_id, through_seq=through)
    result = session.execute(
        update(CollabUpdate)
        .where(
            CollabUpdate.room_id == room.id,
            CollabUpdate.seq <= through,
            CollabUpdate.flushed_at.is_(None),
        )
        .values(flushed_at=datetime.now(UTC))
    )
    session.flush()
    return result.rowcount


def checkpoint_collab_room(
    session: Session,
    room_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    checkpoint_seq: int,
    checkpoint_ref: ObjectRef,
) -> CollabRoom:
    room = _room_for(session, room_id, principal_id)
    if checkpoint_seq < room.checkpoint_seq or checkpoint_seq > room.last_seq:
        raise CollabConflict("checkpoint sequence is outside room log")
    read_collab_updates(session, room.id, principal_id=principal_id, through_seq=checkpoint_seq)
    room.checkpoint_seq = checkpoint_seq
    for key, value in _content_columns(checkpoint_ref).items():
        setattr(room, f"checkpoint_{key.removeprefix('content_')}", value)
    room.updated_at = datetime.now(UTC)
    session.flush()
    return room


def submission_barrier_for_working_copy(
    session: Session,
    working_copy_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
) -> BarrierDecision:
    working_copy = session.get(WorkingCopy, working_copy_id)
    if working_copy is None:
        raise DocumentNotFound("working copy does not exist")
    from patent_studio.domain.documents import Document

    document = session.get(Document, working_copy.document_id)
    if document is None:
        raise DocumentNotFound("working copy document does not exist")
    _ensure_case_access(session, document.case_id, principal_id)
    reasons: list[str] = []
    pending = session.scalar(
        select(CollabUpdate.id)
        .join(CollabRoom, CollabUpdate.room_id == CollabRoom.id)
        .where(CollabRoom.working_copy_id == working_copy.id, CollabUpdate.flushed_at.is_(None))
        .limit(1)
    )
    if pending is not None:
        reasons.append("pending_collab_updates")
    unresolved = session.scalar(
        select(Proposal.id)
        .where(
            Proposal.case_id == document.case_id,
            Proposal.status == "submitted",
            Proposal.target_kind == "document",
            Proposal.document_revision_id.in_(
                select(Revision.id).where(Revision.document_id == document.id)
            ),
        )
        .limit(1)
    )
    if unresolved is not None:
        reasons.append("unresolved_proposals")
    return BarrierDecision(not reasons, tuple(reasons))


def submission_barrier_for_case(session: Session, case_id: uuid.UUID, *, principal_id: uuid.UUID) -> BarrierDecision:
    _ensure_case_access(session, case_id, principal_id)
    reasons: list[str] = []
    if session.scalar(
        select(CollabUpdate.id)
        .join(CollabRoom, CollabUpdate.room_id == CollabRoom.id)
        .where(CollabRoom.case_id == case_id, CollabUpdate.flushed_at.is_(None))
        .limit(1)
    ) is not None:
        reasons.append("pending_collab_updates")
    if session.scalar(
        select(Proposal.id).where(Proposal.case_id == case_id, Proposal.status == "submitted").limit(1)
    ) is not None:
        reasons.append("unresolved_proposals")
    return BarrierDecision(not reasons, tuple(reasons))


def enforce_working_copy_barrier(
    session: Session,
    working_copy_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    force: bool = False,
    force_reason: str | None = None,
) -> BarrierDecision:
    if force and not force_reason:
        raise SubmissionBarrierError(("force_reason_required",))
    decision = submission_barrier_for_working_copy(session, working_copy_id, principal_id=principal_id)
    if not decision.allowed and not force:
        raise SubmissionBarrierError(decision.reasons)
    return decision


def enforce_case_barrier(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    force: bool = False,
    force_reason: str | None = None,
) -> BarrierDecision:
    if force and not force_reason:
        raise SubmissionBarrierError(("force_reason_required",))
    decision = submission_barrier_for_case(session, case_id, principal_id=principal_id)
    if not decision.allowed and not force:
        raise SubmissionBarrierError(decision.reasons)
    return decision
