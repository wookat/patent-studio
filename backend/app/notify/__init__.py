# -*- coding: utf-8 -*-
"""站内通知（docs/plan/21 §2 R-HOME-07 / R-REV-03 / R-MOB-04 后端；notify-audit-backend）。

事件总线（events.py）是唯一入口：业务模块只 emit，本包订阅并写 `notifications` 表（跨用户数据进 SQLite，B5）。
订阅 → 通知 kind 对照（事件名以 prep events.EventKind 为准，规格里的 due_soon / mentioned / review.assigned /
proposal.applied|dismissed 分别对应 deadline.due / comment.mention / comment.assign / ai.proposal{action}）：

  deadline.due     {deadline_id?, title?, kind?, due, days_left, user_id?}  → deadline  收件人 = user_id 或案责任人
  comment.mention  {cid, user_ids | user_id, quote?}                       → mention   href #/p/{pid}?c={cid}
  comment.assign   {cid?, user_id, due?}                                   → assign    审阅指派
  share.confirmed  {name, version}                                         → confirm   案责任人，无则 owner→agent→超管
  share.commented  {cid, name, quote}                                      → mention   同上，href #/p/{pid}?c={cid}
  ai.proposal      {proposal_id, action: applied|dismissed, user_id?, title?} → ai    只在 action 为二者之一时
  case.created      —（不发通知；把机构默认协作设置写进新案，R-ADM-03）

催办（POST /projects/{pid}/nudge）由 routes_notify 直接 `create()` 再 emit deadline.nudge 给时间线 / 其他消费者，
本包不再订阅 deadline.nudge，避免写两条。发起人自己不收自己触发的通知。
可选邮件：收件人有邮箱且配置了 PATENT_STUDIO_SMTP_URL 时随站内通知发一封（mail.py），失败不影响业务。

写入是同步的（sink.py）；读取 / 已读走 SQLAlchemy async（与 acl / access 同一套会话）。
"""
import asyncio
import logging
import os
import uuid
from datetime import UTC, datetime

from app import config
from app.domain import events
from app.domain.cases import load_case
from app.notify import mail, sink, webhook
from app.schemas import Actor, Notification, NotificationListResponse

log = logging.getLogger("patent_studio.notify")

# 与 schemas.NotificationKind 一致
KINDS = ("mention", "assign", "deadline", "confirm", "ai", "nudge", "system")
TITLE_MAX = 200
LIST_LIMIT_MAX = 200


def project_href(pid: str, *, c: str | None = None, focus: str | None = None, panel: str | None = None,
                 dl: str | None = None) -> str:
    """工作台 hash（lib/hash.ts 契约）：#/p/<pid>?panel=<伴随栏 id>&dl=<期限 id>&c=<批注 id>&focus=<块 id>。"""
    q = "&".join(f"{k}={v}" for k, v in (("panel", panel), ("dl", dl), ("c", c), ("focus", focus)) if v)
    return f"#/p/{pid}" + (f"?{q}" if q else "")


def _uuid(v) -> uuid.UUID | None:
    if v is None:
        return None
    try:
        return uuid.UUID(str(v))
    except ValueError:
        return None


def _actor_id(ev: events.Event) -> uuid.UUID | None:
    return _uuid((ev.actor or {}).get("id"))


def _actor_name(ev: events.Event) -> str:
    return (ev.actor or {}).get("display_name") or "同事"


def case_owner(pid: str | None) -> uuid.UUID | None:
    if not pid:
        return None
    d = os.path.join(config.PROJECTS_DIR, pid)
    if not os.path.isdir(d):
        return None
    try:
        return _uuid(load_case(d).owner_user_id)
    except Exception:  # noqa: BLE001 — case.json 坏了不该让事件消费失败传播
        return None


# ---------------------------------------------------------------- 写 ----

def create(user_ids, kind: str, title: str, *, body: str = "", pid: str | None = None, href: str | None = None,
           actor_id: uuid.UUID | None = None, ts: float | None = None) -> int:
    """给一组用户各写一条未读通知；去重、跳过发起人自己与非法 id；返回写入条数。off 模式不写。"""
    if not config.AUTH_ON or kind not in KINDS:
        return 0
    seen: set[uuid.UUID] = set()
    rows = []
    now = sink.ts_of(ts) if ts is not None else datetime.now(UTC)
    for raw in user_ids:
        uid = _uuid(raw)
        if uid is None or uid in seen or uid == actor_id:
            continue
        seen.add(uid)
        rows.append({
            "id": sink.new_id(), "user_id": uid, "kind": kind, "title": title[:TITLE_MAX], "body": body,
            "href": href, "project_id": pid, "actor_user_id": actor_id, "read_at": None, "created_at": now,
        })
    from app.auth.models import Notification as Row

    n = sink.write(Row, rows)
    if n and mail.configured():
        _schedule_mail([r["user_id"] for r in rows], title, body)
    if n:
        webhook.send(title=title, body=body, kind=kind, pid=pid, href=href)
    return n


_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    """同步 handler 里需要异步会话（查邮箱 / ACL / 写协作设置）的尾巴：有事件循环就挂任务，否则直接跑完。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
        return
    task = loop.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def drain() -> None:
    """等待 _spawn 出去的任务（测试用）。"""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


def _schedule_mail(user_ids: list[uuid.UUID], title: str, body: str) -> None:
    _spawn(_mail_users(user_ids, title, body))


async def _mail_users(user_ids: list[uuid.UUID], title: str, body: str) -> None:
    from sqlalchemy import select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import User

    await init_db()
    async with SessionLocal() as s:
        emails = list(await s.scalars(select(User.email).where(User.id.in_(user_ids), User.is_active.is_(True))))
    for to in emails:
        await mail.send(to, f"[Patent Studio] {title}", body or title)


# ---------------------------------------------------------------- 订阅者 ----

def _recipients(data: dict) -> list:
    if data.get("user_ids"):
        return list(data["user_ids"])
    return [data["user_id"]] if data.get("user_id") else []


def on_deadline_due(ev: events.Event) -> None:
    d = ev.data
    to = _recipients(d) or [case_owner(ev.pid)]
    days = d.get("days_left")
    what = d.get("title") or d.get("kind") or "期限"
    if days is None:
        title = f"期限提醒：{what}"
    elif days < 0:
        title = f"期限已逾期 {-days} 天：{what}"
    elif days == 0:
        title = f"期限今天到期：{what}"
    else:
        title = f"期限 {days} 天后到期：{what}"
    body = f"到期日 {d['due']}" if d.get("due") else ""
    href = project_href(ev.pid, panel="deadlines", dl=d.get("deadline_id")) if ev.pid else None
    create(to, "deadline", title, body=body, pid=ev.pid, href=href, actor_id=None, ts=ev.ts)


def on_comment_mention(ev: events.Event) -> None:
    d = ev.data
    href = project_href(ev.pid, c=d.get("cid")) if ev.pid else None
    create(_recipients(d), "mention", f"{_actor_name(ev)} 在批注中提到了你", body=d.get("quote") or d.get("body") or "",
           pid=ev.pid, href=href, actor_id=_actor_id(ev), ts=ev.ts)


def on_comment_assign(ev: events.Event) -> None:
    d = ev.data
    href = project_href(ev.pid, c=d.get("cid")) if ev.pid else None
    body = f"截止 {d['due']}" if d.get("due") else (d.get("quote") or "")
    create(_recipients(d), "assign", f"{_actor_name(ev)} 指派你审阅", body=body, pid=ev.pid, href=href,
           actor_id=_actor_id(ev), ts=ev.ts)


def _notify_case_staff(ev: events.Event, kind: str, title: str, body: str, href: str | None) -> None:
    """客户侧（免登录）动作 → 代理机构侧：案责任人；无则走 `case_staff` 兜底链（异步查 ACL）。"""
    owner = case_owner(ev.pid)
    if owner:
        create([owner], kind, title, body=body, pid=ev.pid, href=href, actor_id=None, ts=ev.ts)
        return
    if not ev.pid:
        return

    async def run() -> None:
        create(await case_staff(ev.pid), kind, title, body=body, pid=ev.pid, href=href, actor_id=None, ts=ev.ts)

    _spawn(run())


async def case_staff(pid: str) -> list:
    """责任人未填（直接拷贝进 PROJECTS_DIR / W4 之前的旧案）时的收件人兜底链：owner 成员 → agent 成员 → 活跃超管。
    超管不在 ACL 里也能开案，若不兜底，客户确认 / 批注就没人收到（W7 domain-03）。"""
    from sqlalchemy import select

    from app.auth import acl
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import User

    members = await acl.list_members(pid)
    for role in ("owner", "agent"):
        ids = [m["user_id"] for m in members if m["role"] == role]
        if ids:
            return ids
    await init_db()
    async with SessionLocal() as s:
        return list(await s.scalars(select(User.id).where(User.is_superuser.is_(True), User.is_active.is_(True))))


def on_share_confirmed(ev: events.Event) -> None:
    d = ev.data
    name = d.get("name") or "客户"
    ver = f"第 {d['version']} 版" if d.get("version") is not None else "当前版本"
    _notify_case_staff(ev, "confirm", f"{name} 已确认{ver}", d.get("note") or "",
                       project_href(ev.pid) if ev.pid else None)


def on_share_commented(ev: events.Event) -> None:
    d = ev.data
    name = d.get("name") or "客户"
    _notify_case_staff(ev, "mention", f"客户 {name} 提交了批注", d.get("quote") or "",
                       project_href(ev.pid, c=d.get("cid")) if ev.pid else None)


def on_ai_proposal(ev: events.Event) -> None:
    d = ev.data
    action = d.get("action")
    if action not in ("applied", "dismissed"):
        return
    to = _recipients(d) or [case_owner(ev.pid)]
    verb = "已采纳" if action == "applied" else "已忽略"
    what = d.get("title") or d.get("proposal_id") or "AI 建议"
    href = project_href(ev.pid, focus=d.get("block_id")) if ev.pid else None
    create(to, "ai", f"{_actor_name(ev)} {verb} AI 建议：{what}", body=d.get("summary") or "", pid=ev.pid, href=href,
           actor_id=_actor_id(ev), ts=ev.ts)


_MEMBER_ROLE_LABEL = {"owner": "所有者", "agent": "代理人", "editor": "编辑者",
                      "reviewer": "审阅者", "viewer": "查看者"}


def on_member_changed(ev: events.Event) -> None:
    """成员角色变更 / 移除 → 通知被变更者（前端轮询到即刷新 project.role，降级即时收口）。
    自操作（领取分享链接入案）由 create 的 actor 过滤挡掉。"""
    if not ev.pid:
        return
    uid = ev.data.get("user_id")
    if not uid:
        return
    try:
        name = load_case(os.path.join(config.PROJECTS_DIR, ev.pid)).case_no or ev.pid
    except Exception:  # noqa: BLE001 — case.json 坏了不丢通知
        name = ev.pid
    role = ev.data.get("role")
    if role is None:
        create([uid], "system", f"你已被移出案件「{name}」", pid=ev.pid, actor_id=_actor_id(ev), ts=ev.ts)
    else:
        label = _MEMBER_ROLE_LABEL.get(role, role)
        create([uid], "system", f"{_actor_name(ev)} 将你在「{name}」的角色变更为{label}",
               pid=ev.pid, href=project_href(ev.pid), actor_id=_actor_id(ev), ts=ev.ts)


def on_case_created(ev: events.Event) -> None:
    if not config.AUTH_ON or not ev.pid:
        return
    from app.domain.org import apply_default_collab

    apply_default_collab(ev.pid)


SUBSCRIPTIONS = (
    ("deadline.due", on_deadline_due),
    ("comment.mention", on_comment_mention),
    ("comment.assign", on_comment_assign),
    ("share.confirmed", on_share_confirmed),
    ("share.commented", on_share_commented),
    ("ai.proposal", on_ai_proposal),
    ("member.changed", on_member_changed),
    ("case.created", on_case_created),
)


def install() -> None:
    """注册全部订阅（幂等：events.subscribe 对同一 handler 只保留一份）。routes_notify import 时调用。"""
    for kind, handler in SUBSCRIPTIONS:
        events.subscribe(kind, handler)


# ---------------------------------------------------------------- 读 / 已读 ----

def _out(row, actor) -> Notification:
    from app.auth import acl

    return Notification(
        id=row.id, kind=row.kind, title=row.title, body=row.body, href=row.href, pid=row.project_id,
        actor=Actor(**events.actor_of(actor)) if actor is not None else None,
        read=row.read_at is not None, created_at=acl.utc(row.created_at).timestamp(),
    )


async def list_for(user_id: uuid.UUID, *, unread_only: bool = False, limit: int = 50,
                   before_id: str | None = None) -> NotificationListResponse:
    """通知流分页：before_id 游标取该条之后（更旧）的一页。排序 created_at DESC + id ASC 决胜——
    游标谓词 `created_at < ac OR (= AND id > aid)`。锚点缺失/不属本用户 ⇒ 回落第一页（前端按 id 去重）。"""
    from sqlalchemy import and_, func, or_, select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import Notification as Row
    from app.auth.models import User

    await init_db()
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    async with SessionLocal() as s:
        q = select(Row, User).outerjoin(User, User.id == Row.actor_user_id).where(Row.user_id == user_id)
        if unread_only:
            q = q.where(Row.read_at.is_(None))
        if before_id is not None:
            anchor = await s.get(Row, before_id)
            if anchor is not None and anchor.user_id == user_id:
                q = q.where(or_(Row.created_at < anchor.created_at,
                                and_(Row.created_at == anchor.created_at, Row.id > anchor.id)))
        # limit+1 探针判断 has_more
        rows = (await s.execute(q.order_by(Row.created_at.desc(), Row.id).limit(limit + 1))).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        unread = await s.scalar(select(func.count()).select_from(Row).where(Row.user_id == user_id,
                                                                              Row.read_at.is_(None)))
        return NotificationListResponse(items=[_out(r, u) for r, u in rows], unread=unread or 0, has_more=has_more)


async def user_exists(user_id: uuid.UUID) -> bool:
    from app.auth.db import SessionLocal, init_db
    from app.auth.models import User

    await init_db()
    async with SessionLocal() as s:
        return await s.get(User, user_id) is not None


async def mark_read(user_id: uuid.UUID, nid: str) -> Notification | None:
    from sqlalchemy import select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import Notification as Row
    from app.auth.models import User

    await init_db()
    async with SessionLocal() as s:
        row = await s.get(Row, nid)
        if row is None or row.user_id != user_id:
            return None
        if row.read_at is None:
            row.read_at = datetime.now(UTC)
            await s.commit()
        actor = await s.scalar(select(User).where(User.id == row.actor_user_id)) if row.actor_user_id else None
        return _out(row, actor)


async def mark_all_read(user_id: uuid.UUID) -> int:
    from sqlalchemy import update

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import Notification as Row

    await init_db()
    async with SessionLocal() as s:
        r = await s.execute(update(Row).where(Row.user_id == user_id, Row.read_at.is_(None))
                            .values(read_at=datetime.now(UTC)))
        await s.commit()
        return r.rowcount or 0
