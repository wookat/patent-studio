# -*- coding: utf-8 -*-
"""Proposal / ChangeSet 领域模型与人工接受边界。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
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
    Uuid,
    func,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column

from patent_studio.domain.documents import (
    DocumentError,
    Revision,
    _content_columns,
    _ensure_case_access,
)
from patent_studio.domain.figures import FigureDocument, FigureRevision, create_figure_revision
from patent_studio.domain.identity import Principal
from patent_studio.infra.db import Base
from patent_studio.infra.storage import ObjectRef

PROPOSAL_STATUSES = ("draft", "submitted", "accepted", "rejected", "superseded")
PROPOSAL_TARGETS = ("document", "figure")


class ProposalError(DocumentError):
    """提案领域操作被拒绝。"""


class ProposalNotFound(ProposalError):
    """提案不存在。"""


class ProposalConflict(ProposalError):
    """提案状态或目标 revision 冲突。"""


class ProposalAuthorizationError(ProposalError):
    """Principal 无权操作提案。"""


class Proposal(Base):
    __tablename__ = "proposals"
    __table_args__ = (
        CheckConstraint(
            "((proposer_principal_id IS NOT NULL AND proposer_agent_key IS NULL) OR "
            "(proposer_principal_id IS NULL AND proposer_agent_key IS NOT NULL))",
            name="proposer_source",
        ),
        CheckConstraint("target_kind IN ('document', 'figure')", name="target_kind"),
        CheckConstraint(
            "((target_kind = 'document' AND document_revision_id IS NOT NULL AND figure_revision_id IS NULL) OR "
            "(target_kind = 'figure' AND document_revision_id IS NULL AND figure_revision_id IS NOT NULL))",
            name="target_revision",
        ),
        CheckConstraint(
            "status IN ('draft', 'submitted', 'accepted', 'rejected', 'superseded')", name="status"
        ),
        Index("ix_proposals_case_status", "case_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), nullable=False
    )
    proposer_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    proposer_agent_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    document_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    figure_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("figure_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    result_content_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    result_content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_content_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    accepted_by_principal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("principals.id", ondelete="RESTRICT"), nullable=True
    )
    accepted_document_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("document_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    accepted_figure_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("figure_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChangeSet(Base):
    __tablename__ = "change_sets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProposalChange(Base):
    __tablename__ = "proposal_changes"
    __table_args__ = (
        CheckConstraint("length(trim(target_anchor)) > 0", name="target_anchor"),
        Index("ix_proposal_changes_change_set", "change_set_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    change_set_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("change_sets.id", ondelete="CASCADE"), nullable=False
    )
    target_anchor: Mapped[str] = mapped_column(String(256), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _proposal_for(session: Session, proposal_id: uuid.UUID, principal_id: uuid.UUID) -> Proposal:
    proposal = session.get(Proposal, proposal_id)
    if proposal is None:
        raise ProposalNotFound("proposal does not exist")
    try:
        _ensure_case_access(session, proposal.case_id, principal_id)
    except DocumentError as exc:
        raise ProposalAuthorizationError(str(exc)) from exc
    return proposal


def _target_case(session: Session, target_kind: str, revision_id: uuid.UUID) -> uuid.UUID:
    if target_kind == "document":
        revision = session.get(Revision, revision_id)
        if revision is None:
            raise ProposalNotFound("target document revision does not exist")
        from patent_studio.domain.documents import Document

        document = session.get(Document, revision.document_id)
        if document is None:
            raise ProposalNotFound("target document does not exist")
        return document.case_id
    if target_kind == "figure":
        revision = session.get(FigureRevision, revision_id)
        if revision is None:
            raise ProposalNotFound("target figure revision does not exist")
        figure = session.get(FigureDocument, revision.figure_document_id)
        if figure is None:
            raise ProposalNotFound("target figure does not exist")
        return figure.case_id
    raise ProposalConflict("unsupported proposal target")


def _result_ref(proposal: Proposal) -> ObjectRef:
    if (
        proposal.result_content_key is None
        or proposal.result_content_sha256 is None
        or proposal.result_content_size is None
        or proposal.result_content_type is None
    ):
        raise ProposalConflict("proposal has no accepted content object")
    return ObjectRef(
        proposal.result_content_key,
        proposal.result_content_sha256,
        proposal.result_content_size,
        proposal.result_content_type,
    )


def create_proposal(
    session: Session,
    case_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    target_kind: Literal["document", "figure"],
    target_revision_id: uuid.UUID,
    proposer_principal_id: uuid.UUID | None = None,
    proposer_agent_key: str | None = None,
    result_content_ref: ObjectRef | None = None,
    changes: Iterable[Mapping[str, Any]] = (),
) -> Proposal:
    _ensure_case_access(session, case_id, principal_id)
    if target_kind not in PROPOSAL_TARGETS or _target_case(session, target_kind, target_revision_id) != case_id:
        raise ProposalConflict("proposal target is outside the case")
    if (proposer_principal_id is None) == (proposer_agent_key is None):
        raise ProposalConflict("exactly one proposer source is required")
    if proposer_principal_id is not None:
        _ensure_case_access(session, case_id, proposer_principal_id)
    proposal = Proposal(
        case_id=case_id,
        proposer_principal_id=proposer_principal_id,
        proposer_agent_key=proposer_agent_key,
        target_kind=target_kind,
        document_revision_id=target_revision_id if target_kind == "document" else None,
        figure_revision_id=target_revision_id if target_kind == "figure" else None,
    )
    if result_content_ref is not None:
        columns = _content_columns(result_content_ref)
        for key, value in columns.items():
            setattr(proposal, f"result_{key}", value)
    session.add(proposal)
    session.flush()
    change_set = ChangeSet(proposal_id=proposal.id)
    session.add(change_set)
    session.flush()
    for change in changes:
        add_change(
            session,
            proposal.id,
            target_anchor=str(change["target_anchor"]),
            payload=dict(change.get("payload", {})),
            principal_id=principal_id,
        )
    return proposal


def get_proposal(session: Session, proposal_id: uuid.UUID, *, principal_id: uuid.UUID) -> Proposal:
    return _proposal_for(session, proposal_id, principal_id)


def add_change(
    session: Session,
    proposal_id: uuid.UUID,
    *,
    principal_id: uuid.UUID,
    target_anchor: str,
    payload: Mapping[str, Any],
) -> ProposalChange:
    proposal = _proposal_for(session, proposal_id, principal_id)
    if proposal.status != "draft":
        raise ProposalConflict("changes can only be edited in draft")
    change_set = session.scalar(select(ChangeSet).where(ChangeSet.proposal_id == proposal.id))
    if change_set is None:
        raise ProposalConflict("proposal has no change set")
    change = ProposalChange(change_set_id=change_set.id, target_anchor=target_anchor, payload=dict(payload))
    session.add(change)
    session.flush()
    return change


def submit_proposal(session: Session, proposal_id: uuid.UUID, *, principal_id: uuid.UUID) -> Proposal:
    proposal = _proposal_for(session, proposal_id, principal_id)
    if proposal.status != "draft":
        raise ProposalConflict("only draft proposals can be submitted")
    proposal.status = "submitted"
    proposal.submitted_at = datetime.now(UTC)
    session.flush()
    return proposal


def reject_proposal(session: Session, proposal_id: uuid.UUID, *, principal_id: uuid.UUID) -> Proposal:
    proposal = _proposal_for(session, proposal_id, principal_id)
    if proposal.status != "submitted":
        raise ProposalConflict("only submitted proposals can be rejected")
    proposal.status = "rejected"
    proposal.accepted_by_principal_id = principal_id
    proposal.decided_at = datetime.now(UTC)
    session.flush()
    return proposal


def supersede_proposal(session: Session, proposal_id: uuid.UUID, *, principal_id: uuid.UUID) -> Proposal:
    proposal = _proposal_for(session, proposal_id, principal_id)
    if proposal.status != "submitted":
        raise ProposalConflict("only submitted proposals can be superseded")
    proposal.status = "superseded"
    proposal.accepted_by_principal_id = principal_id
    proposal.decided_at = datetime.now(UTC)
    session.flush()
    return proposal


def accept_proposal(session: Session, proposal_id: uuid.UUID, *, principal_id: uuid.UUID) -> Proposal:
    proposal = _proposal_for(session, proposal_id, principal_id)
    if proposal.status != "submitted":
        raise ProposalConflict("only submitted proposals can be accepted")
    content_ref = _result_ref(proposal)
    if proposal.proposer_principal_id is not None:
        proposer = session.get(Principal, proposal.proposer_principal_id)
        source = "agent_suggested_accepted" if proposer is not None and proposer.kind == "agent" else "manual"
    else:
        source = "agent_suggested_accepted"
    if proposal.target_kind == "document":
        from patent_studio.domain.documents import create_revision

        target = session.get(Revision, proposal.document_revision_id)
        if target is None:
            raise ProposalNotFound("target document revision does not exist")
        revision = create_revision(
            session,
            target.document_id,
            author_principal_id=principal_id,
            content_ref=content_ref,
            source=source,
            parent_revision_id=proposal.document_revision_id,
        )
        proposal.accepted_document_revision_id = revision.id
    else:
        target = session.get(FigureRevision, proposal.figure_revision_id)
        if target is None:
            raise ProposalNotFound("target figure revision does not exist")
        revision = create_figure_revision(
            session,
            target.figure_document_id,
            author_principal_id=principal_id,
            content_ref=content_ref,
            source=source,
            parent_revision_id=target.id,
        )
        proposal.accepted_figure_revision_id = revision.id
    proposal.status = "accepted"
    proposal.accepted_by_principal_id = principal_id
    proposal.decided_at = datetime.now(UTC)
    session.flush()
    return proposal
