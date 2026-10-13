# -*- coding: utf-8 -*-
"""W5 进程内事件总线（docs/plan/21 §7.4.8）：单元之间只经事件解耦，不互相 import。

用法：
    from app.domain import events
    events.emit("share.confirmed", pid="method", actor=user_out, data={"version": 3})
    unsub = events.subscribe("share.confirmed", handler)          # handler(ev: Event) -> None | Awaitable
    unsub = events.subscribe("*", audit_handler)                 # 通配：全部事件

- `emit` 同步派发；handler 是协程函数时若有运行中的事件循环则 create_task，否则直接 asyncio.run（测试 / 脚本）。
- handler 异常只记日志，不影响发起方（通知 / 审计失败不能让业务写入回滚）。
- `kinds()` 是全部事件名（Literal）；`emit` 未知事件名抛 ValueError，避免拼错静默丢失。
- 生产者 / 消费者对照（integrate 接线时逐条核对）：
    case.created / case.status      main.create_project / routes_cases  → timeline、org_audit（status 入审计）
    case.deleted                    routes_cases（bulk）                → org_audit
    share.created / share.revoked   routes_public（share-confirm）      → org_audit、timeline
    share.confirmed                 routes_public                      → notify（owner/agent）、timeline、org_audit
    share.commented                 routes_public（客户免登录批注）      → notify（责任人 / owner / agent / 超管兜底）
    comment.mention / comment.assign routes_comments                   → notify / org_audit（assign）
    deadline.due / deadline.done    deadlines.compute / routes_deadlines → notify、timeline、org_audit
    deadline.undone                 routes_deadlines                   → timeline、org_audit
    deadline.override               routes_deadlines                   → timeline、org_audit
    deadline.nudge                  routes_notify                      → notify、org_audit
    oa.round                        routes_oa（oa-import）              → deadlines.add、timeline、org_audit
    deliver.filed                   routes_deliver                     → timeline、org_audit
    export.downloaded               main.export / routes_deliver       → org_audit、timeline
    ai.sent / ai.proposal           agent.loop（agent-core）            → org_audit / notify、timeline
    auth.login                      auth.db.UserManager.on_after_login → org_audit
    member.changed                  auth.router / auth.invites         → org_audit
    admin.user                      auth.routes_admin                  → org_audit
"""
import asyncio
import inspect
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal, get_args

log = logging.getLogger(__name__)

EventKind = Literal[
    "case.created", "case.status", "case.deleted",
    "share.created", "share.revoked", "share.confirmed", "share.commented",
    "comment.mention", "comment.assign",
    "deadline.due", "deadline.done", "deadline.undone", "deadline.override", "deadline.nudge",
    "oa.round",
    "deliver.filed", "export.downloaded",
    "ai.sent", "ai.proposal",
    "auth.login", "member.changed", "admin.user",
]
EVENT_KINDS: frozenset[str] = frozenset(get_args(EventKind))
WILDCARD = "*"


@dataclass(frozen=True)
class Event:
    kind: str
    ts: float
    pid: str | None
    actor: dict | None  # {id, display_name} | None（系统 / 匿名）
    data: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "ts": self.ts, "pid": self.pid, "actor": self.actor, "data": dict(self.data)}


Handler = Callable[[Event], None | Awaitable[None]]

_subs: dict[str, list[Handler]] = {}


def kinds() -> tuple[str, ...]:
    return get_args(EventKind)


def subscribe(kind: str, handler: Handler) -> Callable[[], None]:
    """订阅一种事件（或 "*"）；返回退订函数。重复订阅同一 handler 只保留一份。"""
    if kind != WILDCARD and kind not in EVENT_KINDS:
        raise ValueError(f"未知事件 {kind!r}")
    lst = _subs.setdefault(kind, [])
    if handler not in lst:
        lst.append(handler)

    def unsub() -> None:
        cur = _subs.get(kind)
        if cur and handler in cur:
            cur.remove(handler)
            if not cur:
                _subs.pop(kind, None)

    return unsub


def subscribers(kind: str) -> list[Handler]:
    return list(_subs.get(kind, ())) + (list(_subs.get(WILDCARD, ())) if kind != WILDCARD else [])


def actor_of(user) -> dict | None:
    """emit(actor=) 的统一形状 {id, display_name}；None 用户 → None（系统 / 匿名）。"""
    if user is None:
        return None
    return {"id": str(user.id), "display_name": user.display_name or user.email}


def emit(kind: str, *, pid: str | None = None, actor: dict | None = None, data: dict | None = None,
         ts: float | None = None) -> Event:
    """派发事件；返回 Event（便于调用方写时间线 / 审计时复用 ts）。"""
    if kind not in EVENT_KINDS:
        raise ValueError(f"未知事件 {kind!r}")
    ev = Event(kind, ts if ts is not None else time.time(), pid, actor, dict(data or {}))
    for h in subscribers(kind):
        _dispatch(h, ev)
    return ev


def _dispatch(handler: Handler, ev: Event) -> None:
    try:
        r = handler(ev)
    except Exception:  # noqa: BLE001 — 消费者失败不能波及生产者
        log.exception("事件 %s 处理失败：%s", ev.kind, getattr(handler, "__name__", handler))
        return
    if inspect.isawaitable(r):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            task = loop.create_task(_await(r, ev.kind))
            _pending.add(task)
            task.add_done_callback(_pending.discard)
        else:
            asyncio.run(_await(r, ev.kind))


async def _await(aw: Awaitable[None], kind: str) -> None:
    try:
        await aw
    except Exception:  # noqa: BLE001
        log.exception("事件 %s 异步处理失败", kind)


_pending: set[asyncio.Task] = set()


async def drain() -> None:
    """等待所有已派发的异步 handler 完成（测试 / 进程退出前用）。"""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


def reset() -> None:
    """清空全部订阅（仅测试用）。"""
    _subs.clear()
