# -*- coding: utf-8 -*-
"""GET /api/projects/{pid}/history（list / {sha} / diff）+ POST {sha}/restore（docs/plan/07 §4.3）。

项目内 git 库见 app.domain.history；restore 走 ProjectStore.save_content（三书镜像同一份逻辑），
提交信息经 history.override 改为 `restore <sha7>`。

GET /diff?a=&b=&format=blocks（W9 "已修改" Tab）：除 unified diff 外再返回
  blocks: [{book, block_id, kind: added|removed|changed, lines: [from, to]}]（patent_docx.blockdiff.block_diff，
  按 b 版 AST 的块行区间归并，AST 走 routes_ast._parse 同路径）；任一版结构不成立时 blocks=null 且
  blocks_error={kind,message,line,detail}（同 /ast 的 422 detail）。format 省略或为 "unified" 时响应与旧版一致。
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.auth import CurrentUser
from app.convert import pipeline as convert_pipeline
from app.domain import history
from app.errors import error_detail
from app.routes import ast as routes_ast
from patent_docx.blockdiff import block_diff

router = APIRouter(prefix="/api/projects/{pid}/history", tags=["history"])
UNIT = "C3-history"


def _author(user) -> str | None:
    return user.email if user is not None else None


def _project_dir(request: Request, pid: str) -> str:
    return request.app.state.store.get(pid).dir


def _raise(exc: history.HistoryError):
    kind = "unavailable" if isinstance(exc, history.GitUnavailable) else "history"
    raise HTTPException(exc.status, error_detail(kind, str(exc), detail=UNIT))


@router.get("")
async def list_versions(pid: str, request: Request):
    d = _project_dir(request, pid)
    return await asyncio.to_thread(history.log, d)


@router.get("/diff")
async def diff_versions(pid: str, request: Request, a: str, b: str = history.WORK, format: str = "unified"):
    store = request.app.state.store
    d = _project_dir(request, pid)
    if format not in ("unified", "blocks"):
        raise HTTPException(422, error_detail("history", f"format 只能是 unified 或 blocks：{format}", detail=UNIT))

    def work():
        text = history.diff(d, a, b)
        if format != "blocks":
            return text, None, None
        a_text = history.show(d, a)
        b_text = store.read_content(pid) if b == history.WORK else history.show(d, b)
        return text, a_text, b_text

    try:
        text, a_text, b_text = await asyncio.to_thread(work)
    except history.HistoryError as e:
        _raise(e)
    out = {"a": a, "b": b, "diff": text}
    if format == "blocks":
        try:
            ast_a = routes_ast._parse(store, pid, a_text, None)
            ast_b = routes_ast._parse(store, pid, b_text, None)
            out["blocks"], out["blocks_error"] = block_diff(a_text, ast_a, b_text, ast_b), None
        except HTTPException as e:
            out["blocks"], out["blocks_error"] = None, e.detail
    return out


@router.get("/{sha}")
async def get_version(pid: str, sha: str, request: Request):
    d = _project_dir(request, pid)

    def work():
        full = history.resolve(d, sha)
        return full, history.show(d, full)

    try:
        full, content = await asyncio.to_thread(work)
    except history.HistoryError as e:
        _raise(e)
    return {"sha": full, "content": content}


@router.post("/{sha}/restore")
async def restore_version(pid: str, sha: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    d = store.get(pid).dir

    def work():
        full = history.resolve(d, sha)
        content = history.show(d, full)
        before = history.head(d)
        with history.override(f"restore {full[:7]}", _author(user)):
            store.save_content(pid, content)
        # 转换草稿附带暂存图（attachments/cv-fig* + manifest）：
        # 恢复的恰是该草稿 commit 时晋级进 figs/ 并编附图节，图号不悬空
        promoted = convert_pipeline.promote_staged_figures(d, full, content)
        return content, history.head(d), before, promoted

    try:
        content, sha_new, before, promoted = await asyncio.to_thread(work)
    except history.HistoryError as e:
        _raise(e)
    # 恢复到与当前一致的版本：commit 为空操作 → changed=false 让前端区分「已恢复」与「本就一致」
    return {"ok": True, "content": content, "sha_new": sha_new,
            "changed": sha_new != before, "figures_promoted": promoted}
