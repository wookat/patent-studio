# -*- coding: utf-8 -*-
"""项目 ACL 与分享链接的数据访问（07 §2/§4.1）。所有函数自己开会话；只在 AUTH=on 下被调用。

W4-B（docs/plan/14）：`SHARE_ROLES` 加 reviewer；`share_out` 带 `accepted_by[]`；
`reviewer_allowed` 是 reviewer 写源文档的服务端校验（§5）：只做字符串比较，不解析 Markdown。
"""
import asyncio
import secrets
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.auth import ROLE_RANK
from app.auth.db import SessionLocal, init_db
from app.auth.models import ProjectAcl, ShareAccept, ShareLink, User
from patent_studio.kernel import critic

SHARE_ROLES = ("viewer", "reviewer", "editor", "agent")

# 末主保护（owner_count + set_role/remove_member）跨会话 check→write，并发可双双过检 ⇒ 0 owner；
# 单 uvicorn 进程内一把 asyncio.Lock 串行化即可
membership_lock = asyncio.Lock()


def utc(dt: datetime | None) -> datetime | None:
    """SQLite 不存时区：读出的 naive 值一律按 UTC 解释。"""
    if dt is None or dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=UTC)


def iso(dt: datetime | None) -> str | None:
    dt = utc(dt)
    return dt.isoformat() if dt is not None else None


def user_brief(user: User) -> dict:
    """头像 / 姓名展示所需的最少字段；avatar_color 空串 = 未选（前端按名派生）。"""
    return {"user_id": str(user.id), "email": user.email, "display_name": user.display_name,
            "avatar_color": user.avatar_color or ""}


def member_out(user: User, role: str) -> dict:
    return {**user_brief(user), "role": role}


async def get_user_brief(user_id: str) -> dict | None:
    """按 id 直查 user 表（不经 ACL）：案卷 owner 可能是无 ACL 行的 superuser / 已移出成员，台账仍要显姓名。
    非法 id / 不存在 ⇒ None。"""
    try:
        uid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return None
    await init_db()
    async with SessionLocal() as s:
        u = await s.get(User, uid)
    return user_brief(u) if u is not None else None


def share_out(link: ShareLink, origin: str, accepted_by: list[dict] | None = None) -> dict:
    return {"token": link.token, "role": link.role, "expires_at": iso(link.expires_at),
            "url": f"{origin}/#/share/{link.token}", "created_at": iso(link.created_at),
            "accepted_by": accepted_by or []}


def _original(text: str) -> str:
    """拒绝全部修订后的「原文」。整行只由 {++…++} / {>>…<<} 组成（reject 后为空）的行是插入行，原文里没有它；
    裸空行不是（reject 后仍是空行但本来就空）。一段插入行两侧都是空行（整块插入，patch.insert_block 会补分隔空行）时，
    随块删去一个空行。文末换行不算内容（编辑器会补 / 追加批注行会吃掉它）。"""
    out = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        orig = critic.reject(line)
        if line and orig == "":
            j = i
            while j < len(lines) and lines[j] and critic.reject(lines[j]) == "":
                j += 1
            if out and out[-1] == "" and j < len(lines) and lines[j] == "":
                j += 1
            i = j
            continue
        out.append(orig)
        i += 1
    return "\n".join(out).rstrip("\n")


def _tokens(text: str) -> Counter:
    return Counter(m.group(0) for m in critic.TOKEN.finditer(text))


def reviewer_allowed(base: str, new: str) -> bool:
    """reviewer 的源文档写入是否只含 CriticMarkup 建议 / 批注（14 §5）：
    original(new) == original(base)（不能直接改字、不能接受他人建议）且
    基线标记多重集 ⊆ 新标记多重集（不能拒绝 / 删除他人建议与批注）。"""
    return _original(new) == _original(base) and not (_tokens(base) - _tokens(new))


def is_expired(link: ShareLink, now: datetime | None = None) -> bool:
    exp = utc(link.expires_at)
    return exp is not None and exp <= (now or datetime.now(UTC))


async def role_for(pid: str, user_id: uuid.UUID) -> str | None:
    await init_db()
    async with SessionLocal() as s:
        return await s.scalar(
            select(ProjectAcl.role).where(ProjectAcl.project_id == pid, ProjectAcl.user_id == user_id))


async def project_ids_for(user_id: uuid.UUID) -> set[str]:
    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(select(ProjectAcl.project_id).where(ProjectAcl.user_id == user_id))
        return set(rows)


async def roles_map_for(user_id: uuid.UUID) -> dict[str, str]:
    """{pid: role} 一次取回——聚合列表逐案判角色用它避免 N+1。"""
    await init_db()
    async with SessionLocal() as s:
        rows = await s.execute(select(ProjectAcl.project_id, ProjectAcl.role).where(ProjectAcl.user_id == user_id))
        return {pid: role for pid, role in rows.all()}


async def members_map_for_pids(pids: list[str]) -> dict[str, list[dict]]:
    """{pid: [member]} 批量版 list_members——聚合列表逐案取协作者会 N+1。组内排序与 list_members 同。"""
    await init_db()
    async with SessionLocal() as s:
        rows = await s.execute(select(User, ProjectAcl.project_id, ProjectAcl.role)
                               .join(ProjectAcl, ProjectAcl.user_id == User.id)
                               .where(ProjectAcl.project_id.in_(pids))
                               .order_by(ProjectAcl.created_at, User.email))
        out: dict[str, list[dict]] = {}
        for u, pid, role in rows.all():
            out.setdefault(pid, []).append(member_out(u, role))
        return out


async def max_role_for(user_id: uuid.UUID) -> str | None:
    """跨案最高角色——机构级共享资源（如全局模板库）的写门槛用它判。"""
    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(select(ProjectAcl.role).where(ProjectAcl.user_id == user_id))
        return max(rows, key=lambda r: ROLE_RANK.get(r, 0), default=None)


async def list_members(pid: str) -> list[dict]:
    await init_db()
    async with SessionLocal() as s:
        rows = await s.execute(select(User, ProjectAcl.role).join(ProjectAcl, ProjectAcl.user_id == User.id)
                               .where(ProjectAcl.project_id == pid).order_by(ProjectAcl.created_at, User.email))
        return [member_out(u, role) for u, role in rows]


async def set_role(pid: str, user_id: uuid.UUID, role: str, *, upgrade_only: bool = False) -> str:
    """upsert 一行 ACL；upgrade_only 时不降低已有更高角色。返回生效角色。

    插入分支并发下可能撞上 UNIQUE(pid,user_id)（如分享领取被前端 StrictMode 双效应提交两次）：
    此时另一请求已写入同一行，回滚后回读既有角色幂等返回，不冒 500。
    """
    await init_db()
    async with SessionLocal() as s:
        row = await s.get(ProjectAcl, (pid, user_id))
        if row is None:
            s.add(ProjectAcl(project_id=pid, user_id=user_id, role=role))
            try:
                await s.commit()
            except IntegrityError:
                await s.rollback()
                existing = await s.get(ProjectAcl, (pid, user_id))
                return existing.role if existing is not None else role
            return role
        if not (upgrade_only and ROLE_RANK[row.role] >= ROLE_RANK[role]):
            row.role = role
        else:
            role = row.role
        await s.commit()
        return role


async def remove_member(pid: str, user_id: uuid.UUID) -> bool:
    """删除成员；返回是否真的删了行。最后一个 owner 由调用方先判。"""
    await init_db()
    async with SessionLocal() as s:
        r = await s.execute(delete(ProjectAcl).where(ProjectAcl.project_id == pid, ProjectAcl.user_id == user_id))
        await s.commit()
        return r.rowcount > 0


async def owner_count(pid: str) -> int:
    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(
            select(ProjectAcl.user_id).where(ProjectAcl.project_id == pid, ProjectAcl.role == "owner"))
        return len(list(rows))


async def user_by_email(email: str) -> User | None:
    await init_db()
    async with SessionLocal() as s:
        return await s.scalar(select(User).where(User.email == email.strip().lower()))


async def list_share_links(pid: str) -> list[ShareLink]:
    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(select(ShareLink).where(ShareLink.project_id == pid).order_by(ShareLink.created_at))
        return list(rows)


async def create_share_link(pid: str, role: str, expires_in_days: int | None, created_by: uuid.UUID) -> ShareLink:
    await init_db()
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    link = ShareLink(token=secrets.token_urlsafe(24), project_id=pid, role=role, expires_at=expires_at,
                     created_by=created_by)
    async with SessionLocal() as s:
        s.add(link)
        await s.commit()
        await s.refresh(link)
        return link


async def get_share_link(token: str) -> ShareLink | None:
    await init_db()
    async with SessionLocal() as s:
        return await s.get(ShareLink, token)


async def record_share_accept(token: str, user_id: uuid.UUID) -> None:
    """领取链接：同一人重复领取只保留首次。并发下首查可能都见空（StrictMode 双发），插入撞
    UNIQUE(token,user_id) 时回滚幂等返回——另一请求已写入同一行。"""
    await init_db()
    async with SessionLocal() as s:
        if await s.get(ShareAccept, (token, user_id)) is None:
            s.add(ShareAccept(token=token, user_id=user_id))
            try:
                await s.commit()
            except IntegrityError:
                await s.rollback()


async def accepted_by(pid: str) -> dict[str, list[dict]]:
    """token → [{user_id, email, display_name, accepted_at}]，按领取时间排序。"""
    await init_db()
    async with SessionLocal() as s:
        rows = await s.execute(
            select(ShareAccept, User).join(User, User.id == ShareAccept.user_id)
            .join(ShareLink, ShareLink.token == ShareAccept.token)
            .where(ShareLink.project_id == pid).order_by(ShareAccept.accepted_at))
        out: dict[str, list[dict]] = {}
        for acc, u in rows:
            out.setdefault(acc.token, []).append({**user_brief(u), "accepted_at": iso(acc.accepted_at)})
        return out


async def share_links_out(pid: str, origin: str) -> list[dict]:
    accepts = await accepted_by(pid)
    return [share_out(link, origin, accepts.get(link.token)) for link in await list_share_links(pid)]


async def delete_share_link(pid: str, token: str) -> bool:
    await init_db()
    async with SessionLocal() as s:
        r = await s.execute(delete(ShareLink).where(ShareLink.project_id == pid, ShareLink.token == token))
        await s.commit()
        return r.rowcount > 0
