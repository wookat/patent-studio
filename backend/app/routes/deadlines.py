# -*- coding: utf-8 -*-
"""期限中心 API（docs/plan/21-w5-spec.md §2.1 R-HOME-05 / R-HOME-06 / R-CASE-02，单元 deadlines-backend）。

GET  /api/deadlines?range=today|7d|30d|overdue|all&owner=&client=&kind=
        跨案聚合（只含 ACL 可见案）→ DeadlineListResponse。分组互斥：today = 今日到期；7d = 1–7 天；
        30d = 8–30 天；overdue = 已逾期；all = 全部（含已完成与 30 天外）。counts 按同一分组统计未完成条目，
        与 range=<组> 返回的条数一致。owner = 案件 owner_user_id；client = 案件客户（精确匹配）；kind = DeadlineKind。
POST /api/projects/{pid}/deadlines/compute            按 dates.* / priority 重算 auto 期限（manual 不覆盖），落盘 →
                                                      本案 DeadlineListResponse（agent+）
PUT  /api/projects/{pid}/deadlines/{deadline_id}      人工改期 DeadlineOverrideIn{due?, override_reason} → 条目改为
                                                      source=manual，之后 recompute 不再覆盖（agent+）
POST /api/projects/{pid}/deadlines/{deadline_id}/done 标记完成/撤销完成 DeadlineDoneIn{done=true}
                                                      → DeadlineItem；emit deadline.done / deadline.undone（agent+）

status：done / overdue(days_left<0) / due_soon(days_left≤7) / upcoming；days_left 按 Asia/Shanghai 当天算。
target_filings（W7 ux-04，只读）：可见案中填了 dates.target_filing 且尚未递交（dates.filed 为空）的「目标递交」倒计时，
    target_filing_days_left 与 days_left 同源（cases.local_today == compute.today）；
    不进 items / counts（rules.json 语义不变）；受 range / owner / client 筛选，kind 筛选时为空（它不是 DeadlineKind）。
holidays_missing：涉及年份的 holidays/<year>.json 缺失或未核对（verified=false）⇒ true，仅 warning。
"""
import asyncio
import time
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app import atomic, auth, config, deadlines
from app.auth import require_login
from app.deadlines import compute
from app.domain import cases, events, history
from app.errors import kind_error
from app.routes import project_or_404
from app.routes.cases import case_or_404
from app.schemas import (
    Actor,
    DeadlineDoneIn,
    DeadlineItem,
    DeadlineListResponse,
    DeadlineOverrideIn,
    LegalBasis,
)

router = APIRouter(tags=["deadlines"], dependencies=[Depends(require_login)])
AGENT = Depends(auth.require_role("agent"))

Group = Literal["today", "7d", "30d", "overdue"]
Range = Literal["today", "7d", "30d", "overdue", "all"]
GROUPS: tuple[Group, ...] = ("today", "7d", "30d", "overdue")
DUE_SOON_DAYS = 7


class TargetFilingItem(BaseModel):
    """目标递交倒计时（只读，不是期限条目）：target_filing = dates.target_filing；days_left 负数 = 已过目标日。"""
    pid: str
    case_no: str | None = None
    title: str
    target_filing: str
    target_filing_days_left: int
    owner: Actor | None = None
    client: str | None = None


class DeadlineListResponseW7(DeadlineListResponse):
    target_filings: list[TargetFilingItem] = []


def group_of(days_left: int) -> Group | None:
    if days_left < 0:
        return "overdue"
    if days_left == 0:
        return "today"
    if days_left <= 7:
        return "7d"
    if days_left <= 30:
        return "30d"
    return None


def status_of(d: cases.Deadline, days_left: int) -> str:
    if d.done:
        return "done"
    if days_left < 0:
        return "overdue"
    return "due_soon" if days_left <= DUE_SOON_DAYS else "upcoming"


def to_item(pid: str, case: cases.Case, title: str, d: cases.Deadline, *, today: date,
            owner: Actor | None) -> DeadlineItem:
    days_left = (date.fromisoformat(d.due) - today).days
    lb = d.legal_basis
    # W4 旧案 kind 是自由字符串（filing / client_review …）：归 custom，原词当标题
    kind = d.kind if d.kind in cases.DEADLINE_KINDS else "custom"
    if not d.title:
        title = d.kind if kind != d.kind else title
    return DeadlineItem(
        id=d.id, pid=pid, case_no=case.case_no or None, title=d.title or title, kind=kind, due=d.due,
        base_date=d.base_date, rule=d.rule,
        legal_basis=LegalBasis(text=f"{lb.law} {lb.article}", url=lb.url) if lb else None,
        source=d.source, override_reason=d.override_reason, status=status_of(d, days_left), days_left=days_left,
        owner=owner, client=case.client or None, done=d.done, done_at=d.done_at)


def counts_of(items: list[DeadlineItem]) -> dict[Group, int]:
    out: dict[Group, int] = {g: 0 for g in GROUPS}
    for it in items:
        g = None if it.done else group_of(it.days_left)
        if g is not None:
            out[g] += 1
    return out


def holidays_missing_for(items: list[DeadlineItem]) -> bool:
    years = {int(it.due[:4]) for it in items if not it.done}
    return any(not compute.holidays_verified(y) for y in years)


_project = project_or_404


OWNER_GONE = "已离开的成员"


async def _owner(case: cases.Case, seen: dict[str, Actor | None]) -> Actor | None:
    """owner_user_id → Actor；一次 GET 内同一 owner 只查一次。owner 可能是无 ACL 行的 superuser，所以直查 user 表。"""
    uid = case.owner_user_id
    if not uid:
        return None
    if uid in seen:
        return seen[uid]
    # 账号已删 / 非法 id / auth=off ⇒ 人话占位，不把 id 当姓名露给用户
    actor = Actor(id=uid, display_name=OWNER_GONE)
    if config.AUTH_ON:
        from app.auth import acl

        u = await acl.get_user_brief(uid)
        if u is not None:
            actor = Actor(id=uid, display_name=u["display_name"] or u["email"], avatar_color=u["avatar_color"])
    seen[uid] = actor
    return actor


async def _case_items(request: Request, pid: str, case: cases.Case, today: date,
                      owners: dict[str, Actor | None] | None = None) -> list[DeadlineItem]:
    title = _project(request, pid).title
    owner = await _owner(case, owners if owners is not None else {})
    return [to_item(pid, case, title, d, today=today, owner=owner) for d in case.deadlines]


def to_target_filing(
    pid: str, case: cases.Case, title: str, *, today: date, owner: Actor | None
) -> TargetFilingItem | None:
    """已递交（dates.filed）或无 target_filing ⇒ None。"""
    n = cases.target_filing_days_left(case, today)
    if n is None or case.dates.filed:
        return None
    return TargetFilingItem(pid=pid, case_no=case.case_no or None, title=title,
                            target_filing=case.dates.target_filing or "", target_filing_days_left=n,
                            owner=owner, client=case.client or None)


def _response(
    items: list[DeadlineItem], target_filings: list[TargetFilingItem] | None = None
) -> DeadlineListResponseW7:
    items = sorted(items, key=lambda it: (it.done, it.due, it.pid, it.id))
    targets = sorted(target_filings or [], key=lambda t: (t.target_filing, t.pid))
    return DeadlineListResponseW7(items=items, counts=counts_of(items), holidays_missing=holidays_missing_for(items),
                                  target_filings=targets)


def _find(case: cases.Case, deadline_id: str) -> cases.Deadline:
    d = case.deadline(deadline_id)
    if d is None:
        raise kind_error("not_found", f"期限不存在：{deadline_id}")
    return d


def _save(project_dir: str, case: cases.Case, message: str, user) -> cases.Case:
    case = cases.save_case(project_dir, case)
    history.commit_case(project_dir, message, author=(user.display_name or user.email) if user else None)
    return case


# ---------- 路由 ----------


@router.get("/api/deadlines", response_model=DeadlineListResponseW7)
async def list_deadlines(request: Request, user: auth.CurrentUser, range: Range = "all", owner: str | None = None,
                         client: str | None = None, kind: str | None = None) -> DeadlineListResponseW7:
    if kind is not None and kind not in cases.DEADLINE_KINDS:
        raise kind_error("validation", f"未知期限类型：{kind}")
    store = request.app.state.store
    today = compute.today()
    items: list[DeadlineItem] = []
    targets: list[TargetFilingItem] = []
    owners: dict[str, Actor | None] = {}
    # R82-02：my_role 逐案查库会 N+1——登录非超管先一次取回 {pid: role}；off/匿名 ⇒ 全 None，超管全 owner
    su = bool(config.AUTH_ON and user is not None and user.is_superuser)
    if config.AUTH_ON and user is not None and not su:
        from app.auth import acl
        roles_map = await acl.roles_map_for(user.id)
    else:
        roles_map = {}
    for pid in await auth.visible_pids(user, store.list_ids()):
        case = case_or_404(store.get(pid).dir)
        if owner and case.owner_user_id != owner:
            continue
        if client and case.client != client:
            continue
        role = "owner" if su else roles_map.get(pid)  # R77-01：行级写门槛（done/催办=agent）前端据此禁用
        for it in await _case_items(request, pid, case, today, owners):
            if kind and it.kind != kind:
                continue
            if range != "all" and (it.done or group_of(it.days_left) != range):
                continue
            it.my_role = role
            items.append(it)
        if kind:
            continue
        t = to_target_filing(pid, case, _project(request, pid).title, today=today, owner=await _owner(case, owners))
        if t is not None and (range == "all" or group_of(t.target_filing_days_left) == range):
            targets.append(t)
    return _response(items, targets)


@router.post("/api/projects/{pid}/deadlines/compute", dependencies=[AGENT], response_model=DeadlineListResponse)
async def compute_deadlines(request: Request, pid: str, user: auth.CurrentUser) -> DeadlineListResponse:
    p = _project(request, pid)
    with atomic.studio_lock(p.dir, "case"):
        case, _ = deadlines.recompute(case_or_404(p.dir))
        # 批80：_save 内含 git commit——offload 防阻塞事件循环
        case = await asyncio.to_thread(_save, p.dir, case, "case: deadlines recompute", user)
    return _response(await _case_items(request, pid, case, compute.today()))


@router.put("/api/projects/{pid}/deadlines/{deadline_id}", dependencies=[AGENT], response_model=DeadlineItem)
async def override_deadline(request: Request, pid: str, deadline_id: str, body: DeadlineOverrideIn,
                            user: auth.CurrentUser) -> DeadlineItem:
    p = _project(request, pid)
    with atomic.studio_lock(p.dir, "case"):
        case = case_or_404(p.dir)
        d = _find(case, deadline_id)
        old_due = d.due
        d = d.model_copy(update={"due": body.due or d.due, "source": "manual", "override_reason": body.override_reason})
        case = await asyncio.to_thread(_save, p.dir, cases.replace_deadline(case, d),
                                       f"case: deadline override {d.id} → {d.due}", user)
    events.emit("deadline.override", pid=pid, actor=events.actor_of(user),
                data={"id": d.id, "kind": d.kind, "from": old_due, "to": d.due, "reason": body.override_reason})
    return (await _case_items(request, pid, case, compute.today()))[case.deadlines.index(d)]


@router.post("/api/projects/{pid}/deadlines/{deadline_id}/done", dependencies=[AGENT], response_model=DeadlineItem)
async def done_deadline(request: Request, pid: str, deadline_id: str, body: DeadlineDoneIn | None = None,
                        user: auth.CurrentUser = None) -> DeadlineItem:
    p = _project(request, pid)
    with atomic.studio_lock(p.dir, "case"):
        case = case_or_404(p.dir)
        done = True if body is None else body.done
        d = _find(case, deadline_id).model_copy(update={"done": done, "done_at": time.time() if done else None})
        verb = "done" if done else "undone"
        case = await asyncio.to_thread(_save, p.dir, cases.replace_deadline(case, d),
                                       f"case: deadline {verb} {d.id}", user)
    events.emit("deadline.done" if done else "deadline.undone", pid=pid, actor=events.actor_of(user),
                data={"id": d.id, "kind": d.kind, "due": d.due})
    return (await _case_items(request, pid, case, compute.today()))[case.deadlines.index(d)]
