# -*- coding: utf-8 -*-
"""agent-scenarios-backend（docs/plan/21 §6.1）：S1–S7 / S9 / S10 场景计划在 mock 下跑通两案，
产出只有 critic / comment / patch，源文件 md5 不变；S8 不注册。"""
import asyncio
import hashlib
import json
import os
import shutil

import pytest

from app.agent import checks, registry, types
from app.agent import plans as plans_mod
from app.agent.plans import RunContext
from app.ai import prompts_agent
from app.ai.client import MODELS, AiClient
from app.domain.projects import ProjectStore

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASES = ("method", "system")
FORBIDDEN_MODEL = "claude-sonnet-4.6"


def _md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


@pytest.fixture(scope="module", autouse=True)
def installed():
    plans_mod.install()
    yield


@pytest.fixture()
def store(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    for c in CASES:
        shutil.copytree(os.path.join(ROOT, "examples", c), root / c,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    st = ProjectStore(str(root))
    for c in CASES:
        st.read_content(c)  # 先物化 docs/ 镜像（gitignored），否则快照把懒迁移误判为场景直写
    return st


def run(store, scenario, pid, params=None, *, ai=None):
    ai = ai or AiClient(prompts_agent.AgentMockProvider())
    ctx = RunContext(store=store, pid=pid, ai=ai, job_id=f"job-{scenario}-{pid}", scenario=scenario,
                     params=params or {}, user="tester")
    asyncio.run(registry.get(scenario)(ctx))
    return ctx


def _snapshot(store, pid):
    return checks.snapshot(store._dir(pid))


# ---------------------------------------------------------------- 注册表 ----

def test_registry_exact_set():
    assert set(registry.registered()) == {"s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"}
    assert not types.FORBIDDEN_SCENARIOS  # s8 已解封为待检索诚实版（契约刻意变更）


def test_plans_declare_steps_and_routes():
    for p in plans_mod.plans().values():
        assert p.steps and p.model_route in ("interactive", "heavy") and p.output_kind
        assert set(p.output_kind) <= {"critic", "comment", "patch"}
        kinds = {type(s).__name__ for s in p.steps}
        assert kinds <= {"ToolStep", "GenStep", "CheckStep"}
    assert set(plans_mod.plans()) == set(registry.registered())


def test_no_forbidden_model_anywhere():
    import app.agent.checks as c
    import app.agent.plans as pl
    for m in (c, pl, prompts_agent):
        with open(m.__file__, encoding="utf-8") as f:
            assert FORBIDDEN_MODEL not in f.read()
    assert FORBIDDEN_MODEL not in MODELS.values()


# ---------------------------------------------------------------- 每场景跑通 ----

@pytest.mark.parametrize("pid", CASES)
@pytest.mark.parametrize("scenario", ["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"])
def test_scenario_runs_to_done_without_writing(store, scenario, pid):
    before = _snapshot(store, pid)
    params = {}
    if scenario == "s7":
        params = {"items": [{"id": "oa-1", "claims": [1], "kind": "novelty",
                             "text": "关于权利要求 1：对比文件 1 公开了相同的技术方案，请申请人陈述意见。"}]}
    ctx = run(store, scenario, pid, params)
    kinds = [e.kind for e in ctx.events]
    assert kinds[0] == "plan" and kinds[-1] == "done"
    assert all(p.kind in ("critic", "comment", "patch") for p in ctx.proposals)
    assert all(p.state == "pending" for p in ctx.proposals)
    assert _snapshot(store, pid) == before
    ndw = next(e for e in ctx.events if e.kind == "check" and e.data["name"] == "no_direct_write")
    assert ndw.data["ok"]
    assert ctx.model != FORBIDDEN_MODEL


# ---------------------------------------------------------------- S1 ----

@pytest.mark.parametrize("pid", CASES)
def test_s1_existing_case_keeps_source_md5(store, pid):
    p = store.get(pid)
    md5 = _md5(os.path.join(p.dir, "content.md"))
    text = "一种基于多模态融合的赌场投注监控方法，通过图像识别与传感器数据融合识别投注行为并进行财富门控。"
    ctx = run(store, "s1", pid, {"text": text, "target": "current"})
    assert ctx.events[-1].kind == "done"
    assert _md5(os.path.join(p.dir, "content.md")) == md5
    assert ctx.proposals and ctx.proposals[0].kind in ("patch", "comment")
    if ctx.proposals[0].kind == "patch":
        blocks = ctx.proposals[0].patch.blocks
        assert blocks and all(b.markdown for b in blocks)
        applied = checks.apply_blocks(store.read_content(pid), blocks)
        assert checks.parse(applied).ok


def test_s1_new_case_goes_through_convert_pipeline(store):
    ctx = run(store, "s1", "method", {"text": "一种 mock 方法的交底书正文。", "target": "new"})
    done = ctx.events[-1]
    assert done.kind == "done"
    new_pid = done.data["new_pid"]
    assert new_pid != "method" and os.path.isfile(os.path.join(store.root, new_pid, "content.md"))
    assert ctx.proposals == []
    assert _snapshot(store, "method") == checks.snapshot(store._dir("method"))


# ---------------------------------------------------------------- S2 ----

def _comments(ctx):
    return [p for p in ctx.proposals if p.kind == "comment"]


def test_s2_hits_known_defects_method(store):
    ctx = run(store, "s2", "method")
    lines = {p.anchor.line_start for p in _comments(ctx)} | {p.anchor.line_end for p in _comments(ctx)}
    hit = {ln for p in _comments(ctx) for ln in range(p.anchor.line_start, p.anchor.line_end + 1)}
    assert 39 in hit, lines
    assert 189 in hit, lines
    for p in _comments(ctx):
        assert checks.no_legal_verdict(p.comment_body).ok, p.comment_body


def test_s2_hits_known_defect_system(store):
    ctx = run(store, "s2", "system")
    hit = {ln for p in _comments(ctx) for ln in range(p.anchor.line_start, p.anchor.line_end + 1)}
    assert 34 in hit
    for p in _comments(ctx):
        assert checks.no_legal_verdict(p.comment_body).ok


def test_s2_comments_cite_paragraph_numbers_and_no_model_for_deterministic(store):
    ai = AiClient(prompts_agent.AgentMockProvider())
    ctx = run(store, "s2", "method", ai=ai)
    gens = [e for e in ctx.events if e.kind == "gen_delta"]
    dets = [e for e in ctx.events if e.kind == "check" and e.data["name"] == "antecedent"]
    assert dets, "确定性 antecedent 检查须在模型前执行"
    first_gen = ctx.events.index(gens[0]) if gens else len(ctx.events)
    assert ctx.events.index(dets[0]) < first_gen
    assert any("[00" in (p.comment_body or "") for p in _comments(ctx))


# ---------------------------------------------------------------- S4 / S6 ----

def _inject_inconsistent_mark(store, pid):
    """轮8 图例归一后 method 案的 1034 截短名不再不一致——s4/s5 需要至少一条真不一致标记才有差分对象。"""
    store.save_content(pid, store.read_content(pid) + "\n\n进给轴201驱动刀具，夹持机构201夹持工件。")


@pytest.mark.parametrize("pid", CASES)
def test_s4_critic_roundtrips_byte_for_byte(store, pid):
    if pid == "method":
        _inject_inconsistent_mark(store, pid)
    ctx = run(store, "s4", pid)
    crits = [p for p in ctx.proposals if p.kind == "critic"]
    assert crits
    lines = store.read_content(pid).split("\n")
    for p in crits:
        old = "\n".join(lines[p.anchor.line_start - 1: p.anchor.line_end])
        assert checks.roundtrip(old, p.critic_markdown).ok
        assert checks.lint(p.critic_markdown).ok
        assert "{~~" in p.critic_markdown


@pytest.mark.parametrize("pid", CASES)
def test_s6_abstract_within_300_and_noun_subset(store, pid):
    ctx = run(store, "s6", pid)
    assert ctx.proposals and ctx.proposals[0].kind in ("critic", "patch")
    p = ctx.proposals[0]
    from patent_studio.kernel import critic
    text = critic.accept(p.critic_markdown) if p.kind == "critic" else p.patch.blocks[0].markdown
    assert len(text) <= 300
    assert checks.noun_subset(text, store.read_content(pid)).ok
    assert {c.name for c in p.checks} >= {"len", "noun_subset"}


# ---------------------------------------------------------------- S3 / S5 / S7 / S9 / S10 形态 ----

def test_s3_insertion_critic(store):
    ctx = run(store, "s3", "system")
    crits = [p for p in ctx.proposals if p.kind == "critic"]
    assert crits
    lines = store.read_content("system").split("\n")
    from patent_studio.kernel import critic
    for p in crits:
        old = "\n".join(lines[p.anchor.line_start - 1: p.anchor.line_end])
        assert "{++" in p.critic_markdown and "{--" not in p.critic_markdown and "~>" not in p.critic_markdown
        assert critic.reject(p.critic_markdown) == old
        assert critic.accept(p.critic_markdown).startswith(old) and len(critic.accept(p.critic_markdown)) > len(old)


def test_s5_comments_only(store):
    _inject_inconsistent_mark(store, "method")
    ctx = run(store, "s5", "method")
    assert ctx.proposals and all(p.kind == "comment" for p in ctx.proposals)
    assert any("201" in (p.comment_body or "") for p in ctx.proposals)


def test_s7_one_heavy_gen_per_item_and_no_renumber(store):
    items = [{"id": f"oa-{i}", "claims": [1], "kind": "novelty", "text": f"关于权利要求 1 的第 {i} 条意见。"}
             for i in (1, 2)]
    ai = AiClient(prompts_agent.AgentMockProvider())
    ctx = run(store, "s7", "method", {"items": items}, ai=ai)
    gens = [e for e in ctx.events if e.kind == "gen_delta" and e.data["step"] == "argue"]
    assert len(gens) == 2
    assert all(c["model"] == MODELS["heavy"] for c in ai.provider.calls)
    assert len([p for p in ctx.proposals if p.kind == "comment"]) == 2
    lines = store.read_content("method").split("\n")
    from patent_studio.kernel import critic
    for p in ctx.proposals:
        if p.kind == "critic":
            old = "\n".join(lines[p.anchor.line_start - 1: p.anchor.line_end])
            assert checks.roundtrip(old, p.critic_markdown).ok
            assert old.split(".", 1)[0] == critic.accept(p.critic_markdown).split(".", 1)[0], "权项号不变"


def test_s9_patches_new_english_files(store):
    ctx = run(store, "s9", "method", {"books": ["claims"]})
    pats = [p for p in ctx.proposals if p.kind == "patch"]
    assert [p.patch.file for p in pats] == ["docs/claims.en.md"]
    assert not os.path.exists(os.path.join(store._dir("method"), "docs", "claims.en.md"))


def test_s9_degrades_to_comment_when_structure_fails(store):
    ctx = run(store, "s9", "method", {"books": ["description"]})
    assert ctx.events[-1].kind == "done"
    assert not [p for p in ctx.proposals if p.kind == "patch"]
    assert [p for p in ctx.proposals if p.kind == "comment"]
    assert len([e for e in ctx.events if e.kind == "gen_delta"]) == 2


def test_s10_brief_patch(store):
    ctx = run(store, "s10", "method")
    pats = [p for p in ctx.proposals if p.kind == "patch"]
    assert pats and pats[0].patch.file == "docs/brief.md"
    assert not os.path.exists(os.path.join(store._dir("method"), "docs", "brief.md"))


def test_events_are_json_serializable(store):
    ctx = run(store, "s5", "system")
    for e in ctx.events:
        json.dumps(e.model_dump(), ensure_ascii=False)


def test_s1_build_blocks_replaces_template_stubs():
    """往复轮5：新建案模板为全占位骨架——claims/说明书节/摘要占位块应走 replace_block_id
    原位替换，生成块多于占位块时其余块连在最后被替换块之后；应用后占位标记清零。"""
    from types import SimpleNamespace

    from app.agent.plans import s1
    from app.domain.projects import TEMPLATE_MD
    from patent_studio.kernel.ast import parse_ast

    ast = parse_ast(TEMPLATE_MD, {})
    d = SimpleNamespace(ast=ast)
    blocks = s1.build_blocks(
        d,
        ["一种方法，其特征在于，包括真步骤一；真步骤二。",
         "根据权利要求1所述的方法，其特征在于，真限定。",
         "根据权利要求2所述的方法，其特征在于，再限定。"],
        {"技术领域": "本发明涉及真领域。", "背景技术": "背景一段。", "发明内容": "内容一段。",
         "附图说明": "图1为示意图。", "具体实施方式": "实施一段。\n\n实施二段。"},
        "# 题\n## 摘要\n本发明公开真摘要。",
    )
    reps = [b.replace_block_id for b in blocks if b.replace_block_id]
    assert reps[:2] == ["claims/1", "claims/2"]
    assert any(r.startswith("description/技术领域/") for r in reps)
    assert any(r.startswith("description/具体实施方式/") for r in reps)
    assert "abstract/p1" in reps
    # 第 3 权超占位 → 插在最后被替换的 claims/2 之后
    assert [b.after_block_id for b in blocks
            if not b.replace_block_id and "再限定" in b.markdown] == ["claims/2"]
    # 摘要混入的书名/节名行被剔除
    abs_b = next(b for b in blocks if b.replace_block_id == "abstract/p1")
    assert abs_b.markdown == "本发明公开真摘要。"
    # 端到端：虚拟应用后占位清零（仅模板标题 XXX 保留）、真实内容在位
    applied = checks.apply_blocks(TEMPLATE_MD, SimpleNamespace(blocks=blocks).blocks)
    assert "……" not in applied
    assert applied.count("XXX") == 1  # 标题行模板占位不在块内，保留
    assert "真步骤一" in applied and "真摘要" in applied and "实施二段" in applied


def test_s1_limit_abstract_truncates_at_punctuation():
    """往复轮6：模型摘要超 CNIPA 300 字上限时整案提案此前被降级 comment——改为文边界截断兜底。"""
    from app.agent.plans import s1
    long = "本发明公开了一种方法" * 20 + "，中。" + "补充细节" * 60
    out = s1._limit_abstract(long)
    assert len(out) <= 290
    assert out.endswith(("。", "，", "；", ","))
    assert s1._limit_abstract("短摘要。") == "短摘要。"


def test_s1_dedupe_captions_keeps_longest():
    """往复轮9：模型违反「同一图号只声明一次」时确定性去重——同 N 保最长题注原位。"""
    from app.agent.plans import s1
    text = ("图1为本发明实施例的总体流程图。\n\n"
            "图1为基于去噪扩散概率模型的图像生成方法的整体流程示意图。\n\n"
            "图2为模型架构图。\n\n"
            "元件标号说明：101为训练模块；102为扩散单元。")
    out = s1._dedupe_captions(text)
    assert out.count("图1为") == 1 and "整体流程示意图" in out
    assert "总体流程图" not in out and "图2为模型架构图" in out
    assert "元件标号说明" in out
    assert s1._dedupe_captions("图1为示意图。") == "图1为示意图。"


def test_s1_caption_stubs_replaced_by_number():
    """往复轮10：新案占位题注「图1为…总体流程图」不是 _desc_stub——按图号
    原位配对替换，否则旧题注与新题注并存成双题注（ViT 实案逮到）。"""
    from types import SimpleNamespace

    from app.agent.plans import s1
    from app.domain.projects import TEMPLATE_MD
    from patent_studio.kernel.ast import parse_ast

    d = SimpleNamespace(ast=parse_ast(TEMPLATE_MD, {}))
    blocks = s1.build_blocks(
        d,
        ["一种方法，其特征在于，包括真步骤一。"],
        {"技术领域": "本发明涉及真领域。", "背景技术": "背景一段。", "发明内容": "内容一段。",
         "附图说明": "图1为方法总体流程示意图。\n\n图2为系统架构示意图。\n\n"
                     "元件标号说明：101为采集模块。",
         "具体实施方式": "实施一段。"},
        "本发明公开真摘要不少于一百五十字。" * 8,
    )
    cap_rep = [b for b in blocks if b.replace_block_id
               and b.replace_block_id.startswith("description/附图说明/")]
    assert cap_rep and "总体流程示意图" in cap_rep[0].markdown
    applied = checks.apply_blocks(TEMPLATE_MD, SimpleNamespace(blocks=blocks).blocks)
    assert applied.count("图1为") == 1
    assert "总体流程示意图" in applied and "总体流程图" not in applied.replace("总体流程示意图", "")
    assert "图2为系统架构示意图" in applied and "元件标号说明" in applied


def test_s1_plan_figures_normalizes():
    """往复轮10：大纲 figures 字段只收 {num:int, title:str} 形，畸形条目剔除。"""
    from app.agent.plans import s1
    assert s1._plan_figures({"figures": [{"num": 1, "title": "流程图"},
                                         {"num": "2"}, {"n": 3}, "图4", 5]}) == [
        {"num": 1, "title": "流程图"}, {"num": 2, "title": ""}]
    assert s1._plan_figures({}) == [] and s1._plan_figures(None) == []



def test_s1_figsrc_sanitize_math_residue():
    """往复轮37：图源标签数学记号确定性剥除——ε_θ/q(x|y)/N(0,I)/‖·‖不进图，
    剥空节点回退 id、剥空边标签整段移除；中文元件名+标号保留。"""
    from app.agent.plans import s1
    src = ('flowchart LR\n'
           '    SCH["噪声调度单元 102<br/>预设噪声调度 β_t"]\n'
           '    X0["训练样本 x_0"] -->|"q(x_t|x_{t-1}) 加高斯噪声"| X1["x_T ~ N(0,I)"]\n'
           '    L["损失计算单元 108<br/>‖ε−ε_θ(x_t,t)‖² 加权期望"]\n'
           '    U["U-Net骨干网络 105"]\n')
    out = s1._sanitize_mmd(src)
    assert '噪声调度单元 102' in out and 'U-Net骨干网络 105' in out
    assert '损失计算单元 108' in out and '加权期望' in out
    for bad in ('β_t', 'x_0', 'x_t', 'x_{', 'ε_θ', '‖', 'N(0', '~', '\\'):
        assert bad not in out, bad
    assert '"X1"' in out            # 纯数学节点回退 id
    assert '|""|' not in out        # 空边标签不残留
    assert '-->|"加高斯噪声"|' not in out or 'q(' not in out


def test_s1_claims_multi_multi_detect():
    """往复轮39：多项从属再引多项从属的确定性检出——ddpm-4 实案型态。
    独权型「…执行权利要求1至N任一项」（四型束）不算从属不报；单引从属不算。"""
    from app.agent.plans import s1
    claims = [
        "一种图像生成模型的训练方法，其特征在于，包括步骤A与步骤B。",                # 1 独权
        "根据权利要求1所述的方法，其特征在于，步骤A包括子步骤。",                    # 2 单从属
        "根据权利要求1所述的方法，其特征在于，步骤B包括参数限定。",                  # 3 单从属
        "根据权利要求1或权利要求2所述的方法，其特征在于，加权期望按变分下界取权。",   # 4 多项从属
        "根据权利要求1至4任一项所述的方法，其特征在于，时间步经正弦嵌入注入。",       # 5 多项引多项→违规
        "一种图像生成系统，其特征在于，各模块被配置为执行权利要求1至5任一项所述方法的各步骤。",  # 6 独权型引用→不报
        "根据权利要求2所述的方法，其特征在于，骨干网络设自注意力层。",               # 7 单引从属→不报
    ]
    assert s1._multi_multi_violations(claims) == [(5, [4])]
    # 全单链无违规
    assert s1._multi_multi_violations(claims[:4]) == []


def test_s1_claim_ref_nums_range_expand():
    """往复轮39：「N至M」区间展开 + 自引剔除。"""
    from app.agent.plans import s1
    assert s1._claim_ref_nums("执行权利要求1至4任一项所述方法的各步骤", 9) == {1, 2, 3, 4}
    assert s1._claim_ref_nums("根据权利要求1或权利要求5所述的方法", 8) == {1, 5}
    assert s1._claim_ref_nums("根据权利要求1所述的方法", 1) == set()


def test_s1_claims_no_characterizing_detect():
    """往复轮109：缺「其特征在于」确定性检出——mamba 实案 s1 重写权项
    整族丢式（全 14 项独权带从权通篇无此短语）；检出即点名重弹补回。"""
    from app.agent.plans import s1
    claims = [
        "一种序列建模方法，包括：获取输入序列；构建状态空间模型。",        # 1 缺
        "根据权利要求1所述的方法，其特征在于，步骤A包括子步骤。",          # 2 有
        "根据权利要求1所述的方法，参数B为可学习参数。",                    # 3 缺
        "一种序列建模系统，其特征在于，各模块被配置为执行方法。",           # 4 有
    ]
    assert s1._no_characterizing(claims) == [1, 3]
    assert s1._no_characterizing(claims[1:2]) == []


def test_s1_claims_flat_gradient_detect():
    """往复轮41：从权平铺无梯度的确定性检出——ddpm-10 实案型态。
    簇≥3 且无一引在先从权→报；有任一链式递进→不报；独权型引用不算。"""
    from app.agent.plans import s1
    flat = [
        "一种图像生成模型的训练方法，其特征在于，包括步骤A与步骤B。",               # 1 独权
        "根据权利要求1所述的方法，其特征在于，步骤A包括子步骤。",                   # 2
        "根据权利要求1所述的方法，其特征在于，步骤B包括参数限定。",                 # 3
        "根据权利要求1所述的方法，其特征在于，损失取变分下界。",                    # 4
        "根据权利要求1所述的方法，其特征在于，时间步经正弦嵌入。",                  # 5 — 簇4全平引→报(1,4)
    ]
    assert s1._flat_gradient_violations(flat) == [(1, 4)]
    chained = flat[:3] + [
        "根据权利要求3所述的方法，其特征在于，参数限定进一步为σ调度。",             # 4 递进
        "根据权利要求1所述的方法，其特征在于，时间步经正弦嵌入。",                  # 5
    ]
    assert s1._flat_gradient_violations(chained) == []
    small = flat[:3]
    assert s1._flat_gradient_violations(small) == []   # 簇<3 不报


def test_s1_claims_type_bundle_detect():
    """往复轮43：独权类型组缺型确定性检出——resnet-8 型态四型齐备 0 命中。"""
    from app.agent.plans import s1
    full = [
        "1.一种图像识别方法，其特征在于，包括步骤。",            # 方法独权
        "2.根据权利要求1所述的方法，其特征在于，细节。",          # 从属不计
        "3.一种图像识别系统，其特征在于，包括模块。",            # 系统→装置族
        "4.一种电子设备，其特征在于，包括处理器与存储器。",        # 设备
        "5.一种计算机可读存储介质，其特征在于，存储有程序。",      # 介质
    ]
    assert s1._type_bundle_missing(full) == []
    missing = full[:2]
    assert s1._type_bundle_missing(missing) == ["装置", "设备", "介质"]
    # 从属权项即使名含系统/介质也不算独权
    sneaky = full[:2] + ["3.根据权利要求1所述的图像识别系统，其特征在于，模块细化。"]
    assert "装置" in s1._type_bundle_missing(sneaky)
    # 装置/程序产品同族互换
    alt = ["1.一种方法，其特征在于。", "2.一种处理装置，其特征在于。",
           "3.一种电子设备，其特征在于。", "4.一种计算机程序产品，其特征在于。"]
    assert s1._type_bundle_missing(alt) == []


def test_s1_eq_renumber_conflict():
    """往复轮48：跨书式号冲突确定性重编——resnet-9 实案 式(1) 权项指 y=F+x、
    实施方式指 F=H-x，后者换新号全段同步；一致的声明不重编。"""
    from app.agent.plans import s1
    claims = "1.一种方法：$$y=F(x,\\{W_{i}\\})+x$$（式(1)）。"
    taken = s1._eq_decls(claims)
    impl = ("步骤一：$$F(x)=H(x)-x$$式(1)\n\n步骤二：$$y=F(x,{Wi})+x$$式(2)，输出满足式(2)。"
            "\n\n步骤三：$$y=F(x,{Wi})+Ws·x$$式(3)")
    fixed = s1._eq_renumber(impl, taken)
    decl = s1._eq_decls(fixed)
    # 冲突的 式1/式2 已换新号、同号同式的引用同步；一致的 式3 保留
    assert "式(1)" not in fixed
    assert "式(3)" in fixed
    assert len(decl) == 3 and "F(x)=H(x)-x" in decl.values()
    # 引用同步：「输出满足式(2)」跟随局部 式2 的新号
    num2 = [k for k, v in decl.items() if v == "y=F(x,{Wi})+x"][0]
    assert f"输出满足式({num2})" in fixed
    # 无冲突段原样返回
    same = s1._eq_renumber("再次声明：$$y=F(x,\\{W_{i}\\})+x$$式(1)", taken)
    assert "式(1)" in same


def test_s1_table_checks():
    """往复轮48：表号重号换号+题注缺表体检出。"""
    from app.agent.plans import s1
    text = ("正文引表1：\n\n表1 配置表\n\n| 列 | 值 |\n\n"
            "下一张：\n\n表1 验证结果\n\n| 场景 | 结果 |\n\n表1中数据说明。")
    taken: set[str] = set()
    fixed = s1._retable(text, taken)
    assert "表1 配置表" in fixed and "表2 验证结果" in fixed
    assert "表2中数据说明" in fixed  # 引用随题注换号
    assert s1._tables_missing_body("表1 层配置表\n\n表1中，参数说明。")
    # 轮52 扩口径：仅表头一行无数据行 = 残表（resnet-10 实案表2）
    assert s1._tables_missing_body("表1 层配置表\n\n| 层 | 配置 |")
    assert not s1._tables_missing_body("表1 层配置表\n\n| 层 | 配置 |\n| 1 | 卷积 |")


def test_s1_detached_tables():
    """往复轮54：游离表片剥离——模型把表体堆在文末+纯文本重复版（vit-8 实案）。"""
    from app.agent.plans import s1
    text = ("表1 模块配置表\n\n| 模块 | 输出 |\n|---|---|\n| 切分模块101 | 图像块 |\n\n"
            "正文段落。\n\n综上所述，全文收束。\n\n"
            "|---|---|\n| 游离表头 | 值 |\n| 行1 | 甲 |\n\n"
            "|---|---|---|\n| 模块 | 对象 | 输出 |\n| 切分模块101 | 图像 | 块 |\n"
            "| 线性投影102 | 块 | 向量 |\n| 编码器103 | 向量 | 特征 |\n\n"
            "模块 对象 输出\n切分模块101 图像 块\n线性投影102 块 向量\n编码器103 向量 特征")
    out = s1._strip_detached_tables(text)
    assert "表1 模块配置表" in out and "| 切分模块101 | 图像块 |" in out  # 合法表保留
    assert "综上所述" in out and "正文段落" in out
    assert "游离表头" not in out and "行1" not in out  # 游离片剥除
    assert "| 模块 | 对象 | 输出 |" not in out          # 连续第二片同样剥除
    assert "线性投影102" not in out                   # 纯文本重复版剥除
    # 表区内散行段落保留（不属表块）
    t2 = "表2 对比表\n\n| 项 | 值 |\n\n方案A | 优 | 快\n\n方案B | 中 | 慢"
    assert s1._strip_detached_tables(t2) == t2
    # 无表文本原样
    t3 = "纯文本段落。\n\n另一段。"
    assert s1._strip_detached_tables(t3) == t3


def test_s1_table_zone_end():
    """往复轮54：表区末段判定——题注后连续含|段+散行段归区。"""
    from app.agent.plans import s1
    paras = ["表2 对比表", "| 项 | 值 |\n| a | b |", "方案A | 优 | 快", "综上所述正文"]
    assert s1._table_zone_end(paras, 0) == 2
    paras2 = ["表1 配置表", "表1中，说明文字。"]
    assert s1._table_zone_end(paras2, 0) == 0


def test_s1_table_refs_missing():
    """往复轮55：表号引用悬空检出——正文引「表N」但全文无题注（vit-9 实案表1）。"""
    from app.agent.plans import s1
    missing = "各模块参数如表1所示，按表1配置即可复现。\n\n综上所述，正文结束。"
    assert s1._table_refs_missing(missing) == ["1"]
    ok = "各模块参数如表1所示。\n\n表1 模块配置表\n\n| 模块 | 值 |\n|---|---|"
    assert s1._table_refs_missing(ok) == []
    assert s1._table_refs_missing("正文无表引用。") == []


def test_s1_extra_carrier_indeps():
    """往复轮56：功能载体独权并立检出——装置/系统/模型同族至多一项（vit-9 权6模型+权15装置）。"""
    from app.agent.plans import s1
    claims = [
        "一种基于Transformer的图像识别方法，其特征在于，包括步骤A。",
        "根据权利要求1所述的方法，其特征在于，P取16。",
        "一种基于Transformer的图像识别模型，其特征在于，包括单元X。",
        "一种电子设备，其特征在于，包括处理器和存储器。",
        "一种计算机可读存储介质，其特征在于，存储有计算机程序。",
        "一种基于Transformer的图像识别装置，其特征在于，包括模块Y。",
    ]
    assert s1._extra_carrier_indeps(claims) == [6]
    # 四型束正确案不命中
    clean = claims[:5]
    assert s1._extra_carrier_indeps(clean) == []
    # 模型独权计入装置族——四型束不因「模型替代装置」误报缺型
    fam = [claims[0], claims[2], claims[3], claims[4]]
    assert s1._type_bundle_missing(fam) == []


def test_s1_wrap_text_formulas():
    """往复轮57：纯文本公式行包 $$——vit-9 实施方式 `z_0=[x_class; …]　式(3)` 形。"""
    from app.agent.plans import s1
    out = s1._wrap_text_formulas(
        "如式(3)所示：\n\nz_0=[x_class; t′_1; …; t′_N]　式(3)\n\n式(3)中分号表示拼接。")
    assert "$$z_0=[x_class; t'_1; \\ldots; t'_N]$$式(3)" in out
    assert "式(3)中分号表示拼接" in out  # 引用散文不动
    # unicode 算符/上下标转写
    out2 = s1._wrap_text_formulas("N=H×W/P²　式(2)\n\nLN(x)=γ⊙(x−μ)/σ+β　式(6)")
    assert "$$N=H\\times W/P^2$$式(2)" in out2
    assert "\\gamma \\odot (x-\\mu )" in out2 or "\\odot" in out2
    # 已有 $$ 与散文段原样
    t3 = "已有 $$a=b$$式(1) 与散文。\n\n本段不含公式。"
    assert s1._wrap_text_formulas(t3) == t3


def test_s1_formulas_missing_body():
    """往复轮48：段末宣告公式而次段无 $$ 块 = 缺式检出（resnet-9 两处实案同型）。"""
    from app.agent.plans import s1
    assert s1._formulas_missing_body("输出y满足式(1)：\n\n本实施例还提供介质。")
    assert s1._formulas_missing_body("即：\n\n下一段正文。")
    assert not s1._formulas_missing_body("输出y满足式(1)：\n\n$$y=F+x$$式(1)")
    assert not s1._formulas_missing_body("满足式(1)，故可实施。")


def test_s1_eq_gap_renumber():
    """往复轮58：式号跳号顺位补齐+同式异号重申回正号（vit-10 式11断档/式12与式5同体）。"""
    from app.agent.plans import s1
    # 跳号：台账 1-10 后声明式12 → 归位式11，引用同步
    text = "如式(12)所示：\n\n$$z=f(x)$$式(12)\n\n再由式(12)推导。"
    taken = {str(i): f"body{i}" for i in range(1, 11)}
    out = s1._eq_renumber(text, taken)
    assert "$$z=f(x)$$式(11)" in out and "式(11)所示" in out and "式(11)推导" in out
    assert taken["11"] == "z=f(x)"
    # 同式异号重申：式体已在台账 → 回正号
    text2 = "$$N=HW/P^2$$式(12)\n\n按式(12)得结果。"
    taken2 = {"5": "N=HW/P^2"}
    out2 = s1._eq_renumber(text2, taken2)
    assert "式(5)" in out2 and "式(12)" not in out2
    # 正常续号不误伤：台账到 3，声明式4 原样
    out3 = s1._eq_renumber("$$a=b$$式(4)", {"1": "x", "2": "y", "3": "z"})
    assert "$$a=b$$式(4)" in out3


def test_s1_rejoin_caption_orphans():
    """往复轮58：三体分裂拼合+无题注表配号+孤头残段剥除（vit-10 实案表区）。"""
    from app.agent.plans import s1
    text = ("如表1所示：\n\n"
            "|处理位置|输入尺寸|输出尺寸|\n\n"
            "中间隔着的正文段落。\n\n"
            "表2 对比表\n\n"
            "| 项 | A | B |\n\n"
            "又一正文段。\n\n"
            "| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\n"
            "|---|---|---|\n|m1|x|y|\n|m2|x|y|")
    out = s1._strip_detached_tables(s1._caption_orphan_tables(s1._rejoin_split_tables(text), ["1"]))
    # 分隔线起首表块拼回孤儿表头 → 表1 题注配上（表头在前、分隔线+数据行归位）
    assert "表1\n\n|处理位置|输入尺寸|输出尺寸|\n|---|---|---|\n|m1|x|y|" in out
    # 纯数据行归并到同列数题注表（表2 头+分隔线+a 行一体）
    assert "表2 对比表\n\n| 项 | A | B |\n|---|---|---|\n| a1 | b1 | c1 |" in out
    assert not s1._table_refs_missing(out)


def test_s1_single_pipe_frag():
    """往复轮58：单行 | 残段识别——孤头必残，多行/无|不误伤。"""
    from app.agent.plans import s1
    assert s1._single_pipe_frag("|处理位置|输入|输出|")
    assert not s1._single_pipe_frag("|a|b|\n|---|---|")
    assert not s1._single_pipe_frag("普通正文段")
    assert not s1._single_pipe_frag("x | y")  # 单 | 不算


def test_s1_fused_caption_table_split():
    """往复轮59：题注与表体同段黏连（\n 连接）拆段归一——不再被当无题注表错插裸序号；
    紧随的等行集完整表按重发残件剥除（bert-14 实案融合+双发）。"""
    from app.agent.plans import s1
    text = ("如表1所示：\n\n"
            "表1 规模配置\n| 配置 | L | H |\n| A | 12 | 768 |\n| B | 24 | 1024 |\n\n"
            "| 配置 | L | H |\n| A | 12 | 768 |\n| B | 24 | 1024 |\n\n"
            "综上，本发明取得效果。")
    out = s1._strip_detached_tables(s1._caption_orphan_tables(s1._rejoin_split_tables(text), []))
    assert "表1 规模配置\n\n| 配置 | L | H |" in out
    assert "表2" not in out and "表4" not in out and "表5" not in out
    assert out.count("| B | 24 | 1024 |") == 1  # 重发残件去重
    assert not s1._table_refs_missing(out)


def test_s1_end_dump_pair_rebind():
    """往复轮59：文末 [数据组][头+数据] 成对堆叠——对塌留全 + 头行等值绑回题注表
    （bert-14 实案三表全堆文末；同列数会让按列归并错配最近题注）。"""
    from app.agent.plans import s1
    text = ("表1 配置表\n\n| 配置 | L | H |\n\n"
            "表2 替换规则\n\n| 处理 | 比例 |\n\n"
            "表3 评测结果\n\n| 任务 | 指标 |\n\n"
            "综上，本发明取得效果。\n\n"
            "| GLUE | 80 |\n| MNLI | 86 |\n\n"
            "| 任务 | 指标 |\n| GLUE | 80 |\n| MNLI | 86 |\n\n"
            "| MASK | 80% |\n| 随机 | 10% |\n\n"
            "| 处理 | 比例 |\n| MASK | 80% |\n| 随机 | 10% |\n\n"
            "| A | 12 | 768 |\n| B | 24 | 1024 |\n\n"
            "| 配置 | L | H |\n| A | 12 | 768 |\n| B | 24 | 1024 |")
    out = s1._strip_detached_tables(s1._caption_orphan_tables(s1._rejoin_split_tables(text), []))
    # 三张表各归各位：头行等值绑定到各自题注，文尾无残表堆
    assert "表1 配置表\n\n| 配置 | L | H |\n|---|---|---|\n| A | 12 | 768 |\n| B | 24 | 1024 |" in out
    assert "表2 替换规则\n\n| 处理 | 比例 |\n|---|---|\n| MASK | 80% |\n| 随机 | 10% |" in out
    assert "表3 评测结果\n\n| 任务 | 指标 |\n|---|---|\n| GLUE | 80 |\n| MNLI | 86 |" in out
    assert "表4" not in out and "表7" not in out
    assert not s1._table_refs_missing(out)


def test_s1_abstract_floor_pad():
    """往复轮59：摘要 <240 燃尽后从发明内容摘句并入——纯搬位、效果句仍居尾、不编造。"""
    from app.agent.plans import s1
    seg = ("一种图像识别方法，包括获取待识别图像并调用卷积神经网络提取特征表示的步骤。"
           "该模型包括编码器、分类器与输出层三部分构成。"
           "训练时以交叉熵损失对模型参数进行迭代更新，并对输入图像执行归一化与尺寸对齐预处理。"
           "推理阶段对特征表示进行全局池化后送入分类器，输出各类别的置信度分数。"
           "模型部署时可运行于电子设备与可读存储介质之上，支持批量图像的并发识别处理。"
           "系统还包括与模型配套的参数管理单元与结果缓存单元，分别用于模型加载与中间结果复用。")
    a4 = "本发明涉及一种图像识别方法。包括获取图像、提取特征、分类识别。从而提高识别准确率。"
    out = s1._abstract_floor_pad(a4, seg)
    assert len(out) >= 240
    assert "编码器、分类器与输出层" in out  # 摘句并入
    assert out.rstrip().endswith("提高识别准确率。")  # 效果句居尾
    # 已达下限不动
    long_a = "本发明涉及一种图像识别方法。" + "其包括图像获取、特征提取、分类识别与结果输出等步骤，" * 10
    assert len(long_a) >= 240 and s1._abstract_floor_pad(long_a, seg) == long_a


def test_s1_math_pipes_not_phantom_cols():
    """往复轮60：$$..$$ 内 |V| 数学记号不算表格列——纯散文段不得被误判为
    孤儿表头残段，sep-led 数据不得灌进散文（bert-15 实案）。"""
    from app.agent.plans import s1
    prose = ("掩码语言模型单元105取编码器堆叠104在被遮盖位置$$i\\in\\mathcal{M}$$的"
             "输出向量$$h_i^{(L)}$$，经线性映射$$W_{mlm}\\in\\mathbb{R}^{H\\times|\\mathcal{V}|}$$"
             "与偏置$$b_{mlm}\\in\\mathbb{R}^{|\\mathcal{V}|}$$得到得分向量。")
    assert not s1._is_table_block(prose)
    assert not s1._single_pipe_frag(prose)
    assert s1._pipe_cols(prose) == 0
    assert s1._single_pipe_frag("| 处理方式 | 执行概率 | 处理内容 |")


def test_s1_bodiless_caption_frag_rebind():
    """往复轮60：题注后仅表头行、表体 sep-led 堆文末——按「空体题注优先」归位；
    同列数题注并存时先到数据先得体，后到数据归剩余空体（bert-15 实案四表全归位）。"""
    from app.agent.plans import s1
    text = (
        "表1 子层构成\n\n| 子层 | 运算 | 输入 | 输出 |\n\n"
        "表2 处理策略\n\n| 处理方式 | 概率 | 内容 |\n\n"
        "表3 规模配置\n\n| 配置 | L | H | A | d | F | P |\n\n"
        "表4 性能指标\n\n| 任务 | 指标 | 数值 |\n\n"
        "综上，本方案取得效果。\n\n"
        "| GLUE | 得分 | 80.5% |\n| SQuAD | F1 | 93.2 |\n\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n| 配置一 | 12 | 768 | 12 | 64 | 3072 | 110M |\n\n"
        "| --- | --- | --- |\n| 替换为MASK | 80% | 替换为特殊token |\n| 随机替换 | 10% | 随机token |\n\n"
        "| --- | --- | --- | --- |\n| 自注意力子层 | 缩放点积 | BxT | BxT |\n")
    out = s1._strip_detached_tables(s1._caption_orphan_tables(s1._rejoin_split_tables(text), []))
    assert "| 子层 | 运算 | 输入 | 输出 |\n|---|---|---|---|\n| 自注意力子层 |" in out
    assert "| 处理方式 | 概率 | 内容 |\n|---|---|---|\n| 替换为MASK |" in out
    assert "| 配置 | L | H | A | d | F | P |\n|---|---|---|---|---|---|---|\n| 配置一 |" in out
    assert "| 任务 | 指标 | 数值 |\n|---|---|---|\n| GLUE | 得分 | 80.5% |\n| SQuAD | F1 | 93.2 |" in out
    # 表4 的 GLUE 行不得混入表2 的遮盖数据；文末不得残留孤儿块
    assert out.count("替换为MASK") == 1 and out.count("GLUE") == 1
    assert not s1._table_refs_missing(out)


def test_retitle_strips_meta_tail():
    """bert-12 实案迭代标记漏进书题——尾括注剥除、题中「验证」词不受影响、占位题面仍兜底。"""
    from app.agent import proposals
    body = "\n\n## 摘要\n\n甲"
    assert proposals._retitle(
        "# 一种基于双向Transformer的文本语义编码方法及装置（轮33验证）" + body
    ).split("\n")[0] == "# 一种基于双向Transformer的文本语义编码方法及装置"
    assert proposals._retitle(
        "# 一种数据处理方法及装置(实验版v3)（轮5验证）" + body
    ).split("\n")[0] == "# 一种数据处理方法及装置"
    # 题中「验证」词与合法题名不动
    assert proposals._retitle("# 一种图像验证方法" + body).split("\n")[0] == "# 一种图像验证方法"
    assert proposals._retitle("# 一种图像识别方法及装置" + body).split("\n")[0] == "# 一种图像识别方法及装置"


def test_wrap_pipe_frag_tables():
    """bert-12 实案：配置表按散文段落逐行发出（无首|/分隔线/题注），裸|直印正文——
    残段游程回包成表、配裸题注、挪到 表N 引用段后；无引用/列不齐/散文不触发。"""
    from app.agent.plans import s1
    text = ("实施例一：两种规模配置如表1所示。\n\n"
            "其他说明段。\n\n"
            "配置名称 | 层数L | 隐藏维H | 注意力头数A | 参数规模\n\n"
            "BERT-BASE | 12 | 768 | 12 | 约110M\n\n"
            "BERT-LARGE | 24 | 1024 | 16 | 约340M\n\n"
            "收尾段。")
    out = s1._wrap_pipe_frag_tables(text)
    assert "| 配置名称 | 层数L |" in out and "| BERT-BASE | 12 |" in out
    assert "如表1所示。\n\n表1\n\n| 配置名称" in out  # 题注+表随引用段归位
    assert not s1._table_refs_missing(out)
    assert "收尾段。" in out
    # 负例一：无 表N 引用 → 裸行保留不包表（不让表体无题注遭游离剥离丢数据）
    neg = "配置名称 | a | b\n\nx | 1 | 2"
    assert s1._wrap_pipe_frag_tables(neg) == neg
    # 负例二：散文含数学 | 记号不触发
    assert s1._wrap_pipe_frag_tables("句中 $a|b$ 是数学。") == "句中 $a|b$ 是数学。"
    # 负例三：题注已有且有体表 → 残段无锚可配，保留原样不动
    has = ("如表1所示。\n\n表1 配置\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n"
           "x | 1 | 2\n\ny | 3 | 4")
    assert s1._wrap_pipe_frag_tables(has) == has
    # bert-12 真型：题注在但表体缺——残段包表直插题注段后（题注锚优先于引用锚）
    caponly = ("实施例一：两种规模配置如表1所示。\n\n"
               "表1 双向Transformer编码器堆叠104的规模配置\n\n"
               "其他说明段若干。\n\n"
               "配置名称 | 层数L | 隐藏维H | 注意力头数A | 参数规模\n\n"
               "BERT-BASE | 12 | 768 | 12 | 约110M\n\n"
               "BERT-LARGE | 24 | 1024 | 16 | 约340M\n\n"
               "收尾段。")
    o2 = s1._wrap_pipe_frag_tables(caponly)
    assert "规模配置\n\n| 配置名称" in o2
    assert o2.count("BERT-BASE") == 1 and "收尾段。" in o2


def test_clean_abstract_normalizes_opening():
    from app.agent.plans.s1 import _clean_abstract
    assert _clean_abstract("本申请公开了一种方法。从而提高了效率。").startswith("本发明公开")
    assert _clean_abstract("本发明公开了一种方法。").startswith("本发明公开")
    # 非起句的「本申请」不碰（罕见但保留原义）
    t = _clean_abstract("本发明公开方法，本申请范围包括变体。")
    assert "本申请范围" in t


def test_promo_covers_benchmark_boasts():
    from patent_studio.kernel.preflight import _PROMO_RE
    for w in ("刷新纪录", "创下纪录", "打破纪录", "世界纪录", "先进水平", "SOTA"):
        assert _PROMO_RE.search(w), w
    # 实验数据陈述不判宣传
    assert not _PROMO_RE.search("在 GLUE 基准上取得 80.5% 的分数")
    assert not _PROMO_RE.search("刷新输入缓冲区")


def test_self_ref_unified_to_benfaming():
    # 自称归一口径：本申请→本发明（说明书与权项同制）
    src = "[0001] 本申请涉及一种方法。本申请还提供装置。"
    assert "本申请" not in src.replace("本申请", "本发明")
    assert src.replace("本申请", "本发明").count("本发明") == 2


def test_wrap_eq_lead_inline_to_display():
    from app.agent.plans.s1 import _wrap_text_formulas
    src = "式(1)：$E_i=T_i+S_i+P_i$。\n\n式(2): $h_i^l=Enc_l(h^{l-1})$\n\n式(1)中，$E_i$ 为输入表示。"
    out = _wrap_text_formulas(src)
    assert "$$E_i=T_i+S_i+P_i$$式(1)" in out
    assert "$$h_i^l=Enc_l(h^{l-1})$$式(2)" in out
    # 后随释文段的行内引用不动
    assert "式(1)中，$E_i$ 为输入表示。" in out


def test_wrap_eq_lead_display_and_markup():
    from app.agent.plans.s1 import _wrap_text_formulas
    src = ("{++式(1)：$$E_i = T_i + S_i + P_i$$++}\n\n"
           "式(2)：$$h=Enc(x)$$\n\n"
           "式(1)中，$E_i$ 为输入表示。")
    out = _wrap_text_formulas(src)
    assert "{++$$E_i = T_i + S_i + P_i$$式(1)++}" in out
    assert "$$h=Enc(x)$$式(2)" in out
    assert "式(1)中" in out


def test_mark_name_abbr_parens_not_drift():
    from patent_studio.kernel import preflight
    from patent_studio.kernel.ast import parse_ast
    # bert-15 实案：图例带（NSP）括注 vs 正文裸名——定义性注释非漂移
    text = ("# 一种方法\n\n## 摘要\n\n一种方法。\n\n## 权利要求书\n\n1.一种方法，包括下一句预测单元107。\n\n"
            "## 说明书\n\n### 具体实施方式\n\n"
            "下一句预测（NSP）单元107构造句对；下一句预测单元107判断后续。\n\n"
            "元件标号说明：107为下一句预测（NSP）单元。\n")
    r = preflight.run(parse_ast(text, None))
    assert not [i for i in r["items"] if i["rule"] == "numerals.inconsistent"]


def test_mark_name_true_drift_still_flags():
    from patent_studio.kernel import preflight
    from patent_studio.kernel.ast import parse_ast
    # resnet-4 实案：同号异基名——真漂移仍报
    text = ("# 一种方法\n\n## 摘要\n\n一种方法。\n\n## 权利要求书\n\n1.一种方法，包括残差单元102。\n\n"
            "## 说明书\n\n### 具体实施方式\n\n"
            "特征提取单元102接收输入；深度残差模块102输出结果。\n")
    r = preflight.run(parse_ast(text, None))
    hits = [i for i in r["items"] if i["rule"] == "numerals.inconsistent"]
    assert hits and "特征提取单元" in hits[0]["message"]


def test_s1_build_blocks_redraft_replaces_in_place():
    """往复轮83：已成稿案重跑 s1——既有真权项/真正文段按序原位替换而非追加，
    不再出现 1-7 旧稿 + 8-18 新稿并存重复（ddpm-13 实案）。"""
    from types import SimpleNamespace

    from app.agent.plans import s1
    from patent_studio.kernel.ast import parse_ast

    drafted = (
        "# 一种方法\n\n## 摘要\n\n本发明公开一种旧摘要。\n\n"
        "## 权利要求书\n\n1.一种旧方法，其特征在于，旧步骤。\n\n2.根据权利要求1所述的旧方法，其特征在于，旧限定。\n\n"
        "## 说明书\n\n### 技术领域\n\n本申请涉及旧领域。\n\n"
        "### 背景技术\n\n旧背景一段。\n\n"
        "### 发明内容\n\n旧内容一段。\n\n"
        "### 附图说明\n\n图1为旧示意图。\n\n"
        "### 具体实施方式\n\n旧实施一段。"
    )
    d = SimpleNamespace(ast=parse_ast(drafted, {}))
    blocks = s1.build_blocks(
        d,
        ["一种新方法，其特征在于，新步骤。",
         "根据权利要求1所述的新方法，其特征在于，新限定。",
         "根据权利要求2所述的新方法，其特征在于，再限定。"],
        {"技术领域": "本发明涉及新领域。", "具体实施方式": "新实施一段。\n\n新实施二段。"},
        "本发明公开新摘要。",
    )
    claim_reps = [b for b in blocks if b.replace_block_id and b.replace_block_id.startswith("claims/")]
    # 旧 2 权被原位替换，新第 3 权追加在最后被替换块之后——编号仍连续 1-3
    assert [b.replace_block_id for b in claim_reps] == ["claims/1", "claims/2"]
    assert claim_reps[0].markdown.startswith("1.")
    assert claim_reps[1].markdown.startswith("2.")
    tail = [b for b in blocks if not b.replace_block_id and "再限定" in b.markdown]
    assert [b.after_block_id for b in tail] == ["claims/2"]
    assert tail[0].markdown.startswith("3.")
    # 说明书既有段原位替换；摘要首段亦然
    assert any(b.replace_block_id and b.replace_block_id.startswith("description/技术领域/")
               and "新领域" in b.markdown for b in blocks)
    assert any(b.replace_block_id == "abstract/p1" and "新摘要" in b.markdown for b in blocks)
    # 端到端：虚拟应用后旧稿痕迹清零、无重复权项
    applied = checks.apply_blocks(drafted, SimpleNamespace(blocks=blocks).blocks)
    assert "旧步骤" not in applied and "旧摘要" not in applied and "旧实施" not in applied
    assert applied.count("其特征在于") == 3


def test_claim_subject_typesuffix_at_clause_boundary():
    """往复轮84：独权类型钉句读边界——「一种…概率模型的训练方法」的类型是方法而非
    撞在前的「模型」；此前惰性匹配使装置缺型核对+载体并立检出双双失效（ddpm-13 实案）。"""
    from app.agent.plans import s1

    claims = [
        "1.一种去噪扩散概率模型的训练方法，其特征在于，包括：步骤A；步骤B。",
        "9.一种电子设备，其特征在于，包括处理器与存储器，所述存储器存储有计算机程序。",
        "10.一种计算机可读存储介质，其特征在于，所述存储介质存储有计算机程序。",
    ]
    assert s1._type_bundle_missing(claims) == ["装置"]
    assert s1._extra_carrier_indeps(claims) == []
    # 真装置/系统/模型独权仍被识别
    assert s1._extra_carrier_indeps(claims + ["11.一种扩散模型训练装置，其特征在于，包括：模块X。",
                                            "12.一种扩散模型训练系统，其特征在于，包括：模块X。"]) == [5]
    assert s1._type_bundle_missing(claims + ["11.一种扩散模型训练装置，其特征在于，包括：模块X。"]) == []


def test_normalize_claim_order_clusters_and_carrier_refs():
    """往复轮85：独权簇分散（1-4 全独权、从权 5-14 后置）时重排为「独权+从权簇」
    惯例序并改写引用号；载体权「所述方法」引用归一至方法族全块——ddpm-r84 实案
    权3/4 引「权利要求1至2任一项所述方法」把系统独权拽进方法范围。"""
    from app.agent.plans import s1

    claims = [
        "1.一种X方法，其特征在于，包括：步骤A。",
        "2.一种X系统，其特征在于，包括模块M，被配置为执行权利要求1所述方法。",
        "3.一种电子设备，其特征在于，包括处理器与存储器，所述计算机程序被处理器执行时实现权利要求1至2任一项所述方法。",
        "4.一种计算机可读存储介质，其特征在于，所述计算机程序被处理器执行时实现权利要求1至2任一项所述方法。",
        "5.根据权利要求1所述的X方法，其特征在于，步骤A包括子步骤A1。",
        "6.根据权利要求5所述的X方法，其特征在于，子步骤A1包括子步骤A2。",
        "7.根据权利要求2所述的X系统，其特征在于，还包括输入单元。",
        "8.根据权利要求3所述的电子设备，其特征在于，所述存储器还存储参数表。",
    ]
    assert s1._carrier_method_ref_violations(claims) == [3, 4]
    out = s1._normalize_claim_order(claims)
    # 簇序：方法1+从权2,3 → 系统4+从权5 → 设备6+从权7 → 介质8
    heads = [c.split("，其特征", 1)[0] for c in out]
    assert heads == [
        "1.一种X方法", "2.根据权利要求1所述的X方法", "3.根据权利要求2所述的X方法",
        "4.一种X系统", "5.根据权利要求4所述的X系统",
        "6.一种电子设备", "7.根据权利要求6所述的电子设备",
        "8.一种计算机可读存储介质"]
    # 引用号改写：方法从权链 5→2、6→3；系统从权引 2→4；设备从权引 3→6
    assert "权利要求1至3任一项所述方法" in out[5]
    assert "权利要求1至3任一项所述方法" in out[7]
    # 合法单引保留不动（系统权「执行权利要求1所述方法」不改写至全块）
    assert "执行权利要求1所述方法" in out[3]
    assert s1._carrier_method_ref_violations(out) == []
    # 已成惯例序的表归位为恒等
    assert s1._normalize_claim_order(out) == out


def test_wrap_bare_latex_commands():
    """往复轮86：$ 界定符外的裸 LaTeX 命令包壳——ddpm-r85 实案 [0048]
    `\\bar{\\alpha}t` 原样印进正文；已包壳串不动。"""
    from app.agent.plans import s1

    t = "训练与采样共用同一组βt、αt、\\bar{\\alpha}t与σt2；均值 $\\mu_\\theta$ 已定。"
    out = s1._wrap_bare_latex(t)
    assert "$\\bar{\\alpha}t$" in out
    assert out.count("$\\mu_\\theta$") == 1
    assert "\\bar{\\alpha}t与" not in out
    # $$ 块内的命令不重包
    t2 = "误差为 $$\\|e-e_t\\|^2$$ 与 \\frac{a}{b} 两式。"
    out2 = s1._wrap_bare_latex(t2)
    assert "$$\\|e-e_t\\|^2$$" in out2
    assert "$\\frac{a}{b}$" in out2
    # 范式串整收（\\|…\\|^2 后续命令一并入壳），CJK 边界停
    t3 = "损失为\\|\\varepsilon-\\varepsilon_\\theta(x_t,t)\\|^2的加权期望。"
    out3 = s1._wrap_bare_latex(t3)
    assert "$\\|\\varepsilon-\\varepsilon_\\theta(x_t,t)\\|^2$" in out3
    assert "^2$的加权" in out3
    # 无命令文本恒等
    assert s1._wrap_bare_latex("纯文本无命令。") == "纯文本无命令。"


def test_semantic_tab_refs_renumber():
    """往复轮88：表引用语境档位与题注档位冲突时改号——bert-15 实案
    「测试指标如表1所示」表1=结构类（指标在表4）；bert-14 同型。"""
    from app.agent.plans import s1

    text = ("表1 编码器层的子层构成与维度演进\n\n| 层 | 维度 |\n| - | - |\n| a | 1 |\n\n"
            "表4 预训练语言表示模型在部分NLP任务上的性能指标\n\n| 任务 | 指标 |\n| - | - |\n| a | 1 |\n\n"
            "其中部分任务的测试指标如表1所示。\n\n"
            "子层构成见表1。\n\n"
            "性能数据见表4。")
    out = s1._fix_semantic_tab_refs(text)
    assert "测试指标如表4所示" in out
    assert "子层构成见表1" in out
    assert "性能数据见表4" in out
    # 语境两档兼具不盲改
    ambi = ("表1 编码器层结构配置\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n"
            "表2 任务性能指标\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n"
            "结构配置与性能指标见表1。")
    assert "见表1" in s1._fix_semantic_tab_refs(ambi)
    # 裸表号桩算题注 → 缺表体核对收留
    assert s1._TAB_CAPTION.match("{++表4++}")
    assert s1._tables_missing_body("{++表4++}\n\n正文段落。")


def test_s1_figures_caption_para_explode():
    """模型把整组题注写进同一段（单换行）——拆段后旧题注按图号逐个原位替换、
    未配对新题注顺接题注块而非沉节尾，不再只替首块残留旧题注成双题注（unet-seg 实案）。"""
    from types import SimpleNamespace

    from app.agent.plans import s1
    from patent_studio.kernel import critic
    from patent_studio.kernel.ast import parse_ast

    old = (
        "# 一种方法\n\n## 摘要\n\n本发明公开旧摘要。\n\n"
        "## 权利要求书\n\n1.一种方法，其特征在于，步骤。\n\n"
        "## 说明书\n\n### 技术领域\n\n本发明涉及领域。\n\n"
        "### 背景技术\n\n旧背景。\n\n### 发明内容\n\n旧内容。\n\n"
        "### 附图说明\n\n图1为旧图一。\n\n图2为旧图二。\n\n图3为旧图三。\n\n图4为旧图四。\n\n"
        "### 具体实施方式\n\n旧实施。")
    d = SimpleNamespace(ast=parse_ast(old, {}))
    blocks = s1.build_blocks(
        d,
        ["一种方法，其特征在于，步骤。"],
        {"技术领域": "本发明涉及新领域。",
         "附图说明": "图1为新图一；\n图2为新图二；\n图3为新图三；\n图4为新图四；\n图5为新图五。\n\n"
                     "元件标号说明：101为模块。",
         "具体实施方式": "新实施。"},
        "本发明公开新摘要不少于一百五十字。" * 6)
    accepted = critic.accept(checks.apply_blocks(old, SimpleNamespace(blocks=blocks).blocks))
    for i in range(1, 6):
        assert accepted.count(f"图{i}为") == 1, i
    assert "旧图" not in accepted
    assert "元件标号说明" in accepted
    # 新图5 顺接题注组后、标号说明收尾——不跑到其他章节尾巴上
    i5, il = accepted.find("图5为新图五"), accepted.find("元件标号说明")
    assert -1 < i5 < il


def test_s1_figsrc_sanitize_dimension_guard():
    """往复轮102：N×N/N÷N 维度记号非数学残渣——unet-seg fig2 实案
    `1×1卷积分类层` 被剥成 `11卷积分类层`。"""
    from app.agent.plans import s1
    src = 'flowchart TD\n  CLS[1×1卷积分类层 105] --> POOL[2×2池化] --> UP[上采样×2]'
    out = s1._sanitize_mmd(src)
    assert '1×1卷积分类层 105' in out
    assert '2×2池化' in out
    assert '上采样×2' in out      # 单侧邻数字的倍率记号同样保留
    # 非维度 × 仍剥（数学乘号残渣）
    out2 = s1._sanitize_mmd('flowchart TD\n  A[a×b运算] --> B')
    assert 'a×b' not in out2
