# -*- coding: utf-8 -*-
"""R6 账号地基：唯一的依赖注入点（docs/plan/07 §3）。

`PATENT_STUDIO_AUTH=off`（默认）：`current_user` 恒为 None、`project_access` 直接返回——
不 import fastapi-users、不建 engine，现有路由与门禁逐字节不变。
`on`：`_resolve_user` 从 cookie `studio_session` 解 JWT（users.py），`_check_access` 查 projects_acl（acl.py）。
fastapi-users / SQLAlchemy 只在 on 分支内惰性 import。

W4-B（docs/plan/14）：角色加 reviewer（viewer < reviewer < editor）；源文档写路由降到 reviewer 门槛，路由内 save 前调
`check_source_write`（reviewer 只允许 CriticMarkup 建议 / 批注，否则 403）；`access_touch` 是访问记录写入点。
"""

import os
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app import config
from app.errors import error_detail

ROLES = ("viewer", "reviewer", "editor", "agent", "owner")
ROLE_RANK = {"viewer": 0, "reviewer": 1, "editor": 2, "agent": 3, "owner": 4}

# 无 pid 覆盖表时按 HTTP 方法判定：读 → viewer，写 → editor
METHOD_ROLE = {"GET": "viewer", "HEAD": "viewer", "OPTIONS": "viewer"}
# 按路由模板覆盖（request.scope["route"].path；同一模板不同方法门槛不同时用 "METHOD path" 键）；
# 批注：viewer 也可发起/回复/解决；
# 构建 / lint / 体检 / AST / XML 导出只渲染到 .studio/builds，不改源码 ⇒ viewer 也能预览与导出
ROUTE_ROLE = {
    "/api/projects/{pid}/build": "viewer",
    "/api/projects/{pid}/lint": "viewer",
    "/api/projects/{pid}/preflight": "viewer",
    "/api/projects/{pid}/ast": "viewer",
    "/api/projects/{pid}/export/xml": "viewer",
    "/api/projects/{pid}/members": "owner",
    "/api/projects/{pid}/members/{user_id}": "owner",
    "/api/projects/{pid}/share": "owner",
    "/api/projects/{pid}/share/{token}": "owner",
    "/api/projects/{pid}/critic": "viewer",  # POST 只解析 CriticMarkup（可带未保存正文），不写源码
    "/api/projects/{pid}/claims/{num}/preview": "viewer",  # Z20：假设图只读推演，不写正文
    "/api/projects/{pid}/comments": "viewer",
    "/api/projects/{pid}/comments/{cid}": "viewer",
    "/api/projects/{pid}/comments/{cid}/replies": "viewer",
    "/api/projects/{pid}/comments/{cid}/resolve": "viewer",
    "/api/projects/{pid}/comments/{cid}/reopen": "viewer",
    "/api/projects/{pid}/leave": "viewer",  # W4-A：任何成员都能退出自己的视图（owner 由路由自己拒绝）
    # W4-A 台账写入：agent 及以上（路由自身也挂 require_role("agent")，这里让 403 文案一致）
    "PUT /api/projects/{pid}/case": "agent",
    "/api/projects/{pid}/case/status": "agent",
    "/api/projects/{pid}/list-state": "agent",
    # W4-B：源文档写路由放 reviewer 进门，正文校验在路由内（check_source_write）；GET 仍是 viewer
    "/api/projects/{pid}/content": "reviewer",
    "/api/projects/{pid}/docs/{book}": "reviewer",
    "/api/projects/{pid}/blocks": "reviewer",
    "/api/projects/{pid}/blocks/{block_id:path}": "reviewer",
    "/api/projects/{pid}/access": "owner",
    "/api/projects/{pid}/invites": "owner",
    "/api/projects/{pid}/invites/{email}": "owner",
    "/api/projects/{pid}/collab-settings": "viewer",  # PUT 由路由内 require_role("owner")
    # W4-E E1：全部打包只渲染到 .studio/deliver，与 /build /export/xml 同门槛
    "/api/projects/{pid}/deliver/bundle": "viewer",
    # ---- W5（docs/plan/21 §7.4.8）预填；单元实现路由时不改此表 ----
    # deadlines-backend：重算 / 改期 / 完成 = 案件台账写入门槛（agent）；GET /api/deadlines 无 pid，路由内按可见案过滤
    "/api/projects/{pid}/deadlines/compute": "agent",
    "/api/projects/{pid}/deadlines/{deadline_id}": "agent",
    "/api/projects/{pid}/deadlines/{deadline_id}/done": "agent",
    # notify-audit-backend：催办 = 主管（agent+）
    "/api/projects/{pid}/nudge": "agent",
    # share-confirm-backend：公开链接管理 owner；时间线 viewer；备注 reviewer 起；审阅指派 agent
    "/api/projects/{pid}/public-links": "owner",
    "/api/projects/{pid}/public-links/{token}": "owner",
    "/api/projects/{pid}/timeline": "viewer",
    "/api/projects/{pid}/notes": "reviewer",
    "/api/projects/{pid}/review-assign": "agent",
    # agent-core-backend：run 门槛 viewer 进门，路由内按 ScenarioInfo.min_role 再校验；proposals 列表 viewer；
    # apply 写 content.md ⇒ reviewer 进门 + check_source_write；dismiss reviewer
    "/api/projects/{pid}/agent/run": "viewer",
    "/api/projects/{pid}/agent/jobs": "viewer",
    "/api/projects/{pid}/agent/proposals": "viewer",
    "/api/projects/{pid}/agent/proposals/{proposal_id}/apply": "reviewer",
    "/api/projects/{pid}/agent/proposals/{proposal_id}/dismiss": "reviewer",
    "/api/projects/{pid}/ai/budget": "viewer",
    # oa-import-backend：轮次 = 台账写入（agent）；GET viewer；解析 PDF reviewer
    "GET /api/projects/{pid}/oa/rounds": "viewer",
    "/api/projects/{pid}/oa/rounds": "agent",
    "/api/projects/{pid}/oa/rounds/{rid}": "agent",
    # preflight-backend：递交页错误只读
    "/api/projects/{pid}/deliver/errors": "viewer",
}

# 免登录路径前缀（公开客户审阅；路由内以 token 校验 scope / 过期 / 撤销）；auth 中间件与前端 hash 路由 #/c/<token> 对应
PUBLIC_PATH_PREFIXES = ("/api/public/",)


def required_role(method: str, route_path: str | None) -> str:
    if route_path is None:
        return METHOD_ROLE.get(method.upper(), "editor")
    by_method = f"{method.upper()} {route_path}"
    if by_method in ROUTE_ROLE:
        return ROUTE_ROLE[by_method]
    need = ROUTE_ROLE.get(route_path)
    if need is None or (need == "reviewer" and method.upper() in METHOD_ROLE):
        return METHOD_ROLE.get(method.upper(), "editor")
    return need


def role_at_least(have: str | None, need: str) -> bool:
    return have is not None and ROLE_RANK[have] >= ROLE_RANK[need]


def login_required():
    return HTTPException(401, error_detail("auth", "需要登录"))


def forbidden(need: str):
    return HTTPException(403, error_detail("forbidden", f"权限不足：需要 {need} 及以上角色", detail=need))


async def _resolve_user(request: Request):
    from app.auth.users import read_cookie_user

    return await read_cookie_user(request)


async def _check_access(request: Request, user, pid: str, need: str) -> None:
    """superuser 放行；查 projects_acl；未登录 401 kind=auth；角色不足 403 kind=forbidden。
    非成员 ∧ pid 不存在 ⇒ 404 not_found（“不泄露存在性”只对真存在的案子有意义）。"""
    from app.auth import acl

    if user is None:
        raise login_required()
    if user.is_superuser:
        return
    role = await acl.role_for(pid, user.id)
    if role is None and not os.path.isfile(os.path.join(config.PROJECTS_DIR, pid, "content.md")):
        raise HTTPException(404, error_detail("not_found", "案子不存在"))
    if not role_at_least(role, need):
        raise forbidden(need)


async def my_role(pid: str, user) -> str | None:
    """当前用户在本案的角色：off ⇒ None（前端视为可写）；superuser ⇒ owner。
    GET /api/projects/{pid} 带给前端做只读壳。"""
    if not config.AUTH_ON or user is None:
        return None
    if user.is_superuser:
        return "owner"
    from app.auth import acl

    return await acl.role_for(pid, user.id)


async def check_source_write(pid: str, user, base: str, new: str) -> None:
    """源文档写入前调（14 §4.1）：reviewer 的改动必须全部落在 CriticMarkup 内（acl.reviewer_allowed），
    否则 403 detail=reviewer。
    off / 匿名 / 非 reviewer 直接放行（角色门槛已由 project_access 校验）。"""
    if await my_role(pid, user) != "reviewer":
        return
    from app.auth import acl

    if not acl.reviewer_allowed(base, new):
        raise HTTPException(403, error_detail("forbidden", "审阅者只能提出 CriticMarkup 建议与批注", detail="reviewer"))


async def access_touch(pid: str, user) -> None:
    """访问记录写入点（14 D3）：GET /projects/{pid} 与领取分享链接时调；off / 匿名无事发生。"""
    if not config.AUTH_ON or user is None:
        return
    from app.auth import access

    await access.touch(pid, user)


async def grant_owner(pid: str, user) -> None:
    """新建案子后写 owner 行（integrate 在 main.create_project 调用）；off 或匿名时无事发生。"""
    if not config.AUTH_ON or user is None:
        return
    from app.auth import acl

    await acl.set_role(pid, user.id, "owner")


async def visible_pids(user, pids: list[str]) -> list[str]:
    """on 时 `GET /api/projects` 只列 ACL 命中（superuser 全部）；off 原样返回。"""
    if not config.AUTH_ON:
        return pids
    if user is None:
        raise login_required()
    if user.is_superuser:
        return pids
    from app.auth import acl

    mine = await acl.project_ids_for(user.id)
    return [p for p in pids if p in mine]


async def current_user(request: Request):
    """off ⇒ None；on ⇒ User | None。所有需要"谁在操作"的代码只依赖这一处。"""
    if not config.AUTH_ON:
        return None
    return await _resolve_user(request)


CurrentUser = Annotated[object | None, Depends(current_user)]


async def project_access(request: Request, user: CurrentUser) -> None:
    """全局依赖（main.py `FastAPI(dependencies=[Depends(project_access)])`）。只在 on 且路径含 pid 时校验。"""
    if not config.AUTH_ON:
        return
    pid = request.path_params.get("pid")
    if pid is None:
        return
    route = request.scope.get("route")
    await _check_access(request, user, pid, required_role(request.method, route.path if route is not None else None))


async def check_access(request: Request, user, pid: str, need: str) -> None:
    """pid 不在路径里（表单 / 请求体指向另一案）时手工校验；off 直接返回。"""
    if not config.AUTH_ON:
        return
    await _check_access(request, user, pid, need)


def require_role(role: str):
    """单路由显式门槛（比 project_access 的默认更高时用）。"""
    if role not in ROLE_RANK:
        raise ValueError(role)

    async def dep(request: Request, user: CurrentUser) -> None:
        if not config.AUTH_ON:
            return
        await _check_access(request, user, request.path_params["pid"], role)

    return dep


async def require_login(user: CurrentUser) -> None:
    """无 pid 的登录态路由（/api/notify、/api/deadlines、/api/admin/*）的路由级依赖：on 且匿名 ⇒ 401；off 放行。"""
    if config.AUTH_ON and user is None:
        raise login_required()


async def require_superuser(user: CurrentUser) -> None:
    """机构级路由（/api/admin/audit、settings、ai-usage）：on 且非超管 ⇒ 403 detail=superuser；off 放行。"""
    if not config.AUTH_ON:
        return
    if user is None:
        raise login_required()
    if not user.is_superuser:
        raise forbidden_superuser()


async def require_org_editor(user: CurrentUser) -> None:
    """机构级共享资源的写门槛（全局 /api/templates 写路由）：on 且匿名 ⇒ 401；
    登录者需在任一案持 editor+ 角色（或超管），纯 viewer/reviewer ⇒ 403。"""
    if not config.AUTH_ON:
        return
    if user is None:
        raise login_required()
    if user.is_superuser:
        return
    from app.auth import acl

    if not role_at_least(await acl.max_role_for(user.id), "editor"):
        raise HTTPException(403, error_detail("forbidden", "需要编辑者及以上角色", detail="editor"))


def forbidden_superuser():
    return HTTPException(403, error_detail("forbidden", "机构管理仅机构管理员可用", detail="superuser"))
