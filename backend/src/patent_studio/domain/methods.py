# -*- coding: utf-8 -*-
"""Z30 机构私有方法库：人工录入的脱敏方法卡（method/expression，非客户发明事实）。

资产范围 = organization_id（跨机构不可读/改/引）；仅 status='authorized' 可被检索与
使用记录；撤销（revoked）即刻从检索结果消失；每次使用落 method_asset_uses 行可追溯。
不自动收录：不存在从案卷正文/材料自动导入的路径，create 只接人工提交字段。
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.organization import Case, OrganizationMembership
from patent_studio.infra.db import Base


class MethodLibraryError(Exception):
    pass


class MethodAsset(Base):
    __tablename__ = "method_assets"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'authorized', 'revoked')", name="status"),
        CheckConstraint("length(trim(title)) > 0", name="title"),
        CheckConstraint("length(trim(body)) > 0", name="body"),
        CheckConstraint("source IN ('manual', 'curated')", name="source"),
        CheckConstraint("asset_type IN ('method', 'expression')", name="asset_type"),
        Index("ix_method_assets_org_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual", server_default="manual")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    # 复核项6 最小元数据：方法/表达类型 + 真实来源说明 + 授权使用范围 + 人工脱敏声明。
    # provenance/authorized_scope 可空——既有草稿迁移后为 NULL=未确认；新卡创建时必填（服务端校验）。
    # deidentified_confirmed 只是人工声明，不代表系统验证过正文不含客户事实。
    asset_type: Mapped[str] = mapped_column(String(16), nullable=False, default="method", server_default="method")
    provenance: Mapped[str | None] = mapped_column(String(500), nullable=True)
    authorized_scope: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deidentified_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    authorized_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_principal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MethodAssetUse(Base):
    __tablename__ = "method_asset_uses"
    __table_args__ = (Index("ix_method_asset_uses_asset", "asset_id", "used_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("method_assets.id", ondelete="CASCADE"), nullable=False)
    case_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cases.id", ondelete="RESTRICT"), nullable=True)
    principal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _member(session: Session, organization_id: uuid.UUID, principal_id: uuid.UUID, *, manage=False) -> None:
    m = session.get(OrganizationMembership, (organization_id, principal_id))
    if m is None or m.status != "active":
        raise MethodLibraryError("denied: active organization membership required")
    if manage and m.role not in {"owner", "admin"}:
        raise MethodLibraryError("denied: organization management permission required")


def _asset(session: Session, asset_id: uuid.UUID) -> MethodAsset:
    a = session.get(MethodAsset, asset_id)
    if a is None:
        raise MethodLibraryError("not_found: method asset does not exist")
    return a


def _norm_meta(asset_type: str, provenance: str, authorized_scope: str, confirmed: bool) -> tuple[str, str, str]:
    """复核项6 元数据校验：类型白名单 + 来源/范围非空 + 脱敏声明必须为 True（服务端强制，
    不接受缺省/False——声明只代表录入人确认，不意味系统验证过正文不含客户事实）。"""
    if asset_type not in {"method", "expression"}:
        raise MethodLibraryError("validation: asset_type must be method or expression")
    prov, scope = provenance.strip(), authorized_scope.strip()
    if not prov:
        raise MethodLibraryError("validation: provenance (source description) is required")
    if not scope:
        raise MethodLibraryError("validation: authorized_scope is required")
    if confirmed is not True:
        raise MethodLibraryError("validation: de-identification must be manually confirmed")
    return asset_type, prov, scope


def create_asset(
    session: Session,
    *,
    organization_id: uuid.UUID,
    principal_id: uuid.UUID,
    title: str,
    body: str,
    source: str = "manual",
    asset_type: str = "method",
    provenance: str = "",
    authorized_scope: str = "",
    deidentified_confirmed: bool = False,
) -> MethodAsset:
    """人工录入：初始 status=draft，须授权后才进检索。元数据齐备 + 脱敏确认才可建卡。"""
    _member(session, organization_id, principal_id)
    if source not in {"manual", "curated"}:
        raise MethodLibraryError("validation: source must be manual or curated")
    asset_type, prov, scope = _norm_meta(asset_type, provenance, authorized_scope, deidentified_confirmed)
    a = MethodAsset(
        organization_id=organization_id,
        title=title.strip(),
        body=body,
        source=source,
        asset_type=asset_type,
        provenance=prov,
        authorized_scope=scope,
        deidentified_confirmed=True,
        created_by_principal_id=principal_id,
    )
    session.add(a)
    session.flush()
    return a


def confirm_asset(
    session: Session,
    asset_id: uuid.UUID,
    principal_id: uuid.UUID,
    *,
    asset_type: str,
    provenance: str,
    authorized_scope: str,
    deidentified_confirmed: bool,
) -> MethodAsset:
    """既有草稿（迁移 0015 前建的卡：来源/范围 NULL、未确认）补登元数据 + 人工脱敏确认。
    仅机构管理者可确认（与授权同一道闸）；draft 才可补登。"""
    a = _asset(session, asset_id)
    _member(session, a.organization_id, principal_id, manage=True)
    if a.status != "draft":
        raise MethodLibraryError("validation: only draft assets can be confirmed")
    asset_type, prov, scope = _norm_meta(asset_type, provenance, authorized_scope, deidentified_confirmed)
    a.asset_type, a.provenance, a.authorized_scope = asset_type, prov, scope
    a.deidentified_confirmed = True
    session.flush()
    return a


def _governance_ok(a: MethodAsset) -> bool:
    """治理字段齐备（与 authorize_asset 入口同口径）：脱敏已声明 + 来源/范围非空。
    0015 前已授权旧卡迁移后降为 draft；若库中仍残留 authorized+未确认的组合
    （直写库/未来迁移缺陷），读取与使用侧同样 fail-closed，不能只靠授权入口闸。"""
    return bool(a.deidentified_confirmed and a.provenance and a.authorized_scope)


def authorize_asset(session: Session, asset_id: uuid.UUID, principal_id: uuid.UUID) -> MethodAsset:
    a = _asset(session, asset_id)
    _member(session, a.organization_id, principal_id, manage=True)
    # 复核项6：未确认（来源/范围缺失或脱敏未声明）禁止授权——不得绕过校验上架
    if not _governance_ok(a):
        raise MethodLibraryError("denied: asset lacks provenance/scope/de-identification confirmation (confirm first)")
    a.status = "authorized"
    a.authorized_by_principal_id = principal_id
    a.authorized_at = datetime.now()
    session.flush()
    return a


def revoke_asset(session: Session, asset_id: uuid.UUID, principal_id: uuid.UUID) -> MethodAsset:
    """撤销即检索不可见（list/search 只认 authorized）。"""
    a = _asset(session, asset_id)
    _member(session, a.organization_id, principal_id, manage=True)
    a.status = "revoked"
    session.flush()
    return a


def list_assets(
    session: Session,
    *,
    organization_id: uuid.UUID,
    principal_id: uuid.UUID,
    q: str | None = None,
    all_states: bool = False,
) -> list[MethodAsset]:
    """检索视图：默认仅 authorized；all_states=True 仅供机构管理者审计。"""
    if all_states:
        _member(session, organization_id, principal_id, manage=True)
    else:
        _member(session, organization_id, principal_id)
    stmt = select(MethodAsset).where(MethodAsset.organization_id == organization_id)
    if not all_states:
        # 复核追加：authorized 之外还要求治理字段齐备（fail-closed）——
        # length(trim(NULL))=NULL 同样被排除，空串/纯空白也不放过。
        stmt = stmt.where(
            MethodAsset.status == "authorized",
            MethodAsset.deidentified_confirmed.is_(True),
            func.length(func.trim(MethodAsset.provenance)) > 0,
            func.length(func.trim(MethodAsset.authorized_scope)) > 0,
        )
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(MethodAsset.title.ilike(pat) | MethodAsset.body.ilike(pat))
    return list(session.scalars(stmt.order_by(MethodAsset.updated_at.desc(), MethodAsset.id)).all())


def record_use(
    session: Session,
    *,
    asset_id: uuid.UUID,
    principal_id: uuid.UUID,
    case_id: uuid.UUID | None = None,
    note: str | None = None,
) -> MethodAssetUse:
    """引用/使用留痕：资产须 authorized；附 case_id 时案件必须同机构。"""
    a = _asset(session, asset_id)
    _member(session, a.organization_id, principal_id)
    if a.status != "authorized" or not _governance_ok(a):
        raise MethodLibraryError("denied: only authorized assets are retrievable")
    if case_id is not None:
        c = session.get(Case, case_id)
        if c is None or c.organization_id != a.organization_id:
            raise MethodLibraryError("denied: case must belong to the asset's organization")
    u = MethodAssetUse(asset_id=a.id, case_id=case_id, principal_id=principal_id, note=note)
    session.add(u)
    session.flush()
    return u


def list_uses(session: Session, *, asset_id: uuid.UUID, principal_id: uuid.UUID) -> list[MethodAssetUse]:
    a = _asset(session, asset_id)
    _member(session, a.organization_id, principal_id)
    return list(
        session.scalars(
            select(MethodAssetUse).where(MethodAssetUse.asset_id == a.id).order_by(MethodAssetUse.used_at.desc())
        ).all()
    )
