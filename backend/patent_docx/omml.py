# -*- coding: utf-8 -*-
"""独立成行公式的 OMML（Office Math Markup Language）渲染。

将线性公式文本解析为真二维 Word 公式结构：
- a/b            → m:f 分数（横线分式）
- Σ_{条件}       → m:nary 求和（下限叠排于 Σ 下方）
- √x             → m:rad 根式
- ( ) [ ] { }    → m:d 定界符（随内容高度自动伸缩）
- 下标记号 _x / _{...} / _[...] / _检索 等 → m:sSub 真下标
其余部分作为公式内普通符号串保留。生成 Word 原生公式对象（可双击编辑）。
"""
import re

from lxml import etree

M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _el(parent, tag, ns=M_NS):
    return etree.SubElement(parent, "{%s}%s" % (ns, tag))


_SUB_RE = re.compile(
    r'_(\{[^}]+\}|\[[^\]]+\]|检索|基线|锚|修|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*|\S)')
_BASE_RE = re.compile(r'([A-Za-z0-9]+|\S)$')
_CJK_RE = re.compile(r'[\u4e00-\u9fff]')

# 分式分子/分母、求和体的边界运算符（·、⊙ 等紧结合运算不在此列）
_STRONG = set('+\u2212=\u2264\u2190\u2208\uff0c,')
_OPEN = {'(': ')', '[': ']', '{': '}',
         '∣': '∣', '‖': '‖', '⟨': '⟩', '⌊': '⌋', '⌈': '⌉'}
_SUP_RE = re.compile(r'\^(\{[^}]*\}|\S)')


def _run(parent, text, size, normal=False):
    r = _el(parent, "r")
    rpr = _el(r, "rPr")
    if normal or _CJK_RE.search(text):
        _el(rpr, "nor")
    wrpr = _el(r, "rPr", W_NS)
    for tag, val in (("rFonts", None), ("sz", str(int(size * 2))),
                     ("szCs", str(int(size * 2)))):
        e = _el(wrpr, tag, W_NS)
        if tag == "rFonts":
            e.set("{%s}ascii" % W_NS, "Cambria Math")
            e.set("{%s}hAnsi" % W_NS, "Cambria Math")
            e.set("{%s}eastAsia" % W_NS, "宋体")
        else:
            e.set("{%s}val" % W_NS, val)
    t = _el(r, "t")
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    # ASCII 竖线在 LibreOffice 的 OMML 导入中会破坏整条公式，
    # 数学场景统一使用 U+2223 DIVIDES（∣），字形一致
    t.text = text.replace("|", "\u2223")
    return r


# ---------------- 词法分析 ----------------
# 记号：('txt', s) ('op', ch) ('slash',) ('sub', base, sub)
#       ('group', open, [children]) ('nary', chr, sub_text) ('sqrt',)

def _tokenize(text):
    root = []
    stack = [(None, root)]
    i, buf = 0, ""

    def flush():
        nonlocal buf
        if buf:
            stack[-1][1].append(('txt', buf))
            buf = ""

    while i < len(text):
        ch = text[i]
        m = re.match(r'[ΣΠ∑∏]_(\{[^}]+\}|\[[^\]]+\])', text[i:])
        if m and m.group(0)[0] in 'Σ∑':
            flush()
            stack[-1][1].append(('nary', '∑', m.group(1)[1:-1]))
            i += m.end()
            continue
        m = _SUB_RE.match(text, i)
        if m and (buf and _BASE_RE.search(buf) or
                  (stack[-1][1] and stack[-1][1][-1][0] in
                   ('group', 'sub', 'sup', 'subsup'))):
            tok = m.group(1)
            if tok[0] in '{[' and text[i + 1] == '{':
                tok = tok[1:-1]
            elif tok[0] == '{':
                tok = tok[1:-1]
            bm = _BASE_RE.search(buf)
            if bm:
                base = bm.group(1)
                buf = buf[:bm.start()]
                flush()
            elif stack[-1][1][-1][0] == 'group':
                g = stack[-1][1].pop()
                base = [('group', g[1], _transform(g[2]))]
            else:
                base = stack[-1][1][-1][1]  # 紧邻同基记号（x^2_i → 并轨 subsup）
            stack[-1][1].append(('sub', base, tok))
            i = m.end()
            continue
        m = _SUP_RE.match(text, i)
        if m and (buf and _BASE_RE.search(buf) or
                  (stack[-1][1] and stack[-1][1][-1][0] in
                   ('group', 'sub', 'sup', 'subsup'))):
            tok = m.group(1)
            if tok[0] == '{':
                tok = tok[1:-1]
            bm = _BASE_RE.search(buf)
            if bm:
                base = bm.group(1)
                buf = buf[:bm.start()]
                flush()
            elif stack[-1][1][-1][0] == 'group':
                g = stack[-1][1].pop()
                base = [('group', g[1], _transform(g[2]))]
            else:
                base = stack[-1][1][-1][1]  # 紧邻同基记号（x_i^2 → 并轨 subsup）
            stack[-1][1].append(('sup', base, tok))
            i = m.end()
            continue
        if ch == '√':
            flush()
            stack[-1][1].append(('sqrt',))
            i += 1
            continue
        if ch == '/':
            flush()
            stack[-1][1].append(('slash',))
            i += 1
            continue
        if ch in _OPEN:
            flush()
            children = []
            stack[-1][1].append(('group', ch, children))
            stack.append((ch, children))
            i += 1
            continue
        if stack[-1][0] and ch == _OPEN[stack[-1][0]]:
            flush()
            stack.pop()
            i += 1
            continue
        if ch in _STRONG:
            flush()
            stack[-1][1].append(('op', ch))
            i += 1
            continue
        buf += ch
        i += 1
    flush()
    return root


def _is_space(tok):
    return tok[0] == 'txt' and not tok[1].strip()


def _strip_edges(toks):
    out = list(toks)
    while out and _is_space(out[0]):
        out.pop(0)
    while out and _is_space(out[-1]):
        out.pop()
    if out:
        if out[0][0] == 'txt':
            out[0] = ('txt', out[0][1].lstrip())
        if out[-1][0] == 'txt':
            out[-1] = ('txt', out[-1][1].rstrip())
    return out


def _unwrap(toks):
    """单个圆括号组（或组内容仅为一个分式）时去掉冗余括号。"""
    toks = _strip_edges(toks)
    if len(toks) == 1 and toks[0][0] == 'group' and toks[0][1] == '(':
        return _strip_edges(toks[0][2])
    return toks


# ---------------- 语法变换 ----------------
# 输出节点：txt/op/sub/sqrt2(arg)/frac(num,den)/nary2(chr,sub,body)/group

def _transform(toks):
    toks = [('group', t[1], _transform(t[2])) if t[0] == 'group' else t
            for t in toks]
    # 根式：√ 吸收后一记号（先于分式，使 √n 可整体作分母）
    out = []
    k = 0
    while k < len(toks):
        t = toks[k]
        if t[0] == 'sqrt' and k + 1 < len(toks):
            out.append(('sqrt2', _unwrap([toks[k + 1]])))
            k += 2
            continue
        out.append(t)
        k += 1
    toks = out
    # 分式：向左右收集至边界运算符
    while True:
        idx = next((k for k, t in enumerate(toks) if t[0] == 'slash'), None)
        if idx is None:
            break
        lo = idx
        while lo > 0 and toks[lo - 1][0] not in ('op', 'slash', 'nary'):
            lo -= 1
        hi = idx + 1
        while hi < len(toks) and toks[hi][0] not in ('op', 'slash'):
            hi += 1
        num = _unwrap(toks[lo:idx])
        den = _unwrap(toks[idx + 1:hi])
        toks = toks[:lo] + [('frac', num, den)] + toks[hi:]
    # 求和：吸收随后的一个乘性项作为求和体
    out = []
    k = 0
    while k < len(toks):
        t = toks[k]
        if t[0] == 'nary':
            hi = k + 1
            while hi < len(toks) and toks[hi][0] not in ('op',):
                hi += 1
            body = _strip_edges(toks[k + 1:hi])
            out.append(('nary2', t[1], t[2], (t[3] if len(t) > 3 else ''), body))
            k = hi
            continue
        out.append(t)
        k += 1
    toks = out
    # 同基上下标并轨：X_i^l → subsup（两个方向都收）
    out = []
    k = 0
    while k < len(toks):
        t = toks[k]
        nxt = toks[k + 1] if k + 1 < len(toks) else None
        if t[0] == 'sub' and nxt and nxt[0] == 'sup' and nxt[1] == t[1]:
            out.append(('subsup', t[1], t[2], nxt[2]))
            k += 2
            continue
        if t[0] == 'sup' and nxt and nxt[0] == 'sub' and nxt[1] == t[1]:
            out.append(('subsup', t[1], nxt[2], t[2]))
            k += 2
            continue
        out.append(t)
        k += 1
    return out


# ---------------- OMML 生成 ----------------

def _emit(parent, toks, size):
    for t in toks:
        kind = t[0]
        if kind == 'txt':
            if t[1]:
                _run(parent, t[1], size)
        elif kind == 'op':
            _run(parent, t[1], size)
        elif kind == 'sub':
            s = _el(parent, "sSub")
            _el(s, "sSubPr")
            _emit_box(_el(s, "e"), t[1] if isinstance(t[1], list) else [('txt', t[1])], size)
            _emit_box(_el(s, "sub"), _toks(t[2]), size)
        elif kind == 'sup':
            s = _el(parent, "sSup")
            _el(s, "sSupPr")
            _emit_box(_el(s, "e"), t[1] if isinstance(t[1], list) else [('txt', t[1])], size)
            _emit_box(_el(s, "sup"), _toks(t[2]), size)
        elif kind == 'subsup':
            s = _el(parent, "sSubSup")
            _el(s, "sSubSupPr")
            _emit_box(_el(s, "e"), t[1] if isinstance(t[1], list) else [('txt', t[1])], size)
            _emit_box(_el(s, "sub"), _toks(t[2]), size)
            _emit_box(_el(s, "sup"), _toks(t[3]), size)
        elif kind == 'frac':
            f = _el(parent, "f")
            _el(f, "fPr")
            _emit_box(_el(f, "num"), t[1], size)
            _emit_box(_el(f, "den"), t[2], size)
        elif kind == 'sqrt2':
            rad = _el(parent, "rad")
            rp = _el(rad, "radPr")
            _el(rp, "degHide").set("{%s}val" % M_NS, "1")
            _el(rad, "deg")
            _emit_box(_el(rad, "e"), t[1], size)
        elif kind == 'nary2':
            n = _el(parent, "nary")
            np = _el(n, "naryPr")
            _el(np, "chr").set("{%s}val" % M_NS, t[1])
            _el(np, "limLoc").set("{%s}val" % M_NS, "undOvr")
            if len(t) > 4 and t[3]:
                _emit(_el(n, "sub"), _toks(t[2]), size)
                _emit(_el(n, "sup"), _toks(t[3]), size)
            else:
                _el(np, "supHide").set("{%s}val" % M_NS, "1")
                _emit(_el(n, "sub"), _toks(t[2]), size)
                _el(n, "sup")
            _emit_box(_el(n, "e"), t[4], size)
        elif kind == 'acc':
            a = _el(parent, "acc")
            ap = _el(a, "accPr")
            _el(ap, "chr").set("{%s}val" % M_NS, t[1])
            _emit_box(_el(a, "e"), t[2], size)
        elif kind == 'group':
            d = _el(parent, "d")
            dp = _el(d, "dPr")
            _el(dp, "begChr").set("{%s}val" % M_NS, t[1])
            _el(dp, "endChr").set("{%s}val" % M_NS, _OPEN[t[1]])
            _emit_box(_el(d, "e"), t[2], size)


def _emit_box(parent, toks, size):
    toks = _strip_edges(toks)
    if not toks:
        _run(parent, "", size)
    else:
        _emit(parent, toks, size)


def _toks(text):
    """公式文本 → 变换后记号序列：含 \\ 按 LaTeX 词法，否则按线性记号。"""
    if '\\' in text:
        return _transform(_latex_tokenize(text))
    return _transform(_tokenize(text))


_XSL = None


def _mml2omml():
    """latex2mathml → 微软 MML2OMML.XSL → OMML 主转换链（懒加载缓存 XSLT）。
    覆盖全结构：矩阵/分支式/nary/定界符不再塌行（手写映射 bmatrix/cases 实案塌陷）。"""
    global _XSL
    if _XSL is None:
        from pathlib import Path
        _XSL = etree.XSLT(etree.parse(str(Path(__file__).with_name("MML2OMML.XSL"))))
    return _XSL


def _fix_nary_e(omath):
    """XSL 产 m:nary 的 m:e（主对象槽）恒空——LibreOffice 渲成 □ 占位框；
    把紧随其后的主对象兄弟节点回填进 m:e。"""
    for nary in omath.iter("{%s}nary" % M_NS):
        e = nary.find("{%s}e" % M_NS)
        if e is None or len(e) or (e.text or "").strip():
            continue
        nxt = nary.getnext()
        if nxt is not None:
            e.append(nxt)


def _inline_nogrow(omath):
    """行内公式 m:d 打 m:grow=0：XSL 把 () 产成可伸缩定界符（默认 grow=on），随上下标
    撑高行内 math zone → auto 行距被顶开。行间公式不打（分式/大括号需要伸缩）。"""
    for d in omath.iter("{%s}d" % M_NS):
        dpr = d.find("{%s}dPr" % M_NS)
        if dpr is None:
            dpr = etree.Element("{%s}dPr" % M_NS)
            d.insert(0, dpr)
        grow = dpr.find("{%s}grow" % M_NS)
        if grow is None:
            grow = etree.Element("{%s}grow" % M_NS)
            ctrl = dpr.find("{%s}ctrlPr" % M_NS)
            if ctrl is not None:
                ctrl.addprevious(grow)
            else:
                dpr.append(grow)
        grow.set("{%s}val" % M_NS, "0")


def _omml_style(omath, size):
    """给 XSL 产 m:r 注入字体与字号（与手写 _run 口径一致：Cambria Math + 宋体 eastAsia、
    sz/szCs=磅值×2）。缺 rFonts 时渲染器回退到更高的数学字体，行内公式把行距撑开。"""
    for r in omath.iter("{%s}r" % M_NS):
        wrpr = r.find("{%s}rPr" % W_NS)
        if wrpr is None:
            wrpr = etree.Element("{%s}rPr" % W_NS)
            r.insert(0, wrpr)
        rf = wrpr.find("{%s}rFonts" % W_NS)
        if rf is None:
            rf = etree.Element("{%s}rFonts" % W_NS)
            wrpr.insert(0, rf)
        rf.set("{%s}ascii" % W_NS, "Cambria Math")
        rf.set("{%s}hAnsi" % W_NS, "Cambria Math")
        rf.set("{%s}eastAsia" % W_NS, "宋体")
        for tag, val in (("sz", size * 2), ("szCs", size * 2)):
            e = wrpr.find("{%s}%s" % (W_NS, tag))
            if e is None:
                e = etree.SubElement(wrpr, "{%s}%s" % (W_NS, tag))
            e.set("{%s}val" % W_NS, str(int(val)))


def append_omml(p, text, size=12, inline=False):
    """把线性公式文本作为真二维 OMML 公式追加到段落 p。
    主链 latex2mathml+XSL；解析或转换失败退回手写词法映射——宁可塌行不丢式。
    inline=True 时给 m:d 打 growHide，定界符不随内容撑高行距。"""
    omath = None
    try:
        import latex2mathml.converter
        mml = latex2mathml.converter.convert(text)
        res = _mml2omml()(etree.fromstring(mml.encode("utf-8")))
        omath = etree.fromstring(str(res).encode("utf-8"))
    except Exception:
        omath = None
    if omath is not None:
        _fix_nary_e(omath)
        if inline:
            _inline_nogrow(omath)
        _omml_style(omath, size)
        p._p.append(omath)
        return omath
    omath = etree.SubElement(p._p, "{%s}oMath" % M_NS)
    _emit(omath, _toks(text), size)
    return omath


# ---------------- MathML 生成（同一词法/变换树，供 AST 结构预览原生渲染） ----------------

MML_NS = "http://www.w3.org/1998/Math/MathML"
_MML_TOKEN_RE = re.compile(r'\d+(?:\.\d+)?|[A-Za-z]+|[\u4e00-\u9fff]+|\s+|.', re.S)


def _mml(parent, tag, text=None):
    e = etree.SubElement(parent, "{%s}%s" % (MML_NS, tag))
    if text is not None:
        e.text = text
    return e


def _mml_text(parent, text):
    """普通符号串 → mn/mi/mtext/mo 序列（空白丢弃，由渲染器按 mo 语义留空）。"""
    for m in _MML_TOKEN_RE.finditer(text):
        s = m.group(0)
        if s.isspace():
            continue
        if s[0].isdigit():
            _mml(parent, "mn", s)
        elif _CJK_RE.match(s):
            _mml(parent, "mtext", s)
        elif s.isalpha():
            _mml(parent, "mi", s)
        else:
            _mml(parent, "mo", s)


def _mml_emit(parent, toks):
    for t in toks:
        kind = t[0]
        if kind == 'txt':
            _mml_text(parent, t[1])
        elif kind == 'op':
            _mml(parent, "mo", t[1])
        elif kind == 'sub':
            s = _mml(parent, "msub")
            _mml_box(s, t[1] if isinstance(t[1], list) else [('txt', t[1])])
            _mml_box(s, _toks(t[2]))
        elif kind == 'sup':
            s = _mml(parent, "msup")
            _mml_box(s, t[1] if isinstance(t[1], list) else [('txt', t[1])])
            _mml_box(s, _toks(t[2]))
        elif kind == 'subsup':
            s = _mml(parent, "msubsup")
            _mml_box(s, t[1] if isinstance(t[1], list) else [('txt', t[1])])
            _mml_box(s, _toks(t[2]))
            _mml_box(s, _toks(t[3]))
        elif kind == 'frac':
            f = _mml(parent, "mfrac")
            _mml_box(f, t[1])
            _mml_box(f, t[2])
        elif kind == 'sqrt2':
            _mml_emit(_mml(parent, "msqrt"), t[1])
        elif kind == 'nary2':
            row = _mml(parent, "mrow")
            under = _mml(row, "munderover" if t[3] else "munder")
            _mml(under, "mo", t[1])
            _mml_box(under, _toks(t[2]))
            if t[3]:
                _mml_box(under, _toks(t[3]))
            _mml_box(row, t[4])
        elif kind == 'acc':
            over = _mml(parent, "mover")
            over.set("accent", "true")
            _mml_emit(_mml(over, "mrow"), t[2])
            _mml(over, "mo", t[1])
        elif kind == 'group':
            row = _mml(parent, "mrow")
            _mml(row, "mo", t[1])
            _mml_emit(row, t[2])
            _mml(row, "mo", _OPEN[t[1]])


def _mml_box(parent, toks):
    """单参数位（分子/分母/下标等）恒为一个 mrow，MathML 要求这些位置恰有一个子元素。"""
    row = _mml(parent, "mrow")
    _mml_emit(row, _strip_edges(toks))
    return row


def to_mathml(text):
    """线性公式文本 → MathML 字符串（<math display="block">），与 append_omml 共用词法与语法变换。"""
    math = etree.Element("{%s}math" % MML_NS, nsmap={None: MML_NS})
    math.set("display", "block")
    _mml_emit(math, _toks(text))
    return etree.tostring(math, encoding="unicode")


# ---------------- LaTeX 词法（$$…$$ / $…$ 内的 \frac、\sum、\mathbb 等 → 同一记号树） ----------------

_LATEX_CMD_RE = re.compile(r'\\([A-Za-z]+|[^\w])')
# 强运算/关系符：映射后产出 op 记号（与线性记号 _STRONG 同语义，作分式边界）
_LATEX_OPCHARS = set('+-−=≤≥<>∈←,;:，')
_LATEX_OPS = {
    'in': '∈', 'times': '×', 'cdot': '·', 'cdots': '⋯', 'ldots': '…', 'dots': '…',
    'circ': '∘', 'oplus': '⊕', 'otimes': '⊗', 'odot': '⊙', 'div': '÷',
    'leq': '≤', 'le': '≤', 'geq': '≥', 'ge': '≥', 'neq': '≠', 'ne': '≠',
    'approx': '≈', 'equiv': '≡', 'pm': '±', 'mp': '∓', 'propto': '∝', 'sim': '∼', 'simeq': '≃',
    'infty': '∞', 'partial': '∂', 'nabla': '∇', 'forall': '∀', 'exists': '∃',
    'rightarrow': '→', 'to': '→', 'leftarrow': '←', 'gets': '←',
    'Rightarrow': '⇒', 'Leftarrow': '⇐', 'leftrightarrow': '↔', 'mapsto': '↦',
    'mid': '∣', 'setminus': '∖', 'cup': '∪', 'cap': '∩',
    'subseteq': '⊆', 'subset': '⊂', 'supseteq': '⊇', 'supset': '⊃',
    'll': '≪', 'gg': '≫', 'perp': '⊥', 'parallel': '∥', 'prime': '′',
    'lfloor': '⌊', 'rfloor': '⌋', 'lceil': '⌈', 'rceil': '⌉',
    'langle': '⟨', 'rangle': '⟩', 'emptyset': '∅',
    'Vert': '‖', 'lVert': '‖', 'rVert': '‖', '|': '‖',
    'vert': '∣', 'lvert': '∣', 'rvert': '∣',
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε', 'varepsilon': 'ε',
    'zeta': 'ζ', 'eta': 'η', 'theta': 'θ', 'vartheta': 'ϑ', 'iota': 'ι', 'kappa': 'κ',
    'lambda': 'λ', 'mu': 'μ', 'nu': 'ν', 'xi': 'ξ', 'pi': 'π', 'rho': 'ρ', 'varrho': 'ϱ',
    'sigma': 'σ', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ', 'varphi': 'φ', 'chi': 'χ',
    'psi': 'ψ', 'omega': 'ω',
    'Gamma': 'Γ', 'Delta': 'Δ', 'Theta': 'Θ', 'Lambda': 'Λ', 'Xi': 'Ξ', 'Pi': 'Π',
    'Sigma': 'Σ', 'Phi': 'Φ', 'Psi': 'Ψ', 'Omega': 'Ω', 'Upsilon': 'Υ',
}
_LATEX_FUNCS = {
    'exp', 'log', 'ln', 'lg', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'max', 'min', 'arg',
    'det', 'dim', 'gcd', 'lim', 'inf', 'ker', 'deg', 'hom', 'Pr', 'sup', 'softmax', 'sigmoid', 'relu',
}
_LATEX_NARY = {'sum': '∑', 'prod': '∏', 'bigcup': '⋃', 'bigcap': '⋂', 'int': '∫',
               'oint': '∮', 'bigoplus': '⨁', 'bigotimes': '⨂'}
_LATEX_BB = {'R': 'ℝ', 'N': 'ℕ', 'Z': 'ℤ', 'Q': 'ℚ', 'C': 'ℂ', 'P': 'ℙ', 'H': 'ℍ',
             'D': '𝔻', 'B': '𝔹', 'S': '𝕊', 'T': '𝕋', 'I': '𝕀', 'E': '𝔼', 'A': '𝔸',
             'F': '𝔽', 'G': '𝔾', 'K': '𝕂', 'L': '𝕃', 'M': '𝕄', 'O': '𝕆', 'U': '𝕌',
             'V': '𝕍', 'W': '𝕎', 'X': '𝕏', 'Y': '𝕐'}
_LATEX_CAL = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                      '𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵'))
_LATEX_FRK = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                      '𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ'))
_LATEX_ACCENT = {'hat': '̂', 'bar': '̄', 'overline': '̅', 'vec': '⃗',
                 'dot': '̇', 'ddot': '̈', 'tilde': '̃'}
_LATEX_DELIM = {'langle': '⟨', 'rangle': '⟩', 'lfloor': '⌊', 'rfloor': '⌋',
                'lceil': '⌈', 'rceil': '⌉', 'lbrace': '{', 'rbrace': '}', '|': '∣'}
_LATEX_ENV_OPEN = {'pmatrix': '(', 'bmatrix': '[', 'Bmatrix': '{', 'cases': '{',
                   'vmatrix': '∣', 'Vmatrix': '‖'}


def _latex_arg(text, i):
    """读一个实参：{…}（允许嵌套与转义花括号）、\\命令或单字符；返回 (原内容, 下一位置)。"""
    n = len(text)
    while i < n and text[i] == ' ':
        i += 1
    if i >= n:
        return '', i
    if text[i] == '{':
        depth, j = 1, i + 1
        while j < n:
            c = text[j]
            if c == '\\':
                j += 2
                continue
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return text[i + 1:j], j + 1
            j += 1
        return text[i + 1:], n
    m = _LATEX_CMD_RE.match(text, i)
    if m:
        return text[i:m.end()], m.end()
    return text[i], i + 1


def _flat_arg(a):
    """脚本/限位参数文本（可能含嵌套 LaTeX）→ 纯文本。"""
    return ''.join(_flat(x) for x in _toks(a))


def _flat(t):
    kind = t[0]
    if kind in ('txt', 'op'):
        return t[1]
    if kind in ('sub', 'sup'):
        base = ''.join(_flat(x) for x in t[1]) if isinstance(t[1], list) else t[1]
        return base + _flat_arg(t[2])
    if kind == 'subsup':
        base = ''.join(_flat(x) for x in t[1]) if isinstance(t[1], list) else t[1]
        return base + _flat_arg(t[2]) + _flat_arg(t[3])
    if kind == 'frac':
        return ''.join(_flat(x) for x in t[1]) + '/' + ''.join(_flat(x) for x in t[2])
    if kind == 'sqrt2':
        return '√' + ''.join(_flat(x) for x in t[1])
    if kind == 'nary2':
        return t[1] + _flat_arg(t[2]) + _flat_arg(t[3]) + ''.join(_flat(x) for x in t[4])
    if kind == 'group':
        return t[1] + ''.join(_flat(x) for x in t[2]) + _OPEN[t[1]]
    if kind == 'acc':
        return ''.join(_flat(x) for x in t[2]) + t[1]
    return ''


def latex_to_text(s):
    """LaTeX 公式片段 → 纯文本（符号命令转字面字符），供 CNIPA XML 等无公式承载面使用。"""
    return ''.join(_flat(t) for t in _transform(_latex_tokenize(s)))


def _latex_tokenize(text):
    """LaTeX → 线性记号树同形记号流。透明分组 {…} 展开内联，结构命令直产对应记号。"""
    root = []
    stack = [(None, root)]
    i, n, buf = 0, len(text), ''

    def flush():
        nonlocal buf
        if buf:
            stack[-1][1].append(('txt', buf))
            buf = ''

    def emit(tok):
        stack[-1][1].append(tok)

    def attach_script(kind):
        """_ / ^：挂到 buf 末尾基元或紧邻定界符组上，内容为原文（发射端按 _toks 递归解析）。"""
        nonlocal i, buf
        arg, i = _latex_arg(text, i + 1)
        base = ''
        buf = buf.rstrip()
        if not buf and stack[-1][1] and stack[-1][1][-1][0] == 'txt':
            buf = stack[-1][1].pop()[1]  # 已落库文本基元（\mathrm{…} 展开）整体回 buf 再取基
        bm = _BASE_RE.search(buf)
        if bm:
            base = bm.group(1)
            buf = buf[:bm.start()]
            flush()
        elif stack[-1][1] and stack[-1][1][-1][0] == 'group':
            g = stack[-1][1].pop()
            base = [('group', g[1], _transform(g[2]))]
            flush()
        elif stack[-1][1] and stack[-1][1][-1][0] in ('frac', 'sqrt2', 'nary2', 'acc'):
            base = [stack[-1][1].pop()]
            flush()
        elif stack[-1][1] and stack[-1][1][-1][0] in ('sub', 'sup', 'subsup'):
            base = stack[-1][1][-1][1]
            flush()
        else:
            flush()
        emit((kind, base, arg))

    while i < n:
        ch = text[i]
        if ch == '\\':
            m = _LATEX_CMD_RE.match(text, i)
            if not m:
                i += 1
                continue
            name = m.group(1)
            i = m.end()
            if name in ('frac', 'dfrac', 'tfrac'):
                num, i = _latex_arg(text, i)
                den, i = _latex_arg(text, i)
                flush()
                emit(('frac', _transform(_latex_tokenize(num)),
                      _transform(_latex_tokenize(den))))
            elif name == 'sqrt':
                deg = ''
                if i < n and text[i] == '[':
                    j = text.find(']', i)
                    if j > 0:
                        deg, i = text[i + 1:j], j + 1
                arg, i = _latex_arg(text, i)
                flush()
                body = _latex_tokenize(arg)
                emit(('sqrt2', _transform(([('txt', deg)] if deg else []) + body)))
            elif name in _LATEX_NARY:
                flush()
                sub_t = sup_t = ''
                while True:
                    while i < n and text[i] == ' ':
                        i += 1
                    if i < n and text[i] == '_':
                        sub_t, i = _latex_arg(text, i + 1)
                    elif i < n and text[i] == '^':
                        sup_t, i = _latex_arg(text, i + 1)
                    else:
                        break
                emit(('nary', _LATEX_NARY[name], sub_t, sup_t))
            elif name in ('tag', 'label'):
                _, i = _latex_arg(text, i)
            elif name in ('displaystyle', 'limits', 'nolimits', 'quad', 'qquad',
                          'medskip', 'smallskip', 'hline', 'nonumber'):
                if name in ('quad', 'qquad'):
                    buf += ' '
            elif name in ('left', 'right', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr',
                          'biggl', 'biggr'):
                while i < n and text[i] == ' ':
                    i += 1
                dm = _LATEX_CMD_RE.match(text, i)
                if dm:
                    d = dm.group(1)
                    i = dm.end()
                    d = '‖' if d == '|' else _LATEX_DELIM.get(d, d)
                elif i < n:
                    d = text[i]
                    i += 1
                else:
                    d = '.'
                if d == '.':
                    pass
                elif stack[-1][0] is not None and _OPEN.get(stack[-1][0]) == d:
                    flush()
                    stack.pop()
                elif name in ('left', 'big', 'Big', 'bigl', 'Bigl', 'biggl'):
                    if d in _OPEN:
                        flush()
                        children = []
                        emit(('group', d, children))
                        stack.append((d, children))
                    else:
                        buf += d
                else:
                    buf += d
            elif name in ('mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathnormal',
                          'operatorname', 'text', 'textrm', 'textbf', 'textit', 'boldsymbol',
                          'bm', 'boldmath'):
                arg, i = _latex_arg(text, i)
                flush()
                stack[-1][1].extend(_latex_tokenize(arg))
            elif name in ('mathbb', 'mathcal', 'mathfrak', 'mathscr'):
                arg, i = _latex_arg(text, i)
                table = {'mathbb': _LATEX_BB, 'mathcal': _LATEX_CAL,
                         'mathfrak': _LATEX_FRK, 'mathscr': _LATEX_CAL}[name]
                buf += ''.join(table.get(c, c) for c in arg)
            elif name in _LATEX_ACCENT:
                arg, i = _latex_arg(text, i)
                flush()
                emit(('acc', _LATEX_ACCENT[name],
                      _transform(_latex_tokenize(arg))))
            elif name in ('begin', 'end'):
                arg, i = _latex_arg(text, i)
                if name == 'begin':
                    open_ch = _LATEX_ENV_OPEN.get(arg.strip(), '')
                    flush()
                    if open_ch:
                        children = []
                        emit(('group', open_ch, children))
                        stack.append((open_ch, children))
                else:
                    flush()
                    if stack[-1][0] is not None:
                        stack.pop()
            elif name in ('overbrace', 'underbrace', 'overset', 'underset',
                          'xrightarrow', 'xleftarrow', 'stackrel', 'ensuremath', 'mbox'):
                arg, i = _latex_arg(text, i)
                flush()
                stack[-1][1].extend(_latex_tokenize(arg))
            elif name in _LATEX_OPS:
                flush()
                c = _LATEX_OPS[name]
                emit(('op', c) if c in _LATEX_OPCHARS else ('txt', c))
            elif name == '{':
                flush()
                children = []
                emit(('group', '{', children))
                stack.append(('{', children))
            elif name == '}':
                flush()
                if stack[-1][0] == '{':
                    stack.pop()
                else:
                    buf += '}'
            elif name in ('%', '_', '&', '#', '$'):
                buf += {'%': '%', '_': '_', '&': '&', '#': '#', '$': '$'}[name]
            elif name in (',', ';', ':', ' '):
                buf += ' '
            elif name == '!' or name == '\\':
                if name == '\\':
                    buf += ' '
            elif name in _LATEX_FUNCS:
                buf += name + ' '
            else:
                buf += name  # 未知命令按字面保留，不丢内容
            continue
        if ch == '{':
            inner, i = _latex_arg(text, i)
            stack[-1][1].extend(_latex_tokenize(inner))
        elif ch in '([⟨⌊⌈∣‖':
            flush()
            children = []
            emit(('group', ch, children))
            stack.append((ch, children))
            i += 1
        elif stack[-1][0] is not None and _OPEN.get(stack[-1][0]) == ch:
            flush()
            stack.pop()
            i += 1
        elif ch == '_':
            attach_script('sub')
        elif ch == '^':
            attach_script('sup')
        elif ch == '/':
            flush()
            emit(('slash',))
            i += 1
        elif ch == '√':
            flush()
            emit(('sqrt',))
            i += 1
        elif ch in '+-−=≤≥<>∈←,;:，':
            flush()
            emit(('op', '−' if ch == '-' else ch))
            i += 1
        elif ch in '&~':
            buf += ' '
            i += 1
        else:
            buf += ch
            i += 1
    flush()
    return root


# ---------------- 行内简单式 → 上下标文本（不走 OMML，不撑行距） ----------------
#
# $x^{(i)}_{1:L}$ 这类只含字母/数字/上下标/符号命令的行内式，OMML math zone
# 的最小高度大于正文行高（auto 行距被顶开 25–35%）。真专利里这类记号按
# vertAlign 文本排版：行距与纯文本行一致。含 \frac/\sqrt/\sum/矩阵/重音等
# 高层结构的式子仍走 OMML（那些结构本来就需要额外行高）。

_INLINE_FUNC = re.compile(
    r"\\(?:mathrm|mathnormal|text|textrm|textup|operatorname|mbox)\s*\{([^{}]*)\}")
_INLINE_BB = re.compile(r"\\mathbb\s*(?:\{([A-Za-z])\}|([A-Za-z]))")
# 只放行 BMP 内双黑体（Times/Liberation 有字形）；𝔼/𝔻 等辅助平面字符在文本 run 里会变豆腐块 → OMML
_INLINE_BB_MAP = {k: _LATEX_BB[k] for k in "RNZQCPH"}
_INLINE_BIGD = re.compile(r"\\(?:left|right|big|Big|bigl|bigr|Bigl|Bigr|biggl|biggr|bigg)\s*")
_INLINE_CMD = re.compile(r"\\([A-Za-z]+|[^\w])")

_INLINE_FLAT = dict(_LATEX_OPS)
_INLINE_FLAT.update({
    "%": "%", "&": "&", "#": "#", "$": "$", "{": "{", "}": "}",
    "(": "(", ")": ")", "[": "[", "]": "]", "_": "_",
    ",": " ", ";": " ", ":": " ", " ": " ", "!": "", "\\": " ",
    "displaystyle": "", "limits": "", "nolimits": "", "quad": " ",
    "qquad": "  ", "medskip": " ", "smallskip": " ", "thinspace": " ",
    "hline": "", "nonumber": "", "tag": "", "label": "", "ensuremath": "",
})
for _f in _LATEX_FUNCS:
    _INLINE_FLAT[_f] = _f + " "


def latex_flat_inline(tex):
    """行内公式 → inline_tokens 记号文本（`_{}`/`^{}` 供 vertAlign 渲染）；判不动返回 None。

    判据：全部 \命令 均在扁平映射内（希腊字母/关系符/定界符/正体函数名/空白）；
    残余花括号只允许是 _{} ^{} _[] ^[] 脚本体。含分式/根式/nary/矩阵/重音/
    mathbf/mathcal 或未识别命令 → None，调用方走 OMML。
    """
    s = _INLINE_FUNC.sub(lambda m: m.group(1), tex)
    s = _INLINE_BB.sub(lambda m: _INLINE_BB_MAP.get(m.group(1) or m.group(2), "\x00"), s)
    s = _INLINE_BIGD.sub("", s)
    s = _INLINE_CMD.sub(lambda m: _INLINE_FLAT.get(m.group(1), "\x00"), s)
    if "\x00" in s or "\\" in s:
        return None
    rest = re.sub(r"[_^](?:\{[^{}]*\}|\[[^\]]*\])", "", s)
    if "{" in rest or "}" in rest:
        return None
    s = re.sub(r"\s+([_^])", r"\1", s)          # LaTeX 空白不占位：空格不阻断脚本附着
    s = re.sub(r"([‖⌊⌈⟨])\s+", r"\1", s)       # 开定界符后去空格
    s = re.sub(r"\s+([‖⌋⌉⟩])", r"\1", s)       # 闭定界符前去空格
    s = re.sub(r"\s{2,}", " ", s).strip()      # 花括号保留：_{}/^{} 由 inline_tokens 解析
    return s or None
