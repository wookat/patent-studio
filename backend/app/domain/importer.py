# -*- coding: utf-8 -*-
"""Word 导入服务（docs/plan/10 §5.3，单元 F3-docx-import-templates）：DOCX 字节 → 新建案卷 + 报告。

流程：pid 缺省取文件名 slug（ProjectStore.ID_RE，冲突加 -2）→ store.create(pid, title) → docx_import.import_docx
写 figs/ 并得到 content.md → store.save_content（进历史）→ 图片宽度与字面下划线标识符写入 settings；
style（用户部分采纳的建议）优先，否则 apply_styles 时合入全部 style 建议。
"""
import gc
import os
import shutil
import time

from app.domain.projects import TEMPLATE_FIG, ProjectStore, id_slug
from patent_studio.kernel import docx_import

UNIT = docx_import.UNIT


def _rmtree_robust(path: str) -> None:
    """Windows 上 .studio/history 的 git object 文件带只读位 + 可能残留句柄：
    chmod 回写 + gc 收句柄重试，否则 rmtree 静默失败留半成品案目录。"""
    def _onexc(fn, p, _exc):
        try:
            os.chmod(p, 0o666)
            fn(p)
        except OSError:
            pass
    for _ in range(3):
        shutil.rmtree(path, ignore_errors=False, onexc=_onexc)
        if not os.path.exists(path):
            return
        gc.collect()
        time.sleep(0.1)
    shutil.rmtree(path, ignore_errors=True)


def import_project(store: ProjectStore, data: bytes, filename: str, pid: str | None, title: str | None,
                   apply_styles: bool, style: dict | None = None) -> tuple[str, docx_import.ImportReport]:
    """返回 (pid, report)；路由再用 store.get(pid) 组装 ProjectDetail。"""
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    pid = pid or store.unique_pid(id_slug(stem, 60, "imported"))
    project = store.create(pid, title or stem)
    figs = os.path.join(project.dir, "figs")
    try:
        md, report = docx_import.import_docx(data, figs)
    except docx_import.DocxImportError:
        _rmtree_robust(project.dir)
        raise
    if report.figures:
        placeholder = os.path.join(figs, TEMPLATE_FIG)
        if os.path.isfile(placeholder):
            os.remove(placeholder)
    guessed = any(i.code == "title.guessed" for i in report.items)
    final_title = title or (stem if guessed else None)
    if final_title:
        md = "# " + final_title.strip() + "\n" + md.split("\n", 1)[1]
    store.save_content(pid, md)
    settings = store.load_settings(pid)
    settings.update(report.figure_settings)
    settings["sub_except"] += [x for x in report.sub_except if x not in settings["sub_except"]]
    if style is not None:
        settings["style"] = style
    elif apply_styles and report.style_suggestion:
        settings["style"] = report.style_suggestion.style
    store.save_settings(pid, settings)
    return pid, report


def suggest_styles(data: bytes) -> docx_import.StyleSuggestion:
    return docx_import.extract_styles(data)
