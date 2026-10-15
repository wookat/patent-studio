# -*- coding: utf-8 -*-
"""案件 Release 冻结件：revision/ObjectRef 清单、sealed 边界与 DOCX 交付产物。"""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal

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
    event,
    func,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.orm.attributes import get_history

from patent_studio.domain.documents import (
    DOCUMENT_BOOKS,
    Document,
    DocumentError,
    Revision,
    _content_columns,
    _ensure_case_access,
)
from patent_studio.domain.figures import FigureDocument, FigureRevision
from patent_studio.domain.organization import Case
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


DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_FILENAME_SAFE = re.compile(r"[^0-9A-Za-z._-]+")


class ReleaseArtifact(Base):
    """封存 Release 的构建产物：ObjectRef + 输入清单（文件名/指纹即 manifest）。"""

    __tablename__ = "release_artifacts"
    __table_args__ = (
        UniqueConstraint("release_id", "filename", name="uq_release_artifacts_name"),
        CheckConstraint("content_size >= 0", name="content_size"),
        CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name="content_sha256"),
        Index("ix_release_artifacts_release", "release_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    release_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("releases.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    content_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    inputs: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    built_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef:
        return ObjectRef(self.content_key, self.content_sha256, self.content_size, self.content_type)


@event.listens_for(ReleaseArtifact, "before_update")
def _reject_artifact_update(_mapper, _connection, _target) -> None:
    raise ReleaseConflict("release artifacts are immutable")


def _release_items(session: Session, release_id: uuid.UUID) -> list[ReleaseItem]:
    return list(
        session.scalars(
            select(ReleaseItem).where(ReleaseItem.release_id == release_id).order_by(ReleaseItem.ordinal)
        ).all()
    )


def list_release_items(session: Session, release_id: uuid.UUID) -> list[ReleaseItem]:
    """release 组包项（按 ordinal 排序）——REST 展示面入口。"""
    return _release_items(session, release_id)


def render_release(
    session: Session,
    release_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    read: Callable[[ObjectRef], bytes],
) -> tuple[str, bytes, list[dict[str, Any]]]:
    """sealed Release 的冻结修订 → kernel 构建 DOCX 字节。

    `read(content_ref) -> bytes` 由调用方注入（对象存储 I/O 不进入域层）。
    返回 (filename, docx_bytes, inputs)；不落库——产物记录交给 record_release_artifact。
    """
    release = _release_for(session, release_id, principal_id)
    if release.status != "sealed":
        raise ReleaseConflict("release is not sealed")
    items = _release_items(session, release.id)
    books: dict[str, str] = {}
    figure_items: list[tuple[ReleaseItem, FigureDocument]] = []
    inputs: list[dict[str, Any]] = []
    for item in items:
        inputs.append(
            {
                "item_id": str(item.id),
                "item_kind": item.item_kind,
                "revision_id": str(item.document_revision_id or item.figure_revision_id),
                "sha256": item.content_sha256,
            }
        )
        if item.item_kind == "document":
            revision = session.get(Revision, item.document_revision_id)
            document = session.get(Document, revision.document_id)
            books[document.book] = read(item.content_ref).decode("utf-8")
        else:
            figure_revision = session.get(FigureRevision, item.figure_revision_id)
            figure = session.get(FigureDocument, figure_revision.figure_document_id)
            figure_items.append((item, figure))
    missing = [b for b in DOCUMENT_BOOKS if b not in books]
    if missing:
        raise ReleaseConflict(f"release lacks document books: {', '.join(missing)}")
    case = session.get(Case, release.case_id)
    content_md = (
        f"# {case.title}\n\n## 摘要\n\n{books['abstract']}\n\n## 权利要求书\n\n"
        f"{books['claims']}\n\n## 说明书\n\n{books['description']}\n"
    )

    from patent_studio.kernel.builder import build_patent_ex, probe_image

    with tempfile.TemporaryDirectory() as tmp:
        md_path = os.path.join(tmp, "content.md")
        with open(md_path, "w", encoding="utf-8") as fh:
            fh.write(content_md)
        figs_dir = os.path.join(tmp, "figs")
        os.mkdir(figs_dir)
        spec_figures: list[tuple[str, float]] = []
        abstract_figure: tuple[str, float] | None = None
        for i, (item, figure) in enumerate(figure_items, 1):
            data = read(item.content_ref)
            try:
                ext = probe_image(data).ext
            except Exception as exc:
                raise ReleaseConflict(f"figure item {item.ordinal} is not a supported image") from exc
            fname = f"fig{i}.{ext}"
            with open(os.path.join(figs_dir, fname), "wb") as fh:
                fh.write(data)
            if figure.figure_no is None:
                abstract_figure = (fname, 15.0)
            else:
                spec_figures.append((fname, 15.0))
        out_path = os.path.join(tmp, "release.docx")
        try:
            build_patent_ex(
                {
                    "content_md": md_path,
                    "out": out_path,
                    "figs_dir": figs_dir,
                    "spec_figures": spec_figures,
                    "abstract_figure": abstract_figure,
                }
            )
        except (AssertionError, ValueError) as exc:
            raise ReleaseConflict(f"release content cannot be rendered: {exc}") from exc
        with open(out_path, "rb") as fh:
            data = _normalize_zip_timestamps(fh.read())
    filename = f"{_FILENAME_SAFE.sub('-', case.case_key)}-{release.id.hex[:8]}.docx"
    return filename, data, inputs


def _normalize_zip_timestamps(data: bytes) -> bytes:
    """ZIP 条目时间戳归一：python-docx 按当前时间写条目（2s 粒度），
    同一 sealed release 重复 build 必须产出同 sha256，否则幂等重建被判冲突。"""
    import io
    import zipfile

    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            item = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
            item.compress_type = info.compress_type
            item.external_attr = info.external_attr
            dst.writestr(item, src.read(info.filename))
    return out.getvalue()


def record_release_artifact(
    session: Session,
    release_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    filename: str,
    content_ref: ObjectRef,
    inputs: list[dict[str, Any]],
) -> ReleaseArtifact:
    """登记构建产物；同名同指纹重放返回既有行（重复 build 幂等）。"""
    release = _release_for(session, release_id, principal_id)
    if release.status != "sealed":
        raise ReleaseConflict("release is not sealed")
    existing = session.scalar(
        select(ReleaseArtifact).where(ReleaseArtifact.release_id == release.id, ReleaseArtifact.filename == filename)
    )
    if existing is not None:
        if existing.content_sha256 != content_ref.sha256:
            raise ReleaseConflict("artifact filename is bound to different content")
        return existing
    artifact = ReleaseArtifact(
        release_id=release.id,
        filename=filename,
        built_by_principal_id=principal_id,
        inputs=inputs,
        **_content_columns(content_ref),
    )
    session.add(artifact)
    session.flush()
    return artifact


def list_release_artifacts(
    session: Session, release_id: uuid.UUID, *, principal_id: uuid.UUID
) -> list[ReleaseArtifact]:
    release = _release_for(session, release_id, principal_id)
    return list(
        session.scalars(
            select(ReleaseArtifact).where(ReleaseArtifact.release_id == release.id).order_by(ReleaseArtifact.created_at)
        ).all()
    )


def get_release_artifact(session: Session, artifact_id: uuid.UUID, *, principal_id: uuid.UUID) -> ReleaseArtifact:
    artifact = session.get(ReleaseArtifact, artifact_id)
    if artifact is None:
        raise ReleaseNotFound("release artifact does not exist")
    _release_for(session, artifact.release_id, principal_id)
    return artifact
