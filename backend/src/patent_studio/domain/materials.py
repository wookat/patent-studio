"""案件材料真源：Material（外部输入登记）、SourceAnchor（材料内定位）、Fact（带锚点溯源的事实）。

事实状态机 pending → confirmed/rejected：confirmed 必须挂 anchor；rejected 留痕不可删。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import DocumentError, _content_columns, _ensure_case_access
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef


def _excerpt_columns(ref: ObjectRef) -> dict[str, object]:
    return {
        "excerpt_key": ref.key,
        "excerpt_sha256": ref.sha256,
        "excerpt_size": ref.size,
        "excerpt_type": ref.content_type,
    }

MATERIAL_KINDS = ("upload", "url", "text")
MATERIAL_STATUSES = ("active", "archived")
FACT_STATUSES = ("pending", "confirmed", "rejected")
_LOCATOR_KEYS = {"page", "paragraph", "offset", "line", "section"}


class MaterialError(DocumentError):
    """材料/事实领域错误。"""


class MaterialNotFound(MaterialError):
    """材料或锚点不存在。"""


class MaterialConflict(MaterialError):
    """材料形态或事实状态冲突。"""


class MaterialAuthorizationError(MaterialError):
    """材料操作未获授权。"""


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("kind IN ('upload', 'url', 'text')", name="kind"),
        CheckConstraint("status IN ('active', 'archived')", name="status"),
        CheckConstraint(
            "(kind = 'url' AND source_url IS NOT NULL AND content_key IS NULL) OR "
            "(kind IN ('upload', 'text') AND content_key IS NOT NULL AND source_url IS NULL)",
            name="kind_payload",
        ),
        CheckConstraint("content_key IS NULL OR content_size >= 0", name="content_size"),
        CheckConstraint(
            "content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'", name="content_sha256"
        ),
        Index("ix_materials_case_status", "case_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    content_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_size: Mapped[int | None] = mapped_column(nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def content_ref(self) -> ObjectRef | None:
        if self.content_key is None:
            return None
        return ObjectRef(self.content_key, self.content_sha256, self.content_size, self.content_type)


class SourceAnchor(Base):
    __tablename__ = "source_anchors"
    __table_args__ = (
        CheckConstraint("excerpt_key IS NULL OR excerpt_size >= 0", name="excerpt_size"),
        CheckConstraint(
            "excerpt_sha256 IS NULL OR excerpt_sha256 ~ '^[0-9a-f]{64}$'", name="excerpt_sha256"
        ),
        Index("ix_source_anchors_material", "material_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False
    )
    locator: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    excerpt_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    excerpt_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    excerpt_size: Mapped[int | None] = mapped_column(nullable=True)
    excerpt_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def excerpt_ref(self) -> ObjectRef | None:
        if self.excerpt_key is None:
            return None
        return ObjectRef(self.excerpt_key, self.excerpt_sha256, self.excerpt_size, self.excerpt_type)


class Fact(Base):
    __tablename__ = "facts"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'confirmed', 'rejected')", name="status"),
        CheckConstraint("status <> 'confirmed' OR anchor_id IS NOT NULL", name="confirmed_has_anchor"),
        CheckConstraint("anchor_id IS NULL OR material_id IS NOT NULL", name="anchor_has_material"),
        CheckConstraint(
            "(status = 'pending' AND decided_by_principal_id IS NULL AND decided_at IS NULL) OR "
            "(status <> 'pending' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL)",
            name="decision",
        ),
        Index("ix_facts_case_status", "case_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    material_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("materials.id", ondelete="RESTRICT"), nullable=True
    )
    anchor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("source_anchors.id", ondelete="RESTRICT"), nullable=True
    )
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    proposed_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    decided_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _material_for(session: Session, material_id: uuid.UUID, principal_id: uuid.UUID) -> Material:
    material = session.get(Material, material_id)
    if material is None:
        raise MaterialNotFound("material does not exist")
    try:
        _ensure_case_access(session, material.case_id, principal_id)
    except DocumentError as exc:
        raise MaterialAuthorizationError(str(exc)) from exc
    return material


def get_fact(session: Session, fact_id: uuid.UUID, *, principal_id: uuid.UUID) -> Fact:
    return _fact_for(session, fact_id, principal_id)


def _fact_for(session: Session, fact_id: uuid.UUID, principal_id: uuid.UUID) -> Fact:
    fact = session.get(Fact, fact_id)
    if fact is None:
        raise MaterialNotFound("fact does not exist")
    try:
        _ensure_case_access(session, fact.case_id, principal_id)
    except DocumentError as exc:
        raise MaterialAuthorizationError(str(exc)) from exc
    return fact


def register_material(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    kind: Literal["upload", "url", "text"],
    title: str,
    content_ref: ObjectRef | None = None,
    source_url: str | None = None,
) -> Material:
    _ensure_case_access(session, case_id, principal_id)
    if kind not in MATERIAL_KINDS:
        raise MaterialConflict("material kind is invalid")
    title = title.strip()
    if not title or len(title) > 300:
        raise MaterialConflict("material title is required")
    if kind == "url":
        if not source_url or not source_url.strip():
            raise MaterialConflict("url material requires source_url")
        if content_ref is not None:
            raise MaterialConflict("url material cannot carry content bytes")
    else:
        if content_ref is None:
            raise MaterialConflict(f"{kind} material requires content bytes")
        if source_url is not None:
            raise MaterialConflict("content material cannot carry source_url")
    material = Material(
        case_id=case_id,
        kind=kind,
        title=title,
        source_url=source_url.strip() if source_url else None,
        created_by_principal_id=principal_id,
        **(_content_columns(content_ref) if content_ref else {}),
    )
    session.add(material)
    session.flush()
    return material


def get_material(session: Session, material_id: uuid.UUID, *, principal_id: uuid.UUID) -> Material:
    return _material_for(session, material_id, principal_id)


def list_materials(
    session: Session, case_id: uuid.UUID, *, principal_id: uuid.UUID, status: str | None = None
) -> list[Material]:
    _ensure_case_access(session, case_id, principal_id)
    query = select(Material).where(Material.case_id == case_id).order_by(Material.created_at, Material.id)
    if status is not None:
        query = query.where(Material.status == status)
    return list(session.scalars(query).all())


def archive_material(session: Session, material_id: uuid.UUID, *, principal_id: uuid.UUID) -> Material:
    material = _material_for(session, material_id, principal_id)
    if material.status != "active":
        raise MaterialConflict(f"material is {material.status}")
    material.status = "archived"
    session.flush()
    return material


def add_anchor(
    session: Session,
    material_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    locator: dict[str, Any],
    excerpt_ref: ObjectRef | None = None,
) -> SourceAnchor:
    material = _material_for(session, material_id, principal_id)
    if not isinstance(locator, dict) or not any(key in _LOCATOR_KEYS for key in locator):
        raise MaterialConflict("locator requires at least one of page/paragraph/offset/line/section")
    anchor = SourceAnchor(
        material_id=material.id,
        locator=dict(locator),
        created_by_principal_id=principal_id,
        **(_excerpt_columns(excerpt_ref) if excerpt_ref else {}),
    )
    session.add(anchor)
    session.flush()
    return anchor


def list_anchors(session: Session, material_id: uuid.UUID, *, principal_id: uuid.UUID) -> list[SourceAnchor]:
    material = _material_for(session, material_id, principal_id)
    return list(
        session.scalars(
            select(SourceAnchor)
            .where(SourceAnchor.material_id == material.id)
            .order_by(SourceAnchor.created_at, SourceAnchor.id)
        ).all()
    )


def propose_fact(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    statement: str,
    material_id: uuid.UUID | None = None,
    anchor_id: uuid.UUID | None = None,
) -> Fact:
    _ensure_case_access(session, case_id, principal_id)
    statement = statement.strip()
    if not statement:
        raise MaterialConflict("fact statement is required")
    if anchor_id is not None:
        anchor = session.get(SourceAnchor, anchor_id)
        if anchor is None:
            raise MaterialNotFound("anchor does not exist")
        anchor_material = session.get(Material, anchor.material_id)
        assert anchor_material is not None
        if anchor_material.case_id != case_id:
            raise MaterialConflict("anchor is outside the case")
        if material_id is not None and material_id != anchor.material_id:
            raise MaterialConflict("fact material does not match its anchor")
        material_id = anchor.material_id
    if material_id is not None:
        material = session.get(Material, material_id)
        if material is None or material.case_id != case_id:
            raise MaterialConflict("material is outside the case")
    fact = Fact(
        case_id=case_id,
        material_id=material_id,
        anchor_id=anchor_id,
        statement=statement,
        proposed_by_principal_id=principal_id,
    )
    session.add(fact)
    session.flush()
    return fact


def list_facts(
    session: Session, case_id: uuid.UUID, *, principal_id: uuid.UUID, status: str | None = None
) -> list[Fact]:
    _ensure_case_access(session, case_id, principal_id)
    query = select(Fact).where(Fact.case_id == case_id).order_by(Fact.created_at, Fact.id)
    if status is not None:
        query = query.where(Fact.status == status)
    return list(session.scalars(query).all())


def _decide(fact: Fact, principal_id: uuid.UUID) -> None:
    fact.decided_by_principal_id = principal_id
    fact.decided_at = datetime.now(UTC)


def confirm_fact(session: Session, fact_id: uuid.UUID, *, principal_id: uuid.UUID) -> Fact:
    fact = _fact_for(session, fact_id, principal_id)
    if fact.status != "pending":
        raise MaterialConflict(f"fact is {fact.status}")
    if fact.anchor_id is None:
        raise MaterialConflict("fact requires a source anchor before it can be confirmed")
    fact.status = "confirmed"
    _decide(fact, principal_id)
    session.flush()
    return fact


def reject_fact(
    session: Session, fact_id: uuid.UUID, *, principal_id: uuid.UUID, reason: str | None = None
) -> Fact:
    """驳回留痕：事实行不删除，状态与驳回理由持久化。"""
    fact = _fact_for(session, fact_id, principal_id)
    if fact.status != "pending":
        raise MaterialConflict(f"fact is {fact.status}")
    fact.status = "rejected"
    fact.rejection_reason = reason[:1000] if reason else None
    _decide(fact, principal_id)
    session.flush()
    return fact
