# -*- coding: utf-8 -*-
"""Z31 查新证据对照：novelty.evidence 行 + /novelty/evidence + /novelty/annotate 批注边界。

覆盖：hit 未登记 422；quote 空恒 pending；权项不存在 422；批注落 comments 且不改正文。
"""

import importlib
import json
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))


def _projects(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(
        os.path.join(ROOT, "examples", "method"),
        projects / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    return projects


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    from app import config, main

    importlib.reload(config)
    main = importlib.reload(main)
    return TestClient(main.app), projects / "method"


HIT = {
    "number": "CN999999A",
    "title": "合成对比文件",
    "relevance": "X",
    "note": "",
    "link": "https://example.invalid/doc",
    "publication_date": "2020-01-15",
}


def _seed_hit(c):
    r = c.put("/api/projects/method/novelty", json={"hits": [HIT], "evidence": [], "queries": [], "conclusion": ""})
    assert r.status_code == 200, r.text


def test_hit_carries_publication_date(client):
    c, _ = client
    _seed_hit(c)
    rec = c.get("/api/projects/method/novelty").json()
    assert rec["hits"][0]["publication_date"] == "2020-01-15"


def test_evidence_requires_registered_hit(client):
    c, _ = client
    _seed_hit(c)
    r = c.post("/api/projects/method/novelty/evidence", json={"hit": "CN000000A", "quote": "x"})
    assert r.status_code == 422
    assert r.json()["detail"]["kind"] == "novelty"


def test_evidence_no_quote_forces_pending(client):
    c, _ = client
    _seed_hit(c)
    # 无原句：即便请求里写了 hit 状态，也恒 pending——无证据不能判命中
    r = c.post("/api/projects/method/novelty/evidence", json={"hit": "CN999999A", "status": "hit"})
    assert r.status_code == 201
    assert r.json()["evidence"]["status"] == "pending"
    q = c.post(
        "/api/projects/method/novelty/evidence",
        json={"hit": "CN999999A", "quote": "记载了指纹特征点", "status": "hit"},
    )
    assert q.json()["evidence"]["status"] == "hit"


def test_annotate_bad_claim_422_no_comment(client):
    c, pdir = client
    _seed_hit(c)
    r = c.post("/api/projects/method/novelty/annotate", json={"hit": "CN999999A", "claim": 99, "quote": "x"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "novelty"
    assert c.get("/api/projects/method/comments").json() == []


def test_annotate_creates_claim_anchored_comment_and_never_writes(client):
    c, pdir = client
    _seed_hit(c)
    src = pdir / "content.md"
    before = src.read_bytes()
    r = c.post(
        "/api/projects/method/novelty/annotate",
        json={
            "hit": "CN999999A",
            "claim": 2,
            "feature": "特征点集合构建",
            "quote": "对比文件记载了指纹特征点集合",
            "status": "hit",
        },
    )
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["evidence"]["status"] == "hit" and d["evidence"]["claim"] == 2
    cm = d["comment"]
    assert cm["anchor"]["block_id"] == "claims/2" and cm["anchor"]["line"] > 0
    assert cm["source"] == "ai"
    body = cm["body"]
    # 证据回链要素齐备：来源ID / URL / 公开日 / 原句 / 状态 + 非法律结论声明
    for frag in (
        "CN999999A",
        "https://example.invalid/doc",
        "2020-01-15",
        "对比文件记载了指纹特征点",
        "命中",
        "非法律意见",
    ):
        assert frag in body
    # 批注可见且正文未改
    assert any(x["id"] == cm["id"] for x in c.get("/api/projects/method/comments").json())
    assert src.read_bytes() == before


def test_annotate_missing_fulltext_degrades(client):
    c, _ = client
    _seed_hit(c)
    r = c.post("/api/projects/method/novelty/annotate", json={"hit": "CN999999A", "claim": 1})
    assert r.status_code == 201
    assert r.json()["evidence"]["status"] == "pending"
    assert "待核对" in r.json()["comment"]["body"]


def test_evidence_survives_roundtrip(client):
    c, pdir = client
    _seed_hit(c)
    c.post(
        "/api/projects/method/novelty/evidence",
        json={"hit": "CN999999A", "claim": 3, "quote": "s", "status": "partial"},
    )
    rec = c.get("/api/projects/method/novelty").json()
    assert len(rec["evidence"]) == 1 and rec["evidence"][0]["status"] == "partial"
    data = json.loads((pdir / ".studio" / "novelty.json").read_text())
    assert data["evidence"][0]["hit"] == "CN999999A"
