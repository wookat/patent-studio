# -*- coding: utf-8 -*-
"""模板预设（docs/plan/10 §6，单元 F3-docx-import-templates）：命名的 settings 预设，
存 PROJECTS_DIR 同级 templates/<name>.json。

文件内容即 Template（也就是导出/导入 JSON 的形状：下载 GET /api/templates/{name} 的响应、
上传时 POST /api/templates 原样提交即可，created_at/updated_at 由服务端重写）；无索引文件。
document_type 预留未来 thesis / conference_paper。
"""

import json
import os
import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app import atomic, config
from app.domain.projects import ProjectError, ProjectStore

UNIT = "F3-docx-import-templates"

DocumentType = Literal["patent_cn_invention"]
NAME_PATTERN = r"^[\w\u4e00-\u9fff-]{1,64}$"
_NAME_RE = re.compile(NAME_PATTERN)


def templates_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(config.PROJECTS_DIR)), "templates")


class TemplateSettings(BaseModel):
    style: dict = {}
    sub_except: list[str] | None = None
    abstract_limit: int | None = None


class TemplateIn(BaseModel):
    name: str = Field(pattern=NAME_PATTERN)
    document_type: DocumentType = "patent_cn_invention"
    description: str = ""
    settings: TemplateSettings = TemplateSettings()


class Template(TemplateIn):
    created_at: str
    updated_at: str


def template_path(name: str) -> str:
    if not _NAME_RE.match(name):
        raise ProjectError("模板名只能包含字母、数字、下划线、连字符或中文（1–64 字）", 400)
    return os.path.join(templates_dir(), f"{name}.json")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _read(path: str) -> Template:
    with open(path, encoding="utf-8") as f:
        return Template.model_validate(json.load(f))


def list_templates() -> list[Template]:
    d = templates_dir()
    if not os.path.isdir(d):
        return []
    out = []
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".json"):
            try:
                out.append(_read(os.path.join(d, fn)))
            except (ValidationError, ValueError, OSError):
                continue  # 手工放入的坏文件不阻断列表
    return out


def get_template(name: str) -> Template:
    """不存在 → ProjectError(404)。"""
    path = template_path(name)
    if not os.path.isfile(path):
        raise ProjectError(f"模板不存在：{name}", 404)
    return _read(path)


def save_template(t: TemplateIn, overwrite: bool) -> Template:
    """overwrite=False 且已存在 → ProjectError(409)。"""
    path = template_path(t.name)
    exists = os.path.isfile(path)
    if exists and not overwrite:
        raise ProjectError(f"模板已存在：{t.name}", 409)
    now = _now()
    created = _read(path).created_at if exists else now
    full = Template(**t.model_dump(), created_at=created, updated_at=now)
    atomic.write_json(path, full.model_dump())
    return full


def delete_template(name: str) -> None:
    path = template_path(name)
    if not os.path.isfile(path):
        raise ProjectError(f"模板不存在：{name}", 404)
    os.remove(path)


def apply_template(store: ProjectStore, pid: str, name: str) -> dict:
    """settings = normalize_settings({**project.settings, **t.settings}) → store.save_settings；返回完整 settings。"""
    t = get_template(name)
    settings = store.load_settings(pid)
    settings["style"] = t.settings.style
    if t.settings.sub_except is not None:
        settings["sub_except"] = t.settings.sub_except
    if t.settings.abstract_limit is not None:
        settings["abstract_limit"] = t.settings.abstract_limit
    return store.save_settings(pid, settings)
