"""平台应用工厂：`patent_studio.asgi:app` / `create_app()`。

B2 批挂载面：/api/health、认证路由（register/login/logout/users/me，auth=off 时按旧口径 501/204）、
静态前端（frontend/dist）、安全响应头、请求体上限、中文 422 文案。
/api/v1 平台路由、Yjs 协同 WebSocket 等随后续批次往这里并挂；
旧应用 `app.main:app` 不受影响，两者并存双跑。
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

    from patent_studio.api import router as platform_router
    from patent_studio.api.auth_routes import router as auth_router

    app.include_router(auth_router)
    app.include_router(platform_router)

    from patent_studio.api.yjs import collab_ws

    @app.websocket("/api/v1/working-copies/{working_copy_id}/collab")
    async def _collab(websocket: WebSocket):
        await collab_ws(websocket)

    if os.path.isdir(STATIC_DIR):
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
