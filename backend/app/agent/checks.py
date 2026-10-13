# -*- coding: utf-8 -*-
"""智能体确定性自检（docs/plan/21 §6.4）。纯函数，每个返回 CheckResult{name, ok, why}，不触模型、不落盘。

  parse(content)                          content.md 全文可被 docset.validate + parse_ast 解析
  lint(critic_md)                         critic.lint_marks 为空
  roundtrip(old, new)                     critic.reject(new) == old 逐字节
  preflight_delta(before, after)          应用后 preflight 不新增 error（按 rule 计数比较）
  support(terms, description)             新增特征词全部出现在说明书（S3 / S7）
  noun_subset(text, source, allow=())     生成文本的名词块 ⊆ 三书文本（S3 / S6 / S10）
  antecedent(claim_text, chain_text)      「所述 X」在同项前文或依赖链中有 X（S2 确定性前置）
  no_legal_verdict(text)                  禁法律结论措辞（A4）
  no_direct_write(before, after)          job 前后 content.md 与 docs/*.md 的 md5 快照一致
  anchor_hit(quote, lines, start, end)    quote 必须落在 anchor 行区间内

辅助：snapshot(project_dir) 生成 md5 快照；report_for(store, pid, content) 对任一全文跑与 derive 同参数的 preflight；
apply_blocks(content, blocks, ...) 把 BlocksPatch 虚拟应用到全文（preflight_delta 用）。
"""
from __future__ import annotations

import hashlib
import os
import re
from collections import Counter
from collections.abc import Iterable

from app.agent.types import CheckResult
from app.domain import terms as terms_mod
from app.domain.projects import ProjectStore
from app.mcp.tools import _settings
from app.routes import ast as routes_ast
from patent_studio.kernel import critic, docset, patch, preflight
from patent_studio.kernel.ast import AstError, parse_ast

# A4：结论式措辞只能由代理师/审查员给出；智能体只能「建议 / 疑似 / 请核对」
LEGAL_VERDICT_WORDS: tuple[str, ...] = (
    "不支持", "不清楚", "不具备新颖性", "不具备创造性", "不具有新颖性", "不具有创造性",
    "缺乏新颖性", "缺乏创造性", "应予驳回", "予以驳回", "无效", "得不到说明书的支持", "不符合专利法",
)

# 「所述 X」：X 取 2~20 字，先在连接字处截断（与 preflight._TERM_RE / _term 同规则）
_TERM_RE = re.compile(r"所述的?((?:(?!所述)[一-龥A-Za-z0-9_\-]){2,20})")
_TERM_CUT_CHARS = set("的与和及或并且而为是在将把从向于对由经至到被使还等即则各该含用")
_CJK_RUN_RE = re.compile(r"[一-龥]{2,}")
# 名词块切分：在这些功能词 / 功能字处切开，剩下 ≥2 字的连续汉字视作「名词块」
_FUNCTION_WORDS: tuple[str, ...] = (
    "所述", "包括", "包含", "其中", "通过", "用于", "以及", "根据", "基于", "进行", "实现", "采用", "利用",
    "并且", "或者", "从而", "使得", "能够", "可以", "对应", "作为", "分别", "还有", "具有", "设有", "本发明",
    "该", "其", "的", "了", "和", "与", "及", "或", "并", "在", "将", "对", "由", "从", "向", "于", "被", "使",
    "为", "是", "有", "等", "以", "把", "则", "即", "而", "且", "也", "都", "可", "能", "会", "不", "无",
    "每", "各", "所", "之", "时", "内", "外", "上", "中", "下", "后", "前", "一种", "一个", "至少", "任一",
)
_FUNC_SPLIT_RE = re.compile("|".join(re.escape(w) for w in sorted(_FUNCTION_WORDS, key=len, reverse=True)))

TRACKED_FILES = ("content.md",)


def _ok(name: str, why: str = "") -> CheckResult:
    return CheckResult(name=name, ok=True, why=why)


def _bad(name: str, why: str) -> CheckResult:
    return CheckResult(name=name, ok=False, why=why)


# ---------------------------------------------------------------- 结构 ----

def parse(content: str) -> CheckResult:
    try:
        docset.validate(docset.split(content))
    except docset.DocsetError as e:
        return _bad("parse", str(e))
    try:
        parse_ast(content)
    except AstError as e:
        return _bad("parse", f"第 {e.line} 行：{e}" if e.line else str(e))
    return _ok("parse")


def lint(critic_md: str) -> CheckResult:
    marks = critic.lint_marks(critic_md)
    if marks:
        return _bad("lint", "；".join(m["message"] for m in marks[:3]))
    return _ok("lint")


def roundtrip(old: str, new: str) -> CheckResult:
    back = critic.reject(new)
    if back == old:
        return _ok("roundtrip")
    n = next((i for i, (a, b) in enumerate(zip(back.split("\n"), old.split("\n")), 1) if a != b),
             min(back.count("\n"), old.count("\n")) + 1)
    return _bad("roundtrip", f"reject 后与原文在第 {n} 行不一致")


def _error_counter(report: dict) -> Counter:
    return Counter(it["rule"] for it in report["items"] if it["severity"] == "error")


def preflight_delta(before: dict, after: dict) -> CheckResult:
    added = _error_counter(after) - _error_counter(before)
    if not added:
        return _ok("preflight_delta")
    return _bad("preflight_delta", "应用后新增 error：" + "、".join(f"{r}×{n}" for r, n in sorted(added.items())))


# ---------------------------------------------------------------- 内容 ----

def support(new_terms: Iterable[str], description: str) -> CheckResult:
    missing = [t for t in dict.fromkeys(t.strip() for t in new_terms if t and t.strip()) if t not in description]
    if missing:
        return _bad("support", "说明书未出现：" + "、".join(missing[:5]))
    return _ok("support")


def nouns(text: str) -> list[str]:
    """名词块：先按功能词切开，再取 ≥2 字的连续汉字段；去重保序。"""
    out: list[str] = []
    for piece in _FUNC_SPLIT_RE.split(critic.accept(text)):
        for m in _CJK_RUN_RE.finditer(piece):
            if m.group(0) not in out:
                out.append(m.group(0))
    return out


def noun_subset(text: str, source: str, allow: Iterable[str] = ()) -> CheckResult:
    """allow：体裁自带的栏目词（如简报的「保护范围」），不计入三书名词。"""
    src = critic.accept(source) + "\n" + "\n".join(allow)
    unknown = [n for n in nouns(text) if n not in src]
    if unknown:
        return _bad("noun_subset", "三书中未出现：" + "、".join(unknown[:6]))
    return _ok("noun_subset")


def _cut(run: str) -> str:
    """在首个连接字 / 功能词（下标 ≥2）处截断：「方法包括以下步骤」→「方法」，「系统中各模块」→「系统」。"""
    cut = len(run)
    for i, ch in enumerate(run):
        if i >= 2 and ch in _TERM_CUT_CHARS:
            cut = i
            break
    m = _FUNC_SPLIT_RE.search(run, 2)
    if m and m.start() < cut:
        cut = m.start()
    return run[:cut]


def antecedent(claim_text: str, chain_text: str = "") -> CheckResult:
    """「所述 X」的 X 须在本项前文或依赖链原文出现。切词只按功能字切，「所述得分大于」会切出「得分大」，
    所以取最长前缀匹配：2 字整词命中，3 字至少命中 2 字，更长者至少命中 3 字。"""
    text = critic.accept(claim_text)
    missing: list[str] = []
    for m in _TERM_RE.finditer(text):
        run = _cut(m.group(1))
        corpus = chain_text + "\n" + text[: m.start()]
        need = 2 if len(run) <= 3 else 3
        k = len(run)
        while k >= need and run[:k] not in corpus:
            k -= 1
        if k < need and run not in missing:
            missing.append(run)
    if missing:
        return _bad("antecedent", "「所述」缺先行基础：" + "、".join(missing[:5]))
    return _ok("antecedent")


def no_legal_verdict(text: str) -> CheckResult:
    hits = [w for w in LEGAL_VERDICT_WORDS if w in text]
    if hits:
        return _bad("no_legal_verdict", "含结论式措辞：" + "、".join(hits))
    return _ok("no_legal_verdict")


# ---------------------------------------------------------------- 写入守卫 ----

def snapshot(project_dir: str) -> dict[str, str]:
    """content.md 与 docs/*.md 的 md5；job 前后各取一次交给 no_direct_write。"""
    out: dict[str, str] = {}
    paths = [os.path.join(project_dir, f) for f in TRACKED_FILES]
    docs = os.path.join(project_dir, docset.DOCS_DIR)
    if os.path.isdir(docs):
        paths += [os.path.join(docs, f) for f in sorted(os.listdir(docs)) if f.endswith(".md")]
    for p in paths:
        if os.path.isfile(p):
            with open(p, "rb") as f:
                out[os.path.relpath(p, project_dir).replace(os.sep, "/")] = hashlib.md5(f.read()).hexdigest()
    return out


def no_direct_write(before: dict[str, str], after: dict[str, str]) -> CheckResult:
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if changed:
        return _bad("no_direct_write", "job 期间被改写：" + "、".join(changed))
    return _ok("no_direct_write")


def anchor_hit(quote: str, lines: list[str], line_start: int, line_end: int) -> CheckResult:
    """lines 为全文行（index = 行号 - 1）；quote 须是 [line_start, line_end] 内某行的子串。"""
    q = (quote or "").strip()
    if not q:
        return _bad("anchor_hit", "quote 为空")
    for n in range(max(1, line_start), min(len(lines), line_end) + 1):
        if q in lines[n - 1]:
            return _ok("anchor_hit")
    return _bad("anchor_hit", f"「{q[:20]}」不在第 {line_start}–{line_end} 行内")


# ---------------------------------------------------------------- 辅助 ----

def report_for(store: ProjectStore, pid: str, content: str) -> dict:
    """对任一全文（如虚拟应用补丁后的文本）跑与 tools_semantic.derive 同参数的 preflight。"""
    p = store.get(pid)
    ast = routes_ast._parse(store, pid, content, None)
    return preflight.run(ast, _settings(store, p), terms_mod.load(p.dir), figs=store.list_figs(p.dir))


def _ordered_by_anchor(content: str, blocks: list, settings, figures) -> list:
    """按锚点在原文 AST 的行位倒序返回 blocks；解析失败保持原序。
    与 patch._reparse 同口径按接受后文本解析——{--…--} 占位行不占段序，
    否则带标记正文的锚点行位全部偏后、排序与真实定位脱节（ddpm 实案 stale）。"""
    try:
        ast = parse_ast(critic.accept(content), settings, figures=figures)
    except AstError:
        return list(blocks)
    pos = {name: meta["offset"] for name, meta in ast["books"].items()}
    for book, b in patch.iter_blocks(ast):
        pos[b["id"]] = ast["books"][book]["offset"] + b["lines"]["start"]
    return sorted(blocks, key=lambda b: pos.get(b.replace_block_id or b.after_block_id, -1), reverse=True)


def apply_blocks(content: str, blocks: list, settings: dict | None = None, figures=None) -> str:
    """BlocksPatch 虚拟应用：after_block_id 为书名（abstract/claims/description）时插到该书标题后。
    块 id 是书内全局序号——往靠前位置插入会把其后的块重排，因此多块按锚点行位倒序应用
    （靠后的先插，先前算好的前段锚点保持有效）；同一锚点后的多块保持给出顺序。抛 patch.PatchError 表示装不进结构。"""
    text = content
    tail: dict[str, str] = {}  # 原锚点 → 该锚点后最近插入块的 id
    for b in _ordered_by_anchor(content, blocks, settings, figures):
        if b.replace_block_id:
            res = patch.patch_block(text, b.replace_block_id, b.markdown, settings=settings,
                                    figures=figures)
            text = res.content
            if res.block_id:
                # zelfde reden als hieronder: vervanging kan in meerdere blokken uiteenvallen
                tail[b.after_block_id] = (
                    patch.block_at_line(res.ast, res.changed_lines["end"]) or res.block_id)
            continue
        after, md = tail.get(b.after_block_id, b.after_block_id), b.markdown
        kind = _kind_of(md)
        if after in docset.BOOKS:
            res = patch.insert_block(text, kind, book=after, markdown=md, settings=settings, figures=figures)
        else:
            res = patch.insert_block(text, kind, after_block_id=after, markdown=md, settings=settings,
                                     figures=figures)
        text = res.content
        if res.block_id:
            # 多行插入可能被 AST 拆成多块（如缺 sep 的管道表）——续链用插入区末行所在块，
            # 否则同锚点后续块挤进首块与残余行之间（vit-11 实案头体分离）
            tail[b.after_block_id] = (
                patch.block_at_line(res.ast, res.changed_lines["end"]) or res.block_id)
    return text


def _kind_of(markdown: str) -> str:
    head = markdown.strip("\n").split("\n", 1)[0]
    if re.match(r"^\d+\.", head):
        return "claim"
    if head.startswith("### "):
        return "section"
    if head.startswith("#### "):
        return "subsection"
    return "paragraph"
