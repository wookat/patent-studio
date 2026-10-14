# -*- coding: utf-8 -*-
"""Alembic `upgrade head` 的程序化入口：应用层懒迁移（auth.init_db / notify.sink 引擎首连）共用。

跨进程互斥由 env.py 在线迁移里的 PG advisory xact lock 兜底；本函数再持一把进程内共享锁——
Alembic 的 EnvironmentContext 是全局状态，多线程并发跑 upgrade 会互踩，不能只在各调用方各加锁。
"""

import os
import threading

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL

from patent_studio.infra.db.engine import database_url

_MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")
_lock = threading.Lock()


def _cfg_url(u: URL) -> str:
    """给 set_main_option 用的 URL 字符串：render_as_string(hide_password=False) 保留凭据（str() 会把密码
    mask 成 ***），且 % 要写成 %%——ConfigParser 做百分号插值，%40 会被当转义吃回去。"""
    return u.render_as_string(hide_password=False).replace("%", "%%")


def upgrade_head(url: str | URL) -> None:
    """把 url 指向的库迁到 head（幂等；进程内经 _lock 串行，跨进程由 env.py 的 advisory lock 互斥）。"""
    u = database_url(url)
    with _lock:
        cfg = Config()
        cfg.set_main_option("script_location", _MIGRATIONS_DIR)
        cfg.set_main_option("sqlalchemy.url", _cfg_url(u))
        command.upgrade(cfg, "head")
