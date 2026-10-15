# -*- coding: utf-8 -*-
"""W19 批4 查新工具（复用 app.domain.novelty，同 REST /novelty 路由）：

- get_novelty(pid) → 查新记录卡 {updated_at, queries[], hits[], conclusion}；无记录返回空卡。viewer+。
- record_novelty(pid, queries=[], hits=[], conclusion=None) → 增量登记：检索式按 query+provider 去重追加、
  对比文件按公开号（无号按标题）覆盖、conclusion 仅非 None 才改。s8/对话检索完应当调用，让结论落进
  固定档案而非散进批注。相关度用 ECLA 分类：X 破坏新颖性 / Y 影响创造性 / A 背景 / P 申请日前后之间。
  AUTH=on 需 editor+。
"""

from __future__ import annotations

from typing import Any

from app.domain import novelty as nov
from app.mcp.tools import _err, open_project_for, run_audited
from app.mcp.tools_figures import open_for_write


def _load(store, pid):
    try:
        return nov.load_novelty(store, pid)
    except nov.NoveltyError as e:
        raise _err("novelty", str(e)) from e


def _record(store, pid, queries, hits, conclusion):
    try:
        return nov.record_novelty(store, pid, queries=queries, hits=hits, conclusion=conclusion)
    except nov.NoveltyError as e:
        raise _err("novelty", str(e)) from e


def register(server, store):
    @server.tool(name="get_novelty")
    async def get_novelty_tool(pid: str) -> dict[str, Any]:
        """查新记录卡：检索式、对比文件（相关度 X/Y/A/P）、代理师结论；同 GET /api/projects/{pid}/novelty。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_novelty", {}, lambda: _load(store, pid))

    @server.tool(name="record_novelty")
    async def record_novelty_tool(
        pid: str, queries: list[dict] | None = None, hits: list[dict] | None = None, conclusion: str | None = None
    ) -> dict[str, Any]:
        """增量登记查新发现（检索式/对比文件/结论）。s8 或对话检索跑完应把结果记这里；
        对比文件相关度 X/Y/A/P（ECLA）。conclusion 不传则保留已有结论。AUTH=on 需 editor+。"""
        args = {"queries": len(queries or []), "hits": len(hits or []), "conclusion": conclusion is not None}
        await open_for_write(store, pid, "editor", "record_novelty", args)
        return await run_audited(
            store, pid, "record_novelty", args, lambda: _record(store, pid, queries, hits, conclusion)
        )
