# -*- coding: utf-8 -*-
"""公开链接管理 + 免登录客户审阅（docs/plan/21 §1.4 B6 / R-REV-05 / R-CHK-08）。share-confirm-backend 所有。

/api/projects/{pid}/public-links  GET / POST / DELETE {token}   门槛 auth.ROUTE_ROLE（owner）；AUTH=off ⇒ 501。
/api/public/{token}/…             不带 pid，不经 project_access；每个路由先 public_share.resolve(token)：
    不存在 404 not_found · 撤销 410 share.revoked · 过期 410 share.expired · 记访问（visits + public_access.jsonl）。
    GET meta              PublicShareMeta（+ allow_copy / allow_comment / baseline / pending_revisions）
    GET pdf               按链接 baseline 的 PDF（public_share.baseline_pdf）+ 页脚水印；
                          禁下载 ⇒ Content-Disposition: inline（否则 attachment）
    GET layout-ast | ast  块 AST（同 /api/projects/{pid}/ast，但正文先 critic.resolve(baseline)：
                          original 不把未决修订当定稿）
    GET layout-css        版面 CSS（同 /api/projects/{pid}/style.css）
    GET / POST comments   批注（source=client，author {id:null, name:<访客名>}）；POST 需 scope ≥ comment
    POST confirm          需 scope=confirm → case.json.confirmations[] + emit share.confirmed
不暴露 export / docx / attachments / 源码。
"""

import asyncio
from urllib.parse import quote

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app import atomic, config
from app.auth import CurrentUser
from app.domain import comments as comments_mod
from app.domain import events, public_share
from app.errors import kind_error, not_implemented
from app.routes.ast import _parse as parse_project_ast
from app.routes.comments import load_reanchored
from app.schemas import PublicAnchor, PublicShareLink, PublicShareLinkIn, PublicShareMeta
from patent_studio.kernel import critic
from patent_studio.kernel.style import merge_style
from patent_studio.kernel.style_css import render_css

UNIT = "share-confirm-backend"
ORG_NAME = "知撰"
router = APIRouter(tags=["public"])


class PublicLinkIn(PublicShareLinkIn):
    """schemas.PublicShareLinkIn + allow_comment（False ⇒ scope 收为 read）。"""

    allow_comment: bool | None = None


class PublicMetaOut(PublicShareMeta):
    allow_copy: bool = True
    allow_comment: bool = False


QUOTE_MAX = 120  # 通知正文里的批注摘录长度


class PublicCommentIn(BaseModel):
    """{name, anchor, body}；guest_name 为 schemas.PublicCommentIn 的同义字段。"""

    anchor: PublicAnchor
    body: str = Field(min_length=1, max_length=4000)
    name: str | None = Field(default=None, min_length=1, max_length=64)
    guest_name: str | None = Field(default=None, min_length=1, max_length=64)

    def guest(self) -> str:
        n = self.name or self.guest_name
        if not n:
            raise kind_error("validation", "缺少访客姓名 name")
        return n.strip()


class PublicConfirmIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=2000)
    expected_version: int = Field(ge=0)
    expected_sha: str = Field(max_length=64)
    expected_content_sha: str = Field(pattern=r"^[0-9a-f]{64}$")


def _off():
    return not_implemented("C1-auth", "公开链接需要开启账号（PATENT_STUDIO_AUTH=on）")


def _client(request: Request) -> tuple[str | None, str | None]:
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    return ip, request.headers.get("user-agent")


async def _grant(token: str, request: Request) -> public_share.Grant:
    ip, ua = _client(request)
    return await public_share.resolve(token, path=request.url.path, ip=ip, ua=ua, store=request.app.state.store)


# ---------------- 链接管理 ----------------


@router.get("/api/projects/{pid}/public-links", response_model=list[PublicShareLink])
async def list_public_links(pid: str, request: Request):
    if not config.AUTH_ON:
        raise _off()
    request.app.state.store.get(pid)
    return await public_share.list_links(pid)


@router.post("/api/projects/{pid}/public-links", status_code=201, response_model=PublicShareLink)
async def create_public_link(pid: str, body: PublicLinkIn, request: Request, user: CurrentUser):
    if not config.AUTH_ON or user is None:
        raise _off()
    request.app.state.store.get(pid)
    return await public_share.create_link(
        pid,
        user,
        scope=body.scope,
        ttl_days=body.ttl_days,
        allow_download=body.allow_download,
        allow_comment=body.allow_comment,
        baseline=body.baseline,
    )


@router.delete("/api/projects/{pid}/public-links/{token}", status_code=204)
async def revoke_public_link(pid: str, token: str, request: Request, user: CurrentUser):
    if not config.AUTH_ON or user is None:
        raise _off()
    if not await public_share.revoke_link(pid, token, user):
        raise kind_error("not_found", "审阅链接不存在")
    return Response(status_code=204)


# ---------------- 免登录审阅 ----------------


@router.get("/api/public/{token}/meta", response_model=PublicMetaOut)
async def public_meta(token: str, request: Request):
    g = await _grant(token, request)
    store = request.app.state.store
    project = store.get(g.pid)
    with atomic.studio_lock(project.dir, "content"):
        return public_share.meta(project, g, ORG_NAME, store.read_content(g.pid))


@router.get("/api/public/{token}/pdf")
async def public_pdf(
    token: str,
    request: Request,
    expected_version: int | None = None,
    expected_sha: str | None = None,
    expected_content_sha: str | None = None,
):
    g = await _grant(token, request)
    store = request.app.state.store
    project = store.get(g.pid)
    with atomic.studio_lock(project.dir, "content"):
        public_share.require_revision(store, project, expected_version, expected_sha, expected_content_sha)
    path = await asyncio.to_thread(public_share.baseline_pdf, store, project, g.baseline)
    if path is None:
        raise kind_error("not_found", "PDF 尚未生成，请稍后再试")
    data, ok = await asyncio.to_thread(public_share.watermarked_pdf, path, token)
    with atomic.studio_lock(project.dir, "content"):
        public_share.require_revision(store, project, expected_version, expected_sha, expected_content_sha)
    disposition = "attachment" if g.allow_download else "inline"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(project.title + '.pdf')}",
        "Cache-Control": "no-store",
        "X-Watermark": "footer" if ok else "unavailable",
    }
    return Response(data, media_type="application/pdf", headers=headers)


@router.get("/api/public/{token}/layout-ast")
async def public_layout_ast(
    token: str,
    request: Request,
    expected_version: int | None = None,
    expected_sha: str | None = None,
    expected_content_sha: str | None = None,
):
    g = await _grant(token, request)
    store = request.app.state.store
    project = store.get(g.pid)
    with atomic.studio_lock(project.dir, "content"):
        public_share.require_revision(store, project, expected_version, expected_sha, expected_content_sha)
        content = critic.resolve(store.read_content(g.pid), g.baseline)
    return parse_project_ast(store, g.pid, content, None)


@router.get("/api/public/{token}/ast")
async def public_ast(
    token: str,
    request: Request,
    expected_version: int | None = None,
    expected_sha: str | None = None,
    expected_content_sha: str | None = None,
):
    return await public_layout_ast(token, request, expected_version, expected_sha, expected_content_sha)


@router.get("/api/public/{token}/layout-css")
async def public_layout_css(token: str, request: Request):
    g = await _grant(token, request)
    p = request.app.state.store.get(g.pid)
    return Response(
        render_css(merge_style(p.settings.get("style"))),
        media_type="text/css; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/api/public/{token}/comments")
async def public_comments(token: str, request: Request):
    g = await _grant(token, request)
    return [c.to_dict() for c in load_reanchored(request.app.state.store, g.pid)]


@router.post("/api/public/{token}/comments", status_code=201)
async def add_public_comment(token: str, body: PublicCommentIn, request: Request):
    g = await _grant(token, request)
    if not g.allow_comment:
        raise kind_error("share.scope", "此链接仅可阅读，不能批注")
    d = request.app.state.store.get(g.pid).dir
    async with comments_mod.ledger_lock(d):
        with comments_mod.file_lock(d):  # R92：跨进程写锁（见 comments.file_lock）
            comments = comments_mod.load(d)
            c = comments_mod.create(
                comments_mod.anchor_from_dict(body.anchor.model_dump()),
                body.body,
                comments_mod.Author(id=None, name=body.guest()),
                source="client",
            )
            comments.append(c)
            comments_mod.save(d, comments)
    events.emit(
        "share.commented",
        pid=g.pid,
        actor=None,
        data={"token": g.token, "cid": c.id, "name": body.guest(), "quote": body.body[:QUOTE_MAX]},
    )
    return c.to_dict()


@router.post("/api/public/{token}/confirm")
async def public_confirm(token: str, body: PublicConfirmIn, request: Request):
    g = await _grant(token, request)
    if not g.allow_confirm:
        raise kind_error("share.scope", "此链接不能确认定稿")
    ip, ua = _client(request)
    project = request.app.state.store.get(g.pid)
    rec = await asyncio.to_thread(
        public_share.confirm,
        request.app.state.store,
        project,
        g,
        body.name.strip(),
        body.note,
        ip,
        ua,
        body.expected_version,
        body.expected_sha,
        body.expected_content_sha,
    )
    return public_share.confirmation_out(rec)
