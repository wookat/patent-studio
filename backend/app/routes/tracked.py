# -*- coding: utf-8 -*-
"""GET /api/projects/{pid}/export/docx?mode=tracked —— Word 真修订导出（docs/plan/10 §4.2）。

读 content.md → critic.resolve(raw, "markup") 保留标记 → build_config → tracked.build_tracked(cfg, author)。
mode 非 tracked 时转到普通 DOCX 下载 /export?fmt=docx。
"""
import asyncio
import os
import uuid
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

from app.auth import CurrentUser
from app.errors import describe_error
from patent_studio.kernel import critic, tracked

router = APIRouter(prefix="/api/projects/{pid}/export", tags=["tracked"])


def author_name(user) -> str:
    if user is None:
        return tracked.DEFAULT_AUTHOR
    return user.display_name or user.email


@router.get("/docx")
async def export_docx(pid: str, request: Request, user: CurrentUser, mode: str = "final"):
    if mode != "tracked":
        return RedirectResponse(f"/api/projects/{quote(pid)}/export?fmt=docx", status_code=307)
    store = request.app.state.store
    project = store.get(pid)
    raw = store.read_content(pid)
    out_dir = os.path.join(project.studio_dir, "tracked")
    os.makedirs(out_dir, exist_ok=True)
    # .studio/tracked/ 是共享单目录——并发导出/递交包同写 out.docx 会撕文件；
    # 先在唯一工件里构建，os.replace 原子换上 canonical（读者永远拿到完整字节）
    tag = uuid.uuid4().hex[:8]
    work_md = os.path.join(out_dir, f"content-{tag}.md")
    work_docx = os.path.join(out_dir, f"out-{tag}.docx")
    try:
        with open(work_md, "w", encoding="utf-8") as f:
            f.write(critic.resolve(raw, "markup"))
        docx = os.path.join(out_dir, "out.docx")
        cfg = store.build_config(project, out=work_docx, content_md=work_md)
        try:
            await asyncio.to_thread(tracked.build_tracked, cfg, author_name(user))
        except AssertionError as e:
            raise HTTPException(422, describe_error(e, raw)) from None
        os.replace(work_md, os.path.join(out_dir, "content.md"))
        os.replace(work_docx, docx)
    finally:
        for f in (work_md, work_docx):
            if os.path.exists(f):
                os.unlink(f)
    filename = f"申请文件-{project.title}-修订.docx"
    return FileResponse(
        docx,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
