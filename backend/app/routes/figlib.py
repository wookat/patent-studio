"""专利附图图库只读接口（docs/figure-library 构建产物直出）。

GET /api/figlib            → manifest.json（patents + figures 全量，前端分组/搜索）
GET /api/figlib/img/{path} → 单张附图 PNG（path 为 manifest file 字段，如 "B流程图/CN…fig1.png"）
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app import auth

router = APIRouter(
    prefix="/api/figlib",
    tags=["figlib"],
    dependencies=[Depends(auth.require_login)],  # 登录态才给看：图库是机构资产不公开
)

# backend/app/routes/figlib.py → parents[3] = 仓库根
LIB_DIR = Path(__file__).resolve().parents[3] / "docs" / "figure-library"

_cache: tuple[float, dict] | None = None


def _manifest() -> dict:
    global _cache
    p = LIB_DIR / "manifest.json"
    if not p.exists():
        raise HTTPException(404, "figure library not built")
    mtime = p.stat().st_mtime
    if _cache is None or _cache[0] != mtime:
        _cache = (mtime, json.loads(p.read_text(encoding="utf-8")))
    return _cache[1]


@router.get("")
async def get_manifest(user: auth.CurrentUser):  # noqa: ARG001
    return _manifest()


@router.get("/img/{file_path:path}")
async def get_image(file_path: str, user: auth.CurrentUser):  # noqa: ARG001
    _manifest()  # 图库未建 404
    p = (LIB_DIR / file_path).resolve()
    if not str(p).startswith(str(LIB_DIR.resolve())) or not p.is_file():
        raise HTTPException(404, "figure not found")
    return FileResponse(p, media_type="image/png")
