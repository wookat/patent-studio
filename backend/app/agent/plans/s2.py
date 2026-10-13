# -*- coding: utf-8 -*-
"""S2 权项树批评（21 §6.1；R-AI-04）。

每个独立权利要求：claim_tree → support_map → context_pack(12k) → heavy gen → check。
确定性前置：依赖树内各权项的 preflight 诊断（claims.* 规则）与 checks.antecedent 直接产 comment，不经模型。
模型产出 items[{line, quote, message}]；每条过 anchor_hit + no_legal_verdict 才成为 comment。
"""
from __future__ import annotations

import json

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.ai import prompts_agent
from app.mcp import tools_semantic as ts
from app.mcp.schemas import ClaimNode

PLAN = Plan(
    scenario="s2",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("claim_tree", "构建权项依赖树"),
        CheckStep("antecedent", "确定性先行词 / 体检诊断 → 直接批注", ("antecedent",)),
        ToolStep("support_map", "对照说明书检索支持段落"),
        ToolStep("context_pack", "打包独立权利要求上下文（≤12k 字）"),
        GenStep("critique", "生成支持性 / 清楚性批评", "heavy"),
        CheckStep("verify", "校验锚点与措辞", ("anchor_hit", "no_legal_verdict")),
    ),
    model_route="heavy",
    budget_key="s2",
    output_kind=("comment",),
)

_SAFE_RULE = {"claims.multi_multi": "建议改为引用单项或拆分为多项从属权利要求，"
                                    "请核对是否符合审查指南对多项从属的要求。",
              "claims.unsupported_term": "疑似该术语在说明书中没有对应记载，"
                                         "建议补写对应实施例或统一为说明书已有写法，请核对。",
              "claims.antecedent": "疑似缺少先行基础，建议在本项或所引用的权利要求中先行引入该特征，请核对。"}


def _walk(node: ClaimNode):
    yield node
    for c in node.children:
        yield from _walk(c)


def _deterministic(ctx: RunContext, d, root: ClaimNode, chain_text: dict[int, str]) -> int:
    n = 0
    seen: set[tuple[int, str]] = set()
    for node in _walk(root):
        for it in node.issues:
            key = (it["line"], it["rule"])
            if not it["rule"].startswith("claims.") or key in seen:
                continue
            seen.add(key)
            hint = _SAFE_RULE.get(it["rule"], "请核对。")
            body = f"权利要求 {node.num}：疑似{it['message']}。{hint}"
            quote = str(it.get("detail") or "")
            if quote not in node.text:
                quote = f"{node.num}."
            if common.comment(ctx, d, it["line"], quote, body) is not None:
                n += 1
        res = checks.antecedent(node.text, chain_text.get(node.num, ""))
        ctx.check(res)
        if not res.ok and (node.line, "antecedent") not in seen:
            seen.add((node.line, "antecedent"))
            body = f"权利要求 {node.num}：{res.why}。{_SAFE_RULE['claims.antecedent']}"
            if common.comment(ctx, d, node.line, "所述", body) is not None:
                n += 1
    return n


def _pack_text(pack) -> str:
    claim = pack.claim
    parts = [f"独立权利要求 {claim.num}（{claim.category}，第 {claim.line} 行）：\n{claim.text}"]
    if pack.chain:
        parts.append("依赖链：\n" + "\n".join(f"[权 {c.num} 第 {c.line} 行] {c.text}" for c in pack.chain))
    parts.append("说明书支持段落：\n" + "\n".join(
        f"{s['para_no']}（第 {s['line']} 行，涉及：{'、'.join(s['terms'])}）{s['text']}" for s in pack.support))
    if pack.terms:
        parts.append("术语表：\n" + "\n".join(f"{t.name}：{t.definition or '（无定义）'}" for t in pack.terms))
    if pack.issues:
        parts.append("体检诊断：\n" + "\n".join(f"第 {i['line']} 行 {i['rule']}：{i['message']}" for i in pack.issues))
    return "\n\n".join(parts)


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    roots = ctx.tool("claim_tree", ts.claim_tree, d=d)
    chain_text = {}
    for root in roots:
        acc = root.text
        for node in _walk(root):
            chain_text[node.num] = acc if node is not root else ""
            acc = acc + "\n" + node.text
    ctx.tool("support_map", ts.support_map, d=d)
    total = 0
    for root in roots:
        total += _deterministic(ctx, d, root, chain_text)
        pack = ctx.tool("context_pack", ts.context_pack, d=d, claim_id=str(root.num), max_chars=12000)
        if pack.truncated:
            ctx.truncated = True
        messages = prompts_agent.build("s2", "critique", "请给出这条独立权利要求及其从属项的批评意见 JSON。",
                                       context=ctx.clip(_pack_text(pack)), pid=ctx.pid, claim=root.num)
        data, raw = await common.gen_json(ctx, "critique", messages)
        if data is None:
            # 格式两次都不合约束：降级为整块批注，正文照样过措辞门
            body = "智能体批评（未能结构化，请核对）：" + raw.strip()[:800]
            block = common.claim_block(d, root.num)
            if block is not None and common.comment(ctx, d, root.line, f"{root.num}.", body) is not None:
                total += 1
            continue
        for it in data.get("items") or []:
            try:
                line, quote, body = int(it["line"]), str(it["quote"]), str(it["message"])
            except (KeyError, TypeError, ValueError):
                ctx.check(checks.CheckResult(name="format", ok=False,
                                             why=f"items 条目缺字段：{json.dumps(it, ensure_ascii=False)[:80]}"))
                continue
            if common.comment(ctx, d, line, quote, body) is not None:
                total += 1
    ctx.finish(comments=total)
