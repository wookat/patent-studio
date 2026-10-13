# -*- coding: utf-8 -*-
"""案件时间线（docs/plan/21 §2.2 R-CASE-05）。share-confirm-backend 所有。

不另建「时间线库」——GET 时把几处已有事实合并成 schemas.TimelineEvent 列表（新→旧）：
  1. `.studio/timeline.jsonl`：本模块自己追加的备注 note / 指派 review.assigned，
     以及事件总线上 case.created · share.created · oa.round · deadline.done · export.downloaded · ai.proposal
     的落盘（订阅在 import 时注册；总线事件是进程内瞬时的，不落盘就丢）。
  2. git 历史里的状态提交（cases.status_message 格式「case: status a → b · note」）→ case.status。
  3. `.studio/audit.jsonl`（MCP 写工具）→ ai.proposal。
  4. case.json.confirmations[] → share.confirmed；case.dates.filed → deliver.filed。
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime
from typing import get_args

from app import atomic, config
from app.domain import cases, events, history
from app.domain.comments import parse_mentions
from app.mcp import audit
from app.schemas import TimelineEventKind

TIMELINE = "timeline.jsonl"
BUS_KINDS: tuple[str, ...] = ("case.created", "share.created", "oa.round", "deadline.done", "deadline.undone",
                              "deadline.override", "export.downloaded", "ai.proposal")
_AUDIT_WRITE_TOOLS = {"patch_block", "insert_block", "add_comment", "set_figure_order", "set_case_status"}


def _path(project_dir: str) -> str:
    return os.path.join(project_dir, ".studio", TIMELINE)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def append(project_dir: str, item: dict) -> dict:
    """写一条 TimelineEvent 到 .studio/timeline.jsonl（缺 id/ts 补齐）。"""
    item.setdefault("id", _new_id("tl"))
    item.setdefault("ts", time.time())
    item.setdefault("actor", None)
    item.setdefault("mentions", [])
    item.setdefault("data", {})
    p = _path(project_dir)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False))
        f.write("\n")
    return item


def _stored(project_dir: str) -> list[dict]:
    p = _path(project_dir)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [json.loads(ln) for ln in f if ln.strip()]


def add_note(project_dir: str, body: str, actor: dict | None) -> dict:
    return append(project_dir, {"kind": "note", "text": body, "actor": actor, "mentions": parse_mentions(body)})


def assign_review(project_dir: str, assignee: dict, due: str, actor: dict | None) -> dict:
    return append(project_dir, {"kind": "review.assigned", "text": f"指派 {assignee['display_name']} 审阅，截止 {due}",
                                "actor": actor, "mentions": [assignee["display_name"]],
                                "data": {"user_id": assignee["id"], "due": due}})


def add_review_deadline(project_dir: str, due: str, note: str) -> None:
    """写 case.json.deadlines[]（cases.Deadline，kind=review_due）；deadlines 单元合入后改调其 add()。"""
    with atomic.studio_lock(project_dir, "case"):
        case = cases.ensure_case(project_dir)
        case.deadlines.append(cases.Deadline(kind="review_due", due=due, note=note))
        cases.save_case(project_dir, case)


# ---------------- 合并 ----------------

_STATUS_RE = re.compile(r"^case: status (\S+) → (\S+)(?: · (.*))?$")


def _from_history(project_dir: str) -> list[dict]:
    out = []
    for h in history.log(project_dir):
        m = _STATUS_RE.match(h["message"])
        if not m:
            continue
        frm, to, note = m.group(1), m.group(2), m.group(3) or ""
        actor = {"id": h["author"], "display_name": h["author"]} if h.get("author") else None
        out.append({"id": f"st-{h['sha'][:10]}", "kind": "case.status", "ts": float(h["at"]),
                    "actor": actor, "text": f"状态：{frm} → {to}" + (f"（{note}）" if note else ""),
                    "data": {"from": frm, "to": to, "note": note, "sha": h["sha"]}})
    return out


def _from_audit(project_dir: str) -> list[dict]:
    out = []
    for i, rec in enumerate(audit.tail(project_dir, limit=500)):
        tool = rec.get("tool", "")
        if tool not in _AUDIT_WRITE_TOOLS:
            continue
        try:
            ts_f = datetime.fromisoformat(rec["ts"]).timestamp()
        except (KeyError, ValueError):
            ts_f = 0.0
        out.append({"id": f"au-{i}-{int(ts_f)}", "kind": "ai.proposal", "ts": ts_f,
                    "actor": {"id": rec.get("who") or "mcp", "display_name": rec.get("who") or "外部智能体"},
                    "text": f"MCP 工具 {tool}",
                    "data": {"tool": tool, "result": rec.get("result", "ok"), "args": rec.get("args", {})}})
    return out


def _from_case(project_dir: str) -> list[dict]:
    case = cases.ensure_case(project_dir)
    out = []
    for i, c in enumerate(case.confirmations):
        out.append({"id": f"cf-{i}-{int(c.confirmed_at)}", "kind": "share.confirmed", "ts": c.confirmed_at,
                    "actor": {"id": c.actor, "display_name": c.name},
                    "text": f"{c.name} 确认定稿（v{c.version}）" + (f"：{c.note}" if c.note else ""),
                    "data": {"version": c.version, "sha": c.sha, "note": c.note}})
    if case.dates.filed:
        filed = case.dates.filed  # YYYY-MM-DD
        ts = datetime.fromisoformat(filed).timestamp()
        out.append({"id": f"filed-{filed}", "kind": "deliver.filed", "ts": ts, "actor": None,
                    "text": f"已递交（{filed}）" + (f"，申请号 {case.case_no}" if case.case_no else ""),
                    "data": {"filed": filed, "case_no": case.case_no}})
    return out


# 接口 kind 集（schemas 契约）：jsonl 里未声明的 kind 会撞响应校验 500，落盘超前契约时就地丢弃
_VALID_KINDS = frozenset(get_args(TimelineEventKind))


def merged(project_dir: str, kinds: set[str] | None = None) -> list[dict]:
    items = _stored(project_dir) + _from_history(project_dir) + _from_audit(project_dir) + _from_case(project_dir)
    items = [it for it in items if it["kind"] in _VALID_KINDS]
    if kinds:
        items = [it for it in items if it["kind"] in kinds]
    items.sort(key=lambda it: it.get("ts", 0), reverse=True)
    return items


# ---------------- 事件总线落盘 ----------------

_BUS_TEXT = {
    "case.created": "新建案件",
    "share.created": "创建审阅链接",
    "oa.round": "新增审查意见轮次",
    "deadline.done": "期限已完成",
    "deadline.undone": "撤销期限完成",
    "export.downloaded": "导出下载",
    "ai.proposal": "AI 提案",
}


def _bus_text(ev: events.Event) -> str:
    # 改期的关键信息是新日期+理由——静态标签装不下，按 data 拼（其余 kind 用静态表）
    if ev.kind == "deadline.override":
        t = f"期限改期 → {ev.data.get('to', '')}"
        reason = ev.data.get("reason")
        return f"{t}（{reason}）" if reason else t
    return _BUS_TEXT[ev.kind]


def _on_bus(ev: events.Event) -> None:
    d = os.path.join(config.PROJECTS_DIR, ev.pid)
    if not os.path.isdir(d):
        return
    append(d, {"kind": ev.kind, "ts": ev.ts, "actor": ev.actor, "text": _bus_text(ev), "data": dict(ev.data)})


def subscribe() -> None:
    """幂等（events.subscribe 对同一 handler 去重）；events.reset() 后需再调。"""
    for k in BUS_KINDS:
        events.subscribe(k, _on_bus)


subscribe()
