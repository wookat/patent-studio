# -*- coding: utf-8 -*-
"""案件附图与不可变 FigureRevision 领域模型。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
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

from patent_studio.domain.documents import (
    DocumentError,
    _content_columns,
    _content_ref,
    _ensure_case_access,
    _require_source,
)
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef

FIGURE_REVISION_SOURCES = ("manual", "agent", "migration", "agent_suggested_accepted")
FigureRevisionSource = Literal["manual", "agent", "migration", "agent_suggested_accepted"]


class FigureError(DocumentError):
    """附图领域操作被拒绝。"""


class FigureNotFound(FigureError):
    """附图或附图修订不存在。"""


class FigureConflict(FigureError):
    """附图状态或修订基线冲突。"""


class FigureRevisionImmutableError(FigureError):
    """附图修订创建后不可变。"""


class FigureDocument(Base):
    __tablename__ = "figure_documents"
    __table_args__ = (
        UniqueConstraint("case_id", "figure_no", name="uq_figure_documents_case_number"),
        ForeignKeyConstraint(
            ["id", "current_revision_id"],
            ["figure_revisions.figure_document_id", "figure_revisions.id"],
            ondelete="RESTRICT",
            name="fk_figure_documents_current_revision",
            use_alter=True,
        ),
        CheckConstraint("figure_no IS NULL OR figure_no > 0", name="figure_no"),
        Index("ix_figure_documents_case", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="RESTRICT"), nullable=True
    )
    anchor: Mapped[str | None] = mapped_column(String(256), nullable=True)
    figure_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FigureRevision(Base):
    __tablename__ = "figure_revisions"
    __table_args__ = (
        UniqueConstraint("figure_document_id", "revision_no", name="uq_figure_revisions_number"),
        UniqueConstraint("figure_document_id", "id", name="uq_figure_revisions_figure_id"),
        ForeignKeyConstraint(
            ["figure_document_id", "parent_revision_id"],
            ["figure_revisions.figure_document_id", "figure_revisions.id"],
            ondelete="RESTRICT",
            name="fk_figure_revisions_parent",
        ),
        CheckConstraint("revision_no > 0", name="revision_no"),
        CheckConstraint(
            "source IN ('manual', 'agent', 'migration', 'agent_suggested_accepted')", name="source"
        ),
        CheckConstraint("content_size >= 0", name="content_size"),
        CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name="content_sha256"),
        Index("ix_figure_revisions_figure_order", "figure_document_id", "revision_no"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    figure_document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("figure_documents.id", ondelete="RESTRICT"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    author_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef:
        return _content_ref(self)


@event.listens_for(FigureRevision, "before_update")
def _reject_figure_revision_update(_mapper, _connection, _target) -> None:
    raise FigureRevisionImmutableError("figure revisions are immutable")


def _figure_for(session: Session, figure_document_id: uuid.UUID, principal_id: uuid.UUID) -> FigureDocument:
    figure = session.get(FigureDocument, figure_document_id)
    if figure is None:
        raise FigureNotFound("figure document does not exist")
    _ensure_case_access(session, figure.case_id, principal_id)
    return figure


def create_figure_document(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    document_id: uuid.UUID | None = None,
    anchor: str | None = None,
    figure_no: int | None = None,
    title: str = "",
) -> FigureDocument:
    _ensure_case_access(session, case_id, principal_id)
    if document_id is not None:
        from patent_studio.domain.documents import Document

        document = session.get(Document, document_id)
        if document is None or document.case_id != case_id:
            raise FigureConflict("figure document reference is outside the case")
    figure = FigureDocument(
        case_id=case_id,
        document_id=document_id,
        anchor=anchor,
        figure_no=figure_no,
        title=title,
    )
    session.add(figure)
    session.flush()
    return figure


def get_figure_document(session: Session, figure_document_id: uuid.UUID, *, principal_id: uuid.UUID) -> FigureDocument:
    return _figure_for(session, figure_document_id, principal_id)


def list_figure_revisions(
    session: Session, figure_document_id: uuid.UUID, *, principal_id: uuid.UUID
) -> list[FigureRevision]:
    figure = _figure_for(session, figure_document_id, principal_id)
    return list(
        session.scalars(
            select(FigureRevision)
            .where(FigureRevision.figure_document_id == figure.id)
            .order_by(FigureRevision.revision_no)
        ).all()
    )


def create_figure_revision(
    session: Session,
    figure_document_id: uuid.UUID,
    *,
    author_principal_id: uuid.UUID,
    content_ref: ObjectRef,
    source: FigureRevisionSource = "manual",
    parent_revision_id: uuid.UUID | None = None,
) -> FigureRevision:
    figure = _figure_for(session, figure_document_id, author_principal_id)
    figure = session.scalar(
        select(FigureDocument)
        .where(FigureDocument.id == figure.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert figure is not None
    if parent_revision_id is None:
        parent_revision_id = figure.current_revision_id
    if figure.current_revision_id != parent_revision_id:
        raise FigureConflict("figure current revision moved")
    if parent_revision_id is None:
        revision_no = 1
    else:
        parent = session.scalar(
            select(FigureRevision).where(
                FigureRevision.figure_document_id == figure.id,
                FigureRevision.id == parent_revision_id,
            )
        )
        if parent is None:
            raise FigureConflict("parent figure revision does not belong to figure")
        revision_no = parent.revision_no + 1
    revision = FigureRevision(
        figure_document_id=figure.id,
        revision_no=revision_no,
        parent_revision_id=parent_revision_id,
        author_principal_id=author_principal_id,
        source=_require_source(source),
        **_content_columns(content_ref),
    )
    session.add(revision)
    session.flush()
    figure.current_revision_id = revision.id
    figure.updated_at = datetime.now(UTC)
    session.flush()
    return revision
