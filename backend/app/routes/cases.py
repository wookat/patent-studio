# -*- coding: utf-8 -*-
"""案件台账路由（docs/plan/13-w4a-case-dashboard-design.md §2，单元 A1-case-api）。

GET  /api/projects/{pid}/case            读台账（viewer；无 case.json ⇒ 生成默认值并落盘）
PUT  /api/projects/{pid}/case            改字段（agent+；CasePatch 只改给出的字段）→ Case，
                                         history 事件「case: update a, b」；改了 dates / priority ⇒
                                         app.deadlines.recompute 重算 source=auto 期限（manual 不覆盖）
POST /api/projects/{pid}/case/status     {status, note} → Case；agent+；任意跳转；同状态 409；
                                         history 事件「case: status a → b[ · note]」
GET  /api/tags                           机构级标签 {tags:[{name,color}]}（登录即可）
POST /api/tags  PUT/DELETE /api/tags/{name}   新建 / 改名改色 / 删除（重名 409；改名删除级联重写含它的 case.json；
                                         auth=on 时写仅超管）
POST /api/projects/{pid}/list-state      {state: active|archived|trashed} 当前用户视角（agent+）→ {pid, list_state}
DELETE /api/projects/{pid}               永久删除（owner；须先在本人回收站否则 409）→ 204；
                                         关协同房间 → store.delete → forget_project → 清 ACL / 分享链接
POST /api/projects/{pid}/leave           退出（非 owner；删自己的 ACL 行与列表状态；owner / auth=off ⇒ 409）→ 204
POST /api/projects/bulk                  批量 status / tags / owner / list_state（逐案 agent 校验，失败不回滚）
                                         → {results:[{pid, ok, error?}]}

写入门槛用 auth.require_role("agent") / ("owner")；错误形状 error_detail(kind, …)。
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from app import atomic, auth, config, deadlines
from app.collab import rooms as collab_rooms
from app.domain import cases, events, history
from app.errors import error_detail
from app.routes import project_or_404

router = APIRouter(tags=["cases"])
AGENT = Depends(auth.require_role("agent"))
OWNER = Depends(auth.require_role("owner"))


_project = project_or_404


def case_or_404(project_dir: str) -> cases.Case:
    try:
        return cases.ensure_case(project_dir)
    except cases.CaseError as e:
        raise HTTPException(e.status, error_detail("case", str(e)))


def _author(user) -> str | None:
    """history 事件作者：显示名，缺省用邮箱；auth=off ⇒ None（history.DEFAULT_AUTHOR）。"""
    if user is None:
        return None
    return user.display_name or user.email


def _conflict(message: str) -> HTTPException:
    return HTTPException(409, error_detail("conflict", message))


def _set_status(project_dir: str, case: cases.Case, status: str) -> tuple[cases.Case, str]:
    """校验 + 落盘 case.json（fs 毫秒级，留事件循环无妨）；返回 (case, old_status)——git 提交由路由 to_thread、
    事件派发留路由内（批80：emit 的 awaitable 订阅者依赖主 loop，不能进工作线程）。"""
    old = case.status
    if old == status:
        raise _conflict("状态未变化")
    return cases.save_case(project_dir, case.model_copy(update={"status": status})), old


def _update(project_dir: str, case: cases.Case, fields: list[str], user) -> cases.Case:
    case = cases.save_case(project_dir, case)
    history.commit_case(project_dir, "case: update " + ", ".join(fields), author=_author(user))
    return case


# ---------- 台账 ----------


@router.get("/api/projects/{pid}/case")
async def get_case(request: Request, pid: str):
    p = _project(request, pid)
    return cases.summary(case_or_404(p.dir))


@router.put("/api/projects/{pid}/case", dependencies=[AGENT])
async def put_case(request: Request, pid: str, body: cases.CasePatch, user: auth.CurrentUser):
    p = _project(request, pid)
    fields = cases.patched_fields(body)
    if fields:
        with atomic.studio_lock(p.dir, "case"):
            case = case_or_404(p.dir)
            case = cases.apply_patch(case, body)
            if cases.DEADLINE_INPUT_FIELDS.intersection(fields):
                case, _ = deadlines.recompute(case)
            # 批80：_update 内含 git commit——offload 防阻塞事件循环
            case = await asyncio.to_thread(_update, p.dir, case, fields, user)
    else:
        case = case_or_404(p.dir)
    return cases.summary(case)


@router.post("/api/projects/{pid}/case/status", dependencies=[AGENT])
async def set_status(request: Request, pid: str, body: cases.StatusIn, user: auth.CurrentUser):
    p = _project(request, pid)
    with atomic.studio_lock(p.dir, "case"):
        case, old = _set_status(p.dir, case_or_404(p.dir), body.status)
        # 批80：git 提交 offload；事件派发留在事件循环（awaitable 订阅者依赖主 loop）
        await asyncio.to_thread(history.commit_case, p.dir,
                                cases.status_message(old, body.status, body.note), author=_author(user))
        events.emit("case.status", pid=pid, actor=events.actor_of(user),
                    data={"from": old, "to": body.status, "note": body.note})
        if body.status == "filed":
            events.emit("deliver.filed", pid=pid, actor=events.actor_of(user),
                        data={"application_no": case.dates.application_no, "filed": case.dates.filed})
    return cases.summary(case)


# ---------- 机构级标签 ----------


def _tags_out(tags: list[cases.Tag]) -> dict:
    return {"tags": [t.model_dump() for t in tags]}


def _require_login(user) -> None:
    if config.AUTH_ON and user is None:
        raise auth.login_required()


def _require_tag_admin(user) -> None:
    _require_login(user)
    if config.AUTH_ON and not user.is_superuser:
        raise HTTPException(403, error_detail("forbidden", "标签管理仅机构管理员可用", detail="superuser"))


def _find_tag(tags: list[cases.Tag], name: str) -> int:
    for i, t in enumerate(tags):
        if t.name == name:
            return i
    raise HTTPException(404, error_detail("not_found", f"标签不存在：{name}"))


def _project_dirs(request: Request) -> list[str]:
    store = request.app.state.store
    return [store.get(pid).dir for pid in store.list_ids()]


@router.get("/api/tags")
async def list_tags(user: auth.CurrentUser):
    _require_login(user)
    return _tags_out(cases.load_tags())


@router.post("/api/tags", status_code=201)
async def create_tag(body: cases.Tag, user: auth.CurrentUser):
    _require_tag_admin(user)
    tags = cases.load_tags()
    if any(t.name == body.name for t in tags):
        raise _conflict(f"标签已存在：{body.name}")
    return _tags_out(cases.save_tags([*tags, body]))


@router.put("/api/tags/{name}")
async def update_tag(request: Request, name: str, body: cases.TagPatch, user: auth.CurrentUser):
    _require_tag_admin(user)
    tags = cases.load_tags()
    i = _find_tag(tags, name)
    new = tags[i]
    if body.name is not None:
        new = cases.Tag(name=body.name, color=new.color)
        if new.name != name and any(t.name == new.name for t in tags):
            raise _conflict(f"标签已存在：{new.name}")
    if body.color is not None:
        new = new.model_copy(update={"color": body.color})
    tags[i] = new
    cases.save_tags(tags)
    if new.name != name:
        cases.retag_projects(_project_dirs(request), name, new.name)
    return _tags_out(tags)


@router.delete("/api/tags/{name}", status_code=204)
async def delete_tag(request: Request, name: str, user: auth.CurrentUser):
    _require_tag_admin(user)
    tags = cases.load_tags()
    del tags[_find_tag(tags, name)]
    cases.save_tags(tags)
    cases.retag_projects(_project_dirs(request), name, None)


# ---------- 用户视角：归档 / 回收站 / 删除 / 退出 ----------


@router.post("/api/projects/{pid}/list-state", dependencies=[AGENT])
async def set_list_state(request: Request, pid: str, body: cases.ListStateIn, user: auth.CurrentUser):
    _project(request, pid)
    return {"pid": pid, "list_state": cases.set_state(cases.user_key(user), pid, body.state)}


async def _forget_acl(pid: str) -> None:
    """auth=on：删本案全部 ACL 行与分享链接（acl.py 没有按案清理的函数，这里用它的会话直接删）。"""
    from sqlalchemy import delete

    from app.auth import acl
    from patent_studio.domain.identity import ProjectAcl, ShareLink

    await acl.init_db()
    async with acl.SessionLocal() as s:
        await s.execute(delete(ProjectAcl).where(ProjectAcl.project_id == pid))
        await s.execute(delete(ShareLink).where(ShareLink.project_id == pid))
        await s.commit()


@router.delete("/api/projects/{pid}", status_code=204, dependencies=[OWNER])
async def delete_project(request: Request, pid: str, user: auth.CurrentUser):
    _project(request, pid)
    if cases.get_state(cases.user_key(user), pid) != "trashed":
        raise _conflict("须先移入回收站再永久删除")
    for (p, _book), room in list(collab_rooms.ROOMS.items()):
        if p == pid:
            await collab_rooms.drop(room)
    title = request.app.state.store.get(pid).title
    request.app.state.store.delete(pid)
    cases.forget_project(pid)
    if config.AUTH_ON:
        await _forget_acl(pid)
    events.emit("case.deleted", pid=pid, actor=events.actor_of(user), data={"title": title})


@router.post("/api/projects/{pid}/leave", status_code=204)
async def leave_project(request: Request, pid: str, user: auth.CurrentUser):
    _project(request, pid)
    if not config.AUTH_ON:
        raise _conflict("单机模式没有成员关系，无法退出")
    from app.auth import acl

    role = await acl.role_for(pid, user.id)
    if role is None:
        raise HTTPException(404, error_detail("not_found", "您不是本案成员"))
    if role == "owner":
        raise _conflict("所有者不能退出：请先移交所有权或永久删除")
    await acl.remove_member(pid, user.id)
    cases.set_state(cases.user_key(user), pid, "active")


# ---------- 批量 ----------


def _bulk_validate(body: cases.BulkIn) -> None:
    missing = {
        "status": body.status is None,
        "list_state": body.state is None,
        "tags": not body.add_tags and not body.remove_tags,
        "owner": False,
    }[body.action]
    if missing:
        raise HTTPException(422, error_detail("validation", f"批量 {body.action} 缺少参数"))


async def _bulk_one(request: Request, body: cases.BulkIn, pid: str, user) -> None:
    await auth.check_access(request, user, pid, "agent")
    p = _project(request, pid)
    if body.action == "list_state":
        cases.set_state(cases.user_key(user), pid, body.state)
        return
    case = case_or_404(p.dir)
    if body.action == "status":
        if case.status != body.status:
            # 批80：与 set_status 路由同链——git 提交 offload，事件派发留事件循环
            case, old = _set_status(p.dir, case, body.status)
            await asyncio.to_thread(history.commit_case, p.dir,
                                    cases.status_message(old, body.status, ""), author=_author(user))
            events.emit("case.status", pid=pid, actor=events.actor_of(user),
                        data={"from": old, "to": body.status, "note": ""})
            if body.status == "filed":
                events.emit("deliver.filed", pid=pid, actor=events.actor_of(user),
                            data={"application_no": case.dates.application_no, "filed": case.dates.filed})
    elif body.action == "tags":
        await asyncio.to_thread(_update, p.dir, cases.retag(case, body.add_tags, body.remove_tags),
                                ["tags"], user)
    else:
        await asyncio.to_thread(_update, p.dir, case.model_copy(update={"owner_user_id": body.owner_user_id}),
                                ["owner_user_id"], user)


@router.post("/api/projects/bulk")
async def bulk(request: Request, body: cases.BulkIn, user: auth.CurrentUser):
    _require_login(user)
    _bulk_validate(body)
    results = []
    for pid in body.pids:
        try:
            await _bulk_one(request, body, pid, user)
            results.append({"pid": pid, "ok": True})
        except HTTPException as e:
            message = e.detail["message"] if isinstance(e.detail, dict) else str(e.detail)
            results.append({"pid": pid, "ok": False, "error": message})
    return {"results": results}
