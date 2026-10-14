# -*- coding: utf-8 -*-
"""PostgreSQL 文稿聚合：Document、不可变 Revision 与乐观 WorkingCopy。"""

from __future__ import annotations

import re
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

from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, OrganizationMembership
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef

DOCUMENT_BOOKS = ("abstract", "claims", "description")
REVISION_SOURCES = ("manual", "agent", "migration")
DocumentBook = Literal["abstract", "claims", "description"]
RevisionSource = Literal["manual", "agent", "migration"]
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class DocumentError(ValueError):
    """文稿领域操作被拒绝。"""


class DocumentNotFound(DocumentError):
    """文稿、修订或工作副本不存在。"""


class DocumentAuthorizationError(DocumentError):
    """Principal 无权访问案件文稿。"""


class DocumentConflict(DocumentError):
    """文稿状态或唯一关系冲突。"""


class RevisionConflict(DocumentConflict):
    """当前修订已前进，提交基线过期。"""


class WorkingCopyConflict(DocumentConflict):
    """工作副本版本已被其他保存操作推进。"""


class RevisionImmutableError(DocumentError):
    """Revision 创建后不可变。"""


def _content_columns(content_ref: ObjectRef) -> dict[str, object]:
    if not isinstance(content_ref, ObjectRef):
        raise DocumentError("content_ref must be an ObjectRef")
    if not content_ref.key.strip() or not _SHA256.fullmatch(content_ref.sha256):
        raise DocumentError("content_ref must contain a lowercase SHA-256 digest and key")
    if content_ref.size < 0 or not content_ref.content_type.strip():
        raise DocumentError("content_ref size and content type are invalid")
    return {
        "content_key": content_ref.key,
        "content_sha256": content_ref.sha256,
        "content_size": content_ref.size,
        "content_type": content_ref.content_type,
    }


def _content_ref(row: Revision | WorkingCopy) -> ObjectRef:
    return ObjectRef(row.content_key, row.content_sha256, row.content_size, row.content_type)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("case_id", "book", name="uq_documents_case_book"),
        ForeignKeyConstraint(
            ["id", "current_revision_id"],
            ["document_revisions.document_id", "document_revisions.id"],
            ondelete="RESTRICT",
            name="fk_documents_current_revision",
            use_alter=True,
        ),
        CheckConstraint("book IN ('abstract', 'claims', 'description')", name="book"),
        Index("ix_documents_case", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    book: Mapped[str] = mapped_column(String(16), nullable=False)
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Revision(Base):
    __tablename__ = "document_revisions"
    __table_args__ = (
        UniqueConstraint("document_id", "revision_no", name="uq_document_revisions_number"),
        UniqueConstraint("document_id", "id", name="uq_document_revisions_document_id"),
        ForeignKeyConstraint(
            ["document_id", "parent_revision_id"],
            ["document_revisions.document_id", "document_revisions.id"],
            ondelete="RESTRICT",
            name="fk_document_revisions_parent",
        ),
        CheckConstraint("revision_no > 0", name="revision_no"),
        CheckConstraint("source IN ('manual', 'agent', 'migration')", name="source"),
        CheckConstraint("content_size >= 0", name="content_size"),
        CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name="content_sha256"),
        Index("ix_document_revisions_document_order", "document_id", "revision_no"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    author_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef:
        return _content_ref(self)


class WorkingCopy(Base):
    __tablename__ = "working_copies"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "base_revision_id"],
            ["document_revisions.document_id", "document_revisions.id"],
            ondelete="RESTRICT",
            name="fk_working_copies_base_revision",
        ),
        CheckConstraint("version > 0", name="version"),
        CheckConstraint("content_size >= 0", name="content_size"),
        CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name="content_sha256"),
        Index("ix_working_copies_document", "document_id"),
        Index("ix_working_copies_principal", "principal_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False
    )
    principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    base_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef:
        return _content_ref(self)


@event.listens_for(Revision, "before_update")
def _reject_revision_update(_mapper, _connection, _target) -> None:
    raise RevisionImmutableError("revisions are immutable")


def _active_principal(session: Session, principal_id: uuid.UUID) -> bool:
    row = session.execute(
        select(Principal.kind, User.is_active)
        .select_from(Principal)
        .outerjoin(User, User.id == Principal.user_id)
        .where(Principal.id == principal_id)
    ).one_or_none()
    return row is not None and (row.kind == "agent" or row.is_active is True)


def _ensure_case_access(session: Session, case_id: uuid.UUID, principal_id: uuid.UUID) -> Case:
    case = session.get(Case, case_id)
    if case is None:
        raise DocumentNotFound("case does not exist")
    if not _active_principal(session, principal_id):
        raise DocumentAuthorizationError("principal is inactive or missing")
    member = session.scalar(
        select(OrganizationMembership.principal_id).where(
            OrganizationMembership.organization_id == case.organization_id,
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
    if member is None and participant is None:
        raise DocumentAuthorizationError("principal cannot access case")
    return case


def _document_for(session: Session, document_id: uuid.UUID, principal_id: uuid.UUID) -> Document:
    document = session.get(Document, document_id)
    if document is None:
        raise DocumentNotFound("document does not exist")
    _ensure_case_access(session, document.case_id, principal_id)
    return document


def _require_book(book: str) -> str:
    if book not in DOCUMENT_BOOKS:
        raise DocumentError(f"unsupported document book: {book!r}")
    return book


def _require_source(source: str) -> str:
    if source not in REVISION_SOURCES:
        raise DocumentError(f"unsupported revision source: {source!r}")
    return source


def create_document(
    session: Session,
    case_id: uuid.UUID,
    *,
    book: DocumentBook,
    principal_id: uuid.UUID,
) -> Document:
    _ensure_case_access(session, case_id, principal_id)
    book = _require_book(book)
    if session.scalar(select(Document.id).where(Document.case_id == case_id, Document.book == book)) is not None:
        raise DocumentConflict("document book already exists for case")
    document = Document(case_id=case_id, book=book)
    session.add(document)
    session.flush()
    return document


def get_document(session: Session, document_id: uuid.UUID, *, principal_id: uuid.UUID) -> Document:
    return _document_for(session, document_id, principal_id)


def list_revisions(session: Session, document_id: uuid.UUID, *, principal_id: uuid.UUID) -> list[Revision]:
    document = _document_for(session, document_id, principal_id)
    return list(
        session.scalars(
            select(Revision).where(Revision.document_id == document.id).order_by(Revision.revision_no)
        ).all()
    )


def get_working_copy(session: Session, working_copy_id: uuid.UUID, *, principal_id: uuid.UUID) -> WorkingCopy:
    working_copy = session.get(WorkingCopy, working_copy_id)
    if working_copy is None:
        raise DocumentNotFound("working copy does not exist")
    if working_copy.principal_id != principal_id:
        raise DocumentAuthorizationError("working copy belongs to another principal")
    _document_for(session, working_copy.document_id, principal_id)
    return working_copy


def _append_revision(
    session: Session,
    document: Document,
    *,
    author_principal_id: uuid.UUID,
    content_ref: ObjectRef,
    source: RevisionSource,
    parent_revision_id: uuid.UUID | None,
) -> Revision:
    if document.current_revision_id != parent_revision_id:
        raise RevisionConflict("document current revision moved")
    if parent_revision_id is None:
        revision_no = 1
    else:
        parent = session.scalar(
            select(Revision).where(
                Revision.document_id == document.id,
                Revision.id == parent_revision_id,
            )
        )
        if parent is None:
            raise RevisionConflict("parent revision does not belong to document")
        revision_no = parent.revision_no + 1
    revision = Revision(
        document_id=document.id,
        revision_no=revision_no,
        parent_revision_id=parent_revision_id,
        author_principal_id=author_principal_id,
        source=_require_source(source),
        **_content_columns(content_ref),
    )
    session.add(revision)
    session.flush()
    document.current_revision_id = revision.id
    document.updated_at = datetime.now(UTC)
    session.flush()
    return revision


def create_revision(
    session: Session,
    document_id: uuid.UUID,
    *,
    author_principal_id: uuid.UUID,
    content_ref: ObjectRef,
    source: RevisionSource = "manual",
    parent_revision_id: uuid.UUID | None = None,
) -> Revision:
    document = _document_for(session, document_id, author_principal_id)
    document = session.scalar(
        select(Document).where(Document.id == document.id).with_for_update().execution_options(populate_existing=True)
    )
    assert document is not None
    if parent_revision_id is None:
        parent_revision_id = document.current_revision_id
    return _append_revision(
        session,
        document,
        author_principal_id=author_principal_id,
        content_ref=content_ref,
        source=source,
        parent_revision_id=parent_revision_id,
    )


def open_working_copy(
    session: Session,
    document_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    base_revision_id: uuid.UUID | None = None,
    content_ref: ObjectRef | None = None,
    working_copy_id: uuid.UUID | None = None,
) -> WorkingCopy:
    document = _document_for(session, document_id, principal_id)
    if working_copy_id is not None:
        working_copy = get_working_copy(session, working_copy_id, principal_id=principal_id)
        if working_copy.document_id != document.id:
            raise DocumentConflict("working copy belongs to another document")
        return working_copy
    if base_revision_id is None:
        base_revision_id = document.current_revision_id
    base = None
    if base_revision_id is not None:
        base = session.scalar(
            select(Revision).where(Revision.document_id == document.id, Revision.id == base_revision_id)
        )
        if base is None:
            raise RevisionConflict("base revision does not belong to document")
    if content_ref is None:
        if base is None:
            raise DocumentError("content_ref is required for a document without a revision")
        content_ref = base.content_ref
    working_copy = WorkingCopy(
        document_id=document.id,
        principal_id=principal_id,
        base_revision_id=base_revision_id,
        **_content_columns(content_ref),
    )
    session.add(working_copy)
    session.flush()
    return working_copy


def save_working_copy(
    session: Session,
    working_copy_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    expected_version: int,
    content_ref: ObjectRef,
) -> WorkingCopy:
    working_copy = get_working_copy(session, working_copy_id, principal_id=principal_id)
    working_copy = session.scalar(
        select(WorkingCopy)
        .where(WorkingCopy.id == working_copy.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert working_copy is not None
    if working_copy.version != expected_version:
        raise WorkingCopyConflict("working copy version moved")
    for key, value in _content_columns(content_ref).items():
        setattr(working_copy, key, value)
    working_copy.version += 1
    working_copy.updated_at = datetime.now(UTC)
    session.flush()
    return working_copy


def commit_working_copy(
    session: Session,
    working_copy_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    expected_version: int | None = None,
    author_principal_id: uuid.UUID | None = None,
    source: RevisionSource = "manual",
) -> Revision:
    working_copy = get_working_copy(session, working_copy_id, principal_id=principal_id)
    document = session.scalar(
        select(Document).where(Document.id == working_copy.document_id).with_for_update().execution_options(
            populate_existing=True
        )
    )
    assert document is not None
    working_copy = session.scalar(
        select(WorkingCopy).where(WorkingCopy.id == working_copy.id).with_for_update().execution_options(
            populate_existing=True
        )
    )
    assert working_copy is not None
    if expected_version is not None and working_copy.version != expected_version:
        raise WorkingCopyConflict("working copy version moved")
    if document.current_revision_id != working_copy.base_revision_id:
        raise RevisionConflict("working copy base revision is stale")
    author = author_principal_id or principal_id
    _ensure_case_access(session, document.case_id, author)
    revision = _append_revision(
        session,
        document,
        author_principal_id=author,
        content_ref=working_copy.content_ref,
        source=source,
        parent_revision_id=working_copy.base_revision_id,
    )
    working_copy.base_revision_id = revision.id
    working_copy.version += 1
    working_copy.updated_at = datetime.now(UTC)
    session.flush()
    return revision
