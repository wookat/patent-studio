# -*- coding: utf-8 -*-
"""W4-E E3 附图工具（docs/plan/17 §4.2；原在 tools.py，prep 时整体搬入，行为与名字不变）。

list_figures / set_figure_order / set_figure_width 全部复用 app.domain.figures（同 REST /figures 路由）；
两条写工具直接改 docs/figures.md（图序 / 宽度是版面不是正文，不走 CriticMarkup），AUTH=on 需 editor+，被拒也进审计
（同 tools.write 的 direct 写）。
"""
from __future__ import annotations

from typing import Any

from app.domain.figures import (
    delete_figure_source,
    get_figure_source,
    list_figure_sources,
    list_figures,
    put_figure_source,
    reorder_figures,
    update_figure,
)
from app.mcp import audit
from app.mcp.tools import ToolError, _allow, actor, open_project_for, run_audited


async def open_for_write(store, pid: str, need: str, tool: str, args: dict[str, Any]):
    """写工具的 open_project_for：ACL 拒绝记 error:forbidden 再抛（pid 不存在时没有目录可记，照常抛 not_found）。"""
    p = await open_project_for(store, pid)
    try:
        await _allow(actor(), pid, need)
    except ToolError:
        audit.record(p.dir, actor().name, tool, args, "error:forbidden")
        raise
    return p


def register(server, store):
    @server.tool(name="list_figures")
    async def list_figures_tool(pid: str) -> dict[str, Any]:
        """附图列表（同 GET /api/projects/{pid}/figures）；图序 / 宽度 / 摘要图真源 = docs/figures.md。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "list_figures", {}, lambda: list_figures(store, pid))

    @server.tool(name="set_figure_order")
    async def set_figure_order_tool(pid: str, order: list[str]) -> dict[str, Any]:
        """重排说明书附图（同 PUT /figures/order）：order 必须是当前全部附图文件名的排列；图号随新顺序重算。
        直接写 docs/figures.md（不是建议），AUTH=on 需 editor+。"""
        await open_for_write(store, pid, "editor", "set_figure_order", {"n": len(order)})
        return await run_audited(store, pid, "set_figure_order", {"n": len(order)},
                                 lambda: reorder_figures(store, pid, order))

    @server.tool(name="set_figure_width")
    async def set_figure_width_tool(pid: str, name: str, width: float | None = None,
                                    abstract_width: float | None = None) -> dict[str, Any]:
        """改一张附图的宽度（cm；同 PUT /figures/{name}）：width = 说明书附图宽，abstract_width = 它作为摘要图时的宽。
        直接写 docs/figures.md，AUTH=on 需 editor+。"""
        args = {"name": name, "width": width, "abstract_width": abstract_width}
        await open_for_write(store, pid, "editor", "set_figure_width", args)
        return await run_audited(store, pid, "set_figure_width", args,
                                 lambda: update_figure(store, pid, name, width=width, abstract_width=abstract_width))

    # ---- W16 绘制图源 figs-src/*.mmd（Mermaid）：生成 CNIPA 黑白线稿图源，用户在附图书「绘制」里预览/导出 ----
    _MMD_GUIDE = (
        "图源是 Mermaid 源码（flowchart/结构框图）。CNIPA 约束：节点文字用中文；"
        "部件标号写进节点文本（如 [\"处理器 101\"]）并与正文标号一致；平台渲染已锁黑白线稿，"
        "不要写 style/classDef 颜色；流程图用 flowchart TB/LR，系统框图用 subgraph 分组。"
    )

    @server.tool(name="list_figure_sources")
    async def list_figure_sources_tool(pid: str) -> dict[str, Any]:
        """绘制图源列表（同 GET /figures-src）：figs-src/*.mmd 全部已存图源。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "list_figure_sources", {},
                                 lambda: list_figure_sources(store, pid))

    @server.tool(name="get_figure_source")
    async def get_figure_source_tool(pid: str, name: str) -> dict[str, Any]:
        """读一张图源全文（同 GET /figures-src/{name}）：改图前先读现有源。""" + _MMD_GUIDE
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_figure_source", {"name": name},
                                 lambda: get_figure_source(store, pid, name))

    @server.tool(name="put_figure_source")
    async def put_figure_source_tool(pid: str, name: str, source: str) -> dict[str, Any]:
        """新建/覆盖图源 figs-src/<stem>.mmd（同 PUT /figures-src/{name}）：stem 限字母/数字/_/-。
        直接写（AUTH=on 需 editor+）；保存后用户可在附图书「绘制」中预览并一键导出 PNG 入附图节。
        返回 lint（未连通/断链/重号/缺标号等结构化告警）与 readback（渲染器对图源结构的白话理解）——
        lint warn 命中须修正后重写。""" + _MMD_GUIDE
        args = {"name": name, "chars": len(source or "")}
        await open_for_write(store, pid, "editor", "put_figure_source", args)
        return await run_audited(store, pid, "put_figure_source", args,
                                 lambda: put_figure_source(store, pid, name, source))

    @server.tool(name="delete_figure_source")
    async def delete_figure_source_tool(pid: str, name: str) -> dict[str, Any]:
        """删除图源 figs-src/{name}（同 DELETE /figures-src/{name}），AUTH=on 需 editor+。"""
        args = {"name": name}
        await open_for_write(store, pid, "editor", "delete_figure_source", args)
        return await run_audited(store, pid, "delete_figure_source", args,
                                 lambda: delete_figure_source(store, pid, name))
