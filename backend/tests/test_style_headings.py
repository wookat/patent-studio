# -*- coding: utf-8 -*-
"""W9 决策 3：style.headings.section / subsection（font / size / bold / align / numbering）。

默认值 = builder 现行为（零漂移由 make zero-drift 单独把关）；style.css 输出 --ps-h3-* / --ps-h4-*；
normalize_settings 校验非法值 → ValueError（PUT /settings → 422）。
"""
import io

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

from app.domain.projects import normalize_settings
from patent_studio.kernel.builder import build_patent_ex
from patent_studio.kernel.style import (
    DEFAULT_STYLE,
    cn_number,
    heading_prefix,
    heading_style,
    merge_style,
    style_diff,
    validate_headings,
)
from patent_studio.kernel.style_css import render_css, render_vars

MD = """# 标题

## 摘要

摘要一段。

## 权利要求书

1.一种方法，其特征在于，包括步骤。

## 说明书

### 技术领域

本发明涉及领域。

### 背景技术

背景。

### 发明内容

#### 技术方案

方案。

#### 有益效果

效果。

### 附图说明

图1为流程图。

### 具体实施方式

实施。
"""


def test_default_heading_style_inherits_fonts_and_sizes():
    s = merge_style(None)
    h3, h4 = heading_style(s, "section"), heading_style(s, "subsection")
    assert h3 == {"font": s["fonts"]["heading_cjk"], "size": s["sizes"]["section_heading"],
                  "bold": False, "align": "left", "numbering": "none"}
    assert h4["font"] == s["fonts"]["heading_cjk"] and h4["size"] == s["sizes"]["subsection_heading"]
    assert style_diff(s) == {}  # DEFAULT_STYLE 自身无差异 ⇒ 旧 studio.json 不受影响


def test_heading_style_override_and_inheritance_chain():
    s = merge_style({"fonts": {"heading_cjk": "楷体"}, "sizes": {"section_heading": 14},
                     "headings": {"section": {"bold": True, "align": "center", "numbering": "cn"},
                                  "subsection": {"font": "仿宋", "size": 11.5, "numbering": "arabic"}}})
    assert heading_style(s, "section") == {"font": "楷体", "size": 14, "bold": True, "align": "center",
                                           "numbering": "cn"}
    assert heading_style(s, "subsection")["font"] == "仿宋" and heading_style(s, "subsection")["size"] == 11.5
    assert style_diff(s)["headings"] == {"section": {"bold": True, "align": "center", "numbering": "cn"},
                                         "subsection": {"font": "仿宋", "size": 11.5, "numbering": "arabic"}}


def test_cn_number_and_prefix():
    assert [cn_number(n) for n in (1, 9, 10, 11, 20, 21)] == ["一", "九", "十", "十一", "二十", "二十一"]
    assert heading_prefix("none", 3) == "" and heading_prefix("none", 3, 2) == ""
    assert heading_prefix("cn", 3) == "三、" and heading_prefix("cn", 3, 2) == "2."
    assert heading_prefix("arabic", 3) == "3." and heading_prefix("arabic", 3, 2) == "3.2"


def test_css_vars_h3_h4_default_and_override():
    v = render_vars(merge_style(None))
    assert v["--ps-h3-size"] == "12pt" and v["--ps-h4-size"] == "12pt"
    assert v["--ps-h3-weight"] == "normal" and v["--ps-h3-align"] == "left" and v["--ps-h3-numbering"] == "none"
    assert v["--ps-h3-font"] == v["--ps-font-heading"] and v["--ps-h4-font"] == v["--ps-font-heading"]
    v2 = render_vars(merge_style({"headings": {"section": {"size": 14, "bold": True, "align": "center",
                                                          "numbering": "cn", "font": "楷体"}}}))
    assert v2["--ps-h3-size"] == "14pt" and v2["--ps-h3-weight"] == "bold" and v2["--ps-h3-align"] == "center"
    assert v2["--ps-h3-numbering"] == "cn" and '"楷体"' in v2["--ps-h3-font"]
    assert v2["--ps-h4-size"] == "12pt"
    assert "--ps-h3-size:14pt" in render_css(merge_style({"headings": {"section": {"size": 14}}}))


def test_builder_applies_heading_style(tmp_path):
    md = tmp_path / "content.md"
    md.write_text(MD, encoding="utf-8")
    fig = tmp_path / "fig1.png"
    from PIL import Image
    Image.new("RGB", (100, 60), "white").save(fig)
    base = {"content_md": str(md), "figs_dir": str(tmp_path), "abstract_figure": ("fig1.png", 5.0),
            "spec_figures": [("fig1.png", 5.0)], "sub_except": ("tsf_guard",), "out": str(tmp_path / "a.docx")}

    def headings(style):
        build_patent_ex({**base, "style": style})
        doc = Document(io.BytesIO((tmp_path / "a.docx").read_bytes()))
        return [p for p in doc.paragraphs
                if p.text.endswith(("技术领域", "背景技术", "技术方案", "有益效果")) and "本发明" not in p.text]

    plain = headings(None)
    assert [p.text for p in plain] == ["技术领域", "背景技术", "技术方案", "有益效果"]
    assert all(not r.bold for p in plain for r in p.runs)
    assert plain[0].alignment == WD_ALIGN_PARAGRAPH.JUSTIFY

    styled = headings({"headings": {"section": {"bold": True, "align": "center", "numbering": "cn", "size": 14},
                                    "subsection": {"numbering": "arabic", "font": "楷体"}}})
    assert [p.text for p in styled] == ["一、技术领域", "二、背景技术", "3.1技术方案", "3.2有益效果"]
    sec = next(p for p in styled if p.text == "一、技术领域")
    assert sec.alignment == WD_ALIGN_PARAGRAPH.CENTER and all(r.bold for r in sec.runs)
    assert sec.runs[0].font.size.pt == 14
    sub = next(p for p in styled if p.text == "3.1技术方案")
    from docx.oxml.ns import qn
    assert sub.runs[0]._r.rPr.rFonts.get(qn("w:eastAsia")) == "楷体" and sub.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY


def test_heading_style_bad_values_fall_back_in_builder_but_rejected_by_normalize():
    s = merge_style({"headings": {"section": {"align": "right", "numbering": "roman"}}})
    assert heading_style(s, "section")["align"] == "left" and heading_style(s, "section")["numbering"] == "none"
    validate_headings({})
    validate_headings({"headings": {"section": {"bold": True, "align": "center", "numbering": "arabic",
                                                "font": None, "size": None}}})
    for bad in ({"headings": {"section": {"align": "right"}}},
                {"headings": {"section": {"numbering": "roman"}}},
                {"headings": {"section": {"bold": "yes"}}},
                {"headings": {"section": {"size": 0}}},
                {"headings": {"section": {"size": True}}},
                {"headings": {"section": {"font": ""}}},
                {"headings": {"section": {"color": "#f00"}}},
                {"headings": {"h5": {}}},
                {"headings": []}):
        with pytest.raises(ValueError):
            validate_headings(bad)
    with pytest.raises(ValueError):
        normalize_settings({"style": {"headings": {"subsection": {"align": "justify"}}}}, [])
    ok = normalize_settings({"style": {"headings": {"subsection": {"align": "center"}}}}, [])
    assert ok["style"] == {"headings": {"subsection": {"align": "center"}}}
    assert normalize_settings({"style": DEFAULT_STYLE}, [])["style"] == {}


def test_put_settings_rejects_bad_heading_style(tmp_path, monkeypatch):
    import importlib
    import os
    import shutil

    from fastapi.testclient import TestClient

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(root, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*", "docs", "project.json"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    from app import config, main
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(main)
    c = TestClient(main.app)
    r = c.put("/api/projects/method/settings", json={"style": {"headings": {"section": {"align": "right"}}}})
    assert r.status_code == 422 and "align" in r.json()["detail"]
    r = c.put("/api/projects/method/settings", json={"style": {"headings": {"section": {"align": "center"}}}})
    assert r.status_code == 200, r.text
    assert r.json()["effective_style"]["headings"]["section"]["align"] == "center"
    assert r.json()["settings"]["style"] == {"headings": {"section": {"align": "center"}}}
    css = c.get("/api/projects/method/style.css")
    assert css.status_code == 200 and "--ps-h3-align:center" in css.text
