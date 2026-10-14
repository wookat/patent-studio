# -*- coding: utf-8 -*-
"""事件订阅者与同步读写的 PostgreSQL 写入口（notifications / org_audit_events / project_list_state / 协作设置）。

events.emit 同步派发：订阅者用同步写法就能在 emit 返回前落库，生产者（建案、导出、登录…）不用等任务，
测试里也不必 drain；TestClient 每个请求换事件循环，异步 handler 在请求结束时会被连同循环一起取消，
同步写没有这个问题。

引擎按解析后的 PATENT_STUDIO_DATABASE_URL 懒建并缓存（测试切库后拿新引擎）；schema 归 Alembic 管，
首次连库前懒跑 upgrade head（已迁移的 URL 直接命中 _ready）——AUTH=off 空库也能自愈。
"""
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from sqlalchemy import create_engine, insert
from sqlalchemy.engine import URL, Engine
from sqlalchemy.pool import NullPool

from patent_studio.infra.db import database_url, upgrade_head
from patent_studio.settings import get_settings

_engines: dict[URL, Engine] = {}
_ready: set[URL] = set()


def new_id() -> str:
    return secrets.token_urlsafe(16)  # 22 字符，落在 String(24) 内


def ts_of(ev_ts: float) -> datetime:
    return datetime.fromtimestamp(ev_ts, UTC)


def available() -> bool:
    """配置了 PATENT_STUDIO_DATABASE_URL ⇒ 可落库；否则业务方走降级路径（如列表状态全 active）。"""
    return bool(get_settings().database_url)


def _resolved_url() -> URL:
    """postgresql+psycopg 的 URL 对象：引擎直接吃对象，str(URL) 会把密码 mask 成 ***，严禁字符串化。"""
    url = get_settings().database_url
    if not url:
        raise RuntimeError("未配置数据库：设置 PATENT_STUDIO_DATABASE_URL")
    return database_url(url)


def _ensure_migrated(u: URL) -> None:
    if u in _ready:
        return
    # env.py 在线模式内部是 asyncio.run——emit 可能在事件循环线程里同步走到这里，挪去新线程跑；
    # 线程间串行靠 upgrade_head 的共享锁，跨进程靠 env.py 的 advisory lock
    with ThreadPoolExecutor(1) as pool:
        pool.submit(upgrade_head, u).result()
    _ready.add(u)


def engine() -> Engine:
    """当前 database_url 的同步引擎（按 URL 缓存；首连前确保已迁移）。NullPool：emit 可在任意线程发起。"""
    u = _resolved_url()
    eng = _engines.get(u)
    if eng is None:
        _ensure_migrated(u)
        eng = create_engine(u, poolclass=NullPool)
        _engines[u] = eng
    return eng


def write(model, rows: list[dict]) -> int:
    if not rows:
        return 0
    run(insert(model.__table__), rows)
    return len(rows)


def run(stmt, params=None) -> None:
    with engine().begin() as conn:
        conn.execute(stmt, params) if params is not None else conn.execute(stmt)
