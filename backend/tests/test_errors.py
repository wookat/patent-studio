# -*- coding: utf-8 -*-
"""describe_error：内核异常 → 可读 kind/message/line；detail 保留原异常。"""
import os
import tempfile

from app.errors import describe_error
from patent_docx.builder import build_patent_ex

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DOC = """# 标题

## 摘要

摘要正文。

## 权利要求

1.一种方法。

## 说明书

### 技术领域

略。
"""


def _raise_from_builder(content):
    """真实跑一次内核，拿到它对畸形输入抛出的原始异常。"""
    with tempfile.TemporaryDirectory() as d:
        md = os.path.join(d, "content.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            build_patent_ex({"content_md": md, "out": os.path.join(d, "o.docx"),
                             "figs_dir": os.path.join(ROOT, "examples", "method", "figs"),
                             "abstract_figure": ("fig1.emf", 14.5), "spec_figures": [], "abstract_limit": 300})
        except Exception as e:  # noqa: BLE001
            return e
    raise AssertionError("内核未抛错")


def test_unknown_section_key_error_located():
    exc = _raise_from_builder(DOC)
    assert isinstance(exc, KeyError)
    e = describe_error(exc, DOC)
    assert e["kind"] == "content"
    assert e["message"] == "未知章节「权利要求」：仅允许 摘要/权利要求书/说明书"
    assert DOC.splitlines()[e["line"] - 1] == "## 权利要求"
    assert e["detail"].startswith("KeyError")


def test_key_error_not_a_heading_is_settings():
    e = describe_error(KeyError("abstract_figure"), DOC)
    assert e["kind"] == "settings" and "abstract_figure" in e["message"] and e["line"] is None


def test_empty_document_no_nonetype_leak():
    exc = _raise_from_builder("")
    assert isinstance(exc, (TypeError, AttributeError))
    e = describe_error(exc, "")
    assert e["kind"] == "content"
    assert e["message"].startswith("文档为空")
    assert "NoneType" not in e["message"]
    assert "NoneType" in e["detail"]  # 原异常保留在 detail
    assert e["line"] == 1


def test_missing_sections_message_lists_them():
    content = "# 标题\n\n## 摘要\n\n正文。\n"
    e = describe_error(AttributeError("'NoneType' object has no attribute 'group'"), content)
    assert e["kind"] == "content"
    assert e["message"] == "文档缺少 ## 权利要求书 / ## 说明书 章节"
    assert "NoneType" not in e["message"]


def test_missing_title_only():
    content = "## 摘要\n\n正文。\n\n## 权利要求书\n\n1.一种方法。\n\n## 说明书\n\n### 技术领域\n\n略。\n"
    e = describe_error(TypeError("expected string or bytes-like object, got 'NoneType'"), content)
    assert e["kind"] == "content" and e["message"] == "文档缺少 「# 标题」行"


def test_type_error_with_complete_structure_stays_build():
    complete = DOC.replace("## 权利要求\n", "## 权利要求书\n")
    e = describe_error(TypeError("boom"), complete)
    assert e["kind"] == "build" and e["message"] == "boom"


def test_abstract_limit_still_works():
    e = describe_error(AssertionError("摘要超过300字：353"), DOC)
    assert e["kind"] == "abstract_limit" and "300" in e["message"] and "353" in e["message"]
    assert DOC.splitlines()[e["line"] - 1] == "摘要正文。"


def test_xml_content_error_locates_section_heading():
    from patent_docx.cnipa_xml import XmlContentError

    complete = DOC.replace("## 权利要求\n", "## 权利要求书\n")
    e = describe_error(XmlContentError("权利要求书", "权利要求书为空：官方 DTD 要求至少 1 项权利要求"), complete)
    assert e["kind"] == "content" and e["message"].startswith("权利要求书为空")
    assert complete.splitlines()[e["line"] - 1] == "## 权利要求书"


def test_pdf_convert_error_keeps_human_message_and_raw_detail():
    from app.lo import PdfConvertError

    exc = PdfConvertError(
        "PDF 转换失败：LibreOffice 未能完成转换，DOCX 已生成",
        "soffice exit 1\nError: source file could not be loaded",
    )
    e = describe_error(exc, DOC)
    assert e["kind"] == "build" and e["line"] is None
    assert e["message"] == "PDF 转换失败：LibreOffice 未能完成转换，DOCX 已生成"
    assert "soffice exit 1" in e["detail"] and "PdfConvertError" not in e["detail"]
