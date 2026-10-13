# -*- coding: utf-8 -*-
"""访问记录 / 协作设置路由（docs/plan/14 §4）。B1-access-log 所有；main.py 已注册（prep）。

AUTH=off ⇒ 三条路由 501（errors.not_implemented，detail = 单元名，与成员 / 分享路由的 501 同形）。
门槛：/access GET owner（ROUTE_ROLE）；/collab-settings GET viewer、PUT 在路由内 `auth.require_role("owner")`。
AUTH_ON 在请求时读（不在 import 时分支）：测试按 on/off 重载 config 时本模块不会被重新 import。
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import auth, config
from app.auth import access
from app.errors import not_implemented

UNIT = "B1-access-log"
_OFF = "账号未开启（PATENT_STUDIO_AUTH=off）"
router = APIRouter(prefix="/api/projects/{pid}")


class CollabSettingsIn(BaseModel):
    allow_download: bool | None = None
    allow_copy: bool | None = None
    allow_comment: bool | None = None


def _require_on() -> None:
    if not config.AUTH_ON:
        raise not_implemented(UNIT, _OFF)


@router.get("/access")
async def get_access(pid: str):
    _require_on()
    return await access.list_access(pid)


@router.get("/collab-settings")
async def get_collab_settings(pid: str):
    _require_on()
    return await access.get_settings(pid)


@router.put("/collab-settings", dependencies=[Depends(auth.require_role("owner"))])
async def put_collab_settings(pid: str, body: CollabSettingsIn):
    _require_on()
    return await access.put_settings(pid, body.model_dump())
