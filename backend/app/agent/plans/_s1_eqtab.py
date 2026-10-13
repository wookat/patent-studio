"""s1 拆分件（按职责搬出；名照旧私有下划线，s1.py 经 star re-export 保持原命名空间）。"""
from __future__ import annotations

import re


def _lazy_run(*a, **kw):
    # 与 s1.run 互递归——懒导入破环（模块层 from .s1 会与 s1 的 star re-export 成环）
    from app.agent.plans import s1 as _s1
    return _s1.run(*a, **kw)


_CAPTION_LINE = re.compile(r"^\s*图\s*(\d+)\s*[为是系]")


_EQ_DECL = re.compile(
    r"(?:\$\$([^$]+)\$\$|\$([^$\n]+)\$)\s*([（(]?\s*式?\s*[（(]\s*(\d+)\s*[)）])")


_EQ_TAG = re.compile(
    r"\$\$([^$]*?)(?:\\tag\{\s*式?\s*[（(]?\s*(\d+)\s*[)）]?\s*\}"
    r"|\\q?quad\s*\{?\s*式?\s*[（(]?\s*(\d+)\s*[)）]?\s*\}?)([^$]*?)\$\$")


_EQ_REF = re.compile(r"式\s*[（(]\s*(\d+)\s*[)）]")


_EQ_TAG_RE = re.compile(
    r"\\tag\{\s*式?\s*[（(]?\s*(\d+)\s*[)）]?\s*\}"
    r"|\\q?quad\s*\{?\s*式?\s*[（(]?\s*(\d+)\s*[)）]?\s*\}?")


# 题注识别亦收裸表号桩 `{++表4++}`（bert-14 实案连发 表4/5/6 秃行）——
# 标号后仅标记残留也算题注，缺表体核对收留后走补弹配题注+表体
_TAB_CAPTION = re.compile(r"^\s*(?:\{[+x\-<>]{2}\s*)?表\s*(\d+)(?:\s|(?=\+\+|--|~~)|$)")


_TAB_REF = re.compile(r"表\s*(\d+)")


_TEXT_EQ = re.compile(
    r"^(?P<body>[^\n。；：、「」]{4,300}?)[\s　]*式\s*[（(]\s*(?P<num>\d+)\s*[)）]\s*$")


_TEXT_EQ_OP = re.compile(r"[=＝∝∈~∼±×÷≈≤≥≡⇒→←]")


# 行首式号声明+行内公式形：`式(1)：$…$` / `式(1)：$$…$$`——式号应居中独立行而非左贴
# （bert-12 实施方式式(1)-(5)全此形，且带 {++…++} 标记包裹）
_TEXT_EQ_LEAD = re.compile(
    r"^式\s*[（(]\s*(?P<num>\d+)\s*[)）]\s*[：:]\s*\$(?P<body>.+?)\$\s*[。\.；;]?\s*$")


_TEXT_EQ_LEAD_DISP = re.compile(
    r"式\s*[（(]\s*(?P<num>\d+)\s*[)）]\s*[：:]\s*\$\$(?P<body>.+?)\$\$")


_TEXT_EQ_MATHY = re.compile(
    r"[_^{}\\√∑∏∫‖⊙⊗∘′″²³¹⁰⁴⁵⁶⁷⁸⁹⁻⁺ⁿᵗˡ]|softmax|exp|log|min|max|\w_|[α-ωΑ-Ω]")


def _text_eq_to_latex(body: str) -> str:
    """纯文本公式体补 LaTeX 包裹——vit-9 实案的 `z_0=[x_class; t′_1; …]　式(3)`
    行内容已近似 LaTeX 记号（_{}/^{} 俱在），仅差界定符与少量 unicode 算符转写。"""
    body = body.strip()
    body = body.replace("′", "'").replace("″", "''").replace("…", r"\ldots")

    def _sqrt_paren(m: re.Match) -> str:
        i = m.end()
        depth, j = 1, i
        while j < len(body) and depth:
            depth += body[j] == "("
            depth -= body[j] == ")"
            j += 1
        return r"\sqrt{" + body[i:j - 1] + "}" + body[j:]

    while True:
        m = re.search(r"√\s*\(", body)
        if not m:
            break
        body = body[:m.start()] + _sqrt_paren(m)
    body = re.sub(r"√\s*([A-Za-z0-9_\{\}]+)", r"\\sqrt{\1}", body)
    body = re.sub(r"([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿᵗˡ])",
                  lambda m: "^" + {"⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
                                   "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
                                   "⁺": "+", "⁻": "-", "ⁿ": "n", "ᵗ": "t", "ˡ": "l"}[m.group(1)],
                  body)
    for u, lt in (("∑", r"\sum "), ("∏", r"\prod "), ("∫", r"\int "),
                  ("⊙", r"\odot "), ("⊗", r"\otimes "), ("∘", r"\circ "),
                  ("≈", r"\approx "), ("≤", r"\leq "), ("≥", r"\geq "), ("≠", r"\neq "),
                  ("∝", r"\propto "), ("∈", r"\in "), ("⊆", r"\subseteq "),
                  ("‖", r"\|"), ("−", "-"), ("×", r"\times "), ("·", r"\cdot "),
                  ("α", r"\alpha "), ("β", r"\beta "), ("ε", r"\varepsilon "),
                  ("γ", r"\gamma "), ("δ", r"\delta "), ("η", r"\eta "),
                  ("θ", r"\theta "), ("λ", r"\lambda "), ("μ", r"\mu "),
                  ("σ", r"\sigma "), ("φ", r"\phi "), ("ω", r"\omega "),
                  ("Δ", r"\Delta "), ("∇", r"\nabla "), ("π", r"\pi ")):
        body = body.replace(u, lt)
    return body


# $ 界定符外的裸 LaTeX 命令串——ddpm-r85 实案 [0048] `\bar{\alpha}t` 原样印进正文；
# 命令串（`\|…\|^2`、`\bar{\alpha}t`、`\sqrt{…}`）自反斜杠起吃到 CJK/空白边界
_BARE_LATEX = re.compile(
    r"\\(?=[a-zA-Z\\|{}()_^\[\]])[^\s\u4e00-\u9fff。，、；：！？「」（）]*")


_MATH_SPAN = re.compile(r"\$\$[^$]+\$\$|\$[^$\n]+\$")


def _wrap_bare_latex(text: str) -> str:
    """界定符外裸 LaTeX 命令就地包 $…$ 接入 OMML；已在 $…$/$$…$$ 内的串不动。"""
    out: list[str] = []
    i = 0
    for m in _MATH_SPAN.finditer(text):
        out.append(_BARE_LATEX.sub(lambda mm: "$" + mm.group(0) + "$", text[i:m.start()]))
        out.append(m.group(0))
        i = m.end()
    out.append(_BARE_LATEX.sub(lambda mm: "$" + mm.group(0) + "$", text[i:]))
    return "".join(out)


def _wrap_text_formulas(text: str) -> str:
    """整段为纯文本公式的段（`f(x)=…　式(N)`）包为 `$$…$$式(N)`——接入 LaTeX→OMML
    管线，DOCX 不再原样印出 _{}/^{} 记号；不含式号的裸公式段同样包壳（不编号）。"""
    # `式(N)：$$…$$` 先全局改写（段内/标记包裹内皆收），再走逐段包壳
    text = _TEXT_EQ_LEAD_DISP.sub(lambda m: f"$${m.group('body')}$$式({m.group('num')})", text)
    out: list[str] = []
    for p in text.split("\n\n"):
        p = _wrap_bare_latex(p)
        s = p.strip()
        # `式(N)：$…$` 行内左贴形——bert-12 实施方式式(1)-(5)全此形：式号声明应走
        # 居中独立行（发明内容 $$ 形已居中），统一包 $$..$$式(N) 复用同链
        m_lead = _TEXT_EQ_LEAD.match(s)
        if m_lead:
            out.append(f"$${m_lead.group('body')}$$式({m_lead.group('num')})")
            continue
        if "$" in s or "\n" in s:
            out.append(p)
            continue
        m = _TEXT_EQ.match(s)
        if m and _TEXT_EQ_OP.search(m.group("body")) and _TEXT_EQ_MATHY.search(m.group("body")):
            out.append(f"$${_text_eq_to_latex(m.group('body'))}$$式({m.group('num')})")
            continue
        # 无式号裸公式段：整行数学密度高且无句读——`z_0=[x_class; …]` 形
        if ("=" in s or "＝" in s) and len(s) <= 240 and _TEXT_EQ_MATHY.search(s) \
                and not re.search(r"[。；：、「」的在了将经并按]", s):
            out.append(f"$${_text_eq_to_latex(s)}$$")
            continue
        out.append(p)
    return "\n\n".join(out)


def _eq_decls_ordered(text: str) -> list[tuple[str, str, tuple[int, int]]]:
    """段内 式(N) 声明按位置序——$$..$$式(N)、$$..$$（式(N)）、LaTeX 内嵌编号
    $$..\\tag{N}..$$（resnet-10 实案同号异式漏网形）三形皆收。
    返回 [(号, 公式体, 标记片段 span)]——span 供出现级改写。"""
    def _norm(s: str) -> str:
        s = re.sub(r"\\tag\{\s*\d+\s*\}|\\q?quad\s*\{?\s*[（(]?\s*\d+\s*[)）]?\s*\}?", "", s)
        return re.sub(r"\s+", "", s).replace("\\{", "{").replace("\\}", "}")
    out: list[tuple[int, str, str, tuple[int, int]]] = []
    for m in _EQ_DECL.finditer(text):
        body = _norm(m.group(1) or m.group(2) or "")
        out.append((m.start(), m.group(4), body, m.span(3)))
    for m in _EQ_TAG.finditer(text):
        body = _norm((m.group(1) or "") + (m.group(4) or ""))
        tm = _EQ_TAG_RE.search(m.group(0))
        span = (m.start() + tm.start(), m.start() + tm.end()) if tm else (m.start(), m.start())
        out.append((m.start(), m.group(2) or m.group(3), body, span))
    out.sort(key=lambda x: x[0])
    return [(n, b, s) for _, n, b, s in out]


def _eq_decls(text: str) -> dict[str, str]:
    """段内 式(N) 声明→紧邻公式体（规范化），首个声明为准。"""
    out: dict[str, str] = {}
    for n, body, _ in _eq_decls_ordered(text):
        out.setdefault(n, body)
    return out


def _eq_renumber(text: str, taken: dict[str, str]) -> str:
    """跨书式号归一：taken 为已确认的全局 式N→公式体 台账。声明与台账同号异式时
    换用下一个空闲号；一致的声明并入台账。出现级处理——同号异式的第 k 次声明
    也换新号（resnet-10 实案 式N 与 \\tagN 双轨+同段三处同号）。引用按号全局重写
    （旧号→末次新号），残余歧义由 preflight 残余告警兜住。"""
    decl = _eq_decls_ordered(text)
    if not decl:
        return text
    ledger = dict(taken)
    remap: dict[str, str] = {}
    edits: list[tuple[int, int, str]] = []
    spans = [s for _, _, s in decl]
    nxt = max([int(x) for x in list(ledger) + [n for n, _, _ in decl]] + [0]) + 1
    canon_of = {v: k for k, v in ledger.items()}
    for n, body, span in decl:
        canon = canon_of.get(body)
        if canon and canon != n:
            # 同式异号重申——式体台账已有，声明却换了号（vit-10 实案 式12 与 式5 同体）；
            # 声明与全部同号引用一起回到正号
            s, e = span
            edits.append((s, e, re.sub(r"\d+", canon, text[s:e], count=1)))
            remap[n] = canon
            continue
        if n in ledger and ledger[n] != body:
            while str(nxt) in ledger or str(nxt) in remap.values():
                nxt += 1
            remap[n] = str(nxt)
            ledger[str(nxt)] = body
            canon_of[body] = str(nxt)
            s, e = span
            edits.append((s, e, re.sub(r"\d+", str(nxt), text[s:e], count=1)))
        elif n not in ledger and n.isdigit() and int(n) > max(
                [int(x) for x in ledger if x.isdigit()] + [0]) + 1:
            # 跳号补位——声明号越过台账最大号（vit-10 实案 式11 断档直接写式12），
            # 顺位补到下一空号并把同号引用一并改写
            s, e = span
            new_n = str(max([int(x) for x in ledger if x.isdigit()] + [0]) + 1)
            remap[n] = new_n
            ledger[new_n] = body
            canon_of[body] = new_n
            edits.append((s, e, re.sub(r"\d+", new_n, text[s:e], count=1)))
        else:
            ledger.setdefault(n, body)
            canon_of.setdefault(body, n)
    taken.update(ledger)
    if not remap:
        return text
    # 声明标记之外的全部引用按号重写（标记本身已被出现级编辑覆盖，不能再被引用重写误伤）
    for m in _EQ_REF.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        if m.group(1) in remap:
            edits.append((m.start(), m.end(), "式(" + remap[m.group(1)] + ")"))
    for s, e, repl in sorted(edits, reverse=True):
        text = text[:s] + repl + text[e:]
    return text


def _retable(text: str, taken: set[str]) -> str:
    """跨书表号归一：「表N」题注段（段首即表号）在后文重复时换新号，
    并同步该题注至下一题注之间的同号引用。"""
    paras = text.split("\n\n")
    out = list(paras)
    for i, p in enumerate(paras):
        m = _TAB_CAPTION.match(p)
        if not m:
            continue
        n = m.group(1)
        if n not in taken:
            taken.add(n)
            continue
        nxt = max([int(x) for x in taken] + [0]) + 1
        while str(nxt) in taken:
            nxt += 1
        taken.add(str(nxt))
        # 重写本段题注 + 至下一题注段之间的引用
        out[i] = _TAB_REF.sub(
            lambda mm, n=n, m=nxt: "表" + str(m) if mm.group(1) == n else mm.group(0), p)
        for j in range(i + 1, len(paras)):
            if _TAB_CAPTION.match(paras[j]):
                break
            out[j] = _TAB_REF.sub(
                lambda mm, n=n, m=nxt: "表" + str(m) if mm.group(1) == n else mm.group(0),
                out[j])
    return "\n\n".join(out)


def _tables_missing_body(text: str) -> list[str]:
    """题注段后 1 段内无 | 表格行 = 声明了表却没有表体；或仅表头一行无数据行
    （resnet-10 实案表2 残表）。返回题注段原文列表。"""
    paras = [p for p in text.split("\n\n")]
    out = []
    for i, p in enumerate(paras):
        m = _TAB_CAPTION.match(p)
        if not m:
            continue
        nxt = paras[i + 1] if i + 1 < len(paras) else ""
        if sum("|" in ln for ln in nxt.split("\n")) < 2:
            out.append(p.strip())
    return out


def _table_refs_missing(text: str) -> list[str]:
    """正文引用了表N（如表N所示/见表N/表N中）但全文无 表N 题注段——
    vit-9 实案：表体被堆文末、题注缺失，引用悬空。"""
    caps = set()
    for p in text.split("\n\n"):
        m = _TAB_CAPTION.match(p.strip())
        if m:
            caps.add(m.group(1))
    return sorted({m.group(1) for m in _TAB_REF.finditer(text)} - caps, key=int)


# 表引用语义错配——bert-15 实案「测试指标如表1所示」但 表1=编码器结构（指标在表4）；
# bert-14「评测结果如表1所示」表1=规模配置（结果在表3）。词表按题注/语境分档，
# 异档引用在存在唯一同档替代表时确定性改号
_TAB_EVAL_WORDS = ("结果", "指标", "评测", "测试", "性能", "对比", "准确", "精度",
                   "误差", "优于", "基线", "提升")


_TAB_STRUCT_WORDS = ("配置", "构成", "结构", "参数", "规则", "策略", "组成", "维度",
                     "设置", "规模", "定义", "取值")


def _fix_semantic_tab_refs(text: str) -> str:
    """表N 引用的语境档位与题注档位冲突时改号至唯一同档题注。
    题注段自身不动；语境两档兼具或替代表不唯一时保持原号（不盲改）。"""
    caps: dict[str, str] = {}
    for p in text.split("\n\n"):
        m = _TAB_CAPTION.match(p.strip())
        if m:
            caps.setdefault(m.group(1), p.strip())
    if len(caps) < 2:
        return text
    eval_caps = [n for n, c in caps.items()
                 if any(w in c for w in _TAB_EVAL_WORDS)
                 and not any(w in c for w in _TAB_STRUCT_WORDS)]
    struct_caps = [n for n, c in caps.items()
                   if any(w in c for w in _TAB_STRUCT_WORDS)
                   and not any(w in c for w in _TAB_EVAL_WORDS)]
    out: list[str] = []
    for p in text.split("\n\n"):
        if _TAB_CAPTION.match(p.strip()):
            out.append(p)
            continue
        ctx_eval = any(w in p for w in _TAB_EVAL_WORDS)
        ctx_struct = any(w in p for w in _TAB_STRUCT_WORDS)
        if ctx_eval == ctx_struct:
            out.append(p)
            continue

        def _sub(mm, p_eval=ctx_eval):
            n = mm.group(1)
            if n not in caps or n.startswith("0"):
                return mm.group(0)
            cap = caps[n]
            cap_eval = any(w in cap for w in _TAB_EVAL_WORDS)
            cap_struct = any(w in cap for w in _TAB_STRUCT_WORDS)
            if p_eval and cap_struct and not cap_eval \
                    and len(eval_caps) == 1 and eval_caps[0] != n:
                return "表" + eval_caps[0]
            if not p_eval and cap_eval and not cap_struct \
                    and len(struct_caps) == 1 and struct_caps[0] != n:
                return "表" + struct_caps[0]
            return mm.group(0)

        out.append(_TAB_REF.sub(_sub, p))
    return "\n\n".join(out)


_MATH_SPAN = re.compile(r"\$\$[^$]*\$\$|\$[^$]*\$")


def _strip_math(s: str) -> str:
    r"""剥 $$..$$/$..$ 数学记号——LaTeX \times|\mathcal{V}| 里的 | 会被数成表格列
    （bert-15 实案：纯散文段因含两个 |V| 被误判为 3 列孤儿表头残段，数据错灌散文）。"""
    return _MATH_SPAN.sub("", s)


def _is_table_block(p: str) -> bool:
    """段是否为表格块（≥2 行含 | 或分隔线主导）。"""
    lines = [l for l in p.split("\n") if l.strip()]
    if not lines:
        return False
    if sum("|" in _strip_math(l) for l in lines) >= 2:
        return True
    return bool(re.match(r"^[\s|:\-]+$", p.strip()) and "-" in p)


def _table_zone_end(paras: list[str], cap_i: int) -> int:
    """题注段 cap_i 起的「表区」末段下标——题注后连续的含 | 段落或形似表行的散段
    （vit-8 实案：表体被拆成逐段散行）。返回末段索引（含题注段自身）。"""
    j = cap_i + 1
    while j < len(paras):
        p = paras[j]
        if _is_table_block(p):
            j += 1
            continue
        # 单行含 | 的散行段（如 `方案 | 不依赖 | …`）也算表区成员——
        # 数学记号内 | 不算（剥 $$..$$ 再判）
        if "|" in _strip_math(p) and len([l for l in p.split("\n") if l.strip()]) <= 2:
            j += 1
            continue
        break
    return j - 1


def _strip_detached_tables(text: str) -> str:
    """游离表片剥离：表格块前接的不是题注/表格块即游离（vit-8 实案——模型把 表1/表2
    表体连同分隔线堆在文末，还有一份纯文本重复版）；纯文本段若 ≥3 行与文中任一
    表格块的行（去 | 归一）重合，按重复残片一并剥除。"""
    paras = text.split("\n\n")
    rows_in_tables: set[str] = set()
    for p in paras:
        if _is_table_block(p):
            for l in p.split("\n"):
                ln = re.sub(r"[\s|]+", " ", l).strip()
                if ln and not re.match(r"^[\-:\s]+$", ln):
                    rows_in_tables.add(ln)
    out: list[str] = []
    prev_legal_table = False
    legal_sigs: list[frozenset] = []
    for i, p in enumerate(paras):
        if _is_table_block(p):
            prev_p = paras[i - 1].strip() if i > 0 else ""
            # 合法表块 = 前接题注，或前接的表块本身合法（表体续块）；
            # 游离表块后续的表块同样游离（vit-8 文末两片连续残表）
            legal = i > 0 and (_TAB_CAPTION.match(prev_p) or prev_legal_table)
            prev_legal_table = legal
            if not legal:
                continue
            # 同表两发去重——bert-14 实案模型把整表发两遍（题注黏连段内一遍 +
            # 紧随的独立完整表一遍）；行集合为既有合法表子集即重复残件
            sig = frozenset(
                ln for l in p.split("\n")
                if (ln := re.sub(r"[\s|]+", " ", l).strip()) and not re.match(r"^[\-:\s]+$", ln))
            if sig and any(sig <= s or sig == s for s in legal_sigs):
                continue
            legal_sigs.append(sig)
        else:
            prev_legal_table = False
            # 纯文本重复版：≥3 非空行且多数与某表格行重合
            lines = [re.sub(r"[\s|]+", " ", l).strip() for l in p.split("\n") if l.strip()]
            hits = sum(1 for l in lines if l in rows_in_tables)
            if len(lines) >= 3 and hits >= 3 and hits >= len(lines) // 2:
                continue
        out.append(p)
    return "\n\n".join(out)


def _single_pipe_frag(p: str) -> bool:
    """单行表行残段——孤头无体的表残片（vit-10 实案 表1 表头单段遗弃）。
    完整 markdown 表至少两行，单行 | 段永远不会是合法表。剥数学记号后
    须以 | 起首——含 |V| 类 LaTeX 的散文行不是表残段（bert-15 实案误灌）。"""
    lines = [l for l in p.split("\n") if l.strip()]
    if len(lines) != 1:
        return False
    l = _strip_math(lines[0]).strip()
    return l.startswith("|") and l.count("|") >= 2


def _pipe_cols(line: str) -> int:
    """|a|b|c| 行计列数——首尾 | 为定界不计；剥数学记号防 |V| 幻影列。"""
    return max(0, _strip_math(line).count("|") - 1)


def _tbl_sig(p: str) -> frozenset:
    """表块行签名——行去 | 归一、剔分隔线的 frozenset，用于重发判定。"""
    return frozenset(
        ln for l in p.split("\n")
        if (ln := re.sub(r"[\s|]+", " ", l).strip()) and not re.match(r"^[\-:\s]+$", ln))


def _zone_member(paras: list[str], gone: set, i: int) -> bool:
    """段 i 是否处于「题注引领的表区」内部——live-prev（跳过已 gone 段）为题注，
    或 live-prev 为表块且其自身 live-prev 为题注。孤儿堆链成员不算区内成员，
    仍允许归位（bert-14 实案文末表体链中除链首外全被误判为续表）。"""
    pi = next((k for k in range(i - 1, -1, -1) if k not in gone), -1)
    if pi < 0:
        return False
    if _TAB_CAPTION.match(paras[pi].strip()):
        return True
    if _is_table_block(paras[pi]):
        pj = next((k for k in range(pi - 1, -1, -1) if k not in gone), -1)
        return pj >= 0 and _TAB_CAPTION.match(paras[pj].strip())
    return False


def _rejoin_split_tables(text: str) -> str:
    """拆散表拼合——模型把一张表的头/分隔线/数据拆到不同段（vit-10 实案三体分裂）。
    两类归位：分隔线起首的无题注表块拼回最近的同列数单行表头段；
    纯数据行块拼回前方同列数的题注表（表体被 prose 隔开的续表）。"""
    paras = text.split("\n\n")
    # 题注与表体同段黏连归一（bert-14 实案：模型用 \n 而非 \n\n 连题注与表，
    # 融合段被 _is_table_block 当无题注表、题注藏在段内不被发现 → 错插裸序号）
    # 首行命中题注且其余行构成表块 → 拆成题注段+表段
    _paras: list[str] = []
    for p in paras:
        lines = p.split("\n")
        if len(lines) > 1 and _TAB_CAPTION.match(lines[0].strip()) \
                and _is_table_block("\n".join(lines[1:])):
            _paras += [lines[0], "\n".join(lines[1:])]
        else:
            _paras.append(p)
    paras = _paras
    gone: set[int] = set()
    # A：分隔线起首的表块 ← 最近同列数单行 | 表头
    for i, p in enumerate(paras):
        if not _is_table_block(p):
            continue
        first = p.lstrip().split("\n")[0]
        if not re.match(r"^\s*\|?\s*:?-{2,}", first):
            continue
        if i > 0 and _TAB_CAPTION.match(paras[i - 1].strip()):
            continue
        cols = _pipe_cols(first)
        for j in range(i - 1, -1, -1):
            pj = paras[j]
            # 单行 | 残段且前无题注 → 孤儿表头（已被题注领走的表头跳过，
            # 不终止扫描——vit-10 实案 表1 表头在 表2 题注之前隔 40+ 段）
            if (_single_pipe_frag(pj) and _pipe_cols(pj) == cols
                    and (j == 0 or not _TAB_CAPTION.match(paras[j - 1].strip()))):
                paras[j] = pj + "\n" + p  # 表头+分隔线+数据行
                gone.add(i)
                break
    paras = [p for i, p in enumerate(paras) if i not in gone]
    # 对塌：紧邻两表块成行集覆盖关系 → 留全去半——bert-14 实案文末
    # [数据组][头+数据完整表] 成对堆叠，子集半是完整表的复制品
    gone = set()
    for a, b in zip(range(len(paras)), range(1, len(paras))):
        pa, pb = paras[a], paras[b]
        if not (_is_table_block(pa) and _is_table_block(pb)):
            continue
        sa, sb = _tbl_sig(pa), _tbl_sig(pb)
        if not sa or not sb:
            continue
        if sa == sb or sb < sa:
            gone.add(b)
        elif sa < sb:
            gone.add(a)
    paras = [p for i, p in enumerate(paras) if i not in gone]
    # C：文末完整表（头行+数据、无题注）按头行逐字相同绑回题注表头——
    # bert-14 实案三表均被双发（题注表头空壳 + 文末完整体），列数相同会让
    # Pass B 错配到最近题注；头行等值绑定是精确口径，补分隔线成完整表。
    # 先于 B 跑：完整表先归位，B 只剩真续表行可按列数合并
    def _norm(l: str) -> str:
        return re.sub(r"[\s|]+", " ", l).strip()

    gone = set()
    for i, p in enumerate(paras):
        if not _is_table_block(p):
            continue
        first = p.lstrip().split("\n")[0]
        if re.match(r"^\s*\|?\s*:?-{2,}", first):
            continue
        if _zone_member(paras, gone, i):
            continue
        hnorm = _norm(first)
        if not hnorm:
            continue
        for j in range(i - 1, -1, -1):
            if not _TAB_CAPTION.match(paras[j].strip()):
                continue
            if j + 1 < len(paras):
                nxt = paras[j + 1]
                nh = nxt.lstrip().split("\n")[0]
                if "|" in nh and _norm(nh) == hnorm:
                    body = p.split("\n")
                    if len(body) > 1 and not re.match(r"^\s*\|?\s*:?-{2,}", body[1]):
                        body = [body[0], "|" + "---|" * _pipe_cols(first)] + body[1:]
                    paras[j + 1] = "\n".join(body)
                    gone.add(i)
                    break
    paras = [p for i, p in enumerate(paras) if i not in gone]
    # B：纯数据行块（无分隔线起首）← 前方同列数题注表（续表行被 prose 隔开）
    # B：孤儿数据块归位——纯数据行块与「分隔线起首缺表头」块统一按列数
    # 归并到题注表。候选取「题注+紧随表头行」：
    #   - 空体题注（紧随段仅为表头残段，体被整体搬走）优先——bert-15 实案
    #     题注后只有表头行、数据全在文末，须先满足空体题注
    #   - 列数相同多题注时按扫描序（文末堆叠先并先到者先得体）
    #   - 空体题注缺位退到最近同列完整题注表（续表语义）
    gone = set()
    for i, p in enumerate(paras):
        if not _is_table_block(p):
            continue
        if _zone_member(paras, gone, i):
            continue  # 合法表区内部成员不归并；孤儿堆链成员允许归位
        first = p.lstrip().split("\n")[0]
        cols = _pipe_cols(first)
        bodiless_j = complete_j = -1
        for j in range(i - 1, -1, -1):
            pj = paras[j]
            if not _TAB_CAPTION.match(pj.strip()):
                continue
            if j + 1 >= len(paras):
                continue
            nxt = paras[j + 1]
            head = nxt.lstrip().split("\n")[0]
            if not (head.strip().startswith("|") and _pipe_cols(head) == cols):
                continue
            if _single_pipe_frag(nxt):
                bodiless_j = j
                break
            if complete_j < 0:
                complete_j = j
        j = bodiless_j if bodiless_j >= 0 else complete_j
        if j < 0:
            continue
        nxt = paras[j + 1]
        head = nxt.lstrip().split("\n")[0]
        # 并入行集去重：块首行若与表头同行（完整表残件）剥首行，分隔线行丢弃，
        # 已在表体内的行不再追加以防双发污染
        body = [l for l in p.split("\n")
                if _norm(l) and _norm(l) != _norm(head)
                and not re.match(r"^\s*\|?\s*:?-{2,}", l)]
        base = (nxt if len(nxt.split("\n")) > 1 and re.match(
                r"^\s*\|?\s*:?-{2,}", nxt.split("\n")[1])
                else nxt + "\n" + "|" + "---|" * cols)
        known = _tbl_sig(base)
        body = [l for l in body if _norm(l) not in known]
        if body:
            paras[j + 1] = base + "\n" + "\n".join(body)
        gone.add(i)
    paras = [p for i, p in enumerate(paras) if i not in gone]
    # 子集去重：行集合被任一前行表块完全覆盖的无题注表块 = 重发残件——
    # bert-14 实案文末数据行组是题注表行的真子集，留着即堆叠
    keep: list[str] = []
    _sigs: list[frozenset] = []
    for p in paras:
        if _is_table_block(p):
            sig = _tbl_sig(p)
            if sig and any(sig <= s for s in _sigs):
                continue
            _sigs.append(sig)
        keep.append(p)
    return "\n\n".join(keep)


def _uncaptioned_table_starts(paras: list[str]) -> list[int]:
    """无题注表区起点下标序——表块前接的不是题注即无题注。
    连续表块段内嵌 |---| 分隔线处重开新区（vit-10 实案：表2 合法表后粘着
    另一张完整表体，分隔线是表与表之间的真正分界）。"""
    starts: list[int] = []
    for i, p in enumerate(paras):
        if not _is_table_block(p):
            continue
        prev = paras[i - 1].strip() if i > 0 else ""
        run_start = i == 0 or not _is_table_block(paras[i - 1])
        if not run_start and re.match(r"^\s*\|?\s*:?-{2,}", p.lstrip()):
            run_start = True  # 区内嵌分隔线——新表起首
        if run_start and not _TAB_CAPTION.match(prev):
            starts.append(i)
    return starts


def _pipe_frag_line(p: str) -> bool:
    """单行管道残段——按散文段落发出的表行：`a | b | c` 形（含 ≥2 个 | 但不以 | 起首）。
    剥数学记号防 |V| 幻影；已带首 | 的行是常规表行，归既有判据。"""
    lines = [l for l in p.split("\n") if l.strip()]
    if len(lines) != 1:
        return False
    l = _strip_math(lines[0]).strip()
    return not l.startswith("|") and l.count("|") >= 2 and not _TAB_CAPTION.match(l)


def _wrap_pipe_frag_tables(text: str) -> str:
    """连续 ≥2 个单行管道残段（列数一致）回包成 markdown 表并随「表N」引用归位——
    bert-12 实案模型把配置表按散文段落逐行发出（无首 |、无分隔线、无题注），
    裸 | 直印正文且题注整缺。确定性处置：包表 → 配裸题注（与 _caption_orphan_tables
    同款 `表N` 形式）→ 挪到首个含对应 表N 引用的段后；配不到悬空号的残段保留
    原样（不让表体因无题注遭游离剥离而丢数据）。"""
    paras = text.split("\n\n")
    if not _TAB_REF.search(text):
        return text
    kept: list[str] = []
    cands: list[tuple[int, list[str]]] = []  # (kept 内起始下标, 残段行)
    i = 0
    while i < len(paras):
        p = paras[i]
        if _pipe_frag_line(p):
            run = [p]
            j = i + 1
            while j < len(paras) and _pipe_frag_line(paras[j]):
                run.append(paras[j])
                j += 1
            i = j
            if len(run) >= 2 and len({_strip_math(l).count("|") for l in run}) == 1:
                cands.append((len(kept), run))
            kept += run
            continue
        kept.append(p)
        i += 1
    if not cands:
        return text
    # 两条归位锚：a) 题注在但表体缺（bert-12 实案同型）→ 表块直插题注段后；
    # b) 悬空引用（无题注 表N）→ 配裸题注随引用段归位。题注锚优先——题在体丢
    # 比引用悬空的判定更硬。
    caps_idx = {i: _TAB_CAPTION.match(p.strip()).group(1)
                for i, p in enumerate(kept) if _TAB_CAPTION.match(p.strip())}
    capless = [caps_idx[i] for i in sorted(caps_idx)
               if i + 1 >= len(kept) or not _is_table_block(kept[i + 1])]
    open_refs = [n for n in dict.fromkeys(
        m.group(1) for m in _TAB_REF.finditer("\n\n".join(kept)))
        if n not in caps_idx.values()]
    if not capless and not open_refs:
        return text
    pair_cap: dict[int, str] = {}   # 题注段下标 → 表块
    pair_ref: dict[str, str] = {}   # 表号 → 表块（随引用段归位）
    drop: set[int] = set()
    for start, run in cands:
        cells = _strip_math(run[0]).count("|") + 1
        rows = ["| " + l.strip() + " |" for l in run]
        tbl = "\n".join([rows[0], "| --- " * cells + "|"] + rows[1:])
        if capless:
            n = capless.pop(0)
            ci = next(i for i in sorted(caps_idx) if caps_idx[i] == n)
            pair_cap[ci] = tbl
            drop.update(range(start, start + len(run)))
        elif open_refs:
            n = open_refs.pop(0)
            pair_ref[n] = tbl
            drop.update(range(start, start + len(run)))
        else:
            break
    out: list[str] = []
    for idx, p in enumerate(kept):
        if idx in drop:
            continue
        out.append(p)
        if idx in pair_cap:
            out.append(pair_cap.pop(idx))
            continue
        for n in [m.group(1) for m in _TAB_REF.finditer(p)]:
            if n in pair_ref:
                out.append(f"表{n}")
                out.append(pair_ref.pop(n))
    for tbl in pair_cap.values():  # 题注段在 drop 区的边角——归尾不丢
        out.append(tbl)
    for n, tbl in pair_ref.items():
        out.append(f"表{n}")
        out.append(tbl)
    return "\n\n".join(out)


def _caption_orphan_tables(text: str, missing: list[str]) -> str:
    """补弹后仍缺题注的表号与无题注表区按序配对——缺号不止时超号段
    继续编新号；单行 | 残段一律剥除。"""
    paras = text.split("\n\n")
    starts = _uncaptioned_table_starts(paras)
    # 裸「表N」段且无表体随其后 → 编号残件（错插序号/模型占位行同型）
    bare = {i for i, p in enumerate(paras)
            if re.fullmatch(r"表\s*\d+", p.strip())
            and (i + 1 >= len(paras) or not _is_table_block(paras[i + 1]))}
    if not starts and not bare and not any(_single_pipe_frag(p) for p in paras):
        return text
    nums = list(missing)
    used = {m.group(1) for m in _TAB_REF.finditer(text)}
    nxt = max([int(x) for x in used if x.isdigit()] + [0]) + 1
    while len(nums) < len(starts):
        nums.append(str(nxt))
        nxt += 1
    cap_before = {i: nums.pop(0) for i in starts}
    out: list[str] = []
    for i, p in enumerate(paras):
        prev = paras[i - 1].strip() if i > 0 else ""
        if _single_pipe_frag(p) and not (
                _TAB_CAPTION.match(prev) or (i > 0 and _is_table_block(paras[i - 1]))):
            continue  # 孤头残段剥除
        if i in bare:
            continue
        if i in cap_before:
            out.append(f"表{cap_before[i]}")
        out.append(p)
    return "\n\n".join(out)


_FORMULA_LEAD = re.compile(r"(?:式\s*[（(]\s*\d+\s*[)）]|表示|即|为)\s*[：:]\s*$")


def _formulas_missing_body(text: str) -> list[tuple[int, str]]:
    """段末「式(N)：/表示为：/即：」宣告公式而次段无 $$ 公式块 = 声明了式却没有式。
    返回 [(段序号, 段原文)]。"""
    paras = text.split("\n\n")
    out = []
    for i, p in enumerate(paras):
        if not _FORMULA_LEAD.search(p.rstrip()):
            continue
        nxt = paras[i + 1].strip() if i + 1 < len(paras) else ""
        if not nxt.startswith("$"):
            out.append((i, p.strip()))
    return out


def _dedupe_captions(text: str) -> str:
    """附图说明内同一图号只留一条题注：按行扫描「图N为/是/系」，
    同 N 保留措辞最长的一条原位不动、其余剔除（prompt 约束不住时的确定性兜底）。"""
    lines = text.split("\n")
    best: dict[str, int] = {}
    for i, l in enumerate(lines):
        m = _CAPTION_LINE.match(l)
        if m:
            n = m.group(1)
            if n not in best or len(l) > len(lines[best[n]]):
                best[n] = i
    return "\n".join(l for i, l in enumerate(lines)
                    if not _CAPTION_LINE.match(l)
                    or i == best[_CAPTION_LINE.match(l).group(1)])


def _explode_caption_paras(paras: list) -> list:
    """一段内多条「图N为…」题注逐行拆段——模型常把整组题注写进同一段（单换行），
    不拆则整段按首行图号只替换一个旧题注块，其余旧题注残留成双题注。
    题注行各自成段，段首非题注行并入紧随的题注段。"""
    out: list = []
    for para in paras:
        seg: list = []
        for line in para.split("\n"):
            if _CAPTION_LINE.match(line) and seg:
                out.append("\n".join(seg))
                seg = []
            seg.append(line)
        if seg:
            out.append("\n".join(seg))
    return out

__all__ = [
    "_BARE_LATEX",
    "_CAPTION_LINE",
    "_EQ_DECL",
    "_EQ_REF",
    "_EQ_TAG",
    "_EQ_TAG_RE",
    "_FORMULA_LEAD",
    "_MATH_SPAN",
    "_TAB_CAPTION",
    "_TAB_EVAL_WORDS",
    "_TAB_REF",
    "_TAB_STRUCT_WORDS",
    "_TEXT_EQ",
    "_TEXT_EQ_LEAD",
    "_TEXT_EQ_LEAD_DISP",
    "_TEXT_EQ_MATHY",
    "_TEXT_EQ_OP",
    "_caption_orphan_tables",
    "_dedupe_captions",
    "_eq_decls",
    "_eq_decls_ordered",
    "_eq_renumber",
    "_explode_caption_paras",
    "_fix_semantic_tab_refs",
    "_formulas_missing_body",
    "_is_table_block",
    "_pipe_cols",
    "_pipe_frag_line",
    "_rejoin_split_tables",
    "_retable",
    "_single_pipe_frag",
    "_strip_detached_tables",
    "_strip_math",
    "_table_refs_missing",
    "_table_zone_end",
    "_tables_missing_body",
    "_tbl_sig",
    "_text_eq_to_latex",
    "_uncaptioned_table_starts",
    "_wrap_bare_latex",
    "_wrap_pipe_frag_tables",
    "_wrap_text_formulas",
    "_zone_member",
]
