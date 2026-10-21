# -*- coding: utf-8 -*-
"""双面案卷绑定解析（C0/P01）：legacy pid → PG 案（case_key）的真实映射。

与 GET /api/v1/cases/by-key 同一可见域谓词（成员机构 ∪ 参与者 ∪ 创建者），结果：
- bound：恰好 1 案且全局唯一——case_id / organization / participant_roles / 能力（谓词实测）
- unbound：PG 全局不存在同 case_key 案——本地文件案卷，不伪造 case_id
- ambiguous：可见域内 >1 案，或可见 1 案但全局多案——fail-closed，不替用户选，只回数量
- unavailable：PG 未配置 / 无会话身份 / 查询失败——显式不可用而非误报 unbound
- denied：存在同 key 案但对当前主体不可见（撤销/跨机构），或 agent token 作用域不覆盖

Agent Bearer token（agt_）：用 token.principal 评估可见域，再校验 case/org scope。
"""

from __future__ import annotations

import asyncio
from typing import Any


async def resolve_binding(request, pid: str) -> dict[str, Any]:
    try:
        from patent_studio.settings import get_settings

        url = get_settings().database_url
        if not (url or "").strip():
            return {"binding": "unavailable"}
        from patent_studio.infra.db import database_url

        return await asyncio.to_thread(_resolve, request, pid, database_url(url))
    except Exception:
        # 绑定查询失败 ≠ unbound：显式 unavailable，fail-closed
        return {"binding": "unavailable", "reason": "exception"}


def _resolve(request, pid: str, url) -> dict[str, Any]:
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import NullPool

    from patent_studio.domain import agents as agent_domain
    from patent_studio.domain.identity import Principal, User

    engine = create_engine(url, poolclass=NullPool, hide_parameters=True)
    try:
        with Session(engine, expire_on_commit=False) as session:
            token = None
            raw = request.headers.get("authorization", "")
            if raw.lower().startswith("bearer agt_"):
                token = agent_domain.authenticate_agent_token(session, raw.split(" ", 1)[1])
                principal_id = token.principal_id
            else:
                from patent_studio.infra import auth as ps_auth

                user = _await(ps_auth.current_user(request))
                if user is None or session.get(User, user.id) is None:
                    return {"binding": "unavailable", "reason": "no-pg-user"}
                principal = session.scalar(select(Principal).where(Principal.user_id == user.id))
                if principal is None:
                    # 与 api.dependencies.transaction 相同的 Principal 懒供给
                    import uuid

                    from sqlalchemy.dialects.postgresql import insert

                    session.execute(
                        insert(Principal)
                        .values(
                            id=uuid.uuid4(),
                            kind="human",
                            user_id=user.id,
                            display_name=user.display_name or "User",
                        )
                        .on_conflict_do_nothing(index_elements=[Principal.user_id])
                    )
                    session.commit()
                    principal = session.scalar(select(Principal).where(Principal.user_id == user.id))
                if principal is None:
                    return {"binding": "unavailable", "reason": "no-principal"}
                principal_id = principal.id
            return _resolve_case(session, pid, principal_id, token)
    finally:
        engine.dispose()


def _resolve_case(session, pid: str, principal_id, token) -> dict[str, Any]:
    """共享核心：principal 可见域 + 全局同 key 计数 → bound/unbound/ambiguous/denied。"""
    from sqlalchemy import func, select

    from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership

    member_orgs = select(OrganizationMembership.organization_id).where(
        OrganizationMembership.principal_id == principal_id,
        OrganizationMembership.status == "active",
    )
    participant_cases = select(CaseParticipant.case_id).where(
        CaseParticipant.principal_id == principal_id,
        CaseParticipant.status == "active",
    )
    visible = (
        Case.organization_id.in_(member_orgs)
        | Case.id.in_(participant_cases)
        | (Case.created_by_principal_id == principal_id)
    )
    found = list(session.scalars(select(Case).where(visible, Case.case_key == pid).order_by(Case.case_key, Case.id)))
    # 全局同 key 计数（不限可见域）：只用于歧义/越权判定，不回传他案详情
    total = session.scalar(select(func.count(Case.id)).where(Case.case_key == pid)) or 0
    if not found:
        # 全局 0 ⇒ 真本地案；全局 ≥1 但不可见 ⇒ 撤销/跨机构越权——不泄露详情但阻断
        return {"binding": "unbound" if total == 0 else "denied"}
    if len(found) > 1 or total > 1:
        return {"binding": "ambiguous", "candidates": max(len(found), total)}
    case = found[0]
    if token is not None:
        if token.organization_id is not None and token.organization_id != case.organization_id:
            return {"binding": "denied"}
        if token.case_id is not None and token.case_id != case.id:
            return {"binding": "denied"}
    org = session.get(Organization, case.organization_id)
    member = session.get(OrganizationMembership, (case.organization_id, principal_id))
    org_admin = member is not None and member.status == "active" and member.role in {"owner", "admin"}
    roles = list(
        session.scalars(
            select(CaseParticipant.role).where(
                CaseParticipant.case_id == case.id,
                CaseParticipant.principal_id == principal_id,
                CaseParticipant.status == "active",
            )
        )
    )
    write_roles = {"attorney", "case_manager", "drafter", "author"}
    manage_roles = {"attorney", "case_manager"}
    org_active = org is not None and org.status == "active"
    can_write = org_active and (org_admin or bool(set(roles) & write_roles))
    can_manage = org_active and (org_admin or bool(set(roles) & manage_roles))
    return {
        "binding": "bound",
        "case_id": str(case.id),
        "case_no": case.case_no,
        "organization": {"id": str(org.id), "name": org.name, "status": org.status} if org else None,
        "org_role": member.role if member and member.status == "active" else None,
        "participant_roles": roles,
        "capabilities": {
            "read": org_active,  # inactive org 的 case_access 即 403——不表达可读
            "write": can_write,
            "manage": can_manage,
        },
        "egress_policy": org.egress_policy if org is not None and isinstance(org.egress_policy, dict) else None,
    }


def platform_configured() -> bool:
    """平台面是否生效（PG 已配置且 auth=on）。False ⇒ 明确本地文件模式（无机构概念）。"""
    try:
        from app import config

        if not config.AUTH_ON:
            return False
        from patent_studio.settings import get_settings

        return bool((get_settings().database_url or "").strip())
    except Exception:
        return True  # 配置读取失败按平台生效处理——fail-closed


def resolve_binding_for_user(pid: str, user_id: str | None) -> dict[str, Any]:
    """无 HTTP 请求面（MCP actor / 任务线程）的绑定解析：PG user_id → Principal → 可见域。"""
    try:
        if not platform_configured():
            return {"binding": "unavailable", "reason": "local"}
        if not user_id:
            return {"binding": "unavailable", "reason": "no-actor"}
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import Session
        from sqlalchemy.pool import NullPool

        from patent_studio.domain.identity import Principal, User
        from patent_studio.infra.db import database_url
        from patent_studio.settings import get_settings

        engine = create_engine(database_url(get_settings().database_url), poolclass=NullPool, hide_parameters=True)
        try:
            with Session(engine, expire_on_commit=False) as session:
                import uuid as _uuid

                user = session.get(User, _uuid.UUID(str(user_id)))
                if user is None:
                    return {"binding": "unavailable", "reason": "no-pg-user"}
                principal = session.scalar(select(Principal).where(Principal.user_id == user.id))
                if principal is None:
                    return {"binding": "unavailable", "reason": "no-principal"}
                return _resolve_case(session, pid, principal.id, None)
        finally:
            engine.dispose()
    except Exception:
        return {"binding": "unavailable", "reason": "exception"}


def _await(coro):
    """在 to_thread 线程里跑 async current_user（它内部要走 PG 引擎）。"""
    import asyncio as _a

    return _a.run(coro)
