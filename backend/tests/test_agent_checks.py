# -*- coding: utf-8 -*-
"""agent/checks.py 确定性自检：纯函数逐项验证，含两案 examples/method、examples/system 的真实文本。"""
import os
import shutil

import pytest

from app.agent import checks
from app.agent.types import CheckResult
from app.domain.projects import ProjectStore
from app.mcp import tools_semantic as ts

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def store(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    for c in ("method", "system"):
        shutil.copytree(os.path.join(ROOT, "examples", c), root / c,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    return ProjectStore(str(root))


def _all_check_results(*results):
    for r in results:
        assert isinstance(r, CheckResult) and r.name and isinstance(r.ok, bool) and isinstance(r.why, str)


# ---------------------------------------------------------------- 结构 ----

@pytest.mark.parametrize("pid", ["method", "system"])
def test_parse_examples_ok(store, pid):
    r = checks.parse(store.read_content(pid))
    _all_check_results(r)
    assert r.ok, r.why


def test_parse_rejects_broken_docset():
    r = checks.parse("# 只有一个标题\n\n没有三书。\n")
    assert not r.ok and r.why


def test_lint_and_roundtrip():
    old = "冻结基础预测模型并设定安全锚输出。"
    good = "冻结基础预测模型并设定{~~安全锚输出~>安全锚~~}。"
    assert checks.lint(good).ok
    assert checks.roundtrip(old, good).ok
    bad = "冻结基础预测模型并设定{~~安全锚输出~>安全锚。"
    assert not checks.lint(bad).ok
    r = checks.roundtrip(old, "冻结基础预测模型{++并++}设定安全锚。")
    assert not r.ok and "第 1 行" in r.why


def test_preflight_delta_counts_new_errors_only():
    before = {"items": [{"rule": "a", "severity": "error"}, {"rule": "b", "severity": "warning"}]}
    same = {"items": [{"rule": "a", "severity": "error"}, {"rule": "b", "severity": "error"}]}
    r = checks.preflight_delta(before, same)
    assert not r.ok and "b×1" in r.why
    fewer = {"items": []}
    assert checks.preflight_delta(before, fewer).ok
    assert checks.preflight_delta(before, before).ok


# ---------------------------------------------------------------- 内容 ----

def test_support_and_noun_subset():
    desc = "所述成熟反馈队列用于缓存预测起点；所述信任系数由成熟统计驱动。"
    assert checks.support(["成熟反馈队列", " 信任系数 "], desc).ok
    r = checks.support(["成熟反馈队列", "量子纠缠器"], desc)
    assert not r.ok and "量子纠缠器" in r.why
    assert checks.noun_subset("信任系数由成熟统计驱动，通过成熟反馈队列实现。", desc).ok
    r = checks.noun_subset("信任系数由量子纠缠器驱动。", desc)
    assert not r.ok and "量子纠缠器" in r.why
    assert checks.noun_subset("## 保护范围\n信任系数。", desc, allow=("保护范围",)).ok
    assert not checks.noun_subset("## 保护范围\n信任系数。", desc).ok


def test_nouns_ignore_function_words_and_critic_marks():
    ns = checks.nouns("所述成熟反馈队列{--用于--}缓存所述预测起点，并且由信任系数门控。")
    assert ns == ["成熟反馈队列缓存", "预测起点", "信任系数门控"]


def test_antecedent_same_claim_and_chain():
    ok = "1.一种方法，包括：冻结基础预测模型；计算所述基础预测模型的输出。"
    assert checks.antecedent(ok).ok
    bad = "2.根据权利要求1所述的方法，其特征在于，所述风险轴包括检索记忆失效。"
    r = checks.antecedent(bad, chain_text="1.一种方法，包括：冻结基础预测模型。")
    assert not r.ok and "风险轴" in r.why
    assert checks.antecedent(bad, chain_text="1.一种方法，包括：确定风险轴。").ok
    # 长词只按功能字切，「所述统计量达到」切出「统计量达」——前缀 ≥3 字命中即通过
    assert checks.antecedent("1.一种方法，构造e过程财富统计量，当所述统计量达到阈值时告警。").ok


@pytest.mark.parametrize("pid, claim, expect_ok", [("method", 1, True), ("system", 1, True), ("system", 10, True)])
def test_antecedent_on_examples(store, pid, claim, expect_ok):
    d = ts.derive(store, pid)
    nodes = ts._nodes(d)
    node = nodes[claim]
    chain = "\n".join(nodes[r].text for r in node.refs if r in nodes)
    assert checks.antecedent(node.text, chain).ok is expect_ok


def test_no_legal_verdict():
    assert checks.no_legal_verdict("疑似缺少先行基础，建议补充，请核对。").ok
    r = checks.no_legal_verdict("权利要求 1 得不到说明书的支持，应予驳回。")
    assert not r.ok and "应予驳回" in r.why and "得不到说明书的支持" in r.why
    for w in checks.LEGAL_VERDICT_WORDS:
        assert not checks.no_legal_verdict(f"……{w}……").ok


# ---------------------------------------------------------------- 写入守卫 ----

def test_snapshot_and_no_direct_write(store):
    pdir = store._dir("method")
    before = checks.snapshot(pdir)
    assert "content.md" in before and any(k.startswith("docs/") for k in before)
    assert checks.no_direct_write(before, checks.snapshot(pdir)).ok
    with open(os.path.join(pdir, "docs", "brief.md"), "w", encoding="utf-8") as f:
        f.write("# 新文件\n")
    r = checks.no_direct_write(before, checks.snapshot(pdir))
    assert not r.ok and "docs/brief.md" in r.why
    os.remove(os.path.join(pdir, "docs", "brief.md"))
    with open(os.path.join(pdir, "content.md"), "a", encoding="utf-8") as f:
        f.write("\n")
    r = checks.no_direct_write(before, checks.snapshot(pdir))
    assert not r.ok and "content.md" in r.why


def test_anchor_hit():
    lines = ["1.一种方法。", "2.根据权利要求1所述的方法。", "3.另一项。"]
    assert checks.anchor_hit("权利要求1", lines, 2, 2).ok
    assert checks.anchor_hit("另一项", lines, 1, 3).ok
    r = checks.anchor_hit("另一项", lines, 1, 2)
    assert not r.ok and "1–2" in r.why
    assert not checks.anchor_hit("", lines, 1, 3).ok
    assert not checks.anchor_hit("不存在", lines, 1, 99).ok


# ---------------------------------------------------------------- 辅助 ----

def test_report_for_matches_derive(store):
    d = ts.derive(store, "method")
    rep = checks.report_for(store, "method", store.read_content("method"))
    assert checks._error_counter(rep) == checks._error_counter(d.report)


def test_apply_blocks_inserts_claim_and_paragraph_and_keeps_parse(store):
    from app.agent.types import PatchBlock
    content = store.read_content("method")
    d = ts.derive(store, "method")
    last = d.ast["claims"][-1]["id"]
    blocks = [PatchBlock(after_block_id=last, markdown=
                         "12.根据权利要求1所述的方法，其特征在于，所述安全锚输出为固定值。"),
              PatchBlock(after_block_id=last, markdown=
                         "13.根据权利要求12所述的方法，其特征在于，所述固定值可配置。"),
              PatchBlock(after_block_id="abstract", markdown="补充摘要段。")]
    out = checks.apply_blocks(content, blocks)
    assert checks.parse(out).ok
    assert out.index("12.根据权利要求1") < out.index("13.根据权利要求12")
    assert "补充摘要段。" in out
    assert checks.preflight_delta(d.report, checks.report_for(store, "method", out)).ok


def test_apply_blocks_orders_anchors_back_to_front(store):
    """往前节插入会把后节块 id 重排——apply_blocks 按锚点行位倒序应用，先算好的锚点不失效。"""
    from app.agent.types import PatchBlock
    content = store.read_content("method")
    d = ts.derive(store, "method")

    def tail_of(sec: str) -> str:
        bs = [b for b in d.ast["description"] if b["id"].startswith(f"description/{sec}/")]
        return bs[-1]["id"]

    blocks = [PatchBlock(after_block_id=tail_of("技术领域"), markdown="技术领域补充段。"),
              PatchBlock(after_block_id=tail_of("背景技术"), markdown="背景技术补充段。")]
    out = checks.apply_blocks(content, blocks)
    assert checks.parse(out).ok
    assert out.index("技术领域补充段") < out.index("### 背景技术") < out.index("背景技术补充段")


def test_apply_blocks_replaces_block_in_place(store):
    """replace_block_id 原位替换块内容：其后块 id 不重排、同锚点后续插入照常连锁。"""
    from app.agent.types import PatchBlock
    content = store.read_content("method")
    d = ts.derive(store, "method")
    rid = "description/技术领域/p0001"
    old_text = next(b["text"] for b in d.ast["description"] if b["id"] == rid)
    blocks = [PatchBlock(after_block_id=rid, replace_block_id=rid, markdown="替换后的技术领域段。"),
              PatchBlock(after_block_id=rid, markdown="替换块之后追加段。"),
              PatchBlock(after_block_id="description/背景技术/p0002", markdown="背景技术补充段。")]
    out = checks.apply_blocks(content, blocks)
    assert checks.parse(out).ok
    assert "替换后的技术领域段。" in out and old_text not in out
    assert out.index("替换后的技术领域段。") < out.index("替换块之后追加段。") \
        < out.index("### 背景技术") < out.index("背景技术补充段。")


def test_apply_blocks_multi_line_table_keeps_body(store):
    """vit-11 实案：管道表（缺 sep 行）被 AST 拆成多块——续链必须落到插入区末块，
    否则同锚点后续块挤进表头与数据行之间，数据行被推到文末堆叠。"""
    from app.agent.types import PatchBlock
    content = store.read_content("method")
    d = ts.derive(store, "method")
    anchor = next(b["id"] for b in d.ast["description"]
                  if b["id"].startswith("description/技术领域/"))
    blocks = [
        PatchBlock(after_block_id=anchor, markdown="表1 网络层配置"),
        PatchBlock(after_block_id=anchor, markdown=
                   "| 阶段 | 单元 |\n| 嵌入输入 | 分块单元101 |\n| 输出读取 | 分类头110 |"),
        PatchBlock(after_block_id=anchor, markdown="接续说明段。"),
    ]
    out = checks.apply_blocks(content, blocks)
    assert checks.parse(out).ok
    i = out.index("表1 网络层配置")
    seg = out[i:out.index("接续说明段", i)]
    assert "| 嵌入输入 |" in seg and "| 输出读取 |" in seg  # 表体紧跟表头，未被插开
    assert out.index("| 输出读取 |") < out.index("接续说明段")


def test_apply_all_proposals_batches_pending(store):
    """往复轮89：apply-all 按入档序批量应用 pending，单条失败不中止。"""
    import asyncio

    from app.agent import proposals
    from app.agent.types import BlockAnchor, BlocksPatch, FilePatch, PatchBlock, Proposal

    p = store.get("method")
    d = ts.derive(store, "method")
    last = d.ast["claims"][-1]["id"]
    pid, now = "method", 1_000_000.0

    def _prop(i, **kw):
        return Proposal(id=f"prop_{i}", job_id="job_x", scenario="s1",
                        anchor=BlockAnchor(book="claims", block_id="claims",
                                           line_start=1, line_end=1),
                        model="m", created_at=now + i, **kw)

    proposals.append(p.dir, pid, _prop(1, kind="patch",
                                       patch=BlocksPatch(blocks=[PatchBlock(
                                           after_block_id=last,
                                           markdown="99.补充从权。")])), "t")
    proposals.append(p.dir, pid, _prop(2, kind="patch",
                                       patch=FilePatch(file="figs-src/fig-t.mmd",
                                                       content="flowchart LR\n  A-->B")), "t")
    proposals.append(p.dir, pid, _prop(3, kind="comment", comment_body="批注体。"), "t")
    proposals.append(p.dir, pid, _prop(4, kind="patch",
                                       patch=BlocksPatch(blocks=[PatchBlock(
                                           after_block_id="no_such_block_xyz",
                                           markdown="坏锚块。")])), "t")

    r = asyncio.run(proposals.apply_all(store, pid, who="t"))
    # stale 锚点只跳该块不再毙整提案（r113）——prop_4 应用但带跳块清单
    assert len(r["applied"]) == 4, r
    assert r["applied"][3] == "prop_4[+1跳块]"
    assert len(r["failed"]) == 0
    assert "99.补充从权" in store.read_content("method")
    assert os.path.isfile(os.path.join(p.dir, "figs-src", "fig-t.mmd"))
    assert all(x.state == "applied" for x in proposals.load(p.dir, pid, "applied"))
