# -*- coding: utf-8 -*-
"""W4-D D1：Style → style.css 生成器 + GET /style.css 随 settings 变化 + AST para_no 与 DOCX 段号同源（16 §2–3）。"""

import os
import re
import zipfile

import pytest
import test_auth

from app.domain.projects import ProjectStore
from patent_studio.kernel import ast as ast_mod
from patent_studio.kernel import figures_md, numbering
from patent_studio.kernel.ast import parse_ast
from patent_studio.kernel.builder import build_patent_ex
from patent_studio.kernel.style import DEFAULT_STYLE, merge_style
from patent_studio.kernel.style_css import (
    PART_CLASSES,
    STYLE_CSS_VARS,
    cm_to_px,
    css_number,
    font_family,
    render_css,
    render_vars,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
client = test_auth.client  # pytest fixture

_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")


def _rules(css):
    """CSS 文本 → {selector: {prop: value}}（生成器不产生嵌套规则）。"""
    out = {}
    for sel, body in _RULE_RE.findall(re.sub(r"/\*.*?\*/", "", css, flags=re.S)):
        decls = {}
        for d in body.split(";"):
            if d.strip():
                k, v = d.split(":", 1)
                decls[k.strip()] = v.strip()
        out[sel.strip()] = decls
    return out


# ---------------- 生成器 ----------------


def test_css_number_and_units():
    assert css_number(12) == "12" and css_number(10.5) == "10.5" and css_number(21.0) == "21"
    assert css_number(1.3) == "1.3" and css_number(1 / 8) == "0.125"
    assert cm_to_px(21.0) == 793.7 and cm_to_px(29.7) == 1122.52 and cm_to_px(2.54) == 96.0
    with pytest.raises(TypeError):
        css_number(True)


def test_font_family_fallbacks_and_dedupe():
    body = font_family("Times New Roman", "宋体", generic="serif")
    assert body.startswith('"Times New Roman", "Times", "Liberation Serif"')
    assert '"宋体", "SimSun"' in body and body.endswith(", serif")
    heading = font_family("SimHei", "黑体", generic="sans-serif")
    assert heading.count('"SimHei"') == 1 and heading.count('"黑体"') == 1
    assert font_family("楷体_GB2312", generic="serif") == '"楷体_GB2312", serif'


def test_default_vars_match_mapping_table():
    v = render_vars(merge_style(None))
    for _path, var, _unit in STYLE_CSS_VARS:
        assert var in v
    assert v["--ps-font-body-cjk"] == '"宋体"' and v["--ps-font-body-ascii"] == '"Times New Roman"'
    assert v["--ps-size-body"] == "12pt" and v["--ps-size-para-no"] == "10.5pt"
    assert v["--ps-line-height"] == "1.3" and v["--ps-first-indent"] == "24pt"
    assert v["--ps-page-w"] == "21cm" and v["--ps-page-h"] == "29.7cm"
    assert v["--ps-margin-t"] == "25mm" and v["--ps-margin-r"] == "15mm"
    assert v["--ps-header-distance"] == "1.4cm" and v["--ps-eq-side"] == "2.2cm"
    assert v["--ps-header-rule"] == "1pt"
    assert v["--ps-table-rule-outer"] == "1.5pt" and v["--ps-table-rule-head"] == "0.75pt"
    assert v["--ps-page-w-px"] == "793.7" and v["--ps-page-h-px"] == "1122.52"
    assert v["--ps-header-spacing-short"] == "6.5pt" and v["--ps-header-spacing-long"] == "4.5pt"
    assert v["--ps-font-body"].startswith('"Times New Roman"') and '"宋体"' in v["--ps-font-body"]
    assert v["--ps-font-heading"].startswith('"SimHei", "黑体"') and v["--ps-font-heading"].endswith("sans-serif")
    assert v["--ps-font-mono"].startswith('"Courier New"') and v["--ps-font-mono"].endswith("monospace")


def test_render_css_shape_and_part_classes():
    css = render_css(merge_style(None))
    rules = _rules(css)
    root = rules[":root,.ps-layout"]
    assert root["--ps-size-body"] == "12pt" and len(root) == len(render_vars(DEFAULT_STYLE))
    for cls in PART_CLASSES:
        assert f".{cls}" in rules, cls
    assert rules[".ps-paper"]["width"] == "var(--ps-page-w)"
    assert rules[".ps-paper"]["padding"] == " ".join(f"var(--ps-margin-{s})" for s in "trbl")
    assert rules[".ps-abstract"]["text-indent"] == "var(--ps-first-indent)"
    assert rules[".ps-body"]["margin"] == "0 0 var(--ps-gap-body)" and rules[".ps-body"]["text-align"] == "justify"
    assert rules[".ps-desc-h"]["font-family"] == "var(--ps-font-heading)"
    assert rules['.ps-desc-h[data-level="2"]']["font-size"] == "var(--ps-size-h2)"
    assert rules[".ps-para-no"]["user-select"] == "none"
    assert rules[".ps-caption"]["text-align"] == "center"
    assert rules[".ps-table"]["font-size"] == "var(--ps-size-table)"
    assert rules[".ps-table[data-three-line]"]["border-top"] == "var(--ps-table-rule-outer) solid #000"
    assert rules[".ps-eq"]["grid-template-columns"] == "var(--ps-eq-side) minmax(0,1fr) var(--ps-eq-side)"
    # 版面公式容器 .ps-eq-math 是 .ps-eq 的直接子元素，须占满中列（W10：此前只写 math/.ps-eq-body，导致容器宽度塌为 0）
    assert rules[".ps-eq > .ps-eq-math"]["grid-column"] == "2"
    assert rules[".ps-eq > .ps-eq-math"]["justify-self"] == "stretch"
    assert rules[".ps-code"]["font-family"] == "var(--ps-font-mono)"
    # 页眉：说明书 3 字 → short；其余 5 字 → long（builder.part_heading 同一规则）
    assert rules[".ps-header"]["letter-spacing"] == "var(--ps-header-spacing-long)"
    assert rules['.ps-paper[data-part="description"] .ps-header']["letter-spacing"] == "var(--ps-header-spacing-short)"
    assert '.ps-paper[data-part="claims"] .ps-header' not in rules
    # part 类只引变量，不写字面尺寸
    for sel, decls in rules.items():
        if sel.startswith(":root"):
            continue
        for k, val in decls.items():
            sized = k in ("font-size", "width", "min-height", "top", "letter-spacing", "text-indent")
            if sized or k.startswith("margin"):
                assert "var(--ps-" in val or val in ("0", "0 0 0", "1em", "100%"), (sel, k, val)


def test_render_css_follows_overrides():
    css = render_css(
        merge_style(
            {
                "sizes": {"body": 10.5},
                "fonts": {"body_cjk": "仿宋", "ascii": "Arial"},
                "page": {"width_cm": 18.4, "margin_left_mm": 20},
                "paragraph": {"line_spacing": 1.5},
                "header": {"labels": {"claims": "权利"}},
            }
        )
    )
    root = _rules(css)[":root,.ps-layout"]
    assert root["--ps-size-body"] == "10.5pt" and root["--ps-line-height"] == "1.5"
    assert root["--ps-page-w"] == "18.4cm" and root["--ps-page-w-px"] == "695.43" and root["--ps-margin-l"] == "20mm"
    assert root["--ps-font-body"].startswith('"Arial", "Liberation Sans", "Arimo", "仿宋", "FangSong"')
    assert '.ps-paper[data-part="claims"] .ps-header' in _rules(css)


# ---------------- 路由 ----------------


def test_style_css_route_reflects_settings(client):
    c, _ = client
    r = c.get("/api/projects/method/style.css")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/css; charset=utf-8"
    assert r.headers["cache-control"] == "no-cache"
    assert r.text == render_css(merge_style(None))
    assert "--ps-size-body:12pt" in r.text

    s = c.get("/api/projects/method/settings").json()["settings"]
    s["style"] = {"sizes": {"body": 10.5}, "page": {"margin_top_mm": 30}}
    assert c.put("/api/projects/method/settings", json=s).status_code == 200
    r2 = c.get("/api/projects/method/style.css")
    assert "--ps-size-body:10.5pt" in r2.text and "--ps-margin-t:30mm" in r2.text
    assert "--ps-size-title:14pt" in r2.text  # 未改的键仍为默认

    assert c.get("/api/projects/nope/style.css").status_code == 404


# ---------------- para_no ----------------


def test_ast_para_no_uses_numbering_number_spec():
    """AST 段号与 builder 同一实现：ast.py 引用的 number_spec 就是 numbering.number_spec 本体。"""
    assert ast_mod.number_spec is numbering.number_spec
    assert numbering.para_label(7) == "[0007]"


def _para_nos(ast):
    out = []
    for b in ast["description"]:
        if b["kind"] in ("paragraph", "code"):
            out.append(b["para_no"])
        elif b["kind"] == "table":
            out.append(b["para_no"])
            for k in ("caption_after", "note"):
                if b[k]:
                    out.append(b[k]["para_no"])
    return out


@pytest.mark.parametrize("pid", ("method", "system"))
def test_para_no_matches_docx_labels(pid, tmp_path):
    """两案：AST 正文块 para_no 序列逐段 == builder 产出 document.xml 的 [000N] 序列。"""
    store = ProjectStore(EXAMPLES)
    ast = parse_ast(
        store.read_content(pid), store.load_settings(pid), figures=figures_md.read(os.path.join(EXAMPLES, pid))
    )
    nums = _para_nos(ast)
    assert nums and nums == list(range(1, len(nums) + 1))
    assert all(b["para_no"] is None for b in ast["abstract"]["paragraphs"])
    assert all(b["para_no"] >= 1 for b in ast["description"] if b["kind"] in ("paragraph", "table", "code"))

    cfg = store.build_config(store.get(pid), out=str(tmp_path / f"{pid}.docx"))
    build_patent_ex(cfg)
    with zipfile.ZipFile(cfg["out"]) as z:
        doc = z.read("word/document.xml").decode("utf-8")
    # 新语料有裸「[NNNN]」空段行：内核生成标签 + 字面文本独立成 run 各计一次 →
    # 整 run 恰为 [NNNN] 的序列 = 段号序列 + 这些行的二次出现
    bare = {
        int(m.group(1)) for ln in store.read_content(pid).split("\n") if (m := re.fullmatch(r"\[(\d{4})\]", ln.strip()))
    }
    expected = [x for n in nums for x in ([n, n] if n in bare else [n])]
    assert [int(m.group(1)) for m in re.finditer(r"<w:t[^>]*>\[(\d{4})\]</w:t>", doc)] == expected


def test_ast_route_blocks_carry_para_no(client):
    c, _ = client
    ast = c.get("/api/projects/method/ast").json()
    nums = _para_nos(ast)
    assert nums == list(range(1, len(nums) + 1))
