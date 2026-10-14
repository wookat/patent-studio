# -*- coding: utf-8 -*-
"""R3 B1-patch-api（docs/plan/06-r3-structure-edit-design.md §3 / §4 / §8 第 11 项）：
序列化法则对两案逐字节成立；patch/insert/delete 纯函数（恒等补丁、只改该块行、装配律）；
路由 200/422/409 + save_content 落盘；模板可被 parse_ast 接受；boundary 三规则 + fix 可被 patch 接受；/api/mathml。"""

import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from patent_studio.kernel import block_templates, critic, docset
from patent_studio.kernel.ast import parse_ast
from patent_studio.kernel.boundary_lint import RULES, lint_boundary
from patent_studio.kernel.patch import PatchError, delete_block, insert_block, iter_blocks, patch_block, serialize_block

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = [os.path.join(ROOT, "examples", d) for d in ("method", "system")]
EDITABLE_KINDS = ("paragraph", "section", "subsection", "equation", "table", "claim")


def read_md(d):
    with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
        return f.read()


def read_settings(d):
    from app.domain.projects import normalize_settings

    with open(os.path.join(d, "studio.json"), encoding="utf-8") as f:
        raw = json.load(f)
    return normalize_settings(raw, sorted(os.listdir(os.path.join(d, "figs"))))


def law(md):
    assert docset.assemble(docset.split(md)) == md


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    for d in EXAMPLES:
        shutil.copytree(
            d, projects / os.path.basename(d), ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*")
        )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main

    importlib.reload(config)
    importlib.reload(main)
    c = TestClient(main.app)
    c.projects = projects
    return c


# ---------------- 序列化法则（prep 已验证，保留） ----------------


def _blocks(md):
    ast = parse_ast(md)
    ds = docset.split(md)
    for book, blocks in (
        ("abstract", ast["abstract"]["paragraphs"]),
        ("claims", ast["claims"]),
        ("description", ast["description"]),
    ):
        text = ds.book(book).split("\n")
        for b in blocks:
            yield book, b, text[b["lines"]["start"] - 1 : b["lines"]["end"]]


@pytest.mark.parametrize("d", EXAMPLES)
def test_serialize_law_examples(d):
    """序列化法则（06 §4）：两案每个块 serialize(parse(block)) == 该块源码行（摘要按段）。"""
    n = 0
    for _book, b, src in _blocks(read_md(d)):
        assert serialize_block(b) == src, b["id"]
        n += 1
    assert n >= 70


# 新语料（b12a541）两案只含 claim/paragraph/section 三种块型；
# 全 kind 覆盖改用合成文本（序列化法则逐 kind 的语义不变）
RICH_MD = (
    "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X，其特征在于，Y。\n\n"
    "2.根据权利要求1所述的X，其特征在于，Z。\n\n"
    "## 说明书\n\n### 技术领域\n\n段一。\n\n#### 小节题\n\n$$a = b$$\n\n"
    "表1 对比\n\n<!-- 表格: 三线 -->\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n"
    "注：表注。\n\n### 附图说明\n\n图1为示意图。\n"
)


def test_serialize_law_covers_all_kinds():
    kinds = {b["kind"] for d in EXAMPLES for _, b, _ in _blocks(read_md(d))}
    kinds |= {b["kind"] for _, b, _ in _blocks(RICH_MD)}
    assert set(EDITABLE_KINDS) <= kinds


def test_serialize_table_forms():
    opts = "<!-- 表格: 三线 段号居左 列宽=30,70 表题后置=表1对比 -->"
    md = (
        "# t\n\n## 摘要\n\na\n\n## 权利要求书\n\n1.x\n\n## 说明书\n\n### 具体实施方式\n\n表1 对比\n\n"
        f"{opts}\n| a | b |\n| --- | --- |\n| ^^ | d |\n\n注：n\n\n```\ncode\n```\n"
    )
    ast = parse_ast(md)
    tbl = next(b for b in ast["description"] if b["kind"] == "table")
    assert serialize_block(tbl) == [opts, "| a | b |", "| --- | --- |", "| ^^ | d |", "", "注：n"]
    code = next(b for b in ast["description"] if b["kind"] == "code")
    assert serialize_block(code) == ["```", "code", "```"]
    with pytest.raises(PatchError):
        serialize_block(ast["abstract"])


@pytest.mark.parametrize("d", EXAMPLES)
def test_line_range_splice_keeps_assembly_law(d):
    """06 §3.1 的核心假设：按书相对 lines 替换任一块的行后，assemble(split(md')) == md' 且其余行逐字节不变。"""
    md = read_md(d)
    ast = parse_ast(md)
    ds = docset.split(md)
    for book, blocks in (("claims", ast["claims"]), ("description", ast["description"])):
        b = blocks[-1]
        lines = ds.book(book).split("\n")
        s, e = b["lines"]["start"] - 1, b["lines"]["end"]
        new_lines = lines[:s] + ["改写后的块"] + lines[e:]
        ds2 = docset.replace(ds, book, "\n".join(new_lines))
        md2 = docset.assemble(ds2)
        assert docset.assemble(docset.split(md2)) == md2
        off = ast["books"][book]["offset"]
        old, new = md.split("\n"), md2.split("\n")
        assert old[: off + s] == new[: off + s]
        assert old[off + e :] == new[off + s + 1 :]
        ast2 = parse_ast(md2)
        assert len(ast2[book]) == len(ast[book])


# ---------------- patch_block ----------------


def _full_range(ast, book, b):
    off = ast["books"][book]["offset"]
    return off + b["lines"]["start"] - 1, off + b["lines"]["end"]


@pytest.mark.parametrize("d", EXAMPLES)
def test_patch_identity_every_block(d):
    """两案每个可编辑块：用自身序列化结果打补丁 → 全文逐字节不变，block_id 不变，changed_lines = 该块全文行。"""
    md = read_md(d)
    ast = parse_ast(md)
    n = 0
    for book, b in iter_blocks(ast):
        r = patch_block(md, b["id"], "\n".join(serialize_block(b)))
        assert r.content == md, b["id"]
        assert r.block_id == b["id"]
        s, e = _full_range(ast, book, b)
        assert r.changed_lines == {"start": s + 1, "end": e}
        assert r.ast == ast
        n += 1
    assert n >= 70


def _modified(b):
    """每种 kind 一个内容有变但仍可解析的改写。"""
    k = b["kind"]
    if k == "paragraph":
        return [b["text"] + "（改）"]
    if k == "section":
        return ["### " + b["title"] + "（改）"]
    if k == "subsection":
        return ["#### " + b["title"] + "（改）"]
    if k == "equation":
        return ["$$%s + 1$$" % b["source"]]
    if k == "claim":
        lines = serialize_block(b)
        return lines[:-1] + [lines[-1] + "（改）"]
    if k == "table":
        lines = serialize_block(b)
        i = next(i for i, ln in enumerate(lines) if ln.startswith("| ---")) + 1
        return lines[:i] + ["| 新增 |" + " |" * (len(b["rows"][0]) - 1)] + lines[i:]
    if k == "code":
        return ["```", *b["code_lines"], "# 改", "```"]
    raise AssertionError(k)


def _modified_law(md):
    """每种 kind 各做一次修改补丁：只有该块行区间变化，其余行逐字节不变；装配律成立；新 id 落在同一位置。"""
    ast = parse_ast(md)
    old = md.split("\n")
    done = set()
    for book, b in iter_blocks(ast):
        key = (book, b["kind"])
        if key in done:
            continue
        done.add(key)
        new_lines = _modified(b)
        r = patch_block(md, b["id"], "\n".join(new_lines))
        s, e = _full_range(ast, book, b)
        new = r.content.split("\n")
        assert new[:s] == old[:s]
        assert new[s : s + len(new_lines)] == new_lines
        assert new[s + len(new_lines) :] == old[e:]
        assert r.changed_lines == {"start": s + 1, "end": s + len(new_lines)}
        law(r.content)
        nb = next(x for _, x in iter_blocks(r.ast) if x["id"] == r.block_id)
        assert _full_range(r.ast, book, nb) == (s, s + len(new_lines))
        assert nb["kind"] == b["kind"]
    return {k for _, k in done}


@pytest.mark.parametrize("d", EXAMPLES)
def test_patch_modified_every_kind_only_changes_block_lines(d):
    """两案每种 kind 各做一次修改补丁（语料实际出现的 kind）。"""
    _modified_law(read_md(d))


def test_patch_modified_every_kind_synthetic_all_kinds():
    """全 kind 覆盖用 RICH_MD 合成文本补（新语料只含 3 种块型）。"""
    assert _modified_law(RICH_MD) >= set(EDITABLE_KINDS)


def test_patch_strips_outer_newlines_and_shifts_ids():
    md = read_md(EXAMPLES[0])
    r = patch_block(md, "claims/1", "\n1.一种方法，其特征在于，\n第二行\n\n")
    assert r.content.split("\n")[8:10] == ["1.一种方法，其特征在于，", "第二行"]
    assert r.changed_lines == {"start": 9, "end": 10}
    # 段落数变化 → 后续段号 id 漂移，返回的是位置上的新 id
    ast = parse_ast(md)
    p = ast["description"][1]
    assert p["kind"] == "paragraph"
    r = patch_block(md, p["id"], "第一段\n\n第二段")
    assert r.block_id == p["id"]
    assert r.ast["description"][2]["text"] == "第二段" and r.ast["description"][2]["para_no"] == 2
    assert r.ast["description"][-1]["para_no"] == ast["description"][-1]["para_no"] + 1


def test_patch_markup_content_resolves_ids_on_accepted_view():
    """带 CriticMarkup 的正文：块 id 按接受后视图定位（与 routes_ast/derive 产 id 侧同口径）。
    {--…--} 删除行在原文视图仍占段落序号——ddpm 实案：s1 成稿 BlocksPatch 锚点 id
    对原文解析全批 stale，整稿只能降级成 comment 提案。"""
    md = (
        "# 题名\n\n## 摘要\n\n摘要段。\n\n## 权利要求书\n\n1.一种方法。\n\n## 说明书\n\n"
        "### 技术领域\n\n领域段。\n\n### 背景技术\n\n"
        "{--被删除的背景段。--}\n\n{--又一段被删。--}\n\n背景段一。\n\n背景段二。\n\n"
        "### 发明内容\n\n内容段。\n\n### 附图说明\n\n### 具体实施方式\n\n实施段。\n"
    )
    ast = parse_ast(critic.accept(md))
    target = next(b for b in ast["description"] if b["kind"] == "paragraph" and b["text"] == "背景段一。")
    # 原文视图同号但指向标记行——照原文定锚会把删除标记行当正文段改掉（或越号报 stale）
    ast_raw = parse_ast(md)
    raw_same = next(b for b in ast_raw["description"] if b["id"] == target["id"])
    assert raw_same["kind"] == "paragraph" and raw_same["text"] != "背景段一。"
    r = patch_block(md, target["id"], "新背景段一。")
    new = r.content.split("\n")
    # 精确替换目标行；两侧删除标记行逐字节保留
    assert "新背景段一。" in new
    assert "{--被删除的背景段。--}" in r.content and "{--又一段被删。--}" in r.content
    assert "背景段二。" in new and "背景段一。" not in new
    law(r.content)


def test_patch_base_conflict():
    """R67-02：base（打开编辑器时的块原行）与当前同区间行不一致 → conflict，防止打开后被改静默覆盖。"""
    md = read_md(EXAMPLES[0])
    ast = parse_ast(md)
    book, b = next(iter_blocks(ast))
    s, e = _full_range(ast, book, b)
    base = "\n".join(md.split("\n")[s:e])
    # 一致 → 正常走
    r = patch_block(md, b["id"], base + "\n追加行", base=base)
    assert "追加行" in r.content
    # 不一致 → conflict
    with pytest.raises(PatchError) as ei:
        patch_block(md, b["id"], "x", base=base + "不同")
    assert ei.value.kind == "conflict"
    # base=None 保持旧行为
    r = patch_block(md, b["id"], base + "\n追加行2")
    assert "追加行2" in r.content


def test_patch_errors():
    md = read_md(EXAMPLES[0])
    with pytest.raises(PatchError) as ei:
        patch_block(md, "claims/99", "x")
    assert ei.value.kind == "stale" and ei.value.line is None
    # `## ` 行不再被允许进正文——书头行归一化剥壳而非整提案拒（详见 test_patch_sanitizes_book_headings）
    r = patch_block(md, "description/技术领域", "## 权利要求书")
    assert r.content.count("## 权利要求书") == 1
    with pytest.raises(PatchError) as ei:
        patch_block("# t\n\n## 未知\n", "claims/1", "x")
    assert ei.value.kind == "content" and ei.value.line == 3


# ---------------- insert_block ----------------


def _expected_kind(kind, book):
    if book == "claims":
        return "claim"
    return "paragraph" if kind == "figure-ref" else kind


@pytest.mark.parametrize("d", EXAMPLES)
def test_insert_template_at_book_start_every_kind(d):
    """每个模板 × 其每个合法书：插到书首 → 前后各一空行、解析出对应 kind、装配律成立、其余行不变。"""
    md = read_md(d)
    old = md.split("\n")
    for t in block_templates.templates():
        for book in t["book"]:
            r = insert_block(md, t["kind"], book=book)
            new = r.content.split("\n")
            s, e = r.changed_lines["start"] - 1, r.changed_lines["end"]
            at = parse_ast(md)["books"][book]["offset"]
            assert s == at + 1 and new[s - 1] == "" and new[e] == ""
            assert new[:at] == old[:at] and new[e:] == old[at:]
            law(r.content)
            nb = next(x for _, x in iter_blocks(r.ast) if x["id"] == r.block_id)
            assert nb["kind"] == _expected_kind(t["kind"], book), (t["kind"], book)
            assert new[s:e] == (
                block_templates.template(t["kind"]) if t["kind"] not in ("claim", "figure-ref") else "\n".join(new[s:e])
            ).split("\n")


@pytest.mark.parametrize("d", EXAMPLES)
def test_insert_after_block_numbering_and_tail(d):
    md = read_md(d)
    ast = parse_ast(md)
    r = insert_block(md, "claim", after_block_id="claims/1")
    assert r.block_id == "claims/2"
    assert r.content.split("\n")[r.changed_lines["start"] - 1] == "2.一种……，其特征在于，"
    assert len(r.ast["claims"]) == len(ast["claims"]) + 1
    law(r.content)
    last = "claims/%d" % len(ast["claims"])
    r = insert_block(md, "claim", after_block_id=last)
    n = len(ast["claims"]) + 1
    lines = r.content.split("\n")
    assert r.block_id == "claims/%d" % n and lines[r.changed_lines["start"] - 1].startswith("%d." % n)
    assert lines[r.changed_lines["end"] : r.changed_lines["end"] + 2] == ["", "## 说明书"]
    # 书末最后一块之后（全文末尾）：仍以单个换行结尾
    tail = ast["description"][-1]["id"]
    settings = read_settings(d)
    r = insert_block(md, "figure-ref", after_block_id=tail, settings=settings)
    assert r.content.endswith("示意图。\n") and r.content.count("\n\n\n") == 0
    n_fig = len(settings["spec_figures"])
    assert r.content.split("\n")[r.changed_lines["start"] - 1] == "图%d为……示意图。" % (n_fig + 1)
    law(r.content)
    r = insert_block(md, "table", after_block_id=tail, markdown="| a |\n| --- |\n| 1 |")
    assert r.content.split("\n")[r.changed_lines["start"] - 1 : r.changed_lines["end"]] == ["| a |", "| --- |", "| 1 |"]
    nb = next(x for _, x in iter_blocks(r.ast) if x["id"] == r.block_id)
    assert nb["kind"] == "table" and nb["rows"] == [["a"], ["1"]]


def test_insert_errors():
    md = read_md(EXAMPLES[0])
    for kind, book in (("claim", "description"), ("section", "claims"), ("equation", "abstract"), ("table", "claims")):
        with pytest.raises(PatchError) as ei:
            insert_block(md, kind, book=book)
        assert ei.value.kind == "kind"
    with pytest.raises(PatchError) as ei:
        insert_block(md, "claim", after_block_id="description/技术领域/p0001")
    assert ei.value.kind == "kind"
    with pytest.raises(PatchError) as ei:
        insert_block(md, "nope", book="description")
    assert ei.value.kind == "kind"
    with pytest.raises(PatchError) as ei:
        insert_block(md, "paragraph")
    assert ei.value.kind == "kind"
    with pytest.raises(PatchError) as ei:
        insert_block(md, "paragraph", after_block_id="claims/99")
    assert ei.value.kind == "stale"
    # `## ` 书头行在 markdown 内被归一化剥除而非整提案拒（详见 test_patch_sanitizes_book_headings）
    r = insert_block(md, "section", book="description", markdown="## 摘要")
    assert r.content.count("## 摘要") == 1


# ---------------- delete_block ----------------


def _delete_keeps_blank(md, bid):
    ast = parse_ast(md)
    old = md.split("\n")
    book, b = next((bk, x) for bk, x in iter_blocks(ast) if x["id"] == bid)
    s, e = _full_range(ast, book, b)
    r = delete_block(md, bid)
    new = r.content.split("\n")
    assert r.block_id is None and r.changed_lines == {"start": s + 1, "end": s}
    assert new[:s] == old[:s]
    assert new[s:] == old[e + 1 :], bid  # 块行 + 其后一个空行
    assert "\n\n\n" not in r.content
    law(r.content)
    assert sum(1 for _ in iter_blocks(r.ast)) == sum(1 for _ in iter_blocks(ast)) - 1


@pytest.mark.parametrize("d", EXAMPLES)
def test_delete_keeps_single_blank_between_blocks(d):
    md = read_md(d)
    ast = parse_ast(md)
    targets = ["abstract/p1", "claims/2", ast["description"][1]["id"], ast["description"][-1]["id"]]
    # 新语料无 subsection/equation/table 块 → 这些 kind 的删除法则由 RICH_MD 覆盖（见下）
    targets += [
        next(b["id"] for b in ast["description"] if b["kind"] == k)
        for k in ("subsection", "equation", "table")
        if any(b["kind"] == k for b in ast["description"])
    ]
    for bid in targets:
        _delete_keeps_blank(md, bid)


def test_delete_keeps_single_blank_all_kinds():
    """subsection/equation/table 等语料缺失 kind 的删除法则（RICH_MD 合成文本）。"""
    ast = parse_ast(RICH_MD)
    for bid in (b["id"] for k in ("subsection", "equation", "table") for b in ast["description"] if b["kind"] == k):
        _delete_keeps_blank(RICH_MD, bid)


def test_delete_protects_statutory_sections():
    md = read_md(EXAMPLES[0])
    for title, line in (("技术领域", 31), ("附图说明", 157)):
        with pytest.raises(PatchError) as ei:
            delete_block(md, "description/" + title)
        assert ei.value.kind == "content" and ei.value.line == line
    # 新语料无小节 → 非法定小节可删的断言用 RICH_MD 的合成小节
    r = delete_block(RICH_MD, "description/技术领域/小节题")
    assert all(b["id"] != "description/技术领域/小节题" for b in r.ast["description"])
    with pytest.raises(PatchError) as ei:
        delete_block(md, "claims/99")
    assert ei.value.kind == "stale"


# ---------------- 模板 ----------------


def test_templates_shape_and_parse():
    ts = block_templates.templates()
    assert [t["kind"] for t in ts] == list(block_templates.BLOCK_KINDS)
    for t in ts:
        assert set(t) == {"kind", "label", "book", "markdown", "cursor"}
        assert set(t["cursor"]) == {"line", "col"} and t["book"]
        lines = t["markdown"].split("\n")
        assert 0 <= t["cursor"]["line"] < len(lines) and 0 <= t["cursor"]["col"] <= len(lines[t["cursor"]["line"]])
    by = {t["kind"]: t for t in ts}
    assert by["section"]["markdown"] == "### 章节标题" and by["section"]["cursor"] == {"line": 0, "col": 4}
    assert by["table"]["markdown"].startswith("<!-- 表格: 三线 -->\n| 列1 | 列2 |")
    assert block_templates.template("claim", num=7) == "7.一种……，其特征在于，"
    assert block_templates.template("figure-ref", fig_num=3) == "图3为……示意图。"


# ---------------- boundary lint ----------------


def _fig_caption(ast, n):
    return next(b for b in ast["description"] if b["kind"] == "paragraph" and b["text"].startswith("图%d为" % n))


@pytest.mark.parametrize("d", EXAMPLES)
def test_boundary_lint_clean_on_examples(d):
    """新语料正文自带 [NNNN] 段号前缀 → boundary.para_no 是真命中而非回归；
    断言诊断构成 = 全部 para_no（数量随语料锁死）。"""
    md = read_md(d)
    diags = lint_boundary(parse_ast(md, read_settings(d)), md)
    expected = {"method": 147, "system": 261}[os.path.basename(d)]
    assert [x["id"] for x in diags] == ["boundary.para_no"] * expected


def test_boundary_lint_three_rules_and_fixes_roundtrip():
    """语料本身已带段号前缀，三规则+修复回路改用干净的 RICH_MD 合成文本。"""
    md, settings = RICH_MD, {"spec_figures": [["fig1.png", 15.0]]}
    ast = parse_ast(md, settings)
    fig = _fig_caption(ast, 1)
    c = patch_block(md, "abstract/p1", "[0001] " + ast["abstract"]["paragraphs"][0]["text"], settings)
    c = patch_block(c.content, "claims/2", "5" + "\n".join(serialize_block(ast["claims"][1]))[1:], settings)
    c = patch_block(c.content, fig["id"], "图9" + fig["text"][2:], settings)
    diags = lint_boundary(c.ast, c.content)
    assert [x["id"] for x in diags] == list(RULES)
    for x in diags:
        assert x["severity"] == "warning" and x["source"] == "boundary" and x["section"]
        assert set(x["fix"]) == {"block_id", "markdown"}
    assert [x["line"] for x in diags] == [5, 11, 34]
    assert diags[1]["fix"]["block_id"] == "claims/2" and diags[1]["fix"]["markdown"].startswith("2.根据权利要求1")
    assert diags[2]["fix"]["markdown"].startswith("图1为")
    cur = c.content
    for x in diags:
        cur = patch_block(cur, x["fix"]["block_id"], x["fix"]["markdown"], settings).content
    assert cur == md


def test_boundary_lint_table_note_and_description_para():
    md = RICH_MD  # 新语料无带表注的表 → 合成文本
    ast = parse_ast(md)
    tbl = next(b for b in ast["description"] if b["kind"] == "table" and b["note"])
    lines = serialize_block(tbl)
    lines[-1] = "[0042]" + lines[-1]
    c = patch_block(md, tbl["id"], "\n".join(lines))
    p = ast["description"][1]
    c = patch_block(c.content, p["id"], "【0001】 " + p["text"])
    diags = lint_boundary(c.ast, c.content)
    assert [x["id"] for x in diags] == ["boundary.para_no", "boundary.para_no"]
    assert diags[0]["fix"]["block_id"] == p["id"] and diags[0]["fix"]["markdown"] == p["text"]
    # 带编号的表注不再是“注：”行，被解析成表后的普通段；fix 去前缀后重新成为表注
    assert diags[1]["fix"]["markdown"] == tbl["note"]["text"]
    assert diags[1]["line"] == ast["books"]["description"]["offset"] + tbl["lines"]["end"]
    ids = [b["id"] for b in c.ast["description"]]
    assert c.ast["description"][ids.index(diags[1]["fix"]["block_id"]) - 1]["note"] is None
    cur = c.content
    for x in diags:
        cur = patch_block(cur, x["fix"]["block_id"], x["fix"]["markdown"]).content
    assert cur == md


# ---------------- 路由 ----------------


def _disk(client, pid):
    with open(client.projects / pid / "content.md", encoding="utf-8") as f:
        return f.read()


@pytest.mark.parametrize("pid", ["method", "system"])
def test_route_patch_saves_and_backs_up(client, pid):
    md = _disk(client, pid)
    ast = client.get(f"/api/projects/{pid}/ast").json()
    p = ast["description"][1]
    r = client.post(f"/api/projects/{pid}/blocks/{p['id']}", json={"markdown": p["text"] + "（改）"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(j) == {"ast", "content", "changed_lines", "block_id", "backup"}
    assert j["block_id"] == p["id"] and j["backup"].startswith("content.md.bak-")
    off = ast["books"]["description"]["offset"]
    assert j["changed_lines"] == {"start": off + p["lines"]["start"], "end": off + p["lines"]["end"]}
    assert j["ast"]["description"][1]["text"] == p["text"] + "（改）"
    assert _disk(client, pid) == j["content"] != md
    with open(client.projects / pid / j["backup"], encoding="utf-8") as f:
        assert f.read() == md
    with open(client.projects / pid / "docs" / "description.md", encoding="utf-8") as f:
        assert f.read() == docset.split(j["content"]).book("description")
    assert client.get(f"/api/projects/{pid}/ast").json() == j["ast"]
    law(j["content"])


def test_route_patch_uses_body_content_as_base(client):
    disk = _disk(client, "method")
    unsaved = disk.replace("## 摘要\n\n", "## 摘要\n\n未保存的摘要段。\n\n", 1)
    r = client.post(
        "/api/projects/method/blocks/claims/1", json={"markdown": "1.一种方法，其特征在于，", "content": unsaved}
    )
    assert r.status_code == 200
    assert "未保存的摘要段。" in r.json()["content"] and _disk(client, "method") == r.json()["content"]
    assert r.json()["ast"]["claims"][0]["segments"][0]["text"] == "1.一种方法，其特征在于，"


def test_route_errors_422_409_404(client):
    r = client.post("/api/projects/method/blocks/claims/99", json={"markdown": "x"})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert set(d) == {"kind", "message", "line", "detail"} and d["kind"] == "stale" and d["line"] is None
    r = client.post("/api/projects/method/blocks", json={"kind": "claim", "book": "description"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "kind"
    r = client.request("DELETE", "/api/projects/method/blocks/description/技术领域")
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "content"
    r = client.post("/api/projects/nope/blocks/claims/1", json={"markdown": "x"})
    assert r.status_code == 404
    assert _disk(client, "method") == read_md(EXAMPLES[0])
    assert not [f for f in os.listdir(client.projects / "method") if f.startswith("content.md.bak-")]


def test_route_insert_and_delete(client):
    md0 = _disk(client, "method")
    r = client.post("/api/projects/method/blocks", json={"kind": "claim", "after_block_id": "claims/1"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["block_id"] == "claims/2" and j["ast"]["claims"][1]["segments"][0]["text"] == "2.一种……，其特征在于，"
    assert _disk(client, "method") == j["content"]
    law(j["content"])
    r = client.post(
        "/api/projects/method/blocks",
        json={"kind": "equation", "after_block_id": "description/技术领域/p0001", "markdown": "$$a = b$$"},
    )
    assert r.status_code == 200 and r.json()["block_id"] == "description/技术领域/eq1"
    r = client.request("DELETE", "/api/projects/method/blocks/description/技术领域/eq1", json={})
    assert r.status_code == 200 and r.json()["block_id"] is None
    r = client.request("DELETE", "/api/projects/method/blocks/claims/2")
    assert r.status_code == 200
    assert r.json()["content"] == md0 == _disk(client, "method")
    assert r.json()["changed_lines"] == {"start": 11, "end": 10}
    assert client.get("/api/projects/method/ast").json() == r.json()["ast"]


def test_route_templates(client):
    r = client.get("/api/block-templates")
    assert r.status_code == 200
    assert r.json() == {"templates": block_templates.templates()}


def test_mathml_route(client):
    r = client.post("/api/mathml", json={"source": "x_t = a/b"})
    assert r.status_code == 200
    m = r.json()["mathml"]
    assert m.startswith('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">') and "<mfrac>" in m


@pytest.mark.parametrize("d", EXAMPLES)
def test_patch_sanitizes_book_headings(d):
    """AI 补丁正文把 `## 摘要` 书头行粘进行首或整行带入——块级补丁书界由锚点定，
    `_block_lines` 归一后胶水行拆出正文、裸书头行剥除、非书名 `## ` 降为正文文本，
    全文不再出现非法 `## ` 行（此前 parse_ast 整提案 422，实案 prop_c8555a9895c3）。"""
    md = read_md(d)
    ast = parse_ast(md)
    target = ast["abstract"]["paragraphs"][0]["id"]
    r = patch_block(md, target, "## 摘要本发明涉及一种测试方法。\n## 摘要\n## 小节标题保留为文本\n正文行")
    new = r.content.split("\n")
    bad = [ln for ln in new if ln.startswith("## ") and ln[3:].strip() not in ("摘要", "权利要求书", "说明书")]
    assert not bad and "本发明涉及一种测试方法。" in r.content
    assert "小节标题保留为文本" in r.content and "## 小节标题保留为文本" not in r.content
    law(r.content)
