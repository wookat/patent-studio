# -*- coding: utf-8 -*-
"""机构级审计（docs/plan/21 §2 R-ADM-02；notify-audit-backend）：事件总线 → `org_audit_events` 表。

订阅 "*"，只落 schemas.OrgAuditKind 声明的 kind（auth.login / case.* / member.changed / admin.user / share.* /
export.downloaded / ai.sent / deliver.filed / oa.round / deadline.* / comment.assign——批72 起案务关键动作
同样入机构审计），其余事件（comment.mention、deadline.due、agent 内部遥测…）是案内时间线/通知的事，
不进机构审计。
data 原样存 JSON（生产者只放字段级元数据：fmt / role / email / model / tokens…，不放正文），actor 只存 user id，
展示名查询时 JOIN user。案内 `.studio/audit.jsonl`（MCP）不变。

查询：actor / pid / kind / from / to（epoch 秒或 YYYY-MM-DD）；limit 默认 200；total 是筛选后的总数。
CSV：UTF-8 带 BOM（Excel 直接打开中文不乱码），列 ts,kind,actor_id,actor_name,pid,data。
写入同步（notify/sink.py），off 模式不写、不建库。
"""
import csv
import io
import json
import uuid
from datetime import UTC, date, datetime, time
from typing import get_args

from app import config
from app.domain import events
from app.notify import sink
from app.schemas import Actor, OrgAuditEvent, OrgAuditKind, OrgAuditResponse

KINDS: frozenset[str] = frozenset(get_args(OrgAuditKind))
LIMIT_DEFAULT = 200
LIMIT_MAX = 5000
CSV_COLUMNS = ("ts", "kind", "actor_id", "actor_name", "pid", "data")


def on_event(ev: events.Event) -> None:
    if not config.AUTH_ON or ev.kind not in KINDS:
        return
    actor = (ev.actor or {}).get("id")
    try:
        actor_id = uuid.UUID(str(actor)) if actor else None
    except ValueError:
        actor_id = None
    from app.auth.models import OrgAuditEvent as Row

    sink.write(Row, [{
        "id": sink.new_id(), "ts": sink.ts_of(ev.ts), "kind": ev.kind, "actor_user_id": actor_id,
        "project_id": ev.pid, "data": json.dumps(ev.data, ensure_ascii=False, default=str),
    }])


def install() -> None:
    events.subscribe("*", on_event)


# ---------------------------------------------------------------- 查询 ----

def parse_when(v: str | None, *, end: bool = False) -> datetime | None:
    """`from`/`to`：epoch 秒或 YYYY-MM-DD（to 取当天 23:59:59.999999）。"""
    if not v:
        return None
    try:
        return datetime.fromtimestamp(float(v), UTC)
    except ValueError:
        pass
    d = date.fromisoformat(v)
    return datetime.combine(d, time.max if end else time.min, tzinfo=UTC)


def _out(row, user) -> OrgAuditEvent:
    from app.auth import acl

    try:
        data = json.loads(row.data or "{}")
    except ValueError:
        data = {}
    return OrgAuditEvent(
        id=row.id, ts=acl.utc(row.ts).timestamp(), kind=row.kind,
        actor=Actor(id=str(user.id), display_name=user.display_name or user.email, avatar_color=user.avatar_color or "")
        if user is not None else None,
        pid=row.project_id, data=data,
    )


async def query(*, actor: str | None = None, pid: str | None = None, kind: str | None = None,
                since: datetime | None = None, until: datetime | None = None,
                limit: int = LIMIT_DEFAULT) -> OrgAuditResponse:
    from sqlalchemy import func, select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import OrgAuditEvent as Row
    from app.auth.models import User

    await init_db()
    conds = []
    if actor:
        try:
            conds.append(Row.actor_user_id == uuid.UUID(actor))
        except ValueError:
            # 非 id ⇒ 按姓名 / 邮箱包含匹配（管理员在界面里输的是人名）
            like = f"%{actor.strip()}%"
            conds.append(Row.actor_user_id.in_(
                select(User.id).where(User.display_name.ilike(like) | User.email.ilike(like))))
    if pid:
        conds.append(Row.project_id == pid)
    if kind:
        conds.append(Row.kind == kind)
    if since is not None:
        conds.append(Row.ts >= since.astimezone(UTC).replace(tzinfo=None))
    if until is not None:
        conds.append(Row.ts <= until.astimezone(UTC).replace(tzinfo=None))
    limit = max(1, min(limit, LIMIT_MAX))
    async with SessionLocal() as s:
        total = await s.scalar(select(func.count()).select_from(Row).where(*conds))
        rows = await s.execute(select(Row, User).outerjoin(User, User.id == Row.actor_user_id).where(*conds)
                               .order_by(Row.ts.desc(), Row.id).limit(limit))
        return OrgAuditResponse(items=[_out(r, u) for r, u in rows], total=total or 0)


def to_csv(items: list[OrgAuditEvent]) -> str:
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    for it in items:
        w.writerow([
            datetime.fromtimestamp(it.ts, UTC).isoformat(timespec="seconds"), it.kind,
            it.actor.id if it.actor else "", it.actor.display_name if it.actor else "", it.pid or "",
            json.dumps(it.data, ensure_ascii=False, sort_keys=True),
        ])
    return buf.getvalue()
