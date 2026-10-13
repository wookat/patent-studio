# -*- coding: utf-8 -*-
"""/api/projects/{pid}/novelty：查新记录卡读 / 整表写（W19 批4）。

服务在 app.domain.novelty；NoveltyError → HTTP {status} {detail: {kind, message, line: null, detail}}。
权限：main.py 的 ACL 依赖按方法判定（GET viewer / PUT editor），本文件不另设。
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.domain import novelty as nov

router = APIRouter(prefix="/api/projects/{pid}", tags=["novelty"])


class NoveltyHitIn(BaseModel):
    number: str = ""
    title: str = ""
    relevance: str = "A"
    note: str = ""
    link: str = ""


class NoveltyQueryIn(BaseModel):
    query: str
    provider: str = ""
    ran_at: str = ""


class NoveltyIn(BaseModel):
    queries: list[NoveltyQueryIn] = Field(default_factory=list)
    hits: list[NoveltyHitIn] = Field(default_factory=list)
    conclusion: str = ""


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
