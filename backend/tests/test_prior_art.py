# -*- coding: utf-8 -*-
"""prior_art provider 层：凭证门控、query 归一化、命中归一化、单源失败降级、命中表渲染。"""
from __future__ import annotations

import httpx
import pytest

from app import config
from app.agent import prior_art
from app.agent.plans import s8
from patent_studio.kernel import text_forms


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.setattr(config, "PATSNAP_KEY", "")
    monkeypatch.setattr(config, "OPS_KEY", "")
    monkeypatch.setattr(config, "OPS_SECRET", "")
    monkeypatch.setattr(config, "PRIOR_ART_MAILTO", "")
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "patsnap,openalex")
    # corpus 是内建常驻源（语料索引在仓内总是加载），本文件只测外部源凭证门控——
    # 关掉语料索引让 configured_providers 不注入 corpus；corpus 源本身的命中见 test_corpus_*。
    monkeypatch.setattr(text_forms, "_pub_vecs", lambda: ({}, {}))
    prior_art._OPS_TOKEN_CACHE.clear()


def test_providers_gate_on_credentials(monkeypatch):
    assert prior_art.configured_providers() == ["openalex"]
    monkeypatch.setattr(config, "PATSNAP_KEY", "sk-x")
    assert prior_art.configured_providers() == ["patsnap", "openalex"]
    monkeypatch.setattr(config, "OPS_KEY", "k")
    monkeypatch.setattr(config, "OPS_SECRET", "s")
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "ops,patsnap")
    assert prior_art.configured_providers() == ["ops", "patsnap"]
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "")
    assert prior_art.configured_providers() == []


def test_norm_query_wraps_unfielded():
    assert prior_art._norm_patent_query("锂电池 AND 正极") == "TACD: (锂电池 AND 正极)"
    assert prior_art._norm_patent_query("TACD: virtual reality") == "TACD: virtual reality"
    assert prior_art._norm_patent_query("clms: x") == "clms: x"
    assert prior_art._norm_patent_query("") == ""


def _resp(payload):
    class R:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

        text = "<ops/>"

    return R()


def test_patsnap_hits_normalized(monkeypatch):
    monkeypatch.setattr(config, "PATSNAP_KEY", "sk-x")
    payload = {"status": True, "error_code": 0,
               "data": {"results": [{"pn": "CN114715946A", "title": "一种改性锂电池正极材料",
                                     "pbdt": "20220705", "authority": "CN"}]}}
    seen = {}

    def fake_post(url, **kw):
        seen["url"] = url
        seen["auth"] = kw["headers"]["Authorization"]
        seen["body"] = kw["json"]
        return _resp(payload)

    monkeypatch.setattr(prior_art.httpx, "post", fake_post)
    hits = prior_art._patsnap("锂电池 AND 正极", 5)
    assert seen["auth"] == "Bearer sk-x" and seen["body"]["query_text"] == "TACD: (锂电池 AND 正极)"
    assert hits == [prior_art.Hit(number="CN114715946A", title="一种改性锂电池正极材料",
                                  date="2022-07-05", authority="CN", source="PatSnap",
                                  link="https://patents.google.com/patent/CN114715946A/en")]


def test_patsnap_error_status_raises(monkeypatch):
    monkeypatch.setattr(config, "PATSNAP_KEY", "sk-x")
    monkeypatch.setattr(prior_art.httpx, "post",
                        lambda url, **kw: _resp({"status": False, "error_code": 1, "error_msg": "bad"}))
    with pytest.raises(RuntimeError):
        prior_art._patsnap("x", 5)


def test_openalex_hits_normalized(monkeypatch):
    payload = {"results": [{"doi": "https://doi.org/10.1/x", "display_name": "Cathode paper",
                            "publication_date": "2021-03-04", "id": "W1"}]}
    seen = {}

    def fake_get(url, **kw):
        seen["params"] = kw["params"]
        return _resp(payload)

    monkeypatch.setattr(prior_art.httpx, "get", fake_get)
    monkeypatch.setattr(config, "PRIOR_ART_MAILTO", "agentgate@zalize.com")
    hits = prior_art._openalex('TACD: (锂电池 "正极")', 5)
    assert seen["params"]["mailto"] == "agentgate@zalize.com"
    assert hits[0].number == "doi:10.1/x" and hits[0].source == "OpenAlex" and hits[0].authority == "NPL"


def test_search_all_merges_dedups_and_degrades(monkeypatch):
    monkeypatch.setattr(config, "PATSNAP_KEY", "sk-x")
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "patsnap,openalex")
    h1 = prior_art.Hit("CN1", "t1", "2020-01-01", "CN", "PatSnap", "l1")
    h2 = prior_art.Hit("doi:x", "t2", "2020-02-02", "NPL", "OpenAlex", "l2")
    monkeypatch.setattr(prior_art, "_FUNCS",
                        {"patsnap": lambda q, limit: [h1],
                         "openalex": lambda q, limit: [prior_art.Hit("CN1", "dup", "", "", "OpenAlex", ""), h2]})
    rep = prior_art.search_all(["q1", "q2"], limit=5)
    assert rep.providers == ["patsnap", "openalex"]
    assert [h.number for h in rep.hits["q1"]] == ["CN1", "doi:x"]  # CN1 去重一次
    assert rep.notes == []


def test_search_all_provider_failure_notes_not_raises(monkeypatch):
    monkeypatch.setattr(config, "PATSNAP_KEY", "sk-x")

    def boom(q, limit):
        raise httpx.TimeoutException("t")

    monkeypatch.setattr(prior_art, "_FUNCS", {"patsnap": boom, "openalex": lambda q, limit: []})
    rep = prior_art.search_all(["q"], limit=5)
    assert rep.hits == {"q": []} and rep.notes and "patsnap" in rep.notes[0]


def test_search_all_unconfigured(monkeypatch):
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "")
    rep = prior_art.search_all(["q"])
    assert rep.providers == [] and rep.hits == {} and rep.notes


def test_corpus_builtin_provider(monkeypatch):
    """corpus 常驻最前：索引存在即注入，与外部源凭证无关；命中归一化带题录与 zh 链接。"""
    monkeypatch.setattr(text_forms, "_pub_vecs", lambda: ({"CN1": [0.1]}, {}))
    monkeypatch.setattr(text_forms, "pub_titles", lambda: {"CN1": "一种检索方法"})
    monkeypatch.setattr(text_forms, "match_pubs", lambda q, limit: ["CN1", "CN2"])
    monkeypatch.setattr(config, "PRIOR_ART_PROVIDERS", "")
    assert prior_art.configured_providers() == ["corpus"]
    hits = prior_art._corpus('TACD: ("检索" AND 方法)', 5)
    assert hits[0].number == "CN1" and hits[0].title == "一种检索方法" and hits[0].source == "Corpus"
    assert hits[0].authority == "CN" and hits[0].link.endswith("/CN1/zh")
    assert hits[1].title == "（题录未收录）"


def test_render_searched_vs_pending():
    pts = [{"title": "p", "distinguishing_point": "d", "technical_problem": "q", "technical_effect": "e"}]
    qs = [{"source": "PatSnap", "query": "锂电池 AND 正极"}]
    rep = prior_art.SearchReport(
        hits={"锂电池 AND 正极": [prior_art.Hit("CN114715946A", "正极材料", "2022-07-05", "CN", "PatSnap",
                                              "https://patents.google.com/patent/CN114715946A/en")]},
        providers=["patsnap"])
    body = s8._render(pts, qs, ["n"], rep)
    assert "机器初筛" in body and "CN114715946A" in body and "检索命中" in body
    body2 = s8._render(pts, qs, [], None)
    assert "待检索" in body2 and "检索命中" not in body2


def test_render_zero_hit_query_shows_none():
    rep = prior_art.SearchReport(hits={"q1": []}, providers=["patsnap"])
    body = s8._render([], [{"source": "PatSnap", "query": "q1"}], [], rep)
    assert "无命中" in body
