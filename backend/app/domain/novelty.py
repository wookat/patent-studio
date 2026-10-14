# -*- coding: utf-8 -*-
"""查新记录卡（W19 批4）：<project>/.studio/novelty.json——先行技术检索的结构化落点。

s8 场景把检索报告落成批注（锚在权项末块），随修订易散佚；本卡是结论的固定档案：
检索式（跑过的源与式）、对比文件（公开号/标题/相关度 ECLA X/Y/A/P/备注/链接）、代理师结论。
REST /novelty 端点与 MCP novelty 工具共用本文件；原子写 + studio_lock（comments/oa 同族）。
腐坏 JSON ⇒ NoveltyError(422)（R38 同口径），GET 不 500。
"""

import json
import os
from datetime import UTC, datetime

from app import atomic

FILE = os.path.join(".studio", "novelty.json")

# ECLA 检索报告相关度分类：X 破坏新颖性 / Y 影响创造性 / A 背景技术 / P 公开日在申请日前后之间
RELEVANCES = ("X", "Y", "A", "P")

_MAX_QUERIES = 20
_MAX_HITS = 50
_LENS = {
    "number": 64,
    "title": 300,
    "note": 2000,
    "link": 500,
    "query": 300,
    "provider": 40,
    "ran_at": 40,
    "conclusion": 20000,
}


class NoveltyError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def _clip(v, key):
    s = str(v or "")[: _LENS[key]]
    return s


def _norm_hit(h) -> dict:
    if not isinstance(h, dict):
        raise NoveltyError("对比文件必须是对象")
    number = _clip(h.get("number"), "number").strip()
    title = _clip(h.get("title"), "title").strip()
    if not number and not title:
        raise NoveltyError("对比文件需公开号或标题")
    rel = str(h.get("relevance") or "A").strip().upper()
    if rel not in RELEVANCES:
        raise NoveltyError(f"相关度必须是 {'/'.join(RELEVANCES)} 之一")
    return {
        "number": number,
        "title": title,
        "relevance": rel,
        "note": _clip(h.get("note"), "note"),
        "link": _clip(h.get("link"), "link"),
    }


def _norm_query(q) -> dict:
    if not isinstance(q, dict):
        raise NoveltyError("检索式必须是对象")
    query = _clip(q.get("query"), "query").strip()
    if not query:
        raise NoveltyError("检索式不能为空")
    return {
        "query": query,
        "provider": _clip(q.get("provider"), "provider"),
        "ran_at": _clip(q.get("ran_at"), "ran_at"),
    }


def _empty() -> dict:
    return {"updated_at": None, "queries": [], "hits": [], "conclusion": ""}


def _path(store, pid) -> str:
    return os.path.join(store.get(pid).dir, FILE)


def _parse(data) -> dict:
    rec = _empty()
    if isinstance(data, dict):
        rec["updated_at"] = data.get("updated_at")
        rec["queries"] = [_norm_query(q) for q in (data.get("queries") or [])[:_MAX_QUERIES]]
        rec["hits"] = [_norm_hit(h) for h in (data.get("hits") or [])[:_MAX_HITS]]
        rec["conclusion"] = _clip(data.get("conclusion"), "conclusion")
    return rec


def load_novelty(store, pid) -> dict:
    """→ {updated_at, queries[], hits[], conclusion}；无文件返回空记录；腐坏 ⇒ 422。"""
    p = _path(store, pid)
    if not os.path.isfile(p):
        return _empty()
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise NoveltyError(f"查新记录文件损坏：{FILE}", status=422) from e
    return _parse(data)


def save_novelty(store, pid, data) -> dict:
    """整表覆盖写；校验失败 ⇒ 422。→ 同 load。"""
    rec = _parse(data)
    rec["updated_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = store.get(pid).dir
    os.makedirs(os.path.join(d, ".studio"), exist_ok=True)
    with atomic.studio_lock(d, "novelty"):
        atomic.write_text(_path(store, pid), json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    return rec


def record_novelty(store, pid, queries=None, hits=None, conclusion=None) -> dict:
    """增量登记（MCP 用）：queries 按 query+provider 去重追加，hits 按 number（无号按 title）后者覆盖前者；
    conclusion 非 None 才覆盖。→ 同 load。"""
    with atomic.studio_lock(store.get(pid).dir, "novelty"):
        rec = load_novelty(store, pid)
        seen_q = {(q["query"], q["provider"]) for q in rec["queries"]}
        for q in queries or []:
            nq = _norm_query(q)
            if (nq["query"], nq["provider"]) not in seen_q and len(rec["queries"]) < _MAX_QUERIES:
                rec["queries"].append(nq)
                seen_q.add((nq["query"], nq["provider"]))
        idx = {(h["number"] or h["title"]): i for i, h in enumerate(rec["hits"])}
        for h in hits or []:
            nh = _norm_hit(h)
            key = nh["number"] or nh["title"]
            if key in idx:
                rec["hits"][idx[key]] = nh
            elif len(rec["hits"]) < _MAX_HITS:
                idx[key] = len(rec["hits"])
                rec["hits"].append(nh)
        if conclusion is not None:
            rec["conclusion"] = _clip(conclusion, "conclusion")
        rec["updated_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        d = store.get(pid).dir
        os.makedirs(os.path.join(d, ".studio"), exist_ok=True)
        atomic.write_text(_path(store, pid), json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    return rec
