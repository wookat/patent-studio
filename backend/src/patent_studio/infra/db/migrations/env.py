# -*- coding: utf-8 -*-
"""Alembic 环境：URL 优先取 alembic.ini / -x 覆盖，其次 PATENT_STUDIO_DATABASE_URL。"""

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# B1 批尚未搬入 domain/ 层，Base.metadata 暂为空——现有迁移全部为显式 op.* DDL，
# 不依赖 metadata；后续批次搬入 domain/*.py 后需在此恢复对应 import 以支持 autogenerate。
from patent_studio.infra.db import Base, database_url
from patent_studio.settings import get_settings

config = context.config
target_metadata = Base.metadata


def _url():
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    if not url:
        raise RuntimeError("未配置数据库：设置 PATENT_STUDIO_DATABASE_URL")
    return database_url(url)


def _configure(**kw) -> None:
    context.configure(target_metadata=target_metadata, compare_type=True, **kw)


def run_migrations_offline() -> None:
    _configure(url=_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


# 迁移互斥：多 worker / 多进程同时首迁同一空库时串行化。锁取在迁移事务内部（pg_advisory_xact_lock
# 生命周期 = 本事务），alembic_version 的读与建与全部 DDL 包在同一连接同一事务里，提交/回滚即释放。
_MIGRATION_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('patent_studio:migrations'))"


def _run_sync(connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        connection.execute(text(_MIGRATION_LOCK_SQL))
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as connection:
        await connection.run_sync(_run_sync)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
