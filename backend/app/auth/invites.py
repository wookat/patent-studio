# -*- coding: utf-8 -*-
"""邮箱邀请 pending（docs/plan/14 §2 / §4 / D6 / D7）。main.py 注册 router；db.UserManager 注册 / 登录钩子调 consume。

- 邮箱一律 `strip().lower()`；role ∈ acl.SHARE_ROLES（不允许 owner）。
- POST：邮箱已注册 ⇒ 直接 acl.set_role 并返回 200 {member}；否则 upsert pending_invites 返回 201 Invite。
- consume(email, user_id)：对该邮箱的每条 pending：acl.set_role(pid, uid, role, upgrade_only=True) → 删行。
- create_pending 供 router.set_member（PUT /members 邮箱未注册分支）调用。
- 本模块在 AUTH=off 下也被 import（router 常驻），acl / db 只在函数内惰性 import；off ⇒ 501。
"""

import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app import config
from app.auth import CurrentUser
from app.domain import events
from app.errors import error_detail, not_implemented

UNIT = "B2-reviewer-invites"
_OFF = "账号未开启（PATENT_STUDIO_AUTH=off）"
router = APIRouter(prefix="/api/projects/{pid}")


class InviteIn(BaseModel):
    email: str
    role: str


class InviteRoleIn(BaseModel):
    role: str


def _norm(email: str) -> str:
    return email.strip().lower()


def invite_out(row) -> dict:
    """PendingInvite → {email, role, invited_by, created_at}。"""
    from app.auth.acl import iso

    return {"email": row.email, "role": row.role, "invited_by": str(row.invited_by), "created_at": iso(row.created_at)}


async def list_pending(pid: str) -> list[dict]:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite

    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(
            select(PendingInvite)
            .where(PendingInvite.project_id == pid)
            .order_by(PendingInvite.created_at, PendingInvite.email)
        )
        return [invite_out(r) for r in rows]


async def create_pending(pid: str, email: str, role: str, invited_by: uuid.UUID) -> dict:
    """upsert：同一邮箱再邀一次 ⇒ 覆盖角色与邀请人。"""
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite

    await init_db()
    async with SessionLocal() as s:
        row = await s.get(PendingInvite, (pid, _norm(email)))
        if row is None:
            row = PendingInvite(project_id=pid, email=_norm(email), role=role, invited_by=invited_by)
            s.add(row)
            try:
                await s.commit()
            except IntegrityError:
                # 并发同邮箱首邀：另一请求已写 PK——回滚后按已存在行走 upsert 分支（同 record_share_accept）
                await s.rollback()
                row = await s.get(PendingInvite, (pid, _norm(email)))
                if row is None:
                    raise
                row.role, row.invited_by = role, invited_by
                await s.commit()
        else:
            row.role, row.invited_by = role, invited_by
            await s.commit()
        await s.refresh(row)
        return invite_out(row)


async def set_pending_role(pid: str, email: str, role: str) -> dict | None:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite

    await init_db()
    async with SessionLocal() as s:
        row = await s.get(PendingInvite, (pid, _norm(email)))
        if row is None:
            return None
        row.role = role
        await s.commit()
        await s.refresh(row)
        return invite_out(row)


async def delete_pending(pid: str, email: str) -> bool:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite

    await init_db()
    async with SessionLocal() as s:
        r = await s.execute(
            delete(PendingInvite).where(PendingInvite.project_id == pid, PendingInvite.email == _norm(email))
        )
        await s.commit()
        return r.rowcount > 0


async def consume(email: str, user_id: uuid.UUID) -> None:
    """被邀邮箱注册 / 登录 ⇒ 该邮箱的全部 pending 变成 ACL 行（不降低已有更高角色）并删除。"""
    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite

    await init_db()
    async with SessionLocal() as s:
        rows = list(await s.scalars(select(PendingInvite).where(PendingInvite.email == _norm(email))))
    for row in rows:
        await acl.set_role(row.project_id, user_id, row.role, upgrade_only=True)
        await delete_pending(row.project_id, row.email)


def _check_on() -> None:
    if not config.AUTH_ON:
        raise not_implemented(UNIT, _OFF)


def _check_role(role: str) -> None:
    from app.auth import acl

    if role not in acl.SHARE_ROLES:
        raise HTTPException(422, error_detail("validation", "邀请角色只能是 viewer / reviewer / editor / agent"))


@router.get("/invites")
async def list_invites(pid: str):
    _check_on()
    return await list_pending(pid)


@router.post("/invites", status_code=201)
async def create_invite(pid: str, body: InviteIn, user: CurrentUser):
    _check_on()
    _check_role(body.role)
    from app.auth import acl

    target = await acl.user_by_email(body.email)
    if target is None:
        return await create_pending(pid, body.email, body.role, user.id)
    async with acl.membership_lock:  # 与 router 成员端点共享一把锁：末主检查与写入同临界区
        if await acl.role_for(pid, target.id) == "owner" and await acl.owner_count(pid) <= 1:
            raise HTTPException(409, error_detail("conflict", "案子至少保留一个所有者"))
        role = await acl.set_role(pid, target.id, body.role)
    # 已注册邮箱邀请即真实成员变更：与 PUT /members 同事件（通知被变更者 + 审计）
    events.emit(
        "member.changed",
        pid=pid,
        actor=events.actor_of(user),
        data={"user_id": str(target.id), "role": role, "email": target.email},
    )
    return JSONResponse({"member": acl.member_out(target, role)}, status_code=200)


@router.put("/invites/{email}")
async def set_invite_role(pid: str, email: str, body: InviteRoleIn):
    _check_on()
    _check_role(body.role)
    out = await set_pending_role(pid, email, body.role)
    if out is None:
        raise HTTPException(404, error_detail("not_found", "邀请不存在或已被接受"))
    return out


@router.delete("/invites/{email}")
async def revoke_invite(pid: str, email: str):
    _check_on()
    if not await delete_pending(pid, email):
        raise HTTPException(404, error_detail("not_found", "邀请不存在或已被接受"))
    return await list_pending(pid)
