"""平台 /api/v1 REST 路由。B3 批落地：组织 / 成员 / 邀请 / 案件 / 案件参与者；
documents、proposals、releases、materials、runs 等域面随后续批次并入本文件。"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header
from sqlalchemy import select

from patent_studio.api import schemas as s
from patent_studio.api.dependencies import Ctx, DomainRoute, case_access, command, error, org_access, row_for
from patent_studio.domain import authorization as az
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership

router = APIRouter(
    prefix="/api/v1",
    tags=["Platform"],
    route_class=DomainRoute,
    responses={code: {"model": s.ErrorResponse} for code in (401, 403, 404, 409, 422, 503)},
)
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


def _scoped(ctx, case, key, kind, target, body, model, action):
    return command(ctx, key, kind, str(target), body, model, lambda: (action(), case.organization_id, case.id))


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
