# -*- coding: utf-8 -*-
"""S5 附图标记对齐（21 §6.1）。

figures(d) + report.numerals 确定性差分：同号多名 / 有图例无正文 / 有正文无图例 / 图未被正文引用 /
正文引用了不存在的图。
medium gen 只为每条差异写一句说明（不增删条目、不改 num/line）；模型不可用或条目对不上时用确定性文案。输出 comment。
"""

from __future__ import annotations

import json
import re

from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent
from app.mcp import tools_semantic as ts

PLAN = Plan(
    scenario="s5",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("figures", "汇总附图、图例与正文标记"),
        ToolStep("diff", "确定性差分附图标记"),
        GenStep("explain", "为差异写说明", "interactive"),
        CheckStep("verify", "校验锚点与措辞", ("anchor_hit", "no_legal_verdict")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("comment",),
)

_FIG_REF_RE = re.compile(r"图\s*(\d+)")


def diff(d, figs) -> list[dict]:
    """[{kind, num, line, quote, message}]，line 为全文行。"""
    out: list[dict] = []
    for n in d.report["numerals"]:
        lines = list(n["lines"])
        if not n["consistent"] and len(n["names"]) > 1:
            first = lines[0] if lines else n.get("legend_line")
            out.append(
                {
                    "kind": "inconsistent",
                    "num": n["num"],
                    "line": first,
                    "quote": n["num"],
                    "message": f"疑似附图标记 {n['num']} 在正文中对应了不同名称：{'、'.join(n['names'])}"
                    f"（图例：{n['legend'] or '无'}），建议统一为一种写法，请核对。",
                }
            )
        elif n.get("legend_line") is not None and not lines:
            out.append(
                {
                    "kind": "legend_only",
                    "num": n["num"],
                    "line": n["legend_line"],
                    "quote": n["num"],
                    "message": f"疑似附图标记 {n['num']}（{n['legend']}）只出现在图例、正文未使用，建议核对是否遗漏。",
                }
            )
        elif n.get("legend_line") is None and lines:
            out.append(
                {
                    "kind": "text_only",
                    "num": n["num"],
                    "line": lines[0],
                    "quote": n["num"],
                    "message": f"疑似附图标记 {n['num']}（{'、'.join(n['names'])}）在附图说明中没有图例，"
                    "建议补充，请核对。",
                }
            )
    known = {f.num for f in figs}
    for f in figs:
        if not f.refs and f.caption_line is not None:
            out.append(
                {
                    "kind": "unreferenced",
                    "num": str(f.num),
                    "line": f.caption_line,
                    "quote": f"图{f.num}",
                    "message": f"疑似图{f.num} 未在具体实施方式中被引用，建议补写对该图的说明，请核对。",
                }
            )
    off = d.ast["books"]["description"]["offset"]
    seen: set[str] = set()
    for i, text in enumerate(d.lines[off:] if figs else [], start=off + 1):
        for m in _FIG_REF_RE.finditer(text):
            if int(m.group(1)) not in known and m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(
                    {
                        "kind": "missing_figure",
                        "num": m.group(1),
                        "line": i,
                        "quote": m.group(0),
                        "message": f"正文引用了图{m.group(1)}，但 docs/figures.md 中没有该图，"
                        "建议补图或改引用，请核对。",
                    }
                )
    return out


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    figs = ctx.tool("figures", ts.figures, d=d)
    items = ctx.tool("diff", diff, d=d, figs=figs)
    if not items:
        ctx.finish(diffs=0)
        return
    context = ctx.clip(
        json.dumps([{k: it[k] for k in ("kind", "num", "line", "message")} for it in items], ensure_ascii=False)
    )
    messages = prompts_agent.build(
        "s5", "explain", "请为每条差异写一句面向撰写人的说明与建议，输出 JSON items。", context=context, pid=ctx.pid
    )
    data, _raw = await common.gen_json(ctx, "explain", messages)
    explained: dict[tuple[str, int], str] = {}
    for it in (data or {}).get("items") or []:
        try:
            explained[(str(it["num"]), int(it["line"]))] = str(it["message"])
        except (KeyError, TypeError, ValueError):
            continue
    n = 0
    for it in items:
        body = explained.get((it["num"], it["line"]), it["message"])
        if common.comment(ctx, d, it["line"], it["quote"], body) is not None:
            n += 1
    ctx.finish(diffs=len(items), comments=n)
