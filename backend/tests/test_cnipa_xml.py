# -*- coding: utf-8 -*-
"""CNIPA 五书 XML 导出：结构单测（无 LibreOffice）+ 真实 method 案端到端（需 soffice + pdftoppm，缺则跳过）。"""
import os
import re
import shutil
import zipfile

import pytest
from lxml import etree
from pypdf import PdfWriter

from app import config
from patent_docx import cnipa_xml as cx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
METHOD = os.path.join(ROOT, "examples", "method")
HAS_RENDER = shutil.which(config.SOFFICE) is not None and shutil.which("pdftoppm") is not None


def _xml(el):
    return etree.tostring(el, encoding="unicode")


def test_inline_text_subscripts_and_sub_except():
    p = etree.Element("p")
    cx.inline_text(p, "误差e_t与q_{L}和r_[k]，但a_t与Σ_t保留", sub_except=("a_t", "Σ_t"))
    # 与 builder.add_math_text 一致：_{L} 去花括号，_[k] 保留方括号
    assert _xml(p) == "<p>误差e<sub>t</sub>与q<sub>L</sub>和r<sub>[k]</sub>，但a_t与Σ_t保留</p>"


def test_claim_refs_only_backward():
    ct = etree.Element("claim-text")
    cx.claim_text_with_refs(ct, "根据权利要求1至3所述的方法，其特征在于，参见权利要求7，且g_t>0", 5, ())
    assert _xml(ct) == ('<claim-text>根据<claim-ref idref="c1 c2 c3">权利要求1至3</claim-ref>所述的方法，'
                        '其特征在于，参见权利要求7，且g<sub>t</sub>&gt;0</claim-text>')


def test_description_sections_and_paragraph_numbers():
    ex = cx._Exporter({"sub_except": (), "style": None})
    spec = [("h", "技术领域"), "本发明涉及X_1。", ("h", "发明内容"), ("s", "技术方案"), "步骤一。",
            ("e", "a=b", ""), ("t", [["A", "B"], ["1", "2"]], {"表题后置": "表1 结果"}), ("c", ["x = 1"]),
            ("h", "自定义章节"), "尾段。"]
    root, n = ex.description("标题", spec)
    assert n == 6  # 3 文本段 + 表格(1) + 表题后置(1) + 伪代码(1)；公式挂在上一段不占段号（与 builder 一致）
    desc = root.find("description")
    assert desc.find("invention-title").text == "标题"
    assert [c.tag for c in desc] == ["invention-title", "technical-field", "disclosure", "heading", "p"]
    disc = desc.find("disclosure")
    assert [(c.tag, c.get("level")) for c in disc][:3] == [("heading", "1"), ("heading", "2"), ("p", None)]
    nums = [p.get("num") for p in desc.iter("p")]
    assert nums == ["0001", "0002", "0003", "0004", "0005", "0006"]
    assert desc.findall(".//maths")[0].getparent().get("num") == "0002"  # 公式属于"步骤一。"那一段
    assert desc.findall(".//tables")[0].getparent().get("num") == "0003"
    assert desc.findall(".//pre")[0].getparent().get("num") == "0005"
    assert [a.kind for a in ex.assets] == ["eq", "tbl"]
    assert [a.name for a in ex.assets] == ["100002-m0001.jpg", "100002-t0001.jpg"]


def test_description_inline_figure_is_stripped_for_filing():
    """W18：("f", file, width, alt) 说明书内嵌图属非递交版式，XML 剔除且计数上报。"""
    ex = cx._Exporter({"sub_except": (), "style": None})
    spec = [("h", "技术领域"), "段一。", ("f", "fig1.emf", 12.5, "图1"), "段二。"]
    root, n = ex.description("标题", spec)
    assert n == 2
    nums = [p.get("num") for p in root.find("description").iter("p")]
    assert nums == ["0001", "0002"]  # 内嵌图不占编号
    assert not list(root.iter("img")) and not list(root.iter("object"))
    assert ex.dropped_inline_figs == 1


@pytest.mark.skipif(shutil.which("pdftoppm") is None, reason="需要 poppler-utils")
def test_blank_rendered_objects_report_missing_math(tmp_path):
    """公式页全白（如 LibreOffice 缺 libreoffice-math）→ 明确报错，而不是泛泛的页数不符。"""
    ex = cx._Exporter({"sub_except": (), "style": None})
    ex.description("标题", [("h", "技术领域"), "段。", ("e", "a=b", ""), ("e", "c=d", "")])

    def blank_pdf(docx_path, out_dir):
        w = PdfWriter()
        for _ in ex.assets:
            w.add_blank_page(width=595, height=842)
        with open(os.path.join(out_dir, "assets.pdf"), "wb") as f:
            w.write(f)

    with pytest.raises(cx.XmlExportError, match="公式.*libreoffice-math"):
        cx._render_assets(ex.assets, ex.style, ex.sub_except, str(tmp_path), blank_pdf, "pdftoppm", str(tmp_path))


def test_validate_against_official_dtd(tmp_path):
    ex = cx._Exporter({"sub_except": (), "style": None})
    root = ex.claims(["1.一种方法，包括：\n步骤A。", "2.根据权利要求1所述的方法。"])
    good = tmp_path / "ok.xml"
    good.write_text(cx.serialize(root), encoding="utf-8")
    valid, errors = cx.validate_xml(str(good))
    assert valid and errors == []

    root.find("cn-claims/claim").set("num", "x")  # num 必须是 NMTOKEN…但改结构更稳：塞一个非法子元素
    etree.SubElement(root.find("cn-claims"), "bogus")
    bad = tmp_path / "bad.xml"
    bad.write_text(cx.serialize(root), encoding="utf-8")
    valid, errors = cx.validate_xml(str(bad))
    assert not valid and any("bogus" in e for e in errors)


def test_drawings_nondeterministic_dtd_error_is_ignored(tmp_path):
    ex = cx._Exporter({"sub_except": (), "style": None})
    root = ex.drawings([("fig1.emf", 15.0)])
    p = tmp_path / "d.xml"
    p.write_text(cx.serialize(root), encoding="utf-8")
    valid, errors = cx.validate_xml(str(p))
    assert valid, errors


def test_gb18030_issues():
    p = etree.Element("p")
    p.text = "普通文本 𝔸 ✓"
    assert cx.gb18030_issues(p) == []  # GB18030 覆盖全部 Unicode 码位，不应出现越界
    assert cx.gb18030_issues(etree.Element("p")) == []


@pytest.mark.skipif(not HAS_RENDER, reason="需要 soffice 与 pdftoppm")
def test_method_end_to_end_zip(tmp_path):
    from app.domain.projects import ProjectStore
    from app.lo import docx_to_pdf

    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(METHOD, projects / "method", ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    store = ProjectStore(str(projects))
    cfg = store.build_config(store.get("method"), out=str(tmp_path / "x.docx"))
    res = cx.export_cnipa_xml(cfg, str(tmp_path / "xml"), docx_to_pdf)
    assert res.valid, [b.errors for b in res.books]
    assert res.counts == {"claims": 11, "paragraphs": 98, "figures": 6, "equations": 17, "tables": 2,
                          "abstract_chars": 253}
    with zipfile.ZipFile(res.zip_path) as z:
        names = z.namelist()
    for code, _ in cx.BOOKS:
        assert f"{code}/{code}.xml" in names
    assert "100003/100003-0001.jpg" in names and "100005/100005-0001.jpg" in names
    assert sum(n.endswith(".jpg") for n in names) == 17 + 2 + 6 + 1
    dr = etree.parse(str(tmp_path / "xml" / "100003" / "100003.xml"))
    img = dr.find(".//img")
    assert int(img.get("he")) > 50 and int(img.get("wi")) > 50 and img.get("img-format") == "jpg"


@pytest.mark.skipif(not HAS_RENDER, reason="需要 soffice 与 pdftoppm")
def test_no_spec_figures_generates_four_books_and_warns_about_100003_only(tmp_path):
    """摘要附图是必填（build_config 422），所以没有说明书附图时 100005 仍会生成，只缺 100003；
    警告文案不能再说「未生成 100003/100005」。"""
    from app.domain.projects import ProjectStore
    from app.lo import docx_to_pdf

    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(METHOD, projects / "method", ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    store = ProjectStore(str(projects))
    p = store.get("method")
    cfg = store.build_config(p, out=str(tmp_path / "x.docx"), settings={**p.settings, "spec_figures": []})
    assert cfg["spec_figures"] == [] and cfg["abstract_figure"]
    res = cx.export_cnipa_xml(cfg, str(tmp_path / "xml"), docx_to_pdf)
    assert [b.code for b in res.books] == ["100001", "100002", "100004", "100005"]
    assert res.valid
    warn = [w for w in res.warnings if "100003" in w]
    assert len(warn) == 1 and "100005" not in warn[0]


@pytest.mark.skipif(not HAS_RENDER, reason="需要 soffice 与 pdftoppm")
def test_api_export_xml_and_download(tmp_path, monkeypatch):
    import importlib

    from fastapi.testclient import TestClient

    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(METHOD, projects / "method", ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    from app import main
    from app.domain import projects as projects_mod
    from app.domain import xml_export

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(xml_export)
    importlib.reload(main)
    c = TestClient(main.app)

    r = c.post("/api/projects/method/export/xml", json={})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "ok" and j["valid"] is True and len(j["books"]) == 5
    z = c.get(j["zip_url"])
    assert z.status_code == 200 and z.content[:2] == b"PK"
    assert "CNIPA-XML" in z.headers["content-disposition"]
    html = c.get(j["books"][1]["preview_url"])
    assert html.status_code == 200 and "技术领域" in html.text and "0001" in html.text
    xml = c.get(j["books"][0]["xml_url"])
    assert xml.status_code == 200 and "<cn-claims>" in xml.text
    assert c.get(f"/api/projects/method/xml/{j['xid']}/100002/../../content.md").status_code in (400, 404)
    assert c.get(f"/api/projects/method/xml/{j['xid']}/100002/nope.jpg").status_code == 404

    # 设置错误（缺附图）→ 可读错误而非 500
    r = c.post("/api/projects/method/export/xml", json={"settings": {"abstract_figure": ["nope.emf", 14.5]}})
    assert r.status_code == 200 and r.json()["status"] == "error"
    assert r.json()["error"]["kind"] == "figure"

    # DOCX 能排但 DTD 不允许：权利要求书为空 → 带行号的内容错误（前端「定位」按钮依赖 line），而非裸 DTD 英文报错
    with open(os.path.join(METHOD, "content.md"), encoding="utf-8") as f:
        md = f.read()
    empty_claims = re.sub(r"## 权利要求书\n.*?(?=\n## )", "## 权利要求书\n", md, count=1, flags=re.S)
    r = c.post("/api/projects/method/export/xml", json={"content": empty_claims})
    assert r.status_code == 200 and r.json()["status"] == "error"
    err = r.json()["error"]
    assert err["kind"] == "content" and err["message"].startswith("权利要求书为空")
    assert empty_claims.splitlines()[err["line"] - 1] == "## 权利要求书"


@pytest.mark.skipif(not HAS_RENDER, reason="需要 soffice 与 pdftoppm")
def test_failed_export_does_not_evict_good_build(tmp_path, monkeypatch):
    """R43-01：失败导出不得进 KEEP_BUILDS 名额——连续失败若干次后上一份成功导出仍可下载。"""
    import importlib

    from fastapi.testclient import TestClient

    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(METHOD, projects / "method", ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("LO_PROFILE_DIR", str(tmp_path / "lo"))
    from app import main
    from app.domain import projects as projects_mod
    from app.domain import xml_export

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(xml_export)
    importlib.reload(main)
    c = TestClient(main.app)

    good = c.post("/api/projects/method/export/xml", json={}).json()
    assert good["status"] == "ok"

    bad = {"settings": {"abstract_figure": ["nope.emf", 14.5]}}
    for _ in range(config.KEEP_BUILDS + 2):
        r = c.post("/api/projects/method/export/xml", json=bad)
        assert r.json()["status"] == "error"

    assert c.get(good["zip_url"]).status_code == 200
    assert c.post("/api/projects/method/export/xml", json={}).json()["status"] == "ok"
