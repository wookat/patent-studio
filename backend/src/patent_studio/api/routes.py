"""平台 /api/v1 REST 路由。已落地：组织 / 成员 / 邀请 / 案件 / 案件参与者（B3）、
documents / revisions / working-copies（B4）、proposals / figures / releases（B5）、
operations 查询 + runs / approvals / events SSE（B7）、work-items / notifications（B9）、
materials / anchors / facts（B10）。全部规划面已就位。"""

import asyncio
import hashlib
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Header, Response, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import select

from patent_studio.api import schemas as s
from patent_studio.api.dependencies import Ctx, DomainRoute, case_access, command, error, org_access, row_for
from patent_studio.domain import authorization as az
from patent_studio.domain import documents as d
from patent_studio.domain import figures as f
from patent_studio.domain import materials as mat
from patent_studio.domain import operations as op
from patent_studio.domain import proposals as p
from patent_studio.domain import releases as r
from patent_studio.domain import runs as run_domain
from patent_studio.domain import work_items as w
from patent_studio.domain.identity import Notification
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.storage import object_ref, open_store
from patent_studio.kernel import critic, preflight
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.kernel.omml import to_mathml
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


@router.get("/documents/{document_id}/working-copies", response_model=list[s.WorkingCopyOut])
def list_copies(document_id: uuid.UUID, ctx: Ctx):
    """本人对该文稿的工作副本（最近更新在前）——编辑器页刷新/重进时恢复草稿。"""
    document, _case = _document(ctx, document_id)
    return ctx.session.scalars(
        select(d.WorkingCopy)
        .where(d.WorkingCopy.document_id == document.id, d.WorkingCopy.principal_id == ctx.principal.id)
        .order_by(d.WorkingCopy.updated_at.desc(), d.WorkingCopy.created_at.desc())
    ).all()


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


@router.post("/cases/{case_id}/proposals", response_model=s.ProposalOut, status_code=201)
def create_proposal(case_id: uuid.UUID, body: s.ProposalIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "proposal.create",
        case_id,
        body,
        s.ProposalOut,
        lambda: p.create_proposal(
            ctx.session,
            case_id,
            principal_id=ctx.principal.id,
            proposer_principal_id=ctx.principal.id,
            target_kind=body.target_kind,
            target_revision_id=body.target_revision_id,
            result_content_ref=body.result_content_ref.object_ref(),
        ),
    )


@router.get("/cases/{case_id}/proposals", response_model=list[s.ProposalOut])
def proposals(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(p.Proposal).where(p.Proposal.case_id == case_id)))


@router.post("/proposals/{proposal_id}/{decision}", response_model=s.ProposalOut)
def decide_proposal(proposal_id: uuid.UUID, decision: str, ctx: Ctx, key: Key):
    proposal = p.get_proposal(ctx.session, proposal_id, principal_id=ctx.principal.id)
    case = case_access(ctx, proposal.case_id, manage=decision != "submit", write=True)
    actions = {"submit": p.submit_proposal, "accept": p.accept_proposal, "reject": p.reject_proposal}
    if decision not in actions:
        raise error(404, "not_found", "Unknown proposal decision")
    return _scoped(
        ctx,
        case,
        key,
        f"proposal.{decision}",
        proposal_id,
        None,
        s.ProposalOut,
        lambda: actions[decision](ctx.session, proposal_id, principal_id=ctx.principal.id),
    )


@router.get("/cases/{case_id}/figures", response_model=list[s.FigureOut])
def figures(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(f.FigureDocument).where(f.FigureDocument.case_id == case_id)))


@router.post("/cases/{case_id}/figures", response_model=s.FigureOut, status_code=201)
def create_figure(case_id: uuid.UUID, body: s.FigureIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "figure.create",
        case_id,
        body,
        s.FigureOut,
        lambda: f.create_figure_document(ctx.session, case_id, principal_id=ctx.principal.id, **body.model_dump()),
    )


def _figure(ctx: Ctx, figure_id: uuid.UUID, *, write=False):
    figure = f.get_figure_document(ctx.session, figure_id, principal_id=ctx.principal.id)
    return figure, case_access(ctx, figure.case_id, write=write)


@router.get("/figures/{figure_id}/revisions", response_model=list[s.FigureRevisionOut])
def figure_revisions(figure_id: uuid.UUID, ctx: Ctx):
    _figure(ctx, figure_id)
    return f.list_figure_revisions(ctx.session, figure_id, principal_id=ctx.principal.id)


_FIGURE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024


@router.post("/figures/{figure_id}/revisions", response_model=s.FigureRevisionOut, status_code=201)
async def upload_figure_revision(figure_id: uuid.UUID, ctx: Ctx, key: Key, file: Annotated[UploadFile, File()]):
    """附图图片上传（B13 附图面板）：multipart bytes → 对象存储 → 不可变 FigureRevision。"""
    figure, case = _figure(ctx, figure_id, write=True)
    data = await file.read(_FIGURE_UPLOAD_MAX_BYTES + 1)
    if not data:
        raise error(422, "validation", "Upload is empty")
    if len(data) > _FIGURE_UPLOAD_MAX_BYTES:
        raise error(413, "payload_too_large", "附图文件超过 20 MB")
    ref = object_ref(data, file.content_type or "application/octet-stream")
    await _store(get_settings()).put(data, ref.content_type)
    return _scoped(
        ctx,
        case,
        key,
        "figure.revision.create",
        figure_id,
        None,
        s.FigureRevisionOut,
        lambda: f.create_figure_revision(
            ctx.session,
            figure.id,
            author_principal_id=ctx.principal.id,
            content_ref=ref,
            source=ctx.revision_source,
        ),
    )


@router.get("/figures/{figure_id}/content")
async def figure_content(figure_id: uuid.UUID, ctx: Ctx):
    """附图当前修订图片字节（缩略预览 <img src> 直连，cookie 会话鉴权）。"""
    figure, _case = _figure(ctx, figure_id)
    if figure.current_revision_id is None:
        raise error(404, "not_found", "Figure has no image revision")
    revision = row_for(ctx, f.FigureRevision, figure.current_revision_id)
    settings = get_settings()
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    try:
        data = await _store(settings).get(revision.content_key)
    except Exception as exc:
        raise error(404, "not_found", "Figure image is unavailable") from exc
    if len(data) != revision.content_size or hashlib.sha256(data).hexdigest() != revision.content_sha256:
        raise error(409, "conflict", "Figure image digest does not match metadata")
    return Response(content=data, media_type=revision.content_type)


@router.get("/cases/{case_id}/releases", response_model=list[s.ReleaseOut])
def releases(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(r.Release).where(r.Release.case_id == case_id)))


@router.post("/cases/{case_id}/releases", response_model=s.ReleaseOut, status_code=201)
def create_release(case_id: uuid.UUID, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "release.create",
        case_id,
        None,
        s.ReleaseOut,
        lambda: r.create_release(ctx.session, case_id, principal_id=ctx.principal.id),
    )


@router.post("/releases/{release_id}/items", response_model=s.ReleaseItemOut, status_code=201)
def add_release_item(release_id: uuid.UUID, body: s.ReleaseItemIn, ctx: Ctx, key: Key):
    release = r.get_release(ctx.session, release_id, principal_id=ctx.principal.id)
    case = case_access(ctx, release.case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "release.item",
        release_id,
        body,
        s.ReleaseItemOut,
        lambda: r.add_release_item(ctx.session, release_id, principal_id=ctx.principal.id, **body.model_dump()),
    )


@router.get("/releases/{release_id}/items", response_model=list[s.ReleaseItemOut])
def release_items(release_id: uuid.UUID, ctx: Ctx):
    release = r.get_release(ctx.session, release_id, principal_id=ctx.principal.id)
    case_access(ctx, release.case_id)
    return r.list_release_items(ctx.session, release_id)


@router.post("/releases/{release_id}/seal", response_model=s.ReleaseOut)
def seal_release(release_id: uuid.UUID, ctx: Ctx, key: Key):
    release = r.get_release(ctx.session, release_id, principal_id=ctx.principal.id)
    case = case_access(ctx, release.case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "release.seal",
        release_id,
        None,
        s.ReleaseOut,
        lambda: r.seal_release(ctx.session, release_id, principal_id=ctx.principal.id),
    )


@router.post("/releases/{release_id}/build", response_model=s.ArtifactOut, status_code=201)
def build_release(release_id: uuid.UUID, ctx: Ctx, key: Key):
    release = r.get_release(ctx.session, release_id, principal_id=ctx.principal.id)
    case = case_access(ctx, release.case_id, write=True)
    settings = get_settings()
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    store = open_store(
        settings.storage_url,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_region=settings.s3_region,
    )
    filename, data, inputs = r.render_release(
        ctx.session,
        release_id,
        principal_id=ctx.principal.id,
        read=lambda ref: asyncio.run(store.get(ref.key)),
    )
    ref = object_ref(data, r.DOCX_CONTENT_TYPE)
    asyncio.run(store.put(data, ref.content_type))
    return _scoped(
        ctx,
        case,
        key,
        "release.build",
        release_id,
        None,
        s.ArtifactOut,
        lambda: r.record_release_artifact(
            ctx.session,
            release_id,
            principal_id=ctx.principal.id,
            filename=filename,
            content_ref=ref,
            inputs=inputs,
        ),
    )


@router.get("/releases/{release_id}/artifacts", response_model=list[s.ArtifactOut])
def release_artifacts(release_id: uuid.UUID, ctx: Ctx):
    release = r.get_release(ctx.session, release_id, principal_id=ctx.principal.id)
    case_access(ctx, release.case_id)
    return r.list_release_artifacts(ctx.session, release_id, principal_id=ctx.principal.id)


@router.get("/artifacts/{artifact_id}/content")
async def get_artifact_content(artifact_id: uuid.UUID, ctx: Ctx):
    artifact = r.get_release_artifact(ctx.session, artifact_id, principal_id=ctx.principal.id)
    settings = get_settings()
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    try:
        data = await open_store(
            settings.storage_url,
            s3_endpoint_url=settings.s3_endpoint_url,
            s3_region=settings.s3_region,
        ).get(artifact.content_key)
    except Exception as exc:
        raise error(404, "not_found", "Artifact content is unavailable") from exc
    if len(data) != artifact.content_size or hashlib.sha256(data).hexdigest() != artifact.content_sha256:
        raise error(409, "conflict", "Artifact content digest does not match metadata")
    return Response(
        content=data,
        media_type=artifact.content_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.filename}"'},
    )


def _store(settings):
    if not settings.storage_url:
        raise error(503, "storage_unavailable", "Object storage is not configured")
    return open_store(
        settings.storage_url,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_region=settings.s3_region,
    )


@router.get("/operations/{operation_id}", response_model=s.OperationOut)
def get_operation(operation_id: str, ctx: Ctx):
    operation = ctx.session.scalar(select(op.Operation).where(op.Operation.operation_id == operation_id))
    if operation is None:
        raise error(404, "not_found", "Operation does not exist")
    if operation.principal_id != ctx.principal.id:
        raise error(403, "denied", "Operation belongs to another principal")
    case_access(ctx, operation.case_id) if operation.case_id else org_access(ctx, operation.organization_id)
    return operation


@router.post("/cases/{case_id}/runs", response_model=s.RunOut, status_code=201)
def create_run(case_id: uuid.UUID, body: s.RunIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)

    def action():
        op.record_operation(
            ctx.session,
            key,
            operation_type="run.create",
            principal_id=ctx.principal.id,
            organization_id=case.organization_id,
            case_id=case.id,
        )
        return run_domain.create_run(
            ctx.session,
            key,
            run_type=body.run_type,
            case_id=case.id,
            principal_id=ctx.principal.id,
            operation_id=key,
        )

    return _scoped(ctx, case, key, "run.create", case_id, body, s.RunOut, action)


@router.get("/runs/{run_id}", response_model=s.RunOut)
def get_run(run_id: str, ctx: Ctx):
    run = run_domain._run_for(ctx.session, run_id, ctx.principal.id)
    return run


@router.get("/runs/{run_id}/events", response_model=list[s.RunEventOut])
def run_events(run_id: str, ctx: Ctx):
    run = run_domain._run_for(ctx.session, run_id, ctx.principal.id)
    return list(
        ctx.session.scalars(
            select(run_domain.RunEvent).where(run_domain.RunEvent.run_id == run.id).order_by(run_domain.RunEvent.seq)
        )
    )


_RUN_TERMINAL = {"succeeded", "failed", "canceled"}


def _sse_frame(event_id: int, event: str, data: dict) -> str:
    return f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/runs/{run_id}/events/stream")
def run_events_stream(
    run_id: str,
    ctx: Ctx,
    last_event_id: Annotated[str | None, Header()] = None,
):
    """Push run events over SSE; `Last-Event-ID` resumes after the given seq.

    The DB is polled at `sse_poll_seconds`; a `: hb` comment frame is emitted every
    `sse_heartbeat_seconds` to survive proxies; the stream closes with `event: done`
    once the run reaches a terminal state (or hits `sse_max_seconds`).
    """
    run = run_domain._run_for(ctx.session, run_id, ctx.principal.id)
    case_access(ctx, run.case_id)
    if last_event_id is None:
        after = 0
    else:
        try:
            after = int(last_event_id)
        except ValueError:
            raise error(422, "validation", "Last-Event-ID must be a run event seq") from None
        if after < 0:
            raise error(422, "validation", "Last-Event-ID must be a run event seq")

    settings = get_settings()
    session = ctx.session
    run_pk = run.id

    def stream():
        cursor = after
        deadline = time.monotonic() + max(settings.sse_max_seconds, 0.1)
        last_beat = time.monotonic()
        while time.monotonic() < deadline:
            events = session.scalars(
                select(run_domain.RunEvent)
                .where(run_domain.RunEvent.run_id == run_pk, run_domain.RunEvent.seq > cursor)
                .order_by(run_domain.RunEvent.seq)
            ).all()
            for event in events:
                cursor = event.seq
                yield _sse_frame(
                    event.seq,
                    "run-event",
                    {
                        "id": str(event.id),
                        "run_id": str(event.run_id),
                        "seq": event.seq,
                        "event_type": event.event_type,
                        "payload": event.payload or {},
                    },
                )
            status = session.scalar(select(run_domain.Run.status).where(run_domain.Run.id == run_pk))
            if status in _RUN_TERMINAL:
                yield f"event: done\ndata: {json.dumps({'status': status})}\n\n"
                return
            now = time.monotonic()
            if now - last_beat >= max(settings.sse_heartbeat_seconds, 0.1):
                yield ": hb\n\n"
                last_beat = now
            time.sleep(max(settings.sse_poll_seconds, 0.05))
        status = session.scalar(select(run_domain.Run.status).where(run_domain.Run.id == run_pk))
        yield f"event: done\ndata: {json.dumps({'status': status, 'reason': 'connection_limit'})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{run_id}/approvals", response_model=list[s.ApprovalOut])
def run_approvals(run_id: str, ctx: Ctx):
    run = run_domain._run_for(ctx.session, run_id, ctx.principal.id)
    return list(ctx.session.scalars(select(run_domain.Approval).where(run_domain.Approval.run_id == run.id)))


@router.post("/approvals/{approval_id}/decision", response_model=s.ApprovalOut)
def decide_approval(approval_id: uuid.UUID, body: s.ApprovalDecisionIn, ctx: Ctx, key: Key):
    approval = row_for(ctx, run_domain.Approval, approval_id)
    case = case_access(ctx, approval.case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "approval.decide",
        approval_id,
        body,
        s.ApprovalOut,
        lambda: run_domain.decide_approval(
            ctx.session,
            approval_id,
            principal_id=ctx.principal.id,
            decision=body.decision,
            reason=body.reason,
        ),
    )


@router.get("/cases/{case_id}/work-items", response_model=list[s.WorkItemOut])
def work_items(case_id: uuid.UUID, ctx: Ctx):
    case_access(ctx, case_id)
    return list(ctx.session.scalars(select(w.WorkItem).where(w.WorkItem.case_id == case_id)))


@router.get("/work-items", response_model=list[s.WorkItemOut])
def list_all_work_items(ctx: Ctx):
    """跨案件工作队列查询；每个结果仍经过案件访问关系过滤。"""
    rows = list(ctx.session.scalars(select(w.WorkItem).order_by(w.WorkItem.deadline, w.WorkItem.created_at)))
    visible = []
    for item in rows:
        try:
            case_access(ctx, item.case_id)
        except Exception:
            continue
        visible.append(item)
    return visible


@router.post("/cases/{case_id}/work-items", response_model=s.WorkItemOut, status_code=201)
def create_work_item(case_id: uuid.UUID, body: s.WorkItemIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "work_item.create",
        case_id,
        body,
        s.WorkItemOut,
        lambda: w.create_work_item(ctx.session, case_id, principal_id=ctx.principal.id, **body.model_dump()),
    )


@router.put("/work-items/{work_item_id}/assignment", response_model=s.WorkItemOut)
def assign_work_item(work_item_id: uuid.UUID, body: s.AssignmentIn, ctx: Ctx, key: Key):
    item = row_for(ctx, w.WorkItem, work_item_id)
    case = case_access(ctx, item.case_id, manage=True)

    def action():
        updated = w.assign_work_item(ctx.session, work_item_id, principal_id=ctx.principal.id, **body.model_dump())
        if updated.assignee_principal_id is not None:
            w.record_notification(
                ctx.session,
                case_id=updated.case_id,
                recipient_principal_id=updated.assignee_principal_id,
                notification_type="work_item.assigned",
                work_item_id=updated.id,
                payload={"work_item_id": str(updated.id)},
                dedupe_key=f"work-item-assigned:{updated.id}:{key}",
            )
        return updated

    return _scoped(ctx, case, key, "work_item.assign", work_item_id, body, s.WorkItemOut, action)


@router.put("/work-items/{work_item_id}/deadline", response_model=s.WorkItemOut)
def reschedule(work_item_id: uuid.UUID, body: s.DeadlineIn, ctx: Ctx, key: Key):
    item = row_for(ctx, w.WorkItem, work_item_id)
    case = case_access(ctx, item.case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "work_item.reschedule",
        work_item_id,
        body,
        s.WorkItemOut,
        lambda: w.reschedule_work_item(
            ctx.session, work_item_id, principal_id=ctx.principal.id, deadline=body.deadline
        ),
    )


@router.put("/work-items/{work_item_id}/status", response_model=s.WorkItemOut)
def transition(work_item_id: uuid.UUID, body: s.StatusIn, ctx: Ctx, key: Key):
    item = row_for(ctx, w.WorkItem, work_item_id)
    case = case_access(ctx, item.case_id, manage=True)
    return _scoped(
        ctx,
        case,
        key,
        "work_item.transition",
        work_item_id,
        body,
        s.WorkItemOut,
        lambda: w.transition_work_item(ctx.session, work_item_id, principal_id=ctx.principal.id, status=body.status),
    )


@router.get("/notifications", response_model=list[s.NotificationOut])
def notifications(ctx: Ctx):
    notices = list(
        ctx.session.scalars(select(Notification).where(Notification.recipient_principal_id == ctx.principal.id))
    )
    # A notification's existence does not keep revoked case access alive.
    return [notice for notice in notices if w._assignable(ctx.session, notice.case_id, ctx.principal.id)]


@router.get("/approvals", response_model=list[s.ApprovalOut])
def approvals(ctx: Ctx):
    """当前 Principal 的审批收件箱；拒绝已撤权案件的历史记录。"""
    rows = list(
        ctx.session.scalars(
            select(run_domain.Approval)
            .where(
                run_domain.Approval.approver_principal_id == ctx.principal.id,
                run_domain.Approval.status == "pending",
            )
            .order_by(run_domain.Approval.created_at)
        )
    )
    visible = []
    for approval in rows:
        try:
            case_access(ctx, approval.case_id)
        except Exception:
            continue
        visible.append(approval)
    return visible


@router.post("/notifications/{notification_id}/read", response_model=s.NotificationOut)
def read_notification(notification_id: str, ctx: Ctx, key: Key):
    notice = row_for(ctx, Notification, notification_id)
    if notice.recipient_principal_id != ctx.principal.id or notice.case_id is None:
        raise error(403, "denied", "Notification belongs to another principal")
    case = case_access(ctx, notice.case_id)
    return _scoped(
        ctx,
        case,
        key,
        "notification.read",
        notification_id,
        None,
        s.NotificationOut,
        lambda: w.mark_notification_read(ctx.session, notification_id, principal_id=ctx.principal.id),
    )


@router.post("/cases/{case_id}/materials", response_model=s.MaterialOut, status_code=201)
def create_material(case_id: uuid.UUID, body: s.MaterialIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)
    ref = None
    if body.kind != "url":
        if body.content is None:
            raise error(422, "validation", "content is required for upload/text materials")
        data = body.content.encode()
        ref = object_ref(data, "text/markdown" if body.kind == "text" else "application/octet-stream")
        asyncio.run(_store(get_settings()).put(data, ref.content_type))
    return _scoped(
        ctx,
        case,
        key,
        "material.create",
        case_id,
        body,
        s.MaterialOut,
        lambda: mat.register_material(
            ctx.session,
            case_id,
            principal_id=ctx.principal.id,
            kind=body.kind,
            title=body.title,
            content_ref=ref,
            source_url=body.source_url,
        ),
    )


@router.get("/cases/{case_id}/materials", response_model=list[s.MaterialOut])
def materials(case_id: uuid.UUID, ctx: Ctx, status: str | None = None):
    case_access(ctx, case_id)
    return mat.list_materials(ctx.session, case_id, principal_id=ctx.principal.id, status=status)


@router.post("/materials/{material_id}/archive", response_model=s.MaterialOut)
def archive_material(material_id: uuid.UUID, ctx: Ctx, key: Key):
    material = mat.get_material(ctx.session, material_id, principal_id=ctx.principal.id)
    case = case_access(ctx, material.case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "material.archive",
        material_id,
        None,
        s.MaterialOut,
        lambda: mat.archive_material(ctx.session, material_id, principal_id=ctx.principal.id),
    )


@router.get("/materials/{material_id}/content")
async def material_content(material_id: uuid.UUID, ctx: Ctx):
    material = mat.get_material(ctx.session, material_id, principal_id=ctx.principal.id)
    case_access(ctx, material.case_id)
    if material.content_key is None:
        raise error(404, "not_found", "Material has no stored content")
    try:
        data = await _store(get_settings()).get(material.content_key)
    except Exception as exc:
        raise error(404, "not_found", "Material content is unavailable") from exc
    if len(data) != material.content_size or hashlib.sha256(data).hexdigest() != material.content_sha256:
        raise error(409, "conflict", "Material content digest does not match metadata")
    return Response(content=data, media_type=material.content_type)


@router.post("/materials/{material_id}/anchors", response_model=s.AnchorOut, status_code=201)
def create_anchor(material_id: uuid.UUID, body: s.AnchorIn, ctx: Ctx, key: Key):
    material = mat.get_material(ctx.session, material_id, principal_id=ctx.principal.id)
    case = case_access(ctx, material.case_id, write=True)
    excerpt_ref = None
    if body.excerpt is not None:
        data = body.excerpt.encode()
        excerpt_ref = object_ref(data, "text/markdown")
        asyncio.run(_store(get_settings()).put(data, excerpt_ref.content_type))
    return _scoped(
        ctx,
        case,
        key,
        "material.anchor",
        material_id,
        body,
        s.AnchorOut,
        lambda: mat.add_anchor(
            ctx.session,
            material_id,
            principal_id=ctx.principal.id,
            locator=body.locator,
            excerpt_ref=excerpt_ref,
        ),
    )


@router.get("/materials/{material_id}/anchors", response_model=list[s.AnchorOut])
def anchors(material_id: uuid.UUID, ctx: Ctx):
    material = mat.get_material(ctx.session, material_id, principal_id=ctx.principal.id)
    case_access(ctx, material.case_id)
    return mat.list_anchors(ctx.session, material_id, principal_id=ctx.principal.id)


@router.post("/cases/{case_id}/facts", response_model=s.FactOut, status_code=201)
def create_fact(case_id: uuid.UUID, body: s.FactIn, ctx: Ctx, key: Key):
    case = case_access(ctx, case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "fact.create",
        case_id,
        body,
        s.FactOut,
        lambda: mat.propose_fact(
            ctx.session,
            case_id,
            principal_id=ctx.principal.id,
            statement=body.statement,
            material_id=body.material_id,
            anchor_id=body.anchor_id,
        ),
    )


@router.get("/cases/{case_id}/facts", response_model=list[s.FactOut])
def facts(case_id: uuid.UUID, ctx: Ctx, status: str | None = None):
    case_access(ctx, case_id)
    return mat.list_facts(ctx.session, case_id, principal_id=ctx.principal.id, status=status)


@router.post("/facts/{fact_id}/confirm", response_model=s.FactOut)
def confirm_fact(fact_id: uuid.UUID, ctx: Ctx, key: Key):
    fact = mat.get_fact(ctx.session, fact_id, principal_id=ctx.principal.id)
    case = case_access(ctx, fact.case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "fact.confirm",
        fact_id,
        None,
        s.FactOut,
        lambda: mat.confirm_fact(ctx.session, fact_id, principal_id=ctx.principal.id),
    )


@router.post("/facts/{fact_id}/reject", response_model=s.FactOut)
def reject_fact(fact_id: uuid.UUID, body: s.FactRejectIn, ctx: Ctx, key: Key):
    fact = mat.get_fact(ctx.session, fact_id, principal_id=ctx.principal.id)
    case = case_access(ctx, fact.case_id, write=True)
    return _scoped(
        ctx,
        case,
        key,
        "fact.reject",
        fact_id,
        body,
        s.FactOut,
        lambda: mat.reject_fact(ctx.session, fact_id, principal_id=ctx.principal.id, reason=body.reason),
    )


# ---------------- 编辑器支撑（B12）：AST 解析 + MathML 转换 ----------------

_BOOK_HEADS = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}


def _wrap_book_markdown(book: str, body: str) -> str:
    """单书正文 → 三书合一 content.md 布局（kernel.parse_ast 需 `#` 标题 + `##` 三节齐全）。

    块行号是书相对的；ast.books[book].offset 随包裹布局返回，前端以返回的 content 为基准切块。
    """
    bodies = {"abstract": "", "claims": "", "description": ""}
    bodies[book] = body.strip("\n")
    text = "# 文稿\n"
    for b in ("abstract", "claims", "description"):
        text += f"\n## {_BOOK_HEADS[b]}\n"
        if bodies[b]:
            text += f"\n{bodies[b]}\n"
    return text


@router.post("/documents/{document_id}/ast", response_model=s.DocumentAstOut)
async def document_ast(document_id: uuid.UUID, body: s.DocumentAstIn, ctx: Ctx):
    """文稿 AST（旧编辑器页面移植）：content=None → 解析 current revision；否则按所给单书正文解析。"""
    document, _case = _document(ctx, document_id)
    if body.content is None:
        if document.current_revision_id is None:
            text = ""
        else:
            settings = get_settings()
            if not settings.storage_url:
                raise error(503, "storage_unavailable", "Object storage is not configured")
            revision = row_for(ctx, d.Revision, document.current_revision_id)
            try:
                data = await open_store(
                    settings.storage_url,
                    s3_endpoint_url=settings.s3_endpoint_url,
                    s3_region=settings.s3_region,
                ).get(revision.content_key)
            except Exception as exc:
                raise error(404, "not_found", "Revision content is unavailable") from exc
            text = data.decode("utf-8")
    else:
        text = body.content
    content = _wrap_book_markdown(document.book, text)
    try:
        ast = parse_ast(critic.accept(content))
    except AstError as exc:
        raise error(422, "content", str(exc), detail={"line": exc.line}) from exc
    return {"ast": ast, "content": content}


@router.get("/cases/{case_id}/preflight")
async def case_preflight(case_id: uuid.UUID, ctx: Ctx):
    """案件体检（B13 审阅面板）：三书 current revisions 组装 → parse_ast + preflight.run。

    缺修订的书按空书处理（kernel 容忍空节）；figures/terms 上下文不接（相关规则自跳过）。
    """
    case = case_access(ctx, case_id)
    documents = list(ctx.session.scalars(select(d.Document).where(d.Document.case_id == case_id)))
    books: dict[str, str] = {}
    revision_ids = [doc.current_revision_id for doc in documents if doc.current_revision_id is not None]
    if revision_ids:
        settings = get_settings()
        if not settings.storage_url:
            raise error(503, "storage_unavailable", "Object storage is not configured")
        store = _store(settings)
        for document in documents:
            if document.current_revision_id is None or document.book in books:
                continue
            revision = row_for(ctx, d.Revision, document.current_revision_id)
            try:
                data = await store.get(revision.content_key)
            except Exception as exc:
                raise error(404, "not_found", "Revision content is unavailable") from exc
            books[document.book] = data.decode("utf-8")
    content = (
        f"# {case.title}\n\n## 摘要\n\n{books.get('abstract', '')}\n\n## 权利要求书\n\n"
        f"{books.get('claims', '')}\n\n## 说明书\n\n{books.get('description', '')}\n"
    )
    # 附图域真值 → kernel 设置面（spec_figures 序位 ↔ 图N；abstract_figure 仅作存在性开关）。
    # 否则 ast["figures"] 为空，figures.ref_missing / drawings_unfiled 会对已建附图全误报。
    figure_docs = list(ctx.session.scalars(select(f.FigureDocument).where(f.FigureDocument.case_id == case_id)))
    # spec_figures 序位 = 图号（图N 对应第 N 张）；空洞按位占位以免错位。
    max_fig_no = max((fig.figure_no or 0) for fig in figure_docs) if figure_docs else 0
    settings_overlay = {
        "spec_figures": [(f"fig{i}.png", 15.0) for i in range(1, max_fig_no + 1)],
        "abstract_figure": ("abstract.png", 15.0) if any(fig.figure_no is None for fig in figure_docs) else None,
    }
    try:
        ast = parse_ast(critic.accept(content), settings=settings_overlay)
    except AstError as exc:
        raise error(422, "content", str(exc), detail={"line": exc.line}) from exc
    return preflight.run(ast, settings=settings_overlay)


@router.post("/kernel/mathml", response_model=s.MathmlOut)
def kernel_mathml(body: s.MathmlIn, ctx: Ctx):
    """线性公式 / LaTeX → MathML（旧编辑器公式对话框用；kernel.omml 与 render_docx 同一变换）。"""
    try:
        mathml = to_mathml(body.source)
    except Exception as exc:
        raise error(422, "formula", f"公式无法转换：{exc}") from exc
    return {"mathml": mathml}
