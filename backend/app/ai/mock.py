# -*- coding: utf-8 -*-
"""mock 供应商（docs/plan/09 §2.2）：PATENT_STUDIO_AI_PROVIDER=mock 或测试注入；不出站。

按 prompts.kind_of(messages) 选 fixture（ai/fixtures/<kind>.txt|json），构造时可用 {kind: text} 覆盖；
流式按 8 字一段切分；用量固定 prompt=len(prompt)//2、completion=len(text)//2；calls 计数供测试断言「零调用」。
"""

import asyncio
import os
from collections.abc import AsyncIterator

from app.ai import prompts
from app.ai.client import MODELS, Usage

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
CHUNK = 8


def _fixture(kind: str) -> str:
    for ext in (".txt", ".json"):
        p = os.path.join(FIXTURES_DIR, kind + ext)
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                return f.read()
    return f"[mock:{kind}]"


class MockProvider:
    name = "mock"

    def __init__(self, responses: dict[str, str] | None = None):
        self.responses = dict(responses or {})
        self.calls: list[dict] = []

    def _text(self, messages: list[dict]) -> str:
        kind = prompts.kind_of(messages)
        return self.responses.get(kind) or _fixture(kind)

    def _usage(self, messages: list[dict], text: str) -> Usage:
        prompt = sum(len(m.get("content") or "") for m in messages) // 2
        completion = len(text) // 2
        return Usage(prompt, completion, prompt + completion)

    async def complete(self, model, messages, *, timeout, max_tokens=None, temperature=0.0):
        text = self._text(messages)
        self.calls.append({"model": model, "stream": False, "kind": prompts.kind_of(messages)})
        return text, self._usage(messages, text)

    async def stream(self, model, messages, *, timeout, max_tokens=None, temperature=0.0) -> AsyncIterator[str | Usage]:
        text = self._text(messages)
        self.calls.append({"model": model, "stream": True, "kind": prompts.kind_of(messages)})
        for i in range(0, len(text), CHUNK):
            yield text[i : i + CHUNK]
            await asyncio.sleep(0)
        yield self._usage(messages, text)

    async def list_models(self) -> list[str]:
        return [MODELS["interactive"], MODELS["heavy"], MODELS["fallback"]]
