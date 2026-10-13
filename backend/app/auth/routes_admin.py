# -*- coding: utf-8 -*-
"""W4-E E2 机构管理（docs/plan/17 §3.3）：`/api/admin/users` 成员表 + `/api/admin/org` 机构名称。

- 成员表只对超管开放（auth=on 且 is_superuser）；非超管 403 detail=superuser（与 /api/tags 写口一致）；off ⇒ 501。
  列表含禁用成员，按最近登录倒序（从未登录排最后）。PUT 改 is_active / is_superuser / title；
  对自己禁用/降级、把最后可用超管禁用/降级 ⇒ 409（机构不能没有管理员）。
- 机构名称存 `<projects>/.studio/org.json`（同 tags.json 目录形式；读写见 domain/org.py），auth=off 也可读写：
  本机单人用法里没有「超管」，机构名只是导出/标题用的展示字段。

W5 notify-audit-backend（docs/plan/21 §2 R-ADM-02 / R-ADM-03 / R-AI-01 机构级）：
- `GET /api/admin/audit?actor=&pid=&kind=&from=&to=&limit=` 与 `GET /api/admin/audit.csv`（同筛选）：机构审计，
  超管；off ⇒ 501。
- `GET/PUT /api/admin/settings`：ai_enabled / default_collab / ai_daily_tokens 存 org.json，smtp 只读（环境变量）；
  与 /org 同一件文件，同一套门槛（GET 登录即可，PUT 超管；off 下都可用）。

fastapi-users / SQLAlchemy 只在成员 / 审计路由内惰性 import（off 下不得把 app.auth.db 拉进来）。
"""
import uuid

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app import config
from app.auth import CurrentUser, login_required
from app.domain import events, org, org_audit
from app.domain.org import ORG_NAME_MAX, load_org, save_org
from app.errors import error_detail, kind_error, not_implemented
from app.schemas import OrgAuditResponse, OrgSettings, OrgSettingsPatch

router = APIRouter(prefix="/api/admin", tags=["admin"])
UNIT = "E2-account-admin"
_OFF = "账号未开启（PATENT_STUDIO_AUTH=off）"
TITLE_MAX = 32


class AdminUser(BaseModel):
    id: str
    email: str
    display_name: str
    title: str
    avatar_color: str
    is_superuser: bool
    is_active: bool
    last_login_at: str | None


class AdminUserIn(BaseModel):
    is_active: bool | None = None
    is_superuser: bool | None = None
    title: str | None = None


class OrgName(BaseModel):
    """/org 的对外形状：只暴露机构名（其余机构设置走 /settings）。"""
    name: str = Field(default="", max_length=ORG_NAME_MAX)


def _require_superuser(user) -> None:
    if not config.AUTH_ON:
        raise not_implemented(UNIT, _OFF)
    if user is None:
        raise login_required()
    if not user.is_superuser:
        raise HTTPException(403, error_detail("forbidden", "机构管理仅机构管理员可用", detail="superuser"))


def _admin_user(u) -> AdminUser:
    return AdminUser(
        id=str(u.id),
        email=u.email,
        display_name=u.display_name,
        title=u.title,
        avatar_color=u.avatar_color,
        is_superuser=u.is_superuser,
        is_active=u.is_active,
        last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
    )


# ---------------------------------------------------------------- 成员 ----

@router.get("/users")
async def list_users(user: CurrentUser) -> list[AdminUser]:
    _require_superuser(user)
    from sqlalchemy import select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import User

    await init_db()
    async with SessionLocal() as s:
        rows = (await s.execute(select(User))).scalars().all()
    # 最近登录倒序，从未登录（None）排最后；同档按邮箱稳定
    rows.sort(key=lambda u: (u.last_login_at is None, -u.last_login_at.timestamp() if u.last_login_at else 0, u.email))
    return [_admin_user(u) for u in rows]


@router.put("/users/{user_id}")
async def update_user(user_id: str, body: AdminUserIn, user: CurrentUser) -> AdminUser:
    _require_superuser(user)
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(404, error_detail("not_found", "成员不存在"))
    if body.title is not None and len(body.title.strip()) > TITLE_MAX:
        raise HTTPException(422, error_detail("validation", f"头衔不能超过 {TITLE_MAX} 字"))

    from sqlalchemy import func, select

    from app.auth.db import SessionLocal, init_db
    from app.auth.models import User

    await init_db()
    async with SessionLocal() as s:
        target = await s.get(User, uid)
        if target is None:
            raise HTTPException(404, error_detail("not_found", "成员不存在"))
        demote = body.is_active is False or body.is_superuser is False
        if demote and target.id == user.id:
            raise HTTPException(409, error_detail("conflict", "不能禁用或降级自己；请让另一位管理员操作"))
        if demote and target.is_superuser and target.is_active:
            others = await s.scalar(
                select(func.count()).select_from(User).where(
                    User.is_superuser.is_(True), User.is_active.is_(True), User.id != target.id
                )
            )
            if not others:
                raise HTTPException(409, error_detail("conflict", "机构至少保留一位可用的管理员"))
        changes: dict = {}
        if body.is_active is not None:
            target.is_active = body.is_active
            changes["is_active"] = body.is_active
        if body.is_superuser is not None:
            target.is_superuser = body.is_superuser
            changes["is_superuser"] = body.is_superuser
        if body.title is not None:
            target.title = body.title.strip()
            changes["title"] = body.title.strip()
        await s.commit()
        await s.refresh(target)
        # R50-01：授/撤超管、禁用账号这类最高权限变更必须进机构审计（此前零事件，审计页全盲）
        if changes:
            events.emit("admin.user", pid=None, actor=events.actor_of(user),
                        data={"user_id": str(target.id), "email": target.email, "changes": changes})
        return _admin_user(target)


# ---------------------------------------------------------------- 机构 ----

@router.get("/org")
async def get_org(user: CurrentUser) -> OrgName:
    if config.AUTH_ON and user is None:
        raise login_required()
    return OrgName(name=load_org().name)


@router.put("/org")
async def put_org(body: OrgName, user: CurrentUser) -> OrgName:
    if config.AUTH_ON:
        _require_superuser(user)
    return OrgName(name=save_org(load_org().model_copy(update={"name": body.name.strip()})).name)


@router.get("/settings")
async def get_settings(user: CurrentUser) -> OrgSettings:
    if config.AUTH_ON and user is None:
        raise login_required()
    return org.settings_out(load_org())


@router.put("/settings")
async def put_settings(body: OrgSettingsPatch, user: CurrentUser) -> OrgSettings:
    if config.AUTH_ON:
        _require_superuser(user)
    return org.apply_settings(body)


# ---------------------------------------------------------------- 审计 ----

async def _audit(user, actor, pid, kind, since, until, limit) -> OrgAuditResponse:
    _require_superuser(user)
    if kind and kind not in org_audit.KINDS:
        raise kind_error("validation", f"未知的审计事件：{kind}")
    try:
        s, u = org_audit.parse_when(since), org_audit.parse_when(until, end=True)
    except ValueError:
        raise kind_error("validation", "from / to 需为 YYYY-MM-DD 或时间戳")
    return await org_audit.query(actor=actor, pid=pid, kind=kind, since=s, until=u, limit=limit)


@router.get("/audit")
async def get_audit(
    user: CurrentUser, actor: str | None = None, pid: str | None = None, kind: str | None = None,
    since: str | None = Query(default=None, alias="from"), until: str | None = Query(default=None, alias="to"),
    limit: int = org_audit.LIMIT_DEFAULT,
) -> OrgAuditResponse:
    return await _audit(user, actor, pid, kind, since, until, limit)


@router.get("/audit.csv")
async def get_audit_csv(
    user: CurrentUser, actor: str | None = None, pid: str | None = None, kind: str | None = None,
    since: str | None = Query(default=None, alias="from"), until: str | None = Query(default=None, alias="to"),
    limit: int = org_audit.LIMIT_MAX,
) -> Response:
    res = await _audit(user, actor, pid, kind, since, until, limit)
    return Response(org_audit.to_csv(res.items), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="org-audit.csv"'})
