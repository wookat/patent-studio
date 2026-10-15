# -*- coding: utf-8 -*-
"""S10 客户简报（21 §6.1）。

各独立权利要求的 context_pack（裁到预算）→ 1 次 medium gen → check(noun_subset：名词 ⊆ 三书)→ patch docs/brief.md。
不作授权前景判断（no_legal_verdict 同样把关）。
"""

from __future__ import annotations

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.agent.types import FileAnchor, FilePatch
from app.ai import prompts_agent
from app.mcp import tools_semantic as ts

PLAN = Plan(
    scenario="s10",
    steps=(
        ToolStep("derive", "读取三书并派生 AST / 体检"),
        ToolStep("claim_tree", "取各独立权利要求"),
        ToolStep("context_pack", "打包独立权利要求上下文"),
        GenStep("brief", "生成客户简报", "interactive"),
        CheckStep("verify", "校验名词子集与措辞", ("noun_subset", "no_legal_verdict")),
    ),
    model_route="interactive",
    budget_key="interactive",
    output_kind=("patch",),
)

FILE = "docs/brief.md"
# 简报体裁自带的栏目词，不计入三书名词子集
BRIEF_WORDS = (
    "客户简报",
    "发明名称",
    "解决问题",
    "核心方案",
    "保护范围",
    "独立权利要求",
    "从属权利要求",
    "下一步",
    "需核对",
    "请核对",
    "建议",
    "说明书",
    "摘要",
    "附图",
    "附图标记",
    "写法",
    "是否统一",
    "引用方式",
    "技术方案",
    "技术效果",
    "现有技术",
    "本案",
    "案卷",
)


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    d = common.derive(ctx)
    roots = ctx.tool("claim_tree", ts.claim_tree, d=d)
    parts = [f"发明名称：{d.ast.get('title') or ''}"]
    for root in roots[:3]:
        pack = ctx.tool("context_pack", ts.context_pack, d=d, claim_id=str(root.num), max_chars=3000)
        parts.append(f"独立权利要求 {root.num}（{root.category}）：{root.text}")
        parts += [f"{s['para_no']} {s['text']}" for s in pack.support[:4]]
    context = ctx.clip("\n\n".join(parts))
    messages = prompts_agent.build("s10", "brief", "请写一页面向客户的 Markdown 简报。", context=context, pid=ctx.pid)
    source = common.final_text(d)
    text, results = "", []
    for attempt in range(2):
        res = await ctx.gen("brief" if attempt == 0 else "brief.retry", messages)
        text = res.text.strip("\n") + "\n"
        results = [checks.noun_subset(text, source, allow=BRIEF_WORDS), checks.no_legal_verdict(text)]
        if all([ctx.check(r) for r in results]):
            ctx.propose("patch", FileAnchor(file=FILE), patch=FilePatch(file=FILE, content=text), checks_=results)
            break
        messages = [
            *messages,
            {"role": "assistant", "content": res.text},
            {
                "role": "user",
                "content": "上一次输出使用了三书中不存在的名词或含结论式措辞，"
                "请只用案卷已有名词、不作授权前景判断重写。",
            },
        ]
    ctx.finish()
