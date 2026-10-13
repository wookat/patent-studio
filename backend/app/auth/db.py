# -*- coding: utf-8 -*-
"""PostgreSQL 异步引擎、会话与 fastapi-users UserManager。

只在 PATENT_STUDIO_AUTH=on（或 create_user CLI）时被导入；off 模式不加载本模块、不碰数据库。
引擎按解析后的 PATENT_STUDIO_DATABASE_URL 懒建并缓存（测试切库后拿新引擎）；schema 不在这里建——
init_db() 在首次取会话时跑 alembic upgrade head（幂等），Alembic 是唯一的 schema 拥有者。
"""
import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import func, select
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import config
from app.domain import events
from patent_studio.domain.identity import User
from patent_studio.infra.db import database_url, upgrade_head
from patent_studio.settings import get_settings

_engines: dict[URL, AsyncEngine] = {}
_makers: dict[URL, async_sessionmaker[AsyncSession]] = {}
_ready: set[URL] = set()
# R84：并发首调各自跑迁移可能互踩——临界区串行化 + 双检（锁内再查一次 _ready）
_init_lock = asyncio.Lock()
# R84：首注册用户自动超管的 count→update 亦属 check-then-act，并发注册可能双双见 1
first_user_lock = asyncio.Lock()


def _database_url() -> URL:
    """postgresql+psycopg 的 URL 对象：引擎直接吃对象，str(URL) 会把密码 mask 成 ***，严禁字符串化。"""
    url = get_settings().database_url
    if not url:
        raise RuntimeError("未配置数据库：设置 PATENT_STUDIO_DATABASE_URL")
    return database_url(url)


def engine() -> AsyncEngine:
    """当前 database_url 的异步引擎（按 URL 缓存：测试换库后拿到新引擎）。

    NullPool：TestClient 每个请求换事件循环，连接不能跨循环复用。
    """
    u = _database_url()
    eng = _engines.get(u)
    if eng is None:
        eng = create_async_engine(u, poolclass=NullPool)
        _engines[u] = eng
    return eng


def SessionLocal() -> AsyncSession:
    """当前 database_url 的会话（保持原名与调用形状：`async with SessionLocal() as s`）。"""
    u = _database_url()
    maker = _makers.get(u)
    if maker is None:
        maker = async_sessionmaker(engine(), expire_on_commit=False)
        _makers[u] = maker
    return maker()


async def init_db() -> None:
    """确保库迁移到 head（Alembic 拥有 schema）。已迁移过的 URL 直接返回，不再跑 DDL。"""
    u = _database_url()
    if u in _ready:
        return
    async with _init_lock:
        if u in _ready:
            return
        await asyncio.to_thread(upgrade_head, u)
        _ready.add(u)


async def dispose_engines() -> None:
    """lifespan 收尾：关掉全部缓存引擎的连接。"""
    for eng in _engines.values():
        await eng.dispose()


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    await init_db()
    async with SessionLocal() as session:
        yield session


async def get_user_db(session: Annotated[AsyncSession, Depends(get_async_session)]):
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = config.AUTH_SECRET
    verification_token_secret = config.AUTH_SECRET

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        """第一个注册用户自动 superuser（07 §1 注册策略）。count→update 在锁内，防并发首注册双双超管。"""
        async with first_user_lock:
            n = await self.user_db.session.scalar(select(func.count()).select_from(User))
            if n == 1 and not user.is_superuser:
                await self.user_db.update(user, {"is_superuser": True})
        await self._consume_invites(user)

    async def on_after_login(self, user: User, request: Request | None = None,
                             response: Response | None = None) -> None:
        await self.user_db.update(user, {"last_login_at": datetime.now(UTC)})
        await self._consume_invites(user)
        events.emit("auth.login", actor=events.actor_of(user), data={"email": user.email})

    @staticmethod
    async def _consume_invites(user: User) -> None:
        """W4-B（14 D6）：被邀邮箱注册 / 登录 ⇒ pending_invites 变成 ACL 行。"""
        from app.auth import invites

        await invites.consume(user.email, user.id)


async def get_user_manager(user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)]):
    yield UserManager(user_db)
