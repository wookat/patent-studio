# -*- coding: utf-8 -*-
"""机构管理面工具（批3-C）：成员/机构名/机构设置/机构审计——全部仅 AUTH=on 超管。

权限闸：`require_admin`（未启用账号体系 → unavailable；非超管 → forbidden:superuser）。
审计：org 级写 <projects>/.studio/audit.jsonl（tools_lifecycle 同款 _run_org 口径）。
web 聊天经 chat 确认卡执行；update_org_member 在 DOUBLE_CONFIRM_TOOLS 里要两轮确认。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from mcp.server.mcpserver.exceptions import ToolError

from app import config
from app.domain import events, org, org_audit
from app.mcp import audit
from app.mcp.tools import _err, actor


def _org_dir() -> str:
    """org 审计目录按当前 config.PROJECTS_DIR 现取（测试 reload 后不重绑旧路径）。"""
    import os

    return os.path.join(config.PROJECTS_DIR, ".studio")


async def _run_org(tool, args, fn, result_of=lambda _r: "ok"):
    """run_audited 的 org 版：审计目录固定为 PROJECTS_DIR/.studio（tools_lifecycle 同口径）。"""
    import anyio

    try:
        result = await anyio.to_thread.run_sync(fn)
    except Exception as e:
        from app.mcp.tools import _BUSINESS, _detail_of

        if isinstance(e, _BUSINESS):
            detail = _detail_of(e)
        elif isinstance(e, ToolError):
            audit.record(_org_dir(), actor().name, tool, args, "error:" + json.loads(str(e))["kind"])
            raise
        else:
            raise
        audit.record(_org_dir(), actor().name, tool, args, f"error:{detail.kind}")
        raise ToolError(json.dumps(detail.model_dump(), ensure_ascii=False)) from e
    audit.record(_org_dir(), actor().name, tool, args, result_of(result))
    return result


def _require_admin() -> None:
    """账号体系未启用 → unavailable；非超管 → forbidden(superuser)。"""
    if not config.AUTH_ON:
        raise _err("unavailable", "未启用账号体系（AUTH=off）", detail="auth_off")
    if not actor().superuser:
        raise _err("forbidden", "机构管理仅机构管理员可用", detail="superuser")


def _db(fn):
    """在 SessionLocal 里跑协程体；run_audited 线程内无 loop → asyncio.run。"""
    from app.auth.db import SessionLocal, init_db

    async def inner():
        await init_db()
        async with SessionLocal() as s:
            return await fn(s)

    return asyncio.run(inner())


def _member_out(u) -> dict[str, Any]:
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "title": u.title,
        "is_active": u.is_active,
        "is_superuser": u.is_superuser,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
    }


def register(server, store):
    @server.tool()
    async def list_org_members() -> list[dict[str, Any]]:
        """机构成员表（含禁用；最近登录倒序）——仅超管。"""
        _require_admin()
        from sqlalchemy import select

        from app.auth.models import User

        async def body(s):
            rows = (await s.execute(select(User))).scalars().all()
            rows.sort(
                key=lambda u: (u.last_login_at is None, -u.last_login_at.timestamp() if u.last_login_at else 0, u.email)
            )
            return [_member_out(u) for u in rows]

        return await _run_org("list_org_members", {}, lambda: _db(body))

    @server.tool()
    async def update_org_member(
        user_id: str, is_active: bool | None = None, is_superuser: bool | None = None, title: str | None = None
    ) -> dict[str, Any]:
        """改成员状态/超管旗/头衔——仅超管；高危（前端双确认卡）。
        防呆：不能改自己降级/禁用；机构至少留一位可用超管。"""
        _require_admin()
        import uuid

        from sqlalchemy import func, select

        from app.auth.models import User

        try:
            uid = uuid.UUID(user_id)
        except ValueError as e:
            raise _err("not_found", "成员不存在") from e
        if title is not None and len(title.strip()) > 32:
            raise _err("validation", "头衔不能超过 32 字")

        async def body(s):
            target = await s.get(User, uid)
            if target is None:
                raise _err("not_found", "成员不存在")
            demote = is_active is False or is_superuser is False
            if demote and actor().user_id and str(target.id) == actor().user_id:
                raise _err("conflict", "不能禁用或降级自己；请让另一位管理员操作")
            if demote and target.is_superuser and target.is_active:
                others = await s.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.is_superuser.is_(True), User.is_active.is_(True), User.id != target.id)
                )
                if not others:
                    raise _err("conflict", "机构至少保留一位可用的管理员")
            changes: dict = {}
            if is_active is not None:
                target.is_active = is_active
                changes["is_active"] = is_active
            if is_superuser is not None:
                target.is_superuser = is_superuser
                changes["is_superuser"] = is_superuser
            if title is not None:
                target.title = title.strip()
                changes["title"] = target.title
            await s.commit()
            await s.refresh(target)
            if changes:
                who = actor()
                events.emit(
                    "admin.user",
                    pid=None,
                    actor={"id": who.user_id or who.id, "display_name": who.name},
                    data={"user_id": str(target.id), "email": target.email, "changes": changes},
                )
            return _member_out(target)

        return await _run_org(
            "update_org_member",
            {
                "user_id": user_id,
                "changes": {
                    k: v
                    for k, v in {"is_active": is_active, "is_superuser": is_superuser, "title": title}.items()
                    if v is not None
                },
            },
            lambda: _db(body),
        )

    @server.tool()
    async def get_org_settings() -> dict[str, Any]:
        """机构设置（AI 预算/默认协同/搜索源）——仅超管。"""
        _require_admin()
        return await _run_org("get_org_settings", {}, lambda: org.settings_out(org.load_org()).model_dump(mode="json"))

    @server.tool()
    async def put_org_settings(patch: dict) -> dict[str, Any]:
        """改机构设置（merge 语义，未携带键保留）——仅超管。"""
        _require_admin()
        from app.domain.org import OrgSettingsPatch

        def body():
            try:
                p = OrgSettingsPatch.model_validate(patch)
            except ValueError as e:
                raise _err("validation", str(e)) from e
            return org.apply_settings(p).model_dump(mode="json")

        return await _run_org("put_org_settings", {"keys": sorted(patch)}, body)

    @server.tool()
    async def set_org_name(name: str) -> dict[str, Any]:
        """改机构名——仅超管。"""
        _require_admin()
        name = name.strip()
        if not name or len(name) > 80:
            raise _err("validation", "机构名须 1–80 字")

        def body():
            o = org.save_org(org.load_org().model_copy(update={"name": name}))
            return {"name": o.name}

        return await _run_org("set_org_name", {"name": name}, body)

    @server.tool()
    async def list_org_audit(
        actor_q: str | None = None, kind: str | None = None, pid: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        """机构审计查询（actor/kind/pid 过滤，limit≤200）——仅超管。"""
        _require_admin()

        async def body():
            res = await org_audit.query(actor=actor_q, kind=kind, pid=pid, limit=min(max(limit, 1), 200))
            return {"items": [it.model_dump(mode="json") for it in res.items], "total": res.total}

        return await _run_org(
            "list_org_audit", {"actor": actor_q, "kind": kind, "pid": pid, "limit": limit}, lambda: asyncio.run(body())
        )
