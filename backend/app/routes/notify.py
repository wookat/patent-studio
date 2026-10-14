# -*- coding: utf-8 -*-
"""站内通知与催办路由（docs/plan/21 §2 R-HOME-07 / R-REV-03 / R-MOB-04；notify-audit-backend）。

- GET  /api/notify?unread=1&limit=      当前用户的通知（新→旧）+ 未读数；off 模式没有用户 ⇒ 空列表
- POST /api/notify/read-all             → {updated}
- POST /api/notify/{nid}/read           别人的 / 不存在 ⇒ 404
- POST /api/projects/{pid}/nudge        {deadline_id?, user_id?, message?}：门槛 agent（ROUTE_ROLE）；
  收件人 = user_id，否则案责任人；给对方写一条 nudge 未读并 emit deadline.nudge（时间线 / 审计消费）。
  自己催自己 / 案无责任人 ⇒ 409。桌面与 375 首页的「催办」按钮都打这一条。

机构审计 / 机构设置路由在 auth/routes/admin.py（与成员表、机构名同一 router）。
import 本模块即完成事件订阅安装（main.py 只 include router，不另接线）。
"""

import json
import os
import uuid

from fastapi import APIRouter, Depends, Request

from app import notify
from app.auth import CurrentUser, require_login
from app.domain import events, org_audit
from app.domain.cases import case_path
from app.domain.projects import ProjectError
from app.errors import kind_error
from app.schemas import (
    Notification,
    NotificationListResponse,
    NudgeIn,
    NudgeResult,
    ReadAllResult,
    WebhookTestIn,
    WebhookTestResult,
)

UNIT = "notify-audit-backend"
router = APIRouter(tags=["notify"], dependencies=[Depends(require_login)])

notify.install()
org_audit.install()


def _raw_case(project_dir: str) -> dict:
    """直接读 case.json：期限的 id / title 由 deadlines-backend 定义，cases.Deadline 尚未收录，按 dict 取不依赖它。"""
    p = case_path(project_dir)
    if not os.path.isfile(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@router.get("/api/notify", response_model=NotificationListResponse)
async def list_notifications(
    user: CurrentUser, unread: bool = False, limit: int = 50, before_id: str | None = None
) -> NotificationListResponse:
    if user is None:
        return NotificationListResponse(items=[], unread=0)
    return await notify.list_for(user.id, unread_only=unread, limit=limit, before_id=before_id)


@router.post("/api/notify/read-all", response_model=ReadAllResult)
async def read_all_notifications(user: CurrentUser) -> ReadAllResult:
    if user is None:
        return ReadAllResult(updated=0)
    return ReadAllResult(updated=await notify.mark_all_read(user.id))


@router.post("/api/notify/{nid}/read", response_model=Notification)
async def read_notification(nid: str, user: CurrentUser) -> Notification:
    n = await notify.mark_read(user.id, nid) if user is not None else None
    if n is None:
        raise kind_error("not_found", "通知不存在")
    return n


@router.post("/api/projects/{pid}/nudge", response_model=NudgeResult)
async def nudge(pid: str, body: NudgeIn, request: Request, user: CurrentUser) -> NudgeResult:
    if user is None:
        return NudgeResult(notified=0)
    store = request.app.state.store
    try:
        project = store.get(pid)
    except ProjectError as e:
        raise kind_error("not_found", str(e))
    case = _raw_case(project.dir)
    target = body.user_id or case.get("owner_user_id")
    if not target:
        raise kind_error("conflict", "本案还没有责任人，先在案件台账里指定再催办")
    try:
        target_id = uuid.UUID(target)
    except ValueError:
        raise kind_error("not_found", "催办对象不存在")
    if target_id == user.id:
        raise kind_error("conflict", "不能催办自己")
    if not await notify.user_exists(target_id):
        raise kind_error("not_found", "催办对象不存在")
    what = project.title
    if body.deadline_id:
        for d in case.get("deadlines", []):
            if d.get("id") == body.deadline_id:
                what = f"{d.get('title') or d.get('note') or d.get('kind')}（{d.get('due')}）"
    title = f"{user.display_name or user.email} 催办：{what}"
    ev = events.emit(
        "deadline.nudge",
        pid=pid,
        actor=events.actor_of(user),
        data={"user_id": str(target_id), "deadline_id": body.deadline_id, "message": body.message or ""},
    )
    n = notify.create(
        [target_id],
        "nudge",
        title,
        body=body.message or "",
        pid=pid,
        href=notify.project_href(pid, panel="deadlines", dl=body.deadline_id),
        actor_id=user.id,
        ts=ev.ts,
    )
    return NudgeResult(notified=n)


@router.post("/api/projects/{pid}/notify/test", response_model=WebhookTestResult)
async def webhook_test(pid: str, body: WebhookTestIn, request: Request) -> WebhookTestResult:
    """「发送测试」：向给定 URL 或已存 settings.notify_webhook_url 同步 POST 一条 ping。"""
    import asyncio

    from app.notify import webhook

    url = (body.url or "").strip() or webhook.url_for(pid)
    if not url:
        raise kind_error("validation", "未配置 webhook URL——先填地址或保存到集成设置")
    ok, detail = await asyncio.to_thread(webhook.send_test, url)
    return WebhookTestResult(ok=ok, detail=detail)
