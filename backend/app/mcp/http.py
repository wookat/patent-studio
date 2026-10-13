# -*- coding: utf-8 -*-
"""Streamable HTTP 挂进 FastAPI（docs/plan/10 §3.1）。

SDK 的 server.streamable_http_app() 每调用一次就新建一个 StreamableHTTPSessionManager（只能 run() 一次）并返回
自带 lifespan 的 Starlette（路由 /mcp）。这里不用它的 Starlette：主应用 lifespan 每次启动都调用一次
streamable_http_app() 拿到新的会话管理器并 run()；端点是精确路径 Route("/mcp")（不经 Mount → /mcp/ 307 跳转），
每个请求转给当前会话管理器，外面包一层 PatGate。

AUTH=off：host=127.0.0.1 → SDK 自动开启 DNS 重绑定保护（Host 只允许 127.0.0.1 / localhost / [::1]），与 PatGate 的
本机限制一致。AUTH=on：远程部署，Host 不可预知，交给 PatGate 的 PAT 校验，不开重绑定保护。
"""
import contextlib

from starlette.routing import Route

from app.config import AUTH_ON
from app.mcp.auth import PatGate

PATH = "/mcp"


def _new_session_manager(server):
    server.streamable_http_app(streamable_http_path=PATH, host="0.0.0.0" if AUTH_ON else "127.0.0.1")
    return server.session_manager


def mount_mcp(app, server) -> None:
    async def endpoint(scope, receive, send):
        await server.session_manager.asgi_app(scope, receive, send)

    app.router.routes.append(Route(PATH, endpoint=PatGate(endpoint)))


@contextlib.asynccontextmanager
async def mcp_lifespan(server):
    async with _new_session_manager(server).run():
        yield
