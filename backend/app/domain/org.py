# -*- coding: utf-8 -*-
"""机构设置 `<projects>/.studio/org.json`（docs/plan/21 §2 R-ADM-03 / R-AI-01 机构级；notify-audit-backend）。

文件里只有四个可写字段：name（W4-E 起就在）、ai_enabled（默认 true）、default_collab、ai_daily_tokens。
SMTP 不落文件：只从环境变量 PATENT_STUDIO_SMTP_URL 读出「是否配置 / 主机 / 端口 / 账号」作为只读状态回给前端
（notify/mail.py），密码永不出网。老的 org.json 只有 name 时其余字段取默认，读写形式与 tags.json 同（json + 换行）。

- `require_org_ai`：/ai/* 与 /agent/* 的路由级依赖；机构关闭 AI 时 403 kind=ai_disabled_by_org（接线归 integrate）。
- `apply_default_collab`：新案建好后把机构默认协作设置写进 project_collab_settings（订阅 case.created，见 notify）。
"""

import json
import os

from fastapi import Request
from pydantic import BaseModel, Field

from app import atomic, config
from app.errors import kind_error
from app.notify import mail
from app.schemas import DefaultCollab, OrgSettings, OrgSettingsPatch

ORG_FILE = os.path.join(".studio", "org.json")
ORG_NAME_MAX = 64


class Org(BaseModel):
    name: str = Field(default="", max_length=ORG_NAME_MAX)
    ai_enabled: bool = True
    default_collab: DefaultCollab = Field(default_factory=DefaultCollab)
    ai_daily_tokens: int = Field(default=config.AI_DAILY_TOKENS, ge=0)


def org_path(projects_dir: str | None = None) -> str:
    return os.path.join(projects_dir or config.PROJECTS_DIR, ORG_FILE)


def load_org(projects_dir: str | None = None) -> Org:
    p = org_path(projects_dir)
    if not os.path.isfile(p):
        return Org()
    try:
        with open(p, encoding="utf-8") as f:
            return Org.model_validate(json.load(f))
    except ValueError as e:
        raise kind_error("settings", f"org.json 无法读取：{e}", detail="org") from e


def save_org(org: Org, projects_dir: str | None = None) -> Org:
    p = org_path(projects_dir)
    atomic.write_json(p, org.model_dump())
    return org


def settings_out(org: Org) -> OrgSettings:
    return OrgSettings(
        ai_enabled=org.ai_enabled,
        default_collab=org.default_collab,
        smtp=mail.status(),
        ai_daily_tokens=org.ai_daily_tokens,
    )


def apply_settings(patch: OrgSettingsPatch, projects_dir: str | None = None) -> OrgSettings:
    """只改给出的字段；patch.smtp 忽略（配置在环境变量里，接口只读）。"""
    org = load_org(projects_dir)
    changes = patch.model_dump(exclude_none=True, exclude={"smtp"})
    if changes:
        org = save_org(Org.model_validate({**org.model_dump(), **changes}), projects_dir)
    return settings_out(org)


def ai_enabled() -> bool:
    return load_org().ai_enabled


async def require_org_ai(request: Request) -> None:
    """机构级 AI 外发闸门：`dependencies=[Depends(require_org_ai)]` 挂在 /ai/* 与 /agent/* 生成类路由上。
    部署全局 org.json ai_enabled 是全局闸门；pid 绑定到 PG 案时按该机构 egress_policy 实时重查。
    fail-closed：ambiguous / denied / unavailable 在平台生效（PG+AUTH=on）时一律拒——
    只允许「明确本地文件模式：未配置 PG 且 AUTH=off」落回部署全局闸门。"""
    if not ai_enabled():
        raise kind_error("ai_disabled_by_org", "机构已关闭 AI 助手，请联系机构管理员", detail="org")
    pid = request.path_params.get("pid")
    if not pid:
        return  # 非案域路径（如 /api/ai/jobs/*）——由路由内 require_org_ai_pid 按 job.pid 重查
    await require_org_ai_pid(request, pid)


async def require_org_ai_pid(request: Request, pid: str) -> None:
    """pid 不在 path_params 时（body 目标案 / job 载荷）执行同一机构外发门。"""
    from app.domain.context import platform_configured, resolve_binding

    b = await resolve_binding(request, pid)
    binding = b.get("binding")
    if binding == "unbound":
        return  # PG 全局无同 key 案：纯文件案卷，机构策略不适用（部署全局闸门已查）
    if binding != "bound" and not platform_configured():
        return  # 明确本地模式：unavailable 只可能是无 PG/无身份，不猜机构
    _check_egress_binding(b)


def _check_egress_binding(b: dict) -> None:
    """绑定结果的机构外发判定（HTTP 请求面与运行中 guard 共用）。"""
    binding = b.get("binding")
    if binding != "bound":
        raise kind_error(
            "ai_disabled_by_org",
            f"机构外发授权未决（{binding}），按 fail-closed 拒绝 AI 外发——请确认案卷绑定与机构成员状态",
            detail=str(binding),
        )
    if (b.get("organization") or {}).get("status") != "active":
        raise kind_error("ai_disabled_by_org", "本机构不可用（非 active），AI 外发已停用", detail="org_status")
    policy = b.get("egress_policy") or {}
    if policy.get("ai_egress") is False:
        raise kind_error(
            "ai_disabled_by_org",
            f"本机构已关闭 AI 外发（策略 v{policy.get('version') or '?'}）",
            detail="org_policy",
        )


def egress_guard(pid: str, request: Request | None = None, user_id: str | None = None):
    """运行中机构外发门（R2）：每次真实上游调用前重查——请求入场检查之后的
    多步工具循环 / 模型重试 / 排队续跑，撤销即零新上游。HTTP 面带 request（cookie/token
    同一身份口径）；无请求面（MCP/任务线程）按 user_id 走 resolve_binding_for_user。"""
    import asyncio as _asyncio

    from app.domain.context import platform_configured, resolve_binding, resolve_binding_for_user

    async def check() -> None:
        if not ai_enabled():
            raise kind_error("ai_disabled_by_org", "机构已关闭 AI 助手，请联系机构管理员", detail="org")
        if not platform_configured():
            return  # 明确本地模式：部署全局闸门已查
        if request is not None:
            b = await resolve_binding(request, pid)
        else:
            b = await _asyncio.to_thread(resolve_binding_for_user, pid, user_id)
        if b.get("binding") == "unbound":
            return  # 真本地案
        _check_egress_binding(b)

    return check


def apply_default_collab(pid: str) -> None:
    """新案继承机构默认协作设置（R-ADM-03）：default_collab.allow_viewer_comment → collab-settings.allow_comment。

    在 case.created 的同步订阅者里调用（notify.on_case_created），走 sink 的同步引擎；行已存在（重建同名案）则覆写。
    """
    from sqlalchemy.dialects.sqlite import insert

    from app.auth.access import DEFAULT_SETTINGS
    from app.auth.models import ProjectCollabSettings
    from app.notify import sink

    values = {**DEFAULT_SETTINGS, "project_id": pid, "allow_comment": load_org().default_collab.allow_viewer_comment}
    stmt = insert(ProjectCollabSettings).values(**values)
    sink.run(stmt.on_conflict_do_update(index_elements=["project_id"], set_={"allow_comment": values["allow_comment"]}))
