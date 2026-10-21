# -*- coding: utf-8 -*-
"""构建服务：content.md（草稿）+ settings → DOCX（patent_studio.kernel）→ PDF（LibreOffice）。

latest-wins：每个案子维护递增 seq；请求进入即分配 seq；拿到全局构建锁后若已被更新的请求
超越，直接返回 superseded，不再浪费 soffice 时间。
"""

import glob
import logging
import os
import shutil
import sys
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
from patent_studio.kernel import critic, tracked
from patent_studio.kernel.builder import build_patent_ex

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
    # C0/P02：本次构建的完整输入指纹（与 manifest.input 一致）——前端据此标注预览对应版本
    input: dict | None = None

    def to_dict(self):
        return asdict(self)


# 构建错误 kind → 同一问题的 lint id（镜像时去重）
_KIND_TO_LINT = {"abstract_limit": "abstract.limit", "content": "spec.unknown_section"}


def safe_lint(store: ProjectStore, project, content: str, settings: dict | None) -> list[dict]:
    """检查异常不阻止预览排版，但必须保留一个不可当作通过的错误诊断。"""
    try:
        s = normalize_settings(settings if settings is not None else project.settings, store.list_figs(project.dir))
        figures = None if settings is not None and "spec_figures" in settings else store.load_figures(project.dir)
        return list(lint(content, s, project.figs_dir, with_preflight=True, figures=figures)["diagnostics"])
    except Exception:  # noqa: BLE001
        log.exception("lint failed")
        return [
            {
                "id": "checks.unavailable",
                "severity": "error",
                "source": "build",
                "message": "检查未完成，不能判定为无问题。请重试检查后再定稿或交付。",
                "line": None,
            }
        ]


def with_build_error(diagnostics: list[dict], error: dict) -> list[dict]:
    """把构建错误镜像为一条 source=build 的 diagnostic，放在最前；同一问题的 lint 项同行时去重。"""
    twin = _KIND_TO_LINT.get(error.get("kind", ""))
    rest = [
        d for d in diagnostics if not (twin and d["id"].split("#")[0] == twin and d.get("line") == error.get("line"))
    ]
    mirror = {
        "id": f"build.{error.get('kind', 'build')}",
        "severity": "error",
        "source": "build",
        "message": error.get("message", "构建失败"),
        "line": error.get("line"),
    }
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


def run_build(
    store: ProjectStore,
    pid: str,
    content: str | None,
    settings: dict | None,
    want_pdf: bool = True,
    mode: str = "final",
    *,
    tagged: bool = False,
    preview: bool = False,
    author: str = tracked.DEFAULT_AUTHOR,
) -> BuildOutcome:
    """mode（07 §6.3）：final/original 按接受/拒绝后的文本排版；markup 走 Word 原生修订（w:ins/w:del，
    LibreOffice 以作者色下划线 / 删除线 + 页边改动竖线渲染，与 Word「所有标记」一致）；lint 恒按 final 文本检查。

    tagged（21 §1.4 B2）：只有预览构建（POST /build）传 True；导出 / 递交包 / MCP 保持默认 False。
    """
    mine = next_seq(pid)
    t0 = time.perf_counter()
    with _build_lock:
        if mine < latest_seq(pid):
            return BuildOutcome(
                status="superseded", seq=mine, timings={"queue_ms": round((time.perf_counter() - t0) * 1000)}
            )
        t_lock = time.perf_counter()
        project = store.get(pid)
        if content is None:
            content = store.read_content(pid)
        raw = content
        content = critic.resolve(raw, mode)
        # C0/P02 空正文门禁：非空预期的案卷不应构建出空产物（导出空 DOCX/PDF 是静默错误）
        if not critic.accept(raw).strip():
            return BuildOutcome(
                status="error",
                seq=mine,
                timings={"queue_ms": round((time.perf_counter() - t0) * 1000)},
                error={
                    "kind": "content",
                    "message": "文档为空：请以「# 标题」开始，并包含 ## 摘要 / ## 权利要求书 / ## 说明书 章节",
                    "line": None,
                    "detail": None,
                },
            )
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
        if not preview and any(d["id"] == "checks.unavailable" for d in diagnostics):
            return BuildOutcome(
                status="error",
                build_id=build_id,
                seq=mine,
                diagnostics=diagnostics,
                error={"kind": "validation", "message": "检查未完成，已阻止正式构建。请重试检查。"},
            )
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
            return BuildOutcome(
                status="error",
                build_id=build_id,
                seq=mine,
                timings=timings,
                error=error,
                diagnostics=with_build_error(diagnostics, error),
            )
        except Exception as e:  # noqa: BLE001 - 所有内核/转换错误都要转成可读结果
            timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
            error = describe_error(e, content)
            return BuildOutcome(
                status="error",
                build_id=build_id,
                seq=mine,
                timings=timings,
                error=error,
                diagnostics=with_build_error(diagnostics, error),
            )
        finally:
            _prune_builds(builds_dir, config.KEEP_BUILDS)
        timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
        log.info("build %s/%s %s", pid, build_id, " ".join(f"{k}={v}" for k, v in timings.items()))
        eff_settings = settings if settings is not None else project.settings
        fp = input_fingerprint(raw, content, eff_settings, project, mode)
        pdf_meta = False
        if want_pdf and os.path.isfile(os.path.join(out_dir, "out.pdf")):
            pdf_meta = _embed_pdf_meta(os.path.join(out_dir, "out.pdf"), build_id, fp)
        merr = _write_manifest(out_dir, pid, build_id, fp, content, timings, want_pdf, {"pdf_meta": pdf_meta})
        if merr is not None:
            # fail-closed：清单不可信的构建不当成功返回（陈旧产物校验无从谈起）
            return BuildOutcome(
                status="error",
                build_id=build_id,
                seq=mine,
                timings=timings,
                error=merr,
                diagnostics=with_build_error(diagnostics, merr),
            )
        base = f"/api/projects/{pid}/builds/{build_id}"
        return BuildOutcome(
            status="ok",
            build_id=build_id,
            seq=mine,
            timings=timings,
            input=fp,
            summary={
                "title": res.title,
                "abstract_chars": res.abstract_chars,
                "claims": res.claims,
                "paragraphs": res.paragraphs,
                "pages": pages,
            },
            pdf_url=f"{base}/out.pdf" if want_pdf else None,
            docx_url=f"{base}/out.docx",
            diagnostics=diagnostics,
            pdf_tagged=pdf_tagged,
        )


def _sha256(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _file_sha(path: str) -> str | None:
    import hashlib

    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def _lib_ver(name: str) -> str | None:
    """可检测的库版本（renderer 指纹）；不可得 ⇒ None，如实记未知不冒充。"""
    try:
        import importlib.metadata

        return importlib.metadata.version(name)
    except Exception:
        return None


def _figs_sha(project) -> str | None:
    """图资源输入指纹：figs/ 已渲染产物 + figs-src/ 图源（文件名+内容逐文件）。
    目录不存在（无图案）⇒ 空表 hash；任一文件读失败 ⇒ None——宁可使指纹不可用也不漏判。"""
    import hashlib

    h = hashlib.sha256()
    for d in (project.figs_dir, project.figsrc_dir):
        if not os.path.isdir(d):
            continue
        try:
            names = sorted(os.listdir(d))
        except OSError:
            return None
        for n in names:
            fp = os.path.join(d, n)
            if not os.path.isfile(fp):
                continue
            s = _file_sha(fp)
            if s is None:
                return None
            h.update(n.encode())
            h.update(s.encode())
    return h.hexdigest()


def input_fingerprint(raw: str, content: str, settings, project, mode: str) -> dict:
    """C0/P02 完整输入指纹：正文 raw/resolved + settings + mode + 图资源内容 + 可检测
    renderer 库版本。settings 用构建实际生效值（传入或 project.settings），保证导出侧
    同式复算。figs_sha 为 None（图读取失败）的指纹在 matching_artifact_dir 被判不可信。"""
    import json

    return {
        "raw_sha": _sha256(raw),
        "content_sha": _sha256(content),
        "settings_sha": _sha256(json.dumps(settings or {}, ensure_ascii=False, sort_keys=True)),
        "figs_sha": _figs_sha(project),
        "mode": mode,
        # R5/复核3：renderer 版本参与匹配——库升级不复用旧产物；检测不到 ⇒ None（判不可信复用）
        "renderer": {
            "python-docx": _lib_ver("python-docx"),
            "matplotlib": _lib_ver("matplotlib"),
            "pypdf": _lib_ver("pypdf"),
            "fonttools": _lib_ver("fonttools"),
        },
    }


def _embed_pdf_meta(pdf_path: str, build_id: str, fp: dict) -> bool:
    """产物内嵌版本信息（pypdf）：build_id + 输入指纹前缀写进文档元数据。
    clone_from 克隆整文档（含 /Root 的 StructTreeRoot/MarkInfo/Outlines）——逐页 add_page
    重建会丢 tagged/书签结构，损坏既有可访问预览。失败不挡构建——manifest/文件名仍是
    权威版本标注；返回是否写入。"""
    try:
        from pypdf import PdfWriter

        writer = PdfWriter(clone_from=pdf_path)
        writer.add_metadata(
            {
                "/Title": f"知撰构建 {build_id}",
                "/Keywords": (
                    f"build_id={build_id}; input={fp.get('raw_sha', '')[:12]}/{fp.get('settings_sha', '')[:12]}"
                ),
            }
        )
        tmp = pdf_path + ".meta.tmp"
        with open(tmp, "wb") as f:
            writer.write(f)
        os.replace(tmp, pdf_path)
        return True
    except Exception:
        log.warning("embed pdf metadata failed for %s", pdf_path, exc_info=True)
        return False


def _write_manifest(out_dir, pid, build_id, fp, content, timings, want_pdf, renderer_extra=None) -> dict | None:
    """C0/P02 构建清单：完整输入指纹 + 输出 hash + renderer。产物 hash 读不出 ⇒ 返回错误
    （None 放行会让陈旧产物不可校验——fail-closed 不当成功）。"""
    import json

    docx_sha = _file_sha(os.path.join(out_dir, "out.docx"))
    pdf_sha = _file_sha(os.path.join(out_dir, "out.pdf")) if want_pdf else None
    if docx_sha is None or (want_pdf and pdf_sha is None):
        return {"kind": "internal", "message": "构建产物 hash 校验失败——产物未标记为可信", "detail": "output_hash"}
    manifest = {
        "build_id": build_id,
        "pid": pid,
        "created_at": time.time(),
        "input": fp,
        "output": {"docx_sha": docx_sha, "pdf_sha": pdf_sha},
        "renderer": {
            "pdf_backend": timings.get("pdf_backend"),
            "python": sys.version.split()[0],
            "python-docx": _lib_ver("python-docx"),
            "matplotlib": _lib_ver("matplotlib"),
            "pypdf": _lib_ver("pypdf"),
            **(renderer_extra or {}),
        },
        "timings": timings,
    }
    try:
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
    except OSError:
        log.warning("manifest write failed for %s/%s", pid, build_id, exc_info=True)
        return {"kind": "internal", "message": "构建清单写入失败——产物未标记为可信", "detail": "manifest"}
    return None


def matching_artifact_dir(store, project, fmt: str, fp: dict) -> str | None:
    """复用最近一次构建目录：manifest 存在 + 输入指纹全等 + 产物 hash 与盘文一致。
    无 manifest / 指纹不符 / hash 不符 ⇒ None（不信任，交给重建）。"""
    dirs = sorted(glob.glob(os.path.join(project.studio_dir, "builds", "*")), key=os.path.getmtime, reverse=True)
    key = "pdf_sha" if fmt == "pdf" else "docx_sha"
    for d in dirs:
        if not os.path.isfile(os.path.join(d, f"out.{fmt}")):
            continue
        m = build_manifest(d)
        if m is None:
            continue  # 无清单 ⇒ 不可信——不沿用旧兼容
        inp = m.get("input") or {}
        # R5/复核3：指纹含 None（图读取失败/版本检测不到）⇒ 视为不可信，不复用——
        # None==None 的假匹配会让坏环境下的陈旧产物被当成同输入命中
        if any(v is None for v in fp.values()) or any(v is None for v in (fp.get("renderer") or {}).values()):
            continue
        if any(inp.get(k) != v for k, v in fp.items()):
            continue
        want = (m.get("output") or {}).get(key)
        if not want or _file_sha(os.path.join(d, f"out.{fmt}")) != want:
            continue
        return d
    return None


def build_manifest(build_dir: str) -> dict | None:
    """构建目录的 manifest.json（缺 ⇒ None——旧构建没有清单）。"""
    import json

    try:
        with open(os.path.join(build_dir, "manifest.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


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
