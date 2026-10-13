# -*- coding: utf-8 -*-
"""对外用户 schema（07 §4.1）：User = {id, email, display_name, is_superuser, title, avatar_color}，
不含 is_active/is_verified（W4-E E2 在 /api/admin/users 单独暴露 is_active / last_login_at）。
头像色只收预设名（AVATAR_COLORS = 前端 collab/colors.ts PEER_COLORS 的 8 色名），空串 = 前端按显示名 colorFor 派生。"""
import uuid

from fastapi_users import schemas
from pydantic import Field

AVATAR_COLORS: tuple[str, ...] = ("blue", "orange", "green", "purple", "pink", "teal", "yellow", "red")


class UserRead(schemas.BaseUser[uuid.UUID]):
    display_name: str = ""
    title: str = ""
    avatar_color: str = ""
    is_active: bool = Field(default=True, exclude=True)
    is_verified: bool = Field(default=False, exclude=True)


class UserCreate(schemas.BaseUserCreate):
    display_name: str = ""
