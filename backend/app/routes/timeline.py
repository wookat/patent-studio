# -*- coding: utf-8 -*-
"""案件时间线 / 备注 / 审阅指派（docs/plan/21 §2.2 R-CASE-05）。share-confirm-backend 所有。

GET  /api/projects/{pid}/timeline?kind=…   合并视图（timeline.merged），viewer 可见
POST /api/projects/{pid}/notes {body}      备注（支持 @成员 → emit comment.mention）
POST /api/projects/{pid}/review-assign {user_id, due?}
     AUTH=on 时 user_id 必须是本案成员（否则 404 not_found）；off 时 user_id 只作记录。
     写 case.json.deadlines[]{kind:review_due}（deadlines 单元合入后改调其 add）+ 时间线 review.assigned
     + emit comment.assign（events.py 的枚举名；规格写作 review.assigned）。
"""

from datetime import date, timedelta

from fastapi import APIRouter, Query, Request

from app import config
from app.auth import CurrentUser
from app.domain import cases, events, timeline
from app.errors import kind_error
from app.routes.comments import emit_mentions_for, mentioned_user_ids
from app.schemas import (
    NoteIn,
    ReviewAssignIn,
    ReviewAssignResult,
    TimelineEvent,
    TimelineEventKind,
    TimelineResponse,
)

DEFAULT_REVIEW_DAYS = 7
_KIND_QUERY = Query(default=None)
router = APIRouter(prefix="/api/projects/{pid}", tags=["timeline"])


@router.get("/timeline", response_model=TimelineResponse)
async def get_timeline(pid: str, request: Request, kind: list[TimelineEventKind] | None = _KIND_QUERY):
    d = request.app.state.store.get(pid).dir
    return {"items": timeline.merged(d, set(kind) if kind else None)}


@router.post("/notes", status_code=201, response_model=TimelineEvent)
async def add_note(pid: str, body: NoteIn, request: Request, user: CurrentUser):
    d = request.app.state.store.get(pid).dir
    item = timeline.add_note(d, body.body, events.actor_of(user))
    ids = await mentioned_user_ids(pid, item["mentions"])
    if ids:
        emit_mentions_for(pid, user, {"note_id": item["id"], "mentions": item["mentions"], "user_ids": ids})
    return item


async def _assignee(pid: str, user_id: str) -> dict:
    if not config.AUTH_ON:
        return {"id": user_id, "display_name": user_id}
    from app.auth import acl

    for m in await acl.list_members(pid):
        if m["user_id"] == user_id:
            return {"id": m["user_id"], "display_name": m["display_name"] or m["email"]}
    raise kind_error("not_found", "该用户不是本案成员")


@router.post("/review-assign", response_model=ReviewAssignResult)
async def review_assign(pid: str, body: ReviewAssignIn, request: Request, user: CurrentUser):
    d = request.app.state.store.get(pid).dir
    assignee = await _assignee(pid, body.user_id)
    due = body.due or (cases.local_today() + timedelta(days=DEFAULT_REVIEW_DAYS)).isoformat()
    try:
        date.fromisoformat(due)
    except ValueError:
        raise kind_error("validation", f"截止日需为 YYYY-MM-DD：{due!r}") from None
    timeline.add_review_deadline(d, due, f"审阅：{assignee['display_name']}")
    timeline.assign_review(d, assignee, due, events.actor_of(user))
    events.emit(
        "comment.assign",
        pid=pid,
        actor=events.actor_of(user),
        data={"user_id": assignee["id"], "display_name": assignee["display_name"], "due": due},
    )
    return {"deadline_id": None}
