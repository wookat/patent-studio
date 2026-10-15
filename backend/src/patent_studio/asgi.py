"""平台应用工厂：`patent_studio.asgi:app` / `create_app()`。

挂载面：/api/health、认证路由（register/login/logout/users/me，auth=off 时按 501/204 口径）、
/api/v1 平台路由、Yjs 协同 WebSocket、静态前端（frontend/dist）、安全响应头、请求体上限、中文 422 文案。
B11 起为唯一服务入口：旧 `app.main:app`（SQLite/内存实现）已随 backend/app/ 树整体退役。
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.websockets import WebSocket

REPO_ROOT = Path(__file__).resolve().parents[3]
STATIC_DIR = os.environ.get("PATENT_STATIC_DIR", str(REPO_ROOT / "frontend" / "dist"))
BODY_LIMIT = 64 * 1024 * 1024


def _friendly_422(exc: RequestValidationError) -> str:
    for e in exc.errors():
        loc = ".".join(str(x) for x in e["loc"][1:])
        msg = e["msg"]
        if e["type"] == "missing":
            return f"{loc}：必填字段缺失"
        if "email" in e["type"] or loc.endswith("email"):
            return "邮箱格式不正确"
        if e["type"].startswith("string_too_short"):
            return f"{loc}：长度不足"
        return f"{loc}：{msg}"
    return "请求参数不合法"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response


class BodyLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        length = request.headers.get("content-length")
        if length and int(length) > BODY_LIMIT:
            return JSONResponse(
                status_code=413,
                content={"detail": {"kind": "file", "message": "请求体过大", "line": None, "detail": None}},
            )
        return await call_next(request)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    from patent_studio.infra.auth import auth_on, dispose_engines

    if auth_on():
        await dispose_engines()


def create_app() -> FastAPI:
    app = FastAPI(title="Patent Studio API", version="0.1.0", lifespan=_lifespan)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(BodyLimitMiddleware)

    @app.exception_handler(RequestValidationError)
    async def _validation(request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "kind": "validation",
                    "message": _friendly_422(exc),
                    "line": None,
                    "detail": None,
                }
            },
        )

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    # B16：旧前端全量恢复——旧 FastAPI 应用（aa86a66 的 backend/app/）挂载到 "/"，
    # 旧 /api/* 面（projects/notify/admin/deliver/deadlines…）与前端静态页由它兜底；
    # 本应用先注册的新面（/api/v1/*、/api/health、v1 collab WS）优先命中。
    # /api/auth/* 与 /api/users/me 两套都实现：旧路由先注册，以旧面为准——
    # 两侧 cookie 同名（studio_session）同 secret（PATENT_STUDIO_SECRET），签发的 JWT 互认。
    try:
        import sys

        _backend_dir = str(Path(__file__).resolve().parents[2])  # backend/（app 包所在）
        if _backend_dir not in sys.path:
            sys.path.insert(0, _backend_dir)
        from app import config as legacy_config
        from app.main import app as legacy_app

        if legacy_config.AUTH_ON:
            # AUTH=on 时旧面为准：/api/auth/* 与 /api/users/me 走 sqlite 旧栈。
            # off 模式不 include——旧桩路由（501/204）会遮蔽新面的动态认证开关。
            from app.auth.router import router as legacy_auth_router
            from app.auth.users_me import router as legacy_users_me_router

            app.include_router(legacy_auth_router)
            app.include_router(legacy_users_me_router)
        legacy_available = True
    except Exception:  # pragma: no cover - 旧树缺失时保持新面可用
        import logging

        logging.getLogger("patent_studio.asgi").warning("legacy backend mount failed", exc_info=True)
        legacy_app = None
        legacy_available = False

    from patent_studio.api import router as platform_router
    from patent_studio.api.auth_routes import router as auth_router

    app.include_router(auth_router)
    app.include_router(platform_router)

    from patent_studio.api.yjs import collab_ws

    @app.websocket("/api/v1/working-copies/{working_copy_id}/collab")
    async def _collab(websocket: WebSocket):
        await collab_ws(websocket)

    if legacy_available:
        app.mount("/", legacy_app, name="legacy")

    if os.path.isdir(STATIC_DIR):
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
