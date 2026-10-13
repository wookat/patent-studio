# -*- coding: utf-8 -*-
"""S4 术语一致性（21 §6.1）。

确定性候选组：term_rows 里带 aliases 的术语 + terms.extract 抽到的别名 + 附图标记同号多名（numerals.inconsistent）。
medium gen 只做一件事：为每组选主术语（必须是组内写法之一）并剔除非同一概念的组；模型不可用或选错则回退
到确定性默认（图例名 / 术语表主名）。然后 terms.unify 生成 {~~旧~>新~~}，按块产 critic，每块过 lint + roundtrip。
"""
from __future__ import annotations

import json

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent
from app.domain import terms as terms_mod
from app.mcp import tools_semantic as ts

PLAN = Plan(
    scenario="s4",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("term_rows", "汇总术语表与支持映射"),
        ToolStep("candidates", "确定性候选：别名 / 同号多名"),
        GenStep("select", "选主术语", "interactive"),
        CheckStep("verify", "校验 CriticMarkup 与回环", ("lint", "roundtrip")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("critic",),
)


def candidates(d, rows) -> list[dict]:
    """[{primary, aliases, lines, source}]；primary 为确定性默认。"""
    out: list[dict] = []
    seen: set[frozenset] = set()

    def add(primary: str, aliases: list[str], lines: list[int], source: str):
        aliases = [a for a in dict.fromkeys(aliases) if a and a != primary]
        key = frozenset([primary, *aliases])
        if not aliases or key in seen:
            return
        seen.add(key)
        out.append({"primary": primary, "aliases": aliases, "lines": sorted(set(lines)), "source": source})

    for r in rows:
        add(r.name, list(r.aliases), [r.definition_line] if r.definition_line else [], "glossary")
    for t in terms_mod.extract(common.final_text(d)):
        add(t["name"], list(t.get("aliases") or []), list(t.get("lines") or []), "extract")
    for n in d.report["numerals"]:
        if not n["consistent"] and len(n["names"]) > 1:
            names = list(n["names"])
            primary = n["legend"] if n["legend"] in names else max(names, key=len)
            add(primary, [x for x in names if x != primary], list(n["lines"]), f"numeral:{n['num']}")
    return out


def _select(groups: list[dict], data: dict | None) -> list[dict]:
    """模型回答 groups[{primary, aliases}] → 只保留与候选组对得上的、primary 在组内的；无回答用确定性默认。"""
    if data is None:
        return groups
    chosen: list[dict] = []
    for g in data.get("groups") or []:
        try:
            primary, aliases = str(g["primary"]), [str(a) for a in g.get("aliases") or []]
        except (KeyError, TypeError):
            continue
        for cand in groups:
            words = {cand["primary"], *cand["aliases"]}
            if primary in words and set(aliases) <= words:
                chosen.append({**cand, "primary": primary, "aliases": [w for w in words if w != primary]})
                break
    return chosen


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    rows = ctx.tool("term_rows", ts.term_rows, d=d)
    groups = ctx.tool("candidates", candidates, d=d, rows=rows)
    if not groups:
        ctx.finish(groups=0)
        return
    context = ctx.clip(json.dumps([{"primary_default": g["primary"], "words": [g["primary"], *g["aliases"]],
                                    "lines": g["lines"][:6], "source": g["source"]} for g in groups],
                                  ensure_ascii=False))
    messages = prompts_agent.build("s4", "select", "请为每个候选组选出主术语，剔除不是同一概念的组，输出 JSON。",
                                   context=context, pid=ctx.pid)
    data, _raw = await common.gen_json(ctx, "select", messages)
    selected = _select(groups, data)
    content = ctx.store.read_content(ctx.pid)
    new, changed = terms_mod.unify(content, [{"name": g["primary"], "aliases": g["aliases"]} for g in selected])
    if not changed:
        ctx.finish(groups=len(selected), blocks=0)
        return
    old_lines, new_lines = content.split("\n"), new.split("\n")
    done: set[str] = set()
    for ln in changed:
        hit = common.block_at(d, ln)
        if hit is None:
            continue
        book, block = hit
        if block["id"] in done:
            continue
        done.add(block["id"])
        anchor = common.anchor_of(d, book, block)
        old = "\n".join(old_lines[anchor.line_start - 1: anchor.line_end])
        crit = "\n".join(new_lines[anchor.line_start - 1: anchor.line_end])
        results = [checks.lint(crit), checks.roundtrip(old, crit)]
        if all([ctx.check(r) for r in results]):
            ctx.propose("critic", anchor, critic_markdown=crit, checks_=results)
    ctx.finish(groups=len(selected), blocks=len(done))
