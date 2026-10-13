# -*- coding: utf-8 -*-
"""R8 协同路由（11 §3）。

- `GET /api/projects/{pid}/collab` → {enabled, readonly, mode, rooms: [{book, peers}]}（只列活跃房间）；
  PATENT_STUDIO_COLLAB=off ⇒ {enabled: false, readonly: false, mode: 'edit', rooms: []}。
  readonly = 请求者在本案是 viewer 或 reviewer（AUTH=on；/members 只有 owner 能读，前端无法自行推断角色）；
  mode（W4-B 14 D5.2）：viewer ⇒ 'readonly'，reviewer ⇒ 'review'（房间内只读，建议走 HTTP + check_source_write），
  其他 'edit'。
- WebSocket `/api/projects/{pid}/collab/{book}`：y-websocket 二进制协议（sync + awareness），子协议无。
  用 `router.add_websocket_route`（Starlette 原生 WebSocketRoute）而非 `@router.websocket`：后者会套上 main.py 的全局
  依赖 `project_access(request: Request, …)`，在 WebSocket 作用域下 FastAPI 无法注入 `Request`，握手直接 500
  （spike 实测，11 §0.4）。鉴权在端点内自己做：`auth.users.read_cookie_user(ws)`（只读 `.cookies`）+ `acl.role_for`。
  先 `accept()` 再拒绝（`close(1008, reason)`），否则 HTTP 层是 403、浏览器只见 1006（11 §3.4）。
"""
from fastapi import APIRouter
from starlette.websockets import WebSocket

from app import auth, config
from app.collab import rooms
from app.collab.rooms import BOOKS, DEFAULT_AUTHOR
from app.domain import projects

REJECT = 1008
router = APIRouter()


@router.get("/api/projects/{pid}/collab")
async def collab_status(pid: str, user: auth.CurrentUser):
    if not config.COLLAB_ON:
        return {"enabled": False, "readonly": False, "mode": "edit", "rooms": []}
    role = await _role_of(pid, user) if user is not None else None
    mode = {"viewer": "readonly", "reviewer": "review"}.get(role, "edit")
    return {"enabled": True, "readonly": mode != "edit", "mode": mode, "rooms": rooms.rooms_of(pid)}


async def _role_of(pid: str, user) -> str | None:
    from app.auth import acl

    return "owner" if user.is_superuser else await acl.role_for(pid, user.id)


async def _identify(ws: WebSocket, pid: str):
    """AUTH=on：cookie → 用户 → 角色；返回 (author, readonly, user_id) 或 None（拒绝）。
    viewer / reviewer 房间内只读。"""
    from app.auth.users import read_cookie_user

    user = await read_cookie_user(ws)
    if user is None:
        return None
    role = await _role_of(pid, user)
    if role is None:
        return None
    return user.display_name or user.email, role in ("viewer", "reviewer"), str(user.id)


async def collab_ws(ws: WebSocket) -> None:
    pid, book = ws.path_params["pid"], ws.path_params["book"]
    await ws.accept()
    if not config.COLLAB_ON:
        await ws.close(code=REJECT, reason="collab_off")
        return
    if book not in BOOKS:
        await ws.close(code=REJECT, reason="bad_book")
        return
    author, readonly, user_id = DEFAULT_AUTHOR, False, None
    if config.AUTH_ON:
        ident = await _identify(ws, pid)
        if ident is None:
            await ws.close(code=REJECT, reason="forbidden")
            return
        author, readonly, user_id = ident
    try:
        room = await rooms.get_or_create(pid, book, ws.app.state.store)
    except projects.ProjectError as e:
        await ws.close(code=REJECT, reason=f"project:{e.status}")
        return
    await rooms.serve(room, rooms.Channel(ws, room, author, readonly, user_id))


router.add_websocket_route("/api/projects/{pid}/collab/{book}", collab_ws, name="collab_ws")
