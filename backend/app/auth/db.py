# -*- coding: utf-8 -*-
"""SQLite（studio.db）引擎、会话与 fastapi-users UserManager。

只在 PATENT_STUDIO_AUTH=on（或 create_user CLI）时被导入。建表在首次取会话时完成（幂等），
main.py 若有 lifespan 也可直接 `await init_db()`。
"""

import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import config
from app.auth.models import PUBLIC_LINK_ADDED_COLUMNS, USER_ADDED_COLUMNS, Base, User
from app.domain import events

# NullPool：TestClient 每个请求换事件循环、aiosqlite 连接不能跨循环复用；生产单循环下开文件极便宜
engine = create_async_engine(f"sqlite+aiosqlite:///{config.DB_PATH}", poolclass=NullPool, connect_args={"timeout": 15})
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
_ready = False
# R84：并发首调各自跑 create_all 会冒 "table already exists"——临界区串行化 + 双检
_init_lock = asyncio.Lock()
# R84：首注册用户自动超管的 count→update 亦属 check-then-act，并发注册可能双双见 1
first_user_lock = asyncio.Lock()


async def init_db() -> None:
    global _ready
    if _ready:
        return
    async with _init_lock:
        if _ready:
            return
        async with engine.connect() as conn:
            await conn.execute(text("PRAGMA journal_mode=WAL"))
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            have = {row[1] for row in await conn.execute(text("PRAGMA table_info(user)"))}
            for name, ddl in USER_ADDED_COLUMNS:
                if name not in have:
                    await conn.execute(text(f"ALTER TABLE user ADD COLUMN {name} {ddl}"))
            have = {row[1] for row in await conn.execute(text("PRAGMA table_info(public_share_links)"))}
            for name, ddl in PUBLIC_LINK_ADDED_COLUMNS:
                if name not in have:
                    await conn.execute(text(f"ALTER TABLE public_share_links ADD COLUMN {name} {ddl}"))
        _ready = True


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

    async def on_after_login(
        self, user: User, request: Request | None = None, response: Response | None = None
    ) -> None:
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
