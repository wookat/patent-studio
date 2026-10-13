"""text_forms 形库：范例注入与语料重叠哨兵。"""
import pytest

from patent_docx import text_forms


def test_roles_and_blocks():
    roles = text_forms.roles()
    assert {"C1独权句式", "C2从属起句", "F9实施例转接"} <= set(roles)
    cb = text_forms.claims_block()
    assert "其特征在于" in cb and "勿抄内容" in cb
    db = text_forms.description_block()
    assert "参照" in db or "范例" in db


def test_exemplars_are_real_and_bounded():
    xs = text_forms.exemplars("C1独权句式", k=5)
    assert xs and all(len(s) <= 140 for s in xs)


def test_corpus_overlap_sentinel():
    # 单案特异句（库内仅 1 篇共享）逐字搬运仍须命中；通行套话按跨案频次豁免
    stolen = ("9.一种计算机可读存储介质，其上存储有计算机程序，其特征在于，该程序被处理器执行时实现"
              "如权利要求1-7中任一项所述的一种大小模型协同的多智能体作业方法中的步骤。")
    fresh = "一种量子纠缠态制备装置，其特征在于，包括真空腔室、泵浦激光与单光子探测器阵列。"
    hits = text_forms.corpus_overlap([stolen, fresh])
    assert hits == [stolen]


def test_missing_lib_is_silent(monkeypatch):
    monkeypatch.setenv("PATENT_FORMS_LIBRARY", "/nonexistent/forms_library.json")
    text_forms._lib.cache_clear()
    text_forms._index.cache_clear()
    text_forms._pub_vecs.cache_clear()
    try:
        assert text_forms.roles() == []
        assert text_forms.claims_block() == ""
        assert text_forms.corpus_overlap(["任何句子。"]) == []
        assert text_forms.match_pubs("任意材料") == []
        assert text_forms.domain_exemplar_block("任意材料") == ""
        assert text_forms.match_sents("任意材料") == []
    finally:
        monkeypatch.delenv("PATENT_FORMS_LIBRARY")
        text_forms._lib.cache_clear()
        text_forms._index.cache_clear()
        text_forms._pub_vecs.cache_clear()
        text_forms._sent_vecs.cache_clear()


def test_domain_retrieval_finds_same_field():
    q = "一种基于知识图谱的多跳问答方法，泛化问题实体并识别问题关系得到答案"
    hits = text_forms.match_pubs(q, top=8)
    assert len(hits) >= 4
    titles = text_forms.pub_titles()
    same_domain = sum(1 for p in hits if ("知识图谱" in titles.get(p, "") or "问答" in titles.get(p, "")))
    assert same_domain >= len(hits) // 2  # 命中过半为同领域案
    sents = text_forms.match_sents(q, top=5)
    assert sents and all(s["score"] > 0 for s in sents) and all(s["pub"] for s in sents)
    block = text_forms.domain_exemplar_block(
        "一种基于区块链的私钥生成方法，利用指纹信息生成钱包私钥")
    assert "同领域真实案表述" in block and "勿抄内容" in block
    assert "区块链" in block  # 检索到的是同题材真案的原句
