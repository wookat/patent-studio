"""平台会话认证：cookie + JWT（fastapi-users），收编自旧 app/auth。

PATENT_STUDIO_AUTH=off（默认）：`current_user` 恒为 None，本模块的 fastapi-users 栈不加载。
on：`read_cookie_user` 从 cookie `studio_session` 解 JWT；引擎按 PATENT_STUDIO_DATABASE_URL
懒建并缓存（NullPool：TestClient 每请求换事件循环）；`init_db` 首连跑 alembic upgrade head。
"""

import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from patent_studio.domain.identity import User
from patent_studio.infra.db import database_url, upgrade_head
from patent_studio.settings import get_settings

COOKIE_NAME = "studio_session"
SESSION_SECONDS = 7 * 24 * 3600

_engines: dict[URL, AsyncEngine] = {}
_makers: dict[URL, async_sessionmaker[AsyncSession]] = {}
_ready: set[URL] = set()
_init_lock = asyncio.Lock()
first_user_lock = asyncio.Lock()


def auth_on() -> bool:
    return get_settings().auth.strip().lower() == "on"


def auth_secret() -> str:
    return get_settings().secret


def cookie_secure() -> bool:
    return get_settings().cookie_secure.strip().lower() == "on"


def _database_url() -> URL:
    url = get_settings().database_url
    if not url:
        raise RuntimeError("未配置数据库：设置 PATENT_STUDIO_DATABASE_URL")
    return database_url(url)


def engine() -> AsyncEngine:
    u = _database_url()
    eng = _engines.get(u)
    if eng is None:
        eng = create_async_engine(u, poolclass=NullPool)
        _engines[u] = eng
    return eng


def SessionLocal() -> AsyncSession:
    u = _database_url()
    maker = _makers.get(u)
    if maker is None:
        maker = async_sessionmaker(engine(), expire_on_commit=False)
        _makers[u] = maker
    return maker()


async def init_db() -> None:
    """确保库迁移到 head（Alembic 拥有 schema）。已迁移过的 URL 直接返回。"""
    u = _database_url()
    if u in _ready:
        return
    async with _init_lock:
        if u in _ready:
            return
        await asyncio.to_thread(upgrade_head, u)
        _ready.add(u)


async def dispose_engines() -> None:
    for eng in _engines.values():
        await eng.dispose()


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    await init_db()
    async with SessionLocal() as session:
        yield session


_STACK: dict | None = None


def _users_stack() -> dict:
    """惰性加载 fastapi-users 栈：off 模式不得触碰（缺 SECRET 时 on 模式在此显式失败）。"""
    global _STACK
    if _STACK is not None:
        return _STACK
    if not auth_secret():
        raise RuntimeError("PATENT_STUDIO_AUTH=on 需要设置 PATENT_STUDIO_SECRET（JWT 签名密钥）")
    from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
    from fastapi_users.authentication import AuthenticationBackend, CookieTransport, JWTStrategy
    from fastapi_users.jwt import decode_jwt
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

    async def get_user_db(session: Annotated[AsyncSession, Depends(get_async_session)]):
        yield SQLAlchemyUserDatabase(session, User)

    class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
        reset_password_token_secret = auth_secret()
        verification_token_secret = auth_secret()

        async def on_after_register(self, user: User, request: Request | None = None) -> None:
            """第一个注册用户自动 superuser（锁内 count→update，防并发首注册双双超管）。"""
            async with first_user_lock:
                n = await self.user_db.session.scalar(select(func.count()).select_from(User))
                if n == 1 and not user.is_superuser:
                    await self.user_db.update(user, {"is_superuser": True})

        async def on_after_login(self, user: User, request: Request | None = None,
                                 response: Response | None = None) -> None:
            await self.user_db.update(user, {"last_login_at": datetime.now(UTC)})

    async def get_user_manager(user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)]):
        yield UserManager(user_db)

    class SessionJWTStrategy(JWTStrategy):
        """改密时刻闸：签发时刻早于 password_changed_at 的 token 一律拒（exp-lifetime 反推 iat）。"""

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
        return SessionJWTStrategy(secret=auth_secret(), lifetime_seconds=SESSION_SECONDS)

    cookie_transport = CookieTransport(
        cookie_name=COOKIE_NAME, cookie_max_age=SESSION_SECONDS, cookie_secure=cookie_secure()
    )
    auth_backend = AuthenticationBackend(name="cookie", transport=cookie_transport, get_strategy=get_jwt_strategy)
    fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])
    stack = {
        "UserManager": UserManager,
        "SessionJWTStrategy": SessionJWTStrategy,
        "get_jwt_strategy": get_jwt_strategy,
        "cookie_transport": cookie_transport,
        "auth_backend": auth_backend,
        "fastapi_users": fastapi_users,
        "get_user_db": get_user_db,
        "get_user_manager": get_user_manager,
    }
    _STACK = stack
    return stack


async def read_cookie_user(request: Request) -> User | None:
    """cookie → JWT → 用户；无 cookie / 过期 / 停用 ⇒ None（改密前签发的会话同拒）。"""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    stack = _users_stack()
    await init_db()
    async with SessionLocal() as session:
        from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

        user = await stack["get_jwt_strategy"]().read_token(
            token, stack["UserManager"](SQLAlchemyUserDatabase(session, User))
        )
    if user is None or not user.is_active:
        return None
    return user


async def current_user(request: Request):
    """off ⇒ None；on ⇒ User | None。需要"谁在操作"的代码只依赖这一处。"""
    if not auth_on():
        return None
    return await read_cookie_user(request)
