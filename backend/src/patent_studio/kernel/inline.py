# -*- coding: utf-8 -*-
"""行内格式 tokenizer（docs/plan/22-w9-word-editing-design.md 决策 2；单元 W9 prep-kernel）。

内核 Markdown 的行内记号（前后端逐字一致；语料 examples/ 无这些记号 ⇒ 零漂移不变）：

    **粗体**        b     DOCX run.bold        / XML <b>   / 版面 <strong> / PM mark strong
    *斜体*          i     run.italic           / <i>       / <em>          / em
    <u>下划线</u>   u     run.underline        / <u>       / <u>           / underline
    _x _{…} _[…]    sub   run.subscript        / <sub>     / <sub>         / subscript（既有 builder._SUB_RE）
    ^x ^{…} ^[…]    sup   run.superscript      / <sup>     / <sup>         / superscript（与下标同形）

规则：
  - `**` 优先于 `*`；`*` 两侧（记号内侧）不得是空白；标记不跨行（正则不匹配 \\n）。
  - 可嵌套（`**a_{2}**`、`<u>**x**</u>`）；sub / sup 的内容按原文输出，不再嵌套解析（与 builder 既有行为一致）。
  - sub_except：字面标识符白名单（builder.DEFAULT_SUB_EXCEPT / studio.json.sub_except），其内的 `_` 不作下标。
  - CriticMarkup `{++…++}` 由调用方先 critic.accept/reject（或 tracked.RunHook.split）再送入本 tokenizer。
  - 不进 `$$` 公式行、表格分隔行、`###` 前缀：这些由 content.parse_md / builder 在块级别处理，不会调到这里。

    inline_tokens(text, sub_except=()) -> [(frozenset(marks), text)]   marks ⊆ MARKS；不合并相邻同标志片段
    inline_strip(text, sub_except=())  -> str                          去记号的纯文本（lint / 术语 / 字数）
    inline_spans(text, sub_except=())  -> [{"text", "marks": [...]}]   AST `inline[]` 形状（marks 按 MARKS 顺序）
"""

import re

MARKS = ("b", "i", "u", "sub", "sup")

# builder.py 原 _SUB_RE 的捕获体（保持逐字相同：中文四词是语料里既有的下标写法）
# 裸下标/上标字符域：ASCII 字母数字 + 希腊字母（ε_θ / μ_θ / Σ_θ 数学记号惯例）
_GREEK = "\u0370-\u03ff"
_SUB_BODY = (
    r"\{[^}]+\}|\[[^\]]+\]|检索|基线|锚|修|"
    rf"[A-Za-z0-9{_GREEK}]+(?:,[A-Za-z0-9{_GREEK}]+)*"
)
_SUP_BODY = r"\{[^}]+\}|\[[^\]]+\]|" rf"[A-Za-z0-9{_GREEK}]+(?:,[A-Za-z0-9{_GREEK}]+)*"

SUB_RE = re.compile(r"_(%s)" % _SUB_BODY)
SUP_RE = re.compile(r"\^(%s)" % _SUP_BODY)

_TOKEN_RE = re.compile(
    r"\*\*\*(?P<bi>(?=[^\s*]).+?(?<=[^\s*]))\*\*\*"
    r"|\*\*(?P<b>(?=\S).+?(?<=\S))\*\*"
    r"|\*(?P<i>(?=[^\s*]).+?(?<=[^\s*]))\*"
    r"|<u>(?P<u>.+?)</u>"
    r"|_(?P<sub>%s)"
    r"|\^(?P<sup>%s)" % (_SUB_BODY, _SUP_BODY)
)


def _protect(text, sub_except):
    """白名单标识符替换为哨兵（与 builder._emit_math_text 同一做法），返回 (text, {哨兵: 原文})。"""
    sent = {}
    for i, ex in enumerate(sub_except):
        key = "\x00%d\x00" % i
        if ex and ex in text:
            text = text.replace(ex, key)
            sent[key] = ex
    return text, sent


def _restore(seg, sent):
    for k, v in sent.items():
        seg = seg.replace(k, v)
    return seg


def _script_body(tok):
    """`_{x}` → x；`_[k]` 保留方括号（builder / cnipa_xml 既有行为）。"""
    if tok.startswith("{") and tok.endswith("}"):
        return tok[1:-1]
    return tok


def _walk(text, marks, out):
    pos = 0
    for m in _TOKEN_RE.finditer(text):
        if m.start() > pos:
            out.append((marks, text[pos : m.start()]))
        kind = m.lastgroup
        if kind in ("sub", "sup"):
            out.append((marks | {kind}, _script_body(m.group(kind))))
        elif kind == "bi":  # ***x*** = 粗斜体（docx_import 反向序列化 b+i 的写法）
            _walk(m.group(kind), marks | {"b", "i"}, out)
        else:
            _walk(m.group(kind), marks | {kind}, out)
        pos = m.end()
    if pos < len(text):
        out.append((marks, text[pos:]))


def inline_tokens(text, sub_except=()):
    """一行文本 → [(frozenset(marks), 片段)]；空文本 → []；片段非空。
    相邻两个下标（`x_t,z_t`）保持为两个片段，不合并：builder 逐片段生成 run，合并会改变 document.xml（零漂移）。"""
    if not text:
        return []
    text, sent = _protect(text, tuple(sub_except))
    raw = []
    _walk(text, frozenset(), raw)
    out = []
    for marks, seg in raw:
        seg = _restore(seg, sent)
        if seg:
            out.append((marks, seg))
    return out


def inline_strip(text, sub_except=()):
    """去掉全部行内记号后的纯文本（`_{2}` → 2，`**x**` → x）。无记号时恒等。"""
    return "".join(seg for _, seg in inline_tokens(text, sub_except))


def inline_spans(text, sub_except=()):
    """AST `inline[]`：[{"text": 片段, "marks": [按 MARKS 顺序]}]。"""
    return [{"text": seg, "marks": [m for m in MARKS if m in marks]} for marks, seg in inline_tokens(text, sub_except)]
