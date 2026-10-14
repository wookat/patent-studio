# -*- coding: utf-8 -*-
"""fastapi-users 接线：cookie+JWT 后端、从请求 cookie 解出用户（07 §1/§3）。

缺 PATENT_STUDIO_SECRET 时 import 即 RuntimeError（AUTH=on 启动失败）。
"""

import uuid

from fastapi import Request
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, CookieTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.jwt import decode_jwt

from app import config
from app.auth.db import SessionLocal, UserManager, get_user_manager, init_db
from app.auth.models import User

COOKIE_NAME = "studio_session"
SESSION_SECONDS = 7 * 24 * 3600

if not config.AUTH_SECRET:
    raise RuntimeError("PATENT_STUDIO_AUTH=on 需要设置 PATENT_STUDIO_SECRET（JWT 签名密钥）")


cookie_transport = CookieTransport(
    cookie_name=COOKIE_NAME, cookie_max_age=SESSION_SECONDS, cookie_secure=config.COOKIE_SECURE
)


class SessionJWTStrategy(JWTStrategy):
    """R71-01：原生校验之上加「改密时刻」闸——签发时刻早于 user.password_changed_at 的 token 一律拒，
    改密后旧会话立即失效。挂在策略层使 fastapi-users 自身路由（logout / GET /users/me）也生效。
    fastapi-users 不写 iat，用 exp - lifetime 反推签发时刻（exp 秒精度：与改密同秒的登录会被误伤，
    属已知边界）。"""

    async def read_token(self, token, user_manager):
        user = await super().read_token(token, user_manager)
        if user is None or not user.is_active:
            return None
        try:
            payload = decode_jwt(token, self.decode_key, self.token_audience, algorithms=[self.algorithm])
            issued = float(payload["exp"]) - (self.lifetime_seconds or 0)
        except Exception:
            return None
        if user.password_changed_at and issued < user.password_changed_at:
            return None
        return user


def get_jwt_strategy() -> JWTStrategy:
    return SessionJWTStrategy(secret=config.AUTH_SECRET, lifetime_seconds=SESSION_SECONDS)


auth_backend = AuthenticationBackend(name="cookie", transport=cookie_transport, get_strategy=get_jwt_strategy)
fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])


async def read_cookie_user(request: Request) -> User | None:
    """cookie → JWT → 用户；无 cookie / 过期 / 用户不存在或停用 ⇒ None（改密前签发的会话同拒，见策略类）。"""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    await init_db()
    async with SessionLocal() as session:
        user = await get_jwt_strategy().read_token(token, UserManager(SQLAlchemyUserDatabase(session, User)))
    if user is None or not user.is_active:
        return None
    return user
