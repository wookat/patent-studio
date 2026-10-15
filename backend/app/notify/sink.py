# -*- coding: utf-8 -*-
"""事件订阅者的同步 SQLite 写入口（notifications / org_audit_events）。

events.emit 同步派发：订阅者用同步写法就能在 emit 返回前落库，生产者（建案、导出、登录…）不用等任务，
测试里也不必 drain；TestClient 每个请求换事件循环，异步 handler 在请求结束时会被连同循环一起取消，同步写没有这个问题。
一次本地 SQLite 插入是亚毫秒级，与现有路由里的同步文件 IO 同量级。

引擎按 config.DB_PATH 缓存（测试按 tmp 重载 config 时换库）；建表用同一份 Base.metadata（create_all 幂等）。
只在 PATENT_STUDIO_AUTH=on 时才会被调用——off 模式没有用户，也不建 studio.db。
"""

import secrets
from datetime import UTC, datetime

from sqlalchemy import create_engine, insert
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from app import config

_engines: dict[str, Engine] = {}


def new_id() -> str:
    return secrets.token_urlsafe(16)  # 22 字符，落在 String(24) 内


def ts_of(ev_ts: float) -> datetime:
    return datetime.fromtimestamp(ev_ts, UTC)


def engine() -> Engine:
    from app.auth.models import Base

    eng = _engines.get(config.DB_PATH)
    if eng is None:
        eng = create_engine(f"sqlite:///{config.DB_PATH}", poolclass=NullPool, connect_args={"timeout": 15})
        # WAL + busy_timeout：并行 emit（如并发 agent_run 的 org_audit）写同一 db 时排队而非 database is locked
        with eng.connect() as c:
            c.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(eng)
        _engines[config.DB_PATH] = eng
    return eng


def write(model, rows: list[dict]) -> int:
    if not rows:
        return 0
    run(insert(model.__table__), rows)
    return len(rows)


def run(stmt, params=None) -> None:
    with engine().begin() as conn:
        conn.execute(stmt, params) if params is not None else conn.execute(stmt)
