# -*- coding: utf-8 -*-
"""阶段3 Z14/Z18/Z27：AI 长任务续跑（payload 断点 + resume 路由）、批注转提案、job↔提案诊断链。mock 提供方。"""

import os
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from app.agent import proposals
from app.agent.types import BlockAnchor, Proposal
from app.ai.jobs import JobStore
from app.domain import comments as comments_mod
from app.domain import events
from patent_studio.kernel import critic

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
        importlib_reload(m)
    with TestClient(main.app) as c:
        yield c, projects, main.app


def importlib_reload(m):
    import importlib

    importlib.reload(m)


def _enable(c):
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_enabled": True}).status_code == 200


def _wait_done(c, job_id, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = c.get(f"/api/ai/jobs/{job_id}").json()
        if j["status"] in ("done", "error", "interrupted"):
            return j
        time.sleep(0.02)
    raise AssertionError("任务未收敛")


def _crash(jobs, job, **fields):
    """把内存态丢掉、落盘 JSON 标 running——新 JobStore 重读即 interrupted（模拟进程重启）。"""
    return jobs.update(job, status="running", message="跑到一半进程没了", **fields)


def _restart(app, projects):
    app.state.jobs = JobStore(str(projects))
    return app.state.jobs


# ---------------- Z14：interrupted → resume ----------------


def test_resume_agent_job_with_checkpoint_finalizes_without_duplicates(client):
    """running 中断 + 已落盘提案 ⇒ resume 不重跑模型（零上游调用），提案不重复落盘。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    p_dir = str(projects / "method")
    job = jobs.create("agent:s6", "method", payload={"scenario": "s6", "params": {}})
    prop = Proposal(
        id=proposals.new_id(),
        job_id=job.id,
        scenario="s6",
        kind="comment",
        anchor=BlockAnchor(book="description", block_id="description/技术领域/p0001", line_start=1, line_end=1),
        comment_body="断点前已产出的批注提案",
        model="mock",
        created_at=time.time(),
    )
    proposals.append(p_dir, "method", prop, by=f"agent:{job.id}")
    _crash(jobs, job, proposal_ids=[prop.id])
    _restart(app, projects)

    # 重启后读到即 interrupted；带 payload ⇒ 可续跑
    j = c.get(f"/api/ai/jobs/{job.id}").json()
    assert j["status"] == "interrupted" and j["payload"]["scenario"] == "s6"
    assert j["proposal_ids"] == [prop.id]

    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    j = _wait_done(c, job.id)
    assert j["status"] == "done" and j["result"]["resumed"] is True
    assert j["result"]["proposals"] == [prop.id] and j["proposal_ids"] == [prop.id]
    assert j["steps"][-1]["kind"] == "done" and j["steps"][-1]["data"]["resumed"] is True

    # 提案仍只有断点那一条，且 comment 提案被补写为批注（state → applied）
    props = proposals.load(p_dir, "method", None)
    assert [q.id for q in props] == [prop.id]
    assert props[0].state == "applied"
    cs = comments_mod.load(p_dir)
    assert any(cm.body == "断点前已产出的批注提案" for cm in cs)
    # 续跑零模型调用
    assert app.state.ai.provider.calls == []

    # 幂等：终态再 resume ⇒ 409
    assert c.post(f"/api/ai/jobs/{job.id}/resume").status_code == 409


def test_resume_agent_job_critic_checkpoint_stays_pending(client):
    """pending critic 断点 ⇒ resume 收尾不自动应用（自动补写仅限 comment）：提案仍 pending、
    正文逐字节不变、零上游调用；再显式 apply 才进正文。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    p_dir = str(projects / "method")
    before = open(os.path.join(p_dir, "content.md"), encoding="utf-8").read()
    job = jobs.create("agent:s6", "method", payload={"scenario": "s6", "params": {}})
    prop = Proposal(
        id=proposals.new_id(),
        job_id=job.id,
        scenario="s6",
        kind="critic",
        anchor=BlockAnchor(book="abstract", block_id="abstract/p1", line_start=5, line_end=5),
        critic_markdown="{~~违规使用的风险~>非授权使用的风险~~}",
        model="mock",
        created_at=time.time(),
    )
    proposals.append(p_dir, "method", prop, by=f"agent:{job.id}")
    _crash(jobs, job, proposal_ids=[prop.id])
    _restart(app, projects)

    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 202, r.text
    j = _wait_done(c, job.id)
    assert j["status"] == "done" and j["result"]["resumed"] is True
    assert j["result"]["proposals"] == [prop.id]
    # critic 提案恒定待人审：仍 pending、正文逐字节不变、零上游调用
    props = proposals.load(p_dir, "method", None)
    assert [q.id for q in props] == [prop.id] and props[0].state == "pending"
    assert open(os.path.join(p_dir, "content.md"), encoding="utf-8").read() == before
    assert app.state.ai.provider.calls == []
    assert c.post(f"/api/ai/jobs/{job.id}/resume").status_code == 409  # 幂等

    # 人审显式 apply 才进正文（真实 apply 管线 + reject 不变量；正文存带标记文本）
    a = c.post(f"/api/projects/method/agent/proposals/{prop.id}/apply")
    assert a.status_code == 200 and a.json()["proposal"]["state"] == "applied"
    after = open(os.path.join(p_dir, "content.md"), encoding="utf-8").read()
    assert "非授权使用的风险" in critic.accept(after)
    assert critic.reject(after) == before


def test_resume_agent_job_without_checkpoint_reruns(client):
    """断点无产出 ⇒ resume 整任务重跑（同 queue_key 重排），正常产出提案。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    job = jobs.create("agent:s6", "method", payload={"scenario": "s6", "params": {}})
    _crash(jobs, job)
    _restart(app, projects)
    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 202
    j = _wait_done(c, job.id)
    assert j["status"] == "done" and j["result"]["proposals"]
    assert app.state.ai.provider.calls  # 这次真跑了模型
    p_dir = str(projects / "method")
    props = proposals.load(p_dir, "method", None)
    assert all(q.job_id == job.id for q in props)


def test_resume_review_job_reruns_same_scope(client):
    """review 任务 payload={scope}；interrupted 后续跑按同 scope 重跑，批注只写一次。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    job = jobs.create("review", "method", payload={"scope": "claims"})
    _crash(jobs, job)
    _restart(app, projects)
    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 202, r.text
    j = _wait_done(c, job.id)
    assert j["status"] == "done" and j["result"]["scope"] == "claims"
    cs = comments_mod.load(str(projects / "method"))
    assert cs and all(cm.author.id == "ai" for cm in cs)
    n = len(cs)
    # 再 resume ⇒ 409（终态），批注数不变
    assert c.post(f"/api/ai/jobs/{job.id}/resume").status_code == 409
    assert len(comments_mod.load(str(projects / "method"))) == n


def test_resume_error_job_retries(client):
    """error 也可重试（Z25「失败可重试」）：断点无产出时整跑。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    job = jobs.create("agent:s6", "method", payload={"scenario": "s6", "params": {}})
    jobs.update(job, status="error", error={"kind": "ai_timeout", "message": "超时"})
    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 202 and r.json()["error"] is None
    assert _wait_done(c, job.id)["status"] == "done"


def test_resume_guards(client):
    """无 payload ⇒ 422；未知 job ⇒ 404；非中断/失败态 ⇒ 409；不支持 kind ⇒ 422。"""
    c, projects, app = client
    _enable(c)
    jobs = app.state.jobs
    job = jobs.create("convert", "method")  # 无 payload
    _crash(jobs, job)
    jobs = _restart(app, projects)
    r = c.post(f"/api/ai/jobs/{job.id}/resume")
    assert r.status_code == 422
    assert c.post("/api/ai/jobs/job_000000000000/resume").status_code == 404
    ok = jobs.create("review", "method", payload={"scope": "all"})
    assert c.post(f"/api/ai/jobs/{ok.id}/resume").status_code == 409  # queued 非终态
    jobs.update(ok, status="done")
    assert c.post(f"/api/ai/jobs/{ok.id}/resume").status_code == 409


# ---------------- Z18：批注 → 修改提案 ----------------


def test_comment_to_proposal_creates_linked_critic(client):
    """客户/内部批注一键转提案：critic 提案落盘、source 记批注、job 台账记 proposal_ids。"""
    c, projects, app = client
    _enable(c)
    r = c.post(
        "/api/projects/method/comments",
        json={
            "anchor": {"block_id": "claims/1", "line": 9, "quote": "其特征在于"},
            "body": "建议把「其特征在于」改为「其特征为」",
        },
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    seen = []
    events.reset()
    events.subscribe("ai.proposal", seen.append)
    r = c.post(f"/api/projects/method/comments/{cid}/proposal")
    assert r.status_code == 201, r.text
    out = r.json()
    prop = out["proposal"]
    job = out["job"]
    assert prop["kind"] == "critic" and prop["state"] == "pending"
    assert prop["source"]["kind"] == "comment" and prop["source"]["comment_id"] == cid
    assert prop["source"]["quote"] == "其特征在于"
    # Z27 链路：proposal.job_id ⇄ job.proposal_ids
    assert prop["job_id"] == job["id"] and job["proposal_ids"] == [prop["id"]]
    assert job["kind"] == "comment2proposal" and job["status"] == "done"
    # 案卷 proposals 可见
    props = c.get("/api/projects/method/agent/proposals", params={"state": "pending"}).json()["proposals"]
    assert [p["id"] for p in props] == [prop["id"]]
    # 事件带 job_id 关联
    ev = seen[-1]
    assert ev.data["proposal_id"] == prop["id"] and ev.data["job_id"] == job["id"] and ev.data["comment_id"] == cid
    # 提案可正常应用（走既有 apply 管线 → CriticMarkup 进正文）
    a = c.post(f"/api/projects/method/agent/proposals/{prop['id']}/apply")
    assert a.status_code == 200 and a.json()["proposal"]["state"] == "applied"


def test_comment_to_proposal_rejects_file_anchor_and_disabled(client):
    c, projects, app = client
    _enable(c)
    r = c.post(
        "/api/projects/method/comments",
        json={"anchor": {"file": "docs/note.md"}, "body": "文件批注"},
    )
    assert r.status_code == 201
    cid = r.json()["id"]
    assert c.post(f"/api/projects/method/comments/{cid}/proposal").status_code == 422
    assert c.post("/api/projects/method/comments/nope/proposal").status_code == 404

    # AI 未开启 ⇒ 403 ai_disabled
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_enabled": False}).status_code == 200
    r = c.post(
        "/api/projects/method/comments",
        json={"anchor": {"block_id": "claims/1", "line": 9, "quote": "其特征在于"}, "body": "x"},
    )
    cid = r.json()["id"]
    r = c.post(f"/api/projects/method/comments/{cid}/proposal")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "ai_disabled"


# ---------------- Z27：诊断链 ----------------


def test_job_proposal_linkage_on_normal_run(client):
    """正常跑 agent 任务：job.proposal_ids、proposal.job_id、done 帧 proposals 一致。"""
    c, projects, app = client
    _enable(c)
    r = c.post("/api/projects/method/agent/run", json={"scenario": "s6", "params": {}})
    assert r.status_code == 202
    j = _wait_done(c, r.json()["id"])
    assert j["status"] == "done" and j["proposal_ids"]
    props = c.get("/api/projects/method/agent/proposals").json()["proposals"]
    assert sorted(p["id"] for p in props if p["job_id"] == j["id"]) == sorted(j["proposal_ids"])
    assert j["steps"][-1]["data"]["proposals"] == j["proposal_ids"]
    # agent/jobs 列表也带产出台账
    jobs = c.get("/api/projects/method/agent/jobs").json()["jobs"]
    assert jobs[0]["proposal_ids"] == j["proposal_ids"]
