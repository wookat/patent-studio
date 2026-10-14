# -*- coding: utf-8 -*-
"""MCPServer 实例（mcp 2.x；原 FastMCP）。stdio 与 Streamable HTTP 共用同一实例与同一套工具。"""

from mcp.server.mcpserver import MCPServer

from app import config
from app.domain.projects import ProjectStore
from app.mcp import (
    tools,
    tools_admin,
    tools_attachments,
    tools_case,
    tools_figures,
    tools_lifecycle,
    tools_novelty,
    tools_semantic,
)

INSTRUCTIONS = (
    "Patent Studio：中国发明专利申请文件工作台。content.md 是唯一权威源；"
    "写操作默认以 CriticMarkup 建议（{++ ++} {-- --} {~~ ~> ~~}）写入，由作者接受/拒绝；"
    "direct=true 才直接改写。构建产物 DOCX/PDF 通过 build 工具返回的 URL 下载。"
    "理解某条权项时先 context_pack(pid, claim_id)，再给建议。"
)

store = ProjectStore(config.PROJECTS_DIR)
server = MCPServer("patent-studio", instructions=INSTRUCTIONS, version="0.1.0")
# 注册顺序即 list_tools 顺序，须与 schemas.TOOL_NAMES 一致
for mod in (
    tools,
    tools_figures,
    tools_case,
    tools_attachments,
    tools_semantic,
    tools_lifecycle,
    tools_admin,
    tools_novelty,
):
    mod.register(server, store)
