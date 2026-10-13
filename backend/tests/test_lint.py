# -*- coding: utf-8 -*-
"""lint 十条规则：每条一正一反；两件真实案子 0 error。"""
import os

import pytest

from app.domain.lint import SPEC_SECTIONS, lint
from app.domain.projects import ProjectStore

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")

SETTINGS = {"abstract_figure": ["fig1.png", 14.5], "spec_figures": [["fig1.png", 15.0]], "abstract_limit": 300}

GOOD = """# 一种测试方法

## 摘要

本发明公开了一种测试方法。

## 权利要求书

1.一种测试方法，其特征在于，包括步骤 A。

2.根据权利要求1所述的方法，其特征在于，还包括步骤 B。

3.根据权利要求1或2所述的方法，其特征在于，还包括步骤 C。

## 说明书

### 技术领域

本发明涉及测试。

### 背景技术

现有技术。

### 发明内容

$$ y = f(x) $$

### 附图说明

图1为流程图。

### 具体实施方式

如图1所示。
"""


def ids(report):
    return [d["id"] for d in report["diagnostics"]]


def base_ids(report):
    return {d["id"].split("#")[0] for d in report["diagnostics"]}


def find(report, base):
    return [d for d in report["diagnostics"] if d["id"].split("#")[0] == base]


def line_of(content, needle):
    for i, ln in enumerate(content.splitlines(), 1):
        if needle in ln:
            return i
    raise AssertionError(needle)


def test_good_document_is_clean(tmp_path):
    (tmp_path / "fig1.png").write_bytes(b"x")
    r = lint(GOOD, SETTINGS, str(tmp_path))
    assert r["diagnostics"] == [], r
    assert r["counts"] == {"error": 0, "warning": 0, "info": 0}


def test_report_shape_and_counts():
    r = lint("", {})
    assert set(r) == {"diagnostics", "counts"}
    assert set(r["counts"]) == {"error", "warning", "info"}
    assert r["counts"]["error"] == sum(d["severity"] == "error" for d in r["diagnostics"])
    for d in r["diagnostics"]:
        assert set(d) >= {"id", "severity", "source", "message", "line"}
        assert d["source"] == "lint"


# ---- abstract.limit ----
def test_abstract_limit():
    long_abs = GOOD.replace("本发明公开了一种测试方法。", "测" * 301)
    r = lint(long_abs, SETTINGS)
    d = find(r, "abstract.limit")
    assert len(d) == 1 and d[0]["severity"] == "error"
    assert d[0]["line"] == line_of(long_abs, "测测测")
    assert "301" in d[0]["message"]
    assert not find(lint(long_abs, {**SETTINGS, "abstract_limit": 400}), "abstract.limit")
    assert not find(lint(GOOD, SETTINGS), "abstract.limit")


# ---- abstract.empty ----
def test_abstract_empty():
    empty = GOOD.replace("本发明公开了一种测试方法。\n", "")
    d = find(lint(empty, SETTINGS), "abstract.empty")
    assert len(d) == 1 and d[0]["severity"] == "error" and d[0]["line"] == line_of(empty, "## 摘要")
    no_section = GOOD.replace("## 摘要\n\n本发明公开了一种测试方法。\n", "")
    d = find(lint(no_section, SETTINGS), "abstract.empty")
    assert len(d) == 1 and d[0]["line"] == 1  # 定位到 # 标题
    assert not find(lint(GOOD, SETTINGS), "abstract.empty")


# ---- claims.numbering ----
def test_claims_numbering():
    skipped = GOOD.replace("3.根据权利要求1或2", "4.根据权利要求1或2")
    d = find(lint(skipped, SETTINGS), "claims.numbering")
    assert [x["id"] for x in d] == ["claims.numbering#3"]
    assert d[0]["severity"] == "error" and d[0]["line"] == line_of(skipped, "4.根据")
    unnumbered = GOOD.replace("2.根据权利要求1所述", "根据权利要求1所述")
    d = find(lint(unnumbered, SETTINGS), "claims.numbering")
    assert [x["id"] for x in d] == ["claims.numbering#2"]
    dup = GOOD.replace("3.根据权利要求1或2", "2.根据权利要求1或2")
    assert [x["id"] for x in find(lint(dup, SETTINGS), "claims.numbering")] == ["claims.numbering#3"]
    no_claims = GOOD.replace("## 权利要求书\n", "## 权利要求书\n\n## 说明书\n").split("## 说明书\n", 1)
    no_claims = no_claims[0] + "## 说明书\n" + no_claims[1].split("## 说明书\n", 1)[1]
    d = find(lint(no_claims, SETTINGS), "claims.numbering")
    assert d and d[0]["message"] == "权利要求书为空"
    assert not find(lint(GOOD, SETTINGS), "claims.numbering")


# ---- claims.forward_ref ----
def test_claims_forward_ref():
    fwd = GOOD.replace("2.根据权利要求1所述", "2.根据权利要求3所述")
    d = find(lint(fwd, SETTINGS), "claims.forward_ref")
    assert [x["id"] for x in d] == ["claims.forward_ref#2"]
    assert d[0]["severity"] == "error" and d[0]["line"] == line_of(fwd, "2.根据权利要求3")
    assert "权利要求3" in d[0]["message"]
    self_ref = GOOD.replace("2.根据权利要求1所述", "2.根据权利要求2所述")
    assert "引用了自身" in find(lint(self_ref, SETTINGS), "claims.forward_ref")[0]["message"]
    missing = GOOD.replace("3.根据权利要求1或2所述", "3.根据权利要求1至9所述")
    assert "不存在" in find(lint(missing, SETTINGS), "claims.forward_ref")[0]["message"]
    assert not find(lint(GOOD, SETTINGS), "claims.forward_ref")  # 1或2 / 1 为合法后向引用


# ---- claims.independent_first ----
def test_claims_independent_first():
    dep_first = GOOD.replace("1.一种测试方法，其特征在于", "1.根据权利要求2所述的方法，其特征在于")
    r = lint(dep_first, SETTINGS)
    d = find(r, "claims.independent_first")
    assert len(d) == 1 and d[0]["severity"] == "warning" and d[0]["line"] == line_of(dep_first, "1.根据")
    assert not find(lint(GOOD, SETTINGS), "claims.independent_first")


# ---- spec.sections ----
def test_spec_sections():
    missing = GOOD.replace("### 背景技术\n\n现有技术。\n\n", "")
    d = find(lint(missing, SETTINGS), "spec.sections")
    assert len(d) == 1 and d[0]["severity"] == "error" and "背景技术" in d[0]["message"]
    assert d[0]["line"] == line_of(missing, "### 技术领域")  # 定位到缺失处前一章节
    swapped = GOOD.replace("### 技术领域\n\n本发明涉及测试。\n\n### 背景技术\n\n现有技术。\n",
                           "### 背景技术\n\n现有技术。\n\n### 技术领域\n\n本发明涉及测试。\n")
    d = find(lint(swapped, SETTINGS), "spec.sections")
    assert len(d) == 1 and "顺序" in d[0]["message"] and d[0]["line"] == line_of(swapped, "### 技术领域")
    no_spec = GOOD.split("## 说明书")[0]
    assert find(lint(no_spec, SETTINGS), "spec.sections")[0]["line"] is None
    assert not find(lint(GOOD, SETTINGS), "spec.sections")


# ---- spec.unknown_section ----
def test_spec_unknown_section():
    bad_top = GOOD.replace("## 权利要求书", "## 权利要求")
    r = lint(bad_top, SETTINGS)
    d = find(r, "spec.unknown_section")
    assert len(d) == 1 and d[0]["severity"] == "error" and d[0]["line"] == line_of(bad_top, "## 权利要求")
    assert d[0]["message"] == "未知章节「权利要求」：仅允许 摘要/权利要求书/说明书"
    bad_h3 = GOOD.replace("### 具体实施方式", "### 实施例\n\n略。\n\n### 具体实施方式")
    d = find(lint(bad_h3, SETTINGS), "spec.unknown_section")
    assert len(d) == 1 and d[0]["line"] == line_of(bad_h3, "### 实施例")
    assert all(s in d[0]["message"] for s in SPEC_SECTIONS)
    stray = GOOD.replace("## 摘要\n", "## 摘要\n\n### 概述\n")
    assert find(lint(stray, SETTINGS), "spec.unknown_section")[0]["line"] == line_of(stray, "### 概述")
    assert not find(lint(GOOD, SETTINGS), "spec.unknown_section")


# ---- figures.ref ----
def test_figures_ref():
    r = lint(GOOD.replace("如图1所示。", "如图2所示。"), SETTINGS)
    d = find(r, "figures.ref")
    assert [x["id"] for x in d] == ["figures.ref#2"] and d[0]["severity"] == "warning"
    assert d[0]["line"] == line_of(GOOD, "如图1所示")
    two = {**SETTINGS, "spec_figures": [["fig1.png", 15.0], ["fig2.png", 15.0]]}
    d = find(lint(GOOD, two), "figures.ref")
    assert [x["id"] for x in d] == ["figures.ref#desc2"] and d[0]["line"] == line_of(GOOD, "### 附图说明")
    assert "fig2.png" in d[0]["message"]
    assert not find(lint(GOOD, SETTINGS), "figures.ref")


# ---- figures.abstract ----
def test_figures_abstract(tmp_path):
    d = find(lint(GOOD, {**SETTINGS, "abstract_figure": None}), "figures.abstract")
    assert len(d) == 1 and d[0]["severity"] == "warning" and d[0]["message"] == "未设置摘要附图"
    d = find(lint(GOOD, SETTINGS, str(tmp_path)), "figures.abstract")
    assert len(d) == 1 and "fig1.png" in d[0]["message"]
    (tmp_path / "fig1.png").write_bytes(b"x")
    assert not find(lint(GOOD, SETTINGS, str(tmp_path)), "figures.abstract")


# ---- equation.unclosed ----
def test_equation_unclosed():
    bad = GOOD.replace("$$ y = f(x) $$", "$$ y = f(x)")
    d = find(lint(bad, SETTINGS), "equation.unclosed")
    assert len(d) == 1 and d[0]["severity"] == "error" and d[0]["line"] == line_of(bad, "$$ y")
    assert d[0]["section"] == "说明书"
    in_code = GOOD.replace("$$ y = f(x) $$", "```\n$$ not math\n```")
    assert not find(lint(in_code, SETTINGS), "equation.unclosed")
    assert not find(lint(GOOD, SETTINGS), "equation.unclosed")


# ---- 两件真实案子 ----
@pytest.mark.parametrize("pid", ["method", "system"])
def test_real_examples_zero_error(pid):
    store = ProjectStore(EXAMPLES)
    p = store.get(pid)
    r = lint(store.read_content(pid), p.settings, p.figs_dir)
    assert r["counts"]["error"] == 0, r["diagnostics"]
    assert r["counts"]["warning"] == 0, r["diagnostics"]


# ---- style.vague / style.trademark ----
def test_style_vague():
    bad = GOOD.replace("本发明涉及测试。", "本发明涉及测试，精度大约 5mm 左右。")
    d = find(lint(bad, SETTINGS), "style.vague")
    assert {x["id"] for x in d} == {f"style.vague#L{line_of(bad, '精度大约')}"} and d[0]["severity"] == "warning"
    assert not find(lint(GOOD, SETTINGS), "style.vague")


def test_style_trademark():
    bad = GOOD.replace("本发明涉及测试。", "本发明涉及 TestSoft® 测试系统。")
    d = find(lint(bad, SETTINGS), "style.trademark")
    assert len(d) == 1 and d[0]["severity"] == "warning" and "®" in d[0]["message"]
    assert not find(lint(GOOD, SETTINGS), "style.trademark")


# ---- claims.characterizing ----
def test_characterizing():
    bad = GOOD.replace("2.根据权利要求1所述的方法，其特征在于，还包括步骤 B。",
                       "2.根据权利要求1所述的方法，还包括步骤 B。")
    d = find(lint(bad, SETTINGS), "claims.characterizing")
    assert {x["id"] for x in d} == {"claims.characterizing#2"} and d[0]["severity"] == "warning"
    assert not find(lint(GOOD, SETTINGS), "claims.characterizing")


# ---- style.self_ref ----
def test_self_ref():
    bad = GOOD.replace(
        "本发明涉及测试。",
        "本发明涉及测试。\n本申请实施例中，方法生效。\n本申请实施例中，流程结束。\n本申请实施例中，结果输出。\n本发明还涉及装置。",
    )
    d = find(lint(bad, SETTINGS), "style.self_ref")
    assert len(d) == 1 and d[0]["severity"] == "warning" and "自称混用" in d[0]["message"]
    assert not find(lint(GOOD, SETTINGS), "style.self_ref")


# ---- claims.excluded_matter ----
def test_excluded_matter():
    bad = GOOD.replace("1.一种测试方法，其特征在于，包括步骤 A。",
                       "1.一种疾病的诊断方法，其特征在于，包括步骤 A。")
    d = find(lint(bad, SETTINGS), "claims.excluded_matter")
    assert len(d) == 1 and d[0]["severity"] == "warning" and "第 25 条" in d[0]["message"]
    assert not find(lint(GOOD, SETTINGS), "claims.excluded_matter")

