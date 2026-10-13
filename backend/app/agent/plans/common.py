# -*- coding: utf-8 -*-
"""各场景共用的小工具：派生结果、锚点、JSON 生成槽（1 次 format_retry）、comment 提案的两道门（anchor_hit +
no_legal_verdict）。"""
from __future__ import annotations

from app.agent import checks
from app.agent.plans import RunContext
from app.agent.types import BlockAnchor, CheckResult
from app.ai import prompts, prompts_agent
from app.mcp import tools_semantic as ts
from app.mcp.tools_semantic import Derived
from patent_docx import patch


def derive(ctx: RunContext) -> Derived:
    return ctx.tool("derive", ts.derive, store=ctx.store, pid=ctx.pid)


def final_text(d: Derived) -> str:
    return "\n".join(d.lines)


def book_text(d: Derived, book: str) -> str:
    b = d.ast["books"][book]
    return "\n".join(d.lines[b["offset"]: b["offset"] + b["length"]])


def block_text(d: Derived, book: str, block: dict) -> str:
    off = d.ast["books"][book]["offset"]
    return "\n".join(d.lines[off + block["lines"]["start"] - 1: off + block["lines"]["end"]])


def block_at(d: Derived, line: int) -> tuple[str, dict] | None:
    for book, b in patch.iter_blocks(d.ast):
        off = d.ast["books"][book]["offset"]
        if off + b["lines"]["start"] <= line <= off + b["lines"]["end"]:
            return book, b
    return None


def anchor_of(d: Derived, book: str, block: dict) -> BlockAnchor:
    off = d.ast["books"][book]["offset"]
    return BlockAnchor(book=book, block_id=block["id"], line_start=off + block["lines"]["start"],
                       line_end=off + block["lines"]["end"])


def claim_block(d: Derived, num: int) -> dict | None:
    return next((c for c in d.ast["claims"] if c["num"] == num), None)


def last_block(d: Derived, book: str) -> dict | None:
    blocks = [b for bk, b in patch.iter_blocks(d.ast) if bk == book]
    return blocks[-1] if blocks else None


async def gen_json(ctx: RunContext, step: str, messages: list[dict], *, purpose=None) -> tuple[dict | None, str]:
    """生成槽 → prompts.parse_json；不合约束则 format_retry 一次；仍失败返回 (None, 原文) 由调用方降级为 comment。"""
    schema = prompts_agent.schema_for(ctx.scenario, step)
    res = await ctx.gen(step, messages, purpose)
    try:
        return prompts.parse_json(res.text, schema), res.text
    except ValueError as e:
        ctx.check(CheckResult(name="format", ok=False, why=str(e)))
    res = await ctx.gen(step + ".retry", prompts.format_retry(messages, res.text, "不是合法 JSON 或缺字段"), purpose)
    try:
        return prompts.parse_json(res.text, schema), res.text
    except ValueError as e:
        ctx.check(CheckResult(name="format", ok=False, why=str(e)))
        return None, res.text


def comment(ctx: RunContext, d: Derived, line: int, quote: str, body: str, *, extra: tuple[CheckResult, ...] = ()):
    """comment 提案：quote 须落在 line 所在块内（anchor_hit），正文不得含结论式措辞（no_legal_verdict）；
    任一不过则丢弃并返回 None。"""
    hit = block_at(d, line)
    if hit is None:
        ctx.check(CheckResult(name="anchor_hit", ok=False, why=f"第 {line} 行不在任何块内"))
        return None
    book, block = hit
    anchor = anchor_of(d, book, block)
    results = [checks.anchor_hit(quote, d.lines, anchor.line_start, anchor.line_end), checks.no_legal_verdict(body),
               *extra]
    if not all([ctx.check(r) for r in results]):
        return None
    return ctx.propose("comment", anchor, comment_body=body, checks_=results)
