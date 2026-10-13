# -*- coding: utf-8 -*-
"""E3 共用：purpose=heavy 的一次非流式 AI 调用（convert 与 oa 都走这里）。

heavy_chat(ai, messages, *, project_dir, job_id) → (text, usage dict)：走 AiClient.chat（失败链 / 用量记录在 client）。
后台任务统一由 app.ai.jobs.JobStore.run 承载。
"""
from dataclasses import asdict


async def heavy_chat(ai, messages: list[dict], *, project_dir: str | None,
                     job_id: str | None = None) -> tuple[str, dict]:
    r = await ai.chat(messages, "heavy", project_dir=project_dir, job_id=job_id)
    return r.text, asdict(r.usage)
