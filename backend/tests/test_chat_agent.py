# -*- coding: utf-8 -*-
"""批2 chat agent 工具循环：读工具直跑 / 写工具+计划确认卡 / resume 续跑 / 拒绝分支 / 步数闸。"""

import asyncio
import importlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from app.agent import chat_engine
from app.ai.client import AiClient, Usage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MSGS = [{"role": "user", "content": "干活"}]


class ScriptProvider:
    """带 complete_tools 的剧本 provider：script 依次为每轮应返回的 assistant message。
    name="mock" 让 AiClient 免 PATENT_STUDIO_AI_KEY 检查。"""

    name = "mock"

    def __init__(self, script: list[dict]):
        self.script = list(script)
        self.calls: list[list[dict]] = []

    async def complete_tools(self, model, messages, *, tools, timeout, max_tokens, temperature):
        self.calls.append(messages)
        assert tools and any(t["function"]["name"] == "propose_plan" for t in tools)
        assert any(t["function"]["name"] == "get_ast" for t in tools)
        msg = self.script.pop(0)
        return msg, Usage(10, 5, 15)

    async def list_models(self):
        return []


def _tc(name, args, i="0"):
    return {"id": f"call_{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def _msg_tool(*calls):
    return {"role": "assistant", "content": None, "tool_calls": list(calls)}


def _msg_text(text):
    return {"role": "assistant", "content": text}


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
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "script")  # 任意非 mock；provider 直接注入
    from app import config, main
    from app.agent import chat_engine
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod
    from app.mcp import server as mcp_server_mod
    from app.mcp import tools, tools_attachments, tools_case, tools_figures, tools_lifecycle, tools_semantic

    # 与 test_mcp._reload_app 同序：projects 先行（ProjectError 类身份），
    # mcp 工具模块随后（各自 _BUSINESS 捕同一类），server 重绑单例 store，
    # chat_engine 最后重绑 mcp_server 引用；main 收尾。
    for m in (
        config,
        projects_mod,
        build,
        xml_export,
        tools,
        tools_figures,
        tools_case,
        tools_attachments,
        tools_semantic,
        tools_lifecycle,
        mcp_server_mod,
        chat_engine,
        main,
    ):
        importlib.reload(m)
    with TestClient(main.app) as c:
        yield c, projects, main.app


def _enable(c):
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_enabled": True}).status_code == 200


def _events(r):
    out = []
    for line in r.iter_lines():
        if line.startswith("data: "):
            out.append(json.loads(line[6:]))
    return out


def _post(c, body):
    with c.stream("POST", "/api/projects/method/ai/chat", json=body) as r:
        assert r.status_code == 200, r.text
        return _events(r)


def test_agent_read_tool_then_answer(client):
    c, projects, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(_tc("get_ast", {"pid": "method"})),
                _msg_text("权利要求共 11 项。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS, "scope": {"source": True}})  # 声明整卷正文授权（P05 最小授权默认不放行读工具）
    steps = [e["step"] for e in ev if "step" in e]
    assert [s["status"] for s in steps] == ["running", "ok"] and steps[0]["name"] == "get_ast"
    assert "".join(e["delta"] for e in ev if "delta" in e) == "权利要求共 11 项。"
    assert ev[-1]["done"] is True and ev[-1]["steps"] == 1
    # 第二轮入参含 assistant tool_calls 消息 + role=tool 结果
    last = app.state.ai.provider.calls[-1]
    assert any(m.get("role") == "tool" and "claims" in m["content"] for m in last)
    # 审计落案：逐件工具调用 + chat_run 任务汇总（批3-B）
    audit_rows = [
        json.loads(ln)
        for ln in (projects / "method" / ".studio" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert any(r["tool"] == "get_ast" for r in audit_rows)
    run_rows = [r for r in audit_rows if r["tool"] == "chat_run"]
    assert len(run_rows) == 1 and run_rows[0]["result"] == "ok"
    assert run_rows[0]["args"]["tools"] == ["get_ast"] and run_rows[0]["args"]["steps"] == 1
    assert run_rows[0]["args"]["resumed"] is False
    # list_audit 工具可读回本账（外部 agent 同口径；fixture 已 reload，模块内取现绑定）
    from app.mcp import server as srv_mod

    rows = asyncio.run(srv_mod.server._tool_manager.call_tool("list_audit", {"pid": "method", "limit": 5}, None))
    assert rows and rows[0]["tool"] == "chat_run"


def test_agent_write_tool_confirm_resume(client):
    c, projects, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(_tc("patch_block", {"pid": "method", "block_id": "abstract/p1", "markdown": "改写摘要。"})),
                _msg_text("已按建议挂提案。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS})
    conf = [e["confirm"] for e in ev if "confirm" in e]
    assert len(conf) == 1 and conf[0]["tool"] == "patch_block" and conf[0]["danger"] is False
    assert conf[0]["resume"]["assistant"]["tool_calls"] and conf[0]["resume"]["calls"]
    assert not any(e.get("done") for e in ev)
    # 停在确认卡的任务落 confirm:<tool>（批3-B 任务记录）
    runs = [
        json.loads(ln)
        for ln in (projects / "method" / ".studio" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(ln)["tool"] == "chat_run"
    ]
    assert len(runs) == 1 and runs[0]["result"] == "confirm:patch_block"
    # 未确认前未写：正文无新文本
    assert "改写摘要" not in (projects / "method" / "docs" / "abstract.md").read_text(encoding="utf-8")

    ev2 = _post(c, {"messages": MSGS, "resume": conf[0]["resume"], "approved": True})
    steps = [e["step"] for e in ev2 if "step" in e]
    assert steps[0]["name"] == "patch_block" and steps[1]["status"] == "ok"
    assert "".join(e["delta"] for e in ev2 if "delta" in e) == "已按建议挂提案。"
    # 非 direct：CriticMarkup 建议写入正文（{~~旧~>新~~} / {++ ++}），待作者接受/拒绝
    after = (projects / "method" / "docs" / "abstract.md").read_text(encoding="utf-8")
    assert "改写摘要" in after and ("{~~" in after or "{++" in after)


def test_agent_write_declined(client):
    c, projects, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(_tc("delete_comment", {"pid": "method", "cid": "c1"})),
                _msg_text("好的，不删。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS})
    conf = [e["confirm"] for e in ev if "confirm" in e][0]
    assert conf["danger"] is True
    ev2 = _post(c, {"messages": MSGS, "resume": conf["resume"], "approved": False})
    steps = [e["step"] for e in ev2 if "step" in e]
    assert steps[0]["status"] == "error" and "拒绝" in steps[0]["summary"]
    # 模型收到 declined 工具结果
    last = app.state.ai.provider.calls[-1]
    assert any(m.get("role") == "tool" and "declined" in m["content"] for m in last)


def test_agent_plan_gate(client):
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(_tc("propose_plan", {"plan_md": "1. 读三书\n2. 体检\n3. 提案"})),
                _msg_tool(_tc("get_ast", {"pid": "method"})),
                _msg_text("按计划完成第一步。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS})
    conf = [e["confirm"] for e in ev if "confirm" in e][0]
    assert conf["tool"] == "propose_plan" and "体检" in conf["plan_md"]
    ev2 = _post(c, {"messages": MSGS, "resume": conf["resume"], "approved": True})
    # plan 通过 → 继续跑 get_ast（读）→ 文本
    names = [e["step"]["name"] for e in ev2 if "step" in e]
    assert "propose_plan" in names and "get_ast" in names
    assert "按计划完成第一步" in "".join(e["delta"] for e in ev2 if "delta" in e)


def test_agent_resume_malformed(client):
    """resume 无签名回执 → 409（缺 receipt/旧版回执一律拒，零上游调用）。"""
    c, projects, app = client
    _enable(c)
    app.state.ai = AiClient(ScriptProvider([]))
    import hashlib

    sha = hashlib.sha256((projects / "method" / "content.md").read_bytes()).hexdigest()
    r = c.post(
        "/api/projects/method/ai/chat",
        json={"messages": MSGS, "resume": {"assistant": None, "calls": [], "content_sha": sha}, "approved": True},
    )
    assert r.status_code == 409
    assert app.state.ai.provider.calls == []


def test_agent_resume_stale_sha_rejected(client):
    """P05：续跑绑定案卷+正文版本——篡改/过期回执 → 409，不进事件流。"""
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(ScriptProvider([]))
    stale = {"assistant": {"role": "assistant", "content": "x"}, "calls": [{"id": "c1"}], "content_sha": "0" * 64}
    r = c.post("/api/projects/method/ai/chat", json={"messages": MSGS, "resume": stale, "approved": True})
    assert r.status_code == 409
    assert app.state.ai.provider.calls == []  # 零上游调用


def _confirm_resume(c, body=None):
    """发一轮 agent 对话拿到第一张 confirm 卡的签名续跑回执。"""
    ev = _post(c, body or {"messages": MSGS})
    return [e["confirm"] for e in ev if "confirm" in e][0]["resume"]


def _tool_round(client, scope, *tool_calls):
    """一轮真实 agent 对话：script 先出 tool_calls，再出文本；返回第二轮 provider 入参。"""
    c, projects, app = client
    _enable(c)
    app.state.ai = AiClient(ScriptProvider([_msg_tool(*tool_calls), _msg_text("done")]))
    ev = _post(c, {"messages": MSGS, "scope": scope})
    assert ev[-1].get("done") is True
    return app.state.ai.provider.calls[-1], projects


def test_derived_tools_projected_without_full_source(client):
    """P05尾检：衍生记录工具不能当纯 metadata 透传——批注 body/quote、提案 patch/critic、
    任务 payload/result 里埋 marker，真跑 MCP 工具后第二轮 provider 入参必须看不到。"""
    MARK = "MARKER_9f3b"
    c, projects, app = client
    _enable(c)
    pdir = projects / "method"
    from app.agent import proposals as proposals_mod
    from app.agent.types import BlockAnchor, FilePatch, Proposal
    from app.domain import comments as comments_mod

    cm = comments_mod.create(
        comments_mod.Anchor(book="claims", block_id="b1", line=3, quote=f"{MARK}_QUOTE"),
        f"{MARK}_COMMENT_BODY",
        comments_mod.LOCAL_AUTHOR,
    )
    comments_mod.save(str(pdir), comments_mod.load(str(pdir)) + [cm])
    proposals_mod.append(
        str(pdir),
        "method",
        Proposal(
            id="prop_a1b2c3d4e5f6",
            job_id="job_b1b2c3d4e5f6",
            scenario="s1",
            kind="patch",
            anchor=BlockAnchor(book="claims", block_id="b1", line_start=1, line_end=2),
            critic_markdown=f"{MARK}_CRITIC",
            patch=FilePatch(file="docs/x.md", content=f"{MARK}_PATCH"),
            model="m",
            created_at=1.0,
        ),
        by="agent:test",
    )
    job_dir = pdir / ".studio" / "ai-jobs"
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job_aaaaaa000001.json").write_text(
        json.dumps(
            {
                "id": "job_aaaaaa000001",
                "kind": "agent_run",
                "status": "interrupted",
                "payload": {"params": {"q": f"{MARK}_JOB_PAYLOAD"}},
                "result": {"text": f"{MARK}_JOB_RESULT"},
                "created_at": 1.0,
            }
        ),
        encoding="utf-8",
    )

    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(
                    _tc("get_proposals", {"pid": "method"}, "1"),
                    _tc("list_comments", {"pid": "method"}, "2"),
                    _tc("list_ai_jobs", {"pid": "method"}, "3"),
                ),
                _msg_text("done"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS, "scope": {"source": {"book": "claims"}, "materials": []}})
    assert ev[-1].get("done") is True
    last = app.state.ai.provider.calls[-1]
    tool_msgs = [m["content"] for m in last if m.get("role") == "tool"]
    assert len(tool_msgs) == 3
    blob = json.dumps(tool_msgs)
    assert MARK not in blob  # 无任何 marker 透传
    assert "prop_a1b2c3d4e5f6" in blob and "job_aaaaaa000001" in blob  # 合法格式 id 仍投影保留
    assert "pending" in blob and "interrupted" in blob  # 状态可见


def test_derived_tools_projected_even_with_full_source(client):
    """source.full 只授权当前正文，不等于历史材料/衍生记录授权——provenance 无法证明
    的记录（批注 body/任务 payload）即使整卷授权也恒投影，只回白名单 metadata。"""
    MARK = "MARKER_FULL9f"
    c, projects, app = client
    _enable(c)
    pdir = projects / "method"
    from app.domain import comments as comments_mod

    cm = comments_mod.create(
        comments_mod.Anchor(book="claims", block_id="b1", line=3),
        f"{MARK}_COMMENT_BODY",
        comments_mod.LOCAL_AUTHOR,
    )
    comments_mod.save(str(pdir), comments_mod.load(str(pdir)) + [cm])
    job_dir = pdir / ".studio" / "ai-jobs"
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job_bbbbbb000002.json").write_text(
        json.dumps(
            {
                "id": "job_bbbbbb000002",
                "kind": "x",
                "status": "done",
                "payload": {"params": {"q": f"{MARK}_JOB"}},
                "created_at": 1.0,
            }
        ),
        encoding="utf-8",
    )
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(
                    _tc("list_comments", {"pid": "method"}, "1"),
                    _tc("list_ai_jobs", {"pid": "method"}, "2"),
                ),
                _msg_text("done"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS, "scope": {"source": {"full": True}, "materials": []}})
    assert ev[-1].get("done") is True
    last = app.state.ai.provider.calls[-1]
    tool_msgs = [m["content"] for m in last if m.get("role") == "tool"]
    assert f"{MARK}_COMMENT_BODY" not in tool_msgs[0]  # full 授权也不透传衍生正文
    assert f"{MARK}_JOB" not in json.dumps(tool_msgs[1])  # job payload 恒不透传
    assert "job_bbbbbb000002" in tool_msgs[1]
    # 授权读面不受影响：read_book 原文仍可达（同轮对照）
    app.state.ai = AiClient(
        ScriptProvider([_msg_tool(_tc("read_book", {"pid": "method", "book": "claims"}, "9")), _msg_text("ok")])
    )
    ev = _post(c, {"messages": MSGS, "scope": {"source": {"full": True}, "materials": []}})
    assert ev[-1].get("done") is True
    last2 = app.state.ai.provider.calls[-1]
    assert any(m.get("role") == "tool" and "权利要求" in m["content"] for m in last2)


def test_derived_tools_projected_even_with_full_source_extra():
    """投影 fail-closed 单测：嵌套/非标量/非dict 一律不透传原文。"""
    out = chat_engine._project_derived(
        [
            {"id": "prop_0123456789ab", "body": "M-SECRET", "nested": {"x": "M-NESTED"}, "items": [1, 2]},
            "M-STRING-ITEM",
            {"id": "0123456789ab", "anchor": {"book": "claims", "file": "x.md", "quote": "M-Q", "block_id": "b"}},
        ]
    )
    assert out[0] == {"id": "prop_0123456789ab", "items_count": 2}
    assert out[1] is not None and out[1].get("anchor") == {"book": "claims"}
    blob = json.dumps(out)
    assert "M-SECRET" not in blob and "M-NESTED" not in blob and "M-Q" not in blob and "M-STRING" not in blob
    assert chat_engine._project_derived({"detail": "M-S"}) == {}
    assert chat_engine._project_derived("M-S") == {}


def test_meta_item_typed_whitelist_no_marker():
    """复核4例：嵌套 book / 自由文本 name / 任意数值键 / 任意时间字符串——marker 不得
    出现在投影结果的 keys 或 values。"""
    MARK = "REMOVED_MATERIAL_PROBE"
    cases = [
        {"anchor": {"book": {"private": MARK}, "line": 1}},
        {"name": MARK},
        {MARK: 1},
        {"created_at": MARK},
    ]
    for raw in cases:
        blob = json.dumps(chat_engine._project_derived(raw))
        assert MARK not in blob, raw
    # typed 校验边界：非法 id / 未知枚举 / 非时间串 / 动态列表键全丢弃
    out = chat_engine._meta_item(
        {
            "id": "prop_notvalid",  # 非 prop_+12hex
            "status": "totally_unknown_state",
            "created_at": "not a date",
            "weird_list": [1, 2, 3],  # 不在固定计数映射
            "items": [1, 2],
            "state": "pending",
            "due": "2026-10-21",
            "anchor": {"book": "claims", "line": 3, "file": "x.md", "block_id": "b1"},
        }
    )
    assert out == {
        "items_count": 2,
        "state": "pending",
        "due": "2026-10-21",
        "anchor": {"book": "claims", "line": 3},
    }


def test_scope_check_still_allows_derived_meta():
    """衍生工具仍在工具面（不整件拒）——scope 门照旧放行，透传在 _run_one 出口投影。"""
    for t in (
        "get_proposals",
        "list_comments",
        "list_ai_jobs",
        "get_timeline",
        "list_oa_rounds",
        "get_oa_round",
        "get_history",
    ):
        assert chat_engine._scope_check(t, {"pid": "m"}, {"source": None, "materials": set()}, "m") is None
    # 跨案机构审计默认拒
    assert (
        chat_engine._scope_check("list_org_audit", {}, {"source": {"full": True}, "materials": set()}, "m") is not None
    )


def test_agent_resume_signed_receipt(client):
    """P05 签名回执：篡改工具参数 / 伪造 receipt / 缩范围续跑全部 409，零上游。"""
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(_tc("patch_block", {"pid": "method", "block_id": "abstract/p1", "markdown": "改"})),
                _msg_text("done"),
            ]
        )
    )
    resume = _confirm_resume(c, {"messages": MSGS, "scope": {"source": True}})
    assert resume["receipt"]["pid"] == "method" and resume["receipt"]["sha"]
    assert resume["receipt"]["scope"]["source"] == {"full": True}

    # 篡改工具参数（payload hash 不符）
    bad = json.loads(json.dumps(resume))
    bad["calls"][0]["function"]["arguments"] = json.dumps({"pid": "method", "block_id": "X", "markdown": "evil"})
    r = c.post(
        "/api/projects/method/ai/chat",
        json={"messages": MSGS, "scope": {"source": True}, "resume": bad, "approved": True},
    )
    assert r.status_code == 409

    # 伪造 receipt 字段（签名不符）
    forged = json.loads(json.dumps(resume))
    forged["receipt"]["sha"] = "f" * 64
    r = c.post(
        "/api/projects/method/ai/chat",
        json={"messages": MSGS, "scope": {"source": True}, "resume": forged, "approved": True},
    )
    assert r.status_code == 409

    # 缩范围续跑（stored full ⊄ current 空授权）
    r = c.post(
        "/api/projects/method/ai/chat",
        json={"messages": MSGS, "scope": {"source": False}, "resume": resume, "approved": True},
    )
    assert r.status_code == 409

    # 正版回执 + 相同授权 → 放行执行（200 事件流）
    ev2 = _post(c, {"messages": MSGS, "scope": {"source": True}, "resume": resume, "approved": True})
    assert any("step" in e or "done" in e for e in ev2)


def test_egress_guard_revoked_mid_chain():
    """R2：运行中撤销外发授权——重试链上的下一次上游调用被 guard 拦截（零后续上游）。"""
    from app.ai.client import AiError

    class FlakyProvider:
        name = "mock"
        calls = 0

        async def complete(self, *a, **k):
            self.calls += 1
            raise AiError("upstream", "boom", 502, retryable=True)

        async def list_models(self):
            return []

    prov = FlakyProvider()
    ai = AiClient(prov)
    n = {"v": 0}

    async def guard():
        n["v"] += 1
        if n["v"] > 1:
            from fastapi import HTTPException as FHE

            raise FHE(403, {"kind": "org_egress_denied", "message": "机构外发已撤销"})

    from fastapi import HTTPException as FHE

    with pytest.raises(FHE):
        asyncio.run(ai.chat([{"role": "user", "content": "hi"}], "interactive", guard=guard))
    assert prov.calls == 1  # 仅第一次真实上行；重试前被撤销门拦下
    assert n["v"] == 2


def test_agent_steps_cap(client):
    c, _, app = client
    _enable(c)
    from app.agent import chat_engine

    n = chat_engine.MAX_STEPS + 2
    app.state.ai = AiClient(
        ScriptProvider([_msg_tool(_tc("get_deadlines", {"pid": "method"}, str(i))) for i in range(n)])
    )
    ev = _post(c, {"messages": MSGS})
    steps = [e["step"] for e in ev if "step" in e and e["step"]["status"] == "ok"]
    assert len(steps) == chat_engine.MAX_STEPS
    assert ev[-1]["done"] is True and "上限" in "".join(e["delta"] for e in ev if "delta" in e)


def test_agent_tools_advertise_schemas(client):
    """D-AGT-1 回归：MCP Tool schema 字段是 .parameters——必参工具不得零参宣发。"""
    from app.agent import chat_engine  # fixture 已完成模块重绑

    fns = {t["function"]["name"]: t["function"] for t in chat_engine._openai_tools()}
    p = fns["put_figure_source"]["parameters"]
    assert p["type"] == "object"
    assert {"pid", "name", "source"} <= set(p["required"])
    assert "source" in p["properties"]
    # 抽三件不同域工具同查：无必参工具的 properties 也须在（零参宣发=裸 {}）
    for name in ("get_ast", "patch_block", "run_scenario"):
        assert fns[name]["parameters"].get("properties"), name


def test_agent_double_confirm_two_stages(client):
    """批3-C 双确认层：update_org_member 一轮批准后先出 stage=2 卡，二次批准才执行。"""
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(
                    _tc("update_org_member", {"user_id": "00000000-0000-0000-0000-000000000001", "is_active": False})
                ),
                _msg_text("已处理。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS})
    c1 = [e["confirm"] for e in ev if "confirm" in e]
    assert len(c1) == 1 and c1[0]["tool"] == "update_org_member"
    assert c1[0]["danger"] is True and c1[0].get("stage") == 1

    ev2 = _post(c, {"messages": MSGS, "resume": c1[0]["resume"], "approved": True})
    c2 = [e["confirm"] for e in ev2 if "confirm" in e]
    assert len(c2) == 1 and c2[0]["stage"] == 2 and not any(e.get("done") for e in ev2)

    ev3 = _post(c, {"messages": MSGS, "resume": c2[0]["resume"], "approved": True})
    steps = [e["step"] for e in ev3 if "step" in e and e["step"]["status"] != "running"]
    # AUTH=off → 真执行了但撞 unavailable 闸（说明走的是执行分支而非第三张卡）
    assert steps and steps[0]["name"] == "update_org_member" and steps[0]["status"] == "error"
    assert "unavailable" in steps[0]["summary"]
    assert ev3[-1]["done"] is True


def test_agent_double_confirm_decline_at_stage2(client):
    """二次确认卡拒绝 → 不执行，模型收到 declined。"""
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(
        ScriptProvider(
            [
                _msg_tool(
                    _tc("update_org_member", {"user_id": "00000000-0000-0000-0000-000000000001", "is_superuser": True})
                ),
                _msg_text("好的，不动。"),
            ]
        )
    )
    ev = _post(c, {"messages": MSGS})
    conf = [e["confirm"] for e in ev if "confirm" in e][0]
    ev2 = _post(c, {"messages": MSGS, "resume": conf["resume"], "approved": True})
    conf2 = [e["confirm"] for e in ev2 if "confirm" in e][0]
    ev3 = _post(c, {"messages": MSGS, "resume": conf2["resume"], "approved": False})
    steps = [e["step"] for e in ev3 if "step" in e and e["step"]["status"] != "running"]
    assert steps[0]["name"] == "update_org_member" and steps[0]["status"] == "error"
    assert "拒绝" in steps[0]["summary"]


def test_agent_novelty_archive_guidance(client):
    """W19 批5：prior_art_search → record_novelty 归档配对须在系统提示与工具 docstring 双处可见。"""
    from app.agent import chat_engine

    assert "record_novelty" in chat_engine.AGENT_SUFFIX
    tools = {t.name: t for t in chat_engine.mcp_server._tool_manager.list_tools()}
    assert "record_novelty" in (tools["prior_art_search"].description or "")
    assert "record_novelty" in tools  # 配对端点在册


def test_scope_covers_lines_containment():
    """复核8：lines 是真实区间授权——换书/换选区/缩小行范围都不可续跑。"""
    from app.domain.chat_receipt import scope_covers

    req = {"source": {"book": "claims", "lines": [5, 9]}, "materials": []}
    # 全书授权覆盖其内行段；整卷覆盖一切
    assert scope_covers({"source": {"book": "claims"}, "materials": []}, req)
    assert scope_covers({"source": {"full": True}, "materials": []}, req)
    # 更大行区间覆盖子区间
    assert scope_covers({"source": {"book": "claims", "lines": [1, 20]}}, req)
    # 缩小区间 / 换书 / 换选区 → 拒
    assert not scope_covers({"source": {"book": "claims", "lines": [5, 8]}}, req)
    assert not scope_covers({"source": {"book": "abstract"}, "materials": []}, req)
    assert not scope_covers({"source": {"book": "claims", "lines": [6, 12]}}, req)  # 起点右移
    assert not scope_covers({"source": None, "materials": []}, req)
    # req book（无 lines）：cur 全书/full 覆盖；cur lines 收窄不覆盖
    req_book = {"source": {"book": "claims"}, "materials": []}
    assert scope_covers({"source": {"book": "claims"}, "materials": []}, req_book)
    assert not scope_covers({"source": {"book": "claims", "lines": [1, 5]}}, req_book)


def test_receipt_key_concurrent_create(tmp_path, monkeypatch):
    """复核8：并发首次签名——O_EXCL 撞 FileExistsError 时重读同一个 key，不随机 500。"""
    import os
    import secrets

    from app.domain import chat_receipt

    pdir = tmp_path / "method"
    (pdir / ".studio").mkdir(parents=True)
    keyfile = pdir / ".studio" / "chat_receipt_key"
    real_key = secrets.token_bytes(32)
    keyfile.write_bytes(real_key)

    class _Store:
        def get(self, pid):
            return type("P", (), {"dir": str(pdir)})()

    # 强制 create 必撞 FileExistsError（文件已存在）——重读路径应拿到同一个 key
    orig_open = os.open

    def fake_open(path, flags, mode=0o777, **kw):
        if str(path) == str(keyfile) and flags & os.O_EXCL:
            raise FileExistsError(path)
        return orig_open(path, flags, mode, **kw)

    monkeypatch.setattr(chat_receipt.os, "open", fake_open)
    got = chat_receipt._key(_Store(), "method")
    assert got[:32] == real_key  # 重读到同一个 key，不是另生成

    # 坏密钥（<32B）→ 明确 500，不拿弱 key 签名
    keyfile.write_bytes(b"short")
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        chat_receipt._key(_Store(), "method")
    assert ei.value.status_code == 500
