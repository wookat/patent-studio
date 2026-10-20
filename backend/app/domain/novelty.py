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
_MAX_EVIDENCE = 200
_LENS = {
    "number": 64,
    "title": 300,
    "note": 2000,
    "link": 500,
    "query": 300,
    "provider": 40,
    "ran_at": 40,
    "publication_date": 32,
    "feature": 500,
    "quote": 2000,
    "evidence_id": 40,
    "conclusion": 20000,
}

# Z31 证据对照状态：hit 命中 / partial 部分命中 / missing 未见披露 / pending 待核对（无全文或原句，机器无法比对）
EVIDENCE_STATUSES = ("hit", "partial", "missing", "pending")


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
        "publication_date": _clip(h.get("publication_date"), "publication_date"),
    }


def _norm_evidence(e) -> dict:
    """Z31 证据对照行：{id, hit, claim?, feature, quote, status}。

    hit = 对比文件 number（无号按 title）；claim = 批注锚定的权项编号（可空 = 整篇级证据）；
    quote 空 ⇒ status 恒 pending（无证据原句不能判命中/缺失——不伪造命中结论）。"""
    if not isinstance(e, dict):
        raise NoveltyError("证据行必须是对象")
    hit_ref = _clip(e.get("hit"), "number").strip()
    if not hit_ref:
        raise NoveltyError("证据行需指明对比文件（hit = 公开号或标题）")
    claim = e.get("claim")
    if claim is not None and (not isinstance(claim, int) or isinstance(claim, bool) or claim < 1):
        raise NoveltyError("claim 必须是正整数权项编号")
    quote = _clip(e.get("quote"), "quote").strip()
    status = str(e.get("status") or "").strip().lower()
    if status and status not in EVIDENCE_STATUSES:
        raise NoveltyError(f"状态必须是 {'/'.join(EVIDENCE_STATUSES)} 之一")
    if not quote:
        status = "pending"
    elif not status:
        status = "hit"  # 有原句未标状态 ⇒ 默认按命中存（人工录入语义）；仍非法律结论
    return {
        "id": _clip(e.get("id"), "evidence_id") or "",
        "hit": hit_ref,
        "claim": claim,
        "feature": _clip(e.get("feature"), "feature").strip(),
        "quote": quote,
        "status": status,
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
    return {"updated_at": None, "queries": [], "hits": [], "evidence": [], "conclusion": ""}


def _path(store, pid) -> str:
    return os.path.join(store.get(pid).dir, FILE)


def _parse(data) -> dict:
    rec = _empty()
    if isinstance(data, dict):
        rec["updated_at"] = data.get("updated_at")
        rec["queries"] = [_norm_query(q) for q in (data.get("queries") or [])[:_MAX_QUERIES]]
        rec["hits"] = [_norm_hit(h) for h in (data.get("hits") or [])[:_MAX_HITS]]
        rec["evidence"] = [_norm_evidence(e) for e in (data.get("evidence") or [])[:_MAX_EVIDENCE]]
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


def find_hit(rec: dict, ref: str) -> dict | None:
    """按 number（无号按 title）找对比文件。"""
    ref = (ref or "").strip()
    return next((h for h in rec["hits"] if (h["number"] or h["title"]) == ref), None)


def add_evidence(store, pid, row) -> tuple[dict, dict]:
    """追加证据对照行（Z31）：hit 必须已登记在 hits；返回 (record, evidence)。"""
    with atomic.studio_lock(store.get(pid).dir, "novelty"):
        rec = load_novelty(store, pid)
        ev = _norm_evidence(row)
        if find_hit(rec, ev["hit"]) is None:
            raise NoveltyError(f"对比文件 {ev['hit']} 未登记在查新记录卡中")
        if len(rec["evidence"]) >= _MAX_EVIDENCE:
            raise NoveltyError(f"证据行已达上限 {_MAX_EVIDENCE}")
        ev["id"] = f"ev{len(rec['evidence']) + 1}"
        rec["evidence"].append(ev)
        rec["updated_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        atomic.write_text(_path(store, pid), json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    return rec, ev


_STATUS_LABEL = {
    "hit": "命中（已披露）",
    "partial": "部分命中",
    "missing": "未见披露",
    "pending": "待核对（无证据原句）",
}


def annotation_body(hit: dict, ev: dict) -> str:
    """Z31 证据批注正文：来源ID/链接/公开日/证据原句/状态齐备；无证据处明示待核对，不下法律结论。"""
    shown = hit["number"] or hit["title"]
    if hit["number"] and hit["title"]:
        shown += f"《{hit['title']}》"
    lines = [
        "【查新证据对照】机器筛选记录，供人工复核，非法律意见。",
        f"对比文件：{shown}",
        f"公开日期：{hit['publication_date'] or '待核对'}",
        f"来源链接：{hit['link'] or '待核对'}",
    ]
    if ev.get("feature"):
        lines.append(f"对照特征：{ev['feature']}")
    lines.append(f"证据原句：{ev['quote'] or '未提供（无全文/未检出），待核对'}")
    lines.append(f"比对状态：{_STATUS_LABEL.get(ev['status'], ev['status'])}")
    return "\n".join(lines)
