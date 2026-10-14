"""平台 Agent 身份、受限 bearer token 与只读工具契约。

Agent 是 Principal 的一种身份；注册不会写入机构成员或案件参与关系。
提案只能作为草稿产生，正式修订仍由既有人工审批流程负责。
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import _ensure_case_access, get_document
from patent_studio.domain.identity import Principal
from patent_studio.domain.organization import Case
from patent_studio.domain.proposals import create_proposal
from patent_studio.domain.work_items import WorkItem
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef


class AgentError(ValueError):
    """Agent 操作被拒绝。"""


class AgentAuthorizationError(AgentError):
    """Agent 没有目标范围权限。"""


class AgentTokenError(AgentError):
    """Bearer token 无效、过期或已撤销。"""


class AgentAccessToken(Base):
    __tablename__ = "agent_access_tokens"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'revoked')", name="status"),
        UniqueConstraint("token_hash", name="uq_agent_access_tokens_hash"),
        Index("ix_agent_access_tokens_principal_status", "principal_id", "status"),
        Index("ix_agent_access_tokens_scope", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    principal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=True
    )
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmptyInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")


class CaseListInput(EmptyInput):
    pass


class CaseSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    case_id: uuid.UUID
    case_key: str
    title: str
    status: str


class CaseListOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    cases: list[CaseSummary] = Field(default_factory=list)


class DocumentReadInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    document_id: uuid.UUID


class DocumentReadOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    document_id: uuid.UUID
    case_id: uuid.UUID
    book: str
    current_revision_id: uuid.UUID | None


class WorkItemListInput(EmptyInput):
    pass


class WorkItemSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    work_item_id: uuid.UUID
    title: str
    type: str
    status: str


class WorkItemListOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    work_items: list[WorkItemSummary] = Field(default_factory=list)


class ProposalCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    target_kind: Literal["document", "figure"]
    target_revision_id: uuid.UUID
    result_content_key: str = Field(min_length=1, max_length=512)
    result_content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    result_content_size: int = Field(ge=0)
    result_content_type: str = Field(min_length=1, max_length=128)


class ProposalOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    proposal_id: uuid.UUID
    status: Literal["draft"]
    target_revision_id: uuid.UUID


def provision_agent(session: Session, *, agent_key: str, display_name: str) -> Principal:
    key = agent_key.strip()
    name = display_name.strip()
    if not key or not name or len(key) > 128:
        raise AgentError("agent_key and display_name are required")
    existing = session.scalar(select(Principal).where(Principal.agent_key == key))
    if existing is not None:
        if existing.kind != "agent":
            raise AgentError("agent key is already used by another principal")
        return existing
    principal = Principal(kind="agent", agent_key=key, display_name=name)
    session.add(principal)
    session.flush()
    return principal


def _agent(session: Session, principal_id: uuid.UUID) -> Principal:
    principal = session.get(Principal, principal_id)
    if principal is None or principal.kind != "agent":
        raise AgentAuthorizationError("principal is not a registered agent")
    return principal


def list_cases(
    session: Session, *, principal_id: uuid.UUID, organization_id: uuid.UUID | None = None
) -> list[CaseSummary]:
    _agent(session, principal_id)
    # Keep the access predicate explicit and independent of payload identity.
    from patent_studio.domain.organization import CaseParticipant, OrganizationMembership

    stmt = select(Case).where(
        (Case.created_by_principal_id == principal_id)
        | Case.id.in_(
            select(CaseParticipant.case_id).where(
                CaseParticipant.principal_id == principal_id, CaseParticipant.status == "active"
            )
        )
        | Case.organization_id.in_(
            select(OrganizationMembership.organization_id).where(
                OrganizationMembership.principal_id == principal_id, OrganizationMembership.status == "active"
            )
        )
    )
    if organization_id is not None:
        stmt = stmt.where(Case.organization_id == organization_id)
    return [
        CaseSummary(case_id=row.id, case_key=row.case_key, title=row.title, status=row.status)
        for row in session.scalars(stmt.order_by(Case.case_key)).all()
    ]


def read_document(session: Session, *, principal_id: uuid.UUID, document_id: uuid.UUID) -> DocumentReadOutput:
    document = get_document(session, document_id, principal_id=principal_id)
    return DocumentReadOutput(
        document_id=document.id,
        case_id=document.case_id,
        book=document.book,
        current_revision_id=document.current_revision_id,
    )


def list_work_items(session: Session, *, principal_id: uuid.UUID, case_id: uuid.UUID) -> list[WorkItemSummary]:
    _ensure_case_access(session, case_id, principal_id)
    rows = session.scalars(select(WorkItem).where(WorkItem.case_id == case_id).order_by(WorkItem.created_at)).all()
    return [WorkItemSummary(work_item_id=row.id, title=row.title, type=row.type, status=row.status) for row in rows]


def create_agent_proposal(
    session: Session,
    *,
    principal_id: uuid.UUID,
    case_id: uuid.UUID,
    request: ProposalCreateInput,
) -> ProposalOutput:
    _agent(session, principal_id)
    proposal = create_proposal(
        session,
        case_id,
        principal_id=principal_id,
        proposer_principal_id=principal_id,
        target_kind=request.target_kind,
        target_revision_id=request.target_revision_id,
        result_content_ref=ObjectRef(
            request.result_content_key,
            request.result_content_sha256,
            request.result_content_size,
            request.result_content_type,
        ),
    )
    return ProposalOutput(proposal_id=proposal.id, status="draft", target_revision_id=request.target_revision_id)


def issue_agent_token(
    session: Session,
    *,
    principal_id: uuid.UUID,
    issuer_principal_id: uuid.UUID,
    organization_id: uuid.UUID | None = None,
    case_id: uuid.UUID | None = None,
    expires_at: datetime | None = None,
) -> str:
    _agent(session, principal_id)
    if organization_id is None and case_id is None:
        raise AgentTokenError("a case or organization scope is required")
    from patent_studio.domain.organization import OrganizationMembership

    if case_id is not None:
        case = _ensure_case_access(session, case_id, principal_id)
        if organization_id is None:
            organization_id = case.organization_id
    issuer = session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == issuer_principal_id,
            OrganizationMembership.role.in_(('owner', 'admin')),
            OrganizationMembership.status == "active",
        )
    )
    if issuer is None:
        raise AgentTokenError("only an active organization owner or admin may issue agent tokens")
    if case_id is not None:
        if organization_id is not None and case.organization_id != organization_id:
            raise AgentTokenError("case and organization scopes do not match")
    elif session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    ) is None:
        raise AgentTokenError("agent is not an active member of the organization scope")
    if expires_at is not None and expires_at <= datetime.now(UTC):
        raise AgentTokenError("token expiry must be in the future")
    raw = "agt_" + secrets.token_urlsafe(32)
    row = AgentAccessToken(
        principal_id=principal_id,
        organization_id=organization_id,
        case_id=case_id,
        token_prefix=raw[:12],
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=expires_at,
    )
    session.add(row)
    session.flush()
    return raw


def authenticate_agent_token(session: Session, raw_token: str, *, at: datetime | None = None) -> AgentAccessToken:
    if not raw_token.startswith("agt_"):
        raise AgentTokenError("invalid bearer token")
    now = (at or datetime.now(UTC)).astimezone(UTC)
    row = session.scalar(
        select(AgentAccessToken).where(
            AgentAccessToken.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
        )
    )
    if row is None or row.status != "active" or (row.expires_at is not None and row.expires_at <= now):
        raise AgentTokenError("invalid or expired bearer token")
    _agent(session, row.principal_id)
    return row


def revoke_agent_token(session: Session, token_id: uuid.UUID) -> None:
    row = session.get(AgentAccessToken, token_id)
    if row is None:
        raise AgentTokenError("token does not exist")
    row.status = "revoked"
    row.revoked_at = datetime.now(UTC)
