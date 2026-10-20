"""Session identity, transaction boundary, relation policy and command replay."""

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy import create_engine, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from patent_studio.domain import agents as agent_domain
from patent_studio.domain import authorization as az
from patent_studio.domain import documents as docs
from patent_studio.domain import methods as methods_domain
from patent_studio.domain.collab import SubmissionBarrierError
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.operations import Operation, OutboxEvent, append_outbox_event, transition_operation
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import object_ref
from patent_studio.settings import get_settings


def error(status: int, kind: str, message: str, detail=None) -> HTTPException:
    return HTTPException(status, {"kind": kind, "message": message, "line": None, "detail": detail})


class DomainRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def mapped(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Never echo request values (they may contain credentials or private content).
                raise error(
                    422,
                    "validation",
                    "Invalid request",
                    [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()],
                ) from exc
            except SubmissionBarrierError as exc:
                raise error(409, "submission_barrier", "Submission barrier blocked", list(exc.reasons)) from exc
            except IntegrityError as exc:
                raise error(409, "conflict", "Database constraint rejected the change") from exc
            except (docs.DocumentError, az.AuthorizationError, ValueError) as exc:
                name = type(exc).__name__
                if "NotFound" in name:
                    status, kind = 404, "not_found"
                elif "Authorization" in name or name == "AuthorizationError":
                    status, kind = 403, "denied"
                elif "Conflict" in name or "StateError" in name or "Immutable" in name:
                    status, kind = 409, "conflict"
                else:
                    status, kind = 422, "validation"
                raise error(status, kind, str(exc)) from exc
            except methods_domain.MethodLibraryError as exc:
                # 消息前缀即错误类（"denied: …"/"not_found: …"），不回显输入
                kind, _, msg = str(exc).partition(": ")
                status = {"denied": 403, "not_found": 404}.get(kind, 422)
                raise error(status, kind if status != 422 else "validation", msg or str(exc)) from exc

        return mapped


async def subject(request: Request):
    # Resolve dynamically: the existing auth module can be reloaded by test/dev mode switches.
    # May return None; `transaction` decides whether a bearer credential authenticates instead.
    from patent_studio.infra import auth

    return await auth.current_user(request)


Subject = Depends(subject)
CurrentUser = Annotated[User | None, Depends(subject)]


@dataclass
class Context:
    session: Session
    principal: Principal
    agent_token: agent_domain.AgentAccessToken | None = None

    @property
    def revision_source(self) -> str:
        return "agent" if self.principal.kind == "agent" else "manual"


def _bearer_agent_token(request: Request) -> str | None:
    scheme, _, raw = request.headers.get("authorization", "").partition(" ")
    return raw if scheme.lower() == "bearer" and raw.startswith("agt_") else None


def _enforce_token_scope(ctx: Context, *, organization_id: uuid.UUID, case_id: uuid.UUID | None = None) -> None:
    token = ctx.agent_token
    if token is None:
        return
    if token.organization_id is not None and token.organization_id != organization_id:
        raise error(403, "denied", "Agent token scope does not cover this organization")
    if case_id is not None and token.case_id is not None and token.case_id != case_id:
        raise error(403, "denied", "Agent token scope does not cover this case")


def transaction(request: Request, user=Subject):
    raw_token = _bearer_agent_token(request)
    if raw_token is None and user is None:
        raise error(401, "auth", "An authenticated database user is required")
    url = get_settings().database_url
    if not url:
        raise error(503, "database_unavailable", "PostgreSQL is not configured")
    engine = create_engine(database_url(url), poolclass=NullPool, hide_parameters=True)
    try:
        with Session(engine, expire_on_commit=False) as session, session.begin():
            if raw_token is not None:
                try:
                    token = agent_domain.authenticate_agent_token(session, raw_token)
                except agent_domain.AgentError as exc:
                    raise error(401, "auth", "Invalid agent bearer token") from exc
                yield Context(session, session.get(Principal, token.principal_id), token)
                return
            active = session.get(User, user.id)
            if active is None or not active.is_active:
                raise error(401, "auth", "Session user is inactive or missing")
            principal = session.scalar(select(Principal).where(Principal.user_id == active.id))
            if principal is None:
                session.execute(
                    insert(Principal)
                    .values(
                        id=uuid.uuid4(),
                        kind="human",
                        user_id=active.id,
                        display_name=active.display_name or "User",
                    )
                    .on_conflict_do_nothing(index_elements=[Principal.user_id])
                )
                principal = session.scalar(select(Principal).where(Principal.user_id == active.id))
            assert principal is not None
            yield Context(session, principal)
    finally:
        engine.dispose()


Ctx = Annotated[Context, Depends(transaction)]


def org_access(ctx: Context, organization_id: uuid.UUID, *, manage=False) -> Organization:
    org = ctx.session.get(Organization, organization_id)
    if org is None:
        raise error(404, "not_found", "Organization does not exist")
    membership = ctx.session.get(OrganizationMembership, (org.id, ctx.principal.id))
    _enforce_token_scope(ctx, organization_id=org.id)
    if org.status != "active" or membership is None or membership.status != "active":
        raise error(403, "denied", "Active organization membership required")
    if manage and membership.role not in {"owner", "admin"}:
        raise error(403, "denied", "Organization management permission required")
    return org


def case_access(ctx: Context, case_id: uuid.UUID, *, write=False, manage=False) -> Case:
    case = docs._ensure_case_access(ctx.session, case_id, ctx.principal.id)
    _enforce_token_scope(ctx, organization_id=case.organization_id, case_id=case.id)
    org = ctx.session.get(Organization, case.organization_id)
    if org is None or org.status != "active":
        raise error(403, "denied", "Organization is inactive")
    if write or manage:
        member = ctx.session.get(OrganizationMembership, (case.organization_id, ctx.principal.id))
        allowed_org = member is not None and member.status == "active" and member.role in {"owner", "admin"}
        roles = {"attorney", "case_manager"} if manage else {"attorney", "case_manager", "drafter", "author"}
        role = ctx.session.scalar(
            select(CaseParticipant.role).where(
                CaseParticipant.case_id == case_id,
                CaseParticipant.principal_id == ctx.principal.id,
                CaseParticipant.status == "active",
                CaseParticipant.role.in_(roles),
            )
        )
        if not allowed_org and role is None:
            raise error(403, "denied", "Case write permission required")
    return case


def row_for(ctx: Context, model, row_id):
    row = ctx.session.get(model, row_id)
    if row is None:
        raise error(404, "not_found", "Resource does not exist")
    return row


def command(
    ctx: Context,
    key: str,
    command_type: str,
    target: str,
    payload: BaseModel | None,
    response_model,
    action: Callable,
):
    """Serialize an idempotency key even before its row exists; replay the original DTO.

    action returns (domain value, organization_id, case_id). Its authorization is checked
    by each route before calling this function. Business write/result/outbox are atomic.
    """
    session = ctx.session
    if not key.strip() or len(key) > 128:
        raise error(422, "validation", "Idempotency-Key must contain 1–128 characters")
    ref = object_ref(
        json.dumps(
            {
                "type": command_type,
                "target": target,
                "payload": payload.model_dump(mode="json") if payload else None,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode(),
        "application/json",
    )
    session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})
    existing = session.scalar(select(Operation).where(Operation.operation_id == key))
    if existing is not None:
        if (
            existing.principal_id != ctx.principal.id
            or existing.operation_type != command_type
            or (existing.payload_sha256 is not None and existing.payload_sha256 != ref.sha256)
        ):
            raise error(409, "conflict", "Idempotency-Key is bound to another request")
        case_access(ctx, existing.case_id) if existing.case_id else org_access(ctx, existing.organization_id)
        event = session.scalar(select(OutboxEvent).where(OutboxEvent.operation_id == existing.id))
        if existing.status != "succeeded" or event is None or "response" not in (event.payload_json or {}):
            raise error(409, "conflict", "Operation has no completed REST result")
        return response_model.model_validate(event.payload_json["response"])
    value, organization_id, case_id = action()
    response = response_model.model_validate(value)
    operation = session.scalar(select(Operation).where(Operation.operation_id == key))
    if operation is None:
        operation = Operation(
            operation_id=key,
            operation_type=command_type,
            principal_id=ctx.principal.id,
            organization_id=organization_id,
            case_id=case_id,
            status="pending",
        )
        session.add(operation)
        session.flush()
    if operation.status == "pending":
        transition_operation(session, key, "running")
        transition_operation(session, key, "succeeded")
    elif operation.status != "succeeded":
        raise error(409, "conflict", "Operation is not executable")
    operation.payload_key, operation.payload_sha256 = ref.key, ref.sha256
    operation.payload_size, operation.payload_type = ref.size, ref.content_type
    event = session.scalar(select(OutboxEvent).where(OutboxEvent.operation_id == operation.id))
    result = {"response": response.model_dump(mode="json")}
    if event is None:
        append_outbox_event(session, key, event_type=command_type, payload_json=result)
    else:
        event.payload_json = {**(event.payload_json or {}), **result}
    session.flush()
    return response
