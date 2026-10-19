# -*- coding: utf-8 -*-
"""Z32 Agent 成果度量：agent/metrics.case_metrics 纯聚合 + GET /agent/metrics。

覆盖：job id 去重、状态分桶、resumed 检测（step/result）、proposal state 分桶、
usage token 求和、费用/人工改动显式未采集、空案样本=0。
"""

import importlib
import os
import shutil
import sys
import time

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.agent import metrics  # noqa: E402


def _job(jid, status, created=1000.0, updated=1060.0, resumed=False, proposals=None, kind="agent:s1"):
    return {
        "id": jid,
        "kind": kind,
        "pid": "p",
        "status": status,
        "progress": 1.0,
        "message": "",
        "result": {"resumed": True} if resumed else {},
        "error": {"kind": "ai_upstream", "message": "boom"} if status == "error" else None,
        "created_at": created,
        "updated_at": updated,
        "steps": [{"kind": "done", "data": {"resumed": True}}] if resumed else [],
        "proposal_ids": proposals or [],
    }


def _prop(pid, jid, state, kind="critic"):
    return {"id": pid, "job_id": jid, "scenario": "s1", "kind": kind, "state": state, "model": "m", "created_at": 1.0}


def test_status_buckets_dedup_and_resumed():
    jobs = [
        _job("j1", "done", resumed=True, proposals=["p1"]),
        _job("j1", "done", resumed=True, proposals=["p1"]),  # 同 id 重复 → 去重计 1
        _job("j2", "error"),
        _job("j3", "interrupted"),
        _job("j4", "running"),
        _job("x1", "done", kind="convert"),  # 非 agent: 不计
    ]
    props = [_prop("p1", "j1", "pending"), _prop("p2", "j1", "applied"), _prop("p3", "j2", "dismissed")]
    m = metrics.case_metrics(jobs, props, [{"total_tokens": 100}, {"total_tokens": 50}])
    assert m["jobs"]["total"] == 4
    assert (
        m["jobs"]["done"] == 1
        and m["jobs"]["error"] == 1
        and m["jobs"]["interrupted"] == 1
        and m["jobs"]["running"] == 1
    )
    assert m["jobs"]["resumed"] == 1
    j1 = next(i for i in m["jobs"]["items"] if i["id"] == "j1")
    assert j1["duration_s"] == 60.0 and j1["resumed"] and j1["proposal_ids"] == ["p1"]
    j2 = next(i for i in m["jobs"]["items"] if i["id"] == "j2")
    assert j2["error"]["kind"] == "ai_upstream"  # 失败可追踪到 kind/message
    assert m["proposals"] == {
        "produced": 3,
        "pending": 1,
        "applied": 1,
        "dismissed": 1,
        "items": m["proposals"]["items"],
    }
    assert [p["state"] for p in m["proposals"]["items"]] == ["pending", "applied", "dismissed"]
    assert m["usage"] == {"rows": 2, "total_tokens": 150}
    assert m["cost"]["collected"] is False and "未采集" in m["cost"]["reason"]
    assert m["human_edits"]["collected"] is False
    assert any("采纳率" in x for x in m["limits"])


def test_empty_case():
    m = metrics.case_metrics([], [], [])
    assert m["sample"] == {"jobs": 0, "proposals": 0, "usage_rows": 0}
    assert m["jobs"]["total"] == 0 and m["proposals"]["produced"] == 0
    assert m["usage"]["total_tokens"] is None


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


def test_metrics_route_empty_then_with_job(client):
    c, pdir = client
    r = c.get("/api/projects/method/agent/metrics")
    assert r.status_code == 200, r.text
    assert r.json()["sample"] == {"jobs": 0, "proposals": 0, "usage_rows": 0}

    jobs = c.app.state.jobs
    j = jobs.create("agent:s1", "method", payload={"scenario": "s1", "params": {}})
    jobs.update(j, status="done", result={"proposals": [], "resumed": True}, progress=1.0)
    r = c.get("/api/projects/method/agent/metrics")
    d = r.json()
    assert d["jobs"]["total"] == 1 and d["jobs"]["done"] == 1 and d["jobs"]["resumed"] == 1
    assert d["jobs"]["items"][0]["duration_s"] is not None
    # 不落任何凭证/正文：响应只含计数与 id
    import json as _json

    assert '"content"' not in _json.dumps(d, ensure_ascii=False)
