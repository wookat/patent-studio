# -*- coding: utf-8 -*-
"""R1 B2-ast：块 AST 解析器 + /ast 路由。

golden 快照：tests/golden/ast_{method,system}.json；有意改动 AST 输出时
`UPDATE_GOLDEN=1 uv run pytest tests/test_ast.py -q` 重新生成并 review diff。
"""

import json
import os
import re
import shutil
import time
import zipfile

import jsonschema
import pytest
from fastapi.testclient import TestClient
from lxml import etree

from app.domain.projects import ProjectStore
from patent_studio.kernel import figures_md
from patent_studio.kernel.ast import AstError, _split_books, _walk_description, load_schema, parse_ast
from patent_studio.kernel.builder import build_patent_ex
from patent_studio.kernel.cnipa_xml import _Exporter
from patent_studio.kernel.content import parse_md
from patent_studio.kernel.omml import MML_NS, to_mathml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")
CASES = ("method", "system")
VALIDATOR = jsonschema.Draft202012Validator(load_schema())


def _case(pid):
    store = ProjectStore(EXAMPLES)
    return store, store.read_content(pid), store.load_settings(pid)


def _figures(pid):
    """docs/figures.md 真源（W4-C）：/ast 与 golden 都按它生成 figures[]（含 alt）。"""
    return figures_md.read(os.path.join(EXAMPLES, pid))


def _spec_of(text):
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    _t, books = _split_books(lines)
    return [it for it, _a, _b in _walk_description(books["description"][1])]


def _numbers(ast):
    """AST 说明书带段号块的段号序列（表格含 表题后置/表注 编号）。"""
    out = []
    for b in ast["description"]:
        if b["kind"] in ("paragraph", "code"):
            out.append(b["para_no"])
        elif b["kind"] == "table":
            out.append(b["para_no"])
            if b["caption_after"]:
                out.append(b["caption_after"]["para_no"])
            if b["note"]:
                out.append(b["note"]["para_no"])
    return out


# ---------------- golden + schema ----------------


@pytest.mark.parametrize("pid", CASES)
def test_golden_snapshot_and_schema(pid):
    _s, text, settings = _case(pid)
    ast = parse_ast(text, settings, figures=_figures(pid))
    VALIDATOR.validate(ast)
    path = os.path.join(GOLDEN, f"ast_{pid}.json")
    if os.environ.get("UPDATE_GOLDEN"):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ast, f, ensure_ascii=False, indent=1)
            f.write("\n")
    with open(path, encoding="utf-8") as f:
        assert ast == json.load(f)


@pytest.mark.parametrize("pid", CASES)
def test_ids_unique_and_lines_within_books(pid):
    _s, text, settings = _case(pid)
    ast = parse_ast(text, settings)
    blocks = [ast["abstract"], *ast["abstract"]["paragraphs"], *ast["claims"], *ast["description"], *ast["figures"]]
    ids = [b["id"] for b in blocks] + [s["id"] for c in ast["claims"] for s in c["segments"]]
    assert len(ids) == len(set(ids))
    total = len(text.split("\n"))
    for book, blist in (("claims", ast["claims"]), ("description", ast["description"])):
        info = ast["books"][book]
        for b in blist:
            assert 1 <= b["lines"]["start"] <= b["lines"]["end"] <= info["length"]
            assert info["offset"] + b["lines"]["end"] <= total
    # 行区间指回源码：章节/小节行就是 ###/#### 行，权项首段行以其编号开头
    lines = text.split("\n")
    for b in ast["description"]:
        full = ast["books"]["description"]["offset"] + b["lines"]["start"] - 1
        if b["kind"] == "section":
            assert lines[full] == "### " + b["title"]
        elif b["kind"] == "subsection":
            assert lines[full] == "#### " + b["title"]
    for c in ast["claims"]:
        full = ast["books"]["claims"]["offset"] + c["lines"]["start"] - 1
        assert lines[full].startswith(c["num_written"])


@pytest.mark.parametrize("pid", CASES)
def test_prep_sample_fixture_is_subset(pid):
    """prep 手写样例（tests/fixtures）中的块必须与真解析结果一致（mathml 样例为 null，不比）。"""
    _s, text, settings = _case(pid)
    ast = parse_ast(text, settings, figures=_figures(pid))
    with open(os.path.join(os.path.dirname(GOLDEN), "fixtures", f"ast_sample_{pid}.json"), encoding="utf-8") as f:
        sample = json.load(f)
    assert sample["title"] == ast["title"] and sample["books"] == ast["books"]
    assert sample["abstract"] == ast["abstract"]
    by_id = {b["id"]: b for sec in ("claims", "description", "figures") for b in ast[sec]}

    def strip(b):
        b = json.loads(json.dumps(b))
        b.pop("mathml", None)
        for s in b.get("segments", []):
            s.pop("mathml")
        return b

    for sec in ("claims", "description", "figures"):
        for sb in sample[sec]:
            assert strip(by_id[sb["id"]]) == strip(sb), sb["id"]


# ---------------- 与内核语义一致 ----------------


@pytest.mark.parametrize("pid", CASES)
def test_description_spec_equals_parse_md(pid):
    _s, text, _st = _case(pid)
    assert _spec_of(text) == parse_md(text)[3]


def test_description_spec_equals_parse_md_edge_cases():
    text = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X，其特征在于，Y。\n\n## 说明书\n\n"
        "### 技术领域\n段一\n段二\n\n#### 小节\n$$a/b$$ （1）\n\n表1 标题\n<!-- 表格: 三线 表注=注文 -->\n"
        "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n注：直接表注\n<!-- 表格: 表题后置=后置题 -->\n| C |\n| 3 |\n"
        "注：第二表注\n```\ncode 1\n\n  code 2\n```\n"
        "尾段\n\n"
    )
    assert _spec_of(text) == parse_md(text)[3]
    ast = parse_ast(text)
    VALIDATOR.validate(ast)
    kinds = [b["kind"] for b in ast["description"]]
    assert kinds == [
        "section",
        "paragraph",
        "paragraph",
        "subsection",
        "equation",
        "paragraph",
        "table",
        "table",
        "code",
        "paragraph",
    ]
    d = ast["description"]
    assert d[5]["role"] == "table-caption" and d[5]["para_no"] == 3
    t1, t2 = d[6], d[7]
    # 表注只来自 "注：" 行（含前缀，与 parse_md 一致）；隔一个空行仍归前一张表，区间延伸到表注行
    assert t1["options"]["three_line"] and t1["note"] == {"text": "注：直接表注", "para_no": 5} and t1["para_no"] == 4
    assert t1["rows"] == [["A", "B"], ["1", "2"]] and t1["lines"] == {"start": 10, "end": 15}
    assert t2["caption_after"] == {"text": "后置题", "para_no": 7}
    assert t2["note"] == {"text": "注：第二表注", "para_no": 8}
    assert t2["para_no"] == 6 and t2["lines"] == {"start": 16, "end": 19}
    assert d[8]["code_lines"] == ["code 1", "", "  code 2"] and d[8]["para_no"] == 9
    assert d[8]["lines"] == {"start": 20, "end": 24}
    assert d[9]["text"] == "尾段" and d[9]["para_no"] == 10
    assert [b["id"] for b in d] == [
        "description/技术领域",
        "description/技术领域/p0001",
        "description/技术领域/p0002",
        "description/技术领域/小节",
        "description/技术领域/小节/eq1",
        "description/技术领域/小节/p0003",
        "description/技术领域/小节/p0004",
        "description/技术领域/小节/p0006",
        "description/技术领域/小节/p0009",
        "description/技术领域/小节/p0010",
    ]
    assert d[4]["anchor_para_no"] == 2 and d[4]["label"] == "（1）" and d[4]["source"] == "a/b"
    assert ast["books"]["description"]["length"] == 26
    assert ast["figures"] == [] and ast["abstract"]["figure_num"] is None


def test_inline_figure_block():
    """W18：说明书 `![alt](figs/x){width=N}` 独立行 → kind=figure 块，占段号不占图号。"""
    text = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n"
        "### 技术领域\n段一\n![图1 系统框图](figs/fig1.emf){width=12.5}\n段二\n\n#### 小节\n段三\n"
    )
    spec = parse_md(text)[3]
    assert spec == [("h", "技术领域"), "段一", ("f", "fig1.emf", 12.5, "图1 系统框图"), "段二", ("s", "小节"), "段三"]
    ast = parse_ast(text)
    VALIDATOR.validate(ast)
    d = ast["description"]
    assert [b["kind"] for b in d] == ["section", "paragraph", "figure", "paragraph", "subsection", "paragraph"]
    fig = d[2]
    assert fig["file"] == "fig1.emf" and fig["width"] == 12.5 and fig["alt"] == "图1 系统框图"
    assert fig["para_no"] == 2 and fig["lines"] == {"start": 4, "end": 4}
    assert d[3]["para_no"] == 3
    assert ast["figures"] == []  # 内嵌图不进第四书


def test_inline_figure_roundtrip_and_malformed():
    import os
    import tempfile

    from patent_studio.kernel.content import dump_md

    text = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n"
        "### 技术领域\n![流程](figs/a.png){width=15}\n"
    )
    title, abstract, claims, spec = parse_md(text)
    assert spec[-1] == ("f", "a.png", 15.0, "流程")
    out = os.path.join(tempfile.gettempdir(), "w18-dump.md")
    try:
        dump_md(out, title, abstract, claims, spec)
        # dump 在块间补空行，逐字节不恒等——按语义回解析比对
        assert parse_md(open(out, encoding="utf-8").read())[3] == spec
        assert "![流程](figs/a.png){width=15}" in open(out, encoding="utf-8").read()
    finally:
        if os.path.exists(out):
            os.unlink(out)
    # 非 figs/ 路径 / 行内引用（非独立行）都不进 figure——保持普通段落
    bad = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n"
        "### 技术领域\n见图 ![](figs/a.png) 如上\n![x](img/a.png)\n"
    )
    spec = parse_md(bad)[3]
    assert all(not isinstance(i, tuple) or i[0] != "f" for i in spec)


def test_inline_figure_insert_delete_serialize():
    from patent_studio.kernel.patch import delete_block, insert_block

    text = "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n### 技术领域\n段一\n段二\n"
    ast = parse_ast(text)
    first = ast["description"][0]
    r = insert_block(text, "figure", after_block_id=first["id"], markdown="![](figs/x.png){width=10}")
    fig = next(b for b in r.ast["description"] if b["kind"] == "figure")
    assert fig["file"] == "x.png" and fig["width"] == 10
    assert "![](figs/x.png){width=10}" in r.content
    r2 = delete_block(r.content, fig["id"])
    assert all(b["kind"] != "figure" for b in r2.ast["description"])


def test_empty_table_row_is_data_not_separator():
    # 版面视图 Mod-Alt-↓ 加行落盘为 `|  |  |`：全空行必须留在 rows（否则 AST 往返把编辑器里的新行吞掉），
    # 只有每格含 `-` 的 `| --- | :-: |` 才是 GFM 分隔行
    text = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n### 技术领域\n"
        "| A | B |\n| --- | :-: |\n|  |  |\n| 1 | 2 |\n|  |  |\n"
    )
    rows = [["A", "B"], ["", ""], ["1", "2"], ["", ""]]
    assert parse_md(text)[3] == [("h", "技术领域"), ("t", rows, {})]
    ast = parse_ast(text)
    VALIDATOR.validate(ast)
    table = ast["description"][1]
    assert table["kind"] == "table" and table["rows"] == rows and table["lines"] == {"start": 3, "end": 7}


@pytest.mark.parametrize("pid", CASES)
def test_para_numbers_match_docx_and_xml(pid, tmp_path):
    """AST 段号 == builder 产出 document.xml 的 [0001]… 序列 == 五书 XML description/p@num。"""
    store, text, settings = _case(pid)
    ast = parse_ast(text, settings)
    nums = _numbers(ast)
    assert nums == list(range(1, len(nums) + 1))

    proj = store.get(pid)
    cfg = store.build_config(proj, out=str(tmp_path / "out.docx"))
    build_patent_ex(cfg)
    with zipfile.ZipFile(cfg["out"]) as z:
        doc = z.read("word/document.xml").decode("utf-8")
    # 内核段号 = SimHei 字体独立 run（style.label_ascii）；语料正文自带的 [0065] 等字面段号
    # 在宋体 run 里，不能混算
    labels = [int(m.group(1)) for m in re.finditer(r'<w:rFonts w:ascii="SimHei".*?</w:rPr><w:t>\[(\d{4})\]</w:t>', doc)]
    assert labels == nums

    exporter = _Exporter(cfg)
    root, n = exporter.description(ast["title"]["text"], parse_md(text)[3])
    assert n == nums[-1] and [int(x) for x in root.xpath(".//p/@num")] == nums


# ---------------- 权项 ----------------


def _claims(claims_md):
    text = "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n" + claims_md + "\n\n## 说明书\n\n### 技术领域\n\n段。\n"
    return parse_ast(text)["claims"]


def test_claim_kinds_categories_and_refs():
    c = _claims(
        "1.一种控制方法，其特征在于，包括：\n步骤一；\n$$a = b$$\n其中 a 为 x。\n\n"
        "2.根据权利要求1所述的方法，其特征在于，Y。\n\n"
        "3.如权利要求1或2所述的方法，其特征在于，Z。\n\n"
        "4.根据权利要求1至3中任一项所述的方法，其特征在于，W。\n\n"
        "5.按照权利要求2、3或4所述的方法，其特征在于，V。\n\n"
        "6.一种装置，包括处理器，其特征在于：所述处理器执行权利要求1-5任意一项所述的方法。\n\n"
        "7.一种介质，其上存储有程序，所述程序实现权利要求1至5所述的方法。\n\n"
        "8．依据权利要求 7 所述的介质，其特征在于，U。"
    )
    assert [x["num"] for x in c] == list(range(1, 9))
    assert [x["num_written"] for x in c] == [str(i) for i in range(1, 9)]
    assert [x["claim_kind"] for x in c] == [
        "independent",
        "dependent",
        "dependent",
        "dependent",
        "dependent",
        "independent",
        "independent",
        "dependent",
    ]
    assert [x["category"] for x in c] == ["控制方法", "方法", "方法", "方法", "方法", "装置", "介质", "介质"]
    assert c[0]["lines"] == {"start": 2, "end": 5} and [s["kind"] for s in c[0]["segments"]] == [
        "text",
        "text",
        "equation",
        "text",
    ]
    assert c[0]["segments"][2]["text"] == "a = b" and c[0]["segments"][2]["mathml"].startswith("<math ")
    assert c[0]["refs"] == [] and c[0]["charact"] == {"seg": 0, "offset": 15}

    def refs(x):
        return [(r["text"], r["targets"], r["alternative"]) for r in x["refs"]]

    assert refs(c[1]) == [("权利要求1", [1], False)]
    assert refs(c[2]) == [("权利要求1或2", [1, 2], True)]
    assert refs(c[3]) == [("权利要求1至3中任一项", [1, 2, 3], True)]
    assert refs(c[4]) == [("权利要求2、3或4", [2, 3, 4], True)]
    assert refs(c[5]) == [("权利要求1-5任意一项", [1, 2, 3, 4, 5], True)]
    assert refs(c[6]) == [("权利要求1至5", [1, 2, 3, 4, 5], False)]
    assert refs(c[7]) == [("权利要求 7", [7], False)]
    r = c[1]["refs"][0]
    assert c[1]["segments"][r["seg"]]["text"][r["start"] : r["end"]] == r["text"]
    assert c[5]["charact"] == {"seg": 0, "offset": 19}  # "其特征在于：" 含冒号
    assert c[6]["charact"] is None


def test_claim_without_number_or_odd_layout():
    c = _claims("一种没有编号的东西，其特征在于，X。\n\n  \n\n2.根据权利要求1所述的东西，Y。")
    # 空白行不是空行：parse_md 只按 ln == "" 分块，"  " 自成一个权项块
    assert [(x["num"], x["num_written"]) for x in c] == [(1, None), (2, None), (3, "2")]
    assert c[0]["claim_kind"] == "independent" and c[0]["category"] == "没有编号的东西"
    assert c[1]["segments"][0]["text"] == "  " and c[1]["category"] is None
    assert c[2]["claim_kind"] == "dependent" and c[2]["category"] == "东西" and c[2]["charact"] is None


# ---------------- MathML ----------------


def test_all_equations_have_lxml_parseable_mathml():
    # 语料无公式（b12a541 换语料后 method/system 均无 $$…$$/OMML）：
    # 改用合成文本喂同一 parse_ast → to_mathml 链路，断言语义不变
    text = (
        "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X，其中 $$a = b/2$$ 成立。\n\n"
        "## 说明书\n\n### 技术领域\n\n段。\n\n$$E_t = (1/|Λ|)·Σ_{λ∈Λ} exp(√n/2)$$\n"
    )
    ast = parse_ast(text)
    eqs = [b for b in ast["description"] if b["kind"] == "equation"]
    eqs += [s for c in ast["claims"] for s in c["segments"] if s["kind"] == "equation"]
    assert eqs
    for e in eqs:
        root = etree.fromstring(e["mathml"])
        assert root.tag == "{%s}math" % MML_NS and root.get("display") == "block"
        assert len(root)  # 非空
        # 公式中的每个非空白字符都在 MathML 文本里（无字符丢失；/ √ Σ 已变成 mfrac/msqrt/munder ∑，_ 为下标）
        src = e["source"] if "source" in e else e["text"]
        assert set(src.replace(" ", "")) <= set("".join(root.itertext())) | set("{}[]()_/√Σ")


def test_to_mathml_structures():
    m = etree.fromstring(to_mathml("E_t = (1/|Λ|)·Σ_{λ∈Λ} exp(√n/2)"))
    ns = {"m": MML_NS}
    assert m.xpath("count(//m:msub)", namespaces=ns) == 1
    assert m.xpath("//m:msub/m:mrow[1]/m:mi/text()", namespaces=ns) == ["E"]
    assert m.xpath("count(//m:mfrac)", namespaces=ns) == 2
    assert m.xpath("//m:munder/m:mo/text()", namespaces=ns) == ["∑"]
    assert m.xpath("count(//m:msqrt)", namespaces=ns) == 1
    assert m.xpath("//m:mi[text()='Λ']", namespaces=ns) and m.xpath("//m:mi[text()='exp']", namespaces=ns)
    assert m.xpath("//m:mn/text()", namespaces=ns) == ["1", "2"]
    for tag in ("msub", "mfrac"):
        for el in m.iter("{%s}%s" % (MML_NS, tag)):
            assert len(el) == 2


# ---------------- 结构错误 ----------------


@pytest.mark.parametrize(
    "text,line,msg",
    [
        ("## 摘要\n\n## 权利要求书\n\n## 说明书\n", 1, "# 标题"),
        ("# T\n## 摘要\n## 权利要求书\n## 附录\n## 说明书\n", 4, "未知章节"),
        ("# T\n## 摘要\n## 权利要求书\n## 说明书\n## 摘要\n", 5, "重复"),
        ("# T\n## 摘要\n## 权利要求书\n", None, "说明书"),
        ("# T\n## 摘要\n## 权利要求书\n## 说明书\n$$a = b\n", 5, "$$"),
    ],
)
def test_structural_errors(text, line, msg):
    with pytest.raises(AstError) as ei:
        parse_ast(text)
    assert ei.value.line == line and msg in str(ei.value)


def test_title_is_last_hash_line_like_parse_md():
    text = "# A\n## 摘要\n# B\n## 权利要求书\n## 说明书\n"
    ast = parse_ast(text)
    assert ast["title"] == {"text": "B", "line": 3} and parse_md(text)[0] == "B"
    assert ast["abstract"]["paragraphs"] == [] and ast["abstract"]["lines"] == {"start": 1, "end": 1}


# ---------------- 路由 ----------------


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in CASES:
        shutil.copytree(
            os.path.join(EXAMPLES, pid), projects / pid, ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*")
        )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main

    importlib.reload(config)
    importlib.reload(main)
    return TestClient(main.app), projects


def test_get_ast_matches_parse_and_schema(client):
    c, _ = client
    for pid in CASES:
        r = c.get(f"/api/projects/{pid}/ast")
        assert r.status_code == 200
        _s, text, settings = _case(pid)
        assert r.json() == parse_ast(text, settings, figures=_figures(pid))
        VALIDATOR.validate(r.json())
    assert c.get("/api/projects/nope/ast").status_code == 404


def test_post_ast_unsaved_content_and_settings(client):
    c, _ = client
    r = c.post("/api/projects/method/ast", json={})
    assert r.status_code == 200 and r.json() == c.get("/api/projects/method/ast").json()
    text = (
        "# 草稿\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X，其特征在于，Y。\n\n## 说明书\n\n### 技术领域\n\n段。\n"
    )
    r = c.post("/api/projects/method/ast", json={"content": text})
    assert r.status_code == 200
    ast = r.json()
    assert ast["title"]["text"] == "草稿" and len(ast["figures"]) == 3  # settings 缺省 → studio.json
    r = c.post("/api/projects/method/ast", json={"content": text, "settings": {"spec_figures": [["fig2.emf", 10]]}})
    assert r.status_code == 200
    assert [(f["file"], f["width"], f["caption"]) for f in r.json()["figures"]] == [("fig2.emf", 10.0, None)]
    r = c.post("/api/projects/method/ast", json={"content": text, "settings": {"spec_figures": [["x.emf", "宽"]]}})
    assert r.status_code == 422 and "settings" in r.json()["detail"]


def test_post_ast_structural_error_422_shape(client):
    c, _ = client
    r = c.post("/api/projects/method/ast", json={"content": "# T\n## 摘要\n## 权利要求书\n## 附录\n"})
    assert r.status_code == 422
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"}
    assert d["kind"] == "content" and d["line"] == 4 and "附录" in d["message"]


@pytest.mark.parametrize("pid", CASES)
def test_parse_time_under_50ms(pid):
    _s, text, settings = _case(pid)
    parse_ast(text, settings)  # 预热（首个 lxml/regex 编译）
    best = min(_timed(text, settings) for _ in range(5))
    print(f"\nparse_ast({pid}): {best:.2f} ms")
    assert best < 50


def _timed(text, settings):
    t0 = time.perf_counter()
    parse_ast(text, settings)
    return (time.perf_counter() - t0) * 1000
