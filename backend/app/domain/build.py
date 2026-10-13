# -*- coding: utf-8 -*-
"""构建服务：content.md（草稿）+ settings → DOCX（patent_docx）→ PDF（LibreOffice）。

latest-wins：每个案子维护递增 seq；请求进入即分配 seq；拿到全局构建锁后若已被更新的请求
超越，直接返回 superseded，不再浪费 soffice 时间。
"""
import glob
import logging
import os
import shutil
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field

from pypdf import PdfReader

from app import config
from app.domain.lint import lint
from app.domain.projects import ProjectError, ProjectStore, normalize_settings
from app.errors import describe_error
from app.lo import docx_to_pdf, last_backend, last_tagged, soffice_available  # noqa: F401 - re-export
from patent_docx import critic, tracked
from patent_docx.builder import build_patent_ex

log = logging.getLogger("patent_studio.build")

_build_lock = threading.Lock()
_seq_lock = threading.Lock()
_seq: dict[str, int] = {}


@dataclass
class BuildOutcome:
    status: str  # ok | error | superseded
    build_id: str | None = None
    seq: int = 0
    timings: dict = field(default_factory=dict)
    summary: dict | None = None
    error: dict | None = None
    pdf_url: str | None = None
    docx_url: str | None = None
    diagnostics: list[dict] = field(default_factory=list)
    # 21 §5.2：预览构建经 unoserver 产出 tagged PDF ⇒ True（前端走 struct 配对）；CLI 回退 / 未要 PDF ⇒ False
    pdf_tagged: bool = False

    def to_dict(self):
        return asdict(self)


# 构建错误 kind → 同一问题的 lint id（镜像时去重）
_KIND_TO_LINT = {"abstract_limit": "abstract.limit", "content": "spec.unknown_section"}


def safe_lint(store: ProjectStore, project, content: str, settings: dict | None) -> list[dict]:
    """lint 从不让构建失败：内部异常（含非法 settings）只记日志并返回空列表。"""
    try:
        s = normalize_settings(settings if settings is not None else project.settings, store.list_figs(project.dir))
        figures = None if settings is not None and "spec_figures" in settings else store.load_figures(project.dir)
        return list(lint(content, s, project.figs_dir, with_preflight=True, figures=figures)["diagnostics"])
    except Exception:  # noqa: BLE001
        log.exception("lint failed")
        return []


def with_build_error(diagnostics: list[dict], error: dict) -> list[dict]:
    """把构建错误镜像为一条 source=build 的 diagnostic，放在最前；同一问题的 lint 项同行时去重。"""
    twin = _KIND_TO_LINT.get(error.get("kind", ""))
    rest = [d for d in diagnostics
            if not (twin and d["id"].split("#")[0] == twin and d.get("line") == error.get("line"))]
    mirror = {"id": f"build.{error.get('kind', 'build')}", "severity": "error", "source": "build",
              "message": error.get("message", "构建失败"), "line": error.get("line")}
    if error.get("detail"):
        mirror["detail"] = error["detail"]
    return [mirror, *rest]


def next_seq(pid):
    with _seq_lock:
        _seq[pid] = _seq.get(pid, 0) + 1
        return _seq[pid]


def latest_seq(pid):
    with _seq_lock:
        return _seq.get(pid, 0)


def pdf_pages(path):
    try:
        return len(PdfReader(path).pages)
    except Exception:  # noqa: BLE001
        return None


PRUNE_MIN_AGE_S = 300


def _prune_builds(builds_dir, keep):
    """只留最近 keep 份；最近一份带 out.pdf 的成功构建另行保留：
    连续失败时前端 lastOk 仍指向它，PDF 卡片重挂需能重取。"""
    dirs = sorted(glob.glob(os.path.join(builds_dir, "*")), key=os.path.getmtime)
    last_ok = next((d for d in reversed(dirs) if os.path.isfile(os.path.join(d, "out.pdf"))), None)
    # R88：进行时目录 mtime 新鲜但可能挤不进 keep 窗口（并发构建超过 keep 份时）——跳过年轻的，
    # 否则跨进程 rmtree 会让在跑的构建写盘失败
    for d in dirs[:-keep] if keep > 0 else dirs:
        if d != last_ok and os.path.getmtime(d) < time.time() - PRUNE_MIN_AGE_S:
            shutil.rmtree(d, ignore_errors=True)


def run_build(store: ProjectStore, pid: str, content: str | None, settings: dict | None,
              want_pdf: bool = True, mode: str = "final", *, tagged: bool = False,
              author: str = tracked.DEFAULT_AUTHOR) -> BuildOutcome:
    """mode（07 §6.3）：final/original 按接受/拒绝后的文本排版；markup 走 Word 原生修订（w:ins/w:del，
    LibreOffice 以作者色下划线 / 删除线 + 页边改动竖线渲染，与 Word「所有标记」一致）；lint 恒按 final 文本检查。

    tagged（21 §1.4 B2）：只有预览构建（POST /build）传 True；导出 / 递交包 / MCP 保持默认 False。
    """
    mine = next_seq(pid)
    t0 = time.perf_counter()
    with _build_lock:
        if mine < latest_seq(pid):
            return BuildOutcome(status="superseded", seq=mine,
                                timings={"queue_ms": round((time.perf_counter() - t0) * 1000)})
        t_lock = time.perf_counter()
        project = store.get(pid)
        if content is None:
            content = store.read_content(pid)
        raw = content
        content = critic.resolve(raw, mode)
        builds_dir = os.path.join(project.studio_dir, "builds")
        build_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        out_dir = os.path.join(builds_dir, build_id)
        os.makedirs(out_dir, exist_ok=True)
        content_md = os.path.join(out_dir, "content.md")
        with open(content_md, "w", encoding="utf-8") as f:
            f.write(content)
        docx = os.path.join(out_dir, "out.docx")
        timings = {"queue_ms": round((t_lock - t0) * 1000)}
        diagnostics = safe_lint(store, project, critic.accept(raw), settings)
        try:
            # figs-src/*.mmd 自动晋级：缺图只构建出占位图是成品观感硬伤（vit-11 实案）——
            # 构建前把新/更新过的图源渲成 figs/<stem>.png 并收进 figures.md
            try:
                from app.domain import figures as figures_mod
                figures_mod.promote_figure_sources(store, pid)
                # 晋级改写了 figures.md——project.settings 是 store.get 时按旧清单
                # 物化的派生视图，不刷新则本次构建仍嵌晋级前的占位图（bert-12 实案：
                # 五张真图渲染落盘、figures.md 已收录，out.pdf 却还是占位 S1→S2→S3）。
                if settings is None:
                    project.settings = store.load_settings(pid)
            except Exception:  # noqa: BLE001 - 晋级失败不挡构建（图源语法坏等）
                log.warning("promote figure sources failed for %s", pid, exc_info=True)
            cfg = store.build_config(project, out=docx, content_md=content_md, settings=settings)
            t1 = time.perf_counter()
            res = tracked.build_tracked(cfg, author) if mode == "markup" else build_patent_ex(cfg)
            timings["docx_ms"] = round((time.perf_counter() - t1) * 1000)
            pages = None
            pdf_tagged = False
            if want_pdf:
                t2 = time.perf_counter()
                docx_to_pdf(docx, out_dir, tagged=tagged)
                timings["pdf_ms"] = round((time.perf_counter() - t2) * 1000)
                timings["pdf_backend"] = last_backend()
                pdf_tagged = last_tagged()
                pages = pdf_pages(os.path.join(out_dir, "out.pdf"))
        except ProjectError as e:
            timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
            error = {"kind": "settings", "message": str(e), "line": None, "detail": str(e)}
            return BuildOutcome(status="error", build_id=build_id, seq=mine, timings=timings, error=error,
                                diagnostics=with_build_error(diagnostics, error))
        except Exception as e:  # noqa: BLE001 - 所有内核/转换错误都要转成可读结果
            timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
            error = describe_error(e, content)
            return BuildOutcome(status="error", build_id=build_id, seq=mine, timings=timings, error=error,
                                diagnostics=with_build_error(diagnostics, error))
        finally:
            _prune_builds(builds_dir, config.KEEP_BUILDS)
        timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
        log.info("build %s/%s %s", pid, build_id, " ".join(f"{k}={v}" for k, v in timings.items()))
        base = f"/api/projects/{pid}/builds/{build_id}"
        return BuildOutcome(
            status="ok", build_id=build_id, seq=mine, timings=timings,
            summary={"title": res.title, "abstract_chars": res.abstract_chars, "claims": res.claims,
                     "paragraphs": res.paragraphs, "pages": pages},
            pdf_url=f"{base}/out.pdf" if want_pdf else None,
            docx_url=f"{base}/out.docx",
            diagnostics=diagnostics,
            pdf_tagged=pdf_tagged,
        )


def artifact_path(store: ProjectStore, pid: str, build_id: str, name: str):
    project = store.get(pid)
    if name not in ("out.pdf", "out.docx", "content.md") or not build_id.replace("-", "").isalnum():
        raise ProjectError("非法产物名", 400)
    p = os.path.join(project.studio_dir, "builds", build_id, name)
    if not os.path.isfile(p):
        raise ProjectError("产物不存在（可能已被更新的构建清理）", 404)
    return p


def latest_artifact_dir(store: ProjectStore, pid: str, name: str):
    """最近一次真正产出了 `name` 的构建目录（失败的构建只留下 content.md，跳过）；没有 ⇒ None。"""
    project = store.get(pid)
    dirs = sorted(glob.glob(os.path.join(project.studio_dir, "builds", "*")), key=os.path.getmtime)
    for d in reversed(dirs):
        if os.path.isfile(os.path.join(d, name)):
            return d
    return None
