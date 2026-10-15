# -*- coding: utf-8 -*-
"""MCP Server（docs/plan/10 §3，单元 F1-mcp-server）。

server.py   MCPServer 实例 + 独立 ProjectStore（stdio 进程无 FastAPI）
tools.py    register(server)：@server.tool() / @server.resource() 注册 v1 工具集（F1 实现）
schemas.py  工具入参/出参 Pydantic 模型（契约，prep 已定）
auth.py     Actor / CURRENT_ACTOR / PatGate（ASGI）/ verify_pat
audit.py    .studio/audit.jsonl 追加与读取
http.py     mount_mcp(app) + mcp_lifespan：Streamable HTTP 挂在 FastAPI 精确路径 /mcp
__main__.py python -m app.mcp → stdio
"""
