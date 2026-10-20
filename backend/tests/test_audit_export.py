# -*- coding: utf-8 -*-
"""Z33 案卷审计导出：GET /api/projects/{pid}/audit/export?fmt=json|csv。

断言：事件 / 确认 / 提案 / 版本四节齐；actor / version / sha / approval 关系透出；
share token / PAT / 提案正文不落导出。"""

import importlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    with TestClient(main.app) as c:
        yield c, projects / "method"


def _seed(pdir):
    """确认 + 提案 + 版本（history commit 经 PUT content）。"""
    from app.domain import cases

    case = cases.ensure_case(str(pdir))
    case.confirmations.append(
        cases.Confirmation(
            version=3,
            sha="abc123sha",
            content_sha="csha",
            name="张三",
            note="确认定稿",
            confirmed_at=1_700_000_000.0,
            actor="client:张三",
            ip="1.2.3.4",
            ua="ua",
            token="SECRET-TOKEN-DO-NOT-EXPORT",
        )
    )
    cases.save_case(str(pdir), case)
    prop_dir = pdir / ".studio" / "ai-proposals"
    prop_dir.mkdir(parents=True, exist_ok=True)
    row = {
        "id": "prop_1",
        "job_id": "job_1",
        "scenario": "s1",
        "kind": "critic",
        "anchor": {"kind": "block", "block_id": "claims/1"},
        "critic_markdown": "秘密提案正文不应出现在导出里",
        "model": "mock",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        "created_at": 1_700_000_001.0,
        "state": "applied",
        "by": "reviewer@x.com",
        "ts": 1_700_000_002.0,
    }
    with open(prop_dir / "method.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_audit_export_json_sections_and_redaction(client):
    c, pdir = client
    md = (pdir / "content.md").read_text(encoding="utf-8") + "\n审计版本追加\n"
    c.put("/api/projects/method/content", json={"content": md})
    _seed(pdir)

    r = c.get("/api/projects/method/audit/export")
    assert r.status_code == 200
    doc = r.json()
    assert doc["pid"] == "method" and doc["exported_at"]
    for section in ("events", "confirmations", "proposals", "versions"):
        assert section in doc and doc[section]

    # 事件：save 产生的 history 版本 + share.confirmed（确认派生）
    kinds = {e["kind"] for e in doc["events"]}
    assert "share.confirmed" in kinds

    # 确认：版本指纹透出、凭证不落
    cf = doc["confirmations"][0]
    assert cf["version"] == 3 and cf["sha"] == "abc123sha" and cf["name"] == "张三"
    assert "token" not in cf and "SECRET-TOKEN" not in r.text

    # 提案：state/by/job 透出，正文不落
    prop = doc["proposals"][0]
    assert prop["id"] == "prop_1" and prop["state"] == "applied" and prop["by"] == "reviewer@x.com"
    assert "critic_markdown" not in prop and "秘密提案正文" not in r.text

    # 版本：history commit（save + backup 迁移）
    assert any(v["message"].startswith("backup ") for v in doc["versions"])
    assert all({"sha", "at", "author"} <= set(v) for v in doc["versions"])

    assert c.get("/api/projects/nope/audit/export").status_code == 404


def test_audit_export_csv_download(client):
    c, pdir = client
    _seed(pdir)
    r = c.get("/api/projects/method/audit/export?fmt=csv")
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8-sig")
    assert text.splitlines()[0] == "section,ts,actor,summary,extra"
    assert "confirmation" in text and "proposal" in text and "version" in text
    assert "SECRET-TOKEN" not in text
