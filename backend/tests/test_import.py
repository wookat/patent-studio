# -*- coding: utf-8 -*-
"""F3 Word 导入：docx_import 映射表 + importer 落盘 + 路由契约 + 两案回归（docs/plan/10 §5）。

fixture：tests/fixtures/import_native.docx（Word 原生样式：Heading 1/2/3、gridSpan+vMerge 表、图片、
OMML 行内/独立公式、脚注/文本框/域）由本文件 build_native_fixture() 生成；两案回归直接用内核 build 的 DOCX。
"""
import copy
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import zipfile

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Cm, Pt
from fastapi.testclient import TestClient
from PIL import Image

from app.domain.projects import ProjectStore
from app.routes import imports as routes_import
from patent_studio.kernel import docx_import
from patent_studio.kernel.builder import build_patent_ex
from patent_studio.kernel.omml import append_omml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
NATIVE = os.path.join(FIXTURES, "import_native.docx")
UNIT = "F3-docx-import-templates"


# ---------------- fixture 生成 ----------------

def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _raw(p, xml):
    p._p.append(parse_xml(xml))


def build_native_fixture() -> bytes:
    """Word 原生风格的三书文档（不依赖内核 builder）。"""
    d = Document()
    d.add_paragraph("一种带表格与公式的示例装置", style="Title")
    d.add_paragraph("摘要", style="Heading 1")
    p = d.add_paragraph("本发明公开了一种示例装置，包含参数x")
    r = p.add_run("i")
    r.font.subscript = True
    p.add_run("与阈值τ。")
    d.add_paragraph("权利要求书", style="Heading 1")
    d.add_paragraph("1.一种示例装置，其特征在于，包括处理器与存储器；")
    d.add_paragraph("所述处理器配置为执行步骤A。")
    d.add_paragraph("2.根据权利要求1所述的示例装置，其特征在于，还包括显示器。")
    d.add_paragraph("说明书", style="Heading 1")
    d.add_paragraph("技术领域", style="Heading 2")
    d.add_paragraph("[0001]\u3000本发明涉及数据处理技术领域，标识符 tsf_guard 保持字面。")
    d.add_paragraph("具体实施方式", style="Heading 2")
    d.add_paragraph("实施例一", style="Heading 3")
    p = d.add_paragraph("[0002]\u3000行内公式 ")
    append_omml(p, "a_i = b_i^2")
    p.add_run(" 与上标 ")
    _raw(p, '<m:oMath %s><m:sSup><m:sSupPr/><m:e><m:r><m:t>b</m:t></m:r></m:e>'
            '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>' % nsdecls("m"))
    p.add_run(" 之后的文字")
    # 脚注引用 + 文本框 + 域
    p = d.add_paragraph("[0003]\u3000带脚注的句子")
    _raw(p, '<w:r %s><w:footnoteReference w:id="1"/></w:r>' % nsdecls("w"))
    _raw(p, '<w:r %s><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>'
            '<w:p><w:r><w:t>文本框内容</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>'
         % nsdecls("w"))
    _raw(p, '<w:fldSimple %s w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple>' % nsdecls("w"))
    # 独立公式：1×3 无框表，中格 OMML，右格编号
    t = d.add_table(rows=1, cols=3)
    t._tbl.tblPr.append(parse_xml(
        '<w:tblBorders %s>' % nsdecls("w") +
        "".join('<w:%s w:val="none"/>' % e for e in ("top", "left", "bottom", "right", "insideH", "insideV")) +
        "</w:tblBorders>"))
    append_omml(t.cell(0, 1).paragraphs[0], "E = Σ_{i∈S}(x_i − μ)/n")
    t.cell(0, 2).paragraphs[0].add_run("（1）")
    d.add_paragraph("[0004]\u3000表1给出了参数。")
    # 数据表：表头横向合并 2 格 + 第一列纵向合并
    t = d.add_table(rows=3, cols=3)
    t.style = "Table Grid"
    t.cell(0, 0).text = "分组"
    t.cell(0, 1).merge(t.cell(0, 2)).text = "指标"
    t.cell(1, 0).text = "A"
    t.cell(1, 1).text = "1"
    t.cell(1, 2).text = "2"
    t.cell(1, 0).merge(t.cell(2, 0))
    t.cell(2, 1).text = "3"
    t.cell(2, 2).text = "4"
    d.add_paragraph("说明书附图", style="Heading 1")
    p = d.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(io.BytesIO(_png()), width=Cm(12))
    d.add_paragraph("图1").alignment = WD_ALIGN_PARAGRAPH.CENTER
    for para in d.paragraphs:
        for r in para.runs:
            if r.font.size is None and para.style.name == "Normal":
                r.font.size = Pt(10.5)
                r.font.name = "Arial"
                r._element.rPr.rFonts.set(qn("w:eastAsia"), "仿宋")
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def test_native_fixture_up_to_date():
    """仓库内 fixture 必须能被 build_native_fixture() 重建（比较文档 XML，忽略 zip 时间戳）。"""
    def doc_xml(data):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return z.read("word/document.xml")
    assert doc_xml(open(NATIVE, "rb").read()) == doc_xml(build_native_fixture())


# ---------------- 映射表 ----------------

@pytest.fixture()
def native(tmp_path):
    md, rep = docx_import.import_docx(open(NATIVE, "rb").read(), str(tmp_path / "figs"))
    return md, rep, tmp_path


def test_native_books_and_headings(native):
    md, rep, _ = native
    lines = md.splitlines()
    assert lines[0] == "# 一种带表格与公式的示例装置"
    assert [ln for ln in lines if ln.startswith("## ")] == ["## 摘要", "## 权利要求书", "## 说明书"]
    assert "### 技术领域" in lines and "### 具体实施方式" in lines and "#### 实施例一" in lines
    assert rep.books == {"abstract": 1, "claims": 3, "description": 11}
    assert not [i for i in rep.items if i.code in ("title.guessed", "book.missing")]


def test_native_paragraph_mapping(native):
    md, rep, _ = native
    assert "本发明公开了一种示例装置，包含参数x_i与阈值τ。" in md  # 下标 run → _x
    claims = md.split("## 权利要求书\n")[1].split("## 说明书")[0].strip().split("\n\n")
    assert claims[0] == "1.一种示例装置，其特征在于，包括处理器与存储器；\n所述处理器配置为执行步骤A。"
    assert claims[1].startswith("2.根据权利要求1")
    assert "本发明涉及数据处理技术领域，标识符 tsf_guard 保持字面。" in md  # [0001] 段号剥离
    assert rep.sub_except == ["tsf_guard"]


def test_native_formulas(native):
    md, rep, _ = native
    md_ns = md.replace(" ", "")  # XSL 链线性化剥空格，公式等价
    assert "$$E=Σ_{i∈S}(x_i−μ)/n$$（1）" in md_ns
    assert "行内公式a_i=b_i^2与上标b^2之后的文字" in md_ns
    codes = {(i.code, i.text.replace(" ", "")) for i in rep.items}
    assert ("formula.inline", "a_i=b_i^2") in codes and ("formula.inline", "b^2") in codes
    partial = [i for i in rep.items if i.code == "formula.partial"]
    assert len(partial) == 1 and partial[0].text == "b^2"
    assert "<m:sSup" in partial[0].detail and partial[0].para_index == 13


def test_native_table_and_figure(native):
    md, rep, figs = native
    assert "| 分组 | 指标 |  |\n| A | 1 | 2 |\n| ^^ | 3 | 4 |" in md
    assert any(i.code == "table.merged" for i in rep.items)
    assert rep.figures == ["图1.png"] and (figs / "figs" / "图1.png").is_file()
    assert rep.figure_settings == {"abstract_figure": ["图1.png", 12.0], "spec_figures": [["图1.png", 12.0]]}
    assert "图1" not in md.split("## 说明书")[1]  # 附图节文字不进正文


def test_native_unsupported_reported(native):
    _, rep, _ = native
    by_code = {i.code: i for i in rep.items}
    assert by_code["unsupported.footnote"].text == "1"
    assert by_code["unsupported.textbox"].text == "文本框内容"
    assert by_code["unsupported.field"].text.strip() == "PAGE"
    assert by_code["unsupported.footnote"].para_index == by_code["unsupported.textbox"].para_index


def test_native_styles(native):
    _, rep, _ = native
    s = rep.style_suggestion
    assert s.style["fonts"] == {"body_cjk": "仿宋", "ascii": "Arial"}
    assert s.style["sizes"]["body"] == 10.5
    assert s.style["page"]["width_cm"] == 21.6 and s.style["page"]["margin_left_mm"] == 31.8
    assert s.evidence["fonts.body_cjk"].startswith("多数 run/段：仿宋")
    assert docx_import.extract_styles(open(NATIVE, "rb").read()) == s


def test_title_guessed_and_missing_books(tmp_path):
    d = Document()
    d.add_paragraph("只有一段普通文字。")
    buf = io.BytesIO()
    d.save(buf)
    md, rep = docx_import.import_docx(buf.getvalue(), str(tmp_path))
    codes = [i.code for i in rep.items]
    assert codes.count("title.guessed") == 1 and codes.count("book.missing") == 2  # 无标题时正文归入说明书
    assert md.startswith("# 未命名发明\n") and "## 说明书\n\n只有一段普通文字。" in md
    assert rep.figures == [] and not os.listdir(tmp_path)


def test_not_a_docx():
    with pytest.raises(docx_import.DocxImportError):
        docx_import.import_docx(b"PK\x03\x04junk", "/nonexistent")
    with pytest.raises(docx_import.DocxImportError):
        docx_import.extract_styles(b"hello")


def test_import_report_schema():
    rep = docx_import.ImportReport(books={"abstract": 3, "claims": 10, "description": 80}, figures=["图1.png"],
                                   items=[docx_import.ReportItem(code="formula.partial", para_index=12, text="…")])
    assert rep.model_dump()["items"][0]["detail"] is None and rep.style_suggestion is None
    assert set(docx_import.BOOK_HEADINGS) == {"abstract", "claims", "description"}


# ---------------- 两案回归（§5.4）----------------

def _example_config(name, out, content_md=None, figs_dir=None, settings=None):
    store = ProjectStore(os.path.join(ROOT, "examples"))
    project = store.get(name)
    cfg = store.build_config(project, out=out, content_md=content_md or os.path.join(project.dir, "content.md"),
                             settings=settings)
    if figs_dir:
        cfg["figs_dir"] = figs_dir
    return cfg


def _doc_xml_md5(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    xml = re.sub(r'name="[^"]*"', "", xml)  # 图片部件文件名（fig1.emf → 图1.emf）
    # 数学 run 边界归一化：XSL 路径与回读再解析的 run 切分不同但可见文本一致
    xml = re.sub(r"</m:r><m:r><w:rPr>.*?</w:rPr>", "", xml)
    xml = re.sub(r"</m:r><m:r>", "", xml)
    xml = re.sub(r"</m:t><m:t[^>]*>", "", xml)
    return hashlib.md5(xml.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("name", ["method", "system"])
def test_example_roundtrip_document_xml(tmp_path, name):
    """内核 build 的 DOCX → import → 再 build：document.xml 除图片文件名外逐字节一致。"""
    orig = str(tmp_path / "orig.docx")
    build_patent_ex(_example_config(name, orig))
    proj = tmp_path / "proj"
    proj.mkdir()
    md, rep = docx_import.import_docx(open(orig, "rb").read(), str(proj / "figs"))
    (proj / "content.md").write_text(md, encoding="utf-8")
    assert [i.code for i in rep.items] == []
    store = ProjectStore(os.path.join(ROOT, "examples"))
    settings = copy.deepcopy(store.load_settings(name))
    settings.update(rep.figure_settings)
    settings["sub_except"] += [x for x in rep.sub_except if x not in settings["sub_except"]]
    again = str(tmp_path / "again.docx")
    build_patent_ex(_example_config(name, again, content_md=str(proj / "content.md"), figs_dir=str(proj / "figs"),
                                    settings=settings))
    assert _doc_xml_md5(orig) == _doc_xml_md5(again)


@pytest.mark.skipif(not shutil.which("soffice") or not shutil.which("pdftotext"), reason="需要 LibreOffice + poppler")
@pytest.mark.parametrize("name", ["method", "system"])
def test_example_roundtrip_pdftotext(tmp_path, name):
    from app.lo import docx_to_pdf

    orig = str(tmp_path / "orig.docx")
    build_patent_ex(_example_config(name, orig))
    proj = tmp_path / "proj"
    proj.mkdir()
    md, rep = docx_import.import_docx(open(orig, "rb").read(), str(proj / "figs"))
    (proj / "content.md").write_text(md, encoding="utf-8")
    store = ProjectStore(os.path.join(ROOT, "examples"))
    settings = copy.deepcopy(store.load_settings(name))
    settings.update(rep.figure_settings)
    again = str(tmp_path / "again.docx")
    build_patent_ex(_example_config(name, again, content_md=str(proj / "content.md"), figs_dir=str(proj / "figs"),
                                    settings=settings))
    texts = []
    for docx in (orig, again):
        out = tmp_path / os.path.basename(docx).replace(".docx", "")
        out.mkdir()
        docx_to_pdf(docx, str(out))
        pdf = out / "out.pdf"
        if not pdf.exists():
            pdf = next(out.glob("*.pdf"))
        txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True).stdout
        texts.append(re.sub(r"\s+", " ", txt.decode("utf-8")).strip())
    assert texts[0] == texts[1]


# ---------------- 服务层 + 路由 ----------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    import importlib

    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    return TestClient(main.app), projects


def test_import_route_creates_project(client):
    c, projects = client
    data = open(NATIVE, "rb").read()
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    files = {"file": ("示例 装置(v2).docx", data, mime)}
    r = c.post("/api/projects/import/docx", files=files, data={"apply_styles": "false"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["project"]["id"] == "示例-装置-v2"
    assert body["project"]["title"] == "一种带表格与公式的示例装置"
    assert body["project"]["content"].startswith("# 一种带表格与公式的示例装置\n")
    assert set(body["report"]) >= {"books", "figures", "items", "style_suggestion"}
    assert body["report"]["figures"] == ["图1.png"]
    p = c.get("/api/projects/示例-装置-v2").json()
    assert p["figs"] == ["图1.png"]  # 占位 fig1.png 已被替换
    assert p["settings"]["abstract_figure"] == ["图1.png", 12.0]
    assert p["settings"]["style"] == {}
    assert "tsf_guard" in p["settings"]["sub_except"]
    assert (projects / "示例-装置-v2" / "docs" / "claims.md").is_file()  # save_content 走了三书镜像
    # 同名再导入 → -2；显式 id/title
    assert c.post("/api/projects/import/docx", files=files).json()["project"]["id"] == "示例-装置-v2-2"
    r = c.post("/api/projects/import/docx", files=files, data={"id": "案A", "title": "自定义标题"})
    assert r.status_code == 201 and r.json()["project"]["title"] == "自定义标题"
    assert r.json()["project"]["content"].startswith("# 自定义标题\n")
    style = c.get("/api/projects/案A").json()["settings"]["style"]
    assert style["fonts"]["body_cjk"] == "仿宋"  # apply_styles 默认 true
    assert c.post("/api/projects/import/docx", files=files, data={"id": "案A"}).status_code == 409
    assert c.post("/api/projects/import/docx", files=files, data={"id": "bad id!"}).status_code == 400
    # 部分采纳：style JSON 优先于 apply_styles
    r = c.post("/api/projects/import/docx", files=files,
               data={"id": "案B", "apply_styles": "false", "style": json.dumps({"fonts": {"body_cjk": "仿宋"}})})
    assert r.status_code == 201
    assert c.get("/api/projects/案B").json()["settings"]["style"] == {"fonts": {"body_cjk": "仿宋"}}
    r = c.post("/api/projects/import/docx", files=files, data={"id": "案C", "style": "not json"})
    assert r.status_code == 400 and r.json()["detail"]["kind"] == "import"


def test_import_route_rejects_non_docx(client):
    c, projects = client
    files = {"file": ("案.docx", b"PK\x03\x04", "application/octet-stream")}
    r = c.post("/api/projects/import/docx", files=files, data={"title": "x"})
    assert r.status_code == 400 and r.json()["detail"]["kind"] == "import"
    assert not (projects / "案").exists()  # 失败不留半成品
    assert c.post("/api/import/docx/styles", files=files).status_code == 400
    assert c.post("/api/projects/import/docx").status_code == 422  # file 必填


def test_styles_route(client):
    c, _ = client
    files = {"file": ("x.docx", open(NATIVE, "rb").read(), "application/octet-stream")}
    r = c.post("/api/import/docx/styles", files=files)
    assert r.status_code == 200
    assert r.json()["style"]["fonts"]["body_cjk"] == "仿宋" and "fonts.body_cjk" in r.json()["evidence"]


def test_import_oversized_413(client, monkeypatch):
    """R42-02：导入上限=附件上限（50MB，测试内 monkeypatch 缩小口径验证 413）。"""
    c, _ = client

    monkeypatch.setattr(routes_import, "ATTACHMENT_MAX_BYTES", 1024)
    big = b"PK\x03\x04" + b"x" * 2048
    files = {"file": ("big.docx", big, "application/octet-stream")}
    r = c.post("/api/projects/import/docx", files=files)
    assert r.status_code == 413 and r.json()["detail"]["kind"] == "import"
    assert c.post("/api/import/docx/styles", files=files).status_code == 413
