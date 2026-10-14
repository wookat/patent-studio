# -*- coding: utf-8 -*-
"""CNIPA XML 导出服务：content.md（草稿）+ settings → 五书 XML + JPG → zip，附官方 DTD 校验报告。

产物落在 <案子>/.studio/xml/<xid>/{100001..100005}/ 与 cnipa-xml.zip；只保留最近 KEEP_BUILDS 份。
预览用官方 showxml.xsl 现场 XSLT 成 HTML（与国知局业务办理系统的展示样式同源）。
"""

import glob
import os
import re
import shutil
import threading
import time
import uuid

from lxml import etree

from app import config
from app.domain import build
from app.domain.cases import Case
from app.domain.projects import ProjectError, ProjectStore
from app.errors import describe_error
from app.lo import docx_to_pdf
from app.schemas import DeliverError
from patent_studio.kernel import critic
from patent_studio.kernel.cnipa_xml import BOOKS, XSL_PATH, export_cnipa_xml

_lock = threading.Lock()
_xslt = None

# CNIPA 申请号：4 位年 + 1 位类别 + 7 位流水 + "." + 校验位（数字或 X），允许空格分隔（2026 1 0123456.7）
_APPLICATION_NO_RE = re.compile(r"^\d{4}\s?[1-9]\s?\d{7}\.[0-9X]$")


def validate_request_fields(case: Case) -> list[DeliverError]:
    """W5 R-CHK-05：递交请求书字段级结构校验（案卷 case.json）；只查、不生成，顺序即前端错误表顺序。
    field 是案件表单字段路径（applicants / inventors / dates.application_no）。"""
    errors: list[DeliverError] = []
    applicants = [a for a in case.applicants if a.strip()]
    if not applicants:
        errors.append(
            DeliverError(
                field="applicants", code="request.applicants_missing", message="请填写至少一个申请人（请求书必填）"
            )
        )
    inventors = [i for i in case.inventors if i.strip()]
    if not inventors:
        errors.append(
            DeliverError(
                field="inventors",
                code="request.inventors_missing",
                message="请填写至少一位发明人（发明专利请求书必填）",
            )
        )
    no = (case.dates.application_no or "").strip()
    if no and not _APPLICATION_NO_RE.match(no):
        errors.append(
            DeliverError(
                field="dates.application_no",
                code="request.application_no_format",
                message="申请号格式应为 4 位年份 + 类别 + 7 位流水 + 校验位，例如 2026 1 0123456.7",
            )
        )
    return errors


def _xsl():
    global _xslt
    if _xslt is None:
        _xslt = etree.XSLT(etree.parse(XSL_PATH))
    return _xslt


def _prune(xml_root, keep):
    dirs = sorted(glob.glob(os.path.join(xml_root, "*")), key=os.path.getmtime)
    for d in dirs[:-keep] if keep > 0 else dirs:  # R88：同上，跳过进行时（mtime 新鲜）的目录
        if os.path.getmtime(d) < time.time() - build.PRUNE_MIN_AGE_S:
            shutil.rmtree(d, ignore_errors=True)


def run_xml_export(store: ProjectStore, pid: str, content: str | None, settings: dict | None, mode: str = "final"):
    t0 = time.perf_counter()
    with _lock:
        project = store.get(pid)
        if content is None:
            content = store.read_content(pid)
        content = critic.resolve(content, mode)
        xml_root = os.path.join(project.studio_dir, "xml")
        xid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        out_dir = os.path.join(xml_root, xid)
        os.makedirs(out_dir, exist_ok=True)
        content_md = os.path.join(out_dir, "content.md")
        with open(content_md, "w", encoding="utf-8") as f:
            f.write(content)
        ok = False
        try:
            cfg = store.build_config(
                project, out=os.path.join(out_dir, "unused.docx"), content_md=content_md, settings=settings
            )
            res = export_cnipa_xml(cfg, out_dir, docx_to_pdf)
            ok = True
        except ProjectError as e:
            return {
                "status": "error",
                "xid": xid,
                "error": {"kind": "settings", "message": str(e), "line": None, "detail": str(e)},
            }
        except Exception as e:  # noqa: BLE001 - 内核/渲染错误统一转成可读结果
            return {"status": "error", "xid": xid, "error": describe_error(e, content)}
        finally:
            if not ok:
                # 失败目录只有 content.md 残件：删掉再 prune，否则它挤占 KEEP_BUILDS 名额顶掉上一份成功导出
                shutil.rmtree(out_dir, ignore_errors=True)
            _prune(xml_root, config.KEEP_BUILDS)
        base = f"/api/projects/{pid}/xml/{xid}"
        d = res.to_dict()
        for b in d["books"]:
            b["xml_url"] = f"{base}/{b['code']}/{b['code']}.xml"
            b["preview_url"] = f"{base}/{b['code']}/{b['code']}.html"
        d.update(status="ok", xid=xid, zip_url=f"{base}/zip", ms=round((time.perf_counter() - t0) * 1000))
        return d


def _xml_dir(store: ProjectStore, pid: str, xid: str):
    project = store.get(pid)
    if not xid.replace("-", "").isalnum():
        raise ProjectError("非法导出 id", 400)
    d = os.path.join(project.studio_dir, "xml", xid)
    if not os.path.isdir(d):
        raise ProjectError("导出不存在（可能已被更新的导出清理）", 404)
    return d


def xml_zip_path(store: ProjectStore, pid: str, xid: str):
    p = os.path.join(_xml_dir(store, pid, xid), "cnipa-xml.zip")
    if not os.path.isfile(p):
        raise ProjectError("zip 不存在", 404)
    return p


def xml_file(store: ProjectStore, pid: str, xid: str, code: str, name: str):
    """返回 (path, media_type, html_bytes|None)：*.html 用官方 XSL 现场渲染，其余直接给文件。"""
    if code not in dict(BOOKS) or "/" in name or "\\" in name or name.startswith("."):
        raise ProjectError("非法产物名", 400)
    d = os.path.join(_xml_dir(store, pid, xid), code)
    if name == f"{code}.html":
        xml_path = os.path.join(d, f"{code}.xml")
        if not os.path.isfile(xml_path):
            raise ProjectError("XML 不存在", 404)
        parser = etree.XMLParser(load_dtd=False, resolve_entities=False, no_network=True)
        html = _xsl()(etree.parse(xml_path, parser))
        return xml_path, "text/html; charset=utf-8", str(html).encode("utf-8")
    p = os.path.join(d, name)
    if not os.path.isfile(p):
        raise ProjectError("产物不存在", 404)
    media = {".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg"}.get(
        os.path.splitext(name)[1].lower(), "application/octet-stream"
    )
    return p, media, None
