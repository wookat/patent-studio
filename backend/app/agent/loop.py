# -*- coding: utf-8 -*-
"""智能体循环（docs/plan/21 §6.1–6.2、19 §4.1–4.3）：固定序列 tool → gen → check → proposal。

`run_scenario(pid, scenario, params, job, ...)` 由 routes_agent 交给 JobStore.run 执行：
- 计划来自 `agent/registry`（场景单元注册 `async handler(ctx)`）；未注册的场景走 `default_handler`
  （读书 / 语义工具 → 一次生成 → 确定性检查 → 提案），mock 评估与本单元测试都用它。
- 每步经 RunContext 记录 StepEvent（job.add_step），每步前检查取消；heavy 场景由路由排 `{pid}:heavy` FIFO。
- 模型路由：plan / critique → swe-2-max（heavy），draft / interactive → swe-2-medium；兜底 swe-2-high 在 AiClient；
  claude-sonnet-4.6 不在 MODELS 表内，无法被路由到。
- 上下文一律经 `ctx.clip()`（budget.clip 唯一裁剪点），truncated 写进 done 事件。
- 工具调用写 audit.jsonl（who=agent:<job_id>）；正文不落盘，只记字符数。
- 产出只有 Proposal：critic / patch 等用户确认；comment 在 done 时立即写入批注（§6.3）。
  job 运行期间不写 content.md / docs/*.md。
- 失败：AiError / 其他异常 → done{error} 事件后向上抛，JobStore 记 status=error。
"""
import asyncio
import inspect
import json
import logging
import time
from collections.abc import Awaitable, Callable

from app.agent import budget, checks, plans, proposals, registry
from app.agent.types import (
    SCENARIO_BY_ID,
    Anchor,
    BlockAnchor,
    BlocksPatch,
    CheckResult,
    FileAnchor,
    FilePatch,
    Patch,
    PatchBlock,
    Proposal,
    ProposalKind,
    ScenarioInfo,
    StepEvent,
    Usage,
    step_event,
)
from app.ai import prompts
from app.ai.client import AiClient, ChatResult, Purpose
from app.ai.jobs import Job, JobStore
from app.domain import events
from app.mcp import audit, tools_semantic
from patent_docx import critic

log = logging.getLogger(__name__)
plans.install()  # agent-scenarios：s1–s10 的 run 挂到 registry；未注册（测试 reset 后）的场景走 default_handler

Role = str  # "plan" | "critique" | "draft" | "interactive"
HEAVY_ROLES = frozenset({"plan", "critique"})

# A4：批注禁止结论式法律措辞（§6.4 no_legal_verdict；词表唯一源在 checks.LEGAL_VERDICT_WORDS）
FORBIDDEN_MODELS = frozenset({"claude-sonnet-4.6"})


def has_legal_verdict(text: str) -> bool:
    return any(w in (text or "") for w in checks.LEGAL_VERDICT_WORDS)


class RunContext:
    """场景 handler 的唯一入口：ctx.plan / tool / clip / gen / check / propose。"""

    def __init__(self, *, store, jobs: JobStore, ai: AiClient, pid: str, scenario: str, params: dict, job: Job,
                 who: str | None = None, actor: dict | None = None):
        self.store = store
        self.jobs = jobs
        self.ai = ai
        self.pid = pid
        self.scenario = scenario
        self.info: ScenarioInfo = SCENARIO_BY_ID[scenario]
        self.params = dict(params or {})
        self.job = job
        self.who = who
        self.actor = actor
        self.project = store.get(pid)
        self.project_dir = self.project.dir
        self.proposals: list[Proposal] = []
        self.usage = Usage()
        self.truncated = False
        self.sent_chars = 0
        self.calls = 0
        self.last_model: str = ""
        self.checks: list[CheckResult] = []

    # ---- 基础 ----

    @property
    def agent_id(self) -> str:
        return f"agent:{self.job.id}"

    def _event(self, kind: str, data: dict) -> None:
        self.jobs.add_step(self.job.id, kind, data)

    def check_cancel(self) -> None:
        j = self.jobs.get(self.job.id)
        if j is None or j.status == "interrupted":
            raise asyncio.CancelledError()

    def purpose_for(self, role: Role) -> Purpose:
        return "heavy" if role in HEAVY_ROLES else "interactive"

    def default_role(self) -> Role:
        return "critique" if self.info.weight == "heavy" else "draft"

    # ---- 步骤 ----

    def plan(self, steps: list[str]) -> None:
        self.check_cancel()
        self._event("plan", {"steps": list(steps)})

    async def tool(self, name: str, fn: Callable[..., object], **args):
        """直接函数调用（B4：不走 MCP 往返）；tool_call / tool_result 事件 + audit.jsonl。"""
        self.check_cancel()
        self._event("tool_call", {"name": name, "args": _scalar_args(args)})
        t0 = time.monotonic()
        try:
            result = fn(**args)
            if inspect.isawaitable(result):
                result = await result
        except Exception as e:
            audit.record(self.project_dir, self.agent_id, name, _scalar_args(args), f"error:{e.__class__.__name__}")
            raise
        ms = int((time.monotonic() - t0) * 1000)
        chars = len(_as_text(result))
        self._event("tool_result", {"name": name, "chars": chars, "ms": ms})
        audit.record(self.project_dir, self.agent_id, name, _scalar_args(args), "ok")
        return result

    def clip(self, context: str) -> str:
        text, truncated = budget.clip(context, self.scenario)
        self.truncated = self.truncated or truncated
        return text

    async def gen(self, messages: list[dict], role: Role | None = None, *, stream: bool = True) -> ChatResult:
        """一次模型调用；stream 时逐 delta 发 gen_delta（不落盘）。用量累加到 ctx.usage。"""
        self.check_cancel()
        purpose = self.purpose_for(role or self.default_role())
        self.sent_chars += sum(len(m.get("content") or "") for m in messages)
        self.calls += 1
        if stream:
            cs = await self.ai.chat(messages, purpose, stream=True, project_dir=self.project_dir, job_id=self.job.id,
                                    user=self.who)
            try:
                async for delta in cs:
                    self._event("gen_delta", {"text": delta})
                r: ChatResult = cs.result
            finally:
                await cs.aclose()
        else:
            r = await self.ai.chat(messages, purpose, project_dir=self.project_dir, job_id=self.job.id, user=self.who)
        if r.model in FORBIDDEN_MODELS:
            raise RuntimeError(f"禁用模型：{r.model}")
        self.usage = Usage(prompt=self.usage.prompt + r.usage.prompt_tokens,
                           completion=self.usage.completion + r.usage.completion_tokens)
        self.last_model = r.model
        return r

    def check(self, name: str, ok: bool, why: str = "") -> CheckResult:
        self.check_cancel()
        cr = CheckResult(name=name, ok=bool(ok), why=why)
        self.checks.append(cr)
        self._event("check", {"name": name, "ok": cr.ok, "why": why})
        return cr

    def propose(self, kind: ProposalKind, anchor: Anchor, *, critic_markdown: str | None = None,
                comment_body: str | None = None, patch: Patch | None = None,
                checks: list[CheckResult] | None = None, model: str | None = None) -> Proposal:
        self.check_cancel()
        prop = Proposal(id=proposals.new_id(), job_id=self.job.id, scenario=self.scenario, kind=kind, anchor=anchor,
                        critic_markdown=critic_markdown, comment_body=comment_body, patch=patch,
                        checks=list(checks or []), model=model or self.last_model or "", usage=self.usage,
                        created_at=time.time())
        self.proposals.append(prop)
        self._event("proposal", {"id": prop.id, "kind": kind, "anchor": anchor.model_dump(),
                                 "preview": proposals.preview(prop)})
        return prop


def _scalar_args(args: dict) -> dict:
    out = {}
    for k, v in args.items():
        scalar = isinstance(v, (str, int, float, bool)) or v is None
        out[k] = v if scalar else f"<{type(v).__name__}:{len(_as_text(v))}>"
    return out


def _as_text(v) -> str:
    if isinstance(v, str):
        return v
    if hasattr(v, "model_dump_json"):
        return v.model_dump_json()
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(v)


class PlanContext(plans.RunContext):
    """agent-scenarios 的 plans.RunContext 接到 JobStore 运行时：事件写 job.steps（tool 键对齐前端的 name）、
    取消看 job.status、提案 id 全局唯一；plans.finish() 的 done 帧由 run_scenario 在提案落盘后统一发出。"""

    def __init__(self, *, store, jobs: JobStore, ai: AiClient, pid: str, scenario: str, params: dict, job: Job,
                 who: str | None = None, actor: dict | None = None):
        self.jobs = jobs
        self.job = job
        self.who = who
        self.actor = actor
        self.info: ScenarioInfo = SCENARIO_BY_ID[scenario]
        self.checks: list[CheckResult] = []
        self.finish_data: dict = {}
        self.sent_chars = 0
        super().__init__(store=store, pid=pid, ai=ai, scenario=scenario, job_id=job.id, params=params, user=who,
                         cancelled=self._job_interrupted)

    @property
    def agent_id(self) -> str:
        return f"agent:{self.job.id}"

    @property
    def last_model(self) -> str:
        return self.model

    def _job_interrupted(self) -> bool:
        j = self.jobs.get(self.job.id)
        return j is None or j.status == "interrupted"

    def _guard(self) -> None:
        if self.cancelled():
            raise asyncio.CancelledError()

    def emit(self, kind: str, data: dict | None = None) -> StepEvent:
        data = dict(data or {})
        if kind == "done":
            self.finish_data = data
            return step_event(len(self.events), kind, data)
        if kind in ("tool_call", "tool_result") and "tool" in data:
            data["name"] = data.pop("tool")
        ev = super().emit(kind, data)
        self.jobs.add_step(self.job.id, kind, data)
        return ev

    def check(self, result: CheckResult) -> bool:
        self.checks.append(result)
        return super().check(result)

    def new_proposal_id(self) -> str:
        return proposals.new_id()

    async def gen(self, step: str, messages: list[dict], purpose: Purpose | None = None) -> ChatResult:
        self.sent_chars += sum(len(m.get("content") or "") for m in messages)
        r = await super().gen(step, messages, purpose)
        if r.model in FORBIDDEN_MODELS:
            raise RuntimeError(f"禁用模型：{r.model}")
        return r


# ---------------------------------------------------------------- 主循环 ----

async def run_scenario(pid: str, scenario: str, params: dict, job: Job, *, store, jobs: JobStore, ai: AiClient,
                       who: str | None = None, actor: dict | None = None) -> dict:
    handler = registry.get(scenario) or default_handler
    ctx: RunContext | PlanContext
    if plans.is_plan_handler(handler):
        ctx = PlanContext(store=store, jobs=jobs, ai=ai, pid=pid, scenario=scenario, params=params, job=job, who=who,
                          actor=actor)
    else:
        ctx = RunContext(store=store, jobs=jobs, ai=ai, pid=pid, scenario=scenario, params=params, job=job, who=who,
                         actor=actor)
    try:
        await handler(ctx)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        jobs.add_step(job.id, "done", {"proposals": [p.id for p in ctx.proposals], "usage": ctx.usage.model_dump(),
                                       "truncated": ctx.truncated, "error": f"{e.__class__.__name__}: {e}"})
        raise
    by = ctx.agent_id
    for prop in ctx.proposals:
        proposals.append(ctx.project_dir, pid, prop, by=by)
    for prop in ctx.proposals:
        if prop.kind == "comment":
            await proposals.apply(store, pid, prop.id, who=by, actor=actor)
    ids = [p.id for p in ctx.proposals]
    events.emit("ai.sent", pid=pid, actor=actor,
                data={"job_id": job.id, "scenario": scenario, "calls": ctx.calls, "chars": ctx.sent_chars,
                      "model": ctx.last_model, "usage": ctx.usage.model_dump(), "truncated": ctx.truncated})
    extra = ctx.finish_data if isinstance(ctx, PlanContext) else {}
    result = {"scenario": scenario, "proposals": ids, "usage": ctx.usage.model_dump(), "truncated": ctx.truncated,
              "checks": [c.model_dump() for c in ctx.checks], **extra}
    jobs.add_step(job.id, "done", {**extra, "proposals": ids, "usage": ctx.usage.model_dump(),
                                   "truncated": ctx.truncated, "calls": ctx.calls})
    return result


# ---------------------------------------------------------------- 缺省计划 ----

Handler = Callable[[RunContext], Awaitable[None]]

BOOK_NAMES = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}
FILE_TARGETS = {"s9": "docs/{book}.en.md", "s10": "docs/brief.md"}


def _block_ranges(ast: dict) -> dict[str, tuple[str, int, int]]:
    out: dict[str, tuple[str, int, int]] = {}
    for book, blocks in (("abstract", ast["abstract"]["paragraphs"]), ("claims", ast["claims"]),
                         ("description", ast["description"])):
        off = ast["books"][book]["offset"]
        for b in blocks:
            out[b["id"]] = (book, off + b["lines"]["start"], off + b["lines"]["end"])
    return out


def _first_paragraph(ast: dict, book: str) -> dict | None:
    if book == "abstract":
        blocks = ast["abstract"]["paragraphs"]
    elif book == "claims":
        blocks = ast["claims"]
    else:
        blocks = [b for b in ast["description"] if b["kind"] == "paragraph"]
    return blocks[0] if blocks else None


async def default_handler(ctx: RunContext) -> None:
    """通用固定序列：语义派生（tool）→ 一次生成（gen）→ 确定性检查（check）→ 按场景 produces[0] 出提案。
    场景单元注册正式 handler 后本函数不再被该场景使用。"""
    kind: ProposalKind = ctx.info.produces[0]
    ctx.plan(["derive", "gen", "check", "proposal"])
    d = await ctx.tool("derive", lambda pid: tools_semantic.derive(ctx.store, pid), pid=ctx.pid)
    ranges = _block_ranges(d.ast)
    lines = d.lines
    if kind == "comment":
        await _comment_plan(ctx, d, ranges, lines)
    elif kind == "critic":
        await _critic_plan(ctx, d, ranges, lines)
    else:
        await _patch_plan(ctx, d, ranges, lines)


async def _comment_plan(ctx: RunContext, d, ranges, lines) -> None:
    tree = await ctx.tool("get_claim_tree", tools_semantic.claim_tree, d=d)
    batch = [{"block_id": c["id"], "text": "\n".join(lines[ranges[c["id"]][1] - 1:ranges[c["id"]][2]])}
             for c in d.ast["claims"]]
    context = ctx.clip(json.dumps([n.model_dump() for n in tree], ensure_ascii=False))
    msgs = prompts.review_messages(batch, "claims", context)
    role = "critique" if ctx.info.weight == "heavy" else "draft"
    r = await ctx.gen(msgs, role)
    try:
        data = prompts.parse_json(r.text, prompts.SCHEMAS["review"])
    except ValueError as e:
        r = await ctx.gen(prompts.format_retry(msgs, r.text, str(e)), role)
        data = prompts.parse_json(r.text, prompts.SCHEMAS["review"])
    items = data.get("items") if isinstance(data.get("items"), list) else []
    for it in items:
        bid = it.get("block_id") if isinstance(it, dict) else None
        if bid not in ranges:
            ctx.check("anchor_hit", False, f"块不存在：{bid!r}")
            continue
        book, a, b = ranges[bid]
        quote = str(it.get("quote") or "")
        hit = next((no for no in range(a, b + 1) if quote and quote in lines[no - 1]), None)
        anchor_ok = ctx.check("anchor_hit", hit is not None, "" if hit else f"quote 不在 {bid} 行内")
        if not anchor_ok.ok:
            continue
        body = str(it.get("message") or "").strip()
        if it.get("suggestion"):
            body += f"\n建议：{str(it['suggestion']).strip()}"
        bad = has_legal_verdict(body)
        verdict = ctx.check("no_legal_verdict", not bad, "含结论式法律措辞" if bad else "")
        if not verdict.ok:
            continue
        ctx.propose("comment", BlockAnchor(book=book, block_id=bid, line_start=hit, line_end=hit), comment_body=body,
                    checks=[anchor_ok, verdict], model=r.model)


async def _critic_plan(ctx: RunContext, d, ranges, lines) -> None:
    book = "claims" if ctx.scenario == "s4" else ("abstract" if ctx.scenario == "s6" else "description")
    block = _first_paragraph(d.ast, book)
    if block is None:
        ctx.check("anchor_hit", False, f"{BOOK_NAMES[book]}没有可修订的块")
        return
    _book, a, b = ranges[block["id"]]
    orig = lines[a - 1:b]
    text = await ctx.tool("read_book", lambda book: "\n".join(lines[d.ast["books"][book]["offset"]:
                                                                    d.ast["books"][book]["offset"]
                                                                    + d.ast["books"][book]["length"]]), book=book)
    context = ctx.clip(f"当前书：{BOOK_NAMES[book]}\n{text}")
    msgs = prompts.rewrite_messages("polish", "\n".join(orig), context)
    r = await ctx.gen(msgs, "draft")
    marked = proposals.as_critic(orig, r.text)
    if marked is None:
        r = await ctx.gen(prompts.format_retry(msgs, r.text, "行数与原文不一致"), "draft")
        marked = proposals.as_critic(orig, r.text)
    if marked is None:
        # 降级为批注（§6.2 失败：check 不通过 → 1 次 format_retry → 仍不通过降级 comment）
        ck = ctx.check("lint", False, "AI 输出行数与原文不一致")
        ctx.propose("comment", BlockAnchor(book=book, block_id=block["id"], line_start=a, line_end=b),
                    comment_body=critic.accept(r.text).strip()[:500], checks=[ck], model=r.model)
        return
    lint_ok = ctx.check("lint", not critic.lint_marks(marked), "")
    rt_ok = ctx.check("roundtrip", critic.reject(marked) == "\n".join(orig), "")
    if lint_ok.ok and rt_ok.ok:
        ctx.propose("critic", BlockAnchor(book=book, block_id=block["id"], line_start=a, line_end=b),
                    critic_markdown=marked, checks=[lint_ok, rt_ok], model=r.model)


async def _patch_plan(ctx: RunContext, d, ranges, lines) -> None:
    claims_text = await ctx.tool("read_book", lambda book: "\n".join(
        lines[d.ast["books"][book]["offset"]:d.ast["books"][book]["offset"] + d.ast["books"][book]["length"]]),
        book="claims")
    context = ctx.clip(f"权利要求书：\n{claims_text}")
    if ctx.info.weight == "heavy":
        outline = "给出补写说明书新段落的要点大纲（JSON 数组，每项一句）。"
        plan = await ctx.gen(prompts.build("chat", outline, context), "plan")
        context = ctx.clip(context + "\n大纲：" + plan.text.strip())
    ask = ctx.params.get("instruction") or "按上下文生成一段面向说明书的文字。"
    r = await ctx.gen(prompts.build("chat", ask, context), "draft")
    text = prompts.strip_fence(r.text).strip()
    fmt = ctx.check("parse", bool(text) and not has_legal_verdict(text), "" if text else "空输出")
    if not fmt.ok:
        return
    target = FILE_TARGETS.get(ctx.scenario)
    if target:
        file = target.format(book=ctx.params.get("book") or "claims")
        ctx.propose("patch", FileAnchor(file=file), patch=FilePatch(file=file, content=text + "\n"), checks=[fmt],
                    model=r.model)
        return
    paras = [b for b in d.ast["description"] if b["kind"] == "paragraph"]
    if not paras:
        ctx.check("anchor_hit", False, "说明书没有段落可供追加")
        return
    last = paras[-1]
    _book, a, b = ranges[last["id"]]
    ctx.propose("patch", BlockAnchor(book="description", block_id=last["id"], line_start=b, line_end=b),
                patch=BlocksPatch(blocks=[PatchBlock(after_block_id=last["id"], markdown=text)]), checks=[fmt],
                model=r.model)


__all__ = ["RunContext", "default_handler", "has_legal_verdict", "run_scenario"]
