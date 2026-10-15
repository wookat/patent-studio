# -*- coding: utf-8 -*-
"""R8 实时协同（docs/plan/11-r8-realtime-design.md）。单元 G1-collab-server 所有；prep 只放契约与占位。

- routes.py   `GET /api/projects/{pid}/collab`（房间状态）
              + WebSocket `/api/projects/{pid}/collab/{book}`（y-websocket 协议）
- text.py     `apply_full_text(ytext, new, origin)`：服务端替换全文（UTF-8 字节偏移换算，spike 已验证）
- rooms.py    房间注册表 / 去抖写回 / 60 s 释放（G1 填实现；prep 只有常量与 `on_saved` 钩子）
"""

from app.collab.rooms import BOOKS, DEBOUNCE_S, IDLE_RELEASE_S, on_saved

__all__ = ["BOOKS", "DEBOUNCE_S", "IDLE_RELEASE_S", "on_saved"]
