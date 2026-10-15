# -*- coding: utf-8 -*-
"""块补丁路由（docs/plan/06-r3-structure-edit-design.md §3）。

POST   /api/projects/{pid}/blocks/{block_id}  {markdown, content?, settings?}   改块
POST   /api/projects/{pid}/blocks             {kind, after_block_id?|book?, markdown?, content?, settings?}  插块
DELETE /api/projects/{pid}/blocks/{block_id}  body 可选 {content?, settings?}   删块
  三者成功 200：{"ast", "content", "changed_lines": {"start","end"}, "block_id", "backup"}
    —— content 为省略时取磁盘 content.md；给了则以其为基（未保存的源码编辑不丢）。成功后一律 save_content。
    —— ast 与 GET /ast 同路径（routes_ast._parse：critic.accept 后解析），审阅式补丁后 AST 文本不含 {++ 等记号（W9）。
  失败 {"detail": {"kind", "message", "line", "detail": null}}（errors.py 形状，line 全文行）：
    422 kind="content"（重解析失败 / 删法定章节）、kind="kind"（块类型不适用于该书）；
    409 kind="stale"（block_id 不在当前 content 的 AST 里，结构已过期）；pid 不存在 404。
POST   /api/mathml  {source} → {"mathml"}  复用 patent_studio.kernel.omml.to_mathml（无项目上下文；prep 已实现）
GET    /api/block-templates → {"templates": [Template]}（block_templates.py）
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import auth
from app.domain import review_meta
from app.domain.projects import normalize_settings
from app.routes import ast as routes_ast
from patent_studio.kernel import block_templates, patch
from patent_studio.kernel.omml import to_mathml

router = APIRouter(tags=["blocks"])


class PatchIn(BaseModel):
    markdown: str
    content: str | None = None
    settings: dict | None = None
    base: str | None = None


class InsertIn(BaseModel):
    kind: str
    after_block_id: str | None = None
    book: str | None = None
    markdown: str | None = None
    content: str | None = None
    settings: dict | None = None


class DeleteIn(BaseModel):
    content: str | None = None
    settings: dict | None = None


class MathIn(BaseModel):
    source: str


async def _apply(request: Request, pid, content, settings, op, user):
    """取基准全文与设置 → op(content, settings, figures) → check_source_write（reviewer）→ save_content → 响应体。
    PatchError → 409/422。figures 同 routes_ast：客端临时 settings 带 spec_figures 时按它，否则读 docs/figures.md。"""
    store = request.app.state.store
    p = store.get(pid)
    if content is None:
        content = store.read_content(pid)
    try:
        s = normalize_settings(settings if settings is not None else p.settings, store.list_figs(p.dir))
    except (TypeError, ValueError, KeyError, IndexError) as e:
        raise HTTPException(422, f"settings 不合法：{e}")
    doc = None if settings and "spec_figures" in settings else store.load_figures(p.dir)
    try:
        r = op(content, s, doc)
    except patch.PatchError as e:
        raise HTTPException(
            409 if e.kind in ("stale", "conflict") else 422,
            {"kind": e.kind, "message": str(e), "line": e.line, "detail": None},
        )
    await auth.check_source_write(pid, user, content, r.content)
    with review_meta.writer(review_meta.author_of(user)):
        # 批80：save_content 内含 git commit——offload 防阻塞事件循环（contextvar author 随线程继承）
        backup = await asyncio.to_thread(store.save_content, pid, r.content)
    ast = routes_ast._parse(store, pid, r.content, settings)
    return {
        "ast": ast,
        "content": r.content,
        "changed_lines": r.changed_lines,
        "block_id": r.block_id,
        "backup": backup,
    }


@router.post("/api/projects/{pid}/blocks/{block_id:path}")
async def patch_block(pid: str, block_id: str, body: PatchIn, request: Request, user: auth.CurrentUser):
    return await _apply(
        request,
        pid,
        body.content,
        body.settings,
        lambda c, s, d: patch.patch_block(c, block_id, body.markdown, s, d, base=body.base),
        user,
    )


@router.post("/api/projects/{pid}/blocks")
async def insert_block(pid: str, body: InsertIn, request: Request, user: auth.CurrentUser):
    return await _apply(
        request,
        pid,
        body.content,
        body.settings,
        lambda c, s, d: patch.insert_block(c, body.kind, body.after_block_id, body.book, body.markdown, s, d),
        user,
    )


@router.delete("/api/projects/{pid}/blocks/{block_id:path}")
async def delete_block(pid: str, block_id: str, request: Request, user: auth.CurrentUser, body: DeleteIn | None = None):
    body = body or DeleteIn()
    return await _apply(
        request, pid, body.content, body.settings, lambda c, s, d: patch.delete_block(c, block_id, s, d), user
    )


@router.post("/api/mathml")
async def mathml(body: MathIn):
    return {"mathml": to_mathml(body.source)}


@router.get("/api/block-templates")
async def get_block_templates():
    return {"templates": block_templates.templates()}
