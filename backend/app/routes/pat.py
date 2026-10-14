# -*- coding: utf-8 -*-
"""PAT 管理与审计读取（docs/plan/10 §3.4–3.5，单元 F1-mcp-server）。

/api/pat*：AUTH=off 时 501（off 模式 MCP 只允许本机、无需令牌，与 R6 账号路由 off 时 501 的约定一致）；
AUTH=on 时查/建/撤销当前用户自己的 personal_access_token：明文 pat_ + 32 hex 只在 POST 响应里出现一次，库中只存 sha256。
/api/projects/{pid}/audit：读 .studio/audit.jsonl（最新在前）。
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import config
from app.auth import CurrentUser, acl, login_required
from app.errors import error_detail, not_implemented
from app.mcp import audit
from app.mcp.auth import new_token, token_hash

router = APIRouter(prefix="/api", tags=["pat"])
UNIT = "F1-mcp-server"
_OFF = "AUTH=off 时不需要 PAT；MCP 只允许本机连接"


class PatCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


def _unavailable():
    return not_implemented(UNIT, _OFF)


def _out(pat) -> dict:
    return {
        "id": pat.id,
        "name": pat.name,
        "prefix": pat.prefix,
        "created_at": acl.iso(pat.created_at),
        "last_used_at": acl.iso(pat.last_used_at),
    }


async def _ready(user):
    """AUTH=on 且已登录 → (SessionLocal, PersonalAccessToken)。models/db 只在 on 时导入（与 app.auth 约定一致）。"""
    if not config.AUTH_ON:
        raise _unavailable()
    if user is None:
        raise login_required()
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PersonalAccessToken

    await init_db()
    return SessionLocal, PersonalAccessToken


@router.get("/pat")
async def list_pats(user: CurrentUser):
    SessionLocal, PersonalAccessToken = await _ready(user)
    async with SessionLocal() as s:
        rows = await s.scalars(
            select(PersonalAccessToken)
            .where(PersonalAccessToken.user_id == user.id, PersonalAccessToken.revoked_at.is_(None))
            .order_by(PersonalAccessToken.created_at)
        )
        return [_out(p) for p in rows]


@router.post("/pat", status_code=201)
async def create_pat(body: PatCreateIn, user: CurrentUser):
    SessionLocal, PersonalAccessToken = await _ready(user)
    token = new_token()
    pat = PersonalAccessToken(
        id=uuid.uuid4().hex,
        user_id=user.id,
        name=body.name.strip(),
        prefix=token[:12],
        token_hash=token_hash(token),
        created_at=datetime.now(UTC),
    )
    async with SessionLocal() as s:
        s.add(pat)
        await s.commit()
        await s.refresh(pat)
        return {**_out(pat), "token": token}


@router.delete("/pat/{pat_id}", status_code=204)
async def revoke_pat(pat_id: str, user: CurrentUser):
    SessionLocal, PersonalAccessToken = await _ready(user)
    async with SessionLocal() as s:
        pat = await s.scalar(
            select(PersonalAccessToken).where(PersonalAccessToken.id == pat_id, PersonalAccessToken.user_id == user.id)
        )
        if pat is None:
            raise HTTPException(404, error_detail("not_found", f"PAT 不存在：{pat_id}"))
        if pat.revoked_at is None:
            pat.revoked_at = datetime.now(UTC)
            await s.commit()


@router.get("/projects/{pid}/audit")
async def project_audit(pid: str, request: Request, limit: int = 50):
    project = request.app.state.store.get(pid)
    return audit.tail(project.dir, limit)
