# -*- coding: utf-8 -*-
"""Z21 图源一致性回归：figures.md ↔ figs-src ↔ 导出 zip 三处口径。

覆盖两处真实失配场景：
- 重排图号（/figures/order）：正文「图N」引用不动、figures.md 行序即图号、导出 zip 跟随节序；
  alt 随文件走 ⇒ 题注错位由 figures.alt_mismatch 明确诊断（不是静默漂移）。
- 重命名图源（figs-src/<stem>.mmd → 新 stem）：派生 PNG 的声明位超出实际行数时
  alt 按真实落位写（修复前会把「图9」标签贴到第 3 行）；失去图源的收录派生图由
  figures.source_orphan 诊断。
"""

import io
import os
import sys
import zipfile

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from app.domain import figures as fmod
from app.domain import lint as lintmod
from app.domain import projects

CONTENT = """# 演示发明

## 摘要

一种演示方法的摘要。

## 权利要求书

1. 一种演示方法，其特征在于，包括步骤A。

## 说明书

### 技术领域

本申请涉及演示技术领域。

### 背景技术

现有技术存在不足。

### 发明内容

本申请提供一种演示方法。

### 附图说明

图1为演示流程图。
图2为演示结构图。

### 具体实施方式

如图1所示，方法包括步骤A。如图2所示，系统包括模块B。
"""

MMD = "flowchart LR\n  A[甲] --> B[乙]\n"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(tmp_path))
    import importlib

    from app import config

    importlib.reload(config)
    importlib.reload(projects)
    s = projects.ProjectStore(str(tmp_path))
    s.create("demo", "演示案")
    s.save_content("demo", CONTENT)
    return s


def _add_source(store, name, source=MMD):
    return fmod.put_figure_source(store, "demo", name, source)


def _spec_files(store):
    return [f.file for f in store.load_figures(store.get("demo").dir).spec]


def _figure_diags(store):
    p = store.get("demo")
    rep = lintmod.lint(
        store.read_content("demo"),
        projects.normalize_settings(p.settings, store.list_figs(p.dir)),
        p.figs_dir,
        with_preflight=True,
        figures=store.load_figures(p.dir),
    )
    return [d for d in rep["diagnostics"] if "figures" in d["id"]]


def _zip_names(store):
    return zipfile.ZipFile(io.BytesIO(fmod.export_zip(store, "demo"))).namelist()


def test_promote_then_export_zip_matches_figures_md(store):
    _add_source(store, "fig1-a.mmd")
    _add_source(store, "fig2-b.mmd")
    rendered = fmod.promote_figure_sources(store, "demo")
    assert rendered == ["fig1-a.png", "fig2-b.png"]
    doc = store.load_figures(store.get("demo").dir)
    assert [f.file for f in doc.spec] == ["fig1-a.png", "fig2-b.png"]
    assert [f.alt for f in doc.spec] == ["图1 演示流程图", "图2 演示结构图"]
    assert doc.abstract.file == "fig1-a.png"
    # 三处一致：figures.md 顺序 == 导出 zip 顺序，正文图号引用全部命中（无 figures 诊断）
    assert _zip_names(store) == _spec_files(store)
    assert _figure_diags(store) == []


def test_reorder_keeps_zip_aligned_and_alt_mismatch_diagnoses(store):
    _add_source(store, "fig1-a.mmd")
    _add_source(store, "fig2-b.mmd")
    fmod.promote_figure_sources(store, "demo")

    fmod.reorder_figures(store, "demo", ["fig2-b.png", "fig1-a.png"])
    doc = store.load_figures(store.get("demo").dir)
    assert [f.file for f in doc.spec] == ["fig2-b.png", "fig1-a.png"]
    # 导出跟随 figures.md 节序
    assert _zip_names(store) == ["fig2-b.png", "fig1-a.png"]
    # alt 随文件走 ⇒ 图1 位上的 alt 仍是「图2 演示结构图」，与「图1为演示流程图」题注不一致 → alt_mismatch 诊断
    mismatches = [d for d in _figure_diags(store) if d["id"].startswith("preflight.figures.alt_mismatch")]
    assert len(mismatches) == 2 and all(d["severity"] == "warning" for d in mismatches)
    # 正文图号引用本身仍全部落在节内（引用按号，不因重排变成 ref_missing）
    assert not any("ref_missing" in d["id"] for d in _figure_diags(store))


def test_renamed_source_labels_real_position_and_flags_orphan(store):
    _add_source(store, "fig1-a.mmd")
    _add_source(store, "fig2-b.mmd")
    fmod.promote_figure_sources(store, "demo")

    # 图源改名 fig1-a → fig9-z：声明位 9 超出节长，落位第 3 行后 alt 必须写真实序号
    p = store.get("demo")
    os.rename(os.path.join(p.figsrc_dir, "fig1-a.mmd"), os.path.join(p.figsrc_dir, "fig9-z.mmd"))
    fmod.promote_figure_sources(store, "demo")

    doc = store.load_figures(p.dir)
    assert [f.file for f in doc.spec] == ["fig1-a.png", "fig2-b.png", "fig9-z.png"]
    assert doc.spec[-1].alt == "图3"  # 修复前：声明位直接写进 alt（「图9」标签贴第 3 行）
    assert _zip_names(store) == _spec_files(store)

    diags = _figure_diags(store)
    # fig1-a.png 的图源已不存在 ⇒ source_orphan 诊断；fig9-z.png 自身有源不报
    orphans = [d for d in diags if d["id"].startswith("figures.source_orphan")]
    assert len(orphans) == 1 and "fig1-a.png" in orphans[0]["message"]
    # 收录行与文件一致（无 file_missing）；图9 位置声明坍缩为图3 后按常规题注规则提示
    assert not any("file_missing" in d["id"] for d in diags)
    assert any("caption_missing" in d["id"] and "图3" in d["message"] for d in diags)


def test_restored_source_clears_orphan_diagnosis(store):
    """把图源改回原名（恢复 figs-src/<stem>）后该图诊断消失——诊断可闭环，不是一次性噪音。
    中途晋级出的 fig1-renamed.png 自身也失去图源，继续被诊断为孤儿（由用户决定去留）。"""
    _add_source(store, "fig1-a.mmd")
    fmod.promote_figure_sources(store, "demo")
    p = store.get("demo")
    os.rename(os.path.join(p.figsrc_dir, "fig1-a.mmd"), os.path.join(p.figsrc_dir, "fig1-renamed.mmd"))
    fmod.promote_figure_sources(store, "demo")
    assert any(d["id"].startswith("figures.source_orphan") for d in _figure_diags(store))

    os.rename(os.path.join(p.figsrc_dir, "fig1-renamed.mmd"), os.path.join(p.figsrc_dir, "fig1-a.mmd"))
    fmod.promote_figure_sources(store, "demo")
    orphans = [d for d in _figure_diags(store) if d["id"].startswith("figures.source_orphan")]
    assert orphans and all("fig1-a.png" not in d["message"] for d in orphans)
