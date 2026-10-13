# -*- coding: utf-8 -*-
"""S3 支持性补全（21 §6.1）。params: {claim: int, term: str}（通常来自 S2 批注的「补写」动作）。

context_pack → gen（一段说明书文字）→ check(noun_subset, support) → critic：把 {++新段++} 接在最相关的
支持段落末尾（无支持段则接在具体实施方式最后一段末尾）。同一行内插入，critic.reject 逐字节回到原文。
"""
from __future__ import annotations

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent
from app.mcp import tools_semantic as ts

PLAN = Plan(
    scenario="s3",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("context_pack", "打包目标权项上下文"),
        GenStep("complete", "补写说明书支持段", "interactive"),
        CheckStep("verify", "校验名词子集 / 支持性 / 回环", ("noun_subset", "support", "lint", "roundtrip")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("critic",),
)


def _target_line(d, pack) -> int:
    if pack.support:
        return pack.support[-1]["line"]
    last = common.last_block(d, "description")
    return d.ast["books"]["description"]["offset"] + last["lines"]["start"]


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    claim = int(ctx.params.get("claim") or 1)
    term = str(ctx.params.get("term") or "").strip()
    pack = ctx.tool("context_pack", ts.context_pack, d=d, claim_id=str(claim), max_chars=8000)
    user = f"权利要求 {claim} 中的特征「{term}」在说明书中缺少对应记载，请补写一段说明书文字。" if term \
        else f"请为权利要求 {claim} 补写一段说明书支持文字。"
    context = ctx.clip(f"权利要求 {claim}：{pack.claim.text}\n\n说明书已有相关段落：\n" +
                       "\n".join(f"{s['para_no']} {s['text']}" for s in pack.support))
    messages = prompts_agent.build("s3", "complete", user, context=context, pid=ctx.pid, claim=claim)
    source = common.final_text(d)
    text = ""
    for attempt in range(2):
        res = await ctx.gen("complete" if attempt == 0 else "complete.retry", messages)
        text = res.text.strip().replace("\n", "")
        results = [checks.noun_subset(text, source + "\n" + term)]
        if term:
            results.append(checks.support([term], text))
        if all([ctx.check(r) for r in results]):
            break
        messages = [*messages, {"role": "assistant", "content": res.text},
                    {"role": "user",
                     "content": "上一次输出使用了三书中不存在的名词或没有写到目标特征，请只用案卷已有名词重写。"}]
    else:
        # 两次都不过：降级为批注，把草稿交给撰写人
        common.comment(ctx, d, _target_line(d, pack), pack.support[-1]["text"][:12] if pack.support else "",
                       f"建议为「{term or f'权利要求 {claim}'}」补写说明书支持，"
                       f"智能体草稿请核对后自行取用：{text[:400]}")
        ctx.finish()
        return
    line = _target_line(d, pack)
    book, block = common.block_at(d, line)
    anchor = common.anchor_of(d, book, block)
    old = "\n".join(d.lines[anchor.line_start - 1: anchor.line_end])
    new = old + "{++" + text + "++}"
    results = [checks.lint(new), checks.roundtrip(old, new), checks.noun_subset(text, source + "\n" + term)]
    if all([ctx.check(r) for r in results]):
        ctx.propose("critic", anchor, critic_markdown=new, checks_=results)
    ctx.finish()
