# -*- coding: utf-8 -*-
"""轨道 E prep 骨架（docs/plan/09 §8）：settings.ai_enabled 默认 false、
mock 供应商 / 提示词 / 任务表可用、lint 的 terms 钩子零漂移。
各单元的功能测试见 test_ai / test_terms / test_convert / test_oa。
"""
import asyncio
import importlib
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from app.ai import prompts
from app.ai.client import MODELS, Usage
from app.ai.jobs import JobStore
from app.ai.mock import MockProvider
from app.domain.lint import lint

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    return TestClient(main.app), projects


def test_ai_status_no_egress(client):
    c, _ = client
    s = c.get("/api/ai/status").json()
    assert s["provider"] == "mock" and s["key_present"] is True and s["reachable"] is None
    assert s["models"] == {"interactive": "swe-2-medium", "heavy": "swe-2-max", "fallback": "swe-2-high"}
    assert c.get("/api/ai/status?probe=1").json()["reachable"] is True  # mock 不出站


def test_settings_ai_enabled_default_false_and_roundtrip(client):
    c, projects = client
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert s.get("ai_enabled", False) is False  # 两案 studio.json 不含该键 ⇒ 缺省 false（不回写文件，零漂移）
    r = c.put("/api/projects/method/settings", json={**s, "ai_enabled": True})
    assert r.status_code == 200 and r.json()["settings"]["ai_enabled"] is True
    assert c.get("/api/projects/method/settings").json()["settings"]["ai_enabled"] is True
    # 契约更新（拍板：merge 语义）：未携带 ai_enabled 的 PUT 保留现值，不再回落默认
    r = c.put("/api/projects/method/settings", json={k: v for k, v in s.items() if k != "ai_enabled"})
    assert r.status_code == 200 and r.json()["settings"]["ai_enabled"] is True
    # 显式关掉才回落
    r = c.put("/api/projects/method/settings", json={"ai_enabled": False})
    assert r.status_code == 200 and r.json()["settings"]["ai_enabled"] is False


def test_jobs_endpoints(client):
    c, projects = client
    assert c.get("/api/projects/method/ai/jobs").json() == {"jobs": []}
    assert c.get("/api/ai/jobs/job_nope").status_code == 404
    from app import main

    job = main.app.state.jobs.create("review", "method")
    assert os.path.isfile(projects / "method" / ".studio" / "ai-jobs" / (job.id + ".json"))
    got = c.get(f"/api/ai/jobs/{job.id}").json()
    assert got["status"] == "queued" and got["kind"] == "review" and got["pid"] == "method"
    assert [j["id"] for j in c.get("/api/projects/method/ai/jobs").json()["jobs"]] == [job.id]


def test_jobstore_persist_and_interrupt(tmp_path):
    (tmp_path / "p").mkdir()
    js = JobStore(str(tmp_path))
    job = js.create("convert", "p")
    job = js.update(job, status="running", progress=0.5, message="生成中")
    assert js.busy("p", "convert") and not js.busy("p", "review")
    js2 = JobStore(str(tmp_path))  # 模拟重启：进行中 ⇒ interrupted
    got = js2.get(job.id)
    assert got is not None and got.status == "interrupted"
    assert js2.list("p")[0].id == job.id


def test_prompts_and_mock_provider():
    msgs = prompts.build("rewrite", "请润色：所述传感器把数据发给处理器进行处理。", context="当前书：权利要求书")
    assert msgs[0]["content"].startswith("[patent-studio:rewrite]") and "CriticMarkup" in msgs[0]["content"]
    assert prompts.kind_of(msgs) == "rewrite" and prompts.kind_of([{"role": "user", "content": "x"}]) == "chat"
    for kind in ("review", "convert", "oa_answer", "terms_extract"):
        assert prompts.system_for(kind).schema is not None
    with pytest.raises(ValueError):
        prompts.system_for("nope")

    mp = MockProvider()

    async def run():
        text, usage = await mp.complete(MODELS["interactive"], msgs, timeout=30)
        chunks = [c async for c in mp.stream(MODELS["interactive"], msgs, timeout=30)]
        return text, usage, chunks

    text, usage, chunks = asyncio.run(run())
    assert text.startswith("{~~") and "~>" in text and isinstance(usage, Usage) and usage.total_tokens > 0
    assert "".join(c for c in chunks if isinstance(c, str)) == text and isinstance(chunks[-1], Usage)
    assert len(mp.calls) == 2

    review = asyncio.run(mp.complete(MODELS["heavy"], prompts.build("review", "审阅"), timeout=300))[0]
    data = prompts.parse_json(review, prompts.SCHEMAS["review"])
    assert data["items"][0]["rule"] == "A26.4"
    assert prompts.parse_json("```json\n{\"items\": []}\n```", prompts.SCHEMAS["review"]) == {"items": []}
    with pytest.raises(ValueError):
        prompts.parse_json("{}", prompts.SCHEMAS["review"])
    # 尾随/前导评论救回首个完整对象（vit-8 实案 BudgetExceeded 根修）
    assert prompts.parse_json('{"items": []}\n\n补充说明', None) == {"items": []}
    assert prompts.parse_json('以下是输出：\n{"items": []}\n以上是结果', None) == {"items": []}
    with pytest.raises(ValueError):
        prompts.parse_json('{"items": [', None)


def test_lint_terms_hook_zero_drift():
    with open(os.path.join(ROOT, "examples", "method", "content.md"), encoding="utf-8") as f:
        text = f.read()
    base = lint(text, with_preflight=True)
    assert lint(text, with_preflight=True, terms=[]) == base
    assert lint(text, with_preflight=True, terms=[{"name": "处理器", "aliases": ["处理单元"]}]) == base


def test_history_commit_draft_does_not_touch_worktree(tmp_path):
    """09 §3.3：一键转专利的「草稿版本」= history.commit_draft：工作区不变、HEAD 前进、show/diff/restore 可用。"""
    from app.domain import history

    d = tmp_path / "p"
    d.mkdir()
    work = "# T\n\n## 摘要\n\na\n"
    (d / "content.md").write_text(work, encoding="utf-8")
    base = history.commit(str(d), "save")
    assert base

    draft = "# T\n\n## 摘要\n\nAI 草稿\n"
    sha = history.commit_draft(str(d), draft, "draft: 论文转专利", author="ai")
    assert sha and len(sha) == 40 and sha != base
    assert (d / "content.md").read_text(encoding="utf-8") == work  # 工作区未被覆盖
    assert not [n for n in os.listdir(history.git_dir(str(d))) if n.startswith("draft-index-")]
    assert history.head(str(d)) == sha
    assert history.show(str(d), sha) == draft
    assert history.show(str(d), base) == work
    assert "-a\n+AI 草稿" in history.diff(str(d), base, sha)
    assert "-AI 草稿\n+a" in history.diff(str(d), sha)  # 草稿 vs 工作区
    versions = history.log(str(d))
    assert [v["sha"] for v in versions] == [sha, base]
    assert versions[0]["author"] == "ai" and versions[0]["message"] == "draft: 论文转专利"
    # 下一次普通保存仍以工作区为准：工作区改动后 commit 产生新版本，草稿仍可达
    (d / "content.md").write_text(work + "b\n", encoding="utf-8")
    nxt = history.commit(str(d), "save")
    assert nxt and history.show(str(d), nxt) == work + "b\n"
    assert history.show(str(d), sha) == draft
