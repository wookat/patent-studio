# -*- coding: utf-8 -*-
"""Word 导入路由（docs/plan/10 §5.3）。

POST /api/projects/import/docx  multipart file[, id, title, apply_styles, style(JSON)] → 201 {project, report}
  style 为用户部分采纳样式建议后的 StyleOverride，优先于 apply_styles。
POST /api/import/docx/styles    multipart file → StyleSuggestion
非 DOCX 输入 → 400 {kind: "import"}；id 非法/重复 → ProjectError（400/409，main.py 统一处理）。
"""
import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from app import auth
from app.domain import cases
from app.domain.importer import import_project, suggest_styles
from app.domain.projects import ATTACHMENT_MAX_BYTES
from app.errors import error_detail
from app.routes import read_bounded
from patent_docx.docx_import import DocxImportError

router = APIRouter(prefix="/api", tags=["import"], dependencies=[Depends(auth.require_login)])


def _bad_docx(e: DocxImportError) -> HTTPException:
    return HTTPException(400, error_detail("import", str(e)))


@router.post("/projects/import/docx", status_code=201)
async def import_docx(request: Request, user: auth.CurrentUser,
                      file: Annotated[UploadFile, File()],
                      id: Annotated[str | None, Form()] = None,
                      title: Annotated[str | None, Form()] = None,
                      apply_styles: Annotated[bool, Form()] = True,
                      style: Annotated[str | None, Form()] = None):
    store = request.app.state.store
    # 导入上限与附件一致（50MB）
    data = await read_bounded(file, "import", ATTACHMENT_MAX_BYTES)
    style_override = None
    if style:
        try:
            style_override = json.loads(style)
        except ValueError:
            raise HTTPException(400, error_detail("import", "style 不是合法 JSON")) from None
        if not isinstance(style_override, dict):
            raise HTTPException(400, error_detail("import", "style 应为对象"))
    try:
        # 批80：docx 解析+建案+落盘（秒级同步活）——offload 防阻塞事件循环
        pid, report = await asyncio.to_thread(import_project, store, data, file.filename or "", id, title,
                                              apply_styles, style_override)
    except DocxImportError as e:
        raise _bad_docx(e) from None
    p = store.get(pid)
    cases.claim_owner(p.dir, str(user.id) if user is not None else None)
    await auth.grant_owner(p.id, user)
    return {"project": {"id": p.id, "title": p.title, "content": store.read_content(pid)},
            "report": report.model_dump()}


@router.post("/import/docx/styles")
async def import_docx_styles(file: Annotated[UploadFile, File()]):
    try:
        return suggest_styles(await read_bounded(file, "import", ATTACHMENT_MAX_BYTES)).model_dump()
    except DocxImportError as e:
        raise _bad_docx(e) from None
