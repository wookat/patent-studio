# -*- coding: utf-8 -*-
"""模板预设路由（docs/plan/10 §6）。404/409 由 app.domain.templates 抛 ProjectError，main.py 统一转 JSON。

GET  /api/templates                    → [Template]
POST /api/templates                    → 201 Template（已存在 409；导入 JSON 即提交此接口）
GET  /api/templates/{name}             → Template（即导出 JSON）
PUT  /api/templates/{name}             → Template（新建或覆盖）
DELETE /api/templates/{name}           → 204
POST /api/projects/{pid}/templates/apply {name} → {settings}
"""
import asyncio

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app import auth
from app.domain import templates

router = APIRouter(prefix="/api", tags=["templates"], dependencies=[Depends(auth.require_login)])
# R76-01：模板库是机构级共享资源——写路由不能只有登录闸，viewer 曾能存/删全机构模板。
WRITE = [Depends(auth.require_org_editor)]
UNIT = templates.UNIT


class ApplyIn(BaseModel):
    name: str


@router.get("/templates")
async def list_templates():
    return [t.model_dump() for t in templates.list_templates()]


@router.post("/templates", status_code=201, dependencies=WRITE)
async def create_template(body: templates.TemplateIn):
    return templates.save_template(body, overwrite=False).model_dump()


@router.get("/templates/{name}")
async def get_template(name: str):
    return templates.get_template(name).model_dump()


@router.put("/templates/{name}", dependencies=WRITE)
async def put_template(name: str, body: templates.TemplateIn):
    return templates.save_template(body.model_copy(update={"name": name}), overwrite=True).model_dump()


@router.delete("/templates/{name}", status_code=204, dependencies=WRITE)
async def delete_template(name: str):
    templates.delete_template(name)


@router.post("/projects/{pid}/templates/apply")
async def apply_template(pid: str, body: ApplyIn, request: Request):
    # 批80：apply_template → save_settings（带 FIGURE_KEYS 时含 git commit）——offload
    return {"settings": await asyncio.to_thread(templates.apply_template, request.app.state.store, pid, body.name)}
