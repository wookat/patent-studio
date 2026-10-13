# -*- coding: utf-8 -*-
"""W4-E E3 附件工具（docs/plan/17 §4.2）：list_attachments / read_attachment_text，复用 app.domain.attachments。

- list_attachments(pid) → {items: [...]}：与 GET /api/projects/{pid}/attachments 同形（name / ext / size / mtime /
  kind / url）。viewer+。
- read_attachment_text(pid, name, max_chars=20000) → AttachmentTextOut：
    kind=docx  → patent_docx.docx_import 的段落文本（逐段 \\n 连接；表格逐行、单元格 \\t 连接；不落图、不产 content.md）
    kind=pdf   → `pdftotext -layout` 子进程（poppler-utils，README 已要求安装）；不可用 ⇒ ToolError kind="unsupported"
    kind=text  → 原文（utf-8，错误字节替换）
    kind=image / zip → ToolError kind="unsupported"（图片不做 OCR，zip 不解包）
  超过 max_chars 截断并 truncated=true；chars = 截断前总长。viewer+（读附件与读正文同门槛）。
"""
from __future__ import annotations

import os
import shutil
import subprocess
from typing import Any

from docx.oxml.ns import qn

from app.domain import attachments
from app.mcp import schemas
from app.mcp.tools import _err, open_project_for, run_audited
from patent_docx import docx_import

MAX_CHARS_CAP = 200_000


def _wrap(fn, *args):
    try:
        return fn(*args)
    except attachments.AttachmentsError as e:
        kind = "not_found" if e.status == 404 else "attachments"
        raise _err(kind, str(e), detail=e.detail) from e


def _docx_text(path: str) -> str:
    with open(path, "rb") as f:
        data = f.read()
    try:
        doc = docx_import._open(data)
    except docx_import.DocxImportError as e:
        raise _err("attachments", str(e), detail=os.path.basename(path)) from e
    linear = docx_import._Omml().box
    lines: list[str] = []

    def para_text(p) -> str:
        return docx_import._clean(docx_import._join_pieces(docx_import._read_para(p, linear).pieces))

    for el in docx_import._blocks(doc.element.body):
        if el.tag == qn("w:tbl"):
            for tr in el.findall(qn("w:tr")):
                cells = []
                for tc in tr.findall(qn("w:tc")):
                    cells.append(" ".join(para_text(p) for p in _blocks_paras(tc)))
                lines.append("\t".join(cells))
        else:
            lines.append(para_text(el))
    return "\n".join(ln for ln in lines if ln.strip())


def _blocks_paras(container):
    for blk in docx_import._blocks(container):
        if blk.tag == qn("w:p"):
            yield blk


def _pdf_text(path: str) -> str:
    if shutil.which("pdftotext") is None:
        raise _err("unsupported", "pdftotext 不可用（需安装 poppler-utils）", detail=os.path.basename(path))
    r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise _err("attachments", "pdftotext 失败：" + r.stderr.decode("utf-8", "replace").strip()[:200],
                   detail=os.path.basename(path))
    return r.stdout.decode("utf-8", "replace")


def read_text(store, pid: str, name: str, max_chars: int = 20000) -> schemas.AttachmentTextOut:
    path = _wrap(attachments.attachment_path, store, pid, name)
    name = os.path.basename(path)
    kind = attachments.KIND_OF_EXT[os.path.splitext(name)[1].lower()]
    if kind == "docx":
        text = _docx_text(path)
    elif kind == "pdf":
        text = _pdf_text(path)
    elif kind == "text":
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    else:
        raise _err("unsupported", f"{kind} 附件不支持抽取文本", detail=name)
    limit = max(1, min(max_chars, MAX_CHARS_CAP))
    chars = len(text)
    truncated = chars > limit
    return schemas.AttachmentTextOut(name=name, kind=kind, text=text[:limit] if truncated else text,
                                     chars=chars, truncated=truncated)


def register(server, store):
    @server.tool(name="list_attachments")
    async def list_attachments_tool(pid: str) -> dict[str, Any]:
        """附件列表（同 GET /api/projects/{pid}/attachments）：现有技术 / 交底书 / 客户来件等。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "list_attachments", {},
                                 lambda: _wrap(attachments.list_attachments, store, pid))

    @server.tool(name="read_attachment_text")
    async def read_attachment_text_tool(pid: str, name: str, max_chars: int = 20000) -> schemas.AttachmentTextOut:
        """抽取一个附件的纯文本（docx 段落 / pdf pdftotext / md·txt 原文）；图片与 zip 不支持。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "read_attachment_text", {"name": name, "max_chars": max_chars},
                                 lambda: read_text(store, pid, name, max_chars),
                                 result_of=lambda r: "ok:truncated" if r.truncated else "ok")
