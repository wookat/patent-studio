# -*- coding: utf-8 -*-
"""单元 E2-terms（docs/plan/09 §3.2 / §8 A8–A10）：terms.json CRUD、确定性候选抽取、术语 lint 纯函数、
一键统一 CriticMarkup、preflight 支持性别名归一、路由与零漂移。
"""
import importlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

import app.ai as ai_pkg
from app.ai.client import ChatResult, Usage
from app.domain import terms
from app.domain.lint import lint
from app.domain.projects import ProjectStore
from patent_docx import critic, docset, preflight
from patent_docx.ast import parse_ast
from patent_docx.terms_lint import lint_terms

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")

TERMS = [
    {"name": "传感单元", "aliases": ["传感器", "感测单元"], "en": "sensing unit", "definition": None,
     "first_line": None},
    {"name": "基础预测模型", "aliases": ["预测模型"], "en": None, "definition": None, "first_line": None},
]

FIXTURE = """# 术语样例

## 摘要

一种测试方法，所述传感器采集数据并送入基础预测模型（sensor）；预测模型输出结果。

## 权利要求书

1.一种测试方法，其特征在于，包括通过所述感测单元的采集数据得到输出结果。

## 说明书

### 技术领域

本发明涉及一种测试方法。

### 背景技术

现有技术中传感器与预测模型缺少统一命名。

### 发明内容

本发明提供一种测试方法，所述传感单元获取输入数据并输出结果。

```
传感器 = read()  # 代码块不扫描
```

$$ 传感器 = \\alpha \\cdot 预测模型 $$

### 附图说明

图1为本发明实施例的流程图。

元件标号说明：101为传感单元；102为基础预测模型。

### 具体实施方式

如图1所示，传感单元101将数据送入基础预测模型102，传感单元101还可以为测距单元101。
"""


def read_example(pid):
    store = ProjectStore(EXAMPLES)
    return store.read_content(pid), store.get(pid).settings


# ---------------- validate ----------------

def test_validate_ok():
    terms.validate([terms.normalize(t) for t in TERMS])


@pytest.mark.parametrize("bad,msg", [
    ([{"name": ""}], "缺少主名"),
    ([{"name": "a"}, {"name": "a"}], "重复"),
    ([{"name": "a", "aliases": ["b"]}, {"name": "b"}], "重名"),
    ([{"name": "a", "aliases": ["x"]}, {"name": "b", "aliases": ["x"]}], "同时属于"),
])
def test_validate_rejects(bad, msg):
    with pytest.raises(terms.TermsError) as ei:
        terms.validate([terms.normalize(t) for t in bad])
    assert ei.value.status == 422 and msg in str(ei.value)


def test_load_save_roundtrip(tmp_path):
    saved = terms.save(str(tmp_path), TERMS)
    assert terms.load(str(tmp_path)) == saved
    raw = json.loads((tmp_path / "terms.json").read_text(encoding="utf-8"))
    assert raw["version"] == 1 and raw["terms"][0]["name"] == "传感单元"
    assert terms.load(str(tmp_path / "nope")) == []


# ---------------- lint_terms ----------------

@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_no_terms_zero_diagnostics(pid):
    content, settings = read_example(pid)
    assert lint_terms(content, []) == []
    a = lint(critic.accept(content), settings, with_preflight=True)
    b = lint(critic.accept(content), settings, with_preflight=True, terms=[])
    assert a == b


@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_unused_alias_zero_diagnostics(pid):
    content, _ = read_example(pid)
    assert lint_terms(content, [{"name": "甲", "aliases": ["乙丙丁戊"]}]) == []


def test_lint_terms_hits_and_replace():
    diags = lint_terms(FIXTURE, TERMS)
    by = {(d["line"], d["replace"]["from"]): d for d in diags}
    lines = FIXTURE.split("\n")
    abstract = lines.index("一种测试方法，所述传感器采集数据并送入基础预测模型（sensor）；预测模型输出结果。") + 1
    claim = next(i for i, ln in enumerate(lines, 1) if ln.startswith("1.一种测试方法"))
    bg = next(i for i, ln in enumerate(lines, 1) if ln.startswith("现有技术中传感器"))
    assert set(by) == {(abstract, "传感器"), (abstract, "预测模型"), (claim, "感测单元"), (bg, "传感器"),
                       (bg, "预测模型")}
    d = by[(abstract, "传感器")]
    assert d == {
        "id": f"terms.alias#{abstract}:传感器", "severity": "warning", "source": "lint",
        "message": "「传感器」是术语「传感单元」的别名，请统一为主名", "line": abstract, "section": "摘要",
        "fix": "改为「传感单元」", "replace": {"from": "传感器", "to": "传感单元"},
    }
    assert by[(claim, "感测单元")]["section"] == "权利要求书"
    assert by[(bg, "传感器")]["section"] == "说明书/背景技术"
    # 主名本身、代码块、$$ 行、图例与具体实施方式（只有主名）都不报
    assert all(d["replace"]["to"] not in ("传感器", "预测模型") for d in diags)
    assert not any(d["line"] > bg for d in diags)


def test_lint_terms_longest_match_and_ascii_paren():
    text = "基础预测模型不是预测模型的别名命中（sensor 传感器）；(sensor) 与（传感器）不同。"
    diags = lint_terms(text, TERMS)
    assert [d["replace"]["from"] for d in diags] == ["预测模型", "传感器"]
    assert lint_terms("（sensor）与(sensor unit)", [{"name": "传感单元", "aliases": ["sensor"]}]) == []
    assert lint_terms("英文别名 sensor 在括注外仍报", [{"name": "传感单元", "aliases": ["sensor"]}])


def test_lint_terms_in_app_lint_uses_replace_shape():
    rep = lint(critic.accept(FIXTURE), None, terms=TERMS)
    ids = [d["id"] for d in rep["diagnostics"] if d["id"].startswith("terms.alias#")]
    assert len(ids) == 5
    d = next(x for x in rep["diagnostics"] if x["id"].startswith("terms.alias#"))
    assert d["replace"] == {"from": "传感器", "to": "传感单元"} and d["severity"] == "warning"


# ---------------- unify ----------------

def test_unify_accept_equals_direct_replace_and_reject_restores():
    out, changed = terms.unify(FIXTURE, TERMS)
    assert "{~~传感器~>传感单元~~}" in out and "{~~预测模型~>基础预测模型~~}" in out
    assert "{~~基础预测模型" not in out
    assert critic.reject(out) == FIXTURE
    assert out.count("\n") == FIXTURE.count("\n")
    assert terms.unify_count(FIXTURE, TERMS) == 5
    expected_lines = []
    for ln in FIXTURE.split("\n"):
        if ln.startswith("```") or ln.startswith("$$") or ln.startswith("传感器 = "):
            expected_lines.append(ln)
            continue
        ln = ln.replace("感测单元", "传感单元").replace("传感器", "传感单元")
        ln = ln.replace("基础预测模型", "\x00").replace("预测模型", "基础预测模型").replace("\x00", "基础预测模型")
        expected_lines.append(ln)
    assert critic.accept(out) == "\n".join(expected_lines)
    assert lint_terms(critic.accept(out), TERMS) == []
    assert changed == sorted({d["line"] for d in lint_terms(FIXTURE, TERMS)})
    # 未改动行逐字节不变
    src, dst = FIXTURE.split("\n"), out.split("\n")
    assert all(src[i] == dst[i] for i in range(len(src)) if i + 1 not in changed)


def test_unify_skips_existing_marks_and_is_idempotent():
    once, changed = terms.unify(FIXTURE, TERMS)
    twice, changed2 = terms.unify(once, TERMS)
    assert twice == once and changed2 == []
    text = "已有{~~传感器~>传感单元~~}建议与{--传感器--}删除、{++预测模型++}插入，{>>传感器批注<<}再传感器。"
    out, ch = terms.unify(text, TERMS)
    assert out == ("已有{~~传感器~>传感单元~~}建议与{--传感器--}删除、{++预测模型++}插入，"
                   "{>>传感器批注<<}再{~~传感器~>传感单元~~}。")
    assert ch == [1]


def test_unify_names_and_books_filter():
    out, changed = terms.unify(FIXTURE, TERMS, names=["基础预测模型"])
    assert "{~~传感器" not in out and "{~~预测模型~>基础预测模型~~}" in out
    assert terms.unify_count(FIXTURE, TERMS, names=["基础预测模型"]) == 2
    out, changed = terms.unify(FIXTURE, TERMS, books=["claims"])
    assert changed == [next(i for i, ln in enumerate(FIXTURE.split("\n"), 1) if ln.startswith("1.一种测试方法"))]
    assert terms.unify(FIXTURE, [], None) == (FIXTURE, [])


@pytest.mark.parametrize("pid", ["method", "system"])
def test_unify_examples_zero_drift_and_roundtrip(pid):
    content, _ = read_example(pid)
    assert terms.unify(content, []) == (content, [])
    assert terms.unify(content, [{"name": "甲", "aliases": ["乙丙丁戊"]}]) == (content, [])
    ds = docset.split(content)
    assert docset.assemble(ds) == content
    out, changed = terms.unify(content, [{"name": "成熟反馈队列", "aliases": ["成熟队列"]}] if pid == "method"
                               else [{"name": "预测引擎模块", "aliases": ["预测引擎"]}])
    assert critic.reject(out) == content
    ds2 = docset.split(out)
    assert docset.assemble(ds2) == out
    assert docset.assemble(docset.split(critic.accept(out))) == critic.accept(out)
    parse_ast(critic.accept(out))


# ---------------- extract ----------------

def test_extract_fixture_sources_and_first_line():
    cands = terms.extract(critic.accept(FIXTURE), {"spec_figures": [["fig1.png", 15.0]]})
    by = {c["name"]: c for c in cands}
    lines = FIXTURE.split("\n")
    assert by["测试方法"]["source"] == "claim" and by["测试方法"]["lines"][0] == 5
    fl = by["传感单元"]
    assert fl["source"] == "figure-label"
    assert fl["lines"][0] == lines.index("本发明提供一种测试方法，所述传感单元获取输入数据并输出结果。") + 1
    assert fl["count"] >= 4 and "测距单元" in fl.get("aliases", [])
    assert by["基础预测模型"]["source"] == "figure-label"
    assert all(c["lines"] == sorted(c["lines"]) and c["count"] >= 1 for c in cands)
    assert cands == terms.extract(critic.accept(FIXTURE), {"spec_figures": [["fig1.png", 15.0]]})


def test_extract_freq_threshold_and_skips():
    text = ("# 标题\n\n## 摘要\n\n量子纠缠器与量子纠缠器。\n\n```\n量子纠缠器 量子纠缠器\n```\n\n"
            "$$ 量子纠缠器 $$\n\n光子探测器一次。")
    cands = {c["name"]: c for c in terms.extract(text)}
    assert cands["量子纠缠器"]["count"] == 2 and cands["量子纠缠器"]["lines"] == [5]
    assert "光子探测器" not in cands
    assert cands["量子纠缠器"]["source"] == "freq"


@pytest.mark.parametrize("pid,expect", [
    ("method", {"时间序列预测模型部署期可信自适应控制方法": "claim", "成熟反馈队列": "figure-label",
                "信任系数": "freq"}),
    ("system", {"时间序列预测模型可信部署监控与自动降级系统": "claim", "预测引擎模块": "figure-label",
                "安全锚输出": "freq"}),
])
def test_extract_examples(pid, expect):
    content, settings = read_example(pid)
    cands = terms.extract(critic.accept(content), settings)
    by = {c["name"]: c for c in cands}
    for name, source in expect.items():
        assert by[name]["source"] == source, name
        assert by[name]["lines"][0] >= 1 and by[name]["count"] >= 2
    assert all(c["source"] in ("claim", "figure-label", "freq") for c in cands)
    assert len(cands) == len(by) <= 60


# ---------------- preflight 支持性 · 别名归一（09 §4 / A10）----------------

def test_preflight_support_alias_normalization():
    # 权项写别名「所述感测单元」，说明书只写主名「传感单元」
    settings = {"spec_figures": [["fig1.png", 15.0]]}
    ast = parse_ast(FIXTURE, settings)
    base = preflight.run(ast, settings)
    assert any(it["rule"] == "claims.unsupported_term" and it["detail"] == "感测单元" for it in base["items"])
    assert preflight.run(ast, settings, terms=[]) == base
    rep = preflight.run(ast, settings, terms=TERMS)
    assert not any(it["rule"] == "claims.unsupported_term" for it in rep["items"])
    row = next(r for r in rep["support_map"] if r["term"] == "传感单元")
    assert row["supported"] and row["description_lines"]


# ---------------- 路由 ----------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in ("method", "system"):
        shutil.copytree(os.path.join(EXAMPLES, pid), projects / pid,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    return TestClient(main.app), projects, main.app


def test_terms_crud_routes(client):
    c, projects, _ = client
    r = c.get("/api/projects/method/terms")
    assert r.status_code == 200 and r.json() == {"version": 1, "terms": []}
    r = c.put("/api/projects/method/terms",
              json={"terms": [{"name": " 传感单元 ", "aliases": ["传感器", ""], "en": "sensing unit"}]})
    assert r.status_code == 200
    assert r.json()["terms"] == [{"name": "传感单元", "aliases": ["传感器"], "en": "sensing unit", "definition": None,
                                  "first_line": None}]
    assert (projects / "method" / "terms.json").is_file()
    assert c.get("/api/projects/method/terms").json() == r.json()
    r = c.put("/api/projects/method/terms", json={"terms": [{"name": "a", "aliases": ["b"]}, {"name": "b"}]})
    assert r.status_code == 422
    d = r.json()["detail"]
    assert d["kind"] == "terms" and "重名" in d["message"]
    assert c.get("/api/projects/nope/terms").status_code == 404


def test_terms_extract_route_deterministic(client):
    c, _, _ = client
    r = c.post("/api/projects/method/terms/extract", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["ai_used"] is False and body["candidates"]
    assert {"name", "count", "lines", "source"} <= set(body["candidates"][0])
    r2 = c.post("/api/projects/method/terms/extract", json={"content": FIXTURE})
    names = {x["name"] for x in r2.json()["candidates"]}
    assert "传感单元" in names and "测试方法" in names


def test_terms_extract_ai_requires_enabled_and_uses_mock(client):
    c, projects, app = client
    r = c.post("/api/projects/method/terms/extract", json={"content": FIXTURE, "ai": True})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "ai_disabled"
    assert app.state.ai.provider.calls == []
    studio = projects / "method" / "studio.json"
    s = json.loads(studio.read_text(encoding="utf-8")) if studio.is_file() else {}
    s["ai_enabled"] = True
    studio.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")

    class StubAi:
        def __init__(self):
            self.calls = []

        async def chat(self, messages, purpose, **kw):
            self.calls.append((messages, purpose, kw))
            fixture = os.path.join(os.path.dirname(os.path.abspath(ai_pkg.__file__)), "fixtures",
                                   "terms_extract.json")
            with open(fixture, encoding="utf-8") as f:
                return ChatResult(text=f.read(), model="swe-2-max", usage=Usage(0, 0, 0), ms=1, fallback=False)

    stub = StubAi()
    app.state.ai = stub
    r = c.post("/api/projects/method/terms/extract", json={"content": FIXTURE, "ai": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ai_used"] is True
    ai_rows = [x for x in body["candidates"] if x["source"] == "ai"]
    # mock fixture 的「传感单元」已被确定性候选覆盖 ⇒ 不重复；AI 行只补新名
    assert ai_rows == [] and any(x["name"] == "传感单元" for x in body["candidates"])
    assert len(stub.calls) == 1 and stub.calls[0][1] == "heavy"
    assert stub.calls[0][0][0]["content"].startswith("[patent-studio:terms_extract]")


def test_terms_unify_route_no_disk_write(client):
    c, projects, _ = client
    content_path = projects / "method" / "content.md"
    before = content_path.read_bytes()
    c.put("/api/projects/method/terms", json={"terms": TERMS})
    r = c.post("/api/projects/method/terms/unify", json={"content": FIXTURE})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 5 and len(body["changed_lines"]) == 3
    assert critic.reject(body["critic_markdown"]) == FIXTURE
    assert content_path.read_bytes() == before
    assert not list((projects / "method").glob("content.md.bak-*"))
    r = c.post("/api/projects/method/terms/unify", json={})
    assert r.status_code == 200 and r.json()["count"] > 0
    assert critic.reject(r.json()["critic_markdown"]) == content_path.read_text(encoding="utf-8")
    assert content_path.read_bytes() == before
    r = c.post("/api/projects/method/terms/unify", json={"content": FIXTURE, "names": ["不存在"]})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "terms"
    r = c.post("/api/projects/method/terms/unify",
               json={"content": FIXTURE, "names": ["基础预测模型"], "books": ["abstract"]})
    assert r.json()["count"] == 1 and len(r.json()["changed_lines"]) == 1


def test_corrupt_terms_json_422(client):
    """R46-01：腐坏 terms.json → 422 命名文件（R38 同型约定），非 500。"""
    c, projects, _ = client
    (projects / "method" / "terms.json").write_text("{oops", encoding="utf-8")
    r = c.get("/api/projects/method/terms")
    assert r.status_code == 422 and "terms.json" in r.json()["detail"]["message"]
    assert c.post("/api/projects/method/terms/unify", json={"content": "x"}).status_code == 422
    # 畸形 first_line 同样 422
    (projects / "method" / "terms.json").write_text(
        '{"version":1,"terms":[{"name":"x","first_line":"abc"}]}', encoding="utf-8")
    assert c.get("/api/projects/method/terms").status_code == 422
    # PUT 覆盖腐坏文件 → 自愈（原子写）
    r = c.put("/api/projects/method/terms", json={"terms": [{"name": "传感单元"}]})
    assert r.status_code == 200 and c.get("/api/projects/method/terms").status_code == 200
