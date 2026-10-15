# -*- coding: utf-8 -*-
"""W4-C prep：docs/figures.md 真源（patent_studio.kernel.figures_md）+ 迁移幂等 + AST book=figures + 占位路由。
preflight figures.alt_mismatch / figures.file_missing 用例见文末；C2 在 test_attachments.py 替换 501 断言。"""

import hashlib
import json
import os
import shutil
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.domain.projects import ProjectStore
from patent_studio.kernel import figures_md
from patent_studio.kernel.ast import parse_ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")

SAMPLE = """# 说明书附图

![图1 总体流程图](figs/fig1.emf){width=15}
![图2 时间轴](figs/fig2.svg)
乱七八糟的一行

# 摘要附图

![](figs/fig1.emf){width=14.5}
"""


def test_parse_and_serialize_roundtrip():
    doc = figures_md.parse(SAMPLE)
    assert [(f.file, f.width, f.alt) for f in doc.spec] == [
        ("fig1.emf", 15.0, "图1 总体流程图"),
        ("fig2.svg", 15.0, "图2 时间轴"),
    ]
    assert (doc.abstract.file, doc.abstract.width, doc.abstract.alt) == ("fig1.emf", 14.5, "")
    assert doc.bad_lines == [(5, "乱七八糟的一行")]
    assert doc.legacy_view() == {
        "spec_figures": [["fig1.emf", 15.0], ["fig2.svg", 15.0]],
        "abstract_figure": ["fig1.emf", 14.5],
    }
    again = figures_md.parse(figures_md.serialize(doc))
    assert again.spec == [figures_md.Figure(f.file, f.width, f.alt, line=i + 3) for i, f in enumerate(doc.spec)]
    assert again.bad_lines == [] and again.abstract.file == "fig1.emf"


def test_serialize_is_canonical_and_byte_stable():
    # 两案入库的 figures.md 就是 serialize 的产物：parse → serialize 逐字节不变
    for case in ("method", "system"):
        with open(os.path.join(EXAMPLES, case, "docs", "figures.md"), encoding="utf-8") as f:
            text = f.read()
        assert figures_md.serialize(figures_md.parse(text)) == text
    # 非规范写法（省宽、尾空白、width=15.0、空行不齐）归一化一次后逐字节固定
    messy = "# 说明书附图\n![图1 a](figs/a.emf){width=15.0}  \n\n\n![图2 b](figs/b.emf)\n# 摘要附图\n![](figs/a.emf)"
    once = figures_md.serialize(figures_md.parse(messy))
    assert once == (
        "# 说明书附图\n\n![图1 a](figs/a.emf){width=15}\n![图2 b](figs/b.emf){width=15}\n\n"
        "# 摘要附图\n\n![](figs/a.emf){width=14.5}\n"
    )
    assert figures_md.serialize(figures_md.parse(once)) == once
    d1, d2 = figures_md.parse(messy), figures_md.parse(once)
    assert [(f.file, f.width, f.alt) for f in d1.spec] == [(f.file, f.width, f.alt) for f in d2.spec]
    assert (d1.abstract.file, d1.abstract.width) == (d2.abstract.file, d2.abstract.width) == ("a.emf", 14.5)


def test_bad_lines_cases():
    text = (
        "![图0 节外](figs/x.emf)\n"  # 1 节外
        "# 说明书附图\n"  # 2
        "![图1 大图](figs/big.emf){width=17.5}\n"  # 3 合法，大宽度原样保留
        "![图2 含空格](figs/my fig.png){width=10}\n"  # 4 文件名含空格
        "![图3 宽度非数](figs/c.emf){width=宽}\n"  # 5
        "![图4 不在 figs](imgs/d.emf)\n"  # 6
        "# 备注\n"  # 7 其它标题：忽略，结束当前节
        "这是备注文字\n"  # 8 节外
        "![图5 备注下的图](figs/e.emf)\n"  # 9 节外
        "# 摘要附图\n"  # 10
        "![](figs/big.emf){width=14.5}\n"  # 11 摘要图
        "![](figs/c.emf){width=14.5}\n"  # 12 多余摘要行
        "\n"
    )
    doc = figures_md.parse(text)
    assert [(f.file, f.width, f.line) for f in doc.spec] == [("big.emf", 17.5, 3)]
    assert (doc.abstract.file, doc.abstract.line) == ("big.emf", 11)
    assert [no for no, _ in doc.bad_lines] == [1, 4, 5, 6, 8, 9, 12]
    assert doc.bad_lines[1] == (4, "![图2 含空格](figs/my fig.png){width=10}")
    # 幂等：bad_lines 不进 serialize，重新解析后为空
    assert figures_md.parse(figures_md.serialize(doc)).bad_lines == []
    assert figures_md.serialize(doc) == (
        "# 说明书附图\n\n![图1 大图](figs/big.emf){width=17.5}\n\n# 摘要附图\n\n![](figs/big.emf){width=14.5}\n"
    )


def test_ast_carries_bad_lines():
    store = ProjectStore(EXAMPLES)
    content = store.read_content("method")
    doc = figures_md.parse(
        "# 说明书附图\n![图1 x](figs/fig1.emf)\n乱码行\n# 摘要附图\n![](figs/fig1.emf)\n![](figs/fig2.emf)\n"
    )
    ast = parse_ast(content, store.load_settings("method"), figures=doc)
    assert ast["figures_bad_lines"] == [{"line": 3, "text": "乱码行"}, {"line": 6, "text": "![](figs/fig2.emf)"}]
    assert parse_ast(content, store.load_settings("method"))["figures_bad_lines"] == []


def _legacy_copy(case, dest):
    """无 docs/、studio.json 带旧附图字段的案子（wave3 之前的持久化形状）。"""
    shutil.copytree(
        os.path.join(EXAMPLES, case), dest, ignore=shutil.ignore_patterns("docs", "*.docx", ".studio", "*.bak-*")
    )
    with open(os.path.join(dest, "studio.json"), encoding="utf-8") as f:
        s = json.load(f)
    old = figures_md.read(os.path.join(EXAMPLES, case)).legacy_view()
    s.update(old)
    with open(os.path.join(dest, "studio.json"), "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    return old


@pytest.mark.parametrize("case", ["method", "system"])
def test_migration_is_idempotent_and_zero_diff(tmp_path, case):
    old = _legacy_copy(case, str(tmp_path / case))
    assert not os.path.exists(figures_md.path_of(str(tmp_path / case)))
    store = ProjectStore(str(tmp_path))
    p = store.get(case)  # 首次加载（Project.settings）→ 生成 figures.md
    assert os.path.isfile(p.figures_md_path)
    s1 = store.load_settings(case)
    assert {"spec_figures": s1["spec_figures"], "abstract_figure": s1["abstract_figure"]} == old
    with open(p.figures_md_path, encoding="utf-8") as f:
        text1 = f.read()
    # 新语料题注行带 [NNNN] 段号前缀，CAPTION_RE（^图N为）不可见 → 迁移产物 alt 只有「图N」，
    # 无法复刻已提交的带题注 figures.md；零差口径改为 spec 文件/宽度/摘要图逐项一致
    committed = figures_md.read(os.path.join(EXAMPLES, case))
    migrated = figures_md.read(p.dir)
    assert [(f.file, f.width) for f in migrated.spec] == [(f.file, f.width) for f in committed.spec]
    assert (migrated.abstract.file, migrated.abstract.width) == (committed.abstract.file, committed.abstract.width)
    # alt 取自说明书「图N为…」
    assert all(f.alt.startswith(f"图{i}") for i, f in enumerate(figures_md.read(p.dir).spec, 1))
    store.load_settings(case)  # 再读不重写
    with open(p.figures_md_path, encoding="utf-8") as f:
        assert f.read() == text1
    # 旧字段不再落 studio.json
    store.save_settings(case, {**s1, "abstract_limit": s1.get("abstract_limit", 300)})
    with open(os.path.join(p.dir, "studio.json"), encoding="utf-8") as f:
        assert not ({"spec_figures", "abstract_figure"} & set(json.load(f)))


def _document_xml_md5(docx):
    with zipfile.ZipFile(docx) as z:
        return hashlib.md5(z.read("word/document.xml")).hexdigest()


# (Linux 基线, Windows 基线)——document.xml 序列化受 lxml/docx 版本微差影响，两平台各记一份
@pytest.mark.parametrize(
    "case,baseline",
    [
        ("method", {"f58e308dc5dcb3c594eccd11142691e5"}),
        ("system", {"75b57c286a75b32527c301e1c8c700f4"}),
    ],
)
def test_migrated_build_is_zero_drift(tmp_path, case, baseline):
    """旧 studio.json → 迁移生成 figures.md → 构建，word/document.xml md5 ∈ 基线（与 zero_drift.py 第三路同义）。"""
    from patent_studio.kernel.builder import build_patent_ex

    _legacy_copy(case, str(tmp_path / case))
    store = ProjectStore(str(tmp_path))
    p = store.get(case)
    cfg = store.build_config(p, out=str(tmp_path / f"{case}.docx"))
    build_patent_ex(cfg)
    assert _document_xml_md5(cfg["out"]) in baseline
    fresh = ProjectStore(EXAMPLES)
    cfg2 = fresh.build_config(fresh.get(case), out=str(tmp_path / f"{case}-src.docx"))
    build_patent_ex(cfg2)
    assert _document_xml_md5(cfg2["out"]) in baseline


def test_no_figures_md_and_no_legacy_infers_from_figs(tmp_path):
    d = tmp_path / "p"
    (d / "figs").mkdir(parents=True)
    for n in ("fig2.png", "fig1.emf", "note.txt"):
        (d / "figs" / n).write_bytes(b"x")
    md = "# T\n\n## 摘要\n\n摘。\n\n## 权利要求书\n\n1.一种X。\n\n## 说明书\n\n### 技术领域\n段。\n"
    (d / "content.md").write_text(md, encoding="utf-8")
    (d / "studio.json").write_text("{}", encoding="utf-8")
    store = ProjectStore(str(tmp_path))
    s = store.load_settings("p")
    assert s["spec_figures"] == [["fig1.emf", 15.0], ["fig2.png", 15.0]] and s["abstract_figure"] == ["fig1.emf", 14.5]
    assert os.path.isfile(store.get("p").figures_md_path)


@pytest.mark.parametrize("case", ["method", "system"])
def test_ast_figures_book_from_figures_md(case):
    store = ProjectStore(EXAMPLES)
    doc = figures_md.read(os.path.join(EXAMPLES, case))
    ast = parse_ast(store.read_content(case), store.load_settings(case), figures=doc)
    figs = ast["figures"]
    assert [f["num"] for f in figs] == list(range(1, len(doc.spec) + 1))
    assert all(f["book"] == "figures" and f["id"] == f"figures/{f['num']}" for f in figs)
    assert [(f["file"], f["width"], f["alt"]) for f in figs] == [(x.file, x.width, x.alt) for x in doc.spec]
    # 新语料题注行带 [NNNN] 前缀 → AST 取不到 caption（figures.caption_missing 真命中的同一根因）
    assert all(f["caption"] is None for f in figs)
    # 无 figures.md 时退回 settings，alt=None
    assert all(f["alt"] is None for f in parse_ast(store.read_content(case), store.load_settings(case))["figures"])


@pytest.fixture
def client(tmp_path, monkeypatch):
    for c in ("method",):
        shutil.copytree(
            os.path.join(EXAMPLES, c), tmp_path / c, ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*")
        )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(tmp_path))
    import importlib

    from app import config, main
    from app.domain import figures
    from app.domain import projects as projects_mod
    from app.routes import attachments as routes_attachments
    from app.routes import figures as routes_figures

    for m in (config, projects_mod, figures, routes_figures, routes_attachments, main):
        importlib.reload(m)
    return TestClient(main.app)


def test_ast_route_reports_bad_lines(client):
    r = client.get("/api/projects/method/ast")
    assert r.status_code == 200 and r.json()["figures_bad_lines"] == []
    store = ProjectStore(os.environ["PATENT_PROJECTS_DIR"])
    p = store.get("method")
    with open(p.figures_md_path, "a", encoding="utf-8") as f:
        f.write("没有图的一行\n")
    n = len(figures_md.read(p.dir).spec)
    r = client.get("/api/projects/method/ast")
    assert r.status_code == 200
    assert r.json()["figures_bad_lines"] == [{"line": n + 7, "text": "没有图的一行"}]  # 3 行头 + n + 4 行摘要节
    # 客端临时 settings 带 spec_figures → 旧路径，不读 figures.md
    r = client.post("/api/projects/method/ast", json={"settings": {"spec_figures": [["fig1.emf", 10]]}})
    assert r.status_code == 200 and r.json()["figures_bad_lines"] == [] and r.json()["figures"][0]["alt"] is None


def test_lint_route_carries_figures_md_rules(client):
    """/lint（问题面板 / build.safe_lint / MCP lint 同一入口）带 figures.alt_mismatch / file_missing。"""

    def ids(r):
        return [
            d["id"]
            for d in r.json()["diagnostics"]
            if "figures.alt_mismatch" in d["id"] or "figures.file_missing" in d["id"]
        ]

    r = client.post("/api/projects/method/lint", json={})
    assert r.status_code == 200 and ids(r) == []
    store = ProjectStore(os.environ["PATENT_PROJECTS_DIR"])
    p = store.get("method")
    doc = figures_md.read(p.dir)
    doc.spec[0] = figures_md.Figure("ghost.png", 15.0, "图1 别的题注", line=doc.spec[0].line)
    figures_md.write(p.dir, doc)
    r = client.post("/api/projects/method/lint", json={})
    assert r.status_code == 200
    # 新语料 AST caption 为 None → alt_mismatch 无可比对对象，只报 file_missing
    assert sorted(ids(r)) == ["preflight.figures.file_missing#1"]
    d = next(x for x in r.json()["diagnostics"] if x["id"] == "preflight.figures.file_missing#1")
    assert d["severity"] == "error" and d["line"] is None and "ghost.png" in d["message"]
    # 客端临时 settings 带 spec_figures → 旧路径，不读 figures.md
    r = client.post("/api/projects/method/lint", json={"settings": {"spec_figures": [["fig1.emf", 10]]}})
    assert r.status_code == 200 and ids(r) == []


def test_figures_api_has_alt_and_attachments_roundtrip(client):
    """figures 列表带 alt；attachments 四路由 200 走通（细节见 test_attachments.py）。"""
    r = client.get("/api/projects/method/figures")
    assert r.status_code == 200
    items = [f for f in r.json()["figures"] if f["num"]]
    assert items and all(isinstance(f["alt"], str) and f["alt"].startswith(f"图{f['num']}") for f in items)
    assert client.get("/api/projects/method/attachments").json() == {"items": []}
    r = client.post("/api/projects/method/attachments", files=[("files", ("a.pdf", b"%PDF", "application/pdf"))])
    assert r.status_code == 200, r.text
    (it,) = r.json()["items"]
    assert (it["name"], it["ext"], it["size"], it["kind"]) == ("a.pdf", ".pdf", 4, "pdf")
    assert it["url"] == "/api/projects/method/attachments/a.pdf" and it["mtime"].endswith("Z")
    r = client.get(it["url"])
    assert r.status_code == 200 and r.content == b"%PDF" and r.headers["content-type"] == "application/pdf"
    assert client.delete(it["url"]).json() == {"items": []}


@pytest.mark.parametrize("case", ["method", "system"])
def test_preflight_figures_md_rules(case):
    from patent_studio.kernel import preflight

    store = ProjectStore(EXAMPLES)
    content = store.read_content(case)
    s = store.load_settings(case)
    doc = figures_md.read(os.path.join(EXAMPLES, case))
    figs = store.list_figs(store.get(case).dir)
    ids = lambda rep, rule: [it for it in rep["items"] if it["rule"] == rule]  # noqa: E731

    # 两案 alt 由迁移取自「图N为…」→ 无 alt_mismatch；文件都在 → 无 file_missing
    rep = preflight.run(parse_ast(content, s, figures=doc), s, figs=figs)
    assert ids(rep, "figures.alt_mismatch") == [] and ids(rep, "figures.file_missing") == []

    # alt 改掉 → warning，落在附图书（book/line None，block_id=figures/1，detail 指向 figures.md）
    bad = figures_md.FiguresDoc(
        [figures_md.Figure("ghost.png", 15.0, "图1 别的题注", line=3)] + doc.spec[1:], doc.abstract, []
    )
    rep = preflight.run(parse_ast(content, s, figures=bad), s, figs=figs)
    # 新语料 AST caption 为 None → alt_mismatch 不触发（无可比对题注）
    assert ids(rep, "figures.alt_mismatch") == []
    (e,) = ids(rep, "figures.file_missing")
    assert e["severity"] == "error" and e["block_id"] == "figures/1" and "ghost.png" in e["message"]
    assert "docs/figures.md" in e["detail"]

    # figs=None → 不查文件存在；空 alt → 不比对
    empty_alt = figures_md.FiguresDoc([figures_md.Figure("ghost.png", 15.0, "", line=3)], doc.abstract, [])
    rep = preflight.run(parse_ast(content, s, figures=empty_alt), s, figs=None)
    assert ids(rep, "figures.alt_mismatch") == [] and ids(rep, "figures.file_missing") == []


def test_preflight_inline_figure_missing(client):
    """W18 批B：figures.inline_missing——说明书内嵌图块引用不存在的 figs/ 文件 → error。"""
    import pathlib

    from patent_studio.kernel import preflight

    projects = pathlib.Path(os.environ["PATENT_PROJECTS_DIR"])
    md = client.get("/api/projects/method/content").json()["content"]
    anchor = "### 技术领域\n"
    md = md.replace(anchor, anchor + "![示意](figs/ghost-inline.png){width=10}\n", 1)
    assert client.put("/api/projects/method/content", json={"content": md}).status_code == 200
    store = ProjectStore(projects)
    content = store.read_content("method")
    s = store.load_settings("method")
    doc = figures_md.read(str(projects / "method"))
    figs = store.list_figs(store.get("method").dir)
    rep = preflight.run(parse_ast(content, s, figures=doc), s, figs=figs)
    (e,) = [it for it in rep["items"] if it["rule"] == "figures.inline_missing"]
    assert e["severity"] == "error" and e["book"] == "description"
    assert "ghost-inline.png" in e["message"] and e["block_id"].startswith("description/")
    assert e["line"] == md.split("\n").index("![示意](figs/ghost-inline.png){width=10}") + 1
    assert e["detail"] == "示意"
    # 文件补齐 → 诊断消失
    (projects / "method" / "figs" / "ghost-inline.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    rep = preflight.run(parse_ast(content, s, figures=doc), s, figs=store.list_figs(store.get("method").dir))
    assert [it for it in rep["items"] if it["rule"] == "figures.inline_missing"] == []


# ---------- W5 R-FIG-02：每图可选 marks 表（标记号 → 名称） ----------

MARKS_SAMPLE = """# 说明书附图

![图1 总体流程图](figs/fig1.emf){width=15}
marks:
- 101 数据接入模块
- 1032 检索安全门控控制器
![图2 时间轴](figs/fig2.svg){width=15}

# 摘要附图

![](figs/fig1.emf){width=14.5}
"""


def test_marks_parse_serialize_roundtrip_and_legacy_view_unchanged():
    doc = figures_md.parse(MARKS_SAMPLE)
    assert doc.bad_lines == []
    assert [(f.file, f.width, f.alt, f.line) for f in doc.spec] == [
        ("fig1.emf", 15.0, "图1 总体流程图", 3),
        ("fig2.svg", 15.0, "图2 时间轴", 7),
    ]
    assert doc.spec[0].marks == {"101": "数据接入模块", "1032": "检索安全门控控制器"} and doc.spec[1].marks == {}
    assert list(doc.spec[0].marks) == ["101", "1032"]  # 保持书写顺序
    # legacy_view 形状不变（marks 不进旧字段）
    assert doc.legacy_view() == {
        "spec_figures": [["fig1.emf", 15.0], ["fig2.svg", 15.0]],
        "abstract_figure": ["fig1.emf", 14.5],
    }
    assert figures_md.serialize(doc) == MARKS_SAMPLE
    # 旧式位置参数构造仍可用，marks 缺省为空
    assert figures_md.Figure("a.emf", 15.0, "图1", 3).marks == {}


@pytest.mark.parametrize("case", ["method", "system"])
def test_old_files_without_marks_roundtrip_byte_for_byte(case):
    text = open(os.path.join(EXAMPLES, case, "docs", "figures.md"), encoding="utf-8").read()
    assert "marks:" not in text
    doc = figures_md.parse(text)
    assert all(f.marks == {} for f in doc.spec)
    assert figures_md.serialize(doc) == text
    assert figures_md.serialize(figures_md.parse(SAMPLE)) == figures_md.serialize(figures_md.parse(SAMPLE))


def test_marks_bad_lines_and_scope():
    text = (
        "# 说明书附图\n"  # 1
        "marks:\n"  # 2 图前的 marks：坏行
        "![图1 大图](figs/big.emf){width=15}\n"  # 3
        "marks:\n"  # 4
        "- 101 数据接入模块\n"  # 5
        "- 12 太短\n"  # 6 标记号须 3~4 位：坏行，并结束表
        "- 102 预处理模块\n"  # 7 表已结束：坏行
        "![图2 小图](figs/small.emf){width=15}\n"  # 8
        "marks:\n"  # 9
        "- 201 步骤\n"  # 10
        "\n"
        "- 202 隔了空行的步骤\n"  # 12 空行不结束表
        "# 摘要附图\n"  # 13
        "![](figs/big.emf){width=14.5}\n"  # 14
        "marks:\n"  # 15 摘要图不带 marks：坏行
        "- 301 x\n"  # 16
    )
    doc = figures_md.parse(text)
    assert doc.spec[0].marks == {"101": "数据接入模块"}
    assert doc.spec[1].marks == {"201": "步骤", "202": "隔了空行的步骤"}
    assert [no for no, _ in doc.bad_lines] == [2, 6, 7, 15, 16]
    assert figures_md.parse(figures_md.serialize(doc)).bad_lines == []
    assert figures_md.serialize(doc) == (
        "# 说明书附图\n\n![图1 大图](figs/big.emf){width=15}\nmarks:\n- 101 数据接入模块\n"
        "![图2 小图](figs/small.emf){width=15}\nmarks:\n- 201 步骤\n- 202 隔了空行的步骤\n\n"
        "# 摘要附图\n\n![](figs/big.emf){width=14.5}\n"
    )


def test_apply_legacy_keeps_marks_of_same_file():
    doc = figures_md.parse(MARKS_SAMPLE)
    figures_md.apply_legacy(doc, spec_figures=[["fig2.svg", 12], ["fig1.emf", 15], ["fig3.png", 15]])
    assert [(f.file, f.width, f.alt, f.marks) for f in doc.spec] == [
        ("fig2.svg", 12.0, "图2 时间轴", {}),
        ("fig1.emf", 15.0, "图1 总体流程图", {"101": "数据接入模块", "1032": "检索安全门控控制器"}),
        ("fig3.png", 15.0, "图3", {}),
    ]
