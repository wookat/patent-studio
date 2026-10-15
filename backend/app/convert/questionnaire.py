# -*- coding: utf-8 -*-
"""交底书问卷（docs/plan/09 §3.3.1）：六个可选字段，非空字段渲染为提示词里的「发明要点」段，优先于论文原文。"""

import json
from typing import TypedDict

FIELDS = ("problem", "prior_art_defects", "solution_steps", "key_params", "effects", "figures")
LABELS = {
    "problem": "要解决的技术问题",
    "prior_art_defects": "现有技术的缺陷",
    "solution_steps": "技术方案步骤",
    "key_params": "关键参数 / 取值",
    "effects": "有益效果",
    "figures": "附图说明",
}


class Questionnaire(TypedDict, total=False):
    problem: str
    prior_art_defects: str
    solution_steps: str
    key_params: str
    effects: str
    figures: str


class QuestionnaireError(ValueError):
    pass


def parse(raw: str | None) -> Questionnaire:
    """表单里的 JSON 字串 → 只保留六个已知字段的非空字符串值。"""
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise QuestionnaireError(f"questionnaire 不是合法 JSON：{e}")
    if not isinstance(data, dict):
        raise QuestionnaireError("questionnaire 必须是 JSON 对象")
    out: Questionnaire = {}
    for k in FIELDS:
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()  # type: ignore[literal-required]
    return out


def render(q: Questionnaire) -> str:
    parts = [f"{LABELS[k]}：\n{q[k]}" for k in FIELDS if q.get(k)]
    return "\n\n".join(parts)
