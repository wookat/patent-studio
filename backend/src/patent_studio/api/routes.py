"""平台 /api/v1 REST 路由。已落地：组织 / 成员 / 邀请 / 案件 / 案件参与者（B3）、
documents / revisions / working-copies（B4）；proposals、releases、materials、runs 等域面随后续批次并入。"""

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from patent_studio.api import schemas as s
from patent_studio.api.dependencies import Ctx, DomainRoute, case_access, command, error, org_access, row_for
from patent_studio.domain import authorization as az
from patent_studio.domain import documents as d
from patent_studio.domain import operations as op
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.storage import object_ref, open_store
from patent_studio.settings import get_settings

router = APIRouter(
    prefix="/api/v1",
    tags=["Platform"],
    route_class=DomainRoute,
    responses={code: {"model": s.ErrorResponse} for code in (401, 403, 404, 409, 422, 503)},
)
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


def _scoped(ctx, case, key, kind, target, body, model, action):
    return command(ctx, key, kind, str(target), body, model, lambda: (action(), case.organization_id, case.id))


def _document(ctx, document_id, *, write=False):
    document = d.get_document(ctx.session, document_id, principal_id=ctx.principal.id)
    return document, case_access(ctx, document.case_id, write=write)


@router.get("/principals/me", response_model=s.PrincipalOut)
def principal_me(ctx: Ctx):
    return ctx.principal


@router.post("/organizations", response_model=s.OrganizationOut, status_code=201)
def create_organization(body: s.OrganizationIn, ctx: Ctx, key: Key):
    def action():
        org = Organization(**body.model_dump(), created_by_principal_id=ctx.principal.id)
        ctx.session.add(org)
        ctx.session.flush()
        ctx.session.add(
            OrganizationMembership(organization_id=org.id, principal_id=ctx.principal.id, role="owner", status="active")
        )
        ctx.session.flush()
        return org, org.id, None

    return command(ctx, key, "organization.create", "organizations", body, s.OrganizationOut, action)


@router.get("/organizations/{organization_id}/memberships", response_model=list[s.MembershipOut])
def memberships(organization_id: uuid.UUID, ctx: Ctx):
    org_access(ctx, organization_id)
    return list(
        ctx.session.scalars(
            select(OrganizationMembership).where(OrganizationMembership.organization_id == organization_id)
        )
    )


@router.post("/organizations/{organization_id}/invitations", response_model=s.InvitationOut, status_code=201)
def invite(organization_id: uuid.UUID, body: s.InvitationIn, ctx: Ctx, key: Key):
    org_access(ctx, organization_id, manage=True)
    if body.case_id is None and body.role not in {"admin", "member"}:
        raise error(422, "validation", "Organization invitations require an organization role")
    if body.case_id is not None:
        case = case_access(ctx, body.case_id, manage=True)
        if case.organization_id != organization_id or body.role in {"admin", "member"}:
            raise error(403, "denied", "Invitation scope or role is invalid")
    if body.expires_at <= datetime.now(UTC):
        raise error(422, "validation", "Invitation expiry must be in the future")
    if not az._principal_is_active(ctx.session, body.invitee_principal_id):
        raise error(403, "denied", "Invitee principal is inactive or missing")

    def action():
        invitation = az.Invitation(
            organization_id=organization_id, invited_by_principal_id=ctx.principal.id, **body.model_dump()
        )
        ctx.session.add(invitation)
        ctx.session.flush()
        return invitation, organization_id, body.case_id

    return command(ctx, key, "invitation.create", str(organization_id), body, s.InvitationOut, action)


@router.post("/invitations/{invitation_id}/accept", response_model=s.InvitationOut)
def accept_invitation(invitation_id: uuid.UUID, ctx: Ctx, key: Key):
    invitation = row_for(ctx, az.Invitation, invitation_id)
    if invitation.invitee_principal_id != ctx.principal.id:
        raise error(403, "denied", "Invitation is addressed to another principal")
    return command(
        ctx,
        key,
        "invitation.accept",
        str(invitation_id),
        None,
        s.InvitationOut,
        lambda: (
            az.accept_invitation(ctx.session, invitation, ctx.principal.id),
            invitation.organization_id,
            invitation.case_id,
        ),
    )


@router.post("/organizations/{organization_id}/cases", response_model=s.CaseOut, status_code=201)
def create_case(organization_id: uuid.UUID, body: s.CaseIn, ctx: Ctx, key: Key):
    org_access(ctx, organization_id, manage=True)

    def action():
        case = Case(organization_id=organization_id, created_by_principal_id=ctx.principal.id, **body.model_dump())
        ctx.session.add(case)
        ctx.session.flush()
        ctx.session.add(CaseParticipant(case_id=case.id, principal_id=ctx.principal.id, role="case_manager"))
        ctx.session.flush()
        return case, organization_id, case.id

    return command(ctx, key, "case.create", str(organization_id), body, s.CaseOut, action)


@router.get("/cases", response_model=list[s.CaseOut])
def list_cases(ctx: Ctx):
    """当前 Principal 可见的案件，供平台工作队列选择器使用。"""
    member_orgs = select(OrganizationMembership.organization_id).where(
        OrganizationMembership.principal_id == ctx.principal.id,
        OrganizationMembership.status == "active",
    )
    participant_cases = select(CaseParticipant.case_id).where(
        CaseParticipant.principal_id == ctx.principal.id,
        CaseParticipant.status == "active",
    )
    return list(
        ctx.session.scalars(
            select(Case)
            .where(
                (Case.organization_id.in_(member_orgs))
                | (Case.id.in_(participant_cases))
                | (Case.created_by_principal_id == ctx.principal.id)
            )
            .order_by(Case.updated_at.desc(), Case.case_key)
        ).all()
    )


@router.get("/cases/{case_id}", response_model=s.CaseOut)
def get_case(case_id: uuid.UUID, ctx: Ctx):
    return case_access(ctx, case_id)


@router.get("/cases/{case_id}/participants", response_model=list[s.ParticipantOut])
def participants(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(CaseParticipant).where(CaseParticipant.case_id == case_id)))


@router.post("/cases/{case_id}/participants", response_model=s.ParticipantOut, status_code=201)
def add_participant(case_id: uuid.UUID, body: s.ParticipantIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, manage=True)
    member = ctx.session.get(OrganizationMembership, (case.organization_id, body.principal_id))
    if member is None or member.status != "active" or not az._principal_is_active(ctx.session, body.principal_id):
        raise error(403, "denied", "External participants must accept a case invitation")

    def action():
        participant = CaseParticipant(case_id=case.id, **body.model_dump())
        ctx.session.add(participant)
        ctx.session.flush()
        return participant

    return _scoped(ctx, case, key, "participant.add", case_id, body, s.ParticipantOut, action)


@router.get("/cases/{case_id}/documents", response_model=list[s.DocumentOut])
def documents(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(d.Document).where(d.Document.case_id == case_id)))


@router.post("/cases/{case_id}/documents", response_model=s.DocumentOut, status_code=201)
def create_document(case_id: uuid.UUID, body: s.DocumentIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "document.create",
        case_id,
        body,
        s.DocumentOut,
        lambda: d.create_document(ctx.session, case_id, principal_id=ctx.principal.id, book=body.book),
    )


@router.get("/documents/{document_id}", response_model=s.DocumentOut)
def get_document(document_id: uuid.UUID, ctx: Ctx):
    return _document(ctx, document_id)[0]


@router.get("/documents/{document_id}/revisions", response_model=list[s.RevisionOut])
def revisions(document_id: uuid.UUID, ctx: Ctx):
    _document(ctx, document_id)
    return d.list_revisions(ctx.session, document_id, principal_id=ctx.principal.id)


@router.get("/revisions/{revision_id}", response_model=s.RevisionOut)
def get_revision(revision_id: uuid.UUID, ctx: Ctx):
    revision = row_for(ctx, d.Revision, revision_id)
    _document(ctx, revision.document_id)
    return revision


@router.post("/documents/{document_id}/revisions", response_model=s.RevisionOut, status_code=201)
def create_revision(document_id: uuid.UUID, body: s.RevisionIn, ctx: Ctx, key: Key):
    _doc, case = _document(ctx, document_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "revision.create",
        document_id,
        body,
        s.RevisionOut,
        lambda: d.create_revision(
            ctx.session,
            document_id,
            author_principal_id=ctx.principal.id,
            source=ctx.revision_source,
            content_ref=body.content_ref.object_ref(),
            parent_revision_id=body.parent_revision_id,
        ),
    )


@router.post("/documents/{document_id}/working-copies", response_model=s.WorkingCopyOut, status_code=201)
def open_copy(document_id: uuid.UUID, body: s.WorkingCopyIn, ctx: Ctx, key: Key):
    _doc, case = _document(ctx, document_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "working_copy.open",
        document_id,
        body,
        s.WorkingCopyOut,
        lambda: d.open_working_copy(
            ctx.session,
            document_id,
            principal_id=ctx.principal.id,
            base_revision_id=body.base_revision_id,
            content_ref=body.content_ref.object_ref() if body.content_ref else None,
        ),
    )


def _copy(ctx, working_copy_id):
    copy = d.get_working_copy(ctx.session, working_copy_id, principal_id=ctx.principal.id)
    _doc, case = _document(ctx, copy.document_id, write=True)
    return copy, case


@router.get("/working-copies/{working_copy_id}", response_model=s.WorkingCopyOut)
def get_copy(working_copy_id: uuid.UUID, ctx: Ctx):
    return _copy(ctx, working_copy_id)[0]


@router.get("/working-copies/{working_copy_id}/content", response_class=PlainTextResponse)
async def get_copy_content(working_copy_id: uuid.UUID, ctx: Ctx):
    copy, _case = _copy(ctx, working_copy_id)
    settings = get_settings()
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    try:
        data = await open_store(
            settings.storage_url,
            s3_endpoint_url=settings.s3_endpoint_url,
            s3_region=settings.s3_region,
        ).get(copy.content_key)
    except Exception as exc:
        raise error(404, "not_found", "Working copy content is unavailable") from exc
    if len(data) != copy.content_size or hashlib.sha256(data).hexdigest() != copy.content_sha256:
        raise error(409, "conflict", "Working copy content digest does not match metadata")
    return PlainTextResponse(data, media_type=copy.content_type)


@router.put("/working-copies/{working_copy_id}", response_model=s.WorkingCopyOut)
def save_copy(working_copy_id: uuid.UUID, body: s.SaveIn, ctx: Ctx, key: Key):
    _copy_row, case = _copy(ctx, working_copy_id)
    return _scoped(
        ctx,
        case,
        key,
        "working_copy.save",
        working_copy_id,
        body,
        s.WorkingCopyOut,
        lambda: d.save_working_copy(
            ctx.session,
            working_copy_id,
            principal_id=ctx.principal.id,
            expected_version=body.expected_version,
            content_ref=body.content_ref.object_ref(),
        ),
    )


@router.put("/working-copies/{working_copy_id}/content", response_model=s.WorkingCopyOut)
async def save_copy_content(working_copy_id: uuid.UUID, body: s.WorkingCopyContentIn, ctx: Ctx, key: Key):
    copy, case = _copy(ctx, working_copy_id)
    settings = get_settings()
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    data = body.content.encode("utf-8")
    ref = object_ref(data, "text/markdown; charset=utf-8")
    await open_store(
        settings.storage_url,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_region=settings.s3_region,
    ).put(data, ref.content_type)
    return _scoped(
        ctx,
        case,
        key,
        "working_copy.save_content",
        working_copy_id,
        body,
        s.WorkingCopyOut,
        lambda: d.save_working_copy(
            ctx.session,
            working_copy_id,
            principal_id=ctx.principal.id,
            expected_version=body.expected_version,
            content_ref=ref,
        ),
    )


@router.post("/working-copies/{working_copy_id}/commit", response_model=s.OperationOut)
def commit_copy(working_copy_id: uuid.UUID, body: s.CommitIn, ctx: Ctx, key: Key):
    _copy_row, case = _copy(ctx, working_copy_id)
    return _scoped(
        ctx,
        case,
        key,
        "working_copy.commit",
        working_copy_id,
        body,
        s.OperationOut,
        lambda: op.commit_working_copy_with_outbox(
            ctx.session,
            working_copy_id,
            principal_id=ctx.principal.id,
            organization_id=case.organization_id,
            operation_id=key,
            expected_version=body.expected_version,
            source=ctx.revision_source,
        ),
    )


@router.post("/working-copies/{working_copy_id}/collab/flush", response_model=s.FlushOut)
async def flush_collab(working_copy_id: uuid.UUID, ctx: Ctx):
    copy, _case = _copy(ctx, working_copy_id)
    from patent_studio.api.yjs import flush_room

    flushed = await flush_room(copy.id, ctx.principal.id)
    return {"flushed": flushed}
