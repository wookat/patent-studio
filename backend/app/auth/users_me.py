# -*- coding: utf-8 -*-
"""W4-E E2 个人资料（docs/plan/17 §3.2）：`PUT /api/users/me`。

`GET /api/users/me` 仍是 fastapi-users 的 users 路由（UserRead 已带 title / avatar_color；off ⇒ 204），本模块只加写入：
- 资料字段 display_name / title / avatar_color 任意子集；avatar_color 只收 AVATAR_COLORS 预设名或空串。
- 改密码：`password: {current, new}` —— 先用 UserManager.authenticate 核对 current（fastapi-users 原生 PATCH
  不核对旧密码，所以不用它），再写 hashed_password + password_changed_at（R71-01：改密前签发的会话全部失效）。
- 返回 UserRead。错误形状同 errors.error_detail：current 不对 ⇒ 403 kind=forbidden；
  new < PASSWORD_MIN ⇒ 422 kind=validation。
- off 模式：501 not_implemented("E2-account-admin")，与 router.py 里 auth 路由的 off 形状一致。

fastapi-users / SQLAlchemy 只在 on 分支内惰性 import（off 下不得把 app.auth.db 拉进来，test_w4e_prep 锁定）。
"""

import time

from fastapi import APIRouter, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from app import config
from app.auth import CurrentUser, login_required
from app.errors import error_detail, not_implemented

router = APIRouter(prefix="/api", tags=["auth"])
UNIT = "E2-account-admin"
_OFF = "账号未开启（PATENT_STUDIO_AUTH=off）"
PASSWORD_MIN = 8  # 与前端 components/auth/session.ts PASSWORD_MIN 一致
DISPLAY_NAME_MAX = 64
TITLE_MAX = 32


class PasswordChange(BaseModel):
    current: str
    new: str


class MeIn(BaseModel):
    display_name: str | None = None
    title: str | None = None
    avatar_color: str | None = None
    password: PasswordChange | None = None


def _validation(message: str) -> HTTPException:
    return HTTPException(422, error_detail("validation", message))


def profile_updates(body: MeIn) -> dict:
    """MeIn 的资料子集 → 写库字典（去首尾空白、限长、头像色白名单）；不含密码。"""
    from app.auth.schemas import AVATAR_COLORS

    out: dict = {}
    if body.display_name is not None:
        name = body.display_name.strip()
        if len(name) > DISPLAY_NAME_MAX:
            raise _validation(f"显示名不能超过 {DISPLAY_NAME_MAX} 字")
        out["display_name"] = name
    if body.title is not None:
        title = body.title.strip()
        if len(title) > TITLE_MAX:
            raise _validation(f"头衔不能超过 {TITLE_MAX} 字")
        out["title"] = title
    if body.avatar_color is not None:
        if body.avatar_color and body.avatar_color not in AVATAR_COLORS:
            raise _validation("头像色只能是预设色名或空（自动）：" + " / ".join(AVATAR_COLORS))
        out["avatar_color"] = body.avatar_color
    return out


@router.put("/users/me")
async def update_me(body: MeIn, user: CurrentUser):
    if not config.AUTH_ON:
        raise not_implemented(UNIT, _OFF)
    if user is None:
        raise login_required()
    updates = profile_updates(body)
    if body.password is not None and len(body.password.new) < PASSWORD_MIN:
        raise _validation(f"新密码至少 {PASSWORD_MIN} 位")

    from fastapi_users.db import SQLAlchemyUserDatabase

    from app.auth.db import SessionLocal, UserManager, init_db
    from app.auth.models import User
    from app.auth.schemas import UserRead

    await init_db()
    async with SessionLocal() as s:
        mgr = UserManager(SQLAlchemyUserDatabase(s, User))
        me = await s.get(User, user.id)
        if body.password is not None:
            form = OAuth2PasswordRequestForm(username=me.email, password=body.password.current)
            if await mgr.authenticate(form) is None:
                raise HTTPException(403, error_detail("forbidden", "当前密码不正确", detail="password"))
            updates["hashed_password"] = mgr.password_helper.hash(body.password.new)
            updates["password_changed_at"] = time.time()  # R71-01：使此前签发的会话失效
        if updates:
            me = await mgr.user_db.update(me, updates)
    return UserRead.model_validate(me)
