# -*- coding: utf-8 -*-
"""三书文档集路由（docs/plan/04-r1-design.md §4）。

  GET /api/projects/{pid}/docs            {"title": str, "books": {<book>: {"content": str, "offset": int}}}
  GET /api/projects/{pid}/docs/{book}     {"book": book, "content": str, "offset": int, "sha": str}
  PUT /api/projects/{pid}/docs/{book} {content, base_sha?}  → 写回 content.md（写入真源）并刷新镜像
    成功 200：{"ok", "backup", "backups", "ast", "content", "changed_lines": {"start","end"}, "sha"}
      —— W9 整书保存契约：ast 走 routes_ast._parse（critic.accept 后解析）；源码保存不拒绝结构不成立的半成品，
         此时 ast=null 且 ast_error={kind,message,line,detail}（同 /ast 的 422 detail）；content 为新全文；
         changed_lines 为该书新正文占据的全文行闭区间
         （同 patch.py：start=offset+1，end=offset+行数，空书 end=start-1）；
         sha 为该书新正文的 sha1（与 GET 的 sha 同算法，下次 PUT 的 base_sha）。
      base_sha 给了且 ≠ 该书当前 sha → 409 {"detail": {"kind": "stale", "message", "sha"}}
      （别处已改，客端应刷新后重试）。
      写回走 ProjectStore.save_content（镜像 + history + collab.on_saved），与块补丁一致。

content.md 是真源：GET 每次对它现场 split（不读 docs/ 镜像，镜像只服务磁盘/外部脚本）。
book ∉ BOOKS → 404；content.md 非规范三书（缺书/乱序/无标题）→ 422；均为 {"detail": "..."}。
"""
import asyncio
import hashlib

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import auth
from app.domain import review_meta
from app.routes import ast as routes_ast
from patent_studio.kernel import docset
from patent_studio.kernel.docset import BOOKS

router = APIRouter(prefix="/api/projects/{pid}", tags=["docset"])


class DocIn(BaseModel):
    content: str
    base_sha: str | None = None


def book_sha(text: str) -> str:
    """书正文（docs/<book>.md 内容，不含 `## ` 标题行）的 sha1 hex。"""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def book_changed_lines(offset: int, body: str) -> dict:
    """整书替换后该书正文的全文行区间（1-based 闭区间，同 patch.PatchResult.changed_lines）。"""
    n = len(docset._lines(body))
    return {"start": offset + 1, "end": offset + n}


def _check_book(book: str):
    if book not in BOOKS:
        raise HTTPException(status_code=404, detail=f"未知书名：{book}（可选：{'、'.join(BOOKS)}）")


def _load(request: Request, pid: str):
    store = request.app.state.store
    ds = docset.split(store.read_content(pid))
    try:
        docset.validate(ds)
    except docset.DocsetError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return store, ds, docset.offsets(ds)


@router.get("/docs")
async def get_docs(request: Request, pid: str):
    _, ds, off = _load(request, pid)
    return {"title": ds.title, "books": {b: {"content": ds.book(b), "offset": off[b]} for b in BOOKS}}


@router.get("/docs/{book}")
async def get_doc(request: Request, pid: str, book: str):
    _check_book(book)
    _, ds, off = _load(request, pid)
    text = ds.book(book)
    return {"book": book, "content": text, "offset": off[book], "sha": book_sha(text)}


@router.put("/docs/{book}")
async def put_doc(request: Request, pid: str, book: str, body: DocIn, user: auth.CurrentUser):
    _check_book(book)
    store, ds, off = _load(request, pid)
    cur_sha = book_sha(ds.book(book))
    if body.base_sha is not None and body.base_sha != cur_sha:
        raise HTTPException(409, {"kind": "stale", "message": f"{book} 已在别处修改，请刷新后重试", "sha": cur_sha})
    new_ds = docset.replace(ds, book, body.content)
    new = docset.assemble(new_ds)
    old = store.read_content(pid)
    await auth.check_source_write(pid, user, old, new)
    with review_meta.writer(review_meta.author_of(user)):
        # 批80：save_content 内含 git commit——offload 防阻塞事件循环（contextvar author 随线程继承）
        backup = await asyncio.to_thread(store.save_content, pid, new)
    try:
        ast, ast_error = routes_ast._parse(store, pid, new, None), None
    except HTTPException as e:
        ast, ast_error = None, e.detail
    return {"ok": True, "backup": backup, "backups": store.list_backups(pid)[:20],
            "ast": ast, "ast_error": ast_error, "content": new,
            "changed_lines": book_changed_lines(off[book], new_ds.book(book)), "sha": book_sha(new_ds.book(book))}
