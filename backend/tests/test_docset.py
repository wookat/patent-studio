# -*- coding: utf-8 -*-
"""R1 B1：三书拆合（docset）—— 往返法则、规范性校验、offset 坐标、镜像写入、/docs 路由。"""

import hashlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from patent_studio.kernel import docset
from patent_studio.kernel.content import parse_md

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = [os.path.join(ROOT, "examples", d) for d in ("method", "system")]

CANON = (
    "# 一种测试方法\n\n## 摘要\n\n摘要正文。\n\n## 权利要求书\n\n1.一种测试方法，其特征在于：\n"
    "$$x = 1$$\n\n2.根据权利要求1所述的方法。\n\n## 说明书\n\n### 技术领域\n\n正文。\n\n"
    "表1 结果\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\n\n"
)


def _read(d):
    with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
        return f.read()


# --- split / assemble / offsets ---


@pytest.mark.parametrize("d", EXAMPLES)
def test_examples_roundtrip_and_offsets(d):
    md = _read(d)
    ds = docset.split(md)
    assert docset.assemble(ds) == md
    docset.validate(ds)
    off = docset.offsets(ds)
    lines = md.split("\n")
    for b in docset.BOOKS:
        assert lines[off[b] - 1] == docset.BOOK_HEADINGS[b]
        # docs/<book>.md 第 k 行 ⇔ content.md 第 offset+k 行
        body = ds.book(b).split("\n")
        assert lines[off[b] : off[b] + len(body) - 1] == body[:-1]
    assert docset.check([d]) == []


def test_edge_cases_roundtrip_bytewise():
    cases = [
        CANON,  # 权项内公式行、说明书表格块、尾部多空行
        CANON.rstrip("\n"),  # 无换行结尾
        CANON.replace("\n\n## 权利要求书", "\n\n\n\n## 权利要求书"),  # 书间多空行
        "# 只有标题\n",  # 空案
        "# 只有标题",
        "",
        "# t\r\n\r\n## 摘要\r\nx\r\n## 权利要求书\r\n## 说明书\r\n",  # CRLF
        "# t\n## 摘要 \n a\n##  权利要求书\nb\n## 说明书\n",  # 标题行首尾空白（与内核同判）
    ]
    for md in cases:
        assert docset.assemble(docset.split(md)) == md, repr(md)


def test_split_matches_kernel_heading_rule():
    ds = docset.split("# t\n## 摘要 \na\n##  权利要求书\nb\n## 说明书\n")
    assert ds.order == docset.BOOKS and ds.abstract == "a\n" and ds.claims == "b\n"
    # 内核 parse_md 对同一文本同样把三节认出来
    assert parse_md("# t\n## 摘要 \na\n##  权利要求书\nb\n## 说明书\n")[1] == "a"
    # 非标题行（`###`、无空格、别的名字）不切
    ds = docset.split("# t\n## 摘要\n### 摘要\n##摘要\n## 说明\n## 说明书\n")
    assert ds.abstract == "### 摘要\n##摘要\n## 说明\n" and ds.headings["claims"] is None


def test_offsets_canon_and_empty():
    ds = docset.split(CANON)
    assert docset.offsets(ds) == {"abstract": 3, "claims": 7, "description": 14}
    assert docset.offsets(docset.split("# 只有标题\n")) == {}
    assert docset.offsets(docset.split("## 摘要\n## 权利要求书\n## 说明书")) == {
        "abstract": 1,
        "claims": 2,
        "description": 3,
    }


# --- validate ---


def test_validate_ok_and_errors():
    docset.validate(docset.split(CANON))
    with pytest.raises(docset.DocsetError, match="缺少书标题：## 权利要求书、## 说明书"):
        docset.validate(docset.split("# t\n## 摘要\n"))
    with pytest.raises(docset.DocsetError, match="顺序"):
        docset.validate(docset.split("# t\n## 权利要求书\n## 摘要\n## 说明书\n"))
    with pytest.raises(docset.DocsetError, match="标题"):
        docset.validate(docset.split("## 摘要\n## 权利要求书\n## 说明书\n"))
    with pytest.raises(docset.DocsetError):
        docset.validate(docset.split("# 只有标题\n"))


# --- replace ---


def test_replace_pads_newline_for_non_last_book():
    ds = docset.split(CANON)
    md = docset.assemble(docset.replace(ds, "claims", "1.新权项。"))
    assert "1.新权项。\n## 说明书\n" in md
    assert docset.split(md).claims == "1.新权项。\n"
    md = docset.assemble(docset.replace(ds, "claims", ""))
    assert "## 权利要求书\n## 说明书\n" in md
    # 末书不补；已带换行的不重复补
    assert docset.assemble(docset.replace(ds, "description", "x")).endswith("## 说明书\nx")
    assert docset.assemble(docset.replace(ds, "abstract", "a\n")).count("a\n## 权利要求书") == 1
    with pytest.raises(KeyError):
        docset.replace(ds, "foo", "x")


# --- write_mirror ---


def test_write_mirror_and_skip_invalid(tmp_path):
    d = str(tmp_path)
    assert docset.write_mirror(d, CANON) is True
    ds = docset.split(CANON)
    for b in docset.BOOKS:
        with open(os.path.join(d, "docs", f"{b}.md"), encoding="utf-8") as f:
            assert f.read() == ds.book(b)
    with open(os.path.join(d, "project.json"), encoding="utf-8") as f:
        assert json.load(f) == {"title": "一种测试方法"}
    assert docset.has_mirror(d)
    # 非规范内容：不动镜像
    assert docset.write_mirror(d, "# t\n## 摘要\n") is False
    with open(os.path.join(d, "docs", "claims.md"), encoding="utf-8") as f:
        assert f.read() == ds.claims


def test_check_reports_noncanonical(tmp_path):
    (tmp_path / "content.md").write_text("# t\n## 摘要\n", encoding="utf-8")
    fails = docset.check([str(tmp_path)])
    assert len(fails) == 1 and "缺少书标题" in fails[0]
    assert docset.main(["--check", str(tmp_path)]) == 1
    assert docset.main(["--check", *EXAMPLES]) == 0


# --- API ---


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*", "docs", "project.json"),
    )
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(main)
    return TestClient(main.app), projects


def test_get_docs_shapes_and_offsets(client):
    c, _ = client
    md = _read(EXAMPLES[0])
    r = c.get("/api/projects/method/docs")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"title", "books"} and set(body["books"]) == set(docset.BOOKS)
    assert body["title"] == md.split("\n")[0][2:]
    assert body["books"]["abstract"]["offset"] == 3 and body["books"]["claims"]["offset"] == 7
    assert body["books"]["description"]["offset"] == 29
    r = c.get("/api/projects/method/docs/claims")
    assert r.status_code == 200
    claims = body["books"]["claims"]["content"]
    assert r.json() == {
        "book": "claims",
        "content": claims,
        "offset": 7,
        "sha": hashlib.sha1(claims.encode("utf-8")).hexdigest(),
    }
    assert md.split("\n")[28] == "## 说明书"


def test_docs_404s(client):
    c, _ = client
    assert c.get("/api/projects/method/docs/foo").status_code == 404
    r = c.get("/api/projects/nope/docs")
    assert r.status_code == 404 and "nope" in r.json()["detail"]
    assert c.put("/api/projects/nope/docs/claims", json={"content": "x"}).status_code == 404


def test_first_read_migrates_old_project(client):
    c, projects = client
    d = projects / "method"
    assert not (d / "docs").exists() and not (d / "project.json").exists()
    r = c.get("/api/projects/method/content")
    assert r.status_code == 200
    ds = docset.split(r.json()["content"])
    for b in docset.BOOKS:
        assert (d / "docs" / f"{b}.md").read_text(encoding="utf-8") == ds.book(b)
    assert json.loads((d / "project.json").read_text(encoding="utf-8")) == {"title": ds.title}


def test_put_content_derives_docs(client):
    c, projects = client
    r = c.put("/api/projects/method/content", json={"content": CANON})
    assert r.status_code == 200 and r.json()["ok"]
    d = projects / "method"
    assert (d / "docs" / "claims.md").read_text(encoding="utf-8") == docset.split(CANON).claims
    assert json.loads((d / "project.json").read_text(encoding="utf-8")) == {"title": "一种测试方法"}


def test_put_content_base_conflict(client):
    """批76：base = 客户端自认与盘一致的内容 sha256——不符即 409 conflict，
    防多页签/多会话静默覆盖；缺省 base 不校验（旧客户端兼容）。"""
    c, _projects = client
    cur = c.get("/api/projects/method/content").json()["content"]
    sha = hashlib.sha256(cur.encode()).hexdigest()
    stale = hashlib.sha256("另一会话写入的旧版本".encode()).hexdigest()
    r = c.put("/api/projects/method/content", json={"content": CANON, "base": stale})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "conflict"
    assert c.get("/api/projects/method/content").json()["content"] == cur  # 盘上原文未被覆写
    assert c.put("/api/projects/method/content", json={"content": CANON, "base": sha}).status_code == 200
    assert c.put("/api/projects/method/content", json={"content": CANON}).status_code == 200


def test_put_doc_reassembles_content_and_mirror(client):
    c, projects = client
    md = _read(EXAMPLES[0])
    new_claims = "\n1.一种新方法，其特征在于：\n$$y = 2$$\n\n"
    r = c.put("/api/projects/method/docs/claims", json={"content": new_claims})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["backup"].startswith("content.md.bak-") and body["backups"]
    expect = docset.assemble(docset.replace(docset.split(md), "claims", new_claims))
    assert c.get("/api/projects/method/content").json()["content"] == expect
    assert expect.startswith(md.split("## 权利要求书\n")[0] + "## 权利要求书\n" + new_claims + "## 说明书\n")
    assert expect.endswith(docset.split(md).description)
    d = projects / "method"
    assert (d / "docs" / "claims.md").read_text(encoding="utf-8") == new_claims
    assert (d / "docs" / "description.md").read_text(encoding="utf-8") == docset.split(md).description
    assert (d / body["backup"]).read_text(encoding="utf-8") == md
    r = c.get("/api/projects/method/docs")
    assert r.json()["books"]["claims"]["content"] == new_claims
    # head 3 行 + 摘要标题 + 摘要 3 行 + 权项标题 + 新权项 4 行
    assert r.json()["books"]["description"]["offset"] == 3 + 1 + 3 + 1 + 4


def test_put_doc_without_trailing_newline_keeps_next_heading_on_own_line(client):
    c, _ = client
    r = c.put("/api/projects/method/docs/abstract", json={"content": "只有一行摘要"})
    assert r.status_code == 200
    content = c.get("/api/projects/method/content").json()["content"]
    assert "## 摘要\n只有一行摘要\n## 权利要求书\n" in content
    assert c.get("/api/projects/method/docs/abstract").json()["content"] == "只有一行摘要\n"


def test_docs_422_when_content_noncanonical(client):
    c, projects = client
    c.get("/api/projects/method/content")  # 迁移写下三书镜像
    c.put("/api/projects/method/content", json={"content": "# t\n## 摘要\nx\n"})
    for url in ("/api/projects/method/docs", "/api/projects/method/docs/abstract"):
        r = c.get(url)
        assert r.status_code == 422 and "缺少书标题" in r.json()["detail"]
    r = c.put("/api/projects/method/docs/abstract", json={"content": "y\n"})
    assert r.status_code == 422
    # 非规范保存不更新镜像：仍是迁移时写下的三书
    assert (projects / "method" / "docs" / "abstract.md").read_text(encoding="utf-8") == docset.split(
        _read(EXAMPLES[0])
    ).abstract
