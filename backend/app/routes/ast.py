# -*- coding: utf-8 -*-
"""GET/POST /api/projects/{pid}/ast：content.md（或未保存正文）→ 块 AST（04-r1-design §4）。

结构不成立（缺标题/未知 ## 章节/公式未闭合）→ 422 {"detail": {kind, message, line, detail}}，
line 为全文行；其余错误形状沿用 main.py 的 {"detail": ...}。
"""
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.domain.projects import normalize_settings
from patent_docx import critic
from patent_docx.ast import AstError, parse_ast

router = APIRouter(prefix="/api/projects/{pid}", tags=["ast"])
log = logging.getLogger("patent_studio.ast")


class AstIn(BaseModel):
    content: str | None = None
    settings: dict | None = None


def _parse(store, pid, content, settings):
    p = store.get(pid)
    if content is None:
        content = store.read_content(pid)
    content = critic.accept(content)  # 07 §6.4：AST 恒按 final 文本解析；accept 不改行数，块 lines 仍对应源码
    try:
        s = normalize_settings(settings if settings is not None else p.settings, store.list_figs(p.dir))
    except (TypeError, ValueError, KeyError, IndexError) as e:
        raise HTTPException(422, f"settings 不合法：{e}")
    t0 = time.perf_counter()
    # 客端临时 settings 带 spec_figures（未保存的设置预览）时按它算图序；否则图书来自 docs/figures.md 真源（含 alt）
    doc = None if settings and "spec_figures" in settings else store.load_figures(p.dir)
    try:
        ast = parse_ast(content, s, figures=doc)
    except AstError as e:
        raise HTTPException(422, {"kind": "content", "message": str(e), "line": e.line, "detail": None})
    log.info("ast %s: %d 行 → %d 权项 / %d 说明书块，%.1f ms", pid, content.count("\n") + 1,
             len(ast["claims"]), len(ast["description"]), (time.perf_counter() - t0) * 1000)
    return ast


@router.get("/ast")
async def get_ast(pid: str, request: Request):
    return _parse(request.app.state.store, pid, None, None)


@router.post("/ast")
async def post_ast(pid: str, body: AstIn, request: Request):
    return _parse(request.app.state.store, pid, body.content, body.settings)
