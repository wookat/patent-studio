# -*- coding: utf-8 -*-
"""Invitation 与 Grant 生命周期及关系授权判定。

本模块只提供数据库真源和可复用的领域判定，不接 OIDC、HTTP、MCP 或 Capability Registry。
能力名称是受长度/格式约束的不透明字符串；能力的完整注册与风险元数据属于后续批次。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Uuid,
    and_,
    func,
    or_,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.db import Base

ORG_INVITATION_ROLES = frozenset({"owner", "admin", "member"})
CASE_INVITATION_ROLES = frozenset(
    {
        "client",
        "inventor",
        "applicant",
        "author",
        "attorney",
        "drafter",
        "reviewer",
        "case_manager",
        "agent",
        "observer",
    }
)
GRANT_ISSUER_ROLES = frozenset({"owner", "admin"})


class AuthorizationError(ValueError):
    """领域授权操作被拒绝。"""


class InvitationStateError(AuthorizationError):
    """Invitation 不允许当前状态转换。"""


class GrantConflict(AuthorizationError):
    """Grant epoch 或目标关系与调用方的预期冲突。"""


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint(
            "((case_id IS NULL AND role IN ('owner', 'admin', 'member')) OR "
            "(case_id IS NOT NULL AND role IN ('client', 'inventor', 'applicant', 'author', "
            "'attorney', 'drafter', 'reviewer', 'case_manager', 'agent', 'observer')))",
            name="scope_role",
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')",
            name="status",
        ),
        CheckConstraint("expires_at > created_at", name="expiry"),
        CheckConstraint(
            "(status = 'pending' AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL) OR "
            "(status = 'accepted' AND accepted_at IS NOT NULL AND declined_at IS NULL AND revoked_at IS NULL) OR "
            "(status = 'declined' AND accepted_at IS NULL AND declined_at IS NOT NULL AND revoked_at IS NULL) OR "
            "(status = 'revoked' AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NOT NULL) OR "
            "(status = 'expired' AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL)",
            name="lifecycle",
        ),
        ForeignKeyConstraint(
            ["organization_id", "invited_by_principal_id"],
            ["organization_memberships.organization_id", "organization_memberships.principal_id"],
            ondelete="RESTRICT",
            name="fk_invitations_inviter_membership",
        ),
        ForeignKeyConstraint(
            ["organization_id", "case_id"],
            ["cases.organization_id", "cases.id"],
            ondelete="RESTRICT",
            name="fk_invitations_case_organization",
        ),
        Index("ix_invitations_organization_status_expiry", "organization_id", "status", "expires_at"),
        Index("ix_invitations_invitee_status", "invitee_principal_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    invitee_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    invited_by_principal_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Grant(Base):
    __tablename__ = "grants"
    __table_args__ = (
        CheckConstraint("cardinality(capabilities) > 0", name="capabilities"),
        CheckConstraint("expires_at > not_before", name="expiry"),
        CheckConstraint("fencing_epoch > 0", name="fencing_epoch"),
        CheckConstraint("status IN ('active', 'revoked', 'expired')", name="status"),
        CheckConstraint(
            "(status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_principal_id IS NOT NULL) OR "
            "(status <> 'revoked' AND revoked_at IS NULL AND revoked_by_principal_id IS NULL)",
            name="revocation",
        ),
        ForeignKeyConstraint(
            ["organization_id", "grantor_principal_id"],
            ["organization_memberships.organization_id", "organization_memberships.principal_id"],
            ondelete="RESTRICT",
            name="fk_grants_grantor_membership",
        ),
        ForeignKeyConstraint(
            ["organization_id", "case_id"],
            ["cases.organization_id", "cases.id"],
            ondelete="RESTRICT",
            name="fk_grants_case_organization",
        ),
        Index("ix_grants_subject_scope_status", "organization_id", "subject_principal_id", "case_id", "status"),
        Index("ix_grants_grantor_status", "grantor_principal_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    grantor_principal_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    subject_principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=False
    )
    capabilities: Mapped[list[str]] = mapped_column(ARRAY(String(64)), nullable=False)
    not_before: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    fencing_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


@dataclass(frozen=True)
class GrantDecision:
    allowed: bool
    reason: str
    grant_id: uuid.UUID | None = None
    fencing_epoch: int | None = None


def _at(value: datetime | None) -> datetime:
    return value or datetime.now(UTC)


def _capability(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized or len(normalized) > 64 or any(char.isspace() for char in normalized):
        raise AuthorizationError("capability must be a non-empty token without whitespace")
    return normalized


def _active_membership(session: Session, organization_id: uuid.UUID, principal_id: uuid.UUID):
    return session.scalar(
        select(OrganizationMembership.principal_id).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    )


def _organization_status(session: Session, organization_id: uuid.UUID) -> str | None:
    return session.scalar(select(Organization.status).where(Organization.id == organization_id))


def _principal_is_active(session: Session, principal_id: uuid.UUID) -> bool:
    row = session.execute(
        select(Principal.kind, User.is_active)
        .select_from(Principal)
        .outerjoin(User, User.id == Principal.user_id)
        .where(Principal.id == principal_id)
    ).one_or_none()
    if row is None:
        return False
    kind, is_active = row
    return kind == "agent" or (kind == "human" and is_active is True)


def _can_manage_grants(session: Session, organization_id: uuid.UUID, principal_id: uuid.UUID) -> bool:
    row = session.execute(
        select(OrganizationMembership.role, Principal.kind, User.is_active)
        .select_from(OrganizationMembership)
        .join(Principal, Principal.id == OrganizationMembership.principal_id)
        .outerjoin(User, User.id == Principal.user_id)
        .where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    ).one_or_none()
    if row is None:
        return False
    role, kind, is_active = row
    return role in GRANT_ISSUER_ROLES and kind == "human" and is_active is True


def _can_issue_grants(session: Session, organization_id: uuid.UUID, principal_id: uuid.UUID) -> bool:
    return _organization_status(session, organization_id) == "active" and _can_manage_grants(
        session, organization_id, principal_id
    )


def _ensure_invitation_pending(invitation: Invitation, now: datetime) -> None:
    if invitation.status != "pending":
        raise InvitationStateError(f"invitation is {invitation.status}")
    if now >= invitation.expires_at:
        raise InvitationStateError("invitation is expired")


def _lock_invitation(session: Session, invitation_id: uuid.UUID) -> Invitation:
    invitation = session.scalar(
        select(Invitation)
        .where(Invitation.id == invitation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if invitation is None:
        raise InvitationStateError("invitation does not exist")
    return invitation


def accept_invitation(
    session: Session, invitation: Invitation, principal_id: uuid.UUID, *, at: datetime | None = None
) -> Invitation:
    now = _at(at)
    invitation = _lock_invitation(session, invitation.id)
    _ensure_invitation_pending(invitation, now)
    if invitation.invitee_principal_id != principal_id:
        raise AuthorizationError("invitation is addressed to another principal")
    if not _principal_is_active(session, principal_id):
        raise AuthorizationError("invitation recipient is inactive")
    if not _can_issue_grants(session, invitation.organization_id, invitation.invited_by_principal_id):
        raise AuthorizationError("inviter cannot issue invitations")

    if invitation.case_id is None:
        existing = session.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == invitation.organization_id,
                OrganizationMembership.principal_id == principal_id,
            )
        )
        if existing is not None:
            raise GrantConflict("membership already exists")
        session.add(
            OrganizationMembership(
                organization_id=invitation.organization_id,
                principal_id=principal_id,
                role=invitation.role,
                status="active",
                invited_by_principal_id=invitation.invited_by_principal_id,
                joined_at=now,
            )
        )
    else:
        existing = session.scalar(
            select(CaseParticipant).where(
                CaseParticipant.case_id == invitation.case_id,
                CaseParticipant.principal_id == principal_id,
                CaseParticipant.role == invitation.role,
            )
        )
        if existing is not None:
            raise GrantConflict("case participation already exists")
        session.add(
            CaseParticipant(
                case_id=invitation.case_id,
                principal_id=principal_id,
                role=invitation.role,
                status="active",
            )
        )

    invitation.status = "accepted"
    invitation.accepted_at = now
    session.flush()
    return invitation


def decline_invitation(
    session: Session, invitation: Invitation, principal_id: uuid.UUID, *, at: datetime | None = None
) -> Invitation:
    now = _at(at)
    invitation = _lock_invitation(session, invitation.id)
    _ensure_invitation_pending(invitation, now)
    if invitation.invitee_principal_id != principal_id:
        raise AuthorizationError("invitation is addressed to another principal")
    if not _principal_is_active(session, principal_id):
        raise AuthorizationError("invitation recipient is inactive")
    invitation.status = "declined"
    invitation.declined_at = now
    session.flush()
    return invitation


def revoke_invitation(
    session: Session, invitation: Invitation, actor_principal_id: uuid.UUID, *, at: datetime | None = None
) -> Invitation:
    now = _at(at)
    invitation = _lock_invitation(session, invitation.id)
    _ensure_invitation_pending(invitation, now)
    if not _can_manage_grants(session, invitation.organization_id, actor_principal_id):
        raise AuthorizationError("actor cannot revoke invitations")
    invitation.status = "revoked"
    invitation.revoked_at = now
    session.flush()
    return invitation


def expire_invitation(session: Session, invitation: Invitation, *, at: datetime | None = None) -> Invitation:
    now = _at(at)
    invitation = _lock_invitation(session, invitation.id)
    if invitation.status != "pending":
        raise InvitationStateError(f"invitation is {invitation.status}")
    if now < invitation.expires_at:
        raise InvitationStateError("invitation has not expired")
    invitation.status = "expired"
    session.flush()
    return invitation


def _relationship_allows(
    session: Session, organization_id: uuid.UUID, subject_principal_id: uuid.UUID, case_id: uuid.UUID | None
) -> bool:
    if case_id is None:
        return _active_membership(session, organization_id, subject_principal_id) is not None
    member = _active_membership(session, organization_id, subject_principal_id)
    participant = session.scalar(
        select(CaseParticipant.principal_id).where(
            CaseParticipant.case_id == case_id,
            CaseParticipant.principal_id == subject_principal_id,
            CaseParticipant.status == "active",
        )
    )
    return member is not None or participant is not None


def _scoped_grant(
    session: Session,
    grant_id: uuid.UUID,
    subject_principal_id: uuid.UUID,
    organization_id: uuid.UUID,
    case_id: uuid.UUID | None,
) -> Grant | None:
    scope = Grant.case_id.is_(None) if case_id is None else or_(Grant.case_id.is_(None), Grant.case_id == case_id)
    return session.scalar(
        select(Grant)
        .where(
            Grant.id == grant_id,
            Grant.organization_id == organization_id,
            Grant.subject_principal_id == subject_principal_id,
            scope,
        )
        .execution_options(populate_existing=True)
    )


def authorize_grant(
    session: Session,
    subject_principal_id: uuid.UUID,
    organization_id: uuid.UUID,
    capability: str,
    *,
    case_id: uuid.UUID | None = None,
    grant_id: uuid.UUID | None = None,
    expected_epoch: int | None = None,
    at: datetime | None = None,
) -> GrantDecision:
    """按当前关系、scope、时间窗、撤销状态和 epoch 判定一项能力。"""
    normalized = _capability(capability)
    now = _at(at)

    organization_status = _organization_status(session, organization_id)
    if organization_status is None:
        return GrantDecision(False, "organization_missing")
    if organization_status != "active":
        return GrantDecision(False, "organization_inactive")

    if case_id is not None:
        case_organization_id = session.scalar(select(Case.organization_id).where(Case.id == case_id))
        if case_organization_id is None:
            return GrantDecision(False, "case_missing")
        if case_organization_id != organization_id:
            return GrantDecision(False, "cross_organization")

    if not _relationship_allows(session, organization_id, subject_principal_id, case_id):
        return GrantDecision(False, "relationship_missing")
    if not _principal_is_active(session, subject_principal_id):
        return GrantDecision(False, "subject_inactive")

    scope = Grant.case_id.is_(None) if case_id is None else or_(Grant.case_id.is_(None), Grant.case_id == case_id)
    conditions = [
        Grant.organization_id == organization_id,
        Grant.subject_principal_id == subject_principal_id,
        Grant.status == "active",
        Grant.not_before <= now,
        Grant.expires_at > now,
        Grant.capabilities.any(normalized),
        scope,
    ]
    if grant_id is not None:
        conditions.append(Grant.id == grant_id)

    grants = list(
        session.scalars(
            select(Grant)
            .where(and_(*conditions))
            .order_by(Grant.created_at.desc(), Grant.id)
            .execution_options(populate_existing=True)
        ).all()
    )
    if not grants:
        if grant_id is not None:
            current = _scoped_grant(session, grant_id, subject_principal_id, organization_id, case_id)
            if current is not None and expected_epoch is not None and current.fencing_epoch != expected_epoch:
                return GrantDecision(False, "grant_epoch_conflict", current.id, current.fencing_epoch)
            if current is not None and current.status == "revoked":
                return GrantDecision(False, "grant_revoked", current.id, current.fencing_epoch)
            if current is not None and current.expires_at <= now:
                return GrantDecision(False, "grant_expired", current.id, current.fencing_epoch)
        return GrantDecision(False, "grant_missing")

    if expected_epoch is not None:
        grants = [grant for grant in grants if grant.fencing_epoch == expected_epoch]
        if not grants:
            current = (
                _scoped_grant(session, grant_id, subject_principal_id, organization_id, case_id)
                if grant_id is not None
                else None
            )
            if current is None:
                return GrantDecision(False, "grant_epoch_conflict" if grant_id is None else "grant_missing")
            return GrantDecision(
                False,
                "grant_epoch_conflict",
                current.id if current else None,
                current.fencing_epoch if current else None,
            )

    for grant in grants:
        if _can_issue_grants(session, organization_id, grant.grantor_principal_id):
            return GrantDecision(True, "allowed", grant.id, grant.fencing_epoch)
    return GrantDecision(False, "grantor_not_authorized")


def revoke_grant(
    session: Session,
    grant_id: uuid.UUID,
    actor_principal_id: uuid.UUID,
    expected_epoch: int,
    *,
    at: datetime | None = None,
) -> Grant:
    """在锁住 Grant 后递增 fencing epoch，使旧授权立即失效。"""
    now = _at(at)
    grant = session.scalar(
        select(Grant)
        .where(Grant.id == grant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if grant is None:
        raise GrantConflict("grant does not exist")
    if grant.status != "active" or grant.fencing_epoch != expected_epoch:
        raise GrantConflict("grant status or epoch changed")
    if not _can_manage_grants(session, grant.organization_id, actor_principal_id):
        raise AuthorizationError("actor cannot revoke grants")
    grant.status = "revoked"
    grant.revoked_at = now
    grant.revoked_by_principal_id = actor_principal_id
    grant.fencing_epoch += 1
    session.flush()
    return grant


def expire_grant(session: Session, grant: Grant, *, at: datetime | None = None) -> Grant:
    now = _at(at)
    grant = session.scalar(
        select(Grant)
        .where(Grant.id == grant.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if grant is None:
        raise GrantConflict("grant does not exist")
    if grant.status != "active":
        raise GrantConflict(f"grant is {grant.status}")
    if now < grant.expires_at:
        raise GrantConflict("grant has not expired")
    grant.status = "expired"
    session.flush()
    return grant
