# -*- coding: utf-8 -*-
"""系统提示词与输出约束（docs/plan/09 §2.6；E1 落地各 kind 文案与 build() 的案卷上下文拼装）。

每个 system 提示词首行是 "[patent-studio:<kind>]"，mock 供应商与用量记录据此识别场景。
rewrite/unify 输出必须是整行 CriticMarkup；review/convert/oa_answer/terms_extract 输出必须是符合 SCHEMAS 的 JSON。
"""
import json
import re
from dataclasses import dataclass

TAG_RE = re.compile(r"^\[patent-studio:([a-z_]+)\]")
KINDS = ("chat", "rewrite", "unify", "review", "convert", "oa_answer", "terms_extract")

SCHEMAS: dict[str, dict] = {
    "review": {
        "type": "object", "required": ["items"],
        "properties": {"items": {"type": "array", "items": {
            "type": "object", "required": ["rule", "severity", "block_id", "message"],
            "properties": {
                "rule": {"enum": ["A26.3", "A26.4", "A22.2", "A22.3", "term", "support", "clarity"]},
                "severity": {"enum": ["error", "warning", "info"]},
                "block_id": {"type": "string"}, "quote": {"type": "string"},
                "message": {"type": "string"}, "suggestion": {"type": ["string", "null"]},
            }}}},
    },
    "convert": {
        "type": "object", "required": ["title", "abstract", "claims", "description"],
        "properties": {
            "title": {"type": "string"}, "abstract": {"type": "string"},
            "claims": {"type": "array", "items": {"type": "string"}},
            "description": {
                "type": "object", "required": ["技术领域", "背景技术", "发明内容", "附图说明", "具体实施方式"],
                "additionalProperties": {"type": "string"},
            },
            "figures": {"type": "array", "items": {"type": "object", "required": ["num", "caption"],
                        "properties": {"num": {"type": "integer"},
                                       "src": {"type": "integer", "description": "提取图序号，1 起；与 mmd 二选一"},
                                       "mmd": {"type": "string", "description": "自绘受限 mermaid flowchart 图源——提取图无合格示意图时提供"},
                                       "marks": {"type": "object", "additionalProperties": {"type": "string"},
                                                 "description": "该图附图标记表 {标记号: 名称}，与正文/mmd 节点用号一致"},
                                       "caption": {"type": "string"}}}},
            "terms": {"type": "array", "items": {"type": "object", "required": ["name"]}},
            "notes": {"type": "array", "items": {"type": "string"}},
        },
    },
    "oa_answer": {
        "type": "object", "required": ["points", "claim_edits", "amend_summary"],
        "properties": {
            "points": {"type": "array", "items": {"type": "string"}},
            "claim_edits": {"type": "array", "items": {"type": "object", "required": ["claim", "critic_line"]}},
            "amend_summary": {"type": "string"},
        },
    },
    "terms_extract": {
        "type": "object", "required": ["terms"],
        "properties": {"terms": {"type": "array", "items": {"type": "object", "required": ["name"]}}},
    },
}

RULES = (
    "你是中国发明专利申请文件的撰写助手。案卷 Markdown 规则：# 标题；## 摘要 / ## 权利要求书 / ## 说明书；"
    "说明书含 ### 技术领域 / 背景技术 / 发明内容 / 附图说明 / 具体实施方式；"
    "权项以「N.」开头；公式 $$…$$；图「图N」；表「表N」。"
)
CRITIC_RULE = (
    "输出约束（违反即无效）：只输出被改写的整行，改动用 CriticMarkup：替换 {~~旧~>新~~}、删除 {--旧--}、新增 {++新++}；"
    "不要解释、不要围栏、不要改变行数。"
)
JSON_RULE = "输出约束（违反即无效）：只输出一个符合下面 schema 的 JSON 对象；不要 Markdown 围栏；不要解释。"
CHAT_RULE = (
    "用中文简明回答；引用案卷时给出行号；"
    "建议修改时用 CriticMarkup 整行给出（替换 {~~旧~>新~~}、删除 {--旧--}、新增 {++新++}），"
    "不要直接给改写后的全文；不确定的技术细节要反问，不要编造。"
)
REVIEW_RULE = (
    "审阅维度：A26.3 说明书公开不充分；A26.4 权利要求得不到说明书支持 / 不清楚；A22.2 新颖性、A22.3 创造性表述风险；"
    "term 术语不一致；support 权项特征在说明书无对应；clarity 表述不清。"
    "每条 block_id 必须原样取自输入块列表；quote 是该块内的原文片段；"
    "message 说问题，suggestion 给可直接采用的改写或 null。"
    "没有问题就返回空 items，不要凑数。"
)

REWRITE_ACTIONS: dict[str, str] = {
    "polish": "润色下列行：保持技术含义、权项引用与标号不变，改善语句通顺与专利文体。",
    "formalize": "把下列行规范化为专利表述（「所述」「被配置为」「其特征在于」等），不得增加或删减技术特征。",
    "expand": "在不新增未公开技术内容的前提下扩写下列行，补充必要的连接与解释；新增内容用 {++…++} 标在原行内。",
    "explain": "解释下列行的技术含义、在本案中的作用与可能的审查风险（A26.3/A26.4/A22），"
               "中文分点说明，不要改写原文。",
    "decopy": "下列行中有一句与已公开专利文献高度重合（涉嫌整句搬运）。"
              "请在不改变技术含义、不新增未公开技术特征的前提下，仅对该句换用不同的句式与语序重写；"
              "保持专利文体、术语一致与权项引用不变；其余句子原样保留，不要改动。",
}


@dataclass(frozen=True)
class Prompt:
    kind: str
    system: str
    schema: dict | None


def system_for(kind: str) -> Prompt:
    if kind not in KINDS:
        raise ValueError(f"未知提示词 kind：{kind}")
    schema = SCHEMAS.get(kind)
    parts = [f"[patent-studio:{kind}]", RULES]
    if kind == "review":
        parts.append(REVIEW_RULE)
    if schema is not None:
        parts += [JSON_RULE, json.dumps(schema, ensure_ascii=False)]
    elif kind in ("rewrite", "unify"):
        parts.append(CRITIC_RULE)
    elif kind == "chat":
        parts.append(CHAT_RULE)
    return Prompt(kind, "\n".join(parts), schema)


def build(kind: str, user: str, context: str = "") -> list[dict]:
    """[{system}, {user}]；E1 负责把案卷上下文（当前书 / 选区 ±N 行 / 体检摘要 / 术语主名）拼进 context。"""
    p = system_for(kind)
    system = p.system + ("\n案卷上下文：\n" + context if context else "")
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def system_message(kind: str, context: str = "") -> dict:
    return build(kind, "", context)[0]


def chat_messages(history: list[dict], context: str = "") -> list[dict]:
    """system(chat) + 前端传来的 user/assistant 历史（丢弃它自带的 system，提示词只有后端一份）。"""
    hist = [{"role": m["role"], "content": str(m.get("content") or "")}
            for m in history if m.get("role") in ("user", "assistant")]
    return [system_message("chat", context), *hist]


def rewrite_messages(action: str, lines: str, context: str = "", instruction: str | None = None) -> list[dict]:
    """explain 走 chat 提示词（不要标记）；其余动作走 rewrite（整行 CriticMarkup）。"""
    if action not in REWRITE_ACTIONS:
        raise ValueError(f"未知改写动作：{action}")
    user = REWRITE_ACTIONS[action]
    if instruction:
        user += "\n附加要求：" + instruction.strip()
    user += "\n\n" + lines
    return build("chat" if action == "explain" else "rewrite", user, context)


def review_messages(blocks: list[dict], scope: str, context: str = "") -> list[dict]:
    """blocks: [{block_id, text}]；输出按 SCHEMAS['review']。"""
    user = f"审阅范围：{scope}。块列表（JSON，block_id 原样回填）：\n" + json.dumps(blocks, ensure_ascii=False)
    return build("review", user, context)


def format_retry(messages: list[dict], bad_output: str, why: str) -> list[dict]:
    """输出不合约束时的纠正轮：附上原输出与原因，要求重出。"""
    return [*messages, {"role": "assistant", "content": bad_output},
            {"role": "user", "content": f"上一次输出不符合输出约束（{why}）。请严格按约束重新输出，不要解释。"}]


def kind_of(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "system":
            mt = TAG_RE.match(m.get("content") or "")
            if mt:
                return mt.group(1)
    return "chat"


def strip_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def parse_json(text: str, schema: dict | None) -> dict:
    """去围栏 → json.loads → 顶层 required 检查（完整 jsonschema 校验由 E1 决定是否引入运行时依赖）。
    模型偶在合法 JSON 对象后尾随评论/第二段文本（'Extra data'）——raw_decode 救回首个完整对象，
    尾随文本丢弃；对象本体仍须自足（解析失败照样 ValueError 走 format_retry）。"""
    t = strip_fence(text)
    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        start = t.find("{")
        if start < 0:
            raise
        data, _ = json.JSONDecoder().raw_decode(t[start:])
    if not isinstance(data, dict):
        raise ValueError("输出不是 JSON 对象")
    for k in (schema or {}).get("required", []):
        if k not in data:
            raise ValueError(f"缺少字段：{k}")
    return data
