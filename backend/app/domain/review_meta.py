# -*- coding: utf-8 -*-
"""修订元数据（Word 式「作者 · 时间」）：<project>/reviews/marks.json。

CriticMarkup 本身没有作者 / 时间字段，元数据在每次落盘时按「新出现的标记」记录：
key = kind + 原文侧 + 新文侧（标记内容本身，不含行号——行号随编辑漂移，内容不变）；
同一内容在两处出现共享一条元数据（同一人同一批改动，可接受）。
落盘时已不存在的 key 顺手清掉，文件随未决修订的多少收缩。
"""
import contextvars
import json
import os
import time

from app import atomic
from patent_studio.kernel import critic

FILE = os.path.join("reviews", "marks.json")

# 当前写入者（display_name 或 email）：由路由层在 save_content 前设置；协同 / 脚本写入为 None 时按「未知作者」。
_author: contextvars.ContextVar[str | None] = contextvars.ContextVar("review_author", default=None)


def author_of(user) -> str | None:
    if user is None:
        return None
    return user.display_name or user.email


class writer:
    """with review_meta.writer(name): store.save_content(...)"""

    def __init__(self, name: str | None):
        self.name = name
        self._token = None

    def __enter__(self):
        self._token = _author.set(self.name)
        return self

    def __exit__(self, *exc):
        if self._token is not None:
            _author.reset(self._token)


def key(mark: dict) -> str:
    return "\u0001".join((mark["kind"], mark["a"], mark["b"]))


def _path(project_dir: str) -> str:
    return os.path.join(project_dir, FILE)


def load(project_dir: str) -> dict[str, dict]:
    p = _path(project_dir)
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(project_dir: str, meta: dict[str, dict]) -> None:
    p = _path(project_dir)
    if not meta:
        if os.path.isfile(p):
            os.remove(p)
        return
    atomic.write_json(p, meta)


def record(project_dir: str, old_content: str, new_content: str, author: str | None = None) -> None:
    """落盘钩子：新出现的标记记 {author, at}（已有同内容记录则保留最早的）；消失的标记清掉。无标记变化时不读不写。"""
    if "{" not in old_content and "{" not in new_content:
        return
    old_keys = {key(m) for m in critic.parse(old_content)}
    new_keys = {key(m) for m in critic.parse(new_content)}
    if old_keys == new_keys:
        return
    # R93：load→mutate→_save 跨进程 RMW（web 保存 ↔ stdio MCP save_content）→ studio_lock 串行化
    with atomic.studio_lock(project_dir, "review-meta"):
        meta = load(project_dir)
        if author is None:
            author = _author.get()
        now = time.time()
        for k in new_keys - old_keys:
            meta.setdefault(k, {"author": author, "at": now})
        for k in [k for k in meta if k not in new_keys]:
            del meta[k]
        _save(project_dir, meta)


def attach(project_dir: str, marks: list[dict], pending_author: str | None = None) -> list[dict]:
    """给 critic.parse 的 marks 补 author / at（无记录 ⇒ None）。

    `pending_author`：调用方送来的是尚未落盘的正文时，尚无记录的标记就是这位编辑者刚敲出来的，
    先按它填作者·当前时间，免得卡片要等去抖落盘后才显示；落盘时 `record` 仍以实际写入者为准。
    """
    meta = load(project_dir)
    now = time.time()
    for m in marks:
        rec = meta.get(key(m))
        if rec:
            m["author"] = rec.get("author")
            m["at"] = rec.get("at")
        else:
            m["author"] = pending_author
            m["at"] = now if pending_author is not None else None
    return marks
