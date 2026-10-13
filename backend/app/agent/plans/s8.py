# -*- coding: utf-8 -*-
"""S8 查新笔记。

读三书 → 提取发明点与三要素 → 生成检索式 → **经 prior_art provider 执行真实检索** →
一条 comment 提案挂在权项书。检索源未配置或全部失败时降级为「待检索」笔记（同 R-AI-S8 封印期契约）。
命中仅作机器初筛供代理人复核，永不产出新颖性/创造性结论（no_legal_verdict 门禁不变）；
模型不可用或 JSON 失败时用确定性骨架兜底。方法学见 .agents/skills/patent-drafting/references/prior-art.md。
"""
from __future__ import annotations

from app.agent import prior_art
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent

PLAN = Plan(
    scenario="s8",
    steps=(
        ToolStep("derive", "读取三书并派生 AST"),
        GenStep("novelty", "提发明点并拟定检索式", "interactive"),
        ToolStep("search", "执行先行技术检索"),
        CheckStep("verify", "校验锚点与措辞", ("anchor_hit", "no_legal_verdict")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("comment",),
)

_SOURCES = ("CNIPA", "Google Patents", "Scholar")


def _claim_titles(d) -> list[str]:
    out = []
    for c in d.ast["claims"]:
        line = d.lines[c["lines"]["start"] - 1].strip() if c["lines"]["start"] - 1 < len(d.lines) else ""
        if line:
            out.append(line)
    return out


def _context(ctx: RunContext, d) -> str:
    parts = [f"【权利要求书】\n{common.book_text(d, 'claims')}"]
    desc = common.book_text(d, "description")
    parts.append(f"【说明书（截）】\n{desc[:3_000]}")
    terms = ", ".join(d.terms) if getattr(d, "terms", None) else ""
    if terms:
        parts.append(f"【术语表】\n{terms}")
    return ctx.clip("\n\n".join(parts))


def _hits_block(rep: prior_art.SearchReport) -> str:
    # 批注卡按纯文本渲染（无 markdown），命中行用编号+裸 URL 排版
    if not rep.providers:
        return ""
    rows = []
    for q, hits in rep.hits.items():
        rows.append(f"· 检索式：{q}")
        if hits:
            for i, h in enumerate(hits[:5], 1):
                rows.append(f"  {i}. {h.number}　{h.title[:50]}　{h.date}　{h.source}")
                if h.link:
                    rows.append(f"     {h.link}")
        else:
            rows.append("  · 无命中")
    lines = ["【检索命中】（机器初筛，供代理人复核，不作新颖性/创造性结论）"]
    lines += rows if rows else ["· 无命中"]
    if rep.notes:
        lines.append("· 检索异常：" + "；".join(rep.notes[:4]))
    return "\n".join(lines)


def _render(points: list[dict], queries: list[dict], notes: list[str], rep: prior_art.SearchReport | None) -> str:
    plines = [f"· {p.get('title', '')}｜区别点：{p.get('distinguishing_point', '')}"
              f"｜技术问题：{p.get('technical_problem', '')}｜技术效果：{p.get('technical_effect', '')}"
              for p in points]
    qlines = [f"· {q.get('source', '检索库')}：{q.get('query', '')}" for q in queries if q.get("query")]
    nlines = [f"· {n}" for n in notes if n]
    searched = rep is not None and bool(rep.providers)
    head = "查新笔记（机器初筛 · 待人工复核）" if searched else "查新笔记（待检索）"
    intro = ("本笔记由智能体依据当前三书提取发明点并执行先行技术检索；命中为机器初筛结果，"
             "新颖性与创造性判断留待代理人复核确认。" if searched else
             "本笔记由智能体依据当前三书提取发明点并拟定检索式；未执行真实检索，"
             "新颖性与创造性判断留待代理人检索确认。")
    out = head + "\n\n" + intro + "\n\n【发明点 · 三要素】\n" + ("\n".join(plines) or "· 待提取") + "\n\n"
    if searched:
        out += _hits_block(rep) + "\n\n【检索式存档】（建议再在 CNIPA / Google Patents / 学术库人工复核；\n" \
            "检索式与命中可经对话「归档查新」记入查新记录卡）\n" \
            + ("\n".join(qlines) or "· 待补充")
    else:
        out += "【建议检索式】（建议优先在 CNIPA / Google Patents / 学术库逐条核实，勿直接采信）\n" \
            + ("\n".join(qlines) or "· 待补充")
        if rep is not None and rep.notes:
            out += "\n\n· " + "\n· ".join(rep.notes[:3])
    out += "\n\n【待确认】\n" + ("\n".join(nlines) or "· 待代理人检索后填写最接近文献与差异点")
    return out


def _fallback(titles: list[str]) -> tuple[list[dict], list[dict], list[str]]:
    points = [{"title": t, "distinguishing_point": "待提取", "technical_problem": "待提取",
               "technical_effect": "待提取"} for t in titles[:3]] or [
        {"title": "（本案尚无权项）", "distinguishing_point": "待提取", "technical_problem": "待提取",
         "technical_effect": "待提取"}]
    queries = [{"source": "CNIPA", "query": "待代理人依据发明点构造"},
               {"source": "Google Patents", "query": "待代理人依据发明点构造"},
               {"source": "Scholar", "query": "待代理人依据发明点构造"}]
    return points, queries, ["模型不可用，本笔记为确定性骨架：检索式与三要素待人工补全"]


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    titles = _claim_titles(d)
    context = _context(ctx, d)
    messages = prompts_agent.build("s8", "novelty",
                                   "请提取发明点与三要素并给出建议检索式与待确认项，输出 JSON。",
                                   context=context, pid=ctx.pid)
    data, _raw = await common.gen_json(ctx, "novelty", messages)
    if data is None:
        points, queries, notes = _fallback(titles)
    else:
        points = [p for p in (data.get("points") or []) if isinstance(p, dict)]
        queries = [q for q in (data.get("queries") or []) if isinstance(q, dict)]
        notes = [str(n) for n in (data.get("notes") or [])]
        if not points:
            points, _, fallback_notes = _fallback(titles)
            notes = notes + fallback_notes
        if not queries:
            queries = [{"source": s, "query": "待代理人依据发明点构造"} for s in _SOURCES]
    qtexts = [str(q.get("query", "")) for q in queries
              if q.get("query") and "待" not in str(q.get("query"))][:8]
    rep: prior_art.SearchReport | None = None
    if prior_art.configured_providers() and qtexts:
        rep = ctx.tool("prior_art_search", prior_art.search_all, queries=qtexts, limit=5)
    body = _render(points, queries, notes, rep)
    anchor_block = common.last_block(d, "claims") or common.last_block(d, "description")
    if anchor_block is None:
        ctx.finish(error="案卷无权利要求或说明书块，无法挂查新笔记")
        return
    book = "claims" if common.last_block(d, "claims") is anchor_block else "description"
    line = d.ast["books"][book]["offset"] + anchor_block["lines"]["start"]
    quote = d.lines[line - 1].strip() or anchor_block["id"]
    common.comment(ctx, d, line, quote, body)
    ctx.finish(points=len(points), queries=len(queries), comments=len(ctx.proposals),
               providers=len(rep.providers) if rep else 0)
