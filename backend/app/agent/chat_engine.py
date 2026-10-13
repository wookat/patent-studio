# -*- coding: utf-8 -*-
"""chat agent 工具循环（批2）：OpenAI tools API 经中转站；读工具直跑，写工具/计划出确认卡等 resume。

SSE 事件（在 chat 原有 delta/usage/done/error 之上扩）：
- {"step": {"id","name","status":"running"}}
- {"step": {"id","name","status":"ok"|"error","summary"}}
- {"confirm": {"id","tool","args","danger","plan_md"?,"resume"}} — 写面/计划卡；resume 是前端回执的不透明负载
- done 事件带 "pending": true 表示本次响应停在确认卡上

resume 负载：{"assistant": <assistant 消息>, "calls": [tool_call,...]（首个为被确认者）}
前端 POST /ai/chat 带 resume + approved 续跑；拒绝则该调用喂回「用户拒绝」由模型决定下一步。
"""
from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from mcp.server.mcpserver.exceptions import ToolError as McpToolError
from mcp.server.mcpserver.exceptions import UnexpectedToolError

from app.ai.client import AiClient, AiError
from app.mcp import audit as _audit
from app.mcp.auth import CURRENT_ACTOR, Actor
from app.mcp.schemas import TOOL_NAMES
from app.mcp.server import server as mcp_server

MAX_STEPS = 12            # 单请求内工具执行上限
RESULT_CAP = 16_000       # 单条工具结果字符上限（超出截断）
SUMMARY_CAP = 300         # 前端步骤条展示的摘要上限
PLAN_TOOL = "propose_plan"

# 写面工具：全部走确认卡（统一规则）；读面直跑。
WRITE_TOOLS = frozenset({
    "patch_block", "insert_block", "set_figure_order", "set_figure_width", "set_case_status",
    "add_comment",
    "create_project", "import_docx_path", "update_case", "put_settings",
    "deadline_done", "update_deadline",
    "create_oa_round", "update_oa_round", "extend_oa_round", "delete_oa_round",
    "add_note", "reply_comment", "resolve_comment", "delete_comment",
    "create_public_link", "revoke_public_link", "apply_proposal", "dismiss_proposal",
    "apply_template", "create_tag", "run_scenario",
    "put_figure_source", "delete_figure_source",
    "update_org_member", "put_org_settings", "set_org_name",
})
# 高危（卡片上加醒目警示）：删除/吊销/覆盖类。
DANGER_TOOLS = frozenset({
    "delete_oa_round", "delete_comment", "revoke_public_link", "apply_template",
    "dismiss_proposal", "deadline_done", "update_deadline", "update_org_member",
    "delete_figure_source",
})
# 双确认层（批3-C）：批准后不出结果而先再出一张确认卡（stage=2），二次批准后执行。
DOUBLE_CONFIRM_TOOLS = frozenset({"update_org_member"})
TOOL_SET = frozenset(TOOL_NAMES) | {PLAN_TOOL}

AGENT_SUFFIX = """

## 工具能力（本案卷工程师模式）
你可以调用工具完成案卷任务。规则：
- 读面工具（读三书/AST/体检/查新/批注/期限等）直接调用，结果即刻返回。
- 写面工具（改文档/台账/期限/OA/批注/分享链/提案/场景）会先请用户确认，确认后自动执行——
  你只负责提出调用，不要反复询问用户"要不要我执行"。
- 多步任务（建案→写稿→体检→交付类）先调用 propose_plan 给出执行计划让用户过目；
  单步任务直接动手，不要空出计划。
- 工具结果会被截断，别假设看到了全文；需要细节用更小范围的读工具。
- 画附图：用 put_figure_source 写 Mermaid 图源（flowchart/框图，黑白线稿自动渲染），
  先读案卷部件名与标号再生成，标号写进节点文本（如 ["处理器 101"]）；改图先 get_figure_source 再改。
- 查新：先读三书提发明点构造检索式，prior_art_search 搜完即用 record_novelty 把检索式与命中
  归档进查新记录卡；相关度拿不准填 A（X/Y 判定属人工复核），conclusion 位不要写。
- 最终回答面向用户：简洁中文，引用段落用 [00NN] 段号。不编造检索结论。"""


def _openai_tools() -> list[dict]:
    """MCP 注册表 → OpenAI tools 表；末尾追加 chat 专属伪工具 propose_plan。"""
    out = []
    for t in mcp_server._tool_manager.list_tools():
        # MCP Tool 的 JSON schema 字段名是 .parameters（input_schema/inputSchema 均不存在，
        # 读错即全部工具零参宣发、必参调用必败——D-AGT-1）。
        schema = getattr(t, "parameters", None) or getattr(t, "input_schema", None) \
            or getattr(t, "inputSchema", None) or {}
        params = schema if schema.get("type") == "object" else {
            "type": "object", "properties": schema.get("properties", {}),
            "required": schema.get("required", [])}
        out.append({"type": "function", "function": {
            "name": t.name,
            "description": (t.description or "")[:600],
            "parameters": params,
        }})
    out.append({"type": "function", "function": {
        "name": PLAN_TOOL,
        "description": "向用户提交一份多步执行计划（markdown），等待批准/修改/跳过。"
                       "仅多步任务使用；批准后按计划执行，不要逐条再问。",
        "parameters": {"type": "object",
                       "properties": {"plan_md": {"type": "string", "description": "markdown 执行计划"}},
                       "required": ["plan_md"]},
    }})
    return out


def _jsonable(o: Any) -> Any:
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    if isinstance(o, (list, tuple)):
        return [_jsonable(x) for x in o]
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    return o


def _args_of(tc: dict) -> dict:
    try:
        return json.loads((tc.get("function") or {}).get("arguments") or "{}")
    except ValueError:
        return {}


def _summary(res: Any) -> str:
    s = json.dumps(_jsonable(res), ensure_ascii=False)
    return s[:SUMMARY_CAP] + ("…" if len(s) > SUMMARY_CAP else "")


async def exec_tool(name: str, args: dict, user) -> Any:
    """in-process 调 MCP 工具：注入 web 用户 Actor（ACL/审计按真实身份），结果 jsonable 化。"""
    uid = getattr(user, "id", None)
    actor = Actor(id=f"web-{uid}" if uid else "web", name=getattr(user, "display_name", None)
                  or getattr(user, "email", "web"), user_id=str(uid) if uid else None,
                  superuser=bool(getattr(user, "is_superuser", False)
                                 or getattr(user, "superuser", False)))
    tok = CURRENT_ACTOR.set(actor)
    try:
        return await mcp_server._tool_manager.call_tool(name, args, None)
    finally:
        CURRENT_ACTOR.reset(tok)


def _tool_err(e: Exception) -> dict:
    """ToolError 尾部 JSON → {error:{kind,message}}；其余原样。"""
    if isinstance(e, (McpToolError, UnexpectedToolError)):
        s = str(e)
        i = s.find("{")
        if i >= 0:
            try:
                return {"error": json.loads(s[i:])}
            except ValueError:
                pass
        return {"error": {"kind": "tool", "message": s[:400]}}
    return {"error": {"kind": "internal", "message": f"{type(e).__name__}: {e}"[:400]}}


async def _run_one(name: str, args: dict, user) -> tuple[Any, list[dict]]:
    """执行一件工具，返回 (结果, [事件])——含 error 键即失败。"""
    cid = uuid.uuid4().hex[:8]
    ev = [{"step": {"id": cid, "name": name, "status": "running"}}]
    if name not in TOOL_SET:
        res: Any = {"error": {"kind": "unknown_tool", "message": f"未知工具：{name}"}}
    else:
        try:
            res = await exec_tool(name, args, user)
        except Exception as e:  # 工具未兜住的异常不炸流，喂回模型
            res = _tool_err(e)
    ok = not (isinstance(res, dict) and res.get("error"))
    ev.append({"step": {"id": cid, "name": name, "status": "ok" if ok else "error",
                        "summary": _summary(res)}})
    return res, ev


def _confirm(tc: dict, msgs: list[dict], calls: list[dict], stage: int = 1) -> dict:
    """确认卡事件：resume 负载含 assistant 消息 + 剩余 calls 队列（当前 call 在首）。
    stage=2 时卡上贴 _confirmed 标记：第二次 resume 批准后放行执行。"""
    name = (tc.get("function") or {}).get("name", "")
    args = _args_of(tc)
    i = next((i for i, c in enumerate(calls) if c.get("id") == tc.get("id")), 0)
    assistant = next((m for m in reversed(msgs)
                      if m.get("role") == "assistant" and m.get("tool_calls")), None)
    tc2 = dict(tc, **{"_confirmed": True}) if stage == 2 else tc
    return {"confirm": {"id": uuid.uuid4().hex[:10], "tool": name, "args": args,
                        "danger": name in DANGER_TOOLS, "stage": stage,
                        "plan_md": args.get("plan_md") if name == PLAN_TOOL else None,
                        "resume": {"assistant": assistant, "calls": [tc2, *calls[i + 1:]]}}}


def _who(user) -> str:
    return getattr(user, "email", None) or getattr(user, "display_name", None) or "web"


async def run(ai: AiClient, p, user, msgs: list[dict],
              resume: dict | None, approved: bool) -> AsyncIterator[dict]:
    """任务记录包装（批3-B）：全程跑完在 audit.jsonl 追加一条 chat_run——
    与逐件工具调用同账，chat 一次任务 = 一行汇总（finish: ok/confirm:<tool>/error:<kind>/closed）。"""
    used: list[str] = []
    finish = "closed"   # 客户端中途断流（aclose/GeneratorExit）落 closed
    steps = 0
    goal = next((str(m.get("content") or "") for m in reversed(msgs)
                 if m.get("role") == "user"), "")[:80]
    try:
        async for ev in _run(ai, p, user, msgs, resume, approved):
            step = ev.get("step")
            if step and step.get("status") != "running":
                used.append(step.get("name", ""))
            if "confirm" in ev:
                finish = f"confirm:{ev['confirm'].get('tool', '?')}"
            if "error" in ev:
                finish = f"error:{ev['error'].get('kind', '?')}"
            if ev.get("done"):
                finish = "ok"
                steps = int(ev.get("steps") or 0)
            yield ev
    except GeneratorExit:
        raise
    except Exception:
        finish = "error:internal"
        raise
    finally:
        if p is not None:
            _audit.record(p.dir, _who(user), "chat_run",
                          {"goal": goal, "tools": used, "steps": steps,
                           "resumed": bool(resume)}, finish)


async def _run(ai: AiClient, p, user, msgs: list[dict],
               resume: dict | None, approved: bool) -> AsyncIterator[dict]:
    """agent 对话主循环（异步产出 SSE 事件 dict）。

    msgs 已含 system 提示词。resume 流程：{"assistant": msg, "calls":[tc,...]}——
    首个 call 即被批准/拒绝者；剩余 calls 按序消化（写面仍可能再停），然后继续 LLM 轮。"""
    msgs = list(msgs)
    pending: list[dict] = []

    if resume:
        assistant = resume.get("assistant")
        calls = list(resume.get("calls") or [])
        if not assistant or not calls:
            yield {"error": {"kind": "bad_request", "message": "resume 缺少 assistant/calls"}}
            return
        msgs.append(assistant)
        tc = calls.pop(0)
        name = (tc.get("function") or {}).get("name", "")
        if approved and name in DOUBLE_CONFIRM_TOOLS and not tc.get("_confirmed"):
            yield _confirm(tc, msgs, [tc, *calls], stage=2)
            return
        if approved:
            res, ev = await _run_one(name, _args_of(tc), user)
        else:
            res = {"error": {"kind": "declined",
                             "message": "用户拒绝了该操作。如属计划批准则直接开始执行。"}}
            ev = [{"step": {"id": uuid.uuid4().hex[:8], "name": name,
                            "status": "error", "summary": "用户拒绝"}}]
        for e in ev:
            yield e
        msgs.append({"role": "tool", "tool_call_id": tc.get("id"), "name": name,
                     "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP]})
        pending = calls

    tools = _openai_tools()
    steps = 0
    while True:
        while pending:
            tc = pending.pop(0)
            name = (tc.get("function") or {}).get("name", "")
            if name in WRITE_TOOLS or name == PLAN_TOOL:
                yield _confirm(tc, msgs, [tc, *pending])
                return
            res, ev = await _run_one(name, _args_of(tc), user)
            for e in ev:
                yield e
            msgs.append({"role": "tool", "tool_call_id": tc.get("id"), "name": name,
                         "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP]})
            steps += 1
            if steps >= MAX_STEPS:
                yield {"delta": f"\n\n（已达单次任务工具步数上限 {MAX_STEPS}，如需继续请说「继续」）"}
                yield {"done": True, "steps": steps}
                return

        try:
            r = await ai.chat_tools(msgs, "interactive", tools,
                                    project_dir=p.dir if p else None, user=_who(user))
        except AiError as e:
            yield {"error": {"kind": f"ai_{e.kind}", "message": str(e)}}
            return
        msg = dict(r.message or {})
        calls = list(msg.get("tool_calls") or [])
        if not calls:
            text = msg.get("content") or ""
            if text:
                yield {"delta": text}
            yield {"done": True, "model": r.model,
                   "usage": r.usage.__dict__ if r.usage else None,
                   "fallback": r.fallback, "ms": r.ms, "steps": steps}
            return
        msgs.append(msg)
        for tc in calls:
            name = (tc.get("function") or {}).get("name", "")
            if name in WRITE_TOOLS or name == PLAN_TOOL:
                yield _confirm(tc, msgs, calls)
                return
            res, ev = await _run_one(name, _args_of(tc), user)
            for e in ev:
                yield e
            msgs.append({"role": "tool", "tool_call_id": tc.get("id"), "name": name,
                         "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP]})
            steps += 1
            if steps >= MAX_STEPS:
                yield {"delta": f"\n\n（已达单次任务工具步数上限 {MAX_STEPS}，如需继续请说「继续」）"}
                yield {"done": True, "steps": steps}
                return
