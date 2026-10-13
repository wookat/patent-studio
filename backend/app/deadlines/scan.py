# -*- coding: utf-8 -*-
"""到期扫描：每小时扫全部 case.json，对未完成且剩余 30 / 7 / 1 天的期限 emit 事件 {days: 30|7|1}。

只 emit，不写通知（通知由 notify-audit-backend 订阅）。事件名用 prep events.py 已登记、注释标为
「deadlines.compute → notify」的 "deadline.due"（规格写的 deadline.due_soon 尚未登记到 EventKind，emit 会抛
ValueError）。
挂载方式（main.py lifespan，integrate 汇总）：
    task = asyncio.create_task(deadlines.scan.run_forever(config.PROJECTS_DIR))
    ...
    task.cancel()
"""
import asyncio
import logging
import os
from datetime import date

from app.deadlines import compute
from app.domain import cases, events

log = logging.getLogger(__name__)

EVENT = "deadline.due"
DUE_SOON_DAYS: tuple[int, ...] = (30, 7, 1)
INTERVAL_SECONDS = 3600


def due_soon(case: cases.Case, today: date) -> list[tuple[cases.Deadline, int]]:
    """未完成且剩余天数正好为 30 / 7 / 1 的期限。"""
    out = []
    for d in case.deadlines:
        if d.done:
            continue
        days = (date.fromisoformat(d.due) - today).days
        if days in DUE_SOON_DAYS:
            out.append((d, days))
    return out


def scan_once(projects_dir: str, today: date | None = None) -> int:
    """扫一遍，返回 emit 条数。case.json 不存在的案子跳过（不在这里生成默认台账）。"""
    today = today or compute.today()
    n = 0
    if not os.path.isdir(projects_dir):
        return 0
    for pid in sorted(os.listdir(projects_dir)):
        project_dir = os.path.join(projects_dir, pid)
        if not os.path.isfile(cases.case_path(project_dir)):
            continue
        case = cases.load_case(project_dir)
        for d, days in due_soon(case, today):
            events.emit(EVENT, pid=pid, data={"id": d.id, "deadline_id": d.id, "kind": d.kind, "title": d.title,
                                               "due": d.due, "days": days, "days_left": days,
                                               "owner_user_id": case.owner_user_id, "user_id": case.owner_user_id})
            n += 1
    return n


async def run_forever(projects_dir: str, interval: float = INTERVAL_SECONDS) -> None:
    while True:
        try:
            scan_once(projects_dir)
        except Exception:  # noqa: BLE001 — 单轮失败不能终止定时任务
            log.exception("期限扫描失败")
        await asyncio.sleep(interval)
