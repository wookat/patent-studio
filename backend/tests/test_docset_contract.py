# -*- coding: utf-8 -*-
"""R1 prep 骨架：路由错误形状、docset 往返、numbering 与 builder 历史规则一致。"""

import os

import pytest
from fastapi.testclient import TestClient

from patent_studio.kernel import docset
from patent_studio.kernel.content import load_md, parse_md
from patent_studio.kernel.numbering import ItemNumbers, number_spec, para_label

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = [os.path.join(ROOT, "examples", d) for d in ("method", "system")]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(tmp_path))
    import importlib

    from app import config, main

    importlib.reload(config)
    importlib.reload(main)
    return TestClient(main.app)


def test_unknown_book_404(client):
    r = client.get("/api/projects/x/docs/foo")
    assert r.status_code == 404 and "foo" in r.json()["detail"]


@pytest.mark.parametrize("d", EXAMPLES)
def test_docset_roundtrip_examples(d):
    with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
        md = f.read()
    ds = docset.split(md)
    assert docset.assemble(ds) == md
    assert ds.title == load_md(os.path.join(d, "content.md"))[0]
    assert ds.order == docset.BOOKS
    assert all(ds.book(b) for b in docset.BOOKS)
    assert docset.check([d]) == []


def test_docset_roundtrip_edge_cases():
    for md in [
        "",
        "# 只有标题\n",
        "# t\n\n## 权利要求书\n1.x\n## 摘要\n\n",
        "无换行结尾",
        "# t\r\n\r\n## 摘要\r\nx\r\n",
        "# t\n## 摘要\na\n## 摘要\nb\n## 说明书\n",
    ]:
        assert docset.assemble(docset.split(md)) == md, repr(md)
    ds = docset.split("# t\n## 摘要\na\n## 摘要\nb\n")
    assert ds.abstract == "a\n## 摘要\nb\n" and ds.headings["claims"] is None


def test_docset_check_missing(tmp_path):
    assert docset.check([str(tmp_path)]) == [f"{tmp_path}: 缺少 content.md"]
    assert docset.main(["--check", str(tmp_path)]) == 1
    assert docset.main(["--check", *EXAMPLES]) == 0


def test_parse_md_equals_load_md():
    for d in EXAMPLES:
        p = os.path.join(d, "content.md")
        with open(p, encoding="utf-8") as f:
            assert parse_md(f.read()) == load_md(p)


def test_number_spec_rules():
    spec = [
        "p",
        ("h", "章"),
        ("e", "x=1", "（1）"),
        "p",
        ("t", [["a"]], {"表题后置": "表1", "表注": "注"}),
        ("s", "小节"),
        ("c", ["code"]),
        ("t", [["b"]], {}),
        "p",
    ]
    got = number_spec(spec)
    assert got == [
        ItemNumbers(para_no=1),
        ItemNumbers(),
        ItemNumbers(),
        ItemNumbers(para_no=2),
        ItemNumbers(para_no=3, caption_after_no=4, note_no=5),
        ItemNumbers(),
        ItemNumbers(para_no=6),
        ItemNumbers(para_no=7),
        ItemNumbers(para_no=8),
    ]
    assert para_label(13) == "[0013]"
    with pytest.raises(ValueError):
        number_spec([("z",)])


@pytest.mark.parametrize("d,expected", [(EXAMPLES[0], 148), (EXAMPLES[1], 261)])
def test_number_spec_examples_match_docx_paragraph_count(d, expected):
    """zero_drift 输出的“说明书段落数”即 max 段号（method 148 / system 261）。"""
    spec = load_md(os.path.join(d, "content.md"))[3]
    nums = number_spec(spec)
    assert len(nums) == len(spec)
    assert max(x for n in nums for x in (n.para_no, n.caption_after_no, n.note_no) if x) == expected
