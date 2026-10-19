# -*- coding: utf-8 -*-
"""Z20 权项沙盘：domain.claim_sandbox 纯函数 + /claims/{num}(/preview) 路由回归。

不依赖 PG；路由冒烟复用 examples/method 合成案卷（与 test_novelty 同一 fixture 约定）。
"""

import importlib
import os
import shutil
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.domain import claim_sandbox as sb  # noqa: E402


def _node(num, refs, kind=None):
    return {
        "num": num,
        "kind": kind or ("dependent" if refs else "independent"),
        "category": "method",
        "refs": refs,
        "children": [],
        "line": num,
        "issues": [],
    }


TREE = [
    _node(1, []),
    _node(2, [1]),
    _node(3, [2]),
    _node(4, [2]),
    _node(5, [1]),
    _node(6, [5]),
    _node(7, [1]),
    _node(8, []),
    _node(10, [1, 2, 3, 4, 5, 6, 7]),
]
SUPPORT = [
    {"term": "特征点集合", "claims": [1, 2], "matched": True, "description_lines": [55, 63]},
    {"term": "归一化矩阵", "claims": [5], "matched": True, "description_lines": [219]},
    {"term": "无关术语", "claims": [8], "matched": False, "description_lines": []},
]


def test_detail_direct_and_transitive_downstream():
    d = sb.detail(TREE, SUPPORT, 2)
    # 权10 引用 1..7，故 2 的直接从属为 3、4、10
    assert d["ok"] and d["direct_dependents"] == [3, 4, 10] and d["downstream"] == [3, 4, 10]
    assert d["upstream"] == [1]
    assert [r["term"] for r in d["support"]] == ["特征点集合"]
    d1 = sb.detail(TREE, SUPPORT, 1)
    assert d1["downstream"] == [2, 3, 4, 5, 6, 7, 10]


def test_detail_unknown_claim():
    assert sb.detail(TREE, SUPPORT, 99)["ok"] is False


def test_preview_ok_reorders_and_computes_diff():
    # 权5 现引用 [1]；改为 [1,4]：4<5 合法多引，上游应含 1→2→4 链
    r = sb.preview(TREE, SUPPORT, 5, [1, 4])
    assert r["ok"] and r["proposed_refs"] == [1, 4]
    assert r["ref_diff"] == {"added": [4], "removed": []}
    assert r["downstream"] == [6, 10]
    assert r["upstream"] == [1, 2, 4]
    terms = {x["term"] for x in r["support"]}
    assert "特征点集合" in terms and "无关术语" not in terms


def test_preview_blockers():
    self_r = sb.preview(TREE, SUPPORT, 3, [3])
    assert self_r["ok"] is False and self_r["blockers"][0]["kind"] == "self"
    miss = sb.preview(TREE, SUPPORT, 3, [1, 42])
    assert miss["ok"] is False and any(b["kind"] == "missing" and b["refs"] == [42] for b in miss["blockers"])
    fwd = sb.preview(TREE, SUPPORT, 3, [8])
    assert fwd["ok"] is False and any(b["kind"] == "forward" for b in fwd["blockers"])
    unknown = sb.preview(TREE, SUPPORT, 99, [1])
    assert unknown["ok"] is False and unknown["blockers"][0]["kind"] == "unknown_claim"


def test_preview_invalid_refs_not_silently_dropped():
    """复核项1：纯函数对非法 token 必须显式阻断，不能过滤后返 ok=true。"""
    for bad in ([-1], [0], [True], [1.0], ["abc"], [1.5]):
        r = sb.preview(TREE, SUPPORT, 5, bad)
        assert r["ok"] is False, bad
        assert any(b["kind"] == "invalid_ref" for b in r["blockers"]), bad
    # 合法与非法混合：非法项单独点名，合法项仍按语义校验（missing 也在）
    mixed = sb.preview(TREE, SUPPORT, 5, [1, -2, 99])
    assert mixed["ok"] is False
    kinds = {b["kind"] for b in mixed["blockers"]}
    assert "invalid_ref" in kinds and "missing" in kinds
    # 合法空列表 = 移除全部引用 → 变独立权（不视为非法输入）
    clearing = sb.preview(TREE, SUPPORT, 5, [])
    assert clearing["ok"] is True and any(w["kind"] == "becomes_independent" for w in clearing["warnings"])


def test_preview_cycle_blocked_with_path():
    # 若权2 改为引用权4，而 4→2 已存在 → 2→4→2 成环
    r = sb.preview(TREE, SUPPORT, 2, [4])
    assert r["ok"] is False
    cyc = [b for b in r["blockers"] if b["kind"] == "cycle"]
    assert cyc and cyc[0]["path"] == [2, 4, 2]


def test_preview_warnings():
    r = sb.preview(TREE, SUPPORT, 3, [])
    assert r["ok"] and any(w["kind"] == "becomes_independent" for w in r["warnings"])
    r1 = sb.preview(TREE, SUPPORT, 1, [2])
    assert any(w["kind"] == "first_dependent" for w in r1["warnings"])


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
    return TestClient(main.app)


def test_routes_readonly_sandbox(client):
    r = client.get("/api/projects/method/claims/2")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["current_refs"] == [1] and d["direct_dependents"] == [3, 4, 10] and 10 in d["downstream"]

    ok = client.post("/api/projects/method/claims/5/preview", json={"refs": [1, 4]})
    assert ok.status_code == 200 and ok.json()["ok"] is True

    bad = client.post("/api/projects/method/claims/2/preview", json={"refs": [4]})
    assert bad.status_code == 200 and bad.json()["ok"] is False
    assert any(b["kind"] == "cycle" for b in bad.json()["blockers"])

    miss = client.post("/api/projects/method/claims/3/preview", json={"refs": [42]})
    assert miss.json()["ok"] is False and miss.json()["blockers"][0]["kind"] == "missing"


def test_preview_route_rejects_non_strict_refs(client):
    """复核项1：API 层严格正整数——bool/浮点/字符串/≤0/非列表一律 422，不进入 preview。"""
    for body in (
        {"refs": [True]},
        {"refs": [False, 1]},
        {"refs": [1.0]},
        {"refs": [1.5]},
        {"refs": ["1"]},
        {"refs": ["abc"]},
        {"refs": [-1]},
        {"refs": [0]},
        {"refs": "1,2"},
        {"refs": 3},
        {"refs": None},
    ):
        r = client.post("/api/projects/method/claims/5/preview", json=body)
        assert r.status_code == 422, (body, r.status_code, r.text)
    # 不设权项数上限：超大正整数走 missing 语义而非 422
    big = client.post("/api/projects/method/claims/5/preview", json={"refs": [999]})
    assert big.status_code == 200 and big.json()["ok"] is False
    assert any(b["kind"] == "missing" for b in big.json()["blockers"])
    # 空列表合法（清空全部引用）
    empty = client.post("/api/projects/method/claims/5/preview", json={"refs": []})
    assert empty.status_code == 200 and empty.json()["ok"] is True
    no_key = client.post("/api/projects/method/claims/5/preview", json={})
    assert no_key.status_code == 200 and no_key.json()["ok"] is True


def test_preview_never_writes(tmp_path, monkeypatch):
    """只读沙盘：调用前后 content.md 字节不变（不静默改号/改写）。"""
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    from app import config, main

    importlib.reload(config)
    c = TestClient(importlib.reload(main).app)
    src = projects / "method" / "content.md"
    before = src.read_bytes()
    c.post("/api/projects/method/claims/2/preview", json={"refs": [4]})
    c.post("/api/projects/method/claims/5/preview", json={"refs": [1, 4]})
    assert src.read_bytes() == before
