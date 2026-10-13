# -*- coding: utf-8 -*-
"""PostgreSQL 底座：URL 规范、Alembic 往返、模型与迁移无漂移、事务提交/回滚。

需要真库：PATENT_STUDIO_TEST_DATABASE_URL 指向一个可随意清空的空库，未设置则跳过。
"""
import asyncio
import os

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from patent_studio.infra.db import Database, database_url

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_URL = os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL")
needs_pg = pytest.mark.skipif(not TEST_URL, reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL")


def test_database_url_forces_psycopg():
    assert database_url("postgresql://u:p@h:5432/d").drivername == "postgresql+psycopg"
    assert database_url("postgresql+asyncpg://u@h/d").drivername == "postgresql+psycopg"


def test_database_url_rejects_other_backends():
    with pytest.raises(ValueError):
        database_url("sqlite:///studio.db")


def _alembic() -> Config:
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_URL or "")
    return cfg


def _reset(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))


@pytest.fixture
def clean_db():
    engine = create_engine(database_url(TEST_URL))
    _reset(engine)
    yield engine
    _reset(engine)
    engine.dispose()


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


@needs_pg
def test_alembic_upgrade_check_downgrade(clean_db):
    cfg = _alembic()
    command.upgrade(cfg, "head")
    head = ScriptDirectory.from_config(cfg).get_current_head()
    with clean_db.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == head
    command.check(cfg)
    command.downgrade(cfg, "base")
    assert _tables(clean_db) == {"alembic_version"}


@needs_pg
def test_transaction_commits_and_rolls_back(clean_db):
    async def run():
        db = Database(TEST_URL)
        try:
            async with db.transaction() as s:
                await s.execute(text("CREATE TABLE t (v int)"))
                await s.execute(text("INSERT INTO t VALUES (1)"))
            with pytest.raises(RuntimeError):
                async with db.transaction() as s:
                    await s.execute(text("INSERT INTO t VALUES (2)"))
                    raise RuntimeError
            async with db.transaction() as s:
                return (await s.execute(text("SELECT v FROM t"))).scalars().all()
        finally:
            await db.dispose()

    assert asyncio.run(run()) == [1]
