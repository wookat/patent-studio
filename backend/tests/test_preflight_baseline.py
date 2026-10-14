# -*- coding: utf-8 -*-
"""W5 preflight-backend（docs/plan/21-w5-spec.md §2.1 R-CHK-02 / R-FIG-02；§1.3 A3 形式项默认 warning）：
新增 code 的正反夹具（fixtures/preflight/w5/）、para_no 定位、studio.json preflight.disabled[]、
两案基线增量（warning ≤3、error 0）、figures.md marks 表 ↔ 说明书正文一致性。"""

import json
import os

import pytest
import test_auth

from app.domain.projects import ProjectStore, normalize_settings
from patent_studio.kernel import figures_md, preflight
from patent_studio.kernel.ast import parse_ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
W5 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "preflight", "w5")
client = test_auth.client  # pytest fixture
ONE_FIG = {"spec_figures": [["fig1.png", 15.0]]}
NO_FIG = {"spec_figures": []}

NEW_RULES = {
    "spec.section_missing": "error",
    "spec.section_order": "warning",
    "spec.promo_wording": "warning",
    "claims.figure_ref": "warning",
    "claims.no_characterized": "warning",
    "claims.promo_wording": "warning",
    "abstract.elements_missing": "warning",
    "numerals.mark_not_in_spec": "warning",
    "numerals.spec_not_in_marks": "warning",
}
# 基线锁定前的两案旧规则命中（test_preflight.test_examples_baseline 逐条断言）
# b12a541 换语料后重录：method 3 条 figures.caption_missing；
# system 10 条旧规则（caption_missing+numerals.inconsistent）+ 1 条新规则命中
OLD_BASELINE = {"method": 3, "system": 10}
EXPECTED_NEW = {"method": [], "system": ["abstract.elements_missing"]}


def read(name):
    with open(os.path.join(W5, name), encoding="utf-8") as f:
        return f.read()


def run(name, settings=ONE_FIG):
    text = read(name)
    return text, preflight.run(parse_ast(text, settings), settings)


def run_marks(figures_name, settings_extra=None):
    text = read("marks.md")
    doc = figures_md.parse(read(figures_name))
    assert doc.bad_lines == []
    settings = {**doc.legacy_view(), **(settings_extra or {})}
    return text, doc, preflight.run(parse_ast(text, settings, figures=doc), settings, figures=doc)


def line_of(text, needle):
    for i, ln in enumerate(text.splitlines(), 1):
        if needle in ln:
            return i
    raise AssertionError(needle)


def items(report, rule):
    return [it for it in report["items"] if it["rule"] == rule]


def rules(report):
    return sorted({it["rule"] for it in report["items"]})


# ---- 级别：形式项默认 warning，仅 spec.section_missing 为 error ----


def test_new_rule_levels():
    all_items = run("form_bad.md")[1]["items"] + run("form_missing.md", NO_FIG)[1]["items"]
    all_items += run_marks("marks.figures.md")[2]["items"]
    seen = {it["rule"]: it["severity"] for it in all_items}
    assert seen == NEW_RULES
    for it in all_items:
        assert set(it) == {"rule", "severity", "message", "book", "line", "block_id", "detail", "para_no"}
        assert it["block_id"] and it["line"]


# ---- form_bad.md：六条形式项各命中一次 ----


def test_form_bad_fixture():
    text, r = run("form_bad.md")
    assert r["counts"] == {"error": 0, "warning": 6, "info": 0}
    assert rules(r) == [
        "abstract.elements_missing",
        "claims.figure_ref",
        "claims.no_characterized",
        "claims.promo_wording",
        "spec.promo_wording",
        "spec.section_order",
    ]
    (ab,) = items(r, "abstract.elements_missing")
    assert ab["book"] == "abstract" and ab["line"] == line_of(text, "一种最佳的测试装置")
    assert ab["detail"] == "技术领域、技术问题、有益效果" and "技术方案" not in ab["detail"]
    assert ab["block_id"] == "abstract/p1" and ab["para_no"] is None

    (fr,) = items(r, "claims.figure_ref")
    assert fr["line"] == line_of(text, "1.一种测试装置") and fr["block_id"] == "claims/1" and fr["detail"] == "如图"
    (nc,) = items(r, "claims.no_characterized")
    assert nc["line"] == fr["line"] and "独立权利要求 1" in nc["message"]
    (cp,) = items(r, "claims.promo_wording")
    assert cp["line"] == line_of(text, "2.根据权利要求1") and cp["detail"] == "最先进"
    # 权 2 有「其特征在于」但是从权：不报 no_characterized；权 3 独权且有「其特征在于」：不报
    assert {c["num"] for c in r["claim_tree"] if "claims.no_characterized" in c["issues"]} == {1}

    (sp,) = items(r, "spec.promo_wording")
    assert sp["line"] == line_of(text, "国际领先") and sp["para_no"] == 2 and sp["detail"] == "国际领先、独一无二"
    assert sp["block_id"].startswith("description/发明内容/p")
    (so,) = items(r, "spec.section_order")
    assert so["line"] == line_of(text, "### 背景技术") and so["block_id"] == "description/背景技术"
    assert "「背景技术」出现在「发明内容」之后" in so["message"]
    # 「最佳实施」是惯用语：具体实施方式那段不报
    assert not [it for it in items(r, "spec.promo_wording") if it["para_no"] == 5]


def test_form_missing_is_error_and_drawings_only_required_with_figures():
    text, r = run("form_missing.md", NO_FIG)
    assert r["counts"] == {"error": 1, "warning": 0, "info": 0}
    (it,) = items(r, "spec.section_missing")
    assert it["severity"] == "error" and it["detail"] == "背景技术"
    assert it["line"] == line_of(text, "### 技术领域") and it["block_id"] == "description/技术领域"
    # 有附图时附图说明也是必需段
    _, r2 = run("form_missing.md", ONE_FIG)
    (it2,) = items(r2, "spec.section_missing")
    assert it2["detail"] == "背景技术、附图说明"


def test_form_ok_has_no_new_codes():
    _, r = run("form_ok.md")
    assert not set(rules(r)) & set(NEW_RULES), r["items"]
    assert r["counts"] == {"error": 0, "warning": 0, "info": 0}


@pytest.mark.parametrize(
    "phrase,hit",
    [
        ("最佳实施例", False),
        ("最佳模式", False),
        ("最佳方案", True),
        ("最先进", True),
        ("遥遥领先", True),
        ("常规方案", False),
    ],
)
def test_promo_wording_table(phrase, hit):
    text = read("form_ok.md").replace("采用最佳实施模式进行装配", f"采用{phrase}进行装配")
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    assert bool(items(r, "spec.promo_wording")) is hit, phrase


@pytest.mark.parametrize(
    "phrase,hit",
    [("如图1所示", True), ("参见附图", True), ("见附图1", True), ("如附图2所示", True), ("所述探头", False)],
)
def test_claims_figure_ref_table(phrase, hit):
    text = read("form_ok.md").replace("所述探头为接触式探头", f"{phrase}，所述探头为接触式探头")
    r = preflight.run(parse_ast(text, ONE_FIG), ONE_FIG)
    assert bool(items(r, "claims.figure_ref")) is hit, phrase


# ---- studio.json preflight.disabled[] ----


def test_disabled_rules_are_skipped():
    settings = {**ONE_FIG, "preflight": {"disabled": ["claims.no_characterized", "spec.promo_wording"]}}
    text, r = run("form_bad.md", settings)
    assert rules(r) == ["abstract.elements_missing", "claims.figure_ref", "claims.promo_wording", "spec.section_order"]
    assert r["counts"]["warning"] == 4
    # 旧规则也可关
    settings = {**ONE_FIG, "preflight": {"disabled": ["abstract.elements_missing", "claims.figure_ref"]}}
    assert "claims.figure_ref" not in rules(run("form_bad.md", settings)[1])
    assert preflight.disabled_rules({}) == frozenset() and preflight.disabled_rules(None) == frozenset()
    assert preflight.disabled_rules({"preflight": {"disabled": None}}) == frozenset()


def test_normalize_settings_keeps_preflight_block():
    """studio.json 里的 preflight 块要能到 preflight.run（projects.normalize_settings 不得丢掉）。"""
    s = normalize_settings({"preflight": {"disabled": ["spec.promo_wording"]}}, ["fig1.png"])
    assert s["preflight"] == {"disabled": ["spec.promo_wording"]}
    assert "preflight" not in normalize_settings({}, ["fig1.png"])
    assert "preflight" not in normalize_settings({"preflight": "x"}, ["fig1.png"])


def test_put_settings_persists_preflight_disabled(tmp_path, monkeypatch):
    """R66-02：PUT /settings 的 SettingsIn 必须透传 preflight——否则体检规则开关写入后不落盘（刷新复位）。"""
    import importlib
    import shutil

    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(EXAMPLES, "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*", "docs", "project.json"),
    )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    from app import config, main
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(main)
    from fastapi.testclient import TestClient

    c = TestClient(main.app)
    r = c.put("/api/projects/method/settings", json={"preflight": {"disabled": ["spec.promo_wording"]}})
    assert r.status_code == 200, r.text
    assert r.json()["settings"]["preflight"] == {"disabled": ["spec.promo_wording"]}
    # 硬刷新口径：重读 studio.json
    saved = json.loads((projects / "method" / "studio.json").read_text(encoding="utf-8"))
    assert saved["preflight"] == {"disabled": ["spec.promo_wording"]}
    # 形态校验：disabled 非字符串数组 → 422
    r = c.put("/api/projects/method/settings", json={"preflight": {"disabled": "spec.promo_wording"}})
    assert r.status_code == 422
    r = c.put("/api/projects/method/settings", json={"preflight": {"disabled": [1, 2]}})
    assert r.status_code == 422


# ---- 两案基线增量：新增 warning ≤3、error 0 ----


@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_baseline_delta(pid):
    store = ProjectStore(EXAMPLES)
    p = store.get(pid)
    doc = store.load_figures(p.dir)
    ast = parse_ast(store.read_content(pid), p.settings, figures=doc)
    r = preflight.run(ast, p.settings, figs=store.list_figs(p.dir), figures=doc)
    new = [it for it in r["items"] if it["rule"] in NEW_RULES]
    assert r["counts"]["error"] == 0, r["items"]
    assert len(new) <= 3, new
    assert r["counts"]["warning"] - len(new) == OLD_BASELINE[pid]
    # 新语料下 system 摘要确实缺「技术领域/技术问题」表述 → abstract.elements_missing 命中一次；
    # 其余新规则命中须显式承认
    assert [it["rule"] for it in new] == EXPECTED_NEW[pid], new


# ---- figures.md marks 表 ↔ 说明书正文（R-FIG-02） ----


def test_marks_fixture_positive():
    text, doc, r = run_marks("marks.figures.md")
    assert doc.spec[0].marks == {"101": "数据接入模块", "102": "预处理模块", "103": "输出模块"}
    assert doc.spec[1].marks == {"201": "获取数据", "202": "输出结果"}
    assert rules(r) == ["numerals.mark_not_in_spec", "numerals.spec_not_in_marks"]
    (mn,) = items(r, "numerals.mark_not_in_spec")
    body = line_of(text, "如图1所示，测试系统包括")
    assert mn["line"] == body and mn["para_no"] == 6 and mn["book"] == "description"
    assert "图1" in mn["message"] and "103（输出模块）" in mn["message"] and "第 6 段" in mn["message"]
    assert mn["detail"] == "docs/figures.md 图1 marks: 103 输出模块"
    (sn,) = items(r, "numerals.spec_not_in_marks")
    assert sn["line"] == body and sn["para_no"] == 6 and sn["detail"] == "104"
    assert "第 6 段" in sn["message"] and "图1" in sn["message"] and "104（显示模块）" in sn["message"]
    # 图2 表与正文（步骤201/202）一致：不报
    assert not [it for it in r["items"] if "图2" in it["message"]]


def test_marks_fixture_negative_and_legacy_paths():
    text, doc, r = run_marks("marks_ok.figures.md")
    assert doc.spec[1].marks == {}
    assert r["counts"] == {"error": 0, "warning": 0, "info": 0}, r["items"]
    # 不传 figures（旧调用路径 / 无 figures.md）：不查标记表，其余不变
    settings = doc.legacy_view()
    r2 = preflight.run(parse_ast(text, settings), settings)
    assert r2["counts"] == {"error": 0, "warning": 0, "info": 0}
    doc_bad = figures_md.parse(read("marks.figures.md"))
    r3 = preflight.run(parse_ast(text, settings, figures=doc_bad), settings)
    assert not [it for it in r3["items"] if it["rule"].startswith("numerals.mark") or it["rule"].endswith("in_marks")]


def test_marks_disabled_and_legend_counts_as_used():
    text, doc, r = run_marks(
        "marks.figures.md", {"preflight": {"disabled": ["numerals.mark_not_in_spec", "numerals.spec_not_in_marks"]}}
    )
    assert r["counts"]["warning"] == 0
    # 标号说明段里出现的 103 视为「正文用到」
    text2 = text.replace("如图2所示", "标号说明：103为输出模块。\n\n如图2所示")
    settings = doc.legacy_view()
    r2 = preflight.run(parse_ast(text2, settings, figures=doc), settings, figures=doc)
    assert not items(r2, "numerals.mark_not_in_spec") and len(items(r2, "numerals.spec_not_in_marks")) == 1


def test_marks_anchor_falls_back_to_caption_when_never_referenced_in_body():
    text, doc, _ = run_marks("marks.figures.md")
    text2 = text.replace(
        "如图1所示，测试系统包括数据接入模块101、预处理模块102与显示模块104。", "测试系统包括数据接入模块101。"
    )
    settings = doc.legacy_view()
    r = preflight.run(parse_ast(text2, settings, figures=doc), settings, figures=doc)
    missing = {it["detail"].split(": ")[1].split(" ")[0]: it for it in items(r, "numerals.mark_not_in_spec")}
    assert set(missing) == {"102", "103"}
    for it in missing.values():
        assert it["line"] == line_of(text2, "图1为本发明实施例的系统框图") and it["para_no"] == 4
        assert "第 4 段" in it["message"]


def test_example_projects_figures_have_no_marks_and_report_unchanged_via_routes(client):
    """examples 无 marks：/preflight 路由（传 figures）与直接 run 报告一致。"""
    c, _ = client
    r = c.get("/api/projects/method/preflight")
    assert r.status_code == 200, r.text
    d = r.json()
    assert [it["rule"] for it in d["items"]] == ["figures.caption_missing"] * 3
    assert all("para_no" in it for it in d["items"])


def test_fixture_manifest_lists_all_new_files():
    names = set(os.listdir(W5))
    assert names == {
        "form_bad.md",
        "form_missing.md",
        "form_ok.md",
        "marks.md",
        "marks.figures.md",
        "marks_ok.figures.md",
    }
    with open(os.path.join(W5, os.pardir, "README.md"), encoding="utf-8") as f:
        readme = f.read()
    for n in names:
        assert n in readme, n
    json.dumps(run("form_bad.md")[1])  # 报告可 JSON 序列化


SPEC_NUM = """# 测试发明

## 摘要
本发明公开一种测试方法。

## 权利要求书
1.一种测试方法，其特征在于，包括步骤A。

## 说明书

### 技术领域
本发明涉及测试领域。

### 背景技术
现有技术存在不足。

### 发明内容
本发明提供一种测试方法，转移核如式(1)所示：

$$q(x)=Ax$$ 式(1)

又损失如式(1)所示：

$$L=By$$ 式(1)

### 附图说明
图1为测试系统框图。
元件标号说明：101为调度模块；102为处理模块。

### 具体实施方式
调度模块102按式(1)工作——此号与声明冲突（应为101）。
如表1所示配置参数——但全文无表1题注。
"""


def test_spec_numbering_eq_dup_tab_dangle_mark_conflict():
    """往复轮121：精读发现的编号一致性三缺——式号一号两式、表号悬空、标号冲突。"""
    settings = NO_FIG
    r = preflight.run(parse_ast(SPEC_NUM, settings), settings)
    eqs = [it for it in r["items"] if it["rule"] == "spec.eq_dup"]
    assert any("式(1)" in it["message"] for it in eqs) and all(it["severity"] == "error" for it in eqs)
    tabs = [it for it in r["items"] if it["rule"] == "spec.tab_dangle"]
    assert len(tabs) == 1 and "表1" in tabs[0]["message"] and tabs[0]["severity"] == "warning"
    marks = [it for it in r["items"] if it["rule"] == "spec.mark_conflict"]
    assert any("调度模块102" in it["message"] and "101" in it["message"] for it in marks)


def test_spec_numbering_clean_doc_no_hits():
    """同式号指同式（重申）、题注-引用配齐、标号一致——零命中。"""
    text = """# 测试发明

## 摘要
本发明公开一种测试方法。

## 权利要求书
1.一种测试方法，其特征在于，包括步骤A。

## 说明书

### 技术领域
本发明涉及测试领域。

### 背景技术
现有技术存在不足。

### 发明内容
本发明提供一种测试方法，如式(1)所示：

$$q(x)=Ax$$ 式(1)

### 附图说明
图1为测试系统框图。
元件标号说明：101为调度模块。

### 具体实施方式
调度模块101按式(1)工作。
表1 参数配置

| 参数 | 值 |
| 学习率 | 0.1 |

参见表1再次确认。
"""
    r = preflight.run(parse_ast(text, NO_FIG), NO_FIG)
    hits = [it for it in r["items"] if it["rule"] in ("spec.eq_dup", "spec.tab_dangle", "spec.mark_conflict")]
    assert hits == [], hits


def test_legal_rhythm_impl_section():
    """style.legal_rhythm：实施方式无「其中」限定句且无「可以」可选表达时告警。"""
    impl = "步骤S101对输入执行处理。\n" * 30
    text = f"""# 发明名称

一种测试方法

## 摘要
测试摘要。

## 权利要求书

1.一种测试方法，其特征在于，包括步骤S101。

## 说明书

### 具体实施方式
{impl}"""
    r = preflight.run(parse_ast(text, NO_FIG), NO_FIG)
    hits = [it for it in r["items"] if it["rule"] == "style.legal_rhythm"]
    assert hits and hits[0]["severity"] == "warning"

    # 授权件节奏（其中 承句 + 可以 可选表达）不告警
    ok_impl = ("其中，所述预处理单元对输入执行归一化，可以包括去噪步骤；具体地，输出维度与输入一致。\n") * 15
    text_ok = text.replace(impl, ok_impl)
    r2 = preflight.run(parse_ast(text_ok, NO_FIG), NO_FIG)
    assert not [it for it in r2["items"] if it["rule"] == "style.legal_rhythm"]
