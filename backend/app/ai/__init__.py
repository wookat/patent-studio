# -*- coding: utf-8 -*-
"""AI 接入层（docs/plan/09 §2，单元 E1-ai-client）。

client.py  OpenAI 兼容客户端：按场景路由 / 兜底 / 超时 / 重试 / Semaphore(2) / 用量记录
jobs.py    后台任务：内存 + <project>/.studio/ai-jobs/<id>.json
prompts.py 系统提示词与输出约束（CriticMarkup / JSON schema）
mock.py    mock 供应商（PATENT_STUDIO_AI_PROVIDER=mock）

隐私：所有带 pid 的 AI 路由先过 require_enabled()；settings.ai_enabled 默认 false ⇒ 零出站。
"""
from fastapi import HTTPException

from app.errors import error_detail


def require_enabled(store, pid: str, unit: str) -> dict:
    """本案未开启「允许外发到 AI」⇒ 403 ai_disabled；开启则返回 settings。"""
    s = store.load_settings(pid)
    if not s.get("ai_enabled"):
        raise HTTPException(
            403, error_detail("ai_disabled", "本案未允许将内容发送到 AI 中转站，请在 AI 面板开启", detail=unit)
        )
    return s


__all__ = ["require_enabled"]
