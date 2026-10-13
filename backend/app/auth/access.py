# -*- coding: utf-8 -*-
"""访问记录与协作设置的数据层（docs/plan/14 §2.1 / §2.2 / D8）。B1-access-log 所有。

- touch：打开工作台（GET /projects/{pid}）/ 领取分享链接时 upsert project_access。
  存在行且 now - last_seen < ACCESS_DEBOUNCE ⇒ 只更新 last_seen；否则 count+1；无行 ⇒ 新建 count=1。
- list_access：viewed = project_access JOIN user，online = str(user_id) in collab.rooms.online_user_ids(pid)；
  not_viewed = 成员 ∪ share_accepts 领取人 ∪ pending_invites 中无 project_access 行者（via = member | link | invite）。
- settings：缺行 ⇒ DEFAULT_SETTINGS；put 合并部分字段。

db / acl 在函数内 import：与 auth/__init__.py 同理——AUTH=off 时不加载 fastapi-users / engine，
且测试按新 DB_PATH 重载时会丢弃 app.auth.db / acl 再 import，模块级绑定会指向旧库。
"""
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.collab import rooms

ACCESS_DEBOUNCE = timedelta(minutes=30)
DEFAULT_SETTINGS = {"allow_download": True, "allow_copy": True, "allow_comment": True}


async def touch(pid: str, user) -> None:
    """打开工作台 / 领取链接：upsert project_access（30 分钟去抖）。"""
    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import ProjectAccess

    await init_db()
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        row = await s.get(ProjectAccess, (pid, user.id))
        if row is None:
            s.add(ProjectAccess(project_id=pid, user_id=user.id, first_seen=now, last_seen=now, count=1))
            try:
                await s.commit()
            except IntegrityError:
                # 并发首看同案同人：另一请求已写 PK——回滚后落到既有行更新（同 record_share_accept）
                await s.rollback()
                row = await s.get(ProjectAccess, (pid, user.id))
                if row is not None:
                    row.last_seen = now
                    await s.commit()
            return
        if now - acl.utc(row.last_seen) >= ACCESS_DEBOUNCE:
            row.count += 1
        row.last_seen = now
        await s.commit()


async def last_seen_by_user(pid: str) -> dict[str, str]:
    """{user_id: last_seen ISO}：面板协作者头像的「最近访问」（不含 count / not_viewed，那是 list_access 的事）。"""
    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import ProjectAccess

    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(select(ProjectAccess).where(ProjectAccess.project_id == pid))
        return {str(r.user_id): acl.iso(r.last_seen) for r in rows}


async def last_seen_for_pids(pids: list[str]) -> dict[str, dict[str, str]]:
    """{pid: {user_id: last_seen ISO}} 批量版——聚合列表逐案取会 N+1。"""
    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import ProjectAccess

    await init_db()
    async with SessionLocal() as s:
        rows = await s.scalars(select(ProjectAccess).where(ProjectAccess.project_id.in_(pids)))
        out: dict[str, dict[str, str]] = {}
        for r in rows:
            out.setdefault(r.project_id, {})[str(r.user_id)] = acl.iso(r.last_seen)
        return out


async def list_access(pid: str) -> dict:
    """→ {viewed: [{user, first_seen, last_seen, count, online}], not_viewed: [{user|null, email, via}]}"""
    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import PendingInvite, ProjectAccess, User

    await init_db()
    members = {m["user_id"]: m for m in await acl.list_members(pid)}
    online = rooms.online_user_ids(pid)
    async with SessionLocal() as s:
        rows = await s.execute(select(ProjectAccess, User).join(User, User.id == ProjectAccess.user_id)
                               .where(ProjectAccess.project_id == pid).order_by(ProjectAccess.last_seen.desc()))
        viewed = []
        for acc, u in rows:
            uid = str(u.id)
            role = members[uid]["role"] if uid in members else ("owner" if u.is_superuser else None)
            viewed.append({"user": acl.member_out(u, role), "first_seen": acl.iso(acc.first_seen),
                           "last_seen": acl.iso(acc.last_seen), "count": acc.count, "online": uid in online})
        pending = list(await s.scalars(select(PendingInvite).where(PendingInvite.project_id == pid)
                                       .order_by(PendingInvite.created_at)))
    seen = {row["user"]["user_id"] for row in viewed}
    not_viewed = [{"user": m, "email": m["email"], "via": "member"} for m in members.values()
                  if m["user_id"] not in seen]
    seen |= set(members)
    for accepted in (await acl.accepted_by(pid)).values():
        for a in accepted:
            if a["user_id"] not in seen:
                seen.add(a["user_id"])
                user = {k: a[k] for k in ("user_id", "email", "display_name", "avatar_color")} | {"role": None}
                not_viewed.append({"user": user, "email": a["email"], "via": "link"})
    not_viewed += [{"user": None, "email": p.email, "via": "invite"} for p in pending]
    return {"viewed": viewed, "not_viewed": not_viewed}


async def get_settings(pid: str) -> dict:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import ProjectCollabSettings

    await init_db()
    async with SessionLocal() as s:
        return _settings_out(await s.get(ProjectCollabSettings, pid))


async def put_settings(pid: str, patch: dict) -> dict:
    """合并 patch 中非 None 的字段；缺行则以默认值建行。"""
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import ProjectCollabSettings

    await init_db()
    async with SessionLocal() as s:
        row = await s.get(ProjectCollabSettings, pid)
        if row is None:
            row = ProjectCollabSettings(project_id=pid, **DEFAULT_SETTINGS)
            s.add(row)
            try:
                await s.flush()
            except IntegrityError:
                await s.rollback()
                row = await s.get(ProjectCollabSettings, pid)
                assert row is not None
        if patch.get("allow_download") is not None:
            row.allow_download = patch["allow_download"]
        if patch.get("allow_copy") is not None:
            row.allow_copy = patch["allow_copy"]
        if patch.get("allow_comment") is not None:
            row.allow_comment = patch["allow_comment"]
        await s.commit()
        return _settings_out(row)


def _settings_out(row) -> dict:
    if row is None:
        return dict(DEFAULT_SETTINGS)
    return {"allow_download": row.allow_download, "allow_copy": row.allow_copy, "allow_comment": row.allow_comment}
