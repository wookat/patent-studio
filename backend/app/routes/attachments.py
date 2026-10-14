# -*- coding: utf-8 -*-
"""/api/projects/{pid}/attachments*：案卷附件列表 / 上传 / 下载 / 删除（W4-C C2；docs/plan/15 §3.2）。

服务在 app.domain.attachments；AttachmentsError → HTTP {status} {detail: {kind, message, line: null, detail}}
（越界名 / 类型 400、重名 409、超大 413、不存在 404）。
权限：main.py 的 ACL 依赖按方法判定（GET viewer / POST·DELETE editor），本文件不另设。
处理函数通过 request.app.state.store 取 ProjectStore，不反向 import app.main。
"""

import asyncio
import os
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app.domain import attachments as att
from app.domain.projects import ATTACHMENT_MAX_BYTES
from app.routes import read_bounded

router = APIRouter(prefix="/api/projects/{pid}", tags=["attachments"])
_FILES = File(...)


def _run(fn, *args):
    try:
        return fn(*args)
    except att.AttachmentsError as e:
        raise HTTPException(e.status, {"kind": "attachments", "message": str(e), "line": None, "detail": e.detail})


def _disposition(kind, filename):
    ascii_name = filename if filename.isascii() else "attachment" + os.path.splitext(filename)[1]
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@router.get("/attachments")
async def list_attachments(pid: str, request: Request):
    """→ {"items": [{name, ext, size, mtime, kind, url}]}"""
    return att.list_attachments(request.app.state.store, pid)


@router.post("/attachments")
async def upload_attachments(pid: str, request: Request, files: list[UploadFile] = _FILES):
    """multipart files[]；白名单 pdf/docx/doc/md/txt/png/jpg/zip，单文件 ≤ 50 MB；重名 409；→ 同 GET"""
    payload = [(f.filename, await read_bounded(f, "attachments", ATTACHMENT_MAX_BYTES)) for f in files]
    # 批80：多文件 50MB 级落盘同步跑会阻塞事件循环——offload
    return await asyncio.to_thread(_run, att.upload_attachments, request.app.state.store, pid, payload)


@router.post("/attachments/seed-intake")
async def seed_intake(pid: str, request: Request):
    """W19 批3：内置「技术交底书模板.md」落 attachments/；已存在 409；→ 同 GET"""
    return await asyncio.to_thread(_run, att.seed_intake_template, request.app.state.store, pid)


@router.get("/attachments/{name}")
async def get_attachment(pid: str, name: str, request: Request, download: bool = False):
    """原文件（inline；download=1 → attachment）。pdf/图片/文本预览与下载共用。"""
    path = _run(att.attachment_path, request.app.state.store, pid, name)
    base = os.path.basename(path)
    media = att.MEDIA_OF_EXT[os.path.splitext(base)[1].lower()]
    return FileResponse(
        path,
        media_type=media,
        headers={
            "Content-Disposition": _disposition("attachment" if download else "inline", base),
            "Cache-Control": "no-store",
        },
    )


@router.delete("/attachments/{name}")
async def delete_attachment(pid: str, name: str, request: Request):
    """→ 同 GET"""
    return _run(att.delete_attachment, request.app.state.store, pid, name)
