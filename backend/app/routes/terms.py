# -*- coding: utf-8 -*-
"""术语路由（docs/plan/09 §3.2，单元 E2-terms）：GET/PUT terms、POST terms/extract、POST terms/unify。

CRUD：validate ⇒ 422 error_detail("terms", …)。extract：确定性候选；ai=true 需 require_enabled，经 app.state.ai.chat
（heavy）补充 source="ai" 候选，AI 失败 ⇒ error_detail("ai", …)。unify：确定性、不出站、不落盘，
返回 {critic_markdown, changed_lines, count}，前端写回编辑器后由审阅面板接受 / 拒绝。
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.ai import prompts, require_enabled
from app.ai.client import AiError
from app.domain import terms
from app.errors import error_detail
from app.routes import project_or_404
from patent_docx.terms_lint import scan_lines

router = APIRouter(prefix="/api/projects/{pid}/terms", tags=["terms"])
UNIT = "E2-terms"


class TermsIn(BaseModel):
    terms: list[dict]


class ExtractIn(BaseModel):
    content: str | None = None
    ai: bool = False


class UnifyIn(BaseModel):
    content: str | None = None
    names: list[str] | None = None
    books: list[str] | None = None


_project = project_or_404


def _content(request: Request, pid: str, body_content: str | None) -> str:
    if body_content is not None:
        return body_content
    return request.app.state.store.read_content(pid)


def _response(items: list[terms.Term]) -> dict:
    return {"version": terms.VERSION, "terms": items}


def _load(p) -> list[terms.Term]:
    try:
        return terms.load(p.dir)
    except terms.TermsError as e:
        raise HTTPException(e.status, error_detail("terms", str(e)))


@router.get("")
async def get_terms(request: Request, pid: str):
    p = _project(request, pid)
    return _response(_load(p))


@router.put("")
async def put_terms(request: Request, pid: str, body: TermsIn):
    p = _project(request, pid)
    items = [terms.normalize(t) for t in body.terms]
    try:
        terms.validate(items)
    except terms.TermsError as e:
        raise HTTPException(e.status, error_detail("terms", str(e)))
    return _response(terms.save(p.dir, items))


async def _ai_candidates(request: Request, pid: str, p, content: str) -> list[dict]:
    require_enabled(request.app.state.store, pid, UNIT)
    known = [t["name"] for t in _load(p)]
    messages = prompts.build("terms_extract", content, "已有术语主名：" + ("、".join(known) if known else "（无）"))
    try:
        r = await request.app.state.ai.chat(messages, "heavy", project_dir=p.dir)
        data = prompts.parse_json(r.text, prompts.SCHEMAS.get("terms_extract"))
    except AiError as e:
        raise HTTPException(e.status, error_detail("ai", str(e), detail=e.kind))
    except ValueError as e:
        raise HTTPException(502, error_detail("ai", f"AI 返回的候选术语不是合法 JSON：{e}", detail="terms_extract"))
    out = []
    lines = list(scan_lines(content))
    for t in data.get("terms", []):
        name = str(t.get("name", "")).strip()
        if not name:
            continue
        count, hit = terms.count_lines(name, lines)
        aliases = [str(a).strip() for a in (t.get("aliases") or []) if str(a).strip() and str(a).strip() != name]
        row = {"name": name, "count": count, "lines": hit, "source": "ai", "aliases": aliases,
               "en": t.get("en") or None, "definition": t.get("definition") or None}
        out.append(row)
    return out


@router.post("/extract")
async def extract_terms(request: Request, pid: str, body: ExtractIn):
    p = _project(request, pid)
    content = terms.accept(_content(request, pid, body.content))
    cands = terms.extract(content, p.settings)
    ai_used = False
    if body.ai:
        seen = {c["name"] for c in cands}
        for row in await _ai_candidates(request, pid, p, content):
            if row["name"] not in seen:
                seen.add(row["name"])
                cands.append(row)
        ai_used = True
    return {"candidates": cands, "ai_used": ai_used}


@router.post("/unify")
async def unify_terms(request: Request, pid: str, body: UnifyIn):
    p = _project(request, pid)
    content = _content(request, pid, body.content)
    items = _load(p)
    if body.names is not None:
        known = {t["name"] for t in items}
        missing = [n for n in body.names if n not in known]
        if missing:
            raise HTTPException(422, error_detail("terms", "术语表中没有主名：" + "、".join(missing)))
    markdown, changed = terms.unify(content, items, body.names, body.books)
    return {"critic_markdown": markdown, "changed_lines": changed,
            "count": terms.unify_count(content, items, body.names, body.books)}
