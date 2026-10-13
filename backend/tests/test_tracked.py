# -*- coding: utf-8 -*-
"""F2 Word 真修订导出：builder run_hook 挂钩 + TrackedRuns（w:ins/w:del/批注/高亮）+ 路由（docs/plan/10 §4.3）。"""
import hashlib
import os
import shutil
import subprocess
import zipfile

import pytest
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from fastapi.testclient import TestClient
from lxml import etree

from app import config
from app.domain.projects import ProjectStore
from app.main import app
from patent_studio.kernel import tracked
from patent_studio.kernel.builder import build_patent_ex

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
# document.xml 序列化受 lxml/docx 版本微差影响——Linux 基线 + Windows 基线各记一份
BASELINE_METHOD = {"9ffc298f03fa301c034899f3fb5253ef", "7b75e50c32df42d9c1da394229e75771"}
HAS_RENDER = shutil.which(config.SOFFICE) is not None and shutil.which("pdftotext") is not None
DATE = "2026-09-05T00:00:00Z"


def _document_xml(path):
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml")


def _cfg(name, out, content_md=None):
    store = ProjectStore(EXAMPLES)
    return store.build_config(store.get(name), out=out,
                              content_md=content_md or os.path.join(EXAMPLES, name, "content.md"))


def _method_md():
    with open(os.path.join(EXAMPLES, "method", "content.md"), encoding="utf-8") as f:
        return f.read()


def _marked_method(tmp_path):
    """在 method 案里注入五种标记：权项段首批注、正文 ins/del/替换、标题高亮、表格单元格、公式行、摘要。"""
    lines = _method_md().split("\n")
    edits = {
        5: lambda l: l[:6] + "{++（摘要插入）++}" + l[6:],                                   # 摘要
        9: lambda l: "{>>段首批注<<}" + l + "{==权项高亮==}",                                 # 权项 1 首行
        16: lambda l: l[:-2] + "{+++1++}$$",                                                # 权项公式行 → final
        47: lambda l: l + "{--标题删除--}",                                                  # ### 技术领域
        49: lambda l: l[:5] + "{++插入文本++}" + l[5:10] + "{--删掉的 --}" + l[10:] + "{>>正文批注<<}",
        53: lambda l: l[:8] + "{~~旧词~>新词~~}" + l[8:],
        211: lambda l: l.replace("| 28 |", "| {--28--}{++29++} |", 1),                     # 表格单元格
    }
    for no, fn in edits.items():
        lines[no - 1] = fn(lines[no - 1])
    lines.insert(9, "{++跨行插入")  # 未闭合：按普通文本排版
    path = tmp_path / "marked.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)


class InsAll:
    """假挂钩：每段文本切成一片、全部包进 w:ins —— 证明 split/wrap 被调用且 run 元素原样交付。"""

    def __init__(self):
        self.calls = 0
        self.wrapped = 0

    def split(self, text):
        return [("ins", text)]

    def wrap(self, p, kind, runs):
        self.calls += 1
        assert kind == "ins" and all(r.tag == qn("w:r") for r in runs)
        if not runs:  # 空文本（如空行）不产生 run
            return
        self.wrapped += 1
        ins = OxmlElement("w:ins")
        ins.set(qn("w:id"), str(self.wrapped))
        ins.set(qn("w:author"), tracked.DEFAULT_AUTHOR)
        runs[0].addprevious(ins)
        for r in runs:
            ins.append(r)


def test_no_hook_is_zero_drift(tmp_path):
    cfg = _cfg("method", str(tmp_path / "a.docx"))
    assert "run_hook" not in cfg
    build_patent_ex(cfg)
    assert hashlib.md5(_document_xml(cfg["out"])).hexdigest() in BASELINE_METHOD


def test_hook_wraps_every_text_run(tmp_path):
    plain = _cfg("method", str(tmp_path / "plain.docx"))
    build_patent_ex(plain)
    hook = InsAll()
    hooked = _cfg("method", str(tmp_path / "hooked.docx"))
    hooked["run_hook"] = hook
    build_patent_ex(hooked)
    assert hook.calls > 100
    a = etree.fromstring(_document_xml(plain["out"]))
    b = etree.fromstring(_document_xml(hooked["out"]))
    assert len(a.findall(".//w:r", NS)) == len(b.findall(".//w:r", NS))
    assert len(b.findall(".//w:ins", NS)) == hook.wrapped
    assert [t.text for t in a.findall(".//w:t", NS)] == [t.text for t in b.findall(".//w:t", NS)]


# --- TrackedRuns.split ---

def test_split_plain_and_each_kind():
    h = tracked.TrackedRuns()
    assert h.split("无标记文本") == [("keep", "无标记文本")]
    assert h.split("") == [("keep", "")]
    assert h.split("甲{++乙++}丙") == [("keep", "甲"), ("ins", "乙"), ("keep", "丙")]
    assert h.split("{--乙--}丙") == [("del", "乙"), ("keep", "丙")]
    assert h.split("甲{~~乙~>丁~~}") == [("keep", "甲"), ("del", "乙"), ("ins", "丁")]
    assert h.split("甲{==乙==}{>>批注<<}") == [("keep", "甲"), ("mark", "乙"), ("comment", "批注")]
    assert h.split("{++未闭合") == [("keep", "{++未闭合")]
    assert h.split("{++++}空") == [("keep", "空")]
    h2 = tracked.TrackedRuns()
    assert h2.split("{>><<}空") == [("keep", "空")] and h2._pending_comments == []


# --- build_tracked ---

@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("tracked")
    plain = _cfg("method", str(tmp / "plain.docx"))
    build_patent_ex(plain)
    unmarked = tracked.build_tracked(_cfg("method", str(tmp / "unmarked.docx")), author="张三", date=DATE)
    marked = tracked.build_tracked(_cfg("method", str(tmp / "marked.docx"), _marked_method(tmp)),
                                   author="张三", date=DATE)
    return {"plain": plain["out"], "unmarked": unmarked.out, "marked": marked.out}


def test_unmarked_tracked_is_byte_identical(built):
    assert _document_xml(built["unmarked"]) == _document_xml(built["plain"])
    with zipfile.ZipFile(built["unmarked"]) as z:
        assert "word/comments.xml" not in z.namelist()
    assert not os.path.exists(os.path.splitext(built["unmarked"])[0] + ".tracked.md")


def test_ins_del_sub_elements(built):
    d = etree.fromstring(_document_xml(built["marked"]))
    ins = d.findall(".//w:ins", NS)
    dels = d.findall(".//w:del", NS)
    ins_text = ["".join(t.text for t in e.findall(".//w:t", NS)) for e in ins]
    del_text = ["".join(t.text for t in e.findall(".//w:delText", NS)) for e in dels]
    assert ins_text == ["（摘要插入）", "插入文本", "新词", "29"]
    assert del_text == ["标题删除", "删掉的 ", "旧词", "28"]
    for e in ins + dels:
        assert e.get(qn("w:author")) == "张三"
        assert e.get(qn("w:date")) == DATE
        assert e.findall(".//w:r", NS)
    ids = [e.get(qn("w:id")) for e in ins + dels]
    assert len(set(ids)) == len(ids) == 8
    assert all(i.isdigit() for i in ids)
    for e in dels:
        assert e.findall(".//w:t", NS) == []
        for t in e.findall(".//w:delText", NS):  # 改名不丢 xml:space（python-docx 只对首尾空白的文本写它）
            assert (t.get("{http://www.w3.org/XML/1998/namespace}space") == "preserve") == (t.text != t.text.strip())
    # 替换 = del 紧接 ins
    old = next(e for e in dels if e.find(".//w:delText", NS).text == "旧词")
    assert old.getnext().tag == qn("w:ins")
    assert old.getnext().find(".//w:t", NS).text == "新词"
    # 标记外的正文文本原样保留在普通 run 里
    plain_t = [t.text for t in d.findall(".//w:t", NS)]
    assert "本发明涉及" in plain_t and "时间序列预" in plain_t


def test_mark_highlight_and_comments(built):
    d = etree.fromstring(_document_xml(built["marked"]))
    hl = [r.find("w:t", NS).text for r in d.findall(".//w:r", NS) if r.find("w:rPr/w:highlight", NS) is not None]
    assert hl == ["权项高亮"]
    starts = d.findall(".//w:commentRangeStart", NS)
    ends = d.findall(".//w:commentRangeEnd", NS)
    refs = d.findall(".//w:commentReference", NS)
    assert [s.get(qn("w:id")) for s in starts] == [e.get(qn("w:id")) for e in ends] \
        == [r.get(qn("w:id")) for r in refs] == ["0", "1"]
    with zipfile.ZipFile(built["marked"]) as z:
        c = etree.fromstring(z.read("word/comments.xml"))
    comments = c.findall("w:comment", NS)
    assert [cm.get(qn("w:author")) for cm in comments] == ["张三", "张三"]
    assert ["".join(cm.itertext()) for cm in comments] == ["段首批注", "正文批注"]
    # 批注文本不进正文
    assert all("段首批注" not in (t.text or "") and "正文批注" not in (t.text or "") for t in d.findall(".//w:t", NS))
    # 段首批注：锚在一个空 run 上，位于权项首段开头
    first = starts[0].getparent()
    assert first.tag == qn("w:p")
    anchor = starts[0].getnext()
    assert anchor.tag == qn("w:r") and anchor.findall("w:t", NS) == []
    assert anchor.getnext().tag == qn("w:commentRangeEnd")
    assert anchor.getnext().getnext().find("w:commentReference", NS) is not None
    # 正文批注：锚在前一个普通 run，后面没有多余文本
    anchor2 = starts[1].getnext()
    assert anchor2.tag == qn("w:r") and anchor2.find("w:t", NS).text.endswith("装置。")


def test_cross_line_and_formula_markup(built):
    d = etree.fromstring(_document_xml(built["marked"]))
    texts = [t.text for t in d.findall(".//w:t", NS)]
    assert "{++跨行插入" in texts  # 未闭合标记按普通文本排版
    assert not any("{++" in (t or "") and t != "{++跨行插入" for t in texts)
    # 公式行内标记按 final 进入 OMML，不产生修订
    m = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    omml = "".join(d.xpath("string(.//m:oMath)", namespaces={"m": m}))
    assert "+1" in omml and "{++" not in omml
    assert "{++" not in etree.tostring(d, encoding="unicode").replace("{++跨行插入", "")


def test_abstract_limit_counts_final_text(tmp_path):
    lines = _method_md().split("\n")
    pad = "字" * (300 - len(lines[4]))
    lines[4] = "{--" + "删" * 50 + "--}" + lines[4] + pad  # final 恰好 300 字，带标记超过
    md = tmp_path / "abs.md"
    md.write_text("\n".join(lines), encoding="utf-8")
    tracked.build_tracked(_cfg("method", str(tmp_path / "ok.docx"), str(md)))
    lines[4] += "多"
    md.write_text("\n".join(lines), encoding="utf-8")
    with pytest.raises(AssertionError, match="摘要超过300字：301"):
        tracked.build_tracked(_cfg("method", str(tmp_path / "bad.docx"), str(md)))


@pytest.mark.skipif(not HAS_RENDER, reason="需要 soffice 与 pdftotext")
def test_libreoffice_converts_tracked_docx(built, tmp_path):
    from app.lo import docx_to_pdf
    pdf = docx_to_pdf(built["marked"], str(tmp_path))
    text = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True, check=True).stdout
    assert "插入文本" in text and "新词" in text and "29" in text
    assert "删掉的" in text  # LibreOffice 以"显示修订"渲染：删除文本带删除线也进 PDF（E8）
    assert "{++跨行插入" in text
    rest = text.replace("{++跨行插入", "")
    assert "{++" not in rest and "{--" not in rest and "{~~" not in rest and "{>>" not in rest and "{==" not in rest
    assert "段首批注" not in text and "正文批注" not in text


# --- 路由 ---

@pytest.fixture
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    shutil.copytree(os.path.join(EXAMPLES, "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setattr(app.state, "store", ProjectStore(str(projects)))
    return TestClient(app), projects / "method"


def test_route_tracked_download(client):
    c, proj = client
    content = proj / "content.md"
    content.write_text(content.read_text(encoding="utf-8").replace("本发明涉及", "本发明{++特别++}涉及", 1),
                       encoding="utf-8")
    r = c.get("/api/projects/method/export/docx", params={"mode": "tracked"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.wordprocessingml")
    assert "%E4%BF%AE%E8%AE%A2.docx" in r.headers["content-disposition"]  # 修订.docx
    with zipfile.ZipFile(proj / ".studio" / "tracked" / "out.docx") as z:
        d = etree.fromstring(z.read("word/document.xml"))
    ins = d.findall(".//w:ins", NS)
    assert len(ins) == 1 and ins[0].find(".//w:t", NS).text == "特别"
    assert ins[0].get(qn("w:author")) == tracked.DEFAULT_AUTHOR
    assert (proj / "content.md").read_text(encoding="utf-8").count("{++特别++}") == 1  # 源码未被改写
    r = c.get("/api/projects/method/export/docx", params={"mode": "final"}, follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/api/projects/method/export?fmt=docx"
    r = c.get("/api/projects/method/export/docx")
    assert r.status_code == 200 and "%E4%BF%AE%E8%AE%A2" not in r.headers["content-disposition"]


def test_route_tracked_abstract_limit(client):
    c, proj = client
    content = proj / "content.md"
    raw = content.read_text(encoding="utf-8")
    content.write_text(raw.replace("本发明公开了", "本发明{++" + "特" * 300 + "++}公开了", 1), encoding="utf-8")
    r = c.get("/api/projects/method/export/docx", params={"mode": "tracked"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "abstract_limit"
