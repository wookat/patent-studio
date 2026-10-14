"""Strict REST DTOs; identity is provided only by the session dependency."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from patent_studio.infra.storage import ObjectRef


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always", from_attributes=True)


class ErrorDetail(DTO):
    kind: str
    message: str
    line: int | None = None
    detail: object = None


class ErrorResponse(DTO):
    detail: ErrorDetail


class Ref(DTO):
    key: str = Field(min_length=1, max_length=512)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)
    content_type: str = Field(min_length=1, max_length=128)

    def object_ref(self) -> ObjectRef:
        return ObjectRef(self.key, self.sha256, self.size, self.content_type)


class OrganizationIn(DTO):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)
    name: str = Field(min_length=1, max_length=200)


class OrganizationOut(OrganizationIn):
    id: uuid.UUID
    status: str


class MembershipOut(DTO):
    organization_id: uuid.UUID
    principal_id: uuid.UUID
    role: str
    status: str


class InvitationIn(DTO):
    invitee_principal_id: uuid.UUID
    role: Literal["admin", "member", "client", "inventor", "applicant", "author", "attorney",
                  "drafter", "reviewer", "case_manager", "observer"]
    case_id: uuid.UUID | None = None
    expires_at: datetime


class InvitationOut(DTO):
    id: uuid.UUID
    organization_id: uuid.UUID
    case_id: uuid.UUID | None
    invitee_principal_id: uuid.UUID
    role: str
    status: str
    expires_at: datetime


class CaseIn(DTO):
    case_key: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    kind: Literal["invention", "utility", "design"] = "invention"


class CaseOut(CaseIn):
    id: uuid.UUID
    organization_id: uuid.UUID
    status: str


class ParticipantIn(DTO):
    principal_id: uuid.UUID
    role: Literal["client", "inventor", "applicant", "author", "attorney", "drafter",
                  "reviewer", "case_manager", "observer"]


class ParticipantOut(ParticipantIn):
    case_id: uuid.UUID
    status: str


class DocumentIn(DTO):
    book: Literal["abstract", "claims", "description"]


class DocumentOut(DocumentIn):
    id: uuid.UUID
    case_id: uuid.UUID
    current_revision_id: uuid.UUID | None


class RevisionIn(DTO):
    content_ref: Ref
    parent_revision_id: uuid.UUID | None = None


class RevisionOut(DTO):
    id: uuid.UUID
    document_id: uuid.UUID
    revision_no: int
    parent_revision_id: uuid.UUID | None
    content_ref: Ref
    source: str


class WorkingCopyIn(DTO):
    content_ref: Ref | None = None
    base_revision_id: uuid.UUID | None = None


class WorkingCopyOut(DTO):
    id: uuid.UUID
    document_id: uuid.UUID
    principal_id: uuid.UUID
    base_revision_id: uuid.UUID | None
    version: int
    content_ref: Ref


class SaveIn(DTO):
    expected_version: int = Field(ge=1)
    content_ref: Ref


class WorkingCopyContentIn(DTO):
    expected_version: int = Field(ge=1)
    content: str = Field(max_length=2_000_000)


class CommitIn(DTO):
    expected_version: int = Field(ge=1)


class OperationOut(DTO):
    id: uuid.UUID
    operation_id: str
    operation_type: str
    organization_id: uuid.UUID
    case_id: uuid.UUID | None
    status: str


class RunIn(DTO):
    run_type: str = Field(min_length=1, max_length=64)


class RunOut(DTO):
    id: uuid.UUID
    run_id: str
    run_type: str
    case_id: uuid.UUID
    triggered_by_principal_id: uuid.UUID
    operation_id: uuid.UUID | None
    status: str
    fencing_epoch: int
    temporal_workflow_id: str | None
    temporal_run_id: str | None
    error_summary: str | None


class RunEventOut(DTO):
    id: uuid.UUID
    run_id: uuid.UUID
    seq: int
    event_type: str
    payload: dict


class ApprovalOut(DTO):
    id: uuid.UUID
    run_id: uuid.UUID
    case_id: uuid.UUID
    approver_principal_id: uuid.UUID
    status: str
    decided_by_principal_id: uuid.UUID | None
    decided_at: datetime | None
    reason: str | None


class ApprovalDecisionIn(DTO):
    decision: Literal["approved", "rejected"]
    reason: str | None = Field(default=None, max_length=1000)


class ProposalIn(DTO):
    target_kind: Literal["document", "figure"]
    target_revision_id: uuid.UUID
    result_content_ref: Ref


class ProposalOut(DTO):
    id: uuid.UUID
    case_id: uuid.UUID
    status: str
    target_kind: str
    accepted_document_revision_id: uuid.UUID | None
    accepted_figure_revision_id: uuid.UUID | None


class FigureIn(DTO):
    document_id: uuid.UUID | None = None
    figure_no: int | None = Field(default=None, ge=1)
    title: str = Field(default="", max_length=300)


class FigureOut(FigureIn):
    id: uuid.UUID
    case_id: uuid.UUID
    current_revision_id: uuid.UUID | None


class ReleaseOut(DTO):
    id: uuid.UUID
    case_id: uuid.UUID
    status: str


class ReleaseItemIn(DTO):
    item_kind: Literal["document", "figure"]
    revision_id: uuid.UUID
    ordinal: int | None = Field(default=None, ge=1)


class ReleaseItemOut(DTO):
    id: uuid.UUID
    release_id: uuid.UUID
    ordinal: int
    item_kind: str


class ArtifactOut(DTO):
    id: uuid.UUID
    release_id: uuid.UUID
    filename: str
    content_ref: Ref
    inputs: list[dict]
    created_at: datetime


class WorkItemIn(DTO):
    type: Literal["draft", "review", "figure", "oa-response", "search", "client-confirm", "deliver"]
    title: str = Field(min_length=1, max_length=300)
    assignee_principal_id: uuid.UUID | None = None
    deadline: datetime | None = None
    priority: int = Field(default=3, ge=1, le=5)
    document_id: uuid.UUID | None = None
    figure_document_id: uuid.UUID | None = None
    release_id: uuid.UUID | None = None
    official_no: str | None = Field(default=None, max_length=128)
    oa_deadline: datetime | None = None
    response_document_id: uuid.UUID | None = None


class WorkItemOut(WorkItemIn):
    id: uuid.UUID
    case_id: uuid.UUID
    status: str
    reporter_principal_id: uuid.UUID


class AssignmentIn(DTO):
    assignee_principal_id: uuid.UUID | None


class StatusIn(DTO):
    status: Literal["open", "in_progress", "blocked", "in_review", "done", "canceled"]


class DeadlineIn(DTO):
    deadline: datetime | None


class NotificationOut(DTO):
    id: str
    case_id: uuid.UUID | None
    recipient_principal_id: uuid.UUID | None
    notification_type: str | None
    work_item_id: uuid.UUID | None
    read_at: datetime | None
    payload: dict | None


class FlushOut(DTO):
    flushed: int


class PrincipalOut(DTO):
    id: uuid.UUID
    kind: str
    display_name: str
