# -*- coding: utf-8 -*-
"""机构、成员、案件和案件参与关系（方案 v0.1 §5 / v0.2 §3.1–3.3）。

Principal 是唯一业务参与者真源：人通过 identity.User 关联，Agent 通过独立 agent_key 关联。
成员关系和案件参与关系分开；案件参与关系也可指向受邀的外部 Principal。
本模块只定义关系数据和数据库约束；授权策略、OIDC、Agent 连接与执行生命周期由后续批次负责。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from patent_studio.infra.db import Base


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint(
            "length(trim(slug)) > 0 AND slug = trim(slug) AND slug = lower(slug)",
            name="slug",
        ),
        CheckConstraint("length(trim(name)) > 0", name="name"),
        CheckConstraint("status IN ('active', 'suspended', 'archived')", name="status"),
        Index("ix_organizations_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    # C0/P03 机构外发授权记录：{ai_egress, training_consent, note, version, updated_by, updated_at}
    # NULL = 未配置（不禁止）
    egress_policy: Mapped[dict | None] = mapped_column(JSONB(), nullable=True)
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrganizationMembership(Base):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="role"),
        CheckConstraint(
            "status IN ('invited', 'active', 'suspended', 'removed')",
            name="status",
        ),
        CheckConstraint(
            "status <> 'invited' OR invited_by_principal_id IS NOT NULL",
            name="inviter",
        ),
        ForeignKeyConstraint(
            ["organization_id", "invited_by_principal_id"],
            ["organization_memberships.organization_id", "organization_memberships.principal_id"],
            ondelete="RESTRICT",
            name="fk_organization_memberships_inviter",
        ),
        Index("ix_organization_memberships_organization_status", "organization_id", "status"),
        Index("ix_organization_memberships_principal", "principal_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), primary_key=True
    )
    principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member", server_default="member")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    invited_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Case(Base):
    __tablename__ = "cases"
    __table_args__ = (
        UniqueConstraint("organization_id", "id", name="uq_cases_organization_id"),
        UniqueConstraint("organization_id", "case_key", name="uq_cases_organization_key"),
        UniqueConstraint("organization_id", "case_no", name="uq_cases_organization_case_no"),
        ForeignKeyConstraint(
            ["organization_id", "created_by_principal_id"],
            ["organization_memberships.organization_id", "organization_memberships.principal_id"],
            ondelete="RESTRICT",
            name="fk_cases_creator_membership",
        ),
        CheckConstraint("length(trim(case_key)) > 0", name="case_key"),
        CheckConstraint("length(trim(title)) > 0", name="title"),
        CheckConstraint("kind IN ('invention', 'utility', 'design')", name="kind"),
        CheckConstraint(
            "status IN ('intake', 'drafting', 'review', 'client_review', 'final', 'filed', "
            "'oa', 'granted', 'rejected', 'closed')",
            name="status",
        ),
        Index("ix_cases_created_by_principal", "created_by_principal_id"),
        Index("ix_cases_organization_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    case_key: Mapped[str] = mapped_column(String(64), nullable=False)
    case_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="invention", server_default="invention")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="intake", server_default="intake")
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CaseParticipant(Base):
    __tablename__ = "case_participants"
    __table_args__ = (
        ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT", name="fk_case_participants_case"),
        ForeignKeyConstraint(
            ["principal_id"], ["principals.id"], ondelete="RESTRICT", name="fk_case_participants_principal"
        ),
        CheckConstraint(
            "role IN ('client', 'inventor', 'applicant', 'author', 'attorney', 'drafter', "
            "'reviewer', 'case_manager', 'agent', 'observer')",
            name="role",
        ),
        CheckConstraint("status IN ('active', 'ended')", name="status"),
        Index("ix_case_participants_principal", "principal_id"),
        Index("ix_case_participants_case", "case_id"),
    )

    case_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    principal_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    role: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
