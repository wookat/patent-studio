# -*- coding: utf-8 -*-
"""S7 OA 争辩稿（21 §6.1；R-OA-03；A9 不做权项重排）。

params: {items: [OaItem…]}（内联）或 {item_ids: [...]}（从 .studio/oa/items.json 取，缺省取全部）。
每条意见 1 次 heavy gen → points（comment，锚在被指出的首个权项）+ claim_edits（可选 critic，
经 oa.answer.normalize_edits
保证编号不变、reject 还原原文、装得进权利要求书）。不落 answers.json——S7 只产提案。
"""

from __future__ import annotations

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent
from app.mcp import tools_semantic as ts
from app.oa import answer as oa_answer
from patent_studio.kernel import text_forms

PLAN = Plan(
    scenario="s7",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("load_items", "读取审查意见拆条"),
        ToolStep("context_pack", "打包被指出权项的上下文"),
        GenStep("argue", "生成争辩要点与权项修改建议（每条意见 1 次）", "heavy"),
        CheckStep("verify", "校验措辞 / 编号不变 / 回环", ("no_legal_verdict", "lint", "roundtrip")),
    ),
    model_route="heavy",
    budget_key="s7",
    output_kind=("comment", "critic"),
)

MAX_ITEMS = 6


def load_items(project_dir: str, params: dict) -> list[dict]:
    items = params.get("items")
    if not items:
        items = oa_answer.load_items(project_dir)
        ids = set(params.get("item_ids") or [])
        if ids:
            items = [it for it in items if it.get("id") in ids]
    return list(items)[:MAX_ITEMS]


def _context(ctx: RunContext, d, item: dict, claims: dict[int, dict]) -> str:
    focus = [n for n in item.get("claims") or [] if n in claims] or sorted(claims)[:1]
    parts = []
    for n in focus[:3]:
        pack = ctx.tool("context_pack", ts.context_pack, d=d, claim_id=str(n), max_chars=5000)
        parts.append(f"权利要求 {n}：{claims[n]['text']}")
        if pack.support:
            parts.append("说明书支持段落：\n" + "\n".join(f"{s['para_no']} {s['text']}" for s in pack.support[:6]))
    if focus:
        argue = text_forms.oa_argue_block(claims[focus[0]]["text"])
        if argue:
            parts.append(argue)
    return ctx.clip("\n\n".join(parts))


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    items = ctx.tool("load_items", load_items, project_dir=ctx.project_dir, params=ctx.params)
    ctx.max_calls = max(ctx.max_calls, 2 * len(items))  # 每条意见 1 次 gen + 至多 1 次 format_retry
    if not items:
        ctx.finish(items=0)
        return
    content = ctx.store.read_content(ctx.pid)
    claims = oa_answer.claim_blocks(content)
    for item in items:
        focus = [n for n in item.get("claims") or [] if n in claims] or sorted(claims)[:1]
        messages = prompts_agent.build(
            "s7",
            "argue",
            oa_answer._user(item),
            context=_context(ctx, d, item, claims),
            pid=ctx.pid,
            item=item.get("id", "?"),
        )
        data, raw = await common.gen_json(ctx, "argue", messages)
        anchor_num = focus[0]
        if data is None:
            body = f"审查意见 {item.get('id', '')} 的争辩草稿（未能结构化，请核对）：{raw.strip()[:800]}"
        else:
            points = [str(p) for p in data.get("points") or []]
            body = f"针对审查意见 {item.get('id', '')} 的争辩要点（请核对）：\n" + "\n".join(
                f"{i}. {p}" for i, p in enumerate(points, 1)
            )
        common.comment(ctx, d, claims[anchor_num]["line"], f"{anchor_num}.", body)
        if data is None:
            continue
        edits, warnings = oa_answer.normalize_edits(content, data.get("claim_edits"), claims)
        for w in warnings:
            ctx.check(checks.CheckResult(name="claim_edit", ok=False, why=w))
        for e in edits:
            block = common.claim_block(d, e["claim"])
            anchor = common.anchor_of(d, "claims", block)
            results = [
                checks.lint(e["critic_line"]),
                checks.roundtrip(e["original"], e["critic_line"]),
                checks.no_legal_verdict(e["critic_line"]),
            ]
            if all([ctx.check(r) for r in results]):
                ctx.propose("critic", anchor, critic_markdown=e["critic_line"], checks_=results)
    ctx.finish(items=len(items))
