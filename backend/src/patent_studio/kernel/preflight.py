# -*- coding: utf-8 -*-
"""递交前体检（R2.5）：AST → PreflightReport，纯确定性规则，无 AI。

契约与规则清单见 docs/plan/05-r2-figures-preflight-design.md §3.2 / §4：
  run(ast, settings) -> {"version": 1, "items": [...], "counts": {...}, "claim_tree": [...],
                         "numerals": [...], "support_map": [...], "figures": [...]}
  scan_refs(ast) -> [{"book", "line"(全文), "num", "text"}]   # 「图N」引用，附图删除守卫与 figures.* 规则共用
所有 line 均为全文行（书内相对行 + books[book].offset）。
app/lint.py 把 items 映射为 Diagnostic（id = "preflight.<rule>#<n>"）并入 lint 输出。

W5 R-CHK-02 / R-FIG-02（docs/plan/21-w5-spec.md §2.1；A3 形式项默认 warning）：
  spec.section_missing（error）/ spec.section_order / spec.promo_wording /
  claims.figure_ref / claims.no_characterized / claims.promo_wording / abstract.elements_missing /
  numerals.mark_not_in_spec / numerals.spec_not_in_marks（figures.md 每图 marks 表 ↔ 说明书正文标记）。
  每条 item 带 para_no（说明书段号；非说明书段落为 None）；settings["preflight"]["disabled"] 列出的规则跳过。
"""
import re

VERSION = 1

BOOK_NAMES = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}

_FIG_REF_RE = re.compile(r"图(\d+)")

# §4.1 附图标记：名称 + 3~4 位数字，后面不跟数字/小数点/斜杠/百分号/单位量词/字母
_NUMERAL_RE = re.compile(
    r"([一-龥]+)(\d{3,4})"
    r"(?![\d.%/A-Za-z×xX条个次项种组例台人行列页位维轮段层步天倍万年月日时分秒毫元米克吨度])"
)
_NUMERAL_CHAIN_RE = re.compile(
    r"(至|到|、|与|和|及|或)(\d{3,4})"
    r"(?![\d.%/A-Za-z×xX条个次项种组例台人行列页位维轮段层步天倍万年月日时分秒毫元米克吨度])"
)
# 算术/尺寸字面量不是标号：ddpm-13 实案「整型像素值除以255」「乘以255」
# 「数据集256×256分辨率」把数值当标号用例触发 numerals.inconsistent 误报。
# 词尾为算术语境（除以/乘以/约/达/超/近/比/每/值）的 CJK 串接数字视为数值；
# 数字后随 ×/x/X 的尺寸链（256×256）由 lookahead 排除。
_NAME_ARITH_END = ("以", "约", "达", "超", "近", "比", "每", "值")
_LEGEND_MARK = ("标号说明", "标记说明")
_LEGEND_RE = re.compile(r"(?:^|[；;，,：:])\s*(\d{3,4})为([^；;，,。]+)")
# 名称里的 ASCII 括注缩写（（NSP）/(MLM)）是定义性注释不是名变体——bert-15 实案
# 图例「107为下一句预测（NSP）单元」vs 正文「下一句预测单元107」被误判漂移
_NAME_ABBR_RE = re.compile(r"[（(]\s*[A-Za-z][A-Za-z0-9\- ]*[)）]")


# 名称前缀里的功能字：连词 / 介词 / 谓词。先按多字词切到最后一个，再剥掉开头的单字功能字
_NAME_CUT_WORDS = ("所述", "包括", "包含", "其中", "通过", "以及", "或者", "并且", "具有", "设有", "用于",
                   "连接", "承载", "装载", "形成", "构成", "组成", "对应", "作为", "分别", "还有",
                   # 纯动词前缀（不会作元件名语素）——接入/处理/传输等会作元件名尾的不能加
                   "送入", "经过", "共享", "二者", "两者", "根据", "依据", "借助", "返回", "提供",
                   "完成", "判断", "调用", "送至", "决定")
_NAME_STRIP_CHARS = set("在与和及以含为包括承载至到约共达对经由将把从向于或的上中后前即则等各该是有并且而使被让享")
_NAME_CUT_CHARS = set("的与和及或并为即是有在将把从向于由经至到含")

# §4.2 支持性：权项「所述X」，X 取 2~20 字；先在第一个连接字处截断（保留 ≥2 字），再对说明书做最长前缀匹配
_TERM_RE = re.compile(r"所述的?((?:(?!所述)[一-龥A-Za-z0-9_\-]){2,20})")
_TERM_CUT_CHARS = set("的与和及或并且而为是在将把从向于对由经至到被使还等即则各该含用")

_ABSTRACT_LIMIT_DEFAULT = 300


def limit_abstract(text: str, limit: int = 290) -> str:
    """CNIPA 摘要 ≤300 字生成侧兜底：超限在最近标点边界截断（校验规则见 _check_abstract，
    默认 290 留复检余量）。s1/convert 两条生成链共用——convert 曾无此兜底，
    摘要 309 字两次回修仍超限即整案报废（sam2 实案 ai_format 失败）。"""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for mark in ("。", "；", "，", ","):
        i = cut.rfind(mark)
        if i >= limit // 3:
            return cut[: i + 1]
    return cut


_ABS_OPEN = re.compile(r"^\s*本(?:申请|实用新型)(公开|涉及|实施|提出|提供)")


def normalize_self_ref(text: str) -> str:
    """自称归一「本发明」：语料首自称 本发明:本申请 ≈ 3:1 且「本发明」处处合法，
    两书自称混用即族内不一致（bert-12/sam2 实案 convert 草稿通篇本申请）。
    起句另有「本实用新型…」漂移时同归。s1 段内同义替换多年，本函数为两链共用出口。"""
    if not text:
        return text
    return _ABS_OPEN.sub(r"本发明\1", text.replace("本申请", "本发明"))

# 细则 §20 说明书五段：技术领域 → 背景技术 → 发明内容 → 附图说明 → 具体实施方式（part 见 cnipa_xml.SECTION_ELEMENTS）
_SECTION_ORDER = ("technical-field", "background-art", "disclosure", "description-of-drawings", "mode-for-invention")
_SECTION_TITLES = {"technical-field": "技术领域", "background-art": "背景技术", "disclosure": "发明内容",
                   "description-of-drawings": "附图说明", "mode-for-invention": "具体实施方式"}
# 审查指南第二部分第二章 2.2.7：说明书不得使用商业性宣传用语。「最佳实施」是惯用语（best mode）不算
# 竞赛名次/排行榜类自我标榜（resnet-10 实案「ILSVRC 2015 第一名」照搬论文）同归宣传口径——
# 语料 ~3.6% 授权件含此类词（多为现有技术引述），故随 _PROMO_RE 保持 warning 级
_PROMO_RE = re.compile(
    r"最佳(?!实施|模式)|最先进|最优秀|最好的|首创|独创|国际领先|国内领先|世界领先|业界领先|遥遥领先|前所未有"
    r"|独一无二|无与伦比|史无前例|划时代|革命性|颠覆性|完美|一流|顶级|卓越|极致"
    r"|第一名|冠军|榜首|排行榜|ILSVRC"
    # 基准超群式自我标榜——论文 SOTA 话术，语料 0 件出现（bert-12 实案「刷新纪录」）
    r"|刷新纪录|创下纪录|打破纪录|世界纪录|新纪录|纪录水平|纪录性能|先进水平|顶尖水平|SOTA"
)
_CLAIM_FIG_REF_RE = re.compile(r"如(?:附)?图|参见(?:附)?图|见附图")
# 细则 §23 摘要四要素的用词特征
_ABSTRACT_ELEMENTS = (
    ("技术领域", re.compile(r"领域|涉及|属于|公开了?一种|提供了?一种|提出了?一种")),
    ("技术问题", re.compile(r"问题|解决|克服|针对|不足|缺陷|难以|无法|防止|避免|应对")),
    ("技术方案", re.compile(r"包括|包含|步骤|通过|采用|设有|其中|由.{1,20}组成|配置为|技术方案|方案要点|要点为|"
                   r"该方法|所述方法|步骤为")),
    ("有益效果", re.compile(r"提高|提升|降低|减少|减小|改善|增强|优化|保证|确保|实现|有效|效果|优点|有利于|便于|"
                          r"能够|可靠|稳定|准确|精度|效率|成本|安全|受控|"
                          # 效果收束连接词与呈现类动词——s1 成稿规约末句以「从而/使得…的效果」
                          # 收尾（itransformer 实案「从而使得…呈现可解释的变量间相关性」被误报）
                          r"从而|使得|呈现|支持|泛化|扩展")),
)
_MARK_RE = re.compile(r"\d{3,4}")


# ---------------- 「图N」引用 ----------------

from patent_studio.kernel._preflight_checks import (  # noqa: F401 — 回引保留原命名空间
    _CAPTION_DECL_RE,
    _EQ_TAG_RE,
    _EQ_TRAIL_RE,
    _MARK_BIND_RE,
    _META_WORDS,
    _META_WORDS_DRAWINGS,
    _PAPER_TONE,
    _TAB_CAPTION_LINE_RE,
    _TAB_REF_RE,
    _abbr,
    _accept_markup,
    _alias_normalizer,
    _block_line,
    _check_abstract,
    _check_claim_form,
    _check_claims,
    _check_corpus_overlap,
    _check_equations,
    _check_figures,
    _check_figures_md,
    _check_inline_figs,
    _check_legal_rhythm,
    _check_marks,
    _check_meta_wording,
    _check_numerals,
    _check_paper_tone,
    _check_spec_form,
    _check_spec_numbering,
    _check_support,
    _claim_targets,
    _claim_text,
    _consistent,
    _formula_norm,
    _full,
    _numeral_name,
    _numeral_usages,
    _promo_hits,
    _Report,
    _term,
    scan_refs,
)

# ---------------- 报告 ----------------

def disabled_rules(settings):
    """studio.json → settings["preflight"]["disabled"]：要跳过的规则名列表（缺省无）。"""
    pf = (settings or {}).get("preflight")
    if not isinstance(pf, dict):
        return frozenset()
    return frozenset(str(r) for r in (pf.get("disabled") or []))


# ---------------- 附图标记 ----------------

# ---------------- 支持性 ----------------

def run(ast, settings=None, terms=None, figs=None, figures=None):
    """terms（terms.json 的 terms 列表，可省略）：支持性匹配前把权项与说明书中的别名归一为主名。
    figs（figs/ 目录文件名列表，可省略）：figures.file_missing 用；None = 不查文件存在性。
    figures（figures_md.FiguresDoc，可省略）：每图 marks 表，numerals.mark_not_in_spec / spec_not_in_marks 用；
    None = 不查。"""
    _accept_markup(ast)
    rep = _Report(disabled_rules(settings))
    _check_abstract(ast, settings, rep)
    tree = _check_claims(ast, rep)
    _check_claim_form(ast, rep)
    _check_equations(ast, rep)
    _check_spec_numbering(ast, rep)
    _check_legal_rhythm(ast, rep)
    _check_spec_form(ast, rep)
    _check_meta_wording(ast, rep)
    _check_paper_tone(ast, rep)
    _check_corpus_overlap(ast, rep)
    fig_rows = _check_figures(ast, rep)
    _check_figures_md(ast, figs, rep)
    _check_inline_figs(ast, figs, rep)
    numerals = _check_numerals(ast, rep)
    _check_marks(ast, figures, rep)
    support = _check_support(ast, rep, terms)
    # 支持性规则在树构建之后才命中，补回 issues
    for node in tree:
        node["issues"] = rep.claim_issues.get(node["num"], [])
    items = sorted(rep.items, key=lambda it: (it["line"] is None, it["line"] or 0))
    counts = {"error": 0, "warning": 0, "info": 0}
    for it in items:
        counts[it["severity"]] += 1
    return {"version": VERSION, "items": items, "counts": counts, "claim_tree": tree,
            "numerals": numerals, "support_map": support, "figures": fig_rows}
