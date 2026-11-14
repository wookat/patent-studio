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
import re
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

MAX_STEPS = 12  # 单请求内工具执行上限
RESULT_CAP = 16_000  # 单条工具结果字符上限（超出截断）
SUMMARY_CAP = 300  # 前端步骤条展示的摘要上限
PLAN_TOOL = "propose_plan"

# 写面工具：全部走确认卡（统一规则）；读面直跑。
WRITE_TOOLS = frozenset(
    {
        "patch_block",
        "insert_block",
        "set_figure_order",
        "set_figure_width",
        "set_case_status",
        "add_comment",
        "create_project",
        "import_docx_path",
        "update_case",
        "put_settings",
        "deadline_done",
        "update_deadline",
        "create_oa_round",
        "update_oa_round",
        "extend_oa_round",
        "delete_oa_round",
        "add_note",
        "reply_comment",
        "resolve_comment",
        "delete_comment",
        "create_public_link",
        "revoke_public_link",
        "apply_proposal",
        "dismiss_proposal",
        "apply_template",
        "create_tag",
        "run_scenario",
        "put_figure_source",
        "delete_figure_source",
        "update_org_member",
        "put_org_settings",
        "set_org_name",
    }
)
# 高危（卡片上加醒目警示）：删除/吊销/覆盖类。
DANGER_TOOLS = frozenset(
    {
        "delete_oa_round",
        "delete_comment",
        "revoke_public_link",
        "apply_template",
        "dismiss_proposal",
        "deadline_done",
        "update_deadline",
        "update_org_member",
        "delete_figure_source",
    }
)
# 双确认层（批3-C）：批准后不出结果而先再出一张确认卡（stage=2），二次批准后执行。
DOUBLE_CONFIRM_TOOLS = frozenset({"update_org_member"})
TOOL_SET = frozenset(TOOL_NAMES) | {PLAN_TOOL}

# P05 上下文边界（服务端可执行，不是提示词）：scope={"source": dict|None, "materials": set[str]}
# - pid ≠ 会话案卷：任何带 pid 参数的工具拒（跨案读取/写入禁止）。
# - source={"full":true} ⇒ 整卷工具放行；{"book":X} ⇒ 仅该书的 book 级读工具；
#   {"lines":[a,b]} ⇒ 无任何正文读工具（read_book 回全书会越权）；None ⇒ 全部拒。
# - materials：read_attachment_text 只放行集内文件名；list_attachments 结果按集过滤；
#   未声明 = 空集 = 一件都不可读。
# - 默认拒绝：不在允许表（书级/整卷/材料/元数据/写面/计划）的工具一律拒——
#   避免黑名单遗漏 get_proposals/模板/OA 衍生内容等泄露面。
SOURCE_BOOK_TOOLS = frozenset({"read_book", "get_docs", "book_resource"})
SOURCE_FULL_TOOLS = frozenset(
    {
        "lint",
        "preflight",
        "export_xml",
        "build",
        "get_ast",
        "get_claim_tree",
        "get_support_map",
        "get_terms",
        "context_pack",
        "oa_parse",
    }
)
MATERIAL_READ_TOOLS = frozenset({"read_attachment_text", "list_attachments"})
META_TOOLS = frozenset(
    {
        "get_case",
        "case_summary",
        "get_settings",
        "get_deadlines",
        "get_timeline",
        "get_history",
        "list_oa_rounds",
        "get_oa_round",
        "list_comments",
        "list_public_links",
        "list_ai_jobs",
        "get_proposals",
        "get_deliver_errors",
        "list_tags",
        "list_templates",
        "list_figures",
        "get_figures",
        "list_figure_sources",
        "get_figure_source",
        "get_template",
        "list_org_members",
        "get_org_settings",
        "get_novelty",
        "record_novelty",
        "prior_art_search",
    }
)
# 出口投影：凡非"已授权内容读"的工具结果一律按严格白名单投影——衍生记录（批注/提案/
# 任务/时间线/OA/期限/台账/机构面）与写操作回声都可能内嵌未授权正文或已撤销材料内容；
# 来源无法证明即不假设授权，与 source.full 无关。_PROJECT_EXEMPT：模型自产（确认卡）/外部
# 检索命中，非案卷衍生，投影反而失去意义。
_PROJECT_EXEMPT = frozenset({"propose_plan", "prior_art_search"})

# 严格 typed 白名单：固定键名 + 值格式校验，不匹配即丢弃（不出现在 keys 或 values）。
# id 只认实际生成格式（prop_/job_/m-/st-/au-/cf-/filed-/ev- 前缀或裸 hex/uuid），
# 不为测试/seed 放宽；枚举键只认已知字面量；时间只认 ISO 日期或 epoch 数。
_ID_RES = tuple(
    re.compile(p)
    for p in (
        r"^prop_[0-9a-f]{12}$",
        r"^job_[0-9a-f]{12}$",
        r"^[0-9a-f]{12}$",
        r"^m-[0-9a-f]{8}$",
        r"^\d{1,9}$",
        r"^st-[0-9a-f]{10}$",
        r"^(?:au|cf)-\d{1,6}-\d{1,15}$",
        r"^filed-\d{1,6}$",
        r"^ev\d{1,4}$",
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        r"^[0-9a-f]{40}$",
        r"^[0-9a-f]{64}$",
    )
)
_META_ID_KEYS = frozenset({"id", "rid", "sha", "content_sha", "proposal_id", "job_id", "round_id", "parent_id"})
_META_ENUM_KEYS = frozenset(
    {"kind", "state", "status", "type", "severity", "level", "scope", "baseline", "source", "role"}
)
_META_TIME_KEYS = frozenset(
    {
        "created_at",
        "updated_at",
        "filed_on",
        "at",
        "ts",
        "date",
        "due",
        "expires_at",
        "done_at",
        "base_date",
        "confirmed_at",
    }
)
_META_INT_KEYS = frozenset({"count", "total", "days_left", "line", "round", "n", "seq", "version", "progress"})
_META_BOOL_KEYS = frozenset(
    {
        "done",
        "revoked",
        "resolved",
        "active",
        "enabled",
        "ok",
        "applied",
        "bound",
        "ai_enabled",
        "org_ai_enabled",
        "training_consent",
        "ai_egress",
        "holidays_verified",
        "holidays_missing",
        "expired",
    }
)
_META_COUNT_MAP = {
    "items": "items_count",
    "hits": "hits_count",
    "proposals": "proposals_count",
    "comments": "comments_count",
    "jobs": "jobs_count",
    "links": "links_count",
    "templates": "templates_count",
    "figures": "figures_count",
    "deadlines": "deadlines_count",
    "rounds": "rounds_count",
    "evidence": "evidence_count",
    "members": "members_count",
    "errors": "errors_count",
    "steps": "steps_count",
    "results": "results_count",
    "extensions": "extensions_count",
    "files": "files_count",
    "sources": "sources_count",
    "records": "records_count",
    "events": "events_count",
}
_META_ENUM_VALUES = frozenset(
    {
        # 提案/任务/批注/期限状态机
        "pending",
        "applied",
        "dismissed",
        "queued",
        "running",
        "done",
        "error",
        "interrupted",
        "cancelled",
        "open",
        "resolved",
        "upcoming",
        "due_soon",
        "overdue",
        # 案卷状态 / 列表态
        "intake",
        "drafting",
        "review",
        "client_review",
        "final",
        "filed",
        "oa",
        "granted",
        "rejected",
        "closed",
        "active",
        "archived",
        "trashed",
        # 期限 / 费用
        "oa_reply",
        "exam_request",
        "priority",
        "annual_fee",
        "review_due",
        "divisional",
        "reexam",
        "publication",
        "custom",
        "auto",
        "manual",
        "unpaid",
        "paid",
        "reduced",
        "red",
        "yellow",
        "normal",
        # timeline 事件
        "case.created",
        "case.status",
        "note",
        "share.created",
        "share.confirmed",
        "deliver.filed",
        "oa.round",
        "deadline.done",
        "deadline.undone",
        "deadline.override",
        "review.assigned",
        "export.downloaded",
        "ai.proposal",
        # 提案/任务/分享/通知 类型与角色
        "critic",
        "patch",
        "comment",
        "confirm",
        "read",
        "generate",
        "resume",
        "chat",
        "agent",
        "mention",
        "assign",
        "deadline",
        "ai",
        "nudge",
        "system",
        "original",
        "owner",
        "admin",
        "member",
        "viewer",
        # 严重度 / 通用
        "info",
        "warning",
        "critical",
        "low",
        "medium",
        "high",
        "success",
        "ok",
        "failed",
    }
)
_BOOK_IDS = frozenset({"abstract", "claims", "description"})
_ISO_TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ][0-9:.]{0,12}([+-]\d{2}:?\d{2}|Z)?)?$")


def _meta_id_ok(v: str) -> bool:
    return any(r.match(v) for r in _ID_RES)


def _meta_time_ok(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return 0 <= v <= 4_102_444_800  # epoch ≤ 2100-01-01
    return isinstance(v, str) and len(v) <= 40 and bool(_ISO_TIME_RE.match(v))


def _meta_item(item):
    """单条记录 → 固定键名 typed 白名单投影：id 按生成格式正则、枚举按已知字面量、
    时间按 ISO/epoch、计数仅固定映射键、布尔仅固定键；嵌套 dict 一律不返（anchor 仅
    保留合法 BookID + 正整数 line）。非 dict 项不透传。"""
    if not isinstance(item, dict):
        return None
    out: dict = {}
    for k, v in item.items():
        if k in _META_ID_KEYS and isinstance(v, str) and _meta_id_ok(v):
            out[k] = v
        elif k in _META_ENUM_KEYS and isinstance(v, str) and v in _META_ENUM_VALUES:
            out[k] = v
        elif k in _META_TIME_KEYS and _meta_time_ok(v):
            out[k] = v
        elif k in _META_BOOL_KEYS and isinstance(v, bool):
            out[k] = v
        elif k in _META_INT_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = v
        elif k in _META_COUNT_MAP and isinstance(v, list):
            out[_META_COUNT_MAP[k]] = len(v)
    anchor = item.get("anchor")
    if isinstance(anchor, dict):
        an: dict = {}
        b = anchor.get("book")
        if isinstance(b, str) and b in _BOOK_IDS:
            an["book"] = b
        ln = anchor.get("line")
        if isinstance(ln, int) and not isinstance(ln, bool) and ln > 0:
            an["line"] = ln
        if an:
            out["anchor"] = an
    return out


def _project_derived(res):
    """未知返回形态 fail-closed：list 只投影 dict 项、dict 白名单、其它一律不回原文。"""
    if isinstance(res, list):
        return [i for i in (_meta_item(x) for x in res) if i is not None]
    if isinstance(res, dict):
        return _meta_item(res) or {}
    if isinstance(res, (int, float, bool)) or res is None:
        return res
    return {}


SCOPE_BANNED_TOOLS = frozenset({"list_projects"})


def _scope_error(message: str) -> dict:
    return {"error": {"kind": "scope", "message": message}}


def _scope_check(name: str, args: dict, scope: dict | None, scope_pid: str | None) -> dict | None:
    """返回错误结果即拒；None 放行。scope 恒由服务端 _chat_scope 补全（无 scope ⇒ 最小授权）。
    pid 钉扎始终生效（scope_pid 与 scope 无关，chat 必带）。"""
    pid_arg = args.get("pid")
    if scope_pid is not None and isinstance(pid_arg, str) and pid_arg != scope_pid:
        return _scope_error("工具范围仅限当前案卷，不得访问其它案卷")
    scope = scope or {}
    if name in SCOPE_BANNED_TOOLS:
        return _scope_error("本轮上下文未授权枚举其它案卷")
    if name in MATERIAL_READ_TOOLS:
        mats = scope.get("materials") or set()
        if name == "list_attachments":
            return None  # 结果过滤在 _run_one 完成后做（空集 ⇒ 空表）
        if args.get("name") in mats:
            return None
        return _scope_error(f"材料「{args.get('name')}」不在本轮授权范围——请用户在上下文中加入该材料")
    src = scope.get("source") or {}
    if name in SOURCE_BOOK_TOOLS:
        book_arg = args.get("book")
        if src.get("full"):
            return None
        if src.get("book") and book_arg == src["book"] and not src.get("lines"):
            return None
        return _scope_error("本轮上下文未授权该正文范围——请用户在上下文中加入对应正文后再试")
    if name in SOURCE_FULL_TOOLS:
        if src.get("full"):
            return None
        return _scope_error("本轮上下文不含整卷正文授权——请用户加入所需正文后再试")
    if name in WRITE_TOOLS or name in DANGER_TOOLS or name == PLAN_TOOL or name in META_TOOLS:
        return None
    return _scope_error(f"工具 {name} 不在本轮上下文授权的数据面——请用户调整上下文后重试")


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
        schema = (
            getattr(t, "parameters", None) or getattr(t, "input_schema", None) or getattr(t, "inputSchema", None) or {}
        )
        params = (
            schema
            if schema.get("type") == "object"
            else {"type": "object", "properties": schema.get("properties", {}), "required": schema.get("required", [])}
        )
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": (t.description or "")[:600],
                    "parameters": params,
                },
            }
        )
    out.append(
        {
            "type": "function",
            "function": {
                "name": PLAN_TOOL,
                "description": "向用户提交一份多步执行计划（markdown），等待批准/修改/跳过。"
                "仅多步任务使用；批准后按计划执行，不要逐条再问。",
                "parameters": {
                    "type": "object",
                    "properties": {"plan_md": {"type": "string", "description": "markdown 执行计划"}},
                    "required": ["plan_md"],
                },
            },
        }
    )
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
    actor = Actor(
        id=f"web-{uid}" if uid else "web",
        name=getattr(user, "display_name", None) or getattr(user, "email", "web"),
        user_id=str(uid) if uid else None,
        superuser=bool(getattr(user, "is_superuser", False) or getattr(user, "superuser", False)),
    )
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


async def _run_one(
    name: str, args: dict, user, scope: dict | None = None, scope_pid: str | None = None
) -> tuple[Any, list[dict]]:
    """执行一件工具，返回 (结果, [事件])——含 error 键即失败。"""
    cid = uuid.uuid4().hex[:8]
    ev = [{"step": {"id": cid, "name": name, "status": "running"}}]
    denied = _scope_check(name, args, scope, scope_pid)
    if denied is not None:
        res = denied
    elif name not in TOOL_SET:
        res = {"error": {"kind": "unknown_tool", "message": f"未知工具：{name}"}}
    else:
        try:
            res = await exec_tool(name, args, user)
        except Exception as e:  # 工具未兜住的异常不炸流，喂回模型
            res = _tool_err(e)
    # 出口投影：只有"已授权内容读"（正文/材料白名单内）才透传原文；
    # 其余一切（衍生记录、台账/机构面、写操作回声、source.full 也不例外）一律白名单投影。
    # 能走到这里说明 scope 门已放行——投影对象是"读结果内容"，不是"是否允许执行"。
    src = (scope or {}).get("source") or {}
    content_granted = (
        name in SOURCE_BOOK_TOOLS
        or name in MATERIAL_READ_TOOLS
        or (name in SOURCE_FULL_TOOLS and bool(src.get("full")))
    )
    if not (isinstance(res, dict) and res.get("error")) and not content_granted and name not in _PROJECT_EXEMPT:
        res = _project_derived(res)
    # list_attachments 放行但按声明集过滤（不暴露未授权材料名）
    if (
        isinstance(res, dict)
        and not res.get("error")
        and scope is not None
        and scope.get("materials") is not None
        and name == "list_attachments"
    ):
        mats = scope["materials"]
        for key in ("items", "attachments"):
            if isinstance(res.get(key), list):
                res = {**res, key: [a for a in res[key] if a.get("name") in mats]}
    ok = not (isinstance(res, dict) and res.get("error"))
    ev.append({"step": {"id": cid, "name": name, "status": "ok" if ok else "error", "summary": _summary(res)}})
    return res, ev


def _resume_payload(assistant, tc2, calls, i, signer) -> dict:
    """续跑负载：assistant + 剩余 calls + 服务端签名回执（无 signer 时退化为本地无签名模式）。"""
    payload = {"assistant": assistant, "calls": [tc2, *calls[i + 1 :]]}
    if signer is not None:
        payload["receipt"] = signer(payload)
    return payload


def _confirm(tc: dict, msgs: list[dict], calls: list[dict], stage: int = 1, signer=None) -> dict:
    """确认卡事件：resume 负载含 assistant 消息 + 剩余 calls 队列（当前 call 在首）。
    stage=2 时卡上贴 _confirmed 标记：第二次 resume 批准后放行执行。
    receipt 由服务端签名盖章（pid+actor+content_sha+scope+负载hash），续跑全量复核（P05）。"""
    name = (tc.get("function") or {}).get("name", "")
    args = _args_of(tc)
    i = next((i for i, c in enumerate(calls) if c.get("id") == tc.get("id")), 0)
    assistant = next((m for m in reversed(msgs) if m.get("role") == "assistant" and m.get("tool_calls")), None)
    tc2 = dict(tc, **{"_confirmed": True}) if stage == 2 else tc
    return {
        "confirm": {
            "id": uuid.uuid4().hex[:10],
            "tool": name,
            "args": args,
            "danger": name in DANGER_TOOLS,
            "stage": stage,
            "plan_md": args.get("plan_md") if name == PLAN_TOOL else None,
            "resume": _resume_payload(assistant, tc2, calls, i, signer),
        }
    }


def _who(user) -> str:
    return getattr(user, "email", None) or getattr(user, "display_name", None) or "web"


async def run(
    ai: AiClient,
    p,
    user,
    msgs: list[dict],
    resume: dict | None,
    approved: bool,
    scope: dict | None = None,
    guard=None,
    signer=None,
) -> AsyncIterator[dict]:
    """任务记录包装（批3-B）：全程跑完在 audit.jsonl 追加一条 chat_run——
    与逐件工具调用同账，chat 一次任务 = 一行汇总（finish: ok/confirm:<tool>/error:<kind>/closed）。"""
    used: list[str] = []
    finish = "closed"  # 客户端中途断流（aclose/GeneratorExit）落 closed
    steps = 0
    goal = next((str(m.get("content") or "") for m in reversed(msgs) if m.get("role") == "user"), "")[:80]
    try:
        async for ev in _run(ai, p, user, msgs, resume, approved, scope, guard=guard, signer=signer):
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
            _audit.record(
                p.dir,
                _who(user),
                "chat_run",
                {"goal": goal, "tools": used, "steps": steps, "resumed": bool(resume)},
                finish,
            )


async def _run(
    ai: AiClient,
    p,
    user,
    msgs: list[dict],
    resume: dict | None,
    approved: bool,
    scope: dict | None = None,
    guard=None,
    signer=None,
) -> AsyncIterator[dict]:
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
            yield _confirm(tc, msgs, [tc, *calls], stage=2, signer=signer)
            return
        if approved:
            res, ev = await _run_one(name, _args_of(tc), user, scope, p.id if p else None)
        else:
            res = {"error": {"kind": "declined", "message": "用户拒绝了该操作。如属计划批准则直接开始执行。"}}
            ev = [{"step": {"id": uuid.uuid4().hex[:8], "name": name, "status": "error", "summary": "用户拒绝"}}]
        for e in ev:
            yield e
        msgs.append(
            {
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "name": name,
                "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP],
            }
        )
        pending = calls

    tools = _openai_tools()
    steps = 0
    while True:
        while pending:
            tc = pending.pop(0)
            name = (tc.get("function") or {}).get("name", "")
            if name in WRITE_TOOLS or name == PLAN_TOOL:
                yield _confirm(tc, msgs, [tc, *pending], signer=signer)
                return
            res, ev = await _run_one(name, _args_of(tc), user, scope, p.id if p else None)
            for e in ev:
                yield e
            msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id"),
                    "name": name,
                    "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP],
                }
            )
            steps += 1
            if steps >= MAX_STEPS:
                yield {"delta": f"\n\n（已达单次任务工具步数上限 {MAX_STEPS}，如需继续请说「继续」）"}
                yield {"done": True, "steps": steps}
                return

        try:
            r = await ai.chat_tools(
                msgs, "interactive", tools, project_dir=p.dir if p else None, user=_who(user), guard=guard
            )
        except AiError as e:
            yield {"error": {"kind": f"ai_{e.kind}", "message": str(e)}}
            return
        msg = dict(r.message or {})
        calls = list(msg.get("tool_calls") or [])
        if not calls:
            text = msg.get("content") or ""
            if text:
                yield {"delta": text}
            yield {
                "done": True,
                "model": r.model,
                "usage": r.usage.__dict__ if r.usage else None,
                "fallback": r.fallback,
                "ms": r.ms,
                "steps": steps,
            }
            return
        msgs.append(msg)
        for tc in calls:
            name = (tc.get("function") or {}).get("name", "")
            if name in WRITE_TOOLS or name == PLAN_TOOL:
                yield _confirm(tc, msgs, calls, signer=signer)
                return
            res, ev = await _run_one(name, _args_of(tc), user, scope, p.id if p else None)
            for e in ev:
                yield e
            msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id"),
                    "name": name,
                    "content": json.dumps(_jsonable(res), ensure_ascii=False)[:RESULT_CAP],
                }
            )
            steps += 1
            if steps >= MAX_STEPS:
                yield {"delta": f"\n\n（已达单次任务工具步数上限 {MAX_STEPS}，如需继续请说「继续」）"}
                yield {"done": True, "steps": steps}
                return
