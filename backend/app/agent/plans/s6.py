# -*- coding: utf-8 -*-
"""S6 摘要生成（21 §6.1）。

读权利要求书 + 说明书（发明内容优先）→ medium gen 一段 ≤300 字 → check(len, noun_subset)，不过则重试一次。
摘要非空：critic {~~旧摘要~>新摘要~~} 锚在摘要首段；摘要为空：patch（BlocksPatch，after_block_id="abstract" 表示
插到摘要标题之后，见 checks.apply_blocks）。
"""

from __future__ import annotations

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.agent.types import BlockAnchor, BlocksPatch, CheckResult, PatchBlock
from app.ai import prompts_agent

PLAN = Plan(
    scenario="s6",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("read_books", "读取权利要求书与说明书要点"),
        GenStep("abstract", "生成摘要（≤300 字）", "interactive"),
        CheckStep("verify", "校验字数与名词子集", ("len", "noun_subset")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("critic", "patch"),
)


def _limit(ctx: RunContext) -> int:
    settings = ctx.store.get(ctx.pid).settings or {}
    return int(settings.get("abstract_limit") or 300)


def read_books(d) -> str:
    claims = "\n".join(common.block_text(d, "claims", b) for b in d.ast["claims"])
    paras = [b for b in d.ast["description"] if b["kind"] == "paragraph"]
    summary = "\n".join(b["text"] for b in paras[:12])
    return f"权利要求书：\n{claims}\n\n说明书要点：\n{summary}"


def length_check(text: str, limit: int) -> CheckResult:
    n = len(text)
    return CheckResult(name="len", ok=n <= limit, why="" if n <= limit else f"摘要 {n} 字，超过 {limit} 字")


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    limit = _limit(ctx)
    context = ctx.clip(ctx.tool("read_books", read_books, d=d))
    messages = prompts_agent.build(
        "s6", "abstract", f"请生成一段不超过 {limit} 字的摘要。", context=context, pid=ctx.pid
    )
    source = common.final_text(d)
    text, results = "", []
    for attempt in range(2):
        res = await ctx.gen("abstract" if attempt == 0 else "abstract.retry", messages)
        text = res.text.strip().replace("\n", "")
        results = [length_check(text, limit), checks.noun_subset(text, source)]
        if all([ctx.check(r) for r in results]):
            break
        messages = [
            *messages,
            {"role": "assistant", "content": res.text},
            {
                "role": "user",
                "content": f"上一次输出不合要求（{'；'.join(r.why for r in results if not r.ok)}），"
                f"请重写：不超过 {limit} 字，只用三书已有名词。",
            },
        ]
    else:
        paras = d.ast["abstract"]["paragraphs"]
        if paras:
            common.comment(
                ctx,
                d,
                common.anchor_of(d, "abstract", paras[0]).line_start,
                paras[0]["text"][:12],
                f"建议改写摘要，智能体草稿请核对后自行取用：{text[:400]}",
            )
        ctx.finish()
        return
    paras = d.ast["abstract"]["paragraphs"]
    if paras:
        anchor = common.anchor_of(d, "abstract", paras[0])
        old = "\n".join(d.lines[anchor.line_start - 1 : anchor.line_end])
        crit = "{~~" + old + "~>" + text + "~~}"
        more = [checks.lint(crit), checks.roundtrip(old, crit)]
        if all([ctx.check(r) for r in more]):
            ctx.propose("critic", anchor, critic_markdown=crit, checks_=[*results, *more])
    else:
        off = d.ast["books"]["abstract"]["offset"]
        anchor = BlockAnchor(book="abstract", block_id="abstract", line_start=off, line_end=off)
        blocks = [PatchBlock(after_block_id="abstract", markdown=text)]
        applied = checks.apply_blocks(ctx.store.read_content(ctx.pid), blocks)
        more = [checks.parse(applied)]
        if all([ctx.check(r) for r in more]):
            ctx.propose("patch", anchor, patch=BlocksPatch(blocks=blocks), checks_=[*results, *more])
    ctx.finish()
