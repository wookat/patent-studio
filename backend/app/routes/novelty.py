# -*- coding: utf-8 -*-
"""/api/projects/{pid}/novelty：查新记录卡读 / 整表写（W19 批4）。

服务在 app.domain.novelty；NoveltyError → HTTP {status} {detail: {kind, message, line: null, detail}}。
权限：main.py 的 ACL 依赖按方法判定（GET viewer / PUT editor），本文件不另设。
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.domain import comments as store_mod
from app.domain import novelty as nov
from app.routes.comments import _author, _project_dir
from app.routes.preflight import _report

router = APIRouter(prefix="/api/projects/{pid}", tags=["novelty"])


class NoveltyHitIn(BaseModel):
    number: str = ""
    title: str = ""
    relevance: str = "A"
    note: str = ""
    link: str = ""
    publication_date: str = ""


class NoveltyQueryIn(BaseModel):
    query: str
    provider: str = ""
    ran_at: str = ""


class NoveltyEvidenceIn(BaseModel):
    id: str = ""
    hit: str
    claim: int | None = None
    feature: str = ""
    quote: str = ""
    status: str = ""


class NoveltyIn(BaseModel):
    queries: list[NoveltyQueryIn] = Field(default_factory=list)
    hits: list[NoveltyHitIn] = Field(default_factory=list)
    evidence: list[NoveltyEvidenceIn] = Field(default_factory=list)
    conclusion: str = ""


class EvidenceIn(BaseModel):
    """Z31 追加证据行：hit = 已登记对比文件公开号/标题；claim = 锚定权项（annotate 必填）。"""

    hit: str = Field(min_length=1)
    claim: int | None = Field(default=None, ge=1)
    feature: str = ""
    quote: str = ""
    status: str = ""


class AnnotateIn(EvidenceIn):
    claim: int = Field(ge=1)


def _run(fn, *args):
    try:
        return fn(*args)
    except nov.NoveltyError as e:
        raise HTTPException(e.status, {"kind": "novelty", "message": str(e), "line": None, "detail": None})


@router.get("/novelty")
async def get_novelty(pid: str, request: Request):
    """→ {updated_at, queries[], hits[], conclusion}；无记录返回空卡。"""
    return await asyncio.to_thread(_run, nov.load_novelty, request.app.state.store, pid)


@router.put("/novelty")
async def put_novelty(pid: str, body: NoveltyIn, request: Request):
    """整表覆盖；校验失败 422；→ 同 GET（updated_at 服务端打）。"""
    return await asyncio.to_thread(_run, nov.save_novelty, request.app.state.store, pid, body.model_dump())


@router.post("/novelty/evidence", status_code=201)
async def post_evidence(pid: str, body: EvidenceIn, request: Request):
    """Z31：追加证据对照行；hit 未登记 / quote 空 → 422 或 pending 降级。"""
    rec, ev = await asyncio.to_thread(_run, nov.add_evidence, request.app.state.store, pid, body.model_dump())
    return {"record": rec, "evidence": ev}


def _claim_line(report: dict, num: int) -> int | None:
    node = next((n for n in report.get("claim_tree") or [] if n.get("num") == num), None)
    return node.get("line") if node else None


@router.post("/novelty/annotate", status_code=201)
async def post_annotate(pid: str, body: AnnotateIn, request: Request, user: CurrentUser):
    """Z31：证据行入库 + 在 claims/{claim} 块上落审阅批注（source=ai，不改正文）。

    权项不存在 ⇒ 422（错误引用不降级成无锚批注）；hit 未登记 ⇒ 422；
    quote 空 ⇒ 证据行恒 pending，批注正文明示「待核对」，不构成命中/缺失结论。"""
    store = request.app.state.store
    report = await asyncio.to_thread(_report, store, pid, None, None)
    line = _claim_line(report, body.claim)
    if line is None:
        raise HTTPException(
            422,
            {
                "kind": "novelty",
                "message": f"权 {body.claim} 不存在（无法定位批注锚点）",
                "line": None,
                "detail": None,
            },
        )
    rec, ev = await asyncio.to_thread(_run, nov.add_evidence, store, pid, body.model_dump())
    hit = nov.find_hit(rec, ev["hit"])
    d = _project_dir(request, pid)
    anchor = store_mod.Anchor(block_id=f"claims/{body.claim}", line=line, book="claims")
    async with store_mod.ledger_lock(d):
        with store_mod.file_lock(d):
            comments = store_mod.load(d)
            c = store_mod.create(anchor, nov.annotation_body(hit, ev), _author(user), source="ai")
            comments.append(c)
            store_mod.save(d, comments)
    return {"comment": c.to_dict(), "evidence": ev}
