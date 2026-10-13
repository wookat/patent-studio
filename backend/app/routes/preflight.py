# -*- coding: utf-8 -*-
"""GET/POST /api/projects/{pid}/preflight：递交前体检报告（R2.5）。

契约 docs/plan/05-r2-figures-preflight-design.md §3.2：POST 体与 /ast 相同 {content?, settings?}；
GET 读盘；结构不成立 → 422 同 /ast。
"""
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.domain import terms
from app.domain.projects import normalize_settings
from patent_studio.kernel import critic, preflight
from patent_studio.kernel.ast import AstError, parse_ast

router = APIRouter(prefix="/api/projects/{pid}", tags=["preflight"])
log = logging.getLogger("patent_studio.preflight")


class PreflightIn(BaseModel):
    content: str | None = None
    settings: dict | None = None


def _report(store, pid, content, settings):
    p = store.get(pid)
    if content is None:
        content = store.read_content(pid)
    content = critic.accept(content)  # 07 §6.4：与 /ast /lint 一致恒按 final 文本体检；accept 不改行数
    try:
        s = normalize_settings(settings if settings is not None else p.settings, store.list_figs(p.dir))
    except (TypeError, ValueError, KeyError, IndexError) as e:
        raise HTTPException(422, f"settings 不合法：{e}")
    t0 = time.perf_counter()
    doc = None if settings and "spec_figures" in settings else store.load_figures(p.dir)
    try:
        ast = parse_ast(content, s, figures=doc)
    except AstError as e:
        raise HTTPException(422, {"kind": "content", "message": str(e), "line": e.line, "detail": None})
    report = preflight.run(ast, s, terms.load(p.dir), figs=store.list_figs(p.dir), figures=doc)
    log.info("preflight %s: %s，%.1f ms", pid, report["counts"], (time.perf_counter() - t0) * 1000)
    return report


@router.get("/preflight")
async def get_preflight(pid: str, request: Request):
    return _report(request.app.state.store, pid, None, None)


@router.post("/preflight")
async def post_preflight(pid: str, body: PreflightIn, request: Request):
    return _report(request.app.state.store, pid, body.content, body.settings)
