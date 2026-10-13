import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

# s8 先行技术检索：测试环境默认不给 provider，防用例真发外部请求；单测用 monkeypatch 按需打开
os.environ.setdefault("PATENT_STUDIO_PRIOR_ART_PROVIDERS", "")


@pytest.fixture(scope="session")
def pg_database():
    """在 PATENT_STUDIO_TEST_DATABASE_URL 指向的服务器上创建并清理随机测试库。"""
    test_url = os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL")
    if not test_url:
        pytest.skip("未设置 PATENT_STUDIO_TEST_DATABASE_URL")
    import uuid

    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from patent_studio.infra.db import database_url
    url = make_url(test_url)
    name = f"ps_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(database_url(url.set(database="postgres")), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    db_url = url.set(database=name).render_as_string(hide_password=False)  # str(URL) 会 mask 密码
    try:
        yield db_url
    finally:
        try:
            with admin.connect() as conn:
                conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        finally:
            admin.dispose()


@pytest.fixture(autouse=True)
def _safe_database_env():
    """默认无应用库；需要数据库的 fixture 自己临时注入 disposable 库。"""
    from patent_studio.settings import get_settings

    marker = object()
    prev = os.environ.pop("PATENT_STUDIO_DATABASE_URL", marker)
    get_settings.cache_clear()
    try:
        yield
    finally:
        try:
            if prev is marker:
                os.environ.pop("PATENT_STUDIO_DATABASE_URL", None)
            else:
                os.environ["PATENT_STUDIO_DATABASE_URL"] = prev
        finally:
            get_settings.cache_clear()


@pytest.fixture()
def pg_schema(pg_database):
    """每个用例一套空 schema：DROP / CREATE public 后 alembic upgrade head（等价全新迁移过的库）。"""
    from sqlalchemy import create_engine, text

    from patent_studio.infra.db import database_url, upgrade_head
    from patent_studio.settings import get_settings

    marker = object()
    prev = os.environ.pop("PATENT_STUDIO_DATABASE_URL", marker)
    os.environ["PATENT_STUDIO_DATABASE_URL"] = pg_database
    get_settings.cache_clear()
    try:
        eng = create_engine(database_url(pg_database))
        try:
            with eng.begin() as conn:
                conn.execute(text("DROP SCHEMA public CASCADE"))
                conn.execute(text("CREATE SCHEMA public"))
        finally:
            eng.dispose()
        upgrade_head(pg_database)
        yield pg_database
    finally:
        try:
            if prev is marker:
                os.environ.pop("PATENT_STUDIO_DATABASE_URL", None)
            else:
                os.environ["PATENT_STUDIO_DATABASE_URL"] = prev
        finally:
            get_settings.cache_clear()


@pytest.fixture()
def no_db(monkeypatch):
    """摘掉 PATENT_STUDIO_DATABASE_URL 并清 settings 缓存：验证无库部署的降级行为。"""
    monkeypatch.delenv("PATENT_STUDIO_DATABASE_URL", raising=False)
    from patent_studio.settings import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
