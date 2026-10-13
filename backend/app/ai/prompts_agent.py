# -*- coding: utf-8 -*-
"""智能体场景提示词（docs/plan/21 §6.1；19 §3）与 mock 夹具分发。

system 首行沿用 "[patent-studio:agent]"（prompts.kind_of → "agent"，用量记录 kind=agent），
第二行 "agent-call: scenario=s2 step=critique pid=method claim=1" 标明本次调用槽位——
真模型忽略它；AgentMockProvider 用它在 ai/fixtures/agent_<scenario>.jsonl 里选一条（每行一条
{scenario, step, <其它 where 键>…, text}，除 text 外的键全部与 header 相等才命中；无命中回退 MockProvider 行为）。

措辞纪律（A4）：所有面向用户的文字只能「建议 / 疑似 / 请核对」，不得下法律结论（不支持 / 不清楚 /
不具备新颖性 / 不具备创造性 / 应予驳回 / 无效…）；不得直接改写源码——改动一律以 CriticMarkup 或待确认补丁给出。
"""
from __future__ import annotations

import json
import os
import re

from app.ai import prompts
from app.ai.mock import FIXTURES_DIR, MockProvider

KIND = "agent"
TAG = f"[patent-studio:{KIND}]"
_HEADER_RE = re.compile(r"^agent-call: (.*)$", re.M)

SAFE_RULE = (
    "措辞约束（违反即无效）：你是撰写助手，不是审查员或代理师。对疑点只能用「建议…」「疑似…」「请核对…」表述，"
    "不得写出结论式判断，禁用词：不支持、不清楚、不具备新颖性、不具备创造性、应予驳回、无效。"
    "不得直接改写源文档：改动只能以 CriticMarkup（{~~旧~>新~~} / {++新++} / {--旧--}）或补丁草稿给出，由用户确认。"
    "不要编造案卷中不存在的技术特征、附图或段号。"
)

SYSTEM: dict[str, str] = {
    "s1": "任务：把技术交底书整理为三书初稿。先按 outline 步骤给 JSON 大纲（title / independent_claims / "
          "dependent_points / sections；每个发明点附 trichotomy：区别点 / 技术问题 / 技术效果），"
          "再按 claims / description / abstract 步骤分书成稿；权项不自行编号，"
          "说明书各节多段纯文本、段间空行、不写段号。"
          "撰写红线：深度挖掘不等于创造性扩展——只写交底书里出现过的技术内容，原文未提及的细节宁可不写、"
          "列入待确认，绝不编造参数 / 实验 / 附图 / 效果。权项布局：独立权项只含区别所必需的最少技术特征，"
          "从属权项放有意义的退路限定（预处理 / 参数范围 / 阈值 / 实施细节）；先行词先引出再用「所述」；"
          "附图说明只写真实存在的图。",
    "s2": "任务：对一条独立权利要求及其从属项做支持性 / 清楚性 / 先行词批评。输入是 context_pack（权项原文、依赖链、"
          "说明书支持段落含段号 [00NN]、术语表、体检诊断）。每条意见必须：line 取自输入的行号、quote 是该行原文片段、"
          "message 引用说明书段号 [00NN] 说明疑点与建议。没有疑点就返回空 items，不要凑数。",
    "s3": "任务：为权项中缺少说明书对应记载的特征补写一段说明书文字（具体实施方式口吻，≤200 字），只输出这一段纯文本，"
          "只能使用权项与说明书已有的名词，不引入新的技术特征。",
    "s4": "任务：术语一致性。输入是确定性找出的候选术语组（同一概念的多种写法及各自出现行）。你只做一件事："
          "为每组选一个主术语（必须是该组给出的写法之一，优先图例 / 术语表 / 权项写法），并剔除不是同一概念的组。",
    "s5": "任务：解释附图标记与说明书的差异。输入是确定性差分结果（标记号、图例名、正文写法、行号）。"
          "为每条差异写一句面向撰写人的说明与建议，不新增差异条目，不改变 num 与 line。",
    "s6": "任务：根据权利要求书与说明书生成摘要：一段纯文本，≤300 字，"
          "写明技术领域、要解决的问题、技术方案要点与主要用途，"
          "只能使用三书已有的名词，不写「本发明公开了」以外的套话，不含附图标记与段号。",
    "s7": "任务：针对一条审查意见起草申请人的争辩要点与可选的权项修改建议。points 逐点面向审查员陈述，"
          "转述审查意见用「审查意见认为…」，己方主张用「申请人认为…」；claim_edits 只针对被指出的权项给出修改后的"
          "完整正文（可用 CriticMarkup），不得删除、新增或重排权项，不得改动权项编号与引用关系；不需要修改给空数组。",
    "s8": "任务：为当前专利三书生成查新笔记。输入是权项书 / 说明书摘录与术语表。"
          "输出 JSON：points 逐发明点给 title / distinguishing_point / technical_problem / technical_effect；"
          "queries 给 3–8 条检索式，每条 {source, query}——source 取 CNIPA / Google Patents / Scholar / PatSnap，"
          "query 是 2–8 词的高信噪检索单元组合（专业术语、名词短语、应用场景 + 核心机制、已知别名），"
          "可含 AND / OR 布尔符，不用整句，不用「系统 / 方法 / 模型 / 平台」类孤词；notes 列需代理人确认的事项。"
          "检索式将被机器在已配置检索源上执行，命中只作初筛；只提取源文有的技术事实，"
          "绝不编造专利号、文献、URL 或检索结论。",
    "s9": "任务：把一书 Markdown 忠实译为英文，保持 Markdown 结构、权项编号「N.」、权项引用（claim N）、公式 $$…$$、"
          "图号与段落划分一一对应；术语全篇统一；只输出译文。",
    "s10": "任务：为客户（发明人 / 企业 IPR）写一页 Markdown 简报：发明名称、解决的问题、核心方案（对应独立权利要求）、"
           "保护范围要点、后续流程与需客户确认的事项。只用三书已有的名词，不作授权前景判断。",
}

SCHEMAS: dict[str, dict] = {
    "s1.outline": {"type": "object", "required": ["title", "independent_claims", "dependent_points", "sections"]},
    "s1.claims": {"type": "object", "required": ["claims"]},
    "s1.description": {"type": "object", "required": ["description"]},
    "s2.critique": {"type": "object", "required": ["items"]},
    "s4.select": {"type": "object", "required": ["groups"]},
    "s5.explain": {"type": "object", "required": ["items"]},
    "s7.argue": {"type": "object", "required": ["points", "claim_edits"]},
    "s8.novelty": {"type": "object", "required": ["points", "queries"]},
}


def schema_for(scenario: str, step: str) -> dict | None:
    return SCHEMAS.get(f"{scenario}.{step}")


def build(scenario: str, step: str, user: str, *, context: str = "", **where: object) -> list[dict]:
    """[{system}, {user}]：TAG + agent-call 头 + 通用规则 + 措辞纪律 + 场景任务 + (JSON 约束) + 案卷上下文。"""
    if scenario not in SYSTEM:
        raise ValueError(f"未知智能体场景 {scenario!r}")
    head = " ".join([f"scenario={scenario}", f"step={step}", *(f"{k}={v}" for k, v in where.items())])
    parts = [TAG, "agent-call: " + head, prompts.RULES, SAFE_RULE, SYSTEM[scenario]]
    schema = schema_for(scenario, step)
    if schema is not None:
        parts += [prompts.JSON_RULE, json.dumps(schema, ensure_ascii=False)]
    system = "\n".join(parts) + ("\n案卷上下文：\n" + context if context else "")
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_header(messages: list[dict]) -> dict[str, str] | None:
    for m in messages:
        if m.get("role") != "system":
            continue
        content = m.get("content") or ""
        if not content.startswith(TAG):
            return None
        mt = _HEADER_RE.search(content)
        if not mt:
            return None
        return dict(kv.split("=", 1) for kv in mt.group(1).split() if "=" in kv)
    return None


# ---------------------------------------------------------------- mock 夹具 ----

def fixture_path(scenario: str) -> str:
    return os.path.join(FIXTURES_DIR, f"agent_{scenario}.jsonl")


def load_fixture(scenario: str) -> list[dict]:
    p = fixture_path(scenario)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [json.loads(ln) for ln in f if ln.strip()]


def pick(entries: list[dict], header: dict[str, str]) -> str | None:
    for e in entries:
        if all(str(e[k]) == header.get(k) for k in e if k != "text"):
            return e["text"] if isinstance(e["text"], str) else json.dumps(e["text"], ensure_ascii=False)
    return None


class AgentMockProvider(MockProvider):
    """MockProvider + 智能体夹具：header 命中 agent_<scenario>.jsonl 一条则返回它，否则与 MockProvider 相同。"""

    def _text(self, messages: list[dict]) -> str:
        header = parse_header(messages)
        if header and "scenario" in header:
            text = pick(load_fixture(header["scenario"]), header)
            if text is not None:
                return text
        return super()._text(messages)
