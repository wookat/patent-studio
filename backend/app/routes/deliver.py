# -*- coding: utf-8 -*-
"""W4-E E1 递交包（docs/plan/17 §2.3）：
`GET /api/projects/{pid}/deliver` 清单 + `POST /api/projects/{pid}/deliver/bundle` 全部打包
+ `GET /api/projects/{pid}/deliver/bundle.zip` 下载。

清单（GET，viewer）：逐项报告"最近一次产物"的时间与大小，来源全是现有产物目录，不新增存储：
  docx / pdf  → build.latest_artifact_dir(...)/out.docx|out.pdf：最近一次成功产出的构建（失败构建不算），
                url 带该 build_id，下载的就是这份旧产物、不会按当前正文重建
                （时间 = 文件 mtime；从未产出 ⇒ at/size 为 null，url 不带 build_id，GET 现算）
  xml         → .studio/xml/<最新 xid>/cnipa-xml.zip
  tracked     → .studio/tracked/out.docx（routes_tracked 每次导出都写这里）
  figures     → 无落盘产物（figures/export.zip 现算）：at/size 为 null，url 恒可用
  bundle      → .studio/deliver/bundle.zip（POST 产物，单份覆盖）
返回 DeliverManifest；每项 url 是现有下载路由（见 URLS），前端 ExportItem 直接 <a download>。
docx / pdf / tracked / figures 的 url 恒给（GET 现算或触发构建）；xml 无导出、bundle 未打包 ⇒ url 为 null。

全部打包（POST，viewer——只渲染到 .studio，不改源码，与 /build /export/xml 同门槛）：
  body BundleIn{content?, settings?, mode}（与 /build 一致：给 content 则按未保存内容打包，不给则读 content.md）
  顺序：run_build(want_pdf=有 LibreOffice) → run_xml_export → tracked.build_tracked → figures.export_zip →
  zipfile 写 .studio/deliver/bundle.zip：
      申请文件-<title>.docx / 申请文件-<title>.pdf（无 LibreOffice 时跳过）/ CNIPA-XML-<title>.zip /
      申请文件-<title>-修订.docx / 附图-<title>.zip
      + manifest.json（DeliverManifest 快照 + generated_at / mode / pdf_skipped，供事后核对）
  任一步失败 ⇒ 422 error_detail("bundle", "<步骤>：<原因>", detail=<步骤名>)，不写半个 zip（先写 .tmp 再 os.replace）；
  成功 ⇒ 200 DeliverManifest（bundle 项已填 at/size/url）。

递交回写不在此：前端 FilingDialog 直接调 PUT /case（dates.filed / application_no）+ POST /case/status{status:"filed"}。

W5 preflight-backend（docs/plan/21 §2.1 R-CHK-05 / §1.3 A12）：
  DeliverManifest.errors[] = xml_export.validate_request_fields(case.json)
      （schemas.DeliverError，字段级、可定位到案件表单）；
  `GET /deliver/errors`（viewer）单独返回 DeliverErrorsResponse；
  xml 项 note="未经 CPC 客户端验证"（CPC 是 Windows 客户端，真机导入是外部验收项，docs 出现导入记录前不撤）。
"""
import asyncio
import glob
import json
import os
import threading
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.domain import cases, events
from app.domain import figures as fig
from app.domain.build import latest_artifact_dir, run_build
from app.domain.projects import ProjectError
from app.domain.xml_export import run_xml_export, validate_request_fields
from app.errors import error_detail
from app.lo import soffice_available
from app.routes.tracked import author_name
from app.schemas import DeliverError, DeliverErrorsResponse
from patent_studio.kernel import critic, tracked

router = APIRouter(prefix="/api/projects/{pid}/deliver", tags=["deliver"])
UNIT = "E1-deliver-page"

ExportKind = Literal["docx", "pdf", "xml", "tracked", "figures", "bundle"]
KINDS: tuple[str, ...] = ("docx", "pdf", "xml", "tracked", "figures", "bundle")
LABELS: dict[str, str] = {
    "docx": "申请文件 DOCX",
    "pdf": "申请文件 PDF",
    "xml": "CNIPA 五书 XML zip",
    "tracked": "修订版 DOCX",
    "figures": "附图 zip",
    "bundle": "全部打包",
}
# 各项下载地址模板（{pid} 已 URL 编码；xml 用最新 xid）
URLS: dict[str, str] = {
    "docx": "/api/projects/{pid}/export?fmt=docx{docx_build}",
    "pdf": "/api/projects/{pid}/export?fmt=pdf{pdf_build}",
    "xml": "/api/projects/{pid}/xml/{xid}/zip",
    "tracked": "/api/projects/{pid}/export/docx?mode=tracked",
    "figures": "/api/projects/{pid}/figures/export.zip",
    "bundle": "/api/projects/{pid}/deliver/bundle.zip",
}
BUNDLE_NAME = "bundle.zip"
CPC_NOTE = "未经 CPC 客户端验证"
NOTES: dict[str, str] = {"xml": CPC_NOTE}
_lock = threading.Lock()  # 一案同时只打一个包（写 tmp → replace）


class ExportEntry(BaseModel):
    kind: ExportKind
    label: str
    """ISO-8601 UTC；从未生成 ⇒ null"""
    at: str | None = None
    size: int | None = None
    url: str | None = None
    note: str | None = None  # 产物附注（xml：未经 CPC 客户端验证）


class DeliverManifest(BaseModel):
    pid: str
    title: str
    items: list[ExportEntry]
    errors: list[DeliverError] = Field(default_factory=list)


class BundleIn(BaseModel):
    content: str | None = None
    settings: dict | None = None
    mode: Literal["final", "markup"] = "final"


class BundleError(Exception):
    def __init__(self, step: str, message: str):
        super().__init__(f"{step}：{message}")
        self.step = step


def _stat(path: str | None):
    if not path or not os.path.isfile(path):
        return None, None
    st = os.stat(path)
    return datetime.fromtimestamp(st.st_mtime, UTC).isoformat(timespec="seconds"), st.st_size


def _latest_xml_zip(project):
    dirs = sorted(glob.glob(os.path.join(project.studio_dir, "xml", "*")), key=os.path.getmtime)
    for d in reversed(dirs):
        p = os.path.join(d, "cnipa-xml.zip")
        if os.path.isfile(p):
            return os.path.basename(d), p
    return None, None


def _bundle_dir(project):
    return os.path.join(project.studio_dir, "deliver")


def _bundle_path(project):
    return os.path.join(_bundle_dir(project), BUNDLE_NAME)


def build_manifest(store, pid: str) -> DeliverManifest:
    project = store.get(pid)
    docx_dir = latest_artifact_dir(store, pid, "out.docx")
    pdf_dir = latest_artifact_dir(store, pid, "out.pdf")
    xid, xml_zip = _latest_xml_zip(project)
    paths = {
        "docx": os.path.join(docx_dir, "out.docx") if docx_dir else None,
        "pdf": os.path.join(pdf_dir, "out.pdf") if pdf_dir else None,
        "xml": xml_zip,
        "tracked": os.path.join(project.studio_dir, "tracked", "out.docx"),
        "figures": None,
        "bundle": _bundle_path(project),
    }
    qpid = quote(pid)
    fmt = {
        "pid": qpid,
        "xid": quote(xid or ""),
        "docx_build": f"&build_id={os.path.basename(docx_dir)}" if docx_dir else "",
        "pdf_build": f"&build_id={os.path.basename(pdf_dir)}" if pdf_dir else "",
    }
    items = []
    for kind in KINDS:
        at, size = _stat(paths[kind])
        url = URLS[kind].format(**fmt)
        if kind == "xml" and xid is None:
            url = None
        elif kind == "bundle" and at is None:
            url = None
        items.append(ExportEntry(kind=kind, label=LABELS[kind], at=at, size=size, url=url, note=NOTES.get(kind)))
    return DeliverManifest(pid=pid, title=project.title, items=items, errors=request_errors(store, pid))


def request_errors(store, pid: str) -> list[DeliverError]:
    return validate_request_fields(cases.ensure_case(store.get(pid).dir))


def _make_bundle(store, pid: str, body: BundleIn, author: str) -> DeliverManifest:
    project = store.get(pid)
    raw = body.content if body.content is not None else store.read_content(pid)
    title = project.title
    want_pdf = soffice_available()

    out = run_build(store, pid, raw, body.settings, want_pdf=want_pdf, mode=body.mode)
    if out.status != "ok":
        raise BundleError("DOCX", (out.error or {}).get("message") or out.status)
    build_dir = os.path.join(project.studio_dir, "builds", out.build_id)
    docx = os.path.join(build_dir, "out.docx")
    pdf = os.path.join(build_dir, "out.pdf")
    if want_pdf and not os.path.isfile(pdf):
        raise BundleError("PDF", "LibreOffice 未生成 PDF")

    xres = run_xml_export(store, pid, raw, body.settings, mode=body.mode)
    if xres.get("status") != "ok":
        raise BundleError("CNIPA XML", (xres.get("error") or {}).get("message") or xres.get("status", ""))
    xml_zip = os.path.join(project.studio_dir, "xml", xres["xid"], "cnipa-xml.zip")

    # R86：.studio/tracked/ 与 /export/docx?mode=tracked 共享——唯一工件 + replace 原子换上 canonical，
    # zip 直读本次工件，永不被另一写方撕开
    tracked_dir = os.path.join(project.studio_dir, "tracked")
    os.makedirs(tracked_dir, exist_ok=True)
    tag = uuid.uuid4().hex[:8]
    work_md = os.path.join(tracked_dir, f"content-{tag}.md")
    work_docx = os.path.join(tracked_dir, f"out-{tag}.docx")
    try:
        with open(work_md, "w", encoding="utf-8") as f:
            f.write(critic.resolve(raw, "markup"))
        try:
            tracked.build_tracked(store.build_config(project, out=work_docx, content_md=work_md,
                                                     settings=body.settings), author)
        except (AssertionError, ProjectError, ValueError, KeyError) as e:
            raise BundleError("修订版 DOCX", str(e)) from e
        os.replace(work_md, os.path.join(tracked_dir, "content.md"))
        tracked_docx = os.path.join(tracked_dir, "out.docx")
        os.replace(work_docx, tracked_docx)  # zip 读 canonical：替换后总是完整文件
    finally:
        for f in (work_md, work_docx):  # replace 成功后已不存在；失败时清残件
            if os.path.exists(f):
                os.unlink(f)

    figures_zip = fig.export_zip(store, pid)

    bundle_dir = _bundle_dir(project)
    os.makedirs(bundle_dir, exist_ok=True)
    final = _bundle_path(project)
    tmp = final + ".tmp"
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(docx, f"申请文件-{title}.docx")
            if want_pdf:
                z.write(pdf, f"申请文件-{title}.pdf")
            z.write(xml_zip, f"CNIPA-XML-{title}.zip")
            z.write(tracked_docx, f"申请文件-{title}-修订.docx")
            z.writestr(f"附图-{title}.zip", figures_zip)
            snapshot = build_manifest(store, pid).model_dump()
            snapshot.update(generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
                            mode=body.mode, pdf_skipped=not want_pdf)
            z.writestr("manifest.json", json.dumps(snapshot, ensure_ascii=False, indent=2))
        os.replace(tmp, final)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return build_manifest(store, pid)


def _run_bundle(store, pid, body, author):
    with _lock:
        return _make_bundle(store, pid, body, author)


@router.get("")
async def manifest(pid: str, request: Request) -> DeliverManifest:
    return build_manifest(request.app.state.store, pid)


@router.post("/bundle")
async def bundle(pid: str, request: Request, user: CurrentUser, body: BundleIn | None = None) -> DeliverManifest:
    try:
        return await asyncio.to_thread(_run_bundle, request.app.state.store, pid, body or BundleIn(), author_name(user))
    except BundleError as e:
        raise HTTPException(422, error_detail("bundle", str(e), detail=e.step)) from None


@router.get("/bundle.zip")
async def bundle_zip(pid: str, request: Request, user: CurrentUser):
    project = request.app.state.store.get(pid)
    path = _bundle_path(project)
    if not os.path.isfile(path):
        raise HTTPException(404, error_detail("not_found", "尚未生成递交包", detail="bundle"))
    filename = f"递交包-{project.title}.zip"
    events.emit("export.downloaded", pid=pid, actor=events.actor_of(user), data={"fmt": "bundle.zip"})
    return FileResponse(path, media_type="application/zip",
                        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
                                 "Cache-Control": "no-store"})


@router.get("/errors")
async def deliver_errors(pid: str, request: Request) -> DeliverErrorsResponse:
    return DeliverErrorsResponse(errors=request_errors(request.app.state.store, pid))
