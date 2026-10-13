# -*- coding: utf-8 -*-
"""R6 账号 / 成员 / 分享路由（docs/plan/07 §4.1）。

on  ⇒ fastapi-users 的 register / cookie login+logout 路由 + GET /users/me + 成员与分享链接路由；
       个人资料 / 改密只走 W4-E 的 `PUT /users/me`（users_me.py，核对旧密码），不挂 fastapi-users 的 users 路由
       （其 PATCH /users/me 不核对旧密码且可改 email）；
off ⇒ /auth/* 与成员/分享返回 501 not_implemented；GET /users/me 返回 204（无用户，前端据此进入
       authStatus='off'，首屏探针不能是 4xx/5xx，否则浏览器控制台报 Failed to load resource）。
成员/分享路由的 owner 门槛由全局 project_access（ROUTE_ROLE）校验；/share/{token}/accept 无 pid，自行判登录。
W4-B（docs/plan/14 §4）：`PUT /members/{user_id}` 改角色；`PUT /members` 邮箱未注册 ⇒ pending 邀请 201（D7）；
`GET /share` 带 accepted_by；accept 写 share_accepts + 访问记录。
访问记录 / 协作设置在 routes_access.py（B1），邀请在 invites.py（B2）。
"""
import uuid
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import auth, config
from app.auth import ROLE_RANK, CurrentUser, login_required
from app.domain import events
from app.errors import error_detail, not_implemented

router = APIRouter(prefix="/api", tags=["auth"])
UNIT = "C1-auth"
_OFF = "账号未开启（PATENT_STUDIO_AUTH=off）"


class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: str = ""


class MemberIn(BaseModel):
    email: str
    role: str


class RoleIn(BaseModel):
    role: str


class ShareIn(BaseModel):
    role: str
    expires_in_days: int | None = None


if config.AUTH_ON:
    from app.auth import acl
    from app.auth.schemas import UserCreate, UserRead
    from app.auth.users import auth_backend, fastapi_users

    router.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth")
    router.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth/cookie")

    @router.get("/users/me", response_model=UserRead)
    async def me(user: CurrentUser):
        if user is None:
            raise login_required()
        return user

    def _member_changed(pid: str, actor, *, user_id, role: str | None, email: str | None = None) -> None:
        events.emit("member.changed", pid=pid, actor=events.actor_of(actor),
                    data={"user_id": str(user_id) if user_id is not None else None, "role": role, "email": email})

    def _origin(request: Request) -> str:
        """分享链接的站点前缀 = 浏览器实际访问的地址：Origin → Referer → X-Forwarded-Proto/Host → 监听地址
        （Vite 代理 changeOrigin / 隧道 httpHostHeader 会改写 Host，只看 base_url 会拼出 127.0.0.1:8000）。"""
        h = request.headers
        origin = h.get("origin")
        if origin and origin != "null":
            return origin.rstrip("/")
        ref = h.get("referer")
        if ref:
            u = urlsplit(ref)
            if u.scheme and u.netloc:
                return f"{u.scheme}://{u.netloc}"
        host = h.get("x-forwarded-host")
        if host:
            proto = h.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
            return f"{proto}://{host.split(',')[0].strip()}"
        return str(request.base_url).rstrip("/")

    def _uuid(s: str) -> uuid.UUID:
        try:
            return uuid.UUID(s)
        except ValueError:
            raise HTTPException(404, error_detail("not_found", "成员不存在"))

    @router.get("/projects/{pid}/members")
    async def members(pid: str):
        return await acl.list_members(pid)

    @router.put("/projects/{pid}/members")
    async def set_member(pid: str, body: MemberIn, user: CurrentUser):
        if body.role not in ROLE_RANK:
            raise HTTPException(422, error_detail("validation", f"角色不合法：{body.role}"))
        target = await acl.user_by_email(body.email)
        if target is None:
            if body.role == "owner":
                raise HTTPException(422, error_detail("validation", "邀请角色不能是 owner"))
            from app.auth import invites

            return JSONResponse(await invites.create_pending(pid, body.email, body.role, user.id), status_code=201)
        async with acl.membership_lock:  # check→set_role 必须原子：并发降级可把 owner 清零
            demoting_owner = body.role != "owner" and await acl.role_for(pid, target.id) == "owner"
            if demoting_owner and await acl.owner_count(pid) <= 1:
                raise HTTPException(409, error_detail("conflict", "案子至少保留一个所有者"))
            await acl.set_role(pid, target.id, body.role)
        _member_changed(pid, user, user_id=target.id, role=body.role, email=body.email)
        return await acl.list_members(pid)

    @router.put("/projects/{pid}/members/{user_id}")
    async def set_member_role(pid: str, user_id: str, body: RoleIn, user: CurrentUser):
        if body.role not in ROLE_RANK:
            raise HTTPException(422, error_detail("validation", f"角色不合法：{body.role}"))
        uid = _uuid(user_id)
        async with acl.membership_lock:
            current = await acl.role_for(pid, uid)
            if current is None:
                raise HTTPException(404, error_detail("not_found", "成员不存在"))
            if current == "owner" and body.role != "owner" and await acl.owner_count(pid) <= 1:
                raise HTTPException(409, error_detail("conflict", "案子至少保留一个所有者"))
            await acl.set_role(pid, uid, body.role)
        _member_changed(pid, user, user_id=uid, role=body.role)
        return await acl.list_members(pid)

    @router.delete("/projects/{pid}/members/{user_id}")
    async def remove_member(pid: str, user_id: str, user: CurrentUser):
        uid = _uuid(user_id)
        async with acl.membership_lock:
            if await acl.role_for(pid, uid) == "owner" and await acl.owner_count(pid) <= 1:
                raise HTTPException(409, error_detail("conflict", "案子至少保留一个所有者"))
            if not await acl.remove_member(pid, uid):
                raise HTTPException(404, error_detail("not_found", "成员不存在"))
        _member_changed(pid, user, user_id=uid, role=None)
        return await acl.list_members(pid)

    @router.get("/projects/{pid}/share")
    async def share_links(pid: str, request: Request):
        return await acl.share_links_out(pid, _origin(request))

    @router.post("/projects/{pid}/share", status_code=201)
    async def create_share_link(pid: str, body: ShareIn, request: Request, user: CurrentUser):
        if body.role not in acl.SHARE_ROLES:
            raise HTTPException(422, error_detail("validation",
                                                  "分享链接角色只能是 viewer / reviewer / editor / agent"))
        if body.expires_in_days is not None and body.expires_in_days <= 0:
            raise HTTPException(422, error_detail("validation", "有效期须为正整数天或 null（永久）"))
        link = await acl.create_share_link(pid, body.role, body.expires_in_days, user.id)
        return acl.share_out(link, _origin(request))

    @router.delete("/projects/{pid}/share/{token}")
    async def revoke_share_link(pid: str, token: str, request: Request):
        if not await acl.delete_share_link(pid, token):
            raise HTTPException(404, error_detail("not_found", "分享链接不存在"))
        return await acl.share_links_out(pid, _origin(request))

    @router.post("/share/{token}/accept")
    async def accept_share(token: str, user: CurrentUser):
        """登录用户凭链接加入：写/升级 ACL 行（不降级已有更高角色）；过期 410。"""
        if user is None:
            raise login_required()
        link = await acl.get_share_link(token)
        if link is None:
            raise HTTPException(404, error_detail("not_found", "分享链接不存在或已撤销"))
        if acl.is_expired(link):
            raise HTTPException(410, error_detail("expired", "分享链接已过期"))
        role = await acl.set_role(link.project_id, user.id, link.role, upgrade_only=True)
        await acl.record_share_accept(token, user.id)
        _member_changed(link.project_id, user, user_id=user.id, role=role)
        await auth.access_touch(link.project_id, user)
        return {"pid": link.project_id, "role": role}

else:

    @router.post("/auth/register", status_code=201)
    async def register(body: RegisterIn):
        raise not_implemented(UNIT, _OFF)

    @router.post("/auth/cookie/login", status_code=204)
    async def login():
        raise not_implemented(UNIT, _OFF)

    @router.post("/auth/cookie/logout", status_code=204)
    async def logout():
        raise not_implemented(UNIT, _OFF)

    @router.get("/users/me", status_code=204, response_class=Response)
    async def me():
        return Response(status_code=204)

    @router.get("/projects/{pid}/members")
    async def members(pid: str):
        raise not_implemented(UNIT, _OFF)

    @router.put("/projects/{pid}/members")
    async def set_member(pid: str, body: MemberIn):
        raise not_implemented(UNIT, _OFF)

    @router.put("/projects/{pid}/members/{user_id}")
    async def set_member_role(pid: str, user_id: str, body: RoleIn):
        raise not_implemented(UNIT, _OFF)

    @router.delete("/projects/{pid}/members/{user_id}")
    async def remove_member(pid: str, user_id: str):
        raise not_implemented(UNIT, _OFF)

    @router.get("/projects/{pid}/share")
    async def share_links(pid: str):
        raise not_implemented(UNIT, _OFF)

    @router.post("/projects/{pid}/share", status_code=201)
    async def create_share_link(pid: str, body: ShareIn):
        raise not_implemented(UNIT, _OFF)

    @router.delete("/projects/{pid}/share/{token}")
    async def revoke_share_link(pid: str, token: str):
        raise not_implemented(UNIT, _OFF)

    @router.post("/share/{token}/accept")
    async def accept_share(token: str):
        raise not_implemented(UNIT, _OFF)
