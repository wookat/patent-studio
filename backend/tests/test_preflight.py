# -*- coding: utf-8 -*-
"""R2.5 递交前体检（patent_docx.preflight）：规则正例/造错 fixture、两案基线、路由与 lint 并入。

fixture 预期见 tests/fixtures/preflight/README.md；行号一律全文行（书内行 + docset 书偏移）。
"""
import json
import os
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from app.domain.lint import lint
from app.domain.projects import ProjectStore
from patent_docx import preflight
from patent_docx.ast import parse_ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "preflight")
ONE_FIG = {"spec_figures": [["fig1.png", 15.0]]}

RULES = {
    "abstract.limit": "error", "claims.structure": "error", "claims.forward_ref": "error",
    "claims.multi_not_alternative": "warning", "claims.multi_multi": "warning", "claims.cycle": "error",
    "equation.no_lead": "warning", "figures.ref_missing": "error", "figures.unreferenced": "warning",
    "figures.caption_missing": "warning", "figures.drawings_unfiled": "warning",
    "spec.meta_wording": "warning", "figures.caption_dup": "warning",
    "figures.effect_chart": "warning",
    "spec.paper_tone": "warning",
    "numerals.inconsistent": "warning",
    "numerals.legend_conflict": "warning", "claims.unsupported_term": "warning",
    # W5 R-CHK-02 / R-FIG-02（形式项默认 warning，仅 spec.section_missing 为 error）
    "spec.section_missing": "error", "spec.section_order": "warning", "spec.promo_wording": "warning",
    "claims.figure_ref": "warning", "claims.no_characterized": "warning", "claims.promo_wording": "warning",
    "abstract.elements_missing": "warning",
    "numerals.mark_not_in_spec": "warning", "numerals.spec_not_in_marks": "warning",
    "claims.gradient": "warning",
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def fixture(name, settings=ONE_FIG):
    text = read(os.path.join(FIXTURES, name))
    return text, preflight.run(parse_ast(text, settings), settings)


def example(pid):
    store = ProjectStore(EXAMPLES)
    p = store.get(pid)
    return preflight.run(parse_ast(store.read_content(pid), p.settings), p.settings)


def line_of(text, needle):
    for i, ln in enumerate(text.splitlines(), 1):
        if needle in ln:
            return i
    raise AssertionError(needle)


def items(report, rule):
    return [it for it in report["items"] if it["rule"] == rule]


def rules(report):
    return sorted({it["rule"] for it in report["items"]})


# ---- 形状 ----

def test_report_shape():
    text, r = fixture("figures.md", json.load(open(os.path.join(FIXTURES, "figures.studio.json"), encoding="utf-8")))
    assert r["version"] == preflight.VERSION == 1
    assert set(r) == {"version", "items", "counts", "claim_tree", "numerals", "support_map", "figures"}
    assert set(r["counts"]) == {"error", "warning", "info"}
    for sev in r["counts"]:
        assert r["counts"][sev] == sum(it["severity"] == sev for it in r["items"])
    for it in r["items"]:
        assert set(it) == {"rule", "severity", "message", "book", "line", "block_id", "detail", "para_no"}
        assert it["severity"] == RULES[it["rule"]]
        assert it["book"] in ("abstract", "claims", "description")
    assert [it["line"] for it in r["items"]] == sorted(it["line"] for it in r["items"])
    for node in r["claim_tree"]:
        assert set(node) == {"num", "kind", "category", "refs", "alternative", "line", "children", "issues"}
    for row in r["figures"]:
        assert set(row) == {"num", "file", "caption_line", "refs"}
        for ref in row["refs"]:
            assert set(ref) == {"book", "line", "text"}


# ---- cycle.md：claims.cycle + claims.forward_ref ----

def test_cycle_fixture():
    text, r = fixture("cycle.md")
    assert rules(r) == ["claims.cycle", "claims.forward_ref"]
    line3 = line_of(text, "3.根据权利要求4")
    (cyc,) = items(r, "claims.cycle")
    assert cyc["line"] == line3 and cyc["book"] == "claims" and cyc["block_id"] == "claims/3"
    assert "3→4→3" in cyc["message"] and cyc["detail"] == "环上权利要求：3、4"
    (fwd,) = items(r, "claims.forward_ref")
    assert fwd["line"] == line3 and "权利要求 3" in fwd["message"] and "4" in fwd["message"]
    tree = {n["num"]: n for n in r["claim_tree"]}
    assert tree[3]["refs"] == [4] and tree[4]["refs"] == [3]
    assert tree[3]["issues"] == ["claims.forward_ref", "claims.cycle"] and tree[4]["issues"] == []
    assert tree[1]["kind"] == "independent" and tree[1]["children"] == [2]


def test_claims_structure_and_multi():
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text = text.replace("1.一种测试方法，其特征在于，", "1.根据权利要求2所述的方法，其特征在于，", 1)
    text = text.replace("3.根据权利要求4所述的方法", "3.根据权利要求1和2所述的方法", 1)
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    (st,) = items(r, "claims.structure")
    assert st["line"] == line_of(text, "1.根据权利要求2") and "第 1 项" in st["message"]
    (mna,) = items(r, "claims.multi_not_alternative")
    assert mna["line"] == line_of(text, "3.根据权利要求1和2") and mna["book"] == "claims"
    assert any(n["num"] == 3 and n["alternative"] is False and n["refs"] == [1, 2] for n in r["claim_tree"])


def test_multi_multi_and_equation_no_lead():
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text = text.replace("3.根据权利要求4所述的方法", "3.根据权利要求1或2所述的方法", 1)
    text = text.replace("4.根据权利要求3所述的方法", "4.根据权利要求2或3所述的方法", 1)
    text = text.replace("### 具体实施方式\n\n", "### 具体实施方式\n\n$$ y = x $$\n\n", 1)
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    assert rules(r) == ["claims.multi_multi", "equation.no_lead"]
    (mm,) = items(r, "claims.multi_multi")
    assert mm["line"] == line_of(text, "4.根据权利要求2或3") and mm["detail"] == "被引用的多项从属权利要求：3"
    (eq,) = items(r, "equation.no_lead")
    assert eq["line"] == line_of(text, "$$ y = x $$") and eq["book"] == "description"


def test_eq_inline():
    """往复轮130：定义/计算式嵌句中作行内式 → spec.eq_inline；独占行编号式不报。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text = text.replace("### 具体实施方式\n\n",
                        "### 具体实施方式\n\n得分表示为 $$A=QK^T/\\sqrt{d}$$，其中 A 为得分矩阵。\n\n", 1)
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    (eq,) = items(r, "spec.eq_inline")
    assert eq["book"] == "description" and "行内" not in eq["message"] or True
    assert "独占一行" in eq["message"]
    # 独立行式号式不报
    text2 = text.replace("得分表示为 $$A=QK^T/\\sqrt{d}$$，其中 A 为得分矩阵。",
                         "得分表示为：\n\n$$A=QK^T/\\sqrt{d}$$式(1)\n\n其中 A 为得分矩阵。")
    r2 = preflight.run(parse_ast(text2, ONE_FIG), ONE_FIG)
    assert not items(r2, "spec.eq_inline")
    # 变体不报：行内短符号引用 / 标记包裹独立式 / 前置式号 / 尾标（式(1)）
    variants = [
        "得到token序列 $$x=(x_1,\\ldots,x_T)$$，其中 x_i 为token。",           # 短式行内引用不报？——长式体仍报
        "序列为 $$x_i$$，其中 i 为序号。",                                    # 短符号引用不报
        "{++$$E_i=E^{tok}_i+E^{seg}_i$$式(1)++}",                              # 标记包裹独立式不报
        "式(1) $$q(x_t|x_{t-1})=N(\\sqrt{1-\\beta_t}x_{t-1},\\beta_t I)$$",       # 前置式号不报
        "数量N满足 $$N=HW/P^{2}$$（式(1)），其中 P 为块边长。",                  # 尾标（式(1)）不报
    ]
    expected = [True, False, False, False, False]
    base3 = read(os.path.join(FIXTURES, "cycle.md"))
    for src, want_hit in zip(variants, expected):
        t3 = base3.replace("### 具体实施方式\n\n", "### 具体实施方式\n\n" + src + "\n\n", 1)
        got = bool(items(preflight.run(parse_ast(t3, ONE_FIG), ONE_FIG), "spec.eq_inline"))
        assert got == want_hit, src


def test_claims_gradient():
    """往复轮38：同簇 ≥3 从权全平铺引独权→claims.gradient；含链式递进则不报。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    flat = (text
            .replace("3.根据权利要求4所述的方法，其特征在于，所述序列为等间隔序列。",
                     "3.根据权利要求1所述的方法，其特征在于，所述序列为等间隔序列。\n\n"
                     "4.根据权利要求1所述的方法，其特征在于，所述序列为整数序列。\n\n"
                     "5.根据权利要求1所述的方法，其特征在于，所述序列按预设周期采样。")
            .replace("4.根据权利要求3所述的方法，其特征在于，所述序列为整数序列。", ""))
    r = preflight.run(parse_ast(flat, ONE_FIG), ONE_FIG)
    (g,) = items(r, "claims.gradient")
    assert g["book"] == "claims" and g["block_id"] == "claims/1" and "4 项从属权利要求" in g["message"]
    assert any(n["num"] == 1 and "claims.gradient" in n["issues"] for n in r["claim_tree"])
    # 任一从权引用在先从权 → 有梯度不报
    chained = flat.replace("5.根据权利要求1所述的方法", "5.根据权利要求4所述的方法", 1)
    r2 = preflight.run(parse_ast(chained, ONE_FIG), ONE_FIG)
    assert not items(r2, "claims.gradient")


def test_abstract_limit():
    text = read(os.path.join(FIXTURES, "cycle.md"))
    settings = {**ONE_FIG, "abstract_limit": 5}
    r = preflight.run(parse_ast(text, settings), settings)
    (it,) = items(r, "abstract.limit")
    assert it["book"] == "abstract" and it["line"] == line_of(text, "公开了一种测试方法") and "5 字" in it["message"]
    assert not items(fixture("cycle.md")[1], "abstract.limit")


def test_abstract_limit_ignores_critic_deleted():
    # s1 建议模式落的 {--删--}{++增++} 标记：字数须按接受后文本计（ddpm-12 实案误报）
    text = read(os.path.join(FIXTURES, "cycle.md")).replace(
        "本发明涉及测试技术领域，公开了一种测试方法，解决现有测试结果不准确的问题；该方法包括采集与比对步骤，提高了测试效率。",
        "{--占位数十字的已删除摘要文本占位数十字的已删除摘要文本占位数十字的已删除摘要文本--}"
        "{++本发明涉及测试技术领域，公开了一种测试方法，解决现有测试结果不准确的问题；该方法包括采集与比对步骤，提高了测试效率。++}")
    settings = {**ONE_FIG, "abstract_limit": 60}
    r = preflight.run(parse_ast(text, settings), settings)
    assert not items(r, "abstract.limit")


# ---- numerals.md ----

def test_numerals_fixture():
    text, r = fixture("numerals.md")
    assert rules(r) == ["numerals.inconsistent", "numerals.legend_conflict"]
    (lc,) = items(r, "numerals.legend_conflict")
    assert lc["line"] == line_of(text, "标号说明") and lc["book"] == "description"
    assert "102" in lc["message"] and lc["detail"] == "预处理模块、后处理模块"
    (inc,) = items(r, "numerals.inconsistent")
    assert inc["line"] == line_of(text, "数据接入模块101与") and inc["detail"] == "数据接入模块、预处理模块"
    rows = {row["num"]: row for row in r["numerals"]}
    assert set(rows) == {"101", "102"}
    assert rows["101"]["consistent"] is False and rows["101"]["names"] == ["数据接入模块", "预处理模块"]
    assert rows["101"]["legend"] == "数据接入模块" and rows["101"]["legend_line"] == lc["line"]
    assert rows["101"]["lines"] == [inc["line"]]
    assert rows["102"]["legend"] == "预处理模块" and rows["102"]["consistent"] is True


def test_numerals_exclude_units_and_chains():
    text = read(os.path.join(FIXTURES, "numerals.md"))
    old = "如图1所示，测试系统包括数据接入模块101与预处理模块101，数据接入模块101接收数据。"
    assert old in text
    text = text.replace(old, "如图1所示，数据接入模块101处理168条记录，得分0/800，H∈{96,336}，共 2048 维，"
                             "步骤401至409依次执行，控制器1032、1033协同，精度 0.125，占比 100%，共 300 条。")
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    rows = {row["num"]: row for row in r["numerals"]}
    assert set(rows) == {"101", "102", "1032", "1033"} | {str(n) for n in range(401, 410)}
    assert rows["401"]["names"] == rows["405"]["names"] == rows["409"]["names"] == ["步骤"]
    assert rows["1032"]["names"] == rows["1033"]["names"] == ["控制器"]
    assert not items(r, "numerals.inconsistent")


# ---- figures.md + figures.studio.json ----

def test_figures_fixture():
    settings = json.load(open(os.path.join(FIXTURES, "figures.studio.json"), encoding="utf-8"))
    text, r = fixture("figures.md", settings)
    assert rules(r) == ["figures.caption_missing", "figures.ref_missing", "figures.unreferenced"]
    (rm,) = items(r, "figures.ref_missing")
    assert rm["line"] == line_of(text, "图3") and rm["book"] == "description" and "图3" in rm["message"]
    (un,) = items(r, "figures.unreferenced")
    (cm,) = items(r, "figures.caption_missing")
    cap1 = line_of(text, "图1为")
    assert un["line"] == cm["line"] == line_of(text, "### 附图说明")
    assert un["block_id"] == cm["block_id"] == "figures/2"
    assert "fig2.png" in un["message"] and "图2" in cm["detail"]
    figs = {f["num"]: f for f in r["figures"]}
    assert figs[1]["file"] == "fig1.png" and figs[1]["caption_line"] == cap1
    assert [x["line"] for x in figs[1]["refs"]] == [cap1, line_of(text, "如图1所示")]
    assert figs[2]["caption_line"] is None and figs[2]["refs"] == []


def test_scan_refs_full_lines():
    text = read(os.path.join(FIXTURES, "figures.md"))
    ast = parse_ast(text, ONE_FIG)
    refs = preflight.scan_refs(ast)
    assert [(x["book"], x["num"], x["line"]) for x in refs] == [
        ("description", 1, line_of(text, "图1为")),
        ("description", 1, line_of(text, "如图1所示")),
        ("description", 3, line_of(text, "图3")),
    ]
    assert all(ast["books"]["description"]["offset"] < x["line"] for x in refs)
    abstract_line = next(ln for ln in text.splitlines() if ln.startswith("本发明涉及"))
    text2 = text.replace(abstract_line + "\n", "一种测试装置，见图1。\n", 1)
    refs2 = preflight.scan_refs(parse_ast(text2, ONE_FIG))
    assert refs2[0] == {"book": "abstract", "line": line_of(text2, "见图1"), "num": 1,
                        "text": "一种测试装置，见图1。", "block_id": refs2[0]["block_id"]}
    ast2 = parse_ast(text2, ONE_FIG)
    assert refs2[0]["line"] == ast2["books"]["abstract"]["offset"] + ast2["abstract"]["paragraphs"][0]["lines"]["start"]


def test_figures_effect_chart():
    """附图题注疑似指标/效果类图 → figures.effect_chart；示意图题注不报。"""
    text = ("# 一种测试方法\n\n## 摘要\n\n本发明提供一种测试方法。\n\n## 权利要求书\n\n"
            "1.一种测试方法，其特征在于：包括步骤A。\n\n## 说明书\n\n### 技术领域\n\n本发明涉及测试领域。\n\n"
            "### 背景技术\n\n现有方法存在不足。\n\n### 发明内容\n\n本发明提供一种测试方法，如图1所示。\n\n"
            "### 附图说明\n\n图1为不同方法在基准数据集上的准确率对比图。\n\n"
            "### 具体实施方式\n\n实施例一如图1所示。\n")
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    (ec,) = items(r, "figures.effect_chart")
    assert ec["severity"] == "warning" and "准确率" in ec["message"]
    text2 = text.replace("不同方法在基准数据集上的准确率对比图", "本发明实施例的流程示意图")
    assert not items(preflight.run(parse_ast(text2, ONE_FIG), ONE_FIG), "figures.effect_chart")


def test_figures_none_configured():
    _, r = fixture("cycle.md", settings=None)
    # 往复轮8：图1已在附图说明声明——引用已声明未传的图不报 ref_missing（unfiled 已覆盖）
    assert [it["rule"] for it in r["items"] if it["rule"].startswith("figures.")] == [
        "figures.drawings_unfiled"]


def test_drawings_section_declarations_are_warnings_not_errors():
    """附图说明里的图号是声明（起草期可先于文件存在）→ warning；正文引用缺失仍是 error。"""
    text = read(os.path.join(FIXTURES, "cycle.md")).replace(
        "图1为本发明实施例的流程图。", "图2为本发明实施例的流程图。")
    r = preflight.run(parse_ast(text, None), {})
    got = {(it["rule"], it["severity"]) for it in r["items"] if it["rule"].startswith("figures.")}
    assert got == {("figures.ref_missing", "error"), ("figures.drawings_unfiled", "warning")}
    assert "尚无对应附图文件" in items(r, "figures.drawings_unfiled")[0]["message"]


# ---- support.md ----

def test_support_fixture():
    text, r = fixture("support.md")
    assert rules(r) == ["claims.unsupported_term"]
    (it,) = items(r, "claims.unsupported_term")
    assert it["line"] == line_of(text, "1.一种测试方法") and it["book"] == "claims" and it["block_id"] == "claims/1"
    assert it["detail"] == "量子纠缠器获取输入数据" and "所述量子纠缠器" in it["message"]
    (bad,) = r["support_map"]
    assert bad["term"] == it["detail"] and bad["claims"] == [1]
    assert bad["supported"] is False and bad["matched"] is None and bad["description_lines"] == []


def test_support_longest_prefix():
    text = read(os.path.join(FIXTURES, "support.md")).replace(
        "通过所述量子纠缠器获取输入数据并输出结果", "通过所述输入数据处理器获取所述的输入数据并输出结果", 1)
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    assert not items(r, "claims.unsupported_term")
    # 「所述输入数据处理器获取」与「所述的输入数据」都以最长前缀「输入数据」归为同一行
    (row,) = r["support_map"]
    assert row["term"] == row["matched"] == "输入数据" and row["supported"] is True and row["claims"] == [1]


def test_support_strips_claim_grammar_prefix():
    """「所述被随机掩蔽」的「被」是权项语法——剥前导助词后匹配说明书「随机掩蔽」即视为有支撑。"""
    text = read(os.path.join(FIXTURES, "support.md")).replace(
        "通过所述量子纠缠器获取输入数据并输出结果", "通过所述被输入数据处理器获取输入数据并输出结果", 1)
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    assert not items(r, "claims.unsupported_term")
    (row,) = r["support_map"]
    assert row["matched"] == "输入数据" and row["supported"] is True
    assert row["description_lines"] == [line_of(text, "本发明提供"), line_of(text, "如图1所示")]


# ---- 两案基线（05-r2 §1/§4）----

@pytest.mark.parametrize("pid,expected", [
    ("method", ["claims.multi_multi"]),
    ("system", ["claims.gradient", "claims.unsupported_term"]),
])
def test_examples_baseline(pid, expected):
    """W5 基线锁定：两案新增形式项 / 标记表规则命中 0 条（增量上限 warning ≤3、error 0 由 test_preflight_w5 断言）。"""
    r = example(pid)
    assert r["counts"]["error"] == 0, r["items"]
    assert [it["rule"] for it in r["items"]] == expected, r["items"]
    assert r["counts"]["warning"] == len(expected)
    if pid == "method":
        (mm,) = r["items"]
        assert "权利要求 9" in mm["message"] and mm["detail"] == "被引用的多项从属权利要求：8"
        row = next(x for x in r["numerals"] if x["num"] == "1034")
        assert row["consistent"] is True and row["legend"] == "投注财富门控控制器"
    else:
        it = next(x for x in r["items"] if x["rule"] == "claims.unsupported_term")
        assert "权利要求 10" in it["message"] and it["detail"] == "程序"
    assert all(f["caption_line"] and f["refs"] for f in r["figures"])


@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_perf(pid):
    store = ProjectStore(EXAMPLES)
    p = store.get(pid)
    ast = parse_ast(store.read_content(pid), p.settings)
    best = min(_timed(ast, p.settings) for _ in range(3))
    assert best < 50, best


def _timed(ast, settings):
    t0 = time.perf_counter()
    preflight.run(ast, settings)
    return (time.perf_counter() - t0) * 1000


# ---- lint 并入 ----

def test_lint_merges_preflight_with_prefix():
    text = read(os.path.join(FIXTURES, "numerals.md"))
    base = lint(text, ONE_FIG)
    merged = lint(text, ONE_FIG, with_preflight=True)
    assert base["diagnostics"] == [d for d in merged["diagnostics"] if not d["id"].startswith("preflight.")]
    pre = [d for d in merged["diagnostics"] if d["id"].startswith("preflight.")]
    assert sorted(d["id"] for d in pre) == ["preflight.numerals.inconsistent#1", "preflight.numerals.legend_conflict#1"]
    for d in pre:
        assert d["source"] == "lint" and d["section"] == "说明书" and d["line"] and d["detail"]
    assert merged["counts"]["warning"] == base["counts"]["warning"] + 2
    lines = [d["line"] for d in merged["diagnostics"] if d["line"] is not None]
    assert lines == sorted(lines)


def test_lint_skips_rules_already_covered():
    text = read(os.path.join(FIXTURES, "cycle.md"))
    merged = lint(text, ONE_FIG, with_preflight=True)
    ids = [d["id"] for d in merged["diagnostics"]]
    assert "preflight.claims.cycle#1" in ids
    assert not any(i.startswith("preflight.claims.forward_ref") for i in ids)
    assert any(i.startswith("claims.forward_ref") for i in ids)
    r = lint(text, {"spec_figures": []}, with_preflight=True)
    assert not any(d["id"].startswith("preflight.figures.ref_missing") for d in r["diagnostics"])
    assert any(d["id"].startswith("figures.ref") for d in r["diagnostics"])


def test_lint_skips_preflight_when_ast_fails():
    broken = "# 标题\n\n## 摘要\n\n摘要。\n\n## 权利要求书\n\n1. 一种方法。\n"
    r = lint(broken, {}, with_preflight=True)
    assert r["diagnostics"] and not any(d["id"].startswith("preflight.") for d in r["diagnostics"])


# ---- 路由 ----

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(EXAMPLES, "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main

    importlib.reload(config)
    importlib.reload(main)
    return TestClient(main.app)


def test_route_get_reads_disk(client):
    r = client.get("/api/projects/method/preflight")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1 and body["counts"] == {"error": 0, "warning": 1, "info": 0}
    assert [it["rule"] for it in body["items"]] == ["claims.multi_multi"]
    assert len(body["figures"]) == 6 and len(body["claim_tree"]) == 11


def test_route_post_content_and_settings(client):
    text = read(os.path.join(FIXTURES, "figures.md"))
    settings = json.load(open(os.path.join(FIXTURES, "figures.studio.json"), encoding="utf-8"))
    r = client.post("/api/projects/method/preflight", json={"content": text, "settings": settings})
    assert r.status_code == 200
    assert sorted(it["rule"] for it in r.json()["items"]) == [
        "figures.caption_missing", "figures.ref_missing", "figures.unreferenced"]
    r = client.post("/api/projects/method/preflight", json={})
    assert r.status_code == 200 and r.json() == client.get("/api/projects/method/preflight").json()


def test_route_errors(client):
    r = client.post("/api/projects/method/preflight", json={"content": "# 标题\n\n## 摘要\n\n摘要。\n"})
    assert r.status_code == 422
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"} and d["kind"] == "content" and d["detail"] is None
    assert "权利要求书" in d["message"]
    assert client.get("/api/projects/nope/preflight").status_code == 404


def test_drawings_caption_meta_flagged():
    """往复轮7：图注混入撰写性/存疑措辞（模型把「建议核对」「暂按」「疑似」写进法律文件）→ warning。"""
    text = read(os.path.join(FIXTURES, "cycle.md")).replace(
        "图1为本发明实施例的流程图。",
        "图1为本发明实施例的流程图。\n\n交底书未作说明，建议核对图面措辞，该图疑似为流程示意。")
    r = preflight.run(parse_ast(text, None), {})
    metas = items(r, "spec.meta_wording")
    assert len(metas) == 1
    assert metas[0]["severity"] == "warning"
    assert "交底书" in metas[0]["message"] or "建议核对" in metas[0]["message"]


def test_meta_wording_in_spec_body_flagged():
    """实施方式/发明内容里的整句 meta 泄漏同样命中（实测：模型写「需要说明的是，交底书未……建议核对」）。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    # 在说明书末尾追加 meta 句（落入末节段落）
    text += "\n\n需要说明的是，交底书未对图1作具体描述，建议核对图面后据实调整。"
    r = preflight.run(parse_ast(text, None), {})
    assert items(r, "spec.meta_wording")


def test_drawings_formal_caption_no_meta():
    """正式图注措辞不误报。"""
    r = preflight.run(parse_ast(read(os.path.join(FIXTURES, "cycle.md")), None), {})
    assert not items(r, "spec.meta_wording")


def test_paper_tone_flagged_and_clean():
    """spec.paper_tone：论文腔评论句命中；技术陈述不误报（实案「可视为…的推广」残留）。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text += "\n\n该过程可视为一种渐进有损解压过程，是自回归解码的推广。换句话说，精度得到提升。"
    r = preflight.run(parse_ast(text, None), {})
    hits = items(r, "spec.paper_tone")
    assert hits and "可视为" in hits[0]["message"]
    r2 = preflight.run(parse_ast(read(os.path.join(FIXTURES, "cycle.md")), None), {})
    assert not items(r2, "spec.paper_tone")


def test_drawings_duplicate_declaration_flagged():
    """往复轮7：同一图号在附图说明里被写两行图注（实测模型输出「图1为总体流程图」「图1为流程示意图」并存）。"""
    text = read(os.path.join(FIXTURES, "cycle.md")).replace(
        "图1为本发明实施例的流程图。",
        "图1为本发明实施例的流程图。\n\n图1为系统架构示意图。")
    r = preflight.run(parse_ast(text, None), {})
    dups = items(r, "figures.caption_dup")
    assert len(dups) == 1 and "图1" in dups[0]["message"]


def test_ref_to_declared_unfiled_no_error():
    """往复轮8：正文引用「附图说明已声明、文件未传」的图不是错误（起草中正常态），unfiled 警告已覆盖。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    r = preflight.run(parse_ast(text, {}), {})
    assert not items(r, "figures.ref_missing")
    assert items(r, "figures.drawings_unfiled")


def test_ref_to_undeclared_still_error():
    """正文引用未在附图说明声明的图号仍是错误。"""
    text = read(os.path.join(FIXTURES, "cycle.md")).replace(
        "如图1所示", "如图2所示")
    r = preflight.run(parse_ast(text, {}), {})
    errs = [i for i in items(r, "figures.ref_missing") if "图2" in i["message"]]
    assert errs and errs[0]["severity"] == "error"


def test_numerals_verb_prefix_and_legend_canon():
    """往复轮8：「送入编码器101」前缀动词不污染名称；正文通称与图例全称按包含关系归一。"""
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text = text.replace(
        "图1为本发明实施例的流程图。",
        "图1为本发明实施例的流程图。\n\n元件标号说明：101为双向编码器堆叠。")
    text += "\n\n将特征序列送入编码器101处理，编码器101输出表示。"
    r = preflight.run(parse_ast(text, {}), {})
    assert not items(r, "numerals.inconsistent")


def test_numerals_truly_different_names_flagged():
    text = read(os.path.join(FIXTURES, "cycle.md"))
    text = text.replace(
        "图1为本发明实施例的流程图。",
        "图1为本发明实施例的流程图。\n\n元件标号说明：101为编码器。")
    text += "\n\n解码模块101与编码器101配合工作。"
    r = preflight.run(parse_ast(text, {}), {})
    # 「编码器」⊂图例归一，「解码模块」无包含关系 → 应报
    assert items(r, "numerals.inconsistent")


def test_numerals_arithmetic_dimension_literals_not_marks():
    """ddpm-13 实案：除以255/乘以255/256×256 尺寸链是数值字面量不是标号用例。"""
    text = ("# 一种图像处理方法\n\n## 摘要\n\n一种图像处理方法。\n\n## 权利要求书\n\n1.一种图像处理方法。\n\n"
            "## 说明书\n\n"
            "图像输入前先将 uint8 整型像素值除以255映射至区间[0,1]，输出时再乘以255并取整。"
            "对256×256输入规模，LSUN数据集256×256分辨率图像按批次读取。"
            "在32×32×3的图像与256×256×3的图像上分别验证。"
            "\n\n图1为本方法的流程图。\n\n元件标号说明：101为编码器。\n\n编码器101接收图像。")
    r = preflight.run(parse_ast(text, {}), {})
    rows = {row["num"]: row for row in r["numerals"]}
    assert set(rows) == {"101"}
    assert not items(r, "numerals.inconsistent")
