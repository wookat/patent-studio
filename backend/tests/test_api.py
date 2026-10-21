# -*- coding: utf-8 -*-
"""API 集成测试：在临时目录复制 examples/method 作为案子，不触碰仓库文件。
soffice 转换在 CI/无 LibreOffice 环境中跳过（pdf=false）。
"""

import os
import shutil
from collections import Counter

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# method 案 lint 基线（05-r2 §4；test_preflight 同源断言）。
# 新语料正文自带 [NNNN] 段号前缀 → boundary.para_no×147 为真命中；非 boundary 项为
# 附图题注缺失 ×3 与模糊表述 ×2。
METHOD_LINT_IDS = Counter(
    {
        "boundary.para_no": 147,
        "preflight.figures.caption_missing#1": 1,
        "preflight.figures.caption_missing#2": 1,
        "preflight.figures.caption_missing#3": 1,
        "style.vague#L177": 1,
        "style.vague#L183": 1,
    }
)
METHOD_LINT_ONLY = [
    "preflight.figures.caption_missing#1",
    "preflight.figures.caption_missing#2",
    "preflight.figures.caption_missing#3",
    "style.vague#L177",
    "style.vague#L183",
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
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


def test_health_and_list(client):
    c, _ = client
    assert c.get("/api/health").json()["ok"] is True
    ids = [p["id"] for p in c.get("/api/projects").json()]
    assert ids == ["method"]
    p = c.get("/api/projects/method").json()
    assert p["title"].startswith("基于指纹信息的区块链电子钱包的私钥生成方法及系统")
    assert p["figs"][0] == "fig1.png"
    assert p["settings"]["abstract_figure"] == ["fig1.png", 14.5]


def test_save_content_creates_backup(client):
    c, projects = client
    orig = c.get("/api/projects/method/content").json()["content"]
    r = c.put("/api/projects/method/content", json={"content": orig + "\n"})
    assert r.status_code == 200 and r.json()["backup"].startswith("content.md.bak-")
    assert (projects / "method" / r.json()["backup"]).read_text(encoding="utf-8") == orig
    assert c.get("/api/projects/method/content").json()["content"] == orig + "\n"
    assert c.get(f"/api/projects/method/backups/{r.json()['backup']}").json()["content"] == orig


def test_settings_roundtrip_and_defaults(client):
    c, _ = client
    d = c.get("/api/settings/defaults").json()
    assert d["style"]["page"]["margin_left_mm"] == 25
    r = c.put(
        "/api/projects/method/settings",
        json={"style": {"page": {"margin_left_mm": 30}, "sizes": {"body": 12}}, "abstract_limit": 280},
    )
    assert r.status_code == 200
    s = r.json()["settings"]
    assert s["style"] == {"page": {"margin_left_mm": 30}}  # 只保留与默认的差异
    assert s["abstract_limit"] == 280
    assert r.json()["effective_style"]["page"]["margin_left_mm"] == 30


def test_build_docx_only_and_artifacts(client):
    c, _ = client
    r = c.post("/api/projects/method/build", json={"pdf": False})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "ok", j
    assert j["summary"]["abstract_chars"] == 286
    assert j["summary"]["claims"] == 10
    assert j["summary"]["paragraphs"] == 148
    assert j["timings"]["docx_ms"] > 0
    # 构建诊断 = lint 全量并入（段号前缀真命中 + 题注/模糊表述告警），无 error
    assert Counter(d["id"] for d in j["diagnostics"]) == METHOD_LINT_IDS
    assert all(d["severity"] == "warning" for d in j["diagnostics"])
    docx = c.get(j["docx_url"])
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    exp = c.get("/api/projects/method/export?fmt=docx")
    assert exp.status_code == 200 and "attachment" in exp.headers["content-disposition"]


def test_build_error_abstract_limit_has_line(client):
    c, _ = client
    content = c.get("/api/projects/method/content").json()["content"]
    settings = {**c.get("/api/projects/method").json()["settings"], "abstract_limit": 100}
    r = c.post("/api/projects/method/build", json={"pdf": False, "content": content, "settings": settings})
    j = r.json()
    assert j["status"] == "error"
    assert j["error"]["kind"] == "abstract_limit"
    assert "100" in j["error"]["message"] and "286" in j["error"]["message"]
    lines = content.splitlines()
    assert lines[j["error"]["line"] - 1].startswith("本申请")
    # 失败时 error 镜像为一条 source=build 的 diagnostic，且同一问题的 lint 项（abstract.limit）不重复
    ds = j["diagnostics"]
    assert ds[0]["source"] == "build" and ds[0]["id"] == "build.abstract_limit"
    assert ds[0]["severity"] == "error" and ds[0]["line"] == j["error"]["line"]
    assert ds[0]["message"] == j["error"]["message"] and ds[0]["detail"]
    assert [d["id"] for d in ds if d["source"] == "lint"] == METHOD_LINT_ONLY


def test_build_error_unknown_section_is_content(client):
    c, _ = client
    content = c.get("/api/projects/method/content").json()["content"].replace("## 权利要求书", "## 权利要求", 1)
    j = c.post("/api/projects/method/build", json={"pdf": False, "content": content}).json()
    assert j["status"] == "error"
    assert j["error"]["kind"] == "content"
    assert j["error"]["message"] == "未知章节「权利要求」：仅允许 摘要/权利要求书/说明书"
    assert content.splitlines()[j["error"]["line"] - 1] == "## 权利要求"
    ids = [d["id"] for d in j["diagnostics"]]
    assert ids[0] == "build.content"
    assert not any(i.startswith("spec.unknown_section") for i in ids)  # 同行 lint 项已去重
    assert any(i.startswith("claims.") for i in ids)  # 其余 lint 结果仍带回


def test_build_error_empty_document(client):
    c, _ = client
    j = c.post("/api/projects/method/build", json={"pdf": False, "content": ""}).json()
    assert j["status"] == "error"
    assert j["error"]["kind"] == "content" and j["error"]["message"].startswith("文档为空")
    # C0/P02 空正文门禁：显式拦截而非落到内部 NoneType 崩溃——detail 不再携带异常串
    assert "NoneType" not in j["error"]["message"]


def test_lint_endpoint_method_zero_error(client):
    c, _ = client
    r = c.post("/api/projects/method/lint", json={})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["counts"] == {"error": 0, "warning": 152, "info": 0}
    assert Counter(d["id"] for d in j["diagnostics"]) == METHOD_LINT_IDS
    assert c.post("/api/projects/nope/lint", json={}).status_code == 404


def test_lint_endpoint_forward_ref(client):
    c, _ = client
    content = c.get("/api/projects/method/content").json()["content"]
    bad = content.replace("根据权利要求1所述", "根据权利要求11所述", 1)
    assert bad != content
    j = c.post("/api/projects/method/lint", json={"content": bad}).json()
    ids = [d["id"] for d in j["diagnostics"]]
    # 权 2 → 权 11 为前向引用（新语料权项不构成环，cycle 项不再出现）；体检的 forward_ref 与十条同义被跳过
    assert ids[0] == "claims.forward_ref#2"
    assert Counter(ids) == METHOD_LINT_IDS + Counter({"claims.forward_ref#2": 1}), j
    d = j["diagnostics"][0]
    assert d["severity"] == "error" and d["source"] == "lint" and d["section"] == "权利要求书"
    assert bad.splitlines()[d["line"] - 1].startswith("2.")
    assert j["counts"]["error"] == 1


def test_lint_endpoint_settings_override(client):
    c, _ = client
    settings = {**c.get("/api/projects/method").json()["settings"], "abstract_limit": 100}
    j = c.post("/api/projects/method/lint", json={"settings": settings}).json()
    ids = [d["id"] for d in j["diagnostics"]]
    assert ids[0] == "abstract.limit"  # 体检的 abstract.limit 不重复
    assert Counter(ids) == METHOD_LINT_IDS + Counter({"abstract.limit": 1})
    # 部分 settings 与 build_config 同语义：缺省字段按 figs/ 推断（3 张 png），附图说明全提及 → 无 figures.ref 告警
    j = c.post("/api/projects/method/lint", json={"settings": {"abstract_limit": 100}}).json()
    ids = [d["id"] for d in j["diagnostics"]]
    assert j["counts"]["error"] == 1 and sum(i.startswith("figures.ref#") for i in ids) == 0
    assert c.post("/api/projects/method/lint", json={"settings": {"abstract_figure": "x"}}).status_code == 422


def test_build_error_equation_has_line(client, monkeypatch):
    """omml 线性解析器对畸形输入是宽容的（实测不抛错），这里注入一个渲染异常验证 定位到行号 的链路。"""
    import patent_studio.kernel.builder as bmod

    def boom(p, text, size=12):
        if "frac{a}{" in text:
            raise ValueError("unbalanced brace")
        return orig(p, text, size)

    orig = bmod.append_omml
    monkeypatch.setattr(bmod, "append_omml", boom)
    c, _ = client
    content = c.get("/api/projects/method/content").json()["content"]
    bad = content.replace("### 技术领域", "### 技术领域\n\n$$\\frac{a}{$$\n", 1)
    r = c.post("/api/projects/method/build", json={"pdf": False, "content": bad})
    j = r.json()
    assert j["status"] == "error", j
    assert j["error"]["kind"] == "equation"
    assert j["error"]["line"] is not None
    assert "\\frac{a}{" in bad.splitlines()[j["error"]["line"] - 1]


def test_build_error_unknown_figure(client):
    c, _ = client
    r = c.post("/api/projects/method/build", json={"pdf": False, "settings": {"abstract_figure": ["nope.emf", 14.5]}})
    j = r.json()
    assert j["status"] == "error"
    assert j["error"]["kind"] == "figure"
    assert "nope.emf" in j["error"]["message"]


def test_create_project(client):
    c, projects = client
    r = c.post("/api/projects", json={"id": "new-case", "title": "一种测试方法"})
    assert r.status_code == 201, r.text
    assert (projects / "new-case" / "content.md").exists()
    assert (projects / "new-case" / "studio.json").exists()
    assert (projects / "new-case" / "figs" / "fig1.png").exists()
    assert r.json()["settings"]["abstract_figure"] == ["fig1.png", 14.5]
    # 痛点 #15：新建案子首屏就能构建，且 lint 干净
    j = c.post("/api/projects/new-case/build", json={"pdf": False}).json()
    assert j["status"] == "ok", j
    assert j["summary"]["claims"] == 2 and j["diagnostics"] == []
    assert c.post("/api/projects/new-case/lint", json={}).json()["counts"]["error"] == 0
    assert c.post("/api/projects", json={"id": "new-case"}).status_code == 409
    assert c.post("/api/projects", json={"id": "../x"}).status_code == 400
    assert c.get("/api/projects/nope").status_code == 404


@pytest.mark.skipif(shutil.which("soffice") is None, reason="需要 LibreOffice")
def test_build_pdf_pages(client):
    c, _ = client
    j = c.post("/api/projects/method/build", json={}).json()
    assert j["status"] == "ok", j
    assert j["summary"]["pages"] == 11  # 新语料构建页数基线
    pdf = c.get(j["pdf_url"])
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"


def test_prune_keeps_latest_successful_pdf_build(tmp_path):
    """连续失败构建不能把最近一次成功（含 out.pdf）的产物清掉：前端 lastOk 仍指向它，PDF 卡片重挂会重取。"""
    from app.domain.build import _prune_builds

    builds = tmp_path / "builds"
    for i, ok in enumerate([True, False, False, False, False]):
        d = builds / f"b{i}"
        d.mkdir(parents=True)
        (d / "out.docx").write_bytes(b"x")
        if ok:
            (d / "out.pdf").write_bytes(b"%PDF")
        os.utime(d, (1000 + i, 1000 + i))
    _prune_builds(str(builds), 3)
    left = sorted(p.name for p in builds.iterdir())
    assert left == ["b0", "b2", "b3", "b4"]


def test_prune_skips_fresh_in_progress_build(tmp_path):
    """R88：落在 keep 窗口外但 mtime 新鲜（在跑）的目录不能被跨进程 rmtree。"""
    import time

    from app.domain.build import PRUNE_MIN_AGE_S, _prune_builds

    builds = tmp_path / "builds"
    now = time.time()
    for i in range(3):
        d = builds / f"old{i}"
        d.mkdir(parents=True)
        (d / "out.docx").write_bytes(b"x")
        os.utime(d, (1000 + i, 1000 + i))
    fresh = builds / "in-progress"  # 在跑：mtime 10 秒前，比 newest 旧 → 在 keep=1 窗口外
    fresh.mkdir()
    os.utime(fresh, (now - 10, now - 10))
    newest = builds / "newest"
    newest.mkdir()
    os.utime(newest, (now, now))
    _prune_builds(str(builds), 1)
    assert sorted(p.name for p in builds.iterdir()) == ["in-progress", "newest"]
    # 过龄后才进 prune 窗口
    os.utime(fresh, (now - PRUNE_MIN_AGE_S - 1, now - PRUNE_MIN_AGE_S - 1))
    _prune_builds(str(builds), 1)
    assert sorted(p.name for p in builds.iterdir()) == ["newest"]


def test_malformed_json_body_returns_422_not_500(client):
    """R26-01：请求体非法 JSON 时校验错误的 input 是原始 bytes，detail 序列化必须兜住——否则 500。"""
    c, _ = client
    r = c.put(
        "/api/projects/method/content", content=b"\x00\x01\x02 binary", headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422
    assert r.json()["detail"]["kind"] == "validation"
    r = c.post("/api/projects/method/lint", content=b"{", headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_security_headers_present(client):
    """R31-01：nosniff / X-Frame-Options SAMEORIGIN / Referrer-Policy 全站基线。"""
    c, _ = client
    for path in ("/api/health", "/api/projects/method/content", "/nonexistent"):
        r = c.get(path)
        assert r.headers.get("X-Content-Type-Options") == "nosniff", path
        assert r.headers.get("X-Frame-Options") == "SAMEORIGIN", path
        assert r.headers.get("Referrer-Policy") == "same-origin", path


def test_api_responses_no_store(client):
    """R115-批31：/api/ 全响应（含错误响应）Cache-Control: no-store——Chrome 实测会缓存
    410，公开链接复活后用户仍见「已过期」；显式声明的（style.css no-cache）不受影响。"""
    c, _ = client
    for path in ("/api/health", "/api/projects/method/content", "/api/no-such-endpoint"):
        r = c.get(path)
        assert r.headers.get("Cache-Control") == "no-store", path
    # 显式 no-cache 的 style.css 不被覆盖（setdefault 语义）
    r = c.get("/api/projects/method/style.css")
    assert r.headers.get("Cache-Control") == "no-cache"


def test_index_no_cache(client):
    """R115-批54：/ (index.html) Cache-Control: no-cache——部署换新 hash 资产后，
    启发式缓存的旧壳引用已删文件即整页 404 白屏；ETag 304 仍走快路径。"""
    c, _ = client
    r = c.get("/")
    assert r.status_code == 200, (r.status_code, r.text[:100])
    assert r.headers.get("Cache-Control") == "no-cache"


def test_settings_malformed_shapes_422(client):
    """R38-02：normalize_settings 尾部强转吞 IndexError/TypeError/KeyError → 统一 422。"""
    c, _ = client
    for bad in (
        {"abstract_figure": []},
        {"abstract_figure": ["fig1.png"]},
        {"abstract_figure": [["a"], "x"]},
        {"spec_figures": [["a"]]},
        {"spec_figures": [["a", "b", "c"]]},
        {"sub_except": [["x"]]},
    ):
        r = c.put("/api/projects/method/settings", json=bad)
        assert r.status_code == 422, (bad, r.status_code, r.text)


def test_settings_put_merges(client):
    """拍板：PUT /settings 为 merge 语义——只覆盖携带的键，未携带的保留；dict（style）深合并。"""
    c, _ = client
    r = c.put(
        "/api/projects/method/settings",
        json={"abstract_limit": 280, "ai_enabled": False, "style": {"page": {"margin_left_mm": 30}}},
    )
    assert r.status_code == 200, r.text
    # 第二次 PUT 只带 sub_except + style 另一组键——第一次的键应保留
    r = c.put("/api/projects/method/settings", json={"sub_except": ["权利要求"], "style": {"sizes": {"body": 13}}})
    assert r.status_code == 200, r.text
    s = r.json()["settings"]
    assert s["abstract_limit"] == 280  # 未携带：保留
    assert s["ai_enabled"] is False  # 未携带：保留
    assert s["sub_except"] == ["权利要求"]
    assert s["style"]["page"]["margin_left_mm"] == 30  # style 深合并：旧组保留
    assert s["style"]["sizes"]["body"] == 13  # style 深合并：新组生效
    # GET 复核落盘一致
    s2 = c.get("/api/projects/method/settings").json()["settings"]
    assert s2["abstract_limit"] == 280 and s2["ai_enabled"] is False


def test_corrupt_studio_json_422(client):
    """R38-03：studio.json 损坏 → GET/PUT /settings 报 422 而非 500。"""
    c, projects = client
    p = projects / "method" / "studio.json"
    p.write_text("{not json", encoding="utf-8")
    r = c.get("/api/projects/method/settings")
    assert r.status_code == 422, (r.status_code, r.text)
    assert "studio.json" in r.json()["detail"]
    # PUT 写路径自愈：normalize 后原子写覆盖坏文件，之后 GET 恢复
    r = c.put("/api/projects/method/settings", json={"abstract_limit": 100})
    assert r.status_code == 200, (r.status_code, r.text)
    assert c.get("/api/projects/method/settings").status_code == 200


def test_api_body_limit_413(client):
    """R115-批35：/api/ 非 multipart 请求体 8MB 上限——公开端点未认证即可 POST 超大 JSON
    裸读进内存（multipart 由 read_bounded 各路由自管）。CL 快路径 + chunked 流读兜底。"""
    from app import main

    c, _ = client
    limit = main._API_BODY_MAX
    big = b'{"content":"' + b"a" * (limit + 1) + b'"}'
    r = c.post("/api/projects/method/lint", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413, (r.status_code, r.text[:200])
    assert r.json()["detail"]["kind"] == "file"
    assert r.headers.get("Cache-Control") == "no-store"  # 经 _security_headers 外层仍带安全头

    # 无 Content-Length（chunked 生成器）：流读路径同样封顶
    def chunks():
        yield b'{"content":"'
        yield b"a" * (limit + 1)
        yield b'"}'

    r = c.post("/api/projects/method/lint", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413

    # 小体 chunked：流读回填 _body 后下游 json() 照常解析（坏 JSON → 422 而非 500/卡死）
    def small():
        yield b"{"

    r = c.post("/api/projects/method/lint", content=small(), headers={"Content-Type": "application/json"})
    assert r.status_code == 422
