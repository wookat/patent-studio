# -*- coding: utf-8 -*-
"""routes 包共享小件。"""

from fastapi import HTTPException, Request, UploadFile

from app.domain.projects import ProjectError
from app.errors import error_detail


def project_or_404(request: Request, pid: str):
    """store.get(pid)；不存在 ⇒ HTTPException(e.status, kind="project")——此前三个路由各自内联。"""
    try:
        return request.app.state.store.get(pid)
    except ProjectError as e:
        raise HTTPException(e.status, error_detail("project", str(e)))


async def read_bounded(file: UploadFile, kind: str, max_bytes: int) -> bytes:
    """multipart 上传限流读：read(max+1) 早截断 → 413（detail=文件名，批量上传能定位是哪个）。
    UploadFile 已读部分时 read() 只回余量——先读再判。"""
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        name = file.filename or ""
        raise HTTPException(
            413, error_detail(kind, f"文件过大：{name}（上限 {max_bytes // 1024 // 1024} MB）", detail=name or None)
        )
    return data
