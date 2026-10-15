# -*- coding: utf-8 -*-
"""先行技术检索 provider 层（s8 查新，docs/plan/21 §R-AI-S8）。

provider 由 PATENT_STUDIO_PRIOR_ART_PROVIDERS 逗号序决定（默认 "patsnap,openalex"）：
  patsnap  — PatSnap Open Platform（需 PATENT_STUDIO_PATSNAP_KEY；全球 210M+ 含 CN 全文，
             Starter 10k credits/90d，Bearer + query-search-patent/v2）
  ops      — EPO OPS（需 PATENT_STUDIO_OPS_KEY/OPS_SECRET；OAuth2 client-credentials，
             published-data/search/biblio，CN 书目+英文摘要）
  openalex — OpenAlex works（免 key，mailto=礼貌池；NPL/学术文献侧）

未配置任一专利源时 openalex 仍可跑 NPL；全部源不可用 → 每式空命中 + notes，
由 s8 降级为「待检索」笔记。命中永远只作机器初筛，不产出法律结论。
"""

from __future__ import annotations

import base64
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx

from app import config

_PATSNAP_QUERY = "https://connect.patsnap.com/search/patent/query-search-patent/v2"
_OPS_TOKEN = "https://ops.epo.org/3.2/auth/accesstoken"
_OPS_SEARCH = "https://ops.epo.org/3.2/rest-services/published-data/search/biblio"
_OPENALEX_WORKS = "https://api.openalex.org/works"

_TIMEOUT = httpx.Timeout(20.0, connect=8.0)
# PatSnap TACD 等字段前缀；已是字段式检索原样透传，否则包 TACD 保证命中题摘权说
_FIELDED_RE = re.compile(r"^\s*(TACD|TAC|TI|AB|CLMS|DESC|ALLD|PA|IN|AN|PN|IPC|CPC)\s*:", re.I)


@dataclass
class Hit:
    number: str  # 公开号 / DOI / OpenAlex id
    title: str
    date: str  # YYYYMMDD 或 YYYY-MM-DD
    authority: str  # CN/US/EP/… 或 "NPL"
    source: str  # PatSnap / OPS / OpenAlex
    link: str


@dataclass
class SearchReport:
    hits: dict[str, list[Hit]] = field(default_factory=dict)  # query -> hits（源合并，去重）
    notes: list[str] = field(default_factory=list)  # 源不可用/部分失败说明
    providers: list[str] = field(default_factory=list)  # 实际跑过的源名


def configured_providers() -> list[str]:
    """按声明顺序返回当前可用 provider；凭证缺失的源跳过并留给 notes。corpus 常驻最前。"""
    order = [p.strip().lower() for p in config.PRIOR_ART_PROVIDERS.split(",") if p.strip()]
    out = []
    from patent_studio.kernel import text_forms

    if text_forms._pub_vecs()[0]:
        out.append("corpus")
    for p in order:
        if p == "patsnap" and config.PATSNAP_KEY:
            out.append(p)
        elif p == "ops" and config.OPS_KEY and config.OPS_SECRET:
            out.append(p)
        elif p == "openalex":
            out.append(p)
    return out


def _corpus(query: str, limit: int) -> list[Hit]:
    """内建语料库检索源：589 篇真实 CN 授权案 TF-IDF 语义检索（零外部依赖）。"""
    from patent_studio.kernel import text_forms

    q = re.sub(r"^\s*(TACD|TAC|TI|AB|CLMS|DESC|ALLD)\s*:\s*", "", (query or "").strip(), flags=re.I)
    q = re.sub(r"[()\"]", "", q).strip()
    if not q:
        return []
    titles = text_forms.pub_titles()
    out = []
    for pn in text_forms.match_pubs(q, limit):
        out.append(
            Hit(
                number=pn,
                title=titles.get(pn, "（题录未收录）"),
                date="",
                authority="CN",
                source="Corpus",
                link=f"https://patents.google.com/patent/{pn}/zh",
            )
        )
    return out


def _norm_patent_query(q: str) -> str:
    q = (q or "").strip()
    if not q:
        return ""
    if _FIELDED_RE.search(q):
        return q
    return f"TACD: ({q})"


def _patsnap(query: str, limit: int) -> list[Hit]:
    qt = _norm_patent_query(query)
    if not qt:
        return []
    r = httpx.post(
        _PATSNAP_QUERY,
        headers={"Authorization": f"Bearer {config.PATSNAP_KEY}"},
        json={
            "query_text": qt,
            "limit": min(limit, 20),
            "offset": 0,
            "collapse_type": "DOCDB",
            "collapse_by": "PBD",
            "collapse_order": "LATEST",
        },
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("status"):
        raise RuntimeError(f"patsnap error {data.get('error_code')}: {data.get('error_msg')}")
    out = []
    for it in (data.get("data") or {}).get("results") or []:
        pn = str(it.get("pn") or "")
        dt = str(it.get("pbdt") or "")
        dt = f"{dt[:4]}-{dt[4:6]}-{dt[6:]}" if len(dt) == 8 and dt.isdigit() else dt
        out.append(
            Hit(
                number=pn,
                title=str(it.get("title") or "").strip(),
                date=dt,
                authority=str(it.get("authority") or ""),
                source="PatSnap",
                link=f"https://patents.google.com/patent/{pn}/en" if pn else "",
            )
        )
    return out


_OPS_TOKEN_CACHE: dict[str, str] = {}


def _ops_token() -> str:
    if "token" in _OPS_TOKEN_CACHE:
        return _OPS_TOKEN_CACHE["token"]
    basic = base64.b64encode(f"{config.OPS_KEY}:{config.OPS_SECRET}".encode()).decode()
    r = httpx.post(
        _OPS_TOKEN,
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        content="grant_type=client_credentials",
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    tok = r.json()["access_token"]
    _OPS_TOKEN_CACHE["token"] = tok
    return tok


def _ops(query: str, limit: int) -> list[Hit]:
    q = re.sub(r"^\s*(TACD|ALLD)\s*:\s*", "ta=", (query or "").strip(), flags=re.I) or f"ta={query}"
    q = re.sub(r"[()\"]", "", q)
    r = httpx.get(
        _OPS_SEARCH,
        params={"q": q, "Range": f"1-{min(limit, 20)}"},
        headers={"Authorization": f"Bearer {_ops_token()}", "Accept": "application/xml"},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    out = []
    ns = {"o": "http://ops.epo.org", "e": "http://www.epo.org/exchange"}
    for doc in ET.fromstring(r.text).findall(".//e:exchange-document", ns):
        biblio = doc.find(".//e:bibliographic-data", ns)
        if biblio is None:
            continue
        country = doc.get("country", "")
        number = f"{doc.get('country', '')}{doc.get('doc-number', '')}{doc.get('kind', '')}"
        title_el = biblio.find(".//e:invention-title", ns)
        date_el = biblio.find(".//e:publication-reference/e:document-id/e:date", ns)
        dt = date_el.text if date_el is not None and date_el.text else ""
        dt = f"{dt[:4]}-{dt[4:6]}-{dt[6:]}" if len(dt) == 8 and dt.isdigit() else dt
        out.append(
            Hit(
                number=number,
                title=(title_el.text or "").strip() if title_el is not None else "",
                date=dt,
                authority=country,
                source="OPS",
                link=f"https://worldwide.espacenet.com/patent/search?q={number}",
            )
        )
    return out


def _openalex(query: str, limit: int) -> list[Hit]:
    q = re.sub(r"[()\"]|TACD:|ALLD:", "", (query or "").strip(), flags=re.I).strip()
    if not q:
        return []
    params: dict[str, str | int] = {"search": q, "per-page": min(limit, 20)}
    if config.PRIOR_ART_MAILTO:
        params["mailto"] = config.PRIOR_ART_MAILTO
    r = httpx.get(_OPENALEX_WORKS, params=params, timeout=_TIMEOUT)
    r.raise_for_status()
    out = []
    for w in r.json().get("results") or []:
        ident = str(w.get("doi") or w.get("id") or "")
        out.append(
            Hit(
                number=ident.replace("https://doi.org/", "doi:"),
                title=str(w.get("display_name") or ""),
                date=str(w.get("publication_date") or ""),
                authority="NPL",
                source="OpenAlex",
                link=str(w.get("doi") or w.get("id") or ""),
            )
        )
    return out


_FUNCS = {"patsnap": _patsnap, "ops": _ops, "openalex": _openalex, "corpus": _corpus}


def search_all(queries: list[str], *, limit: int = 5) -> SearchReport:
    """逐条检索式在全部已配置源上执行；单源失败不阻断其余（降级记 note）。"""
    rep = SearchReport()
    for p in configured_providers():
        rep.providers.append(p)
    if not rep.providers:
        rep.notes.append("未配置检索源（PATSNAP_KEY / OPS_KEY+SECRET / openalex 皆不可用），本轮未执行检索")
        return rep
    for q in queries:
        q = (q or "").strip()
        if not q:
            continue
        rep.hits.setdefault(q, [])
        seen: set[str] = set()
        for p in rep.providers:
            try:
                for h in _FUNCS[p](q, limit):
                    key = h.number or h.title
                    if key and key not in seen:
                        seen.add(key)
                        rep.hits.setdefault(q, []).append(h)
            except Exception as e:  # 单源单式失败不炸整轮
                rep.notes.append(f"{p} 检索「{q[:40]}」失败：{type(e).__name__} {str(e)[:80]}")
    return rep
