"""平台认证路由（收编自旧 app/auth/router.py + users_me.py 的对外最小面）：

on:  /api/auth/register、/api/auth/cookie/login|logout、/api/users/me（GET/PUT 资料+改密）
off: 认证写路由一律 501 not_implemented；GET /api/users/me → 204（"无人"，与旧口径一致）

路由始终注册、处理器内分流：模块层不 import fastapi-users（off 模式零依赖零 DB 触碰），
create_app() 可重复调用无需模块重载。
"""

import re
import time
import uuid

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from patent_studio.api.dependencies import CurrentUser, error
from patent_studio.domain.identity import User
from patent_studio.infra import auth as infra_auth
from patent_studio.infra.auth import auth_on, cookie_secure

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_MIN = 8
AVATAR_COLORS: tuple[str, ...] = ("blue", "orange", "green", "purple", "pink", "teal", "yellow", "red")


def login_required() -> HTTPException:
    return error(401, "auth", "请先登录")


def _not_enabled() -> HTTPException:
    return error(501, "not_implemented", "当前部署未开启账号认证（PATENT_STUDIO_AUTH=off）")


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    is_active: bool = Field(default=True, exclude=True)
    is_superuser: bool = False
    is_verified: bool = Field(default=False, exclude=True)
    display_name: str = ""
    title: str = ""
    avatar_color: str = ""


class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: str = ""


class PasswordIn(BaseModel):
    current: str
    new: str


class MePatchIn(BaseModel):
    display_name: str | None = None
    title: str | None = None
    avatar_color: str | None = None
    password: PasswordIn | None = None


async def _session():
    await infra_auth.init_db()
    return infra_auth.SessionLocal()


def _user_db(session):
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

    return SQLAlchemyUserDatabase(session, User)


def _manager(session):
    return infra_auth._users_stack()["UserManager"](_user_db(session))


@router.post("/api/auth/register", status_code=201, response_model=UserOut)
async def register(body: RegisterIn):
    if not auth_on():
        raise _not_enabled()
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise error(422, "validation", "邮箱格式不正确")
    if len(body.password) < PASSWORD_MIN:
        raise error(422, "validation", f"密码至少 {PASSWORD_MIN} 位")
    if len(body.display_name) > 64:
        raise error(422, "validation", "显示名过长")
    from fastapi_users import schemas as fu_schemas

    session = await _session()
    try:
        manager = _manager(session)
        if await manager.user_db.get_by_email(email):
            raise error(409, "conflict", "邮箱已注册")
        user = await manager.create(fu_schemas.BaseUserCreate(email=email, password=body.password))
        if body.display_name:
            user = await manager.user_db.update(user, {"display_name": body.display_name})
        await manager.on_after_register(user)
        return user
    finally:
        await session.close()


@router.post("/api/auth/cookie/login", status_code=204)
async def login(request: Request, response: Response):
    if not auth_on():
        raise _not_enabled()
    form = await request.form()
    session = await _session()
    try:
        manager = _manager(session)
        from fastapi.security import OAuth2PasswordRequestForm

        user = await manager.authenticate(
            OAuth2PasswordRequestForm(
                username=str(form.get("username", "")).strip().lower(),
                password=str(form.get("password", "")),
                scope="",
                client_id=None,
                client_secret=None,
                grant_type="password",
            )
        )
        if user is None:
            raise error(400, "auth", "邮箱或密码错误")
        if not user.is_active:
            raise error(403, "forbidden", "账号已停用")
        token = await infra_auth._users_stack()["get_jwt_strategy"]().write_token(user)
        await manager.on_after_login(user, request, response)
    finally:
        await session.close()
    out = Response(status_code=204)
    out.set_cookie(
        infra_auth.COOKIE_NAME,
        token,
        max_age=infra_auth.SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
    )
    return out


@router.post("/api/auth/cookie/logout", status_code=204)
async def logout():
    if not auth_on():
        raise _not_enabled()
    out = Response(status_code=204)
    out.delete_cookie(infra_auth.COOKIE_NAME)
    return out


@router.get("/api/users/me", response_model=UserOut)
async def me(user: CurrentUser):
    if not auth_on():
        return Response(status_code=204)
    if user is None:
        raise login_required()
    return user


@router.put("/api/users/me", response_model=UserOut)
async def update_me(body: MePatchIn, user: CurrentUser):
    if not auth_on():
        raise _not_enabled()
    if user is None:
        raise login_required()
    updates: dict = {}
    if body.display_name is not None:
        name = body.display_name.strip()
        if len(name) > 64:
            raise error(422, "validation", "显示名过长")
        updates["display_name"] = name
    if body.title is not None:
        if len(body.title) > 32:
            raise error(422, "validation", "职称过长")
        updates["title"] = body.title.strip()
    if body.avatar_color is not None:
        if body.avatar_color and body.avatar_color not in AVATAR_COLORS:
            raise error(422, "validation", "头像色仅限预设名")
        updates["avatar_color"] = body.avatar_color
    if body.password is not None:
        from fastapi_users.password import PasswordHelper

        helper = PasswordHelper()
        verified, _ = helper.verify_and_update(body.password.current, user.hashed_password)
        if not verified:
            raise error(403, "forbidden", "当前密码不正确", detail="password")
        if len(body.password.new) < PASSWORD_MIN:
            raise error(422, "validation", f"密码至少 {PASSWORD_MIN} 位")
        updates["hashed_password"] = helper.hash(body.password.new)
        updates["password_changed_at"] = time.time()
    if updates:
        session = await _session()
        try:
            user = await _user_db(session).update(user, updates)
        finally:
            await session.close()
    return user
