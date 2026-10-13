# -*- coding: utf-8 -*-
"""/api/projects/{pid}/figures*：附图列表 / 上传 / 排序 / 宽度·摘要图 / 删除 / zip（R2，A1 单元）。

契约 docs/plan/05-r2-figures-preflight-design.md §3.1；错误形状 §5。
处理函数通过 request.app.state.store 取 ProjectStore，不反向 import app.main。
"""
import asyncio
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.domain import figures as fig
from app.domain.projects import ATTACHMENT_MAX_BYTES
from app.routes import read_bounded

router = APIRouter(prefix="/api/projects/{pid}", tags=["figures"])
_FILES = File(...)


class OrderIn(BaseModel):
    order: list[str]


class SourceIn(BaseModel):
    source: str


class FigurePatch(BaseModel):
    width: float | None = None
    abstract: bool | None = None
    abstract_width: float | None = None
    marks: dict[str, str] | None = None


def _run(fn, *args):
    try:
        return fn(*args)
    except fig.FiguresError as e:
        raise HTTPException(422, {"kind": "figures", "message": str(e), "line": None, "detail": e.detail})
    except fig.FigureReferencedError as e:
        raise HTTPException(409, {"kind": "figure-referenced", "message": str(e), "line": e.refs[0]["line"],
                                  "detail": "、".join(f"L{r['line']}" for r in e.refs), "refs": e.refs})


@router.get("/figures")
async def list_figures(pid: str, request: Request):
    return fig.list_figures(request.app.state.store, pid)


@router.post("/figures")
async def upload_figures(pid: str, request: Request, files: list[UploadFile] = _FILES):
    # 上传上限与附件一致（50MB）
    payload = [(f.filename, await read_bounded(f, "figures", ATTACHMENT_MAX_BYTES)) for f in files]
    # 批80：上传+save_figures 内含 git commit——offload 防阻塞事件循环
    return await asyncio.to_thread(_run, fig.upload_figures, request.app.state.store, pid, payload)


@router.put("/figures/order")
async def reorder_figures(pid: str, body: OrderIn, request: Request):
    return await asyncio.to_thread(_run, fig.reorder_figures, request.app.state.store, pid, body.order)


@router.get("/figures/export.zip")
async def export_figures_zip(pid: str, request: Request):
    # 批80：读图+zip 构建是重量级 fs 活——offload
    data = await asyncio.to_thread(fig.export_zip, request.app.state.store, pid)
    filename = f"{pid}-figures.zip"
    ascii_name = filename if filename.isascii() else "figures.zip"
    disposition = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": disposition, "Cache-Control": "no-store"})


@router.put("/figures/{name}")
async def update_figure(pid: str, name: str, body: FigurePatch, request: Request):
    return await asyncio.to_thread(_run, fig.update_figure, request.app.state.store, pid, name,
                                   body.width, body.abstract, body.abstract_width, body.marks)


@router.put("/figures/{name}/image")
async def replace_figure_image(pid: str, name: str, request: Request, files: list[UploadFile] = _FILES):
    """整组替换图片文件（被引用也可换）：上传文件 stem 须与 {name} 同组；spec/abstract.file 随主文件名变化。"""
    payload = [(f.filename, await read_bounded(f, "figures", ATTACHMENT_MAX_BYTES)) for f in files]
    return await asyncio.to_thread(_run, fig.replace_figure_image, request.app.state.store, pid, name, payload)


@router.delete("/figures/{name}")
async def delete_figure(pid: str, name: str, request: Request):
    return await asyncio.to_thread(_run, fig.delete_figure, request.app.state.store, pid, name)


# ---------------- 绘制图源 figs-src/*.mmd（W16） ----------------

@router.get("/figures-src")
async def list_figure_sources(pid: str, request: Request):
    return fig.list_figure_sources(request.app.state.store, pid)


@router.get("/figures-src/{name}")
async def get_figure_source(pid: str, name: str, request: Request):
    return fig.get_figure_source(request.app.state.store, pid, name)


@router.put("/figures-src/{name}")
async def put_figure_source(pid: str, name: str, body: SourceIn, request: Request):
    return await asyncio.to_thread(fig.put_figure_source, request.app.state.store, pid, name, body.source)


@router.post("/figures-src/{name}/upload")
async def upload_figure_image_source(pid: str, name: str, request: Request,
                                     files: list[UploadFile] = _FILES):
    """图片图源上传（往复轮104）——论文抽出的数据图/结果照片可作图号占位图源。"""
    data = await read_bounded(files[0], "figures-src", ATTACHMENT_MAX_BYTES)
    return await asyncio.to_thread(fig.save_figure_image_source,
                                   request.app.state.store, pid, name, data)


@router.post("/figures-preview")
async def preview_figure_source(pid: str, body: SourceIn, request: Request):
    """图源文本 → 渲染 PNG 预览（不落盘）——画板 .spec/.mmd 实时预览。"""
    data = await asyncio.to_thread(fig.preview_figure_source, request.app.state.store, pid, body.source)
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/figures-mmd-to-spec")
async def convert_mmd_to_spec(pid: str, body: SourceIn, request: Request):
    """mmd 图源文本 → figspec JSON——画板「转 .spec 画布」后上交互编辑器。"""
    spec = await asyncio.to_thread(fig.mmd_to_spec_source, request.app.state.store, pid, body.source)
    return {"spec": spec}


@router.delete("/figures-src/{name}")
async def delete_figure_source(pid: str, name: str, request: Request):
    return await asyncio.to_thread(fig.delete_figure_source, request.app.state.store, pid, name)
