# -*- coding: utf-8 -*-
"""案件 Release 冻结件：revision/ObjectRef 清单与 sealed 边界。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.orm.attributes import get_history

from patent_studio.domain.documents import DocumentError, Revision, _content_columns, _ensure_case_access
from patent_studio.domain.figures import FigureDocument, FigureRevision
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef

RELEASE_STATUSES = ("created", "sealed")


class ReleaseError(DocumentError):
    """Release 领域操作被拒绝。"""


class ReleaseNotFound(ReleaseError):
    """Release 不存在。"""


class ReleaseConflict(ReleaseError):
    """Release 状态或快照目标冲突。"""


class Release(Base):
    __tablename__ = "releases"
    __table_args__ = (
        CheckConstraint("status IN ('created', 'sealed')", name="status"),
        Index("ix_releases_case_status", "case_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="created", server_default="created")
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    sealed_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReleaseItem(Base):
    __tablename__ = "release_items"
    __table_args__ = (
        UniqueConstraint("release_id", "ordinal", name="uq_release_items_order"),
        CheckConstraint("item_kind IN ('document', 'figure')", name="item_kind"),
        CheckConstraint(
            "((item_kind = 'document' AND document_revision_id IS NOT NULL AND figure_revision_id IS NULL) OR "
            "(item_kind = 'figure' AND document_revision_id IS NULL AND figure_revision_id IS NOT NULL))",
            name="item_revision",
        ),
        Index("ix_release_items_release", "release_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    release_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("releases.id", ondelete="CASCADE"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    item_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    document_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    figure_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("figure_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)

    @property
    def content_ref(self) -> ObjectRef:
        return ObjectRef(self.content_key, self.content_sha256, self.content_size, self.content_type)


@event.listens_for(Release, "before_update")
def _sealed_release_is_immutable(_mapper, _connection, target: Release) -> None:
    history = get_history(target, "status")
    if target.status == "sealed" and not (history.deleted and history.deleted[0] == "created"):
        raise ReleaseConflict("sealed release is immutable")


def _release_for(session: Session, release_id: uuid.UUID, principal_id: uuid.UUID) -> Release:
    release = session.get(Release, release_id)
    if release is None:
        raise ReleaseNotFound("release does not exist")
    _ensure_case_access(session, release.case_id, principal_id)
    return release


def create_release(session: Session, case_id: uuid.UUID, *, principal_id: uuid.UUID) -> Release:
    _ensure_case_access(session, case_id, principal_id)
    release = Release(case_id=case_id, created_by_principal_id=principal_id)
    session.add(release)
    session.flush()
    return release


def get_release(session: Session, release_id: uuid.UUID, *, principal_id: uuid.UUID) -> Release:
    return _release_for(session, release_id, principal_id)


def add_release_item(
    session: Session,
    release_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    item_kind: Literal["document", "figure"],
    revision_id: uuid.UUID,
    ordinal: int | None = None,
) -> ReleaseItem:
    release = _release_for(session, release_id, principal_id)
    if release.status != "created":
        raise ReleaseConflict("sealed release cannot be modified")
    if item_kind == "document":
        revision = session.get(Revision, revision_id)
        if revision is None:
            raise ReleaseConflict("document revision does not exist")
        from patent_studio.domain.documents import Document

        document = session.get(Document, revision.document_id)
        if document is None or document.case_id != release.case_id:
            raise ReleaseConflict("document revision is outside the release case")
        figure_revision = None
    elif item_kind == "figure":
        figure_revision = session.get(FigureRevision, revision_id)
        if figure_revision is None:
            raise ReleaseConflict("figure revision does not exist")
        figure = session.get(FigureDocument, figure_revision.figure_document_id)
        if figure is None or figure.case_id != release.case_id:
            raise ReleaseConflict("figure revision is outside the release case")
        revision = None
    else:
        raise ReleaseConflict("unsupported release item kind")
    if ordinal is None:
        latest = session.scalar(select(func.max(ReleaseItem.ordinal)).where(ReleaseItem.release_id == release.id)) or 0
        ordinal = latest + 1
    if ordinal <= 0:
        raise ReleaseConflict("release item ordinal must be positive")
    source = revision or figure_revision
    item = ReleaseItem(
        release_id=release.id,
        ordinal=ordinal,
        item_kind=item_kind,
        document_revision_id=revision.id if revision is not None else None,
        figure_revision_id=figure_revision.id if figure_revision is not None else None,
        **_content_columns(source.content_ref),
    )
    session.add(item)
    session.flush()
    return item


def seal_release(
    session: Session,
    release_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    force: bool = False,
    force_reason: str | None = None,
) -> Release:
    release = _release_for(session, release_id, principal_id)
    if release.status != "created":
        raise ReleaseConflict("release is already sealed")
    from patent_studio.domain.collab import enforce_case_barrier

    enforce_case_barrier(
        session,
        release.case_id,
        principal_id=principal_id,
        force=force,
        force_reason=force_reason,
    )
    if session.scalar(select(ReleaseItem.id).where(ReleaseItem.release_id == release.id)) is None:
        raise ReleaseConflict("cannot seal an empty release")
    release.status = "sealed"
    release.sealed_by_principal_id = principal_id
    release.sealed_at = datetime.now(UTC)
    session.flush()
    return release
