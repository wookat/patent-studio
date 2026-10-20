# -*- coding: utf-8 -*-
"""W19 批4 查新记录卡：GET/PUT /api/projects/{pid}/novelty + domain.novelty（.studio/novelty.json）。"""

import importlib
import json
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SECRET = "x" * 32
ERR_KEYS = {"kind", "message", "line", "detail"}


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    return projects


def _reload_app(auth):
    import app.auth
    import app.auth.router
    from app import config, main
    from app.domain import novelty
    from app.domain import projects as projects_mod
    from app.routes import novelty as routes_novelty

    importlib.reload(config)
    if auth:
        for name in ("db", "users", "acl", "schemas", "create_user"):
            sys.modules.pop(f"app.auth.{name}", None)
            app.auth.__dict__.pop(name, None)
        importlib.reload(app.auth)
        importlib.reload(app.auth.router)
    for m in (projects_mod, novelty, routes_novelty):
        importlib.reload(m)
    return importlib.reload(main)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    main = _reload_app(False)
    return TestClient(main.app), projects / "method"


@pytest.fixture()
def on(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    main = _reload_app(True)
    yield main
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    _reload_app(True)


def _err(r, status, kind="novelty"):
    assert r.status_code == status, r.text
    d = r.json()["detail"]
    assert set(d) == ERR_KEYS and d["kind"] == kind and d["line"] is None
    return d


HIT = {
    "number": "CN111000001A",
    "title": "一种数据处理方法",
    "relevance": "X",
    "note": "权1 新颖性风险",
    "link": "https://x",
    "publication_date": "",  # Z31：归一化后恒带此键
}
QUERY = {"query": "TACD:(数据处理)", "provider": "patsnap", "ran_at": "2026-10-01"}


def test_get_empty_then_put_roundtrip(client):
    c, d = client
    r = c.get("/api/projects/method/novelty")
    assert r.status_code == 200
    assert r.json() == {"updated_at": None, "queries": [], "hits": [], "evidence": [], "conclusion": ""}
    assert not os.path.exists(d / ".studio" / "novelty.json"), "GET 不应创建文件"

    body = {"queries": [QUERY], "hits": [HIT], "conclusion": "初判可专利，建议独权收窄到步骤二参数。"}
    r = c.put("/api/projects/method/novelty", json=body)
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["updated_at"] and rec["hits"] == [HIT] and rec["queries"] == [QUERY]
    assert rec["conclusion"] == body["conclusion"]
    on_disk = json.loads((d / ".studio" / "novelty.json").read_text(encoding="utf-8"))
    assert on_disk["hits"] == [HIT]
    assert c.get("/api/projects/method/novelty").json()["hits"] == [HIT]


def test_put_validation_422(client):
    c, _ = client
    for bad in (
        {"hits": [{"number": "", "title": ""}]},  # 无号无题
        {"hits": [{"number": "X1", "relevance": "Z"}]},  # 非法相关度
        {"queries": [{"query": ""}]},  # 空检索式
    ):
        _err(c.put("/api/projects/method/novelty", json=bad), 422)
    # 形态级错误走全局 pydantic 422（kind=validation），同样不落盘
    r = c.put("/api/projects/method/novelty", json={"hits": [{"number": "X1", "title": "t"}], "queries": "x"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "validation"
    assert c.get("/api/projects/method/novelty").json()["hits"] == []


def test_corrupt_file_422(client):
    c, d = client
    (d / ".studio").mkdir(exist_ok=True)
    (d / ".studio" / "novelty.json").write_text("{bad json", encoding="utf-8")
    _err(c.get("/api/projects/method/novelty"), 422)


def test_record_novelty_merge(client):
    """MCP 增量语义：query 去重追加、hit 按公开号覆盖、conclusion None 不覆盖。"""
    from app.domain import novelty as nov

    c, d = client
    store = c.app.state.store
    rec = nov.record_novelty(store, "method", queries=[QUERY], hits=[HIT], conclusion="第一版结论")
    assert rec["hits"] == [HIT] and rec["queries"] == [QUERY] and rec["conclusion"] == "第一版结论"

    rec = nov.record_novelty(
        store,
        "method",
        queries=[QUERY],
        hits=[{**HIT, "relevance": "Y"}, {"number": "CN222", "title": "另一篇", "relevance": "A"}],
    )
    assert [h["number"] for h in rec["hits"]] == ["CN111000001A", "CN222"]
    assert rec["hits"][0]["relevance"] == "Y"  # 同号覆盖
    assert len(rec["queries"]) == 1  # 同式同源去重
    assert rec["conclusion"] == "第一版结论"  # None 不覆盖
    assert json.loads((d / ".studio" / "novelty.json").read_text(encoding="utf-8"))["conclusion"] == "第一版结论"


def _register(c, email, password="pw-123456"):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "display_name": ""})
    assert r.status_code == 201, r.text


def _login(main, email, password="pw-123456"):
    c = TestClient(main.app)
    r = c.post("/api/auth/cookie/login", data={"username": email, "password": password})
    assert r.status_code == 204, r.text
    return c


def test_on_viewer_reads_editor_writes(on):
    anon = TestClient(on.app)
    for n in ("su", "viewer"):
        _register(anon, f"{n}@example.com")
    su, viewer = (_login(on, f"{n}@example.com") for n in ("su", "viewer"))
    r = su.put("/api/projects/method/members", json={"email": "viewer@example.com", "role": "viewer"})
    assert r.status_code == 200, r.text

    assert anon.get("/api/projects/method/novelty").status_code == 401
    assert viewer.get("/api/projects/method/novelty").status_code == 200
    r = viewer.put("/api/projects/method/novelty", json={"hits": [HIT]})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "editor"
    assert su.put("/api/projects/method/novelty", json={"hits": [HIT]}).status_code == 200
