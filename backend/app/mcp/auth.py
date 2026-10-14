# -*- coding: utf-8 -*-
"""MCP 身份：PAT（Authorization: Bearer pat_…）或本机（AUTH=off）。docs/plan/10 §3.3。

PatGate 是包在 Streamable HTTP ASGI 端点外的一层：解析身份、放进 CURRENT_ACTOR，
工具函数里 CURRENT_ACTOR.get() 取"谁在调用"。拒绝时直接回 JSON，形状 = app.errors.error_detail。
"""
import hashlib
import json
import secrets
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime

from app import config
from app.errors import error_detail

PAT_PREFIX = "pat_"
LOCAL_HOSTS = {"127.0.0.1", "::1"}  # client_host 是连接 IP，恒为地址字面量


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    user_id: str | None = None  # AUTH=on 时为 User.id；本机身份为 None
    superuser: bool = False


LOCAL = Actor(id="local", name="local")
CURRENT_ACTOR: ContextVar[Actor | None] = ContextVar("mcp_actor", default=None)


def new_token() -> str:
    return PAT_PREFIX + secrets.token_hex(16)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def verify_pat(token: str) -> Actor | None:
    """查 personal_access_token（sha256 摘要匹配、未撤销）→ Actor(user_id=…)，并更新 last_used_at。
    AUTH=off 无表 → None。"""
    if not config.AUTH_ON:
        return None
    from sqlalchemy import select

    from app.auth.db import SessionLocal, init_db
    from patent_studio.domain.identity import PersonalAccessToken, User

    await init_db()
    async with SessionLocal() as s:
        row = (await s.execute(
            select(PersonalAccessToken, User).join(User, User.id == PersonalAccessToken.user_id)
            .where(PersonalAccessToken.token_hash == token_hash(token), PersonalAccessToken.revoked_at.is_(None),
                   User.is_active.is_(True)))
        ).first()
        if row is None:
            return None
        pat, user = row
        pat.last_used_at = datetime.now(UTC)
        await s.commit()
        return Actor(id=pat.id, name=user.display_name or user.email, user_id=str(user.id),
                     superuser=bool(user.is_superuser))


def bearer_token(headers) -> str | None:
    for k, v in headers:
        if k == b"authorization":
            value = v.decode("latin-1")
            if value.lower().startswith("bearer "):
                return value[7:].strip()
            return None
    return None


async def resolve_actor(token: str | None, client_host: str | None) -> tuple[Actor | None, int, str]:
    """(actor, status, message)：actor 为 None 时 status/message 描述拒绝原因。"""
    if token is not None:
        if not token.startswith(PAT_PREFIX):
            return None, 401, "令牌须以 pat_ 开头"
        actor = await verify_pat(token)
        return (actor, 200, "") if actor else (None, 401, "PAT 无效或已撤销")
    if config.AUTH_ON:
        return None, 401, "需要 Authorization: Bearer pat_…"
    if client_host not in LOCAL_HOSTS:
        return None, 403, "PATENT_STUDIO_AUTH=off 时 MCP 只允许本机连接"
    return LOCAL, 200, ""


class PatGate:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        actor, status, message = await resolve_actor(
            bearer_token(scope.get("headers", ())), client[0] if client else None)
        if actor is None:
            # kind "unauthorized" 是 MCP 对外契约（test_mcp 锁定；REST 侧 401 用 "auth"）——刻意保留
            body = json.dumps({"detail": error_detail(
                "unauthorized" if status == 401 else "forbidden", message, detail="F1-mcp-server")},
                ensure_ascii=False).encode()
            await send({"type": "http.response.start", "status": status,
                        "headers": [(b"content-type", b"application/json; charset=utf-8"),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        token = CURRENT_ACTOR.set(actor)
        try:
            await self.app(scope, receive, send)
        finally:
            CURRENT_ACTOR.reset(token)
