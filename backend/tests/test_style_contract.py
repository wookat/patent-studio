# -*- coding: utf-8 -*-
"""W4-D 骨架锁（docs/plan/16 §9a）：style.css 路由 200 text/css、Style→CSS 映射表每条路径可解析、
版面视图段号徽标依赖的 AST 形状。D1 功能测试见 test_style_css.py。"""
import os

import pytest
import test_auth

from patent_docx import figures_md
from patent_docx.ast import parse_ast
from patent_docx.style import DEFAULT_STYLE, merge_style
from patent_docx.style_css import PART_CLASSES, STYLE_CSS_VARS, render_css, style_value

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
client = test_auth.client  # pytest fixture


def test_style_css_200_text_css(client):
    c, _ = client
    r = c.get("/api/projects/method/style.css")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/css")
    assert "--ps-size-body:12pt" in r.text


def test_style_css_vars_resolve_and_are_unique():
    style = merge_style({"sizes": {"body": 10.5}})
    names = [var for _p, var, _u in STYLE_CSS_VARS]
    assert len(names) == len(set(names)) and all(n.startswith("--ps-") for n in names)
    for path, _var, unit in STYLE_CSS_VARS:
        v = style_value(style, path)
        assert unit in ("", "pt", "pt8", "cm", "mm")
        assert isinstance(v, str) if unit == "" and path.startswith("fonts.") else isinstance(v, (int, float))
    assert style_value(style, "sizes.body") == 10.5 and style_value(DEFAULT_STYLE, "sizes.body") == 12
    required = {"ps-paper", "ps-abstract", "ps-claim", "ps-desc-h", "ps-body", "ps-caption", "ps-table", "ps-eq"}
    assert required <= set(PART_CLASSES)
    assert "--ps-size-body:10.5pt" in render_css(style)


@pytest.mark.parametrize("pid", ("method", "system"))
def test_ast_blocks_carry_para_no(pid):
    """版面视图徽标：说明书每个 paragraph/table/code 块带正整数 para_no，公式带 anchor_para_no，标题无段号。"""
    from app.domain.projects import ProjectStore

    store = ProjectStore(EXAMPLES)
    ast = parse_ast(store.read_content(pid), store.load_settings(pid),
                    figures=figures_md.read(os.path.join(EXAMPLES, pid)))
    seen = []
    for b in ast["description"]:
        if b["kind"] in ("paragraph", "table", "code"):
            assert isinstance(b["para_no"], int) and b["para_no"] >= 1
            seen.append(b["para_no"])
        elif b["kind"] == "equation":
            assert b["anchor_para_no"] is None or b["anchor_para_no"] >= 1
        else:
            assert b["kind"] in ("section", "subsection") and "para_no" not in b
    assert seen == sorted(seen) and seen
    assert all(p["para_no"] is None for p in ast["abstract"]["paragraphs"])
