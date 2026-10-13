# -*- coding: utf-8 -*-
"""S9 双语翻译（21 §6.1）。params: {books: ["abstract","claims","description"]}（缺省三书）。

每书 1 次 medium gen → 结构回环检查（权项编号集合与引用关系、章节数、公式块数一致；术语全篇一致）→
patch 新文件 docs/<book>.en.md。不改 content.md。
"""
from __future__ import annotations

import re

from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.agent.types import CheckResult, FileAnchor, FilePatch
from app.ai import prompts_agent
from patent_studio.kernel.docset import BOOKS

PLAN = Plan(
    scenario="s9",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("read_book", "读取一书 Markdown"),
        GenStep("translate", "逐书翻译（每书 1 次）", "interactive"),
        CheckStep("verify", "结构回环：编号 / 引用 / 章节 / 公式", ("structure",)),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("patch",),
)

_CLAIM_NUM_RE = re.compile(r"^(\d+)\.", re.M)
_CN_REF_RE = re.compile(r"权利要求\s*(\d+)")
_EN_REF_RE = re.compile(r"[Cc]laims?\s+(\d+)")
_HEADING_RE = re.compile(r"^#{2,3} ", re.M)


def structure(book: str, src: str, dst: str) -> CheckResult:
    """译文须保留：权项编号集合、被引用的权项号集合、章节标题数、$$ 公式块数。"""
    why = []
    if book == "claims":
        if _CLAIM_NUM_RE.findall(src) != _CLAIM_NUM_RE.findall(dst):
            why.append("权项编号与原文不一致")
        if set(_CN_REF_RE.findall(src)) != set(_EN_REF_RE.findall(dst)):
            why.append("权项引用关系与原文不一致")
    if len(_HEADING_RE.findall(src)) != len(_HEADING_RE.findall(dst)):
        why.append("章节标题数与原文不一致")
    if src.count("$$") != dst.count("$$"):
        why.append("公式块数与原文不一致")
    return CheckResult(name="structure", ok=not why, why="；".join(why))


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    books = [b for b in (ctx.params.get("books") or BOOKS) if b in BOOKS]
    ctx.max_calls = max(ctx.max_calls, 2 * len(books))
    glossary = "\n".join(f"{t['name']}" + (f"（{', '.join(t['aliases'])}）" if t.get("aliases") else "")
                         for t in d.glossary[:40])
    done = 0
    for book in books:
        src = ctx.tool("read_book", common.book_text, d=d, book=book)
        messages = prompts_agent.build("s9", "translate",
                                       f"请把下面这书（{book}）译为英文，只输出译文 Markdown。\n\n" + src,
                                       context=ctx.clip("术语表（全篇统一译法）：\n" + glossary if glossary else ""),
                                       pid=ctx.pid, book=book)
        text = ""
        for attempt in range(2):
            res = await ctx.gen("translate" if attempt == 0 else "translate.retry", messages)
            text = res.text.strip("\n") + "\n"
            result = structure(book, src, text)
            if ctx.check(result):
                break
            messages = [*messages, {"role": "assistant", "content": res.text},
                        {"role": "user",
                         "content": f"译文结构与原文不一致（{result.why}），"
                                    "请保持编号、引用、章节与公式一一对应重译。"}]
        else:
            off = d.ast["books"][book]["offset"]
            span = range(off + 1, off + d.ast["books"][book]["length"] + 1)
            first = next((i for i in span if d.lines[i - 1].strip()), off + 1)
            common.comment(ctx, d, first, d.lines[first - 1].strip()[:20],
                           f"疑似 {book} 英译结构与原文不一致（{result.why}），两次生成均未通过回环检查，"
                           "建议缩小到单章节后重试或人工翻译，请核对。")
            continue
        file = f"docs/{book}.en.md"
        ctx.propose("patch", FileAnchor(file=file), patch=FilePatch(file=file, content=text), checks_=[result])
        done += 1
    ctx.finish(books=done)
