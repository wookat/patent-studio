"""拆分件：按职责搬出；公开名经显式 import 收回原模块命名空间。"""

from __future__ import annotations

import re

from patent_studio.kernel.preflight import (
    _ABSTRACT_ELEMENTS,
    _ABSTRACT_LIMIT_DEFAULT,
    _CLAIM_FIG_REF_RE,
    _FIG_REF_RE,
    _LEGEND_MARK,
    _LEGEND_RE,
    _NAME_ABBR_RE,
    _NAME_ARITH_END,
    _NAME_CUT_CHARS,
    _NAME_CUT_WORDS,
    _NAME_STRIP_CHARS,
    _NUMERAL_CHAIN_RE,
    _NUMERAL_RE,
    _PROMO_RE,
    _SECTION_ORDER,
    _SECTION_TITLES,
    _TERM_CUT_CHARS,
    _TERM_RE,
)

from . import critic
from .terms_lint import alias_map, build_pattern


def _abbr(name):
    return _NAME_ABBR_RE.sub("", name).strip()


def _full(ast, book, rel):
    return ast["books"][book]["offset"] + rel


def _block_line(ast, book, block):
    return _full(ast, book, block["lines"]["start"])


def scan_refs(ast):
    """abstract / description 段落中的「图N」引用，行号为全文行（多行段落取段首行）。"""
    refs = []
    for p in ast["abstract"]["paragraphs"]:
        for m in _FIG_REF_RE.finditer(p["text"]):
            refs.append(
                {
                    "book": "abstract",
                    "line": _block_line(ast, "abstract", p),
                    "num": int(m.group(1)),
                    "text": p["text"].strip(),
                    "block_id": p["id"],
                }
            )
    cur_part = None
    for b in ast["description"]:
        if b["kind"] == "section":
            cur_part = b.get("part")
            continue
        if b["kind"] != "paragraph":
            continue
        for m in _FIG_REF_RE.finditer(b["text"]):
            refs.append(
                {
                    "book": "description",
                    "line": _block_line(ast, "description", b),
                    "num": int(m.group(1)),
                    "text": b["text"].strip(),
                    "block_id": b["id"],
                    "in_drawings": cur_part == "description-of-drawings",
                }
            )
    return refs


class _Report:
    def __init__(self, disabled=()):
        self.items = []
        self.claim_issues = {}
        self.disabled = frozenset(disabled)

    def add(self, rule, severity, message, book, line, block_id, detail=None, claim=None, para_no=None):
        if rule in self.disabled:
            return
        self.items.append(
            {
                "rule": rule,
                "severity": severity,
                "message": message,
                "book": book,
                "line": line,
                "block_id": block_id,
                "detail": detail,
                "para_no": para_no,
            }
        )
        if claim is not None:
            self.claim_issues.setdefault(claim, []).append(rule)


def _check_abstract(ast, settings, rep):
    paras = ast["abstract"]["paragraphs"]
    text = "\n".join(p["text"] for p in paras)
    limit = int((settings or {}).get("abstract_limit") or _ABSTRACT_LIMIT_DEFAULT)
    if len(text) > limit:
        first = paras[0]
        rep.add(
            "abstract.limit",
            "error",
            f"摘要超过 {limit} 字（当前 {len(text)} 字）",
            "abstract",
            _block_line(ast, "abstract", first),
            first["id"],
        )
    if not paras:
        return
    missing = [name for name, pat in _ABSTRACT_ELEMENTS if not pat.search(text)]
    if missing:
        first = paras[0]
        rep.add(
            "abstract.elements_missing",
            "warning",
            "摘要未体现"
            + "、".join(missing)
            + "（细则第 23 条：应写明技术领域、所解决的技术问题、技术方案要点与有益效果）",
            "abstract",
            _block_line(ast, "abstract", first),
            first["id"],
            detail="、".join(missing),
        )


def _claim_text(claim):
    return "".join(seg["text"] for seg in claim["segments"] if seg["kind"] == "text")


def _promo_hits(text):
    seen = []
    for m in _PROMO_RE.finditer(text):
        if m.group(0) not in seen:
            seen.append(m.group(0))
    return seen


def _check_claim_form(ast, rep):
    """R-CHK-02 权项形式项：claims.figure_ref / claims.no_characterized / claims.promo_wording（都是 warning）。"""
    for c in ast["claims"]:
        n, line, text = c["num"], _block_line(ast, "claims", c), _claim_text(c)
        m = _CLAIM_FIG_REF_RE.search(text)
        if m:
            rep.add(
                "claims.figure_ref",
                "warning",
                f"权利要求 {n} 含「{m.group(0)}」：权利要求书不得引用附图说明技术特征",
                "claims",
                line,
                c["id"],
                detail=m.group(0),
                claim=n,
            )
        if c["claim_kind"] == "independent" and not c.get("charact"):
            rep.add(
                "claims.no_characterized",
                "warning",
                f"独立权利要求 {n} 没有「其特征在于」（细则第 24 条两部分撰写）",
                "claims",
                line,
                c["id"],
                claim=n,
            )
        hits = _promo_hits(text)
        if hits:
            rep.add(
                "claims.promo_wording",
                "warning",
                f"权利要求 {n} 含宣传性用语「{'、'.join(hits)}」",
                "claims",
                line,
                c["id"],
                detail="、".join(hits),
                claim=n,
            )


def _check_spec_form(ast, rep):
    """R-CHK-02 说明书形式项：spec.section_missing（error）/ spec.section_order / spec.promo_wording。
    附图说明只在有附图（figures[] 非空或正文引用了「图N」）时才要求。"""
    blocks = ast["description"]
    sections = [b for b in blocks if b["kind"] == "section"]
    present = [b["part"] for b in sections if b["part"] in _SECTION_ORDER]
    need_drawings = bool(ast["figures"]) or any(r["book"] == "description" for r in scan_refs(ast))
    required = [p for p in _SECTION_ORDER if p != "description-of-drawings" or need_drawings]
    missing = [p for p in required if p not in present]
    book_line = ast["books"]["description"]["offset"]
    anchor = sections[0] if sections else None
    if missing:
        rep.add(
            "spec.section_missing",
            "error",
            "说明书缺少「" + "」「".join(_SECTION_TITLES[p] for p in missing) + "」（细则第 20 条五段）",
            "description",
            _block_line(ast, "description", anchor) if anchor else book_line,
            anchor["id"] if anchor else None,
            detail="、".join(_SECTION_TITLES[p] for p in missing),
        )
    rank = {p: i for i, p in enumerate(_SECTION_ORDER)}
    seen = []
    for b in sections:
        p = b["part"]
        if p not in rank:
            continue
        if seen and rank[p] < rank[seen[-1]]:
            rep.add(
                "spec.section_order",
                "warning",
                f"「{_SECTION_TITLES[p]}」出现在「{_SECTION_TITLES[seen[-1]]}」之后，五段应按"
                + "→".join(_SECTION_TITLES[x] for x in _SECTION_ORDER)
                + "排列",
                "description",
                _block_line(ast, "description", b),
                b["id"],
                detail=_SECTION_TITLES[p],
            )
            break
        seen.append(p)
    for b in blocks:
        if b["kind"] != "paragraph":
            continue
        hits = _promo_hits(b["text"])
        if hits:
            rep.add(
                "spec.promo_wording",
                "warning",
                f"说明书第 {b['para_no']} 段含宣传性用语「{'、'.join(hits)}」",
                "description",
                _block_line(ast, "description", b),
                b["id"],
                detail="、".join(hits),
                para_no=b["para_no"],
            )


def _claim_targets(claim):
    return sorted({t for r in claim["refs"] for t in r["targets"]})


def _check_claims(ast, rep):
    claims = ast["claims"]
    total = len(claims)
    targets = {c["num"]: _claim_targets(c) for c in claims}
    dependent = {c["num"] for c in claims if c["claim_kind"] == "dependent"}
    multi = {n for n in dependent if len(targets[n]) > 1}
    line = {c["num"]: _block_line(ast, "claims", c) for c in claims}

    for c in claims:
        n = c["num"]
        if n == 1 and c["claim_kind"] == "dependent":
            rep.add(
                "claims.structure",
                "error",
                "第 1 项权利要求引用了其他权利要求，不是独立权利要求",
                "claims",
                line[n],
                c["id"],
                claim=n,
            )
        elif n in dependent and not targets[n]:
            rep.add(
                "claims.structure",
                "error",
                f"权利要求 {n} 为从属权利要求但未能识别引用的权利要求",
                "claims",
                line[n],
                c["id"],
                claim=n,
            )
        if n in dependent:
            bad = [t for t in targets[n] if t >= n or t < 1 or t > total]
            if bad:
                rep.add(
                    "claims.forward_ref",
                    "error",
                    f"权利要求 {n} 引用了不在前的权利要求 {'、'.join(map(str, bad))}",
                    "claims",
                    line[n],
                    c["id"],
                    claim=n,
                )
            for r in c["refs"]:
                if len(r["targets"]) > 1 and not r["alternative"]:
                    rep.add(
                        "claims.multi_not_alternative",
                        "warning",
                        f"权利要求 {n} 多项引用「{r['text']}」未用择一方式（应为「或」/「任一项」）",
                        "claims",
                        line[n],
                        c["id"],
                        claim=n,
                    )
                    break
            if n in multi:
                inner = [t for t in targets[n] if t in multi]
                if inner:
                    rep.add(
                        "claims.multi_multi",
                        "warning",
                        f"多项从属权利要求 {n} 引用了另一多项从属权利要求 {'、'.join(map(str, inner))}",
                        "claims",
                        line[n],
                        c["id"],
                        detail="被引用的多项从属权利要求：" + "、".join(map(str, inner)),
                        claim=n,
                    )

    # 循环：可达闭包，互相可达的节点归为一个环，每环报一条（最小权项号）
    reach = {}
    for n in dependent:
        seen, stack = set(), list(targets[n])
        while stack:
            t = stack.pop()
            if t in seen or t not in targets:
                continue
            seen.add(t)
            stack.extend(targets[t])
        reach[n] = seen
    reported = set()
    for n in sorted(dependent):
        if n in reported or n not in reach.get(n, ()):
            continue
        cyc = sorted(m for m in reach[n] if n in reach.get(m, ()))
        reported.update(cyc)
        rep.add(
            "claims.cycle",
            "error",
            "权利要求 " + "→".join(map(str, cyc + [cyc[0]])) + " 形成循环引用",
            "claims",
            line[n],
            f"claims/{n}",
            detail="环上权利要求：" + "、".join(map(str, cyc)),
            claim=n,
        )

    for c in claims:
        segs = c["segments"]
        for k, seg in enumerate(segs):
            if seg["kind"] == "equation" and (k == 0 or segs[k - 1]["kind"] not in ("text", "equation")):
                rep.add(
                    "equation.no_lead",
                    "warning",
                    f"权利要求 {c['num']} 的公式前没有正文段",
                    "claims",
                    _full(ast, "claims", seg["line"]),
                    c["id"],
                    claim=c["num"],
                )

    tree = []
    children = {c["num"]: [] for c in claims}
    for n, ts in targets.items():
        for t in ts:
            if t in children and t != n:
                children[t].append(n)
    # 从权梯度：同簇（含链式子孙）≥3 个从权无一引在先从权——平铺星形，授权件常见递进式布局
    for indep, kids in sorted(children.items()):
        stack, cluster = list(kids), []
        while stack:
            d = stack.pop()
            if d in dependent and d not in cluster:
                cluster.append(d)
                stack.extend(children.get(d, []))
        if len(cluster) >= 3 and not any(t in dependent for d in cluster for t in targets[d]):
            rep.add(
                "claims.gradient",
                "warning",
                f"权利要求 {indep} 的 {len(cluster)} 项从属权利要求无一引用在先从权，未形成特征梯度"
                "（建议至少一项从权引用在先从权递进限定）",
                "claims",
                line[indep],
                f"claims/{indep}",
                claim=indep,
            )
    for c in claims:
        n = c["num"]
        tree.append(
            {
                "num": n,
                "kind": c["claim_kind"],
                "category": c["category"] or "",
                "refs": targets[n],
                "alternative": any(r["alternative"] for r in c["refs"]),
                "line": line[n],
                "children": sorted(children[n]),
                "issues": rep.claim_issues.get(n, []),
            }
        )
    return tree


def _check_equations(ast, rep):
    blocks = ast["description"]
    for i, b in enumerate(blocks):
        if b["kind"] != "equation":
            continue
        prev = blocks[i - 1] if i else None
        if prev is None or prev["kind"] not in ("paragraph", "equation"):
            where = f"「{prev['title']}」标题后" if prev and prev["kind"] in ("section", "subsection") else "前"
            rep.add(
                "equation.no_lead",
                "warning",
                f"公式{where}直接出现，前面应有正文段",
                "description",
                _block_line(ast, "description", b),
                b["id"],
            )


_EQ_TAG_RE = re.compile(r"\\tag\{[^}]*?(\d+)[^}]*\}")


_EQ_TRAIL_RE = re.compile(r"^\s*式?\s*[(（]\s*(\d+)\s*[)）]")


_TAB_CAPTION_LINE_RE = re.compile(r"^\s*表\s*(\d+)")


_TAB_REF_RE = re.compile(r"表\s*(\d+)")


_MARK_BIND_RE = re.compile(r"(\d{3,4})\s*为\s*([^；;。\n]{2,20})")


def _formula_norm(s):
    """公式体归一用于同号比对：剥界定/标签/空白。"""
    s = re.sub(r"\\tag\{[^}]*\}", "", s)
    return re.sub(r"[\s$\\{}]", "", s)


def _check_spec_numbering(ast, rep):
    """说明书内编号一致性三查（起草稿混稿/跳块提案残留会在此现形）：
    spec.eq_dup    —— 同式号指向不同公式体（一号两式）；
    spec.tab_dangle—— 正文引用「表N」但无对应题注；
    spec.mark_conflict——「元件标号说明」声明的名↔号绑定与正文「名〈号〉」用法冲突。"""
    blocks = ast["description"]
    # —— 式号一号两式 ——
    bodies = {}
    eq_lines = {}

    def _eq_hit(num, body, b):
        bodies.setdefault(num, set()).add(body)
        eq_lines.setdefault(num, _block_line(ast, "description", b))

    for b in blocks:
        if b["kind"] == "equation":
            src, label = b.get("source") or "", b.get("label") or ""
            for m in _EQ_TAG_RE.finditer(src):
                _eq_hit(int(m.group(1)), _formula_norm(src), b)
            tm = _EQ_TRAIL_RE.search(label)
            if tm:
                _eq_hit(int(tm.group(1)), _formula_norm(src), b)
        elif b["kind"] == "paragraph":
            text = b["text"]
            for m in re.finditer(r"\$\$[^$]*\$\$|\$[^$]*\$", text):
                span = m.group(0)
                tm = _EQ_TAG_RE.search(span)
                if tm:
                    _eq_hit(int(tm.group(1)), _formula_norm(span), b)
                tail = _EQ_TRAIL_RE.match(text[m.end() : m.end() + 14].lstrip())
                if tail:
                    _eq_hit(int(tail.group(1)), _formula_norm(span), b)
    for num, bs in sorted(bodies.items()):
        if len(bs) > 1:
            rep.add(
                "spec.eq_dup",
                "error",
                f"式({num}) 被用于 {len(bs)} 个不同公式——式号须全书唯一",
                "description",
                eq_lines.get(num),
                None,
            )
    # —— 行内 $$ 公式 ——定义/递推/核心计算式应独立成行编号，不嵌句中
    _MARKUP_TAG = re.compile(r"\{\+\+|\+\+\}|\{--|--\}")
    _TAG = r"[（(]?\s*式?\s*[(（]?\s*\d+\s*[)）]?\s*[)）]?"
    _EQ_LINE_ONLY = re.compile(rf"^(?:{_TAG}\s*)?\$\$[^$]+\$\$\s*(?:{_TAG})?\s*$")
    for b in blocks:
        if b["kind"] != "paragraph" or "$$" not in b["text"]:
            continue
        for ln in b["text"].splitlines():
            if "$$" not in ln:
                continue
            clean = _MARKUP_TAG.sub("", ln).strip()
            if _EQ_LINE_ONLY.match(clean):
                continue
            for m in re.finditer(r"\$\$[^$]+\$\$", clean):
                span = m.group(0)
                if _EQ_TAG_RE.search(span):
                    continue
                body = span[2:-2]
                # 行内短符号（$$X_{i}$$ 变量引用）属合法行内式；只报像完整等式的式体
                if "=" not in body and len(body) < 30:
                    continue
                tail_txt = clean[m.end() : m.end() + 20].lstrip()
                if _EQ_TRAIL_RE.match(tail_txt) or re.match(r"[（(]\s*式\s*[(（]\d+[)）]\s*[)）]", tail_txt):
                    continue
                rep.add(
                    "spec.eq_inline",
                    "warning",
                    "公式嵌在句中未独立成行——定义/递推/核心计算式应独占一行并编号 式(N)，正文以「如式(N)所示」引用",
                    "description",
                    _block_line(ast, "description", b),
                    b["id"],
                )
                break
    # —— 表号悬空引用 ——
    caps, tab_refs = set(), {}
    for b in blocks:
        if b["kind"] == "table":
            cap = (b.get("caption") or {}).get("text") or ""
            cm = _TAB_CAPTION_LINE_RE.match(cap.strip())
            if cm:
                caps.add(int(cm.group(1)))
            continue
        if b["kind"] != "paragraph":
            continue
        for ln in b["text"].splitlines():
            cm = _TAB_CAPTION_LINE_RE.match(ln)
            if cm:
                caps.add(int(cm.group(1)))
                break
        for m in _TAB_REF_RE.finditer(b["text"]):
            # 题注行自身的「表N」不算引用
            start = m.start()
            if _TAB_CAPTION_LINE_RE.match(b["text"][b["text"].rfind("\n", 0, start) + 1 :]):
                continue
            tab_refs.setdefault(int(m.group(1)), b)
    for num in sorted(tab_refs):
        if num not in caps:
            rep.add(
                "spec.tab_dangle",
                "warning",
                f"正文引用了表{num}，但说明书中没有表{num}的题注与表体",
                "description",
                _block_line(ast, "description", tab_refs[num]),
                tab_refs[num]["id"],
            )
    # —— 标号声明与正文用法冲突 ——
    decl = {}  # name -> num
    for b in blocks:
        if b["kind"] != "paragraph" or "标号" not in b["text"]:
            continue
        for m in _MARK_BIND_RE.finditer(b["text"]):
            decl[m.group(2).strip()] = int(m.group(1))
    if decl:
        # 声明表自身一号多名时该号绑定歧义（numerals.legend_conflict 已逮），不再双重计数
        nums_used = {}
        for name, num in decl.items():
            nums_used.setdefault(num, set()).add(name)
        ambiguous = {num for num, ns in nums_used.items() if len(ns) > 1}
        decl = {name: num for name, num in decl.items() if num not in ambiguous}
    if decl:
        names = sorted(decl, key=len, reverse=True)
        pat = re.compile("(" + "|".join(re.escape(n) for n in names) + r")\s*[（(]?\s*(\d{3,4})\s*[)）]?")
        seen = set()
        for b in blocks:
            if b["kind"] != "paragraph":
                continue
            for m in pat.finditer(b["text"]):
                name, num = m.group(1), int(m.group(2))
                if num == decl[name]:
                    continue
                key = (name, num)
                if key in seen:
                    continue
                seen.add(key)
                rep.add(
                    "spec.mark_conflict",
                    "error",
                    f"「{name}{num}」与元件标号说明的绑定「{name}={decl[name]}」冲突",
                    "description",
                    _block_line(ast, "description", b),
                    b["id"],
                )


def _check_legal_rhythm(ast, rep):
    """实施方式行文节奏——授权件惯例「其中」限定句/「可以」可选表达/「具体地」层级导引
    （ddpm-2 实案全缺：其中 4.1% vs 授权件 13.7%、可以 0 vs 17.9、具体地 0）。"""
    blocks = ast["description"]
    start = next(
        (i for i, b in enumerate(blocks) if b["kind"] == "section" and b["part"] == "mode-for-invention"), None
    )
    if start is None:
        return
    paras = [b for b in blocks[start + 1 :] if b["kind"] == "paragraph" and b.get("text")]
    body = "".join(b["text"] for b in paras)
    sents = [s for s in re.split(r"[。；]", body) if len(s.strip()) > 4]
    if len(sents) < 20:
        return
    qz = sum(1 for s in sents if "其中" in s)
    can = body.count("可以") + body.count("可选") + body.count("在一些实施方式中")
    juti = body.count("具体地")
    if qz * 100 / len(sents) < 5 and can == 0:
        rep.add(
            "style.legal_rhythm",
            "warning",
            f"实施方式行文节奏偏离授权惯例：「其中」限定句 {qz} 处（授权件 ≈14%）、"
            f"可选表达 {can} 处、「具体地」 {juti} 处——细节限定宜以「其中，…」"
            "承接，可选/替代手段宜以「可以/可选地/在一些实施方式中」表述",
            "description",
            _block_line(ast, "description", paras[0]),
            paras[0]["id"],
        )


def _check_figures(ast, rep):
    refs = scan_refs(ast)
    figures = ast["figures"]
    nfig = len(figures)
    drawings = next(
        (b for b in ast["description"] if b["kind"] == "section" and b["part"] == "description-of-drawings"), None
    )
    drawings_line = _block_line(ast, "description", drawings) if drawings else None
    # 附图说明内出现过的图号属「已声明」——引用已声明未上传的图不是错，drawings_unfiled 已提示
    declared_nums = {r["num"] for r in refs if r.get("in_drawings")}
    seen = set()
    for r in refs:
        if r["num"] < 1 or r["num"] > nfig:
            key = (r["num"], r["line"])
            if key in seen:
                continue
            seen.add(key)
            if r.get("in_drawings"):
                # 附图说明里的图号是声明而非正文引用——起草期先写声明后补图属正常态
                rep.add(
                    "figures.drawings_unfiled",
                    "warning",
                    f"附图说明提到了图{r['num']}，但尚无对应附图文件",
                    r["book"],
                    r["line"],
                    r["block_id"],
                )
                continue
            if r["num"] in declared_nums:
                continue
            msg = (
                f"正文引用了图{r['num']}，但说明书附图只有 {nfig} 张"
                if nfig
                else f"正文引用了图{r['num']}，但未设置说明书附图"
            )
            rep.add("figures.ref_missing", "error", msg, r["book"], r["line"], r["block_id"])
    # 同一图号被声明两次（措辞不同的双行图注）＝起草缺陷。
    # 只认「图N为/是/系…」开头的图注行——标号说明段里「图5基于……绘制」类叙述不算声明。
    declared = {}
    for r in refs:
        if not r.get("in_drawings"):
            continue
        m = _CAPTION_DECL_RE.match(r["text"].strip())
        if not m or int(m.group(1)) != r["num"]:
            continue
        if r["num"] in declared and declared[r["num"]] != r["block_id"]:
            rep.add(
                "figures.caption_dup",
                "warning",
                f"图{r['num']} 在附图说明中被声明了两次",
                r["book"],
                r["line"],
                r["block_id"],
            )
        declared[r["num"]] = r["block_id"]
    rows = []
    for f in figures:
        n = f["num"]
        frefs = [{"book": r["book"], "line": r["line"], "text": r["text"]} for r in refs if r["num"] == n]
        cap_line = _full(ast, "description", f["caption_line"]) if f["caption_line"] is not None else None
        # 效果图/指标图混为附图——专利附图应是说明技术方案的流程/结构/模块示意图，
        # 题注带准确率/对比/曲线等字样的多为论文 benchmark 图（文档序图面无从回看，按题注字面拦住）。
        if f["caption"] and _FIG_EFFECT_CHART.search(f["caption"]):
            rep.add(
                "figures.effect_chart",
                "warning",
                f"图{n} 题注疑似效果/指标类图（「{f['caption'][:40]}」）——附图应收流程/结构/模块示意图，"
                "指标对比类结果以正文文字叙述",
                "description",
                cap_line,
                f["id"],
            )
        if not frefs:
            rep.add(
                "figures.unreferenced",
                "warning",
                f"图{n}（{f['file']}）未被正文引用",
                "description",
                drawings_line,
                f["id"],
            )
        if f["caption"] is None:
            rep.add(
                "figures.caption_missing",
                "warning",
                f"图{n}（{f['file']}）在附图说明中没有题注",
                "description",
                drawings_line,
                f["id"],
                detail=f"在「### 附图说明」中补一行「图{n}为……」",
            )
        rows.append({"num": n, "file": f["file"], "caption_line": cap_line, "refs": frefs})
    return rows


def _numeral_name(run):
    if run.endswith(_NAME_ARITH_END):
        return None
    cut = max((run.rfind(w) + len(w) for w in _NAME_CUT_WORDS if w in run), default=0)
    cut = max(cut, max((run.rfind(ch) + 1 for ch in _NAME_CUT_CHARS if ch in run), default=0))
    name = run[cut:]
    while name and name[0] in _NAME_STRIP_CHARS:
        name = name[1:]
    return name if len(name) >= 2 else None


def _numeral_usages(text):
    """[(num, name)]：含链式「名称N1、N2」与「N1至N2」区间（≤ 30 项）。"""
    out = []
    for m in _NUMERAL_RE.finditer(text):
        name = _numeral_name(m.group(1))
        if name is None:
            continue
        nums = [m.group(2)]
        pos = m.end()
        while True:
            cm = _NUMERAL_CHAIN_RE.match(text, pos)
            if not cm:
                break
            if cm.group(1) in ("至", "到") and len(nums[-1]) == len(cm.group(2)):
                a, b = int(nums[-1]), int(cm.group(2))
                if a < b <= a + 30:
                    nums.extend(str(x).zfill(len(cm.group(2))) for x in range(a + 1, b))
            nums.append(cm.group(2))
            pos = cm.end()
        out.extend((n, name) for n in nums)
    return out


def _consistent(names):
    longest = max(names, key=len)
    return all(longest.endswith(n) for n in names)


def _check_numerals(ast, rep):
    legend = {}  # num → (name, line)
    usages = {}  # num → {"names": [], "lines": [], "block": id}
    for b in ast["description"]:
        if b["kind"] != "paragraph":
            continue
        text = b["text"]
        line = _block_line(ast, "description", b)
        if any(k in text for k in _LEGEND_MARK):
            for m in _LEGEND_RE.finditer(text):
                num, name = m.group(1), _abbr(m.group(2))
                if num in legend:
                    if legend[num][0] != name:
                        rep.add(
                            "numerals.legend_conflict",
                            "warning",
                            f"附图标记 {num} 在图例中定义了两次且名称不同：{legend[num][0]} / {name}",
                            "description",
                            line,
                            b["id"],
                            detail=f"{legend[num][0]}、{name}",
                        )
                else:
                    legend[num] = (name, line)
            continue
        for num, name in _numeral_usages(text):
            u = usages.setdefault(num, {"names": [], "lines": [], "block": b["id"]})
            if name not in u["names"]:
                u["names"].append(name)
            if line not in u["lines"]:
                u["lines"].append(line)
    # 有图例的标记按图例名归一：正文名与图例名互相包含，或正文名的 ≥3 字后缀落在图例名里
    # （「送入编码器」→「编码器」⊂「双向编码器堆叠」）→ 同名归一；无图例的仍按后缀一致性查
    for num, u in usages.items():
        lg = legend.get(num)
        if not lg:
            continue
        lname = lg[0]
        canon = []
        for n in u["names"]:
            mapped = lname if (n in lname or lname in n) else None
            if mapped is None:
                for k in range(len(n) - 2):
                    if len(n[k:]) >= 3 and n[k:] in lname:
                        mapped = lname
                        break
            canon.append(mapped or n)
        u["names"] = list(dict.fromkeys(canon))
    rows = []
    for num in sorted(set(legend) | set(usages), key=lambda s: (len(s), s)):
        u = usages.get(num, {"names": [], "lines": [], "block": None})
        ok = len(u["names"]) < 2 or _consistent(u["names"])
        if not ok:
            rep.add(
                "numerals.inconsistent",
                "warning",
                f"附图标记 {num} 在正文中对应了不同名称：" + "、".join(u["names"]),
                "description",
                u["lines"][0],
                u["block"],
                detail="、".join(u["names"]),
            )
        lg = legend.get(num)
        rows.append(
            {
                "num": num,
                "legend": lg[0] if lg else None,
                "legend_line": lg[1] if lg else None,
                "names": u["names"],
                "lines": u["lines"],
                "consistent": ok,
            }
        )
    return rows


def _check_marks(ast, figures, rep):
    """R-FIG-02：figures.md（figures_md.FiguresDoc）每图 marks 表（标记号 → 名称）↔ 说明书正文。
    numerals.mark_not_in_spec —— 表里的标记号正文（含标号说明）从未出现；锚在引用该图的第一段（无则附图说明题注行）。
    numerals.spec_not_in_marks —— 引用了「图N」的段落用到的标记号不在图N（该段引用的所有带表的图）的表里；锚在该段。
    没有 marks 表的图不查；figures 为 None（旧 settings 路径）不查。"""
    if figures is None:
        return
    marks = {n: f.marks for n, f in enumerate(figures.spec, 1) if f.marks and n <= len(ast["figures"])}
    if not marks:
        return
    paras = [b for b in ast["description"] if b["kind"] == "paragraph"]
    used = set()
    per_para = []  # (block, fig_nums, {num: name})
    for b in paras:
        text = b["text"]
        if any(k in text for k in _LEGEND_MARK):
            used.update(m.group(1) for m in _LEGEND_RE.finditer(text))
            continue
        u = {}
        for num, name in _numeral_usages(text):
            u.setdefault(num, name)
        used.update(u)
        figs = sorted({int(m.group(1)) for m in _FIG_REF_RE.finditer(text)} & set(marks))
        if figs:
            per_para.append((b, figs, u))
    # 锚段：优先引用该图且用了标记的第一段（具体实施方式），其次引用该图的第一段（题注）
    first_ref = {}
    for b, figs, _u in sorted(per_para, key=lambda x: not x[2]):
        for n in figs:
            first_ref.setdefault(n, b)
    for n, table in marks.items():
        for num, name in table.items():
            if num in used:
                continue
            b = first_ref.get(n)
            fig = ast["figures"][n - 1]
            if b is not None:
                line, block_id, para_no = _block_line(ast, "description", b), b["id"], b["para_no"]
            elif fig["caption_line"] is not None:
                line, block_id, para_no = _full(ast, "description", fig["caption_line"]), fig["id"], None
            else:
                line, block_id, para_no = None, fig["id"], None
            where = f"第 {para_no} 段" if para_no is not None else "正文"
            rep.add(
                "numerals.mark_not_in_spec",
                "warning",
                f"图{n} 标记表中的 {num}（{name}）在说明书{where}未出现",
                "description",
                line,
                block_id,
                detail=f"docs/figures.md 图{n} marks: {num} {name}",
                para_no=para_no,
            )
    for b, figs, u in per_para:
        allowed = set().union(*(marks[n] for n in figs))
        extra = [num for num in u if num not in allowed]
        if extra:
            label = "、".join(f"图{n}" for n in figs)
            rep.add(
                "numerals.spec_not_in_marks",
                "warning",
                f"说明书第 {b['para_no']} 段（引用{label}）使用的标记 "
                + "、".join(f"{num}（{u[num]}）" for num in extra)
                + f" 不在{label}的标记表中",
                "description",
                _block_line(ast, "description", b),
                b["id"],
                detail="、".join(extra),
                para_no=b["para_no"],
            )


def _term(run):
    cut = next((i for i, ch in enumerate(run) if i >= 2 and ch in _TERM_CUT_CHARS), len(run))
    return run[:cut]


def _alias_normalizer(terms):
    """terms.json 的别名→主名替换（最长优先，主名本身不动）；terms 为空时返回恒等。"""
    amap = alias_map(terms or [])
    pat = build_pattern(terms or [], amap)
    if pat is None:
        return lambda s: s
    return lambda s: pat.sub(lambda m: amap.get(m.group(0), m.group(0)), s)


def _check_support(ast, rep, terms=None):
    norm = _alias_normalizer(terms)
    paras = [
        (norm(b["text"]), _block_line(ast, "description", b)) for b in ast["description"] if b["kind"] == "paragraph"
    ]
    corpus = "\n".join(t for t, _ in paras)
    groups = {}  # key → row
    order = []
    for c in ast["claims"]:
        for seg in c["segments"]:
            if seg["kind"] != "text":
                continue
            for m in _TERM_RE.finditer(norm(seg["text"])):
                run = _term(m.group(1))
                matched = None
                # 先原词、再剥权利要求语法前导（被/经/已/由/通过/将/对/为/所/最）重试——
                # 「所述被随机掩蔽」的「被」是权项语法而非术语成分，截词不应把它算进术语
                for cand in (
                    run,
                    re.sub(r"^(被|经|已|由|通过|将|对|为|所|最)+", "", run),
                    re.sub(r"(为|是)\S+$", "", run),
                    re.sub(r"(取值|范围|大小|长度|数量|数目|个数|系数|参数|阶段|过程|步骤)$", "", run),
                ):
                    if not cand:
                        continue
                    k = len(cand)
                    while k >= 2 and cand[:k] not in corpus:
                        k -= 1
                    if k >= 2:
                        matched = cand[:k]
                        break
                key = matched or run
                row = groups.get(key)
                if row is None:
                    lines = [ln for t, ln in paras if matched in t][:5] if matched else []
                    row = {
                        "term": key,
                        "claims": [],
                        "matched": matched,
                        "description_lines": lines,
                        "supported": matched is not None,
                        "_claim": c,
                    }
                    groups[key] = row
                    order.append(key)
                if c["num"] not in row["claims"]:
                    row["claims"].append(c["num"])
    rows = []
    for key in order:
        row = groups.pop(key)
        c = row.pop("_claim")
        if not row["supported"]:
            rep.add(
                "claims.unsupported_term",
                "warning",
                f"权利要求 {'、'.join(map(str, row['claims']))} 中的「所述{row['term']}」在说明书中找不到对应术语",
                "claims",
                _block_line(ast, "claims", c),
                c["id"],
                detail=row["term"],
                claim=c["num"],
            )
        rows.append(row)
    return rows


# 撰写过程词（交底/核对/暂按/待补……）语料千件零命中——混进说明书就是起草缺陷；
# 「疑似」只在附图说明内敏感（正式图注不会写疑似）。
# 「交底」覆盖 交底书/交底材料/交底范围（resnet-10 实案 6 处残留——论文转化稿文体污染）
_META_WORDS = re.compile(r"交底(?:书|材料|范围)?|建议核对|请核对|暂按|待核|未作说明|待补充|待完善|尚未描述|拟定")


_META_WORDS_DRAWINGS = re.compile(r"疑似")


_CAPTION_DECL_RE = re.compile(r"^图\s*(\d+)\s*(?:为|是|系)")
_FIG_EFFECT_CHART = re.compile(
    r"准确率|对比图|曲线|召回率|热力图|照片|可视化|mAP|mIoU|BLEU|"
    r"accuracy|benchmark|loss\s*curve|attention\s*map",
    re.I,
)


# 论文腔评论/类比句——授权说明书只写技术事实与技术效果；论文转稿残留的修辞
# （可视为…的推广/换句话说/值得注意的是）审查口径为不清楚。语料 1001 件命中
# 3-31 件（≤3%），故 warning 级。
_PAPER_TONE = re.compile(r"可视为|换句话说|换言之|值得注意的是|直观地说|容易看出|众所周知|在某种意义上|的推广")


def _check_meta_wording(ast, rep):
    cur_part = None
    for b in ast["description"]:
        if b["kind"] == "section":
            cur_part = b.get("part")
            continue
        if b["kind"] != "paragraph":
            continue
        text = b.get("text") or ""
        hits = list(dict.fromkeys(m.group(0) for m in _META_WORDS.finditer(text)))
        if cur_part == "description-of-drawings":
            hits += [h for h in dict.fromkeys(m.group(0) for m in _META_WORDS_DRAWINGS.finditer(text)) if h not in hits]
        if hits:
            rep.add(
                "spec.meta_wording",
                "warning",
                f"说明书含撰写性/存疑措辞「{'、'.join(hits)}」——正文只写技术内容，起草存疑交回批注或提案",
                "description",
                _block_line(ast, "description", b),
                b["id"],
            )


def _check_paper_tone(ast, rep):
    for b in ast["description"]:
        if b["kind"] != "paragraph":
            continue
        text = b.get("text") or ""
        hits = list(dict.fromkeys(m.group(0) for m in _PAPER_TONE.finditer(text)))
        if hits:
            rep.add(
                "spec.paper_tone",
                "warning",
                f"说明书含论文式评论/类比措辞「{'、'.join(hits)}」——只写技术事实与技术效果",
                "description",
                _block_line(ast, "description", b),
                b["id"],
            )


_SENT_SPLIT = re.compile(r"(?<=[。！？；])")


def _check_corpus_overlap(ast, rep):
    """语料重叠哨兵：生成句与 CN 公开案语料撞车（整句搬运或 12-gram 大段命中）报 warning。
    形库供仿句式，禁搬原句——命中说明模型在搬运而非模仿（对应 spec.corpus_overlap）。
    语料索引缺失时静默不查。"""
    from patent_studio.kernel import text_forms

    for b in ast["description"]:
        if b["kind"] != "paragraph":
            continue
        sents = [s for s in _SENT_SPLIT.split(b.get("text") or "") if len(s.strip()) >= 6]
        if not sents:
            continue
        hits = text_forms.corpus_overlap(sents)
        for h in hits:
            rep.add(
                "spec.corpus_overlap",
                "warning",
                f"说明书句子与已公开专利语料高度重合「{h[:60]}…」——须重写，勿搬原句",
                "description",
                _block_line(ast, "description", b),
                b["id"],
                detail=h,
            )


def _check_figures_md(ast, figs, rep):
    """W4-C C1（docs/plan/15 §2.5）：
    figures.alt_mismatch（warning）—— figures.md 的 alt 与说明书「图N为…」题注不一致；
    figures.file_missing（error）—— figures.md 引用的 figs/<file> 不存在（figs 为 None 时不查）。
    两条都落在附图书：book=None、line=None，block_id=figures/N，detail 指向 docs/figures.md。
    alt 为空 / None（旧 settings 路径）不查；比对时去掉 alt 前缀「图N」与两边首尾空白。"""
    for f in ast["figures"]:
        n, alt = f["num"], f.get("alt")
        if figs is not None and f["file"] not in figs:
            rep.add(
                "figures.file_missing",
                "error",
                f"图{n} 引用的 figs/{f['file']} 不存在",
                None,
                None,
                f["id"],
                detail=f"docs/figures.md 第 {n} 行：![{alt or ''}](figs/{f['file']})",
            )
        if alt and f["caption"] is not None:
            shown = re.sub(r"^图\d+\s*", "", alt.strip())
            if shown and shown != f["caption"].strip():
                msg = f"图{n} 在 figures.md 的 alt「{shown}」与说明书题注「{f['caption']}」不一致"
                rep.add("figures.alt_mismatch", "warning", msg, None, None, f["id"], detail="docs/figures.md")


def _check_inline_figs(ast, figs, rep):
    """W18：figures.inline_missing（error）——说明书内嵌图块（kind=figure）引用的 figs/<file>
    不存在；figs 为 None 时不查。缺文件会让 DOCX 构建在 add_figure 处失败，故 error 级。"""
    if figs is None:
        return
    for b in ast["description"]:
        if b.get("kind") == "figure" and b["file"] not in figs:
            rep.add(
                "figures.inline_missing",
                "error",
                f"说明书内嵌图引用的 figs/{b['file']} 不存在",
                "description",
                _block_line(ast, "description", b),
                b["id"],
                detail=(b.get("alt") or None),
            )


def _accept_markup(ast):
    """CriticMarkup 归一：s1 提案以建议模式落 {--删--}{++增++} 标记，正文类规则须按
    接受后文本判定（ddpm-12 实案 abstract.limit 把已删占位行计入字数误报超限）。"""
    if isinstance(ast.get("title"), dict) and ast["title"].get("text"):
        ast["title"]["text"] = critic.accept(ast["title"]["text"])
    for p in ast["abstract"]["paragraphs"]:
        if p.get("text"):
            p["text"] = critic.accept(p["text"])
    for c in ast["claims"]:
        for seg in c.get("segments") or []:
            if seg.get("text"):
                seg["text"] = critic.accept(seg["text"])
    for b in ast["description"]:
        if b.get("text"):
            b["text"] = critic.accept(b["text"])


__all__ = [
    "_CAPTION_DECL_RE",
    "_EQ_TAG_RE",
    "_EQ_TRAIL_RE",
    "_MARK_BIND_RE",
    "_META_WORDS",
    "_META_WORDS_DRAWINGS",
    "_PAPER_TONE",
    "_Report",
    "_TAB_CAPTION_LINE_RE",
    "_TAB_REF_RE",
    "_abbr",
    "_accept_markup",
    "_alias_normalizer",
    "_block_line",
    "_check_abstract",
    "_check_claim_form",
    "_check_claims",
    "_check_corpus_overlap",
    "_check_equations",
    "_check_figures",
    "_check_figures_md",
    "_check_inline_figs",
    "_check_legal_rhythm",
    "_check_marks",
    "_check_meta_wording",
    "_check_numerals",
    "_check_paper_tone",
    "_check_spec_form",
    "_check_spec_numbering",
    "_check_support",
    "_claim_targets",
    "_claim_text",
    "_consistent",
    "_formula_norm",
    "_full",
    "_numeral_name",
    "_numeral_usages",
    "_promo_hits",
    "_term",
    "scan_refs",
]
