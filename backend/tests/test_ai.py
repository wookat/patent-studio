# -*- coding: utf-8 -*-
"""E1-ai-client（docs/plan/09 §9 A1–A7）：status / 隐私开关 / 失败链与并发 / chat SSE + 用量 / rewrite CriticMarkup /
review job → 批注 / jobs 落盘与 SSE。全部走 mock 或 FakeProvider / httpx.MockTransport，不出站。
"""
import asyncio
import hashlib
import importlib
import json
import os
import shutil

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import client as client_mod
from app.ai import prompts
from app.ai.client import MODELS, AiClient, AiError, OpenAICompatProvider, Usage
from app.ai.jobs import JobStore
from app.ai.mock import MockProvider
from app.domain import comments as comments_mod
from patent_studio.kernel import critic

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PRIMARY, HEAVY, FALLBACK = MODELS["interactive"], MODELS["heavy"], MODELS["fallback"]
USAGE_FIELDS = {"ts", "pid", "purpose", "kind", "model", "requested_model", "fallback", "stream", "prompt_tokens",
                "completion_tokens", "total_tokens", "ms", "ok", "error", "job_id", "user"}


def _md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def _sse_events(resp):
    out = []
    for line in resp.iter_lines():
        if line.startswith("data:"):
            out.append(json.loads(line[5:].strip()))
    return out


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.setenv("PATENT_STUDIO_AI_PROVIDER", "mock")
    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    for m in (config, projects_mod, build, xml_export, main):
        importlib.reload(m)
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    return main.app, projects


@pytest.fixture()
def client(app_env):
    app, projects = app_env
    with TestClient(app) as c:
        yield c, projects, app


def _enable(c):
    s = c.get("/api/projects/method/settings").json()["settings"]
    assert c.put("/api/projects/method/settings", json={**s, "ai_enabled": True}).status_code == 200


class FakeProvider:
    """按 script[model] 的脚本依次返回：AiError 实例 ⇒ 抛出；str ⇒ 成功文本。记录调用顺序与并发峰值。"""

    name = "fake"
    key = "k"

    def __init__(self, script: dict[str, list], delay: float = 0.0):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[str] = []
        self.delay = delay
        self.active = 0
        self.peak = 0

    async def _next(self, model):
        self.calls.append(model)
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            step = self.script[model].pop(0) if self.script.get(model) else "ok"
            if isinstance(step, AiError):
                raise step
            return step
        finally:
            self.active -= 1

    async def complete(self, model, messages, *, timeout, max_tokens=None, temperature=0.0):
        text = await self._next(model)
        return text, Usage(1, 2, 3)

    async def stream(self, model, messages, *, timeout, max_tokens=None, temperature=0.0):
        text = await self._next(model)
        for ch in text:
            yield ch
        yield Usage(1, 2, 3)

    async def list_models(self):
        return [PRIMARY, HEAVY, FALLBACK]


def _timeout():
    return AiError("timeout", "读超时", 504, retryable=True)


def _bad_request():
    return AiError("upstream", "400 bad request", 502, retryable=False)


MSGS = [{"role": "user", "content": "你好"}]


# ---------------- A1 status ----------------

def test_status_mock_and_probe(client):
    c, _, _ = client
    s = c.get("/api/ai/status").json()
    assert s["provider"] == "mock" and s["key_present"] is True and s["reachable"] is None
    assert s["models"] == {"interactive": PRIMARY, "heavy": HEAVY, "fallback": FALLBACK}
    assert s["org_ai_enabled"] is True
    p = c.get("/api/ai/status?probe=1").json()
    assert p["reachable"] is True and p["error"] is None and p["checked_at"] is not None


def test_status_reflects_org_ai_disabled(client):
    """R60-01：机构 ai_enabled=false 由 /ai/status 主动透出——面板不再只能等写路径 403。"""
    from app.domain.org import apply_settings
    from app.schemas import OrgSettingsPatch

    c, projects, _ = client
    apply_settings(OrgSettingsPatch(ai_enabled=False), str(projects))
    assert c.get("/api/ai/status").json()["org_ai_enabled"] is False
    assert c.get("/api/ai/status?probe=1").json()["org_ai_enabled"] is False


def test_status_no_key(client):
    c, _, app = client
    app.state.ai = AiClient(OpenAICompatProvider(""))
    s = c.get("/api/ai/status").json()
    assert s["provider"] == "aicdks" and s["key_present"] is False
    p = c.get("/api/ai/status?probe=1").json()
    assert p["reachable"] is False and "PATENT_STUDIO_AI_KEY" in p["error"]
    # 无 key 的项目路由：开关打开也不出站，503 ai_no_key
    _enable(c)
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 9, "action": "polish"})
    assert r.status_code == 503 and r.json()["detail"]["kind"] == "ai_no_key"


def test_status_probe_missing_model(client):
    c, _, app = client

    class P(MockProvider):
        async def list_models(self):
            return [PRIMARY]

    app.state.ai = AiClient(P())
    p = c.get("/api/ai/status?probe=1").json()
    assert p["reachable"] is False and HEAVY in p["error"] and FALLBACK in p["error"]


# ---------------- A2 隐私开关 ----------------

def test_disabled_403_zero_calls(client):
    c, _, app = client
    mp = app.state.ai.provider
    assert isinstance(mp, MockProvider)
    for url, body in (
        ("/api/projects/method/ai/chat", {"messages": MSGS}),
        ("/api/projects/method/ai/rewrite", {"book": "claims", "line_start": 9, "line_end": 9, "action": "polish"}),
        ("/api/projects/method/ai/review", {}),
    ):
        r = c.post(url, json=body)
        assert r.status_code == 403, url
        d = r.json()["detail"]
        assert d["kind"] == "ai_disabled" and "AI" in d["message"] and d["detail"] == "E1-ai-client"
    assert mp.calls == []
    assert not os.path.isfile(os.path.join(str(client[1]), "method", ".studio", "ai-usage.jsonl"))


# ---------------- A3 失败链 / 重试 / 并发 ----------------

def test_chain_timeout_goes_straight_to_fallback(tmp_path, monkeypatch):
    """实测：swe-2-medium 读超时后重试同模型只会再超时一次 ⇒ 超时不重试，直接 swe-2-high。"""
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({PRIMARY: [_timeout(), "不应该被调到"], FALLBACK: ["兜底"]})
    r = asyncio.run(AiClient(fp).chat(MSGS, "interactive", project_dir=str(tmp_path)))
    assert r.fallback is True and r.model == FALLBACK and r.text == "兜底"
    assert fp.calls == [PRIMARY, FALLBACK]
    rows = client_mod.read_usage(str(tmp_path))
    assert [(x["model"], x["ok"]) for x in rows] == [(PRIMARY, False), (FALLBACK, True)]
    assert rows[0]["error"].startswith("timeout:") and rows[-1]["fallback"] is True


def test_chain_5xx_retry_once_then_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    err = AiError("upstream", "502 bad gateway", 502, retryable=True)
    fp = FakeProvider({PRIMARY: [err, err], FALLBACK: ["兜底"]})
    r = asyncio.run(AiClient(fp).chat(MSGS, "interactive", project_dir=str(tmp_path)))
    assert r.fallback is True and fp.calls == [PRIMARY, PRIMARY, FALLBACK]


def test_chain_429_backoff_once_then_fallback(tmp_path, monkeypatch):
    """R-AI-08：429 ⇒ 同模型指数退避重试 1 次 ⇒ 仍 429 ⇒ 切 swe-2-high；退避时长与模型顺序都在 mock 中被记录。"""
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    monkeypatch.setattr(client_mod, "BACKOFF_S", 0.01)
    waits: list[int] = []
    real_backoff = AiClient._backoff

    async def spy(attempt):
        waits.append(attempt)
        await real_backoff(attempt)

    monkeypatch.setattr(AiClient, "_backoff", staticmethod(spy))
    err = AiError("upstream", "429 too many requests", 502, retryable=True, upstream_status=429)
    fp = FakeProvider({PRIMARY: [err, err], FALLBACK: ["兜底"]})
    r = asyncio.run(AiClient(fp).chat(MSGS, "interactive", project_dir=str(tmp_path)))
    assert r.fallback is True and r.model == FALLBACK and r.text == "兜底"
    assert fp.calls == [PRIMARY, PRIMARY, FALLBACK] and waits == [0]
    rows = client_mod.read_usage(str(tmp_path))
    assert [(x["model"], x["ok"], x["fallback"]) for x in rows] == [(PRIMARY, False, False), (PRIMARY, False, False),
                                                                    (FALLBACK, True, True)]
    assert all(x["error"].startswith("upstream: 429") for x in rows[:2])
    assert "claude" not in json.dumps(rows)


def test_openai_compat_429_is_retryable():
    def handler(req: httpx.Request):
        return httpx.Response(429, json={"error": "rate limited"})

    p = _provider(handler)

    async def run():
        try:
            await p.complete(PRIMARY, MSGS, timeout=1.0, max_tokens=None, temperature=0.0)
        except AiError as e:
            return e
        raise AssertionError("应抛 AiError")

    e = asyncio.run(run())
    assert e.retryable is True and e.upstream_status == 429 and e.kind == "upstream"


def test_env_timeout_override(monkeypatch):
    assert client_mod._env_timeout("PS_T_X", 30.0) == 30.0
    monkeypatch.setenv("PS_T_X", "45")
    assert client_mod._env_timeout("PS_T_X", 30.0) == 45.0
    monkeypatch.setenv("PS_T_X", "abc")
    assert client_mod._env_timeout("PS_T_X", 30.0) == 30.0
    monkeypatch.setenv("PS_T_X", "0")
    assert client_mod._env_timeout("PS_T_X", 30.0) == 30.0


def test_chain_4xx_no_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({PRIMARY: [_bad_request()], FALLBACK: ["兜底"]})
    r = asyncio.run(AiClient(fp).chat(MSGS, "interactive"))
    assert fp.calls == [PRIMARY, FALLBACK] and r.fallback is True


def test_chain_fallback_fails_raises(monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({HEAVY: [_timeout()], FALLBACK: [_bad_request()]})
    with pytest.raises(AiError) as ei:
        asyncio.run(AiClient(fp).chat(MSGS, "heavy"))
    assert ei.value.kind == "upstream" and fp.calls == [HEAVY, FALLBACK]


def test_primary_ok_no_extra_calls(monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({PRIMARY: ["首发成功"]})
    r = asyncio.run(AiClient(fp).chat(MSGS, "interactive"))
    assert r.fallback is False and r.model == PRIMARY and fp.calls == [PRIMARY]


def test_semaphore_peak_two(monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({}, delay=0.02)
    ai = AiClient(fp)

    async def run():
        await asyncio.gather(*(ai.chat(MSGS, "interactive") for _ in range(4)))

    asyncio.run(run())
    assert len(fp.calls) == 4 and fp.peak <= 2


def test_stream_holds_semaphore_until_end(monkeypatch):
    sem = asyncio.Semaphore(2)
    monkeypatch.setattr(client_mod, "_SEM", sem)
    ai = AiClient(FakeProvider({PRIMARY: ["abc"]}))

    async def run():
        st = await ai.chat(MSGS, "interactive", stream=True)
        first = await st.__anext__()
        assert first == "a" and sem._value == 1  # 首 token 到达后仍持有
        rest = [x async for x in st]
        assert rest == ["b", "c"] and sem._value == 2
        assert st.result.text == "abc" and st.result.fallback is False

    asyncio.run(run())


def test_stream_fallback_before_first_token(monkeypatch):
    monkeypatch.setattr(client_mod, "_SEM", asyncio.Semaphore(2))
    fp = FakeProvider({PRIMARY: [_timeout()], FALLBACK: ["xy"]})
    ai = AiClient(fp)

    async def run():
        st = await ai.chat(MSGS, "interactive", stream=True)
        return "".join([x async for x in st]), st.result

    text, res = asyncio.run(run())
    assert text == "xy" and res.fallback is True and fp.calls == [PRIMARY, FALLBACK]


# ---------------- OpenAICompatProvider（httpx.MockTransport，不出站） ----------------

def _provider(handler):
    p = OpenAICompatProvider("sk-test", "https://ai.example")
    p._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://ai.example",
                                  headers={"Authorization": "Bearer sk-test"})
    return p


def test_openai_compat_complete_and_models():
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers["authorization"]
        if req.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": PRIMARY}, {"id": HEAVY}, {"id": FALLBACK}]})
        body = json.loads(req.content)
        seen["body"] = body
        return httpx.Response(200, json={"choices": [{"message": {"content": "答复"}}],
                                         "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}})

    p = _provider(handler)

    async def run():
        text, usage = await p.complete(PRIMARY, MSGS, timeout=30, max_tokens=None, temperature=0.0)
        return text, usage, await p.list_models()

    text, usage, models = asyncio.run(run())
    assert text == "答复" and usage == Usage(5, 7, 12) and set(models) == {PRIMARY, HEAVY, FALLBACK}
    assert seen["auth"] == "Bearer sk-test" and seen["body"]["model"] == PRIMARY and seen["body"]["stream"] is False


def test_openai_compat_stream_sse_with_usage():
    def handler(req: httpx.Request):
        body = json.loads(req.content)
        assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
        chunks = [
            {"choices": [{"delta": {"role": "assistant", "content": ""}}]},
            {"choices": [{"delta": {"content": "你"}}]},
            {"choices": [{"delta": {"content": "好"}}]},
            {"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}},
        ]
        sse = "".join(f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        return httpx.Response(200, content=sse.encode("utf-8"), headers={"content-type": "text/event-stream"})

    p = _provider(handler)

    async def run():
        return [x async for x in p.stream(PRIMARY, MSGS, timeout=30, max_tokens=None, temperature=0.0)]

    items = asyncio.run(run())
    assert items[:-1] == ["你", "好"] and items[-1] == Usage(3, 2, 5)


def test_openai_compat_errors_retryable_flags():
    codes = iter([503, 401])

    def handler(req: httpx.Request):
        return httpx.Response(next(codes), json={"error": "x"})

    p = _provider(handler)

    async def run():
        out = []
        for _ in range(2):
            try:
                await p.complete(PRIMARY, MSGS, timeout=30, max_tokens=None, temperature=0.0)
            except AiError as e:
                out.append((e.kind, e.retryable))
        return out

    assert asyncio.run(run()) == [("upstream", True), ("upstream", False)]

    def slow(req: httpx.Request):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(AiError) as ei:
        asyncio.run(_provider(slow).complete(PRIMARY, MSGS, timeout=1, max_tokens=None, temperature=0.0))
    assert ei.value.kind == "timeout" and ei.value.retryable and ei.value.status == 504


# ---------------- A4 chat SSE + 用量 ----------------

def test_chat_sse_delta_done_usage_jsonl(client):
    c, projects, app = client
    _enable(c)
    mp = app.state.ai.provider
    with c.stream("POST", "/api/projects/method/ai/chat",
                  json={"messages": MSGS, "context": {"book": "claims", "line_start": 9, "line_end": 9,
                                                      "include_preflight": True}}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        events = _sse_events(r)
    deltas = "".join(e["delta"] for e in events if "delta" in e)
    with open(os.path.join(ROOT, "backend", "app", "ai", "fixtures", "chat.txt"), encoding="utf-8") as f:
        assert deltas == f.read()
    done = events[-1]
    assert done["done"] is True and done["model"] == PRIMARY and done["fallback"] is False
    assert set(done["usage"]) == {"prompt_tokens", "completion_tokens", "total_tokens"}
    assert done["usage"]["total_tokens"] > 0
    assert [e for e in events if "usage" in e and "done" not in e]
    # 提示词只有后端一份：system 首行标签 + 案卷上下文（当前书 / 选区 / 体检）
    assert mp.calls == [{"model": PRIMARY, "stream": True, "kind": "chat"}]
    rows = client_mod.read_usage(str(projects / "method"))
    assert len(rows) == 1 and set(rows[0]) == USAGE_FIELDS
    row = rows[0]
    assert row["pid"] == "method" and row["purpose"] == "interactive" and row["kind"] == "chat"
    assert row["stream"] is True and row["ok"] is True and row["error"] is None and row["model"] == PRIMARY
    assert row["total_tokens"] == done["usage"]["total_tokens"] and row["ms"] >= 0
    usage = c.get("/api/projects/method/ai/usage").json()
    assert usage["total"]["requests"] == 1 and len(usage["rows"]) == 1


def test_chat_sse_error_event(client):
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(FakeProvider({PRIMARY: [_timeout(), _timeout()], FALLBACK: [_bad_request()]}))
    with c.stream("POST", "/api/projects/method/ai/chat", json={"messages": MSGS}) as r:
        events = _sse_events(r)
    assert len(events) == 1 and events[0]["error"]["kind"] == "ai_upstream"


# ---------------- A5 rewrite ----------------

def _line(projects, no):
    with open(projects / "method" / "content.md", encoding="utf-8") as f:
        return f.read().split("\n")[no - 1]


def test_rewrite_returns_whole_line_critic(client):
    c, projects, app = client
    _enable(c)
    orig = _line(projects, 9)  # 权利要求 1 首行
    assert orig.startswith("1.")
    new = orig.replace("一种", "一种用于", 1)
    app.state.ai = AiClient(MockProvider({"rewrite": f"{{~~{orig}~>{new}~~}}"}))
    before = _md5(projects / "method" / "content.md")
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 9, "action": "formalize"})
    assert r.status_code == 200, r.text
    d = r.json()
    out = d["critic_markdown"]
    marks = critic.parse(out)
    assert marks and marks[0]["kind"] == "sub"
    assert critic.reject(out) == orig and critic.accept(out) == new
    assert d["changed_lines"] == [9] and d["line_start"] == 9 and d["line_end"] == 9
    assert d["model"] == PRIMARY and d["fallback"] is False and d["usage"]["total_tokens"] > 0
    assert _md5(projects / "method" / "content.md") == before  # 不落盘
    assert app.state.ai.provider.calls[0]["kind"] == "rewrite"


def test_rewrite_plain_output_wrapped_as_substitution(client):
    """模型没打标记只给了改写后的整行 ⇒ 后端包成 {~~原~>新~~}，仍由用户接受/拒绝。"""
    c, projects, app = client
    _enable(c)
    o1, o2 = _line(projects, 9), _line(projects, 10)
    app.state.ai = AiClient(MockProvider({"rewrite": f"改写后的第一行\n{o2}"}))
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 10, "action": "polish"})
    assert r.status_code == 200
    d = r.json()
    lines = d["critic_markdown"].split("\n")
    assert len(lines) == 2 and lines[1] == o2 and lines[0] == f"{{~~{o1}~>改写后的第一行~~}}"
    assert critic.reject(d["critic_markdown"]) == f"{o1}\n{o2}" and d["changed_lines"] == [9]


def test_rewrite_line_count_mismatch_retry_then_502(client):
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(MockProvider({"rewrite": "行一\n行二\n行三"}))
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 9, "action": "polish"})
    assert r.status_code == 502 and r.json()["detail"]["kind"] == "ai_format"
    assert len(app.state.ai.provider.calls) == 2  # 纠正一轮后放弃


def test_rewrite_explain_and_validation(client):
    c, _, _ = client
    _enable(c)
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 9, "action": "explain"})
    assert r.status_code == 200 and r.json()["explanation"] and "critic_markdown" not in r.json()
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 9, "line_end": 9, "action": "nope"})
    assert r.status_code == 422
    r = c.post("/api/projects/method/ai/rewrite",
               json={"book": "claims", "line_start": 0, "line_end": 9, "action": "polish"})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "content"


# ---------------- A6 review job → 批注 ----------------

def _wait_final(c, job_id):
    with c.stream("GET", f"/api/ai/jobs/{job_id}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = _sse_events(r)
    assert events and events[-1]["status"] in ("done", "error", "interrupted")
    return events


def test_review_job_creates_ai_comments(client):
    c, projects, app = client
    _enable(c)
    # 按批剧本：claims 一批 → 一条有效 + 一条非法锚点；description 首批 → 一条有效；其余批 → 空
    scripted = [
        {"items": [
            {"rule": "A26.4", "severity": "warning", "block_id": "claims/1", "quote": "其特征在于",
             "message": "独立权利要求缺少必要技术特征", "suggestion": "补充成熟反馈队列的判定条件"},
            {"rule": "term", "severity": "error", "block_id": "description/不存在/p9999", "message": "非法锚点"},
        ]},
        {"items": [
            {"rule": "clarity", "severity": "info", "block_id": "description/技术领域/p0001", "quote": "",
             "message": "技术领域表述可更聚焦", "suggestion": None},
        ]},
    ]

    class Scripted(MockProvider):
        def _text(self, messages):
            i = len(self.calls)
            return json.dumps(scripted[i] if i < len(scripted) else {"items": []}, ensure_ascii=False)

    app.state.ai = AiClient(Scripted())
    before = _md5(projects / "method" / "content.md")
    r = c.post("/api/projects/method/ai/review", json={"scope": "all"})
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["kind"] == "review" and job["pid"] == "method" and job["status"] in ("queued", "running")
    events = _wait_final(c, job["id"])
    final = events[-1]
    assert final["status"] == "done", final
    assert final["progress"] == 1.0 and final["result"]["dropped"] == 1, final["result"]
    assert final["result"]["counts"] == {"error": 0, "warning": 1, "info": 1}
    assert len(final["result"]["comment_ids"]) == 2
    got = c.get(f"/api/ai/jobs/{job['id']}").json()
    assert got["status"] == "done"
    comments = comments_mod.load(str(projects / "method"))
    assert len(comments) == 2 and all(cm.author.id == "ai" and cm.author.name == "AI 审阅" for cm in comments)
    by_block = {cm.anchor.block_id: cm for cm in comments}
    assert set(by_block) == {"claims/1", "description/技术领域/p0001"}
    assert by_block["claims/1"].body.startswith("【A26.4 支持性】") and "建议：" in by_block["claims/1"].body
    assert by_block["claims/1"].anchor.line >= 9 and by_block["claims/1"].anchor.quote == "其特征在于"
    assert _md5(projects / "method" / "content.md") == before
    # 走 comments 路由能读到（重锚不报错）
    listed = c.get("/api/projects/method/comments").json()
    assert {x["author"]["id"] for x in listed} == {"ai"}
    # 按书分批：claims 1 批 + description ⌈块数/60⌉ 批，全走 heavy，每批一行用量带 job_id
    calls = app.state.ai.provider.calls
    assert len(calls) >= 2 and all(x["model"] == HEAVY and x["kind"] == "review" for x in calls)
    rows = client_mod.read_usage(str(projects / "method"))
    assert len(rows) == len(calls) and all(x["job_id"] == job["id"] and x["purpose"] == "heavy" for x in rows)
    assert [j["id"] for j in c.get("/api/projects/method/ai/jobs").json()["jobs"]] == [job["id"]]


def test_review_bad_json_becomes_error_job(client):
    c, _, app = client
    _enable(c)
    app.state.ai = AiClient(MockProvider({"review": "这不是 JSON"}))
    r = c.post("/api/projects/method/ai/review", json={"scope": "claims"})
    assert r.status_code == 202
    final = _wait_final(c, r.json()["id"])[-1]
    assert final["status"] == "error" and final["error"]["kind"] == "ai_format"
    assert len(app.state.ai.provider.calls) == 2  # 纠正一轮


def test_review_busy_409_and_scope_422(client):
    c, _, app = client
    _enable(c)
    app.state.jobs.create("review", "method")  # queued ⇒ busy
    r = c.post("/api/projects/method/ai/review", json={})
    assert r.status_code == 409 and r.json()["detail"]["kind"] == "job_busy"
    assert c.post("/api/projects/method/ai/review", json={"scope": "nope"}).status_code == 422


# ---------------- A7 jobs ----------------

def test_jobstore_run_watch_cancel(tmp_path):
    (tmp_path / "p").mkdir()

    async def run():
        js = JobStore(str(tmp_path))
        job = js.create("review", "p")
        gate = asyncio.Event()

        async def work():
            js.progress(job.id, 0.5, "半程")
            await gate.wait()
            return {"n": 1}

        async def watch():
            return [j.status for j in [x async for x in js.watch(job.id)]]

        js.run(job, work)
        w = asyncio.create_task(watch())
        await asyncio.sleep(0.01)
        gate.set()
        statuses = await w
        assert statuses[-1] == "done" and "running" in statuses
        done = js.get(job.id)
        assert done.result == {"n": 1} and done.progress == 1.0

        # 异常 ⇒ error（internal）
        j2 = js.create("convert", "p")

        async def boom():
            raise RuntimeError("炸")

        await js.run(j2, boom)
        assert js.get(j2.id).status == "error" and js.get(j2.id).error["kind"] == "internal"

        # AiError ⇒ error ai_<kind>
        j3 = js.create("oa_answer", "p")

        async def ai_boom():
            raise AiError("timeout", "超时", 504)

        await js.run(j3, ai_boom)
        assert js.get(j3.id).error["kind"] == "ai_timeout"

        # cancel ⇒ interrupted，watch 收尾
        j4 = js.create("review", "p")

        async def forever():
            await asyncio.sleep(60)

        t = js.run(j4, forever)
        await asyncio.sleep(0)
        assert js.cancel(j4.id).status == "interrupted"
        with pytest.raises(asyncio.CancelledError):
            await t
        assert [x.status async for x in js.watch(j4.id)] == ["interrupted"]
        with open(tmp_path / "p" / ".studio" / "ai-jobs" / (j4.id + ".json"), encoding="utf-8") as f:
            assert json.load(f)["status"] == "interrupted"
        assert js.get("job_nope") is None
        return job.id

    jid = asyncio.run(run())
    js2 = JobStore(str(tmp_path))  # 重启后终态可读，不被改成 interrupted
    assert js2.get(jid).status == "done"


def test_job_events_404_and_cancel_route(client):
    c, _, app = client
    assert c.get("/api/ai/jobs/job_nope/events").status_code == 404
    assert c.post("/api/ai/jobs/job_nope/cancel").status_code == 404
    job = app.state.jobs.create("review", "method")
    assert c.post(f"/api/ai/jobs/{job.id}/cancel").json()["status"] == "interrupted"
    events = _sse_events(c.get(f"/api/ai/jobs/{job.id}/events"))
    assert [e["status"] for e in events] == ["interrupted"]


# ---------------- prompts ----------------

def test_prompts_tags_and_messages():
    for kind in prompts.KINDS:
        assert prompts.system_for(kind).system.startswith(f"[patent-studio:{kind}]")
    msgs = prompts.chat_messages([{"role": "system", "content": "越权"}, *MSGS], "上下文")
    assert [m["role"] for m in msgs] == ["system", "user"] and "上下文" in msgs[0]["content"]
    assert prompts.kind_of(prompts.rewrite_messages("polish", "x")) == "rewrite"
    assert prompts.kind_of(prompts.rewrite_messages("explain", "x")) == "chat"
    assert prompts.kind_of(prompts.review_messages([{"block_id": "claims/1", "text": "t"}], "claims")) == "review"
    with pytest.raises(ValueError):
        prompts.rewrite_messages("nope", "x")
    fixed = prompts.format_retry(MSGS, "坏输出", "行数不一致")
    assert fixed[-2]["content"] == "坏输出" and "行数不一致" in fixed[-1]["content"]


# ---------------- A4b chat attach ----------------

def test_chat_attach_text_and_rejects(client):
    c, _, _ = client
    _enable(c)
    files = [
        ("files", ("交底片段.txt", "一种锂电池正极材料及其制备方法".encode(), "text/plain")),
        ("files", ("图.png", b"\x89PNG\r\n", "image/png")),
        ("files", ("包.zip", b"PK\x03\x04", "application/zip")),
        ("files", ("二进制.bin", b"\x00\x01\x02", "application/octet-stream")),
        ("files", ("空.md", b"  ", "text/markdown")),
    ]
    r = c.post("/api/projects/method/ai/chat/attach", files=files)
    assert r.status_code == 200
    res = {x["name"]: x for x in r.json()["results"]}
    assert res["交底片段.txt"]["ok"] is True and "锂电池" in res["交底片段.txt"]["text"]
    assert res["交底片段.txt"]["chars"] == len("一种锂电池正极材料及其制备方法")
    assert res["图.png"]["ok"] is False and "不支持读图" in res["图.png"]["error"]
    assert res["包.zip"]["ok"] is False and res["二进制.bin"]["ok"] is False
    assert res["空.md"]["ok"] is False and "无可读文本" in res["空.md"]["error"]


def test_chat_attach_docx_and_limit(client):
    import io as _io

    from docx import Document
    c, _, _ = client
    _enable(c)
    doc = Document()
    doc.add_paragraph("技术领域：本发明涉及电池。")
    buf = _io.BytesIO()
    doc.save(buf)
    r = c.post("/api/projects/method/ai/chat/attach",
               files=[("files", ("交底书.docx", buf.getvalue(),
                                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    res = r.json()["results"][0]
    assert res["ok"] is True and "电池" in res["text"]
    # >8 文件 422
    many = [("files", (f"f{i}.txt", b"x", "text/plain")) for i in range(9)]
    assert c.post("/api/projects/method/ai/chat/attach", files=many).status_code == 422
    # ai_enabled=false → 403
    s = c.get("/api/projects/method/settings").json()["settings"]
    c.put("/api/projects/method/settings", json={**s, "ai_enabled": False})
    r = c.post("/api/projects/method/ai/chat/attach", files=[("files", ("a.txt", b"x", "text/plain"))])
    assert r.status_code == 403


def test_chat_context_attachments(app_env):
    from app.domain.projects import ProjectStore
    from app.routes import ai as routes_ai
    _app, projects = app_env
    store = ProjectStore(str(projects))
    p = store.get("method")
    content = store.read_content("method")
    text, _ = routes_ai._chat_context(
        p, content,
        {"attachments": [{"name": "交底书.docx", "text": "发明点：固态电解质"},
                          {"name": "无文本", "text": ""}, "非dict"]},
        store, "method")
    assert "《交底书.docx》" in text and "固态电解质" in text and "无文本" not in text
