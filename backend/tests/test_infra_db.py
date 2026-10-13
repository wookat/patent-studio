# -*- coding: utf-8 -*-
"""PostgreSQL 底座：URL 规范、Alembic 往返、模型与迁移无漂移、事务提交/回滚、并发首迁互斥、带密码 URL。

需要真库：PATENT_STUDIO_TEST_DATABASE_URL 指向可建新库的服务器（迁移/建库测试全走一次性库，
不 reset 调用方现成的库）。未设置则跳过。
"""
import asyncio
import os
import subprocess
import sys
import uuid

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine

from patent_studio.infra.db import Database, database_url
from patent_studio.infra.db.migrate import _cfg_url

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_URL = os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL")
needs_pg = pytest.mark.skipif(not TEST_URL, reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL")


def test_database_url_forces_psycopg():
    assert database_url("postgresql://u:p@h:5432/d").drivername == "postgresql+psycopg"
    assert database_url("postgresql+asyncpg://u@h/d").drivername == "postgresql+psycopg"


def test_database_url_rejects_other_backends():
    with pytest.raises(ValueError):
        database_url("sqlite:///studio.db")


def test_dynamic_pg_schema_acquisition_starts_without_database(request):
    """懒取 pg_schema 前默认无库；取到后 fixture 自己注入并缓存 disposable URL。"""
    from patent_studio.settings import get_settings

    assert os.environ.get("PATENT_STUDIO_DATABASE_URL") is None
    assert get_settings().database_url is None
    url = request.getfixturevalue("pg_schema")
    assert os.environ["PATENT_STUDIO_DATABASE_URL"] == url
    assert get_settings().database_url == url


def test_fresh_process_import_order_keeps_sqlalchemy_adapters():
    code = """
import fastapi_users_db_sqlalchemy.generics
from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from patent_studio.domain.identity import User
from app.auth.db import SessionLocal
from app.auth.users import fastapi_users
from app.auth.create_user import main

assert User.__mro__[1] is SQLAlchemyBaseUserTableUUID
assert SessionLocal and SQLAlchemyUserDatabase and fastapi_users and main
"""
    env = {
        "PATENT_STUDIO_AUTH": "on",
        "PATENT_STUDIO_SECRET": "import-order-regression-secret",
        "PYTHONPATH": os.pathsep.join((BACKEND, os.path.join(BACKEND, "src"))),
    }
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr[-4000:]


def _alembic(url: str) -> Config:
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))  # ConfigParser 百分号插值
    return cfg


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_rendered_url_keeps_credentials_and_escapes_percent():
    """含 @ / % 的密码：render_as_string 保留凭据且能往返解析；set_main_option 前 % 要转义为 %%
    （不打印 URL 本体，失败也不把凭据带进日志）。"""
    u = database_url(URL.create("postgresql", username="u", password="p@ss%w0rd", host="h", database="d"))
    rendered = u.render_as_string(hide_password=False)
    masked = "***" in rendered
    assert not masked, "render 后凭据被掩码"
    assert make_url(rendered).password == "p@ss%w0rd"
    # str(URL) 的掩码形态只供日志用，引擎 / 迁移严禁用它
    assert str(u).split("@")[0].endswith(":***")
    cfg = Config()
    cfg.set_main_option("sqlalchemy.url", _cfg_url(u))
    assert make_url(cfg.get_main_option("sqlalchemy.url")).password == "p@ss%w0rd"


@needs_pg
def test_alembic_upgrade_check_downgrade(pg_schema):
    cfg = _alembic(pg_schema)
    command.upgrade(cfg, "head")  # pg_schema 已迁到 head：再跑须幂等
    head = ScriptDirectory.from_config(cfg).get_current_head()
    engine = create_engine(database_url(pg_schema))
    try:
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == head
        command.check(cfg)
        command.downgrade(cfg, "base")
        assert _tables(engine) == {"alembic_version"}
    finally:
        engine.dispose()


@needs_pg
def test_concurrent_upgrade_two_processes():
    """两个独立进程对同一空库并发 upgrade head：env.py 的 advisory xact lock 串行化，
    两边 exit 0，库最终到 head 且 alembic check 无漂移。"""
    name = f"ps_race_{uuid.uuid4().hex[:10]}"
    admin = create_engine(database_url(make_url(TEST_URL).set(database="postgres")), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(TEST_URL).set(database=name).render_as_string(hide_password=False)
    try:
        code = ("import os; from patent_studio.infra.db import upgrade_head; "
                "upgrade_head(os.environ['PS_UPGRADE_URL'])")
        env = {**os.environ, "PS_UPGRADE_URL": url}
        procs = [subprocess.Popen([sys.executable, "-c", code], env=env, cwd=BACKEND,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) for _ in range(2)]
        for p in procs:
            _, err = p.communicate(timeout=180)
            assert p.returncode == 0, err.decode(errors="replace")[-800:]
        cfg = _alembic(url)
        head = ScriptDirectory.from_config(cfg).get_current_head()
        engine = create_engine(database_url(url))
        try:
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == head
            command.check(cfg)
        finally:
            engine.dispose()
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


@needs_pg
def test_temporary_role_password_sync_and_async(pg_database):
    """建个带密码的一次性角色（本机测试专用），同步与异步引擎都按 URL 里的密码连上——
    str(URL) 的 *** 掩码会让两边都认证失败。"""
    base = make_url(pg_database)
    role = f"ps_t_{uuid.uuid4().hex[:10]}"
    pw = "t@st%pw"  # 仅本机测试角色的一次性口令；不落文件不打印
    admin = create_engine(database_url(base.set(database="postgres")), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"CREATE ROLE \"{role}\" LOGIN PASSWORD '{pw}'"))
    try:
        u = database_url(base.set(username=role, password=pw))
        sync_engine = create_engine(u)
        try:
            # Keep this explicit even on trust-auth servers: the engine must retain the password.
            assert sync_engine.url.password == pw
            with sync_engine.connect() as conn:
                assert conn.scalar(text("SELECT 1")) == 1
        finally:
            sync_engine.dispose()

        async def _one():
            async_engine = create_async_engine(u)
            try:
                async with async_engine.connect() as conn:
                    return (await conn.execute(text("SELECT 1"))).scalar()
            finally:
                await async_engine.dispose()

        assert asyncio.run(_one()) == 1
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP ROLE "{role}"'))
        admin.dispose()


@needs_pg
def test_transaction_commits_and_rolls_back(pg_schema):
    async def run():
        db = Database(pg_schema)
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
