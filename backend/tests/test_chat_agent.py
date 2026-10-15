# -*- coding: utf-8 -*-
"""批2 chat agent 工具循环：读工具直跑 / 写工具+计划确认卡 / resume 续跑 / 拒绝分支 / 步数闸。"""

import asyncio
import importlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

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
    ev = _post(c, {"messages": MSGS})
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
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(ScriptProvider([]))
    ev = _post(c, {"messages": MSGS, "resume": {"assistant": None, "calls": []}, "approved": True})
    assert ev[0]["error"]["kind"] == "bad_request"


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
