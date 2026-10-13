# -*- coding: utf-8 -*-
"""当前案形式检查（lint）：content.md + settings → LintReport。

只做可判定的形式规则（docs/ux/05-architecture.md §4.1 十条，后扩 style.*/claims.excluded_matter
等确定性词表扫描），不做术语一致性/支持性/新颖性判断。与 preflight 重复的 claims.* 规则不在此另写，
统一走 with_preflight 通道。
解析规则镜像 patent_studio.kernel.content.load_md（# 标题 / ## 三大节 / 权利要求空行分块 / ### 说明书章节 /
``` 代码块），但保留行号；不修改也不依赖 load_md 本身。

with_preflight=True 时在十条之后追加递交前体检（patent_studio.kernel.preflight.run，05-r2 §4）：items 映射为
id="preflight.<rule>#<n>" 的 Diagnostic；与十条同义的 abstract.limit / claims.forward_ref / figures.ref_missing
不重复并入；AST 结构不成立时跳过（结构问题十条已报）。

terms 非空时追加术语一致性（patent_studio.kernel.terms_lint.lint_terms，docs/plan/09 §4）：别名命中 ⇒ warning，
带机器可读 replace={from,to}；terms 为空 / 未传 ⇒ 不产生任何诊断（零漂移）。
"""
import os
import re
from dataclasses import dataclass, field
from typing import Literal, TypedDict

from patent_studio.kernel import preflight
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.kernel.boundary_lint import lint_boundary
from patent_studio.kernel.terms_lint import lint_terms

Severity = Literal["error", "warning", "info"]

TOP_SECTIONS = ("摘要", "权利要求书", "说明书")
SPEC_SECTIONS = ("技术领域", "背景技术", "发明内容", "附图说明", "具体实施方式")

_CLAIM_NUM_RE = re.compile(r"^\s*(\d+)\s*[.、．]\s*")
_CLAIM_REF_RE = re.compile(
    r"权利要求\s*(\d+)"
    r"(?:\s*(?:至|到|-|~|～|—)\s*(\d+))?"
    r"((?:\s*(?:或|和|及|、)\s*\d+)*)"
)
_DEPENDENT_RE = re.compile(r"(?:根据|如|按照|依据|按)\s*权利要求\s*\d+")
_FIG_REF_RE = re.compile(r"图\s*(\d+)")
# 审查指南禁用的不确定性用语（warning 级：误伤容忍，提示复核）
_VAGUE_RE = re.compile(r"大约|大概|大致|基本上|左右|上下(?!文)|等等|之类")
# ®™©℠ 商标符号不得出现在申请文件
_TRADEMARK_RE = re.compile(r"[®™©℠]")
# 专利法第 25 条排除项关键词（提示性扫描，提示人工复核可专利性）
_EXCLUDED_RE = re.compile(
    r"科学发现|智力活动的规则|疾病的诊断方法|疾病的治疗方法|动物和植物品种|"
    r"原子核变换|核变换方法|平面印刷品")


class BoundaryFix(TypedDict):
    block_id: str
    markdown: str


Replace = TypedDict("Replace", {"from": str, "to": str})


class Diagnostic(TypedDict, total=False):
    id: str
    severity: Severity
    source: Literal["build", "lint", "boundary", "client"]
    message: str
    line: int | None
    section: str
    detail: str
    # lint：一句话建议；boundary：{block_id, markdown}（一键清理直接喂 patch_block）
    fix: str | BoundaryFix
    # terms：同一行 from → to 的机器可读替换（前端 editor/commands.replaceLine(line, from, to)）
    replace: Replace


class LintReport(TypedDict):
    diagnostics: list[Diagnostic]
    counts: dict[str, int]


@dataclass
class Claim:
    index: int  # 1-based 块序号
    num: int | None  # 文本中的编号；未以编号开头为 None
    line: int
    text: str


@dataclass
class Parsed:
    title: str | None = None
    title_line: int | None = None
    # (name, line)，按出现顺序；含未知 ## 标题
    top_headings: list[tuple[str, int]] = field(default_factory=list)
    # name → [(line, text)]，只收录三大节
    sections: dict[str, list[tuple[int, str]]] = field(default_factory=dict)
    # 说明书内 ### 标题 (name, line)
    spec_headings: list[tuple[str, int]] = field(default_factory=list)
    # 出现在说明书以外的 ### 标题 (name, line, 所在 ## 节)
    stray_headings: list[tuple[str, int, str | None]] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    # 说明书内代码块行号集合（这些行不做 $$ / 图N 检查）
    code_lines: set[int] = field(default_factory=set)


def parse(content: str) -> Parsed:
    p = Parsed(sections={k: [] for k in TOP_SECTIONS})
    cur: str | None = None
    in_code = False
    for i, ln in enumerate(content.rstrip("\n").split("\n"), 1):
        if cur == "说明书" and ln.strip().startswith("```"):
            in_code = not in_code
            p.code_lines.add(i)
            continue
        if in_code:
            p.code_lines.add(i)
            p.sections["说明书"].append((i, ln))
            continue
        if ln.startswith("# ") and not ln.startswith("## "):
            if p.title is None:
                p.title, p.title_line = ln[2:].strip(), i
        elif ln.startswith("## "):
            cur = ln[3:].strip()
            p.top_headings.append((cur, i))
        elif cur is not None:
            if ln.startswith("### "):
                name = ln[4:].strip()
                if cur == "说明书":
                    p.spec_headings.append((name, i))
                else:
                    p.stray_headings.append((name, i, cur))
            if cur in p.sections:
                p.sections[cur].append((i, ln))
    # 权利要求：空行分块，块首行的编号
    block: list[tuple[int, str]] = []
    for line_no, ln in p.sections["权利要求书"] + [(0, "")]:
        if ln == "":
            if block:
                m = _CLAIM_NUM_RE.match(block[0][1])
                p.claims.append(Claim(index=len(p.claims) + 1, num=int(m.group(1)) if m else None,
                                      line=block[0][0], text="\n".join(t for _, t in block)))
                block = []
            continue
        block.append((line_no, ln))
    return p


def heading_line(p: Parsed, name: str) -> int | None:
    for n, line in p.top_headings:
        if n == name:
            return line
    return None


def abstract_text(p: Parsed) -> str:
    """与 load_md 一致：摘要节非空行以 \\n 拼接（字数 = len）。"""
    return "\n".join(t for _, t in p.sections["摘要"] if t.strip())


def _d(id_, severity, message, line, section=None, fix=None, detail=None) -> Diagnostic:
    d: Diagnostic = {"id": id_, "severity": severity, "source": "lint", "message": message, "line": line}
    if section:
        d["section"] = section
    if fix:
        d["fix"] = fix
    if detail:
        d["detail"] = detail
    return d


def _refs_in(text: str):
    """产出 (引用编号, 引用片段) —— 覆盖 权利要求N / N至M / N或M / N、M。"""
    for m in _CLAIM_REF_RE.finditer(text):
        a = int(m.group(1))
        yield a, m.group(0)
        if m.group(2):
            b = int(m.group(2))
            yield b, m.group(0)
        for extra in re.findall(r"\d+", m.group(3) or ""):
            yield int(extra), m.group(0)


PREFLIGHT_SKIP = frozenset({"abstract.limit", "claims.forward_ref", "figures.ref_missing"})


def preflight_diagnostics(ast, settings: dict, terms: list[dict] | None = None,
                          figs: list[str] | None = None, figures=None) -> list[Diagnostic]:
    report = preflight.run(ast, settings, terms, figs=figs, figures=figures)
    out: list[Diagnostic] = []
    seen: dict[str, int] = {}
    for it in report["items"]:
        if it["rule"] in PREFLIGHT_SKIP:
            continue
        n = seen[it["rule"]] = seen.get(it["rule"], 0) + 1
        out.append(_d(f"preflight.{it['rule']}#{n}", it["severity"], it["message"], it["line"],
                      preflight.BOOK_NAMES.get(it["book"] or ""), detail=it["detail"]))
    return out


def lint(content: str, settings: dict | None = None, figs_dir: str | None = None, *,
         with_preflight: bool = False, terms: list[dict] | None = None, figures=None) -> LintReport:
    """figures（figures_md.FiguresDoc，可省）= docs/figures.md 真源：给了就让体检的 figures.alt_mismatch /
    figures.file_missing 进问题面板（文件存在性按 figs_dir 查）。"""
    settings = settings or {}
    p = parse(content)
    out: list[Diagnostic] = []

    # ---- 摘要 ----
    abs_line = heading_line(p, "摘要")
    abstract = abstract_text(p)
    limit = int(settings.get("abstract_limit") or 300)
    if not abstract:
        if abs_line is None:
            out.append(_d("abstract.empty", "error", "缺少 ## 摘要 章节", p.title_line, "摘要",
                          fix="在标题后添加「## 摘要」并写入 ≤%d 字的摘要正文" % limit))
        else:
            out.append(_d("abstract.empty", "error", "摘要为空", abs_line, "摘要",
                          fix="在「## 摘要」下写入摘要正文（≤%d 字）" % limit))
    elif len(abstract) > limit:
        first = next((ln for ln, t in p.sections["摘要"] if t.strip()), abs_line)
        out.append(_d("abstract.limit", "error", f"摘要超过 {limit} 字（当前 {len(abstract)} 字）", first, "摘要",
                      fix="精简摘要正文，或在排版设置中调整摘要字数上限"))

    # ---- 权利要求 ----
    claims_line = heading_line(p, "权利要求书")
    if claims_line is None:
        out.append(_d("claims.numbering", "error", "缺少 ## 权利要求书 章节", None, "权利要求书",
                      fix="添加「## 权利要求书」并按 1. 2. 3. 编号，每项以空行分隔"))
    elif not p.claims:
        out.append(_d("claims.numbering", "error", "权利要求书为空", claims_line, "权利要求书",
                      fix="至少写一项独立权利要求，形如「1.一种……方法，其特征在于，……」"))
    total = len(p.claims)
    for c in p.claims:
        if c.num is None:
            out.append(_d(f"claims.numbering#{c.index}", "error",
                          f"第 {c.index} 项权利要求未以编号开头（应为「{c.index}.」）", c.line, "权利要求书",
                          fix="每项权利要求首行以「N.」开头，项与项之间用空行分隔"))
        elif c.num != c.index:
            out.append(_d(f"claims.numbering#{c.index}", "error",
                          f"权利要求编号不连续：第 {c.index} 项写作「{c.num}.」", c.line, "权利要求书",
                          fix="权利要求须从 1 起连续编号且不重复"))
    for c in p.claims:
        own = c.num if c.num is not None else c.index
        bad = []
        for n, frag in _refs_in(c.text):
            if n >= own or n < 1 or n > total:
                bad.append((n, frag))
        if bad:
            n, frag = bad[0]
            if n == own:
                why = "引用了自身"
            elif n > total or n < 1:
                why = "引用了不存在的权利要求"
            else:
                why = "向前引用了在后的权利要求"
            out.append(_d(f"claims.forward_ref#{own}", "error",
                          f"权利要求 {own} {why}（{frag.strip()}）", c.line, "权利要求书",
                          fix="从属权利要求只能引用编号比自身小、且已存在的权利要求"))
    if p.claims and _DEPENDENT_RE.search(p.claims[0].text):
        out.append(_d("claims.independent_first", "warning", "第 1 项权利要求引用了其他权利要求，不是独立权利要求",
                      p.claims[0].line, "权利要求书", fix="第 1 项应为独立权利要求（不含「根据权利要求N」）"))
    # ---- 说明书章节 ----
    spec_line = heading_line(p, "说明书")
    if spec_line is None:
        out.append(_d("spec.sections", "error", "缺少 ## 说明书 章节", None, "说明书",
                      fix="添加「## 说明书」及五个 ### 章节：" + "/".join(SPEC_SECTIONS)))
    else:
        present = [(n, ln) for n, ln in p.spec_headings if n in SPEC_SECTIONS]
        names = [n for n, _ in present]
        missing = [s for s in SPEC_SECTIONS if s not in names]
        if missing:
            # 定位到缺失处前一章节（若首个即缺失则定位 ## 说明书）
            first_missing = missing[0]
            idx = SPEC_SECTIONS.index(first_missing)
            prev = next((ln for n, ln in reversed(present) if SPEC_SECTIONS.index(n) < idx), spec_line)
            out.append(_d("spec.sections", "error", "说明书缺少章节：" + "、".join(missing), prev, "说明书",
                          fix="说明书须依次包含 ### " + " / ### ".join(SPEC_SECTIONS)))
        else:
            order = [SPEC_SECTIONS.index(n) for n in names]
            for k in range(1, len(order)):
                if order[k] < order[k - 1]:
                    out.append(_d("spec.sections", "error",
                                  f"说明书章节顺序错误：「{names[k]}」应位于「{names[k - 1]}」之前",
                                  present[k][1], f"说明书/{names[k]}",
                                  fix="章节顺序：" + " → ".join(SPEC_SECTIONS)))
                    break
            seen: set[str] = set()
            for n, ln in present:
                if n in seen:
                    out.append(_d(f"spec.sections#{n}", "error", f"说明书章节「{n}」重复出现", ln, f"说明书/{n}"))
                seen.add(n)
    for n, ln in p.top_headings:
        if n not in TOP_SECTIONS:
            out.append(_d(f"spec.unknown_section#L{ln}", "error", f"未知章节「{n}」：仅允许 摘要/权利要求书/说明书", ln,
                          fix="二级标题只能是 ## 摘要 / ## 权利要求书 / ## 说明书"))
    for n, ln in p.spec_headings:
        if n not in SPEC_SECTIONS:
            out.append(_d(f"spec.unknown_section#L{ln}", "error",
                          f"未知说明书章节「{n}」：仅允许 " + "/".join(SPEC_SECTIONS), ln, "说明书",
                          fix="说明书内小节请用 #### 标题；### 只能是五个法定章节"))
    for n, ln, sec in p.stray_headings:
        out.append(_d(f"spec.unknown_section#L{ln}", "error",
                      f"「### {n}」出现在 {sec} 内：### 章节只能位于 ## 说明书 之下", ln, sec))

    # ---- 附图 ----
    spec_figs = settings.get("spec_figures") or []
    nfig = len(spec_figs)
    referenced: dict[int, int] = {}  # 图号 → 首次引用行
    for name in TOP_SECTIONS:
        for ln, t in p.sections[name]:
            if ln in p.code_lines:
                continue
            for m in _FIG_REF_RE.finditer(t):
                referenced.setdefault(int(m.group(1)), ln)
    for n in sorted(referenced):
        if n < 1 or n > nfig:
            msg = f"正文引用了图{n}，但说明书附图只有 {nfig} 张" if nfig else f"正文引用了图{n}，但未设置说明书附图"
            out.append(_d(f"figures.ref#{n}", "warning", msg, referenced[n],
                          fix="在附图书（docs/figures.md）中上传对应附图，或修正正文中的图号"))
    fig_desc_line = next((ln for n, ln in p.spec_headings if n == "附图说明"), None)
    if nfig and fig_desc_line is not None:
        end = next((ln for n, ln in p.spec_headings if ln > fig_desc_line), None)
        desc_text = "\n".join(t for ln, t in p.sections["说明书"]
                              if ln > fig_desc_line and (end is None or ln < end) and ln not in p.code_lines)
        mentioned = {int(m.group(1)) for m in _FIG_REF_RE.finditer(desc_text)}
        for i in range(1, nfig + 1):
            if i not in mentioned:
                out.append(_d(f"figures.ref#desc{i}", "warning", f"图{i}（{spec_figs[i - 1][0]}）未在附图说明中提及",
                              fig_desc_line, "说明书/附图说明", fix=f"在「### 附图说明」中补一行「图{i}为……」"))
    af = settings.get("abstract_figure")
    if not af:
        out.append(_d("figures.abstract", "warning", "未设置摘要附图", None,
                      fix="向 figs/ 放入附图文件并在附图书（docs/figures.md）中设为摘要图"))
    elif figs_dir is not None and not os.path.isfile(os.path.join(figs_dir, str(af[0]))):
        out.append(_d("figures.abstract", "warning", f"摘要附图文件不存在：{af[0]}", None,
                      fix="检查 figs/ 目录或在附图书（docs/figures.md）中重新设为摘要图"))

    # ---- 措辞/可专利性形式扫描（确定性词表，warning/info 级提示复核） ----
    for name in TOP_SECTIONS:
        for ln, t in p.sections[name]:
            if ln in p.code_lines or not t.strip():
                continue
            hit = _VAGUE_RE.search(t)
            if hit:
                out.append(_d(f"style.vague#L{ln}", "warning",
                              f"出现不确定性用语「{hit.group(0)}」，审查指南要求避免", ln, name,
                              fix="改为确定的范围或具体数值（如「优选为」「区间为」）"))
            tm = _TRADEMARK_RE.search(t)
            if tm:
                out.append(_d(f"style.trademark#L{ln}", "warning",
                              f"出现商标符号「{tm.group(0)}」，申请文件不应使用商标标识", ln, name,
                              fix="删除商标符号，品牌名改写为上位概念（如「移动终端」而非「iPhone®」）"))
    # ---- 自称一致性（语料：~87% 授权件统一自称） ----
    all_text = "\n".join(t for name in TOP_SECTIONS for ln, t in p.sections[name]
                         if ln not in p.code_lines)
    self_counts = {w: all_text.count(w) for w in ("本申请", "本发明", "本公开")
                   if all_text.count(w) >= 3}
    if len(self_counts) >= 2:
        detail = "、".join(f"{w}×{n}" for w, n in
                          sorted(self_counts.items(), key=lambda x: -x[1]))
        out.append(_d("style.self_ref", "warning",
                      f"自称混用：{detail}（授权件约 87% 统一自称）", None,
                      fix="全篇统一一种自称（如「本申请实施例」或「本发明实施例」）"))

    for c in p.claims:
        own = c.num if c.num is not None else c.index
        if "其特征在于" not in c.text:
            out.append(_d(f"claims.characterizing#{own}", "warning",
                          f"权利要求 {own} 未出现「其特征在于」", c.line, "权利要求书",
                          fix="权项惯例（约 88% 授权件）为「……，其特征在于，……」引出区别特征；确属有意省略可忽略"))
        hit = _EXCLUDED_RE.search(c.text)
        if hit:
            out.append(_d(f"claims.excluded_matter#{own}", "warning",
                          f"权利要求 {own} 含「{hit.group(0)}」，可能落入专利法第 25 条排除项", c.line,
                          "权利要求书", fix="请人工复核主题可专利性；确属排除项需重写或删除该项"))

    # ---- 公式 ----
    for name in TOP_SECTIONS:
        for ln, t in p.sections[name]:
            if ln in p.code_lines:
                continue
            if t.count("$$") % 2 == 1:
                out.append(_d(f"equation.unclosed#L{ln}", "error", "公式定界符 $$ 未闭合", ln, name,
                              fix="独立公式写成一行「$$ 公式 $$」，可在 $$ 后加编号如 (1)"))

    # ---- AST 之上的规则：体检（with_preflight）+ 源码边界（手写段号 / 权项号 / 图号）；AST 不成立时跳过 ----
    try:
        ast = parse_ast(content, settings, figures=figures)
    except AstError:
        pass
    else:
        if with_preflight:
            figs = None
            if figures is not None and figs_dir is not None:
                figs = os.listdir(figs_dir) if os.path.isdir(figs_dir) else []
            out.extend(preflight_diagnostics(ast, settings, terms, figs, figures=figures))
        out.extend(lint_boundary(ast, content))
    if terms:
        out.extend(lint_terms(content, terms))

    out.sort(key=lambda d: (d["line"] is None, d["line"] or 0))
    counts = {"error": 0, "warning": 0, "info": 0}
    for d in out:
        counts[d["severity"]] += 1
    return {"diagnostics": out, "counts": counts}
