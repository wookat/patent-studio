# -*- coding: utf-8 -*-
"""AI 路由（docs/plan/09 §3.1，单元 E1-ai-client）。

status（?probe=1 ⇒ GET /v1/models 5 s 核对三模型）；chat SSE（delta/usage/done/error）；rewrite（选区 → 整行
CriticMarkup，不落盘）；review 后台任务（JSON → 批注 author=ai，锚 block_id）；jobs 查询 / SSE / 列表 / 取消；usage。
所有带 pid 的生成类路由先 ai.require_enabled(store, pid, UNIT)：关闭时 403 ai_disabled 且零上游调用。
"""
import asyncio
import json
import logging
import re
import tempfile
import time
from dataclasses import asdict

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import auth
from app.agent import budget
from app.ai import prompts, require_enabled
from app.ai.client import MODELS, PROBE_TIMEOUT, AiClient, AiError, ChatResult, read_usage
from app.ai.jobs import JobStore
from app.auth import CurrentUser
from app.domain import comments as comments_mod
from app.domain.lint import lint
from app.domain.org import ai_enabled as _org_ai_enabled
from app.domain.org import require_org_ai
from app.domain.projects import ATTACHMENT_MAX_BYTES
from app.errors import error_detail
from app.mcp import tools_semantic
from app.oa.parse import NoTextLayer, pdf_text
from app.routes import read_bounded
from patent_studio.kernel import critic, docx_import
from patent_studio.kernel.ast import AstError, parse_ast

log = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])
UNIT = "E1-ai-client"

BOOKS = ("abstract", "claims", "description")
BOOK_NAMES = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}
CHAT_BOOK_LIMIT = 8000   # 当前书全文 ≤ 8k 字直接给，超出取选区 ±CHAT_AROUND 行
CHAT_AROUND = 60
REVIEW_BATCH = 60        # description 每批块数（claims 全量一批）
CHAT_ATTACH_MAX_FILES = 8     # 单条消息最多附件数
CHAT_ATTACH_TEXT_LIMIT = 24000  # 单附件抽文本上限（超出截断，truncated 标记）
CHAT_ATTACH_IMG_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff"}
CHAT_ATTACH_BIN_EXTS = {"zip", "rar", "7z", "exe", "dll", "so", "bin", "xlsx", "pptx", "doc", "xls", "ppt"}
AI_AUTHOR = comments_mod.Author(id="ai", name="AI 审阅")
RULE_LABELS = {"A26.3": "公开充分", "A26.4": "支持性", "A22.2": "新颖性", "A22.3": "创造性",
               "term": "术语", "support": "支持性", "clarity": "清楚"}
SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


class ChatIn(BaseModel):
    messages: list[dict]
    context: dict | None = None
    agent: bool = True                    # False ⇒ 旧单轮问答（不带工具）
    resume: dict | None = None            # 确认卡回执：{assistant, calls}（首个 call 即被裁决者）
    approved: bool = False                # resume 时该 call 是否被用户批准


class RewriteIn(BaseModel):
    book: str
    line_start: int
    line_end: int
    action: str
    content: str | None = None
    instruction: str | None = None


class ReviewIn(BaseModel):
    scope: str = "all"
    content: str | None = None


def _http(e: AiError) -> HTTPException:
    return HTTPException(e.status, error_detail(f"ai_{e.kind}", str(e), detail=UNIT))


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _who(user) -> str | None:
    return None if user is None else str(user.email)


def _numbered(lines: list[str], start: int, end: int) -> str:
    """全文 1-based 闭区间 [start, end] 带行号文本。"""
    start, end = max(1, start), min(len(lines), end)
    return "\n".join(f"{no}| {lines[no - 1]}" for no in range(start, end + 1))


def _ast_or_none(content: str, settings: dict):
    try:
        return parse_ast(critic.accept(content), settings)
    except AstError:
        return None


def _ast_or_422(content: str, settings: dict):
    try:
        return parse_ast(critic.accept(content), settings)
    except AstError as e:
        raise HTTPException(422, error_detail("content", str(e), line=e.line, detail=UNIT))


def _block_ranges(ast: dict) -> dict[str, tuple[int, int]]:
    """块 id → 全文行闭区间（与 comments.reanchor 同一算法）。"""
    out: dict[str, tuple[int, int]] = {}
    for book, blocks in (("abstract", ast["abstract"]["paragraphs"]), ("claims", ast["claims"]),
                         ("description", ast["description"])):
        off = ast["books"][book]["offset"]
        for b in blocks:
            out[b["id"]] = (off + b["lines"]["start"], off + b["lines"]["end"])
    return out


# ---------------- status ----------------

@router.get("/api/ai/status")
async def ai_status(request: Request, probe: bool = False):
    ai: AiClient = request.app.state.ai
    out = {"provider": ai.provider.name, "key_present": ai.key_present, "models": dict(MODELS),
           "org_ai_enabled": _org_ai_enabled(),
           "reachable": None, "checked_at": None, "error": None}
    if not probe:
        return out
    out["checked_at"] = time.time()
    if not ai.key_present:
        out.update(reachable=False, error="未配置 PATENT_STUDIO_AI_KEY")
        return out
    try:
        listed = await asyncio.wait_for(ai.models(), PROBE_TIMEOUT + 1)
    except AiError as e:
        out.update(reachable=False, error=str(e))
    except TimeoutError:
        out.update(reachable=False, error=f"探测超时（{PROBE_TIMEOUT:.0f} s）")
    else:
        missing = [m for m in MODELS.values() if m not in listed]
        out["reachable"] = not missing
        if missing:
            out["error"] = "中转站模型列表缺少：" + "、".join(missing)
    return out


# ---------------- chat（SSE） ----------------

def _semantic_part(store, pid: str, ctx: dict) -> list[str]:
    """context.terms / checks / claim_tree：true ⇒ 服务端派生（语义工具直接调用）；列表/对象 ⇒ 前端已算好，原样附上。"""
    parts: list[str] = []
    want = {k: ctx.get(k) for k in ("terms", "checks", "claim_tree") if ctx.get(k)}
    if not want:
        return parts
    d = tools_semantic.derive(store, pid) if any(v is True for v in want.values()) else None
    labels = {"terms": "术语表", "checks": "检查结果", "claim_tree": "权项树"}
    for key, val in want.items():
        if val is True:
            if key == "terms":
                val = [t.model_dump() for t in tools_semantic.term_rows(d)]
            elif key == "claim_tree":
                val = [n.model_dump() for n in tools_semantic.claim_tree(d)]
            else:
                val = d.report["items"][:30]
        parts.append(f"{labels[key]}：" + json.dumps(val, ensure_ascii=False, default=str))
    return parts


def _chat_context(p, content: str, ctx: dict | None, store=None, pid: str | None = None) -> tuple[str, bool]:
    """服务端拼装案卷上下文：当前书（≤ 8k 字）或选区 ±60 行；可选体检摘要；前端自带 diagnostics 原样附上；
    可选 terms / checks / claim_tree。最后统一经 budget.clip（交互 8k），返回 (text, truncated)。"""
    ctx = ctx or {}
    lines = content.split("\n")
    parts: list[str] = []
    sel = ctx.get("selection") if isinstance(ctx.get("selection"), dict) else {}
    ls = ctx.get("line_start") or sel.get("line_start")
    le = ctx.get("line_end") or sel.get("line_end")
    book = ctx.get("book")
    ast = _ast_or_none(content, p.settings) if book in BOOKS else None
    if ast is not None:
        off, length = ast["books"][book]["offset"], ast["books"][book]["length"]
        text = _numbered(lines, off + 1, off + length)
        if len(text) <= CHAT_BOOK_LIMIT:
            parts.append(f"当前书：{BOOK_NAMES[book]}（第 {off + 1}–{off + length} 行）\n{text}")
        elif ls:
            a, b = max(1, int(ls) - CHAT_AROUND), min(len(lines), int(le or ls) + CHAT_AROUND)
            parts.append(f"当前书：{BOOK_NAMES[book]}（全文过长，给出选区附近第 {a}–{b} 行）\n{_numbered(lines, a, b)}")
        else:
            parts.append(f"当前书：{BOOK_NAMES[book]}（全文过长，未附）")
    if ls:
        parts.append(f"选区：第 {ls}–{le or ls} 行\n{_numbered(lines, int(ls), int(le or ls))}")
    if ctx.get("include_preflight"):
        rep = lint(critic.accept(content), p.settings, p.figs_dir, with_preflight=True)
        items = [f"L{d.get('line')} [{d['severity']}] {d['message']}" for d in rep["diagnostics"][:30]]
        parts.append("体检摘要：" + json.dumps(rep["counts"], ensure_ascii=False) + "\n" + "\n".join(items))
    diags = ctx.get("diagnostics")
    if isinstance(diags, list) and diags:
        parts.append("前端诊断：\n" + "\n".join(str(d) for d in diags[:30]))
    if store is not None and pid:
        parts.extend(_semantic_part(store, pid, ctx))
    atts = ctx.get("attachments")
    if isinstance(atts, list):
        segs = [f"附件：《{str(a.get('name') or '附件')}》\n{str(a['text'])}" for a in atts[:CHAT_ATTACH_MAX_FILES]
                if isinstance(a, dict) and a.get("text")]
        if segs:
            parts.append("随消息附带的资料：\n" + "\n\n".join(segs))
    return budget.clip("\n\n".join(parts), None)


_CHAT_FILES = File(...)
_ATTACH_LABELS = {"docx": "Word 文档", "pdf": "PDF", "doc": "旧版 Word（.doc）"}


def _attach_one(data: bytes, name: str) -> dict:
    """单附件抽文本：docx → docx_import md（figs 弃置）；pdf → pypdf 文字层；其余按 utf-8 文本解。
    图片直拒——当前路由模型（swe-2）纯文本，不读图；二进制/旧 .doc 如实报错。"""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in CHAT_ATTACH_IMG_EXTS:
        return {"name": name, "ok": False, "error": "当前模型不支持读图（swe-2 纯文本路由）"}
    if ext in CHAT_ATTACH_BIN_EXTS:
        hint = "旧版 .doc 请先另存为 .docx" if ext == "doc" else f"暂不支持 {_ATTACH_LABELS.get(ext, ext)} 附件"
        return {"name": name, "ok": False, "error": hint}
    try:
        if ext == "docx":
            with tempfile.TemporaryDirectory() as td:
                text = docx_import.import_docx(data, td)[0]
        elif ext == "pdf":
            text = pdf_text(data)
        else:
            text = data.decode("utf-8", errors="replace")
            if "\x00" in text:
                return {"name": name, "ok": False, "error": "二进制文件，无法抽文本"}
    except NoTextLayer as e:
        return {"name": name, "ok": False, "error": f"PDF 无文字层（扫描件？）：{e}"}
    except docx_import.DocxImportError as e:
        return {"name": name, "ok": False, "error": f"DOCX 解析失败：{e}"}
    except Exception as e:
        return {"name": name, "ok": False, "error": f"解析失败：{e}"}
    text = text.strip()
    if not text:
        return {"name": name, "ok": False, "error": "文件无可读文本"}
    clipped = text[:CHAT_ATTACH_TEXT_LIMIT]
    return {"name": name, "ok": True, "text": clipped, "chars": len(clipped),
            "truncated": len(text) > CHAT_ATTACH_TEXT_LIMIT or None}


@router.post("/api/projects/{pid}/ai/chat/attach", dependencies=[Depends(require_org_ai)])
async def ai_chat_attach(request: Request, pid: str, user: CurrentUser, files: list[UploadFile] = _CHAT_FILES):
    """对话附件抽文本（不落盘，只随该条消息进 context.attachments）：txt/md/csv 等按 utf-8、docx/pdf 解析、
    图片/二进制如实拒（模型不读图）。files[] ≤ 8、单文件 ≤ 50MB，per-file ok/error 互不妨碍。"""
    store = request.app.state.store
    require_enabled(store, pid, UNIT)
    store.get(pid)
    if not files or len(files) > CHAT_ATTACH_MAX_FILES:
        raise HTTPException(422, error_detail("content", f"附件数 1–{CHAT_ATTACH_MAX_FILES}", detail=UNIT))
    payload = [(f.filename or "", await read_bounded(f, "ai-attach", ATTACHMENT_MAX_BYTES)) for f in files]
    results = await asyncio.gather(*(asyncio.to_thread(_attach_one, d, n) for n, d in payload))
    return {"results": list(results)}


@router.post("/api/projects/{pid}/ai/chat", dependencies=[Depends(require_org_ai)])
async def ai_chat(pid: str, body: ChatIn, request: Request, user: CurrentUser):
    store = request.app.state.store
    ai: AiClient = request.app.state.ai
    require_enabled(store, pid, UNIT)
    p = store.get(pid)
    content = store.read_content(pid)
    context, truncated = _chat_context(p, content, body.context, store, pid)
    if body.agent and getattr(ai.provider, "complete_tools", None) is not None:
        # 网关支持 tools API ⇒ agent 工具循环；不支持（如 mock）⇒ 落旧单轮流式
        from app.agent import chat_engine
        msgs = prompts.chat_messages(body.messages, context + chat_engine.AGENT_SUFFIX)
        if len(msgs) < 2 and not body.resume:
            raise HTTPException(422, error_detail("content", "messages 至少一条 user 消息", detail=UNIT))

        async def agent_gen():
            async for ev in chat_engine.run(ai, p, user, msgs, body.resume, body.approved):
                if "done" in ev:
                    ev["truncated"] = truncated
                yield _sse(ev)
        return StreamingResponse(agent_gen(), media_type="text/event-stream", headers=SSE_HEADERS)

    msgs = prompts.chat_messages(body.messages, context)
    if len(msgs) < 2:
        raise HTTPException(422, error_detail("content", "messages 至少一条 user 消息", detail=UNIT))
    try:
        stream = await ai.chat(msgs, "interactive", stream=True, project_dir=p.dir, user=_who(user))
    except AiError as e:
        raise _http(e)

    async def gen():
        try:
            async for delta in stream:
                yield _sse({"delta": delta})
            r: ChatResult = stream.result
            yield _sse({"usage": asdict(r.usage)})
            yield _sse({"done": True, "model": r.model, "usage": asdict(r.usage), "fallback": r.fallback, "ms": r.ms,
                        "truncated": truncated})
        except AiError as e:
            yield _sse({"error": {"kind": f"ai_{e.kind}", "message": str(e)}})
        finally:
            await stream.aclose()

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


# ---------------- rewrite ----------------

def _as_critic(orig: list[str], out: str) -> str | None:
    """模型输出 → 覆盖整段的 CriticMarkup；行数不同 ⇒ None。
    满足 reject(out)==原文 直接用；否则逐行包成 {~~原行~>模型终稿~~}（模型没打标记时仍走接受/拒绝）。"""
    lines = prompts.strip_fence(out).split("\n")
    while len(lines) > len(orig) and not lines[-1].strip():
        lines.pop()
    if len(lines) != len(orig):
        return None
    if critic.reject("\n".join(lines)) == "\n".join(orig) and not critic.lint_marks("\n".join(lines)):
        return "\n".join(lines)
    fixed = []
    for o, ln in zip(orig, lines):
        final = critic.accept(ln)
        fixed.append(o if final == o else f"{{~~{o}~>{final}~~}}")
    return "\n".join(fixed)


@router.post("/api/projects/{pid}/ai/rewrite", dependencies=[Depends(require_org_ai)])
async def ai_rewrite(pid: str, body: RewriteIn, request: Request, user: CurrentUser):
    store = request.app.state.store
    ai: AiClient = request.app.state.ai
    require_enabled(store, pid, UNIT)
    p = store.get(pid)
    if body.action not in prompts.REWRITE_ACTIONS:
        raise HTTPException(422, error_detail("content", f"未知改写动作：{body.action}", detail=UNIT))
    if body.book not in BOOKS:
        raise HTTPException(422, error_detail("content", f"未知书：{body.book}", detail=UNIT))
    content = body.content if body.content is not None else store.read_content(pid)
    lines = content.split("\n")
    s, e = body.line_start, body.line_end
    if not (1 <= s <= e <= len(lines)):
        raise HTTPException(422, error_detail("content", f"行区间 [{s}, {e}] 超出全文 1–{len(lines)}",
                                              line=s, detail=UNIT))
    orig = lines[s - 1:e]
    ctx = f"当前书：{BOOK_NAMES[body.book]}；选区第 {s}–{e} 行。选区前后文（供理解，不要改写）：\n" + \
        _numbered(lines, s - 20, e + 20)
    msgs = prompts.rewrite_messages(body.action, "\n".join(orig), ctx, body.instruction)
    who = _who(user)
    try:
        r: ChatResult = await ai.chat(msgs, "interactive", project_dir=p.dir, user=who)
        if body.action == "explain":
            return {"explanation": r.text.strip(), "line_start": s, "line_end": e,
                    "model": r.model, "usage": asdict(r.usage), "fallback": r.fallback}
        out = _as_critic(orig, r.text)
        if out is None:
            r = await ai.chat(prompts.format_retry(msgs, r.text, "行数与原文不一致"), "interactive",
                              project_dir=p.dir, user=who)
            out = _as_critic(orig, r.text)
    except AiError as ex:
        raise _http(ex)
    if out is None:
        raise _http(AiError("format", "AI 输出行数与选区不一致，已放弃（未改动源码）"))
    changed = [s + i for i, (o, ln) in enumerate(zip(orig, out.split("\n"))) if o != ln]
    return {"critic_markdown": out, "changed_lines": changed, "line_start": s, "line_end": e,
            "model": r.model, "usage": asdict(r.usage), "fallback": r.fallback}


# ---------------- review（后台任务 → 批注） ----------------

async def _json_call(ai: AiClient, msgs: list[dict], purpose: str, schema: dict | None, **kw) -> dict:
    r: ChatResult = await ai.chat(msgs, purpose, **kw)
    try:
        return prompts.parse_json(r.text, schema)
    except ValueError as e1:
        r = await ai.chat(prompts.format_retry(msgs, r.text, str(e1)), purpose, **kw)
        try:
            return prompts.parse_json(r.text, schema)
        except ValueError as e2:
            raise AiError("format", f"AI 输出不是合规 JSON：{e2}") from e2


def _review_blocks(ast: dict, lines: list[str], scope: str) -> list[list[dict]]:
    """按书分批：claims 全量一批；description 每 REVIEW_BATCH 块一批（只取有正文的块）。"""
    ranges = _block_ranges(ast)

    def text_of(bid: str) -> str:
        a, b = ranges[bid]
        return "\n".join(lines[a - 1:b]).strip()

    batches: list[list[dict]] = []
    if scope in ("all", "claims"):
        claims = [{"block_id": c["id"], "text": text_of(c["id"])} for c in ast["claims"]]
        if claims:
            batches.append(claims)
    if scope in ("all", "description"):
        desc = [{"block_id": b["id"], "text": text_of(b["id"])}
                for b in ast["description"] if b["kind"] in ("paragraph", "table", "equation")]
        for i in range(0, len(desc), REVIEW_BATCH):
            batches.append(desc[i:i + REVIEW_BATCH])
    return batches


def _review_to_comments(items: list, ast: dict, lines: list[str], existing: list) -> dict:
    ranges = _block_ranges(ast)
    ids: list[str] = []
    dropped = 0
    counts = {"error": 0, "warning": 0, "info": 0}
    for it in items:
        if not isinstance(it, dict) or it.get("block_id") not in ranges:
            dropped += 1
            continue
        bid = it["block_id"]
        a, b = ranges[bid]
        sev = it.get("severity") if it.get("severity") in counts else "info"
        rule = str(it.get("rule") or "clarity")
        quote = str(it.get("quote") or "")
        line = a
        if quote:
            hit = next((no for no in range(a, b + 1) if quote in lines[no - 1]), None)
            if hit is None:
                quote = ""
            else:
                line = hit
        body = f"【{rule} {RULE_LABELS.get(rule, '审阅')}】{str(it.get('message') or '').strip()}"
        if it.get("suggestion"):
            body += f"\n建议：{str(it['suggestion']).strip()}"
        c = comments_mod.create(comments_mod.Anchor(block_id=bid, line=line, quote=quote), body, AI_AUTHOR)
        existing.append(c)
        ids.append(c.id)
        counts[sev] += 1
    return {"comment_ids": ids, "dropped": dropped, "counts": counts}


@router.post("/api/projects/{pid}/ai/review", status_code=202, dependencies=[Depends(require_org_ai)])
async def ai_review(pid: str, body: ReviewIn, request: Request, user: CurrentUser):
    store = request.app.state.store
    ai: AiClient = request.app.state.ai
    jobs: JobStore = request.app.state.jobs
    require_enabled(store, pid, UNIT)
    p = store.get(pid)
    scope = body.scope or "all"
    if scope not in ("all", "claims", "description"):
        raise HTTPException(422, error_detail("content", f"未知审阅范围：{scope}", detail=UNIT))
    if jobs.busy(pid, "review"):
        raise HTTPException(409, error_detail("job_busy", "本案已有进行中的 AI 审阅任务", detail=UNIT))
    content = body.content if body.content is not None else store.read_content(pid)
    ast = _ast_or_422(content, p.settings)
    lines = content.split("\n")
    batches = _review_blocks(ast, lines, scope)
    if not batches:
        raise HTTPException(422, error_detail("content", "审阅范围内没有可审阅的块", detail=UNIT))
    job = jobs.create("review", pid)
    who = _who(user)

    async def work() -> dict:
        items: list = []
        n = len(batches)
        for i, batch in enumerate(batches):
            jobs.progress(job.id, 0.05 + 0.8 * i / n, f"审阅第 {i + 1}/{n} 批（{len(batch)} 块）")
            data = await _json_call(ai, prompts.review_messages(batch, scope), "heavy", prompts.SCHEMAS["review"],
                                    project_dir=p.dir, job_id=job.id, user=who)
            got = data.get("items")
            items.extend(got if isinstance(got, list) else [])
        jobs.progress(job.id, 0.9, "写入批注")
        async with comments_mod.ledger_lock(p.dir):
            with comments_mod.file_lock(p.dir):  # R92：跨进程写锁
                existing = comments_mod.load(p.dir)
                result = _review_to_comments(items, ast, lines, existing)
                comments_mod.save(p.dir, existing)
        result["scope"] = scope
        return result

    jobs.run(job, work)
    return job.to_dict()


# ---------------- jobs / usage ----------------

@router.get("/api/projects/{pid}/ai/jobs")
async def ai_jobs(pid: str, request: Request):
    request.app.state.store.get(pid)
    return {"jobs": [j.to_dict() for j in request.app.state.jobs.list(pid)]}


@router.get("/api/projects/{pid}/ai/usage")
async def ai_usage(pid: str, request: Request, limit: int = 200):
    p = request.app.state.store.get(pid)
    rows = read_usage(p.dir)
    total = {"prompt_tokens": sum(int(r.get("prompt_tokens") or 0) for r in rows),
             "completion_tokens": sum(int(r.get("completion_tokens") or 0) for r in rows),
             "requests": len(rows)}
    return {"rows": rows[-max(0, limit):] if limit else [], "total": total, **budget.status(p.dir, p.settings)}


_JOB_ID_RE = re.compile(r"^job_[0-9a-f]{12}$")


async def _job_or_404(request: Request, job_id: str, user, need: str):
    """路径参数是 job_id 不是 pid——project_access 不生效，这里手工校验任务所属案的权限。
    id 先过白名单形态：jobs.get 的 glob 会把 `*`/`?`/`[` 当通配符，不挡就能枚举全站任务。"""
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(404, error_detail("not_found", f"任务不存在：{job_id}", detail=UNIT))
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, error_detail("not_found", f"任务不存在：{job_id}", detail=UNIT))
    await auth.check_access(request, user, job.pid, need)
    return job


@router.get("/api/ai/jobs/{job_id}")
async def ai_job(job_id: str, request: Request, user: CurrentUser):
    return (await _job_or_404(request, job_id, user, "viewer")).to_dict()


@router.post("/api/ai/jobs/{job_id}/cancel")
async def ai_job_cancel(job_id: str, request: Request, user: CurrentUser):
    job = await _job_or_404(request, job_id, user, "editor")
    return request.app.state.jobs.cancel(job.id).to_dict()


@router.get("/api/ai/jobs/{job_id}/events")
async def ai_job_events(job_id: str, request: Request, user: CurrentUser):
    job = await _job_or_404(request, job_id, user, "viewer")
    jobs: JobStore = request.app.state.jobs

    async def gen():
        if job.kind.startswith("agent:"):
            async for ev in jobs.watch_steps(job_id):
                yield _sse(ev)
            return
        async for j in jobs.watch(job_id):
            yield _sse(j.to_dict())

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)
