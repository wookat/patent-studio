# -*- coding: utf-8 -*-
"""OpenAI 兼容客户端（docs/plan/09 §2.1）：chat/stream 的路由、兜底、重试与用量记录。

路由：interactive → swe-2-medium；heavy → swe-2-max；唯一兜底 swe-2-high（不用 claude-sonnet-4.6）。
超时：interactive 30 s / heavy 300 s（环境变量 PATENT_STUDIO_AI_TIMEOUT_INTERACTIVE / _HEAVY 可覆盖）；
流式 = connect 10 s + 字节间隔同值。
重试 1 次仅针对 429 / 5xx / 连接错误，重试前指数退避（PATENT_STUDIO_AI_BACKOFF 秒起，缺省 1 s），再失败换兜底；
读超时直接换兜底（同一模型再等一个超时周期只会让用户多等 30 s，实测如此）。
并发：模块级 asyncio.Semaphore(config.AI_CONCURRENCY，缺省 2)，流式请求持有到流结束。
用量：<project>/.studio/ai-usage.jsonl 每次上游请求一行（§2.4 字段；失败尝试 ok=false 也记）。
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from typing import Literal, Protocol

import httpx

from app import config
from app.ai import prompts

Purpose = Literal["interactive", "heavy"]
ErrorKind = Literal["no_key", "timeout", "upstream", "format", "disabled"]

BASE_URL = "https://api.aicdks.com"
MODELS: dict[str, str] = {"interactive": "swe-2-medium", "heavy": "swe-2-max", "fallback": "swe-2-high"}


def _env_timeout(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        v = float(raw) if raw else default
    except ValueError:
        return default
    return v if v > 0 else default


TIMEOUTS: dict[str, float] = {
    "interactive": _env_timeout("PATENT_STUDIO_AI_TIMEOUT_INTERACTIVE", 30.0),
    "heavy": _env_timeout("PATENT_STUDIO_AI_TIMEOUT_HEAVY", 300.0),
}
CONNECT_TIMEOUT = 10.0
PROBE_TIMEOUT = 10.0
BACKOFF_S = _env_timeout("PATENT_STUDIO_AI_BACKOFF", 1.0)
USAGE_FILE = os.path.join(".studio", "ai-usage.jsonl")

_SEM = asyncio.Semaphore(config.AI_CONCURRENCY)  # W5：PATENT_STUDIO_AI_CONCURRENCY，缺省 2


class AiError(Exception):
    """kind → HTTP：no_key 503 / timeout 504 / upstream 502 / format 502 / disabled 403。
    retryable 仅 timeout / 429 / 5xx / 连接错误；upstream_status 为中转站原始 HTTP 码（非 HTTP 错误为 None）。"""

    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        status: int = 502,
        *,
        retryable: bool = False,
        upstream_status: int | None = None,
    ):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.retryable = retryable
        self.upstream_status = upstream_status


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_json(cls, raw) -> "Usage":
        if not isinstance(raw, dict):
            return cls()
        p = int(raw.get("prompt_tokens") or 0)
        c = int(raw.get("completion_tokens") or 0)
        return cls(p, c, int(raw.get("total_tokens") or (p + c)))


@dataclass
class ToolResult:
    message: dict
    model: str
    usage: "Usage"
    ms: int
    fallback: bool


@dataclass
class ChatResult:
    text: str
    model: str
    usage: Usage
    ms: int
    fallback: bool


class Provider(Protocol):
    name: str

    async def complete(
        self, model: str, messages: list[dict], *, timeout: float, max_tokens: int | None, temperature: float
    ) -> tuple[str, Usage]: ...

    def stream(
        self, model: str, messages: list[dict], *, timeout: float, max_tokens: int | None, temperature: float
    ) -> AsyncIterator[str | Usage]: ...

    async def list_models(self) -> list[str]: ...


def _http_error(e: httpx.HTTPError) -> AiError:
    if isinstance(e, httpx.TimeoutException):
        return AiError("timeout", f"AI 中转站超时：{e.__class__.__name__}", 504, retryable=True)
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        body = e.response.text[:200]
        return AiError(
            "upstream", f"AI 中转站返回 {code}：{body}", 502, retryable=code == 429 or code >= 500, upstream_status=code
        )
    return AiError("upstream", f"无法连接 AI 中转站：{e}", 502, retryable=True)


class OpenAICompatProvider:
    """httpx 实现：POST {base}/v1/chat/completions、GET {base}/v1/models，Authorization: Bearer。"""

    name = "aicdks"

    def __init__(self, key: str, base_url: str = BASE_URL):
        self.key = key
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.base_url, headers={"Authorization": f"Bearer {key}"})

    def _body(self, model, messages, *, max_tokens, temperature, stream, tools=None, tool_choice=None):
        body = {"model": model, "messages": messages, "temperature": temperature, "stream": stream}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if stream:
            body["stream_options"] = {"include_usage": True}
        if tools is not None:
            body["tools"] = tools
            body["tool_choice"] = tool_choice or "auto"
        return body

    async def _post_message(self, model, messages, *, timeout, max_tokens, temperature, tools, tool_choice):
        try:
            r = await self._client.post(
                "/v1/chat/completions",
                json=self._body(
                    model,
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=False,
                    tools=tools,
                    tool_choice=tool_choice,
                ),
                timeout=httpx.Timeout(timeout, connect=CONNECT_TIMEOUT),
            )
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise _http_error(e) from e
        except ValueError as e:
            raise AiError("format", f"AI 中转站返回非 JSON：{e}") from e
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as e:
            raise AiError("format", "AI 中转站响应缺少 choices[0].message") from e
        return msg, Usage.from_json(data.get("usage"))

    async def complete(self, model, messages, *, timeout, max_tokens, temperature):
        msg, usage = await self._post_message(
            model,
            messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
            tools=None,
            tool_choice=None,
        )
        return msg.get("content") or "", usage

    async def complete_tools(self, model, messages, *, tools, timeout, max_tokens, temperature):
        """带 OpenAI tools 表的完成：返回 (message dict 原样含 tool_calls, usage)。"""
        return await self._post_message(
            model,
            messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
            tools=tools,
            tool_choice="auto",
        )

    async def stream(self, model, messages, *, timeout, max_tokens, temperature):
        usage = Usage()
        try:
            async with self._client.stream(
                "POST",
                "/v1/chat/completions",
                json=self._body(model, messages, max_tokens=max_tokens, temperature=temperature, stream=True),
                timeout=httpx.Timeout(timeout, connect=CONNECT_TIMEOUT),
            ) as r:
                if r.status_code >= 400:
                    await r.aread()
                    r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except ValueError as e:
                        raise AiError("format", f"SSE 块非 JSON：{payload[:80]}") from e
                    if chunk.get("usage"):
                        usage = Usage.from_json(chunk["usage"])
                    for ch in chunk.get("choices") or []:
                        delta = (ch.get("delta") or {}).get("content")
                        if delta:
                            yield delta
        except httpx.HTTPError as e:
            raise _http_error(e) from e
        yield usage

    async def list_models(self):
        try:
            r = await self._client.get("/v1/models", timeout=httpx.Timeout(PROBE_TIMEOUT, connect=PROBE_TIMEOUT))
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise _http_error(e) from e
        except ValueError as e:
            raise AiError("format", f"/v1/models 返回非 JSON：{e}") from e
        items = data.get("data") if isinstance(data, dict) else data
        return [m["id"] for m in items or [] if isinstance(m, dict) and m.get("id")]


def usage_record(
    *,
    pid: str | None,
    purpose: str,
    kind: str,
    model: str,
    requested_model: str,
    fallback: bool,
    stream: bool,
    usage: Usage,
    ms: int,
    ok: bool,
    error: str | None = None,
    job_id: str | None = None,
    user: str | None = None,
) -> dict:
    """§2.4 一行的字段全集；append_usage 负责落盘。"""
    return {
        "ts": time.time(),
        "pid": pid,
        "purpose": purpose,
        "kind": kind,
        "model": model,
        "requested_model": requested_model,
        "fallback": fallback,
        "stream": stream,
        **asdict(usage),
        "ms": ms,
        "ok": ok,
        "error": error,
        "job_id": job_id,
        "user": user,
    }


def append_usage(project_dir: str, record: dict) -> None:
    path = os.path.join(project_dir, USAGE_FILE)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_usage(project_dir: str) -> list[dict]:
    path = os.path.join(project_dir, USAGE_FILE)
    if not os.path.isfile(path):
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class ChatStream:
    """chat(stream=True) 的返回：逐 delta 迭代；流正常结束后 .result 可读（模型 / usage / fallback / 拼接全文）。"""

    def __init__(self, agen):
        self._agen = agen
        self.result: ChatResult | None = None

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        return await self._agen.__anext__()

    async def aclose(self):
        await self._agen.aclose()


class AiClient:
    def __init__(self, provider: Provider):
        self.provider = provider
        self.last_usage: Usage | None = None

    @property
    def key_present(self) -> bool:
        return self.provider.name == "mock" or bool(getattr(self.provider, "key", ""))

    def _chain(self, purpose: Purpose) -> list[str]:
        primary = MODELS[purpose]
        return [primary, primary, MODELS["fallback"]]

    @staticmethod
    def _skip_retry(e: AiError) -> bool:
        return not e.retryable or e.kind == "timeout"

    @staticmethod
    async def _backoff(attempt: int) -> None:
        """同一模型重试前等待 BACKOFF_S · 2^attempt（链上只重试 1 次 ⇒ 实际只等一次）。"""
        if BACKOFF_S > 0:
            await asyncio.sleep(BACKOFF_S * (2**attempt))

    def _record(self, project_dir, **kw):
        if project_dir:
            append_usage(project_dir, usage_record(**kw))

    async def chat(
        self,
        messages: list[dict],
        purpose: Purpose,
        *,
        stream: bool = False,
        project_dir: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.0,
        job_id: str | None = None,
        user: str | None = None,
    ):
        """async with _SEM → 主模型 → 重试 1 次（仅 retryable）→ swe-2-high → AiError。
        stream=False 返回 ChatResult；stream=True 返回 ChatStream（AsyncIterator[str]，全程持有 _SEM）。"""
        if not self.key_present:
            raise AiError("no_key", "未配置 PATENT_STUDIO_AI_KEY，无法调用 AI 中转站", 503)
        if stream:
            cs = ChatStream(None)
            cs._agen = self._stream(cs, messages, purpose, project_dir, max_tokens, temperature, job_id, user)
            return cs
        return await self._complete(messages, purpose, project_dir, max_tokens, temperature, job_id, user)

    def _meta(self, messages, purpose, project_dir, stream, job_id, user):
        return {
            "pid": os.path.basename(project_dir) if project_dir else None,
            "purpose": purpose,
            "kind": prompts.kind_of(messages) or "chat",
            "requested_model": MODELS[purpose],
            "stream": stream,
            "job_id": job_id,
            "user": user,
        }

    async def _complete(self, messages, purpose, project_dir, max_tokens, temperature, job_id, user) -> ChatResult:
        meta = self._meta(messages, purpose, project_dir, False, job_id, user)
        timeout = TIMEOUTS[purpose]
        async with _SEM:
            last: AiError | None = None
            skip_retry = False
            retries = 0
            for model in self._chain(purpose):
                fallback = model == MODELS["fallback"]
                if skip_retry and not fallback:
                    continue
                if last is not None and not fallback:
                    await self._backoff(retries)
                    retries += 1
                t0 = time.monotonic()
                try:
                    text, usage = await self.provider.complete(
                        model, messages, timeout=timeout, max_tokens=max_tokens, temperature=temperature
                    )
                except AiError as e:
                    ms = int((time.monotonic() - t0) * 1000)
                    self._record(
                        project_dir,
                        model=model,
                        fallback=fallback,
                        usage=Usage(),
                        ms=ms,
                        ok=False,
                        error=f"{e.kind}: {e}",
                        **meta,
                    )
                    last = e
                    skip_retry = self._skip_retry(e)
                    continue
                ms = int((time.monotonic() - t0) * 1000)
                self.last_usage = usage
                self._record(project_dir, model=model, fallback=fallback, usage=usage, ms=ms, ok=True, **meta)
                return ChatResult(text=text, model=model, usage=usage, ms=ms, fallback=fallback)
            assert last is not None
            raise last

    async def _stream(self, cs: ChatStream, messages, purpose, project_dir, max_tokens, temperature, job_id, user):
        meta = self._meta(messages, purpose, project_dir, True, job_id, user)
        timeout = TIMEOUTS[purpose]
        async with _SEM:
            last: AiError | None = None
            skip_retry = False
            retries = 0
            for model in self._chain(purpose):
                fallback = model == MODELS["fallback"]
                if skip_retry and not fallback:
                    continue
                if last is not None and not fallback:
                    await self._backoff(retries)
                    retries += 1
                t0 = time.monotonic()
                parts: list[str] = []
                usage = Usage()
                started = False
                try:
                    async for item in self.provider.stream(
                        model, messages, timeout=timeout, max_tokens=max_tokens, temperature=temperature
                    ):
                        if isinstance(item, Usage):
                            usage = item
                            continue
                        started = True
                        parts.append(item)
                        yield item
                except AiError as e:
                    ms = int((time.monotonic() - t0) * 1000)
                    self._record(
                        project_dir,
                        model=model,
                        fallback=fallback,
                        usage=Usage(),
                        ms=ms,
                        ok=False,
                        error=f"{e.kind}: {e}",
                        **meta,
                    )
                    if started:
                        raise
                    last = e
                    skip_retry = self._skip_retry(e)
                    continue
                ms = int((time.monotonic() - t0) * 1000)
                self.last_usage = usage
                self._record(project_dir, model=model, fallback=fallback, usage=usage, ms=ms, ok=True, **meta)
                cs.result = ChatResult(text="".join(parts), model=model, usage=usage, ms=ms, fallback=fallback)
                return
            assert last is not None
            raise last

    async def chat_tools(
        self,
        messages: list[dict],
        purpose: Purpose,
        tools: list[dict],
        *,
        project_dir: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.0,
        user: str | None = None,
    ) -> "ToolResult":
        """tool-loop 单轮：与 _complete 同链（主模型→重试→fallback），返回 assistant message 原样
        （content + 可选 tool_calls）。provider 不支持 tools（如 mock）⇒ 退化为纯文本轮。"""
        fn = getattr(self.provider, "complete_tools", None)
        if fn is None:
            r = await self.chat(
                messages, purpose, project_dir=project_dir, max_tokens=max_tokens, temperature=temperature, user=user
            )
            return ToolResult(
                message={"role": "assistant", "content": r.text},
                model=r.model,
                usage=r.usage,
                ms=r.ms,
                fallback=r.fallback,
            )
        if not self.key_present:
            raise AiError("no_key", "未配置 PATENT_STUDIO_AI_KEY，无法调用 AI 中转站", 503)
        meta = self._meta(messages, purpose, project_dir, False, None, user)
        timeout = TIMEOUTS[purpose]
        async with _SEM:
            last: AiError | None = None
            skip_retry = False
            retries = 0
            for model in self._chain(purpose):
                fallback = model == MODELS["fallback"]
                if skip_retry and not fallback:
                    continue
                if last is not None and not fallback:
                    await self._backoff(retries)
                    retries += 1
                t0 = time.monotonic()
                try:
                    msg, usage = await fn(
                        model, messages, tools=tools, timeout=timeout, max_tokens=max_tokens, temperature=temperature
                    )
                except AiError as e:
                    ms = int((time.monotonic() - t0) * 1000)
                    self._record(
                        project_dir,
                        model=model,
                        fallback=fallback,
                        usage=Usage(),
                        ms=ms,
                        ok=False,
                        error=f"{e.kind}: {e}",
                        **meta,
                    )
                    last = e
                    skip_retry = self._skip_retry(e)
                    continue
                ms = int((time.monotonic() - t0) * 1000)
                self.last_usage = usage
                self._record(project_dir, model=model, fallback=fallback, usage=usage, ms=ms, ok=True, **meta)
                return ToolResult(message=msg, model=model, usage=usage, ms=ms, fallback=fallback)
            assert last is not None
            raise last

    async def models(self) -> list[str]:
        return await self.provider.list_models()


def from_env() -> AiClient:
    """main.py 启动时按 PATENT_STUDIO_AI_PROVIDER 构造：mock ⇒ AgentMockProvider（MockProvider + 智能体夹具）；
    否则 OpenAICompatProvider(key)。"""
    from app.ai.prompts_agent import AgentMockProvider

    if config.AI_PROVIDER == "mock":
        return AiClient(AgentMockProvider())
    return AiClient(OpenAICompatProvider(config.AI_KEY))
