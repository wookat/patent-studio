# -*- coding: utf-8 -*-
"""异步引擎与事务单元。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def database_url(url: str | URL) -> URL:
    """规范为 postgresql+psycopg；非 PostgreSQL 直接拒绝（平台只支持这一种数据库）。"""
    u = make_url(url)
    if u.get_backend_name() != "postgresql":
        raise ValueError(f"只支持 PostgreSQL，收到 {u.get_backend_name()!r}")
    return u.set(drivername="postgresql+psycopg")


class Database:
    def __init__(self, url: str | URL, *, echo: bool = False) -> None:
        self.engine = create_async_engine(database_url(url), pool_pre_ping=True, echo=echo)
        self._sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[AsyncSession]:
        """一个事务单元：正常退出提交，异常回滚。"""
        async with self._sessions() as session, session.begin():
            yield session

    async def dispose(self) -> None:
        await self.engine.dispose()
