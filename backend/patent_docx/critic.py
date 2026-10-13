# -*- coding: utf-8 -*-
"""CriticMarkup 子集：源码内修订标记（docs/plan/07 §6）。

    {++插入++}  {--删除--}  {~~原文~>新文~~}  {>>批注<<}  {==高亮==}

单条非贪婪正则，`.` 不匹配换行 ⇒ 标记天然不跨行；非嵌套。
法则（tests/test_critic.py 锁定）：无标记时 accept/reject 恒等（零漂移）；不改变行数；幂等。
"""
import re

MODES = ("final", "original", "markup")

TOKEN = re.compile(
    r"\{\+\+(?P<ins>.*?)\+\+\}"
    r"|\{--(?P<dele>.*?)--\}"
    r"|\{~~(?P<sub_a>.*?)~>(?P<sub_b>.*?)~~\}"
    r"|\{>>(?P<comment>.*?)<<\}"
    r"|\{==(?P<mark>.*?)==\}"
)


def _final(m: re.Match) -> str:
    if m.group("ins") is not None:
        return m.group("ins")
    if m.group("dele") is not None:
        return ""
    if m.group("sub_a") is not None:
        return m.group("sub_b")
    if m.group("comment") is not None:
        return ""
    return m.group("mark")


def _original(m: re.Match) -> str:
    if m.group("ins") is not None:
        return ""
    if m.group("dele") is not None:
        return m.group("dele")
    if m.group("sub_a") is not None:
        return m.group("sub_a")
    if m.group("comment") is not None:
        return ""
    return m.group("mark")


def has_markup(text: str) -> bool:
    return TOKEN.search(text) is not None


def accept(text: str) -> str:
    """final：接受全部修订、删掉批注、保留高亮内文。无标记时返回原串（逐字节恒等）。"""
    return TOKEN.sub(_final, text)


def reject(text: str) -> str:
    """original：拒绝全部修订、删掉批注、保留高亮内文。"""
    return TOKEN.sub(_original, text)


strip = accept


def resolve(text: str, mode: str) -> str:
    """按模式渲染源码；markup 原样返回（内核把标记当普通文本排版）。"""
    if mode == "final":
        return accept(text)
    if mode == "original":
        return reject(text)
    if mode == "markup":
        return text
    raise ValueError(f"unknown critic mode: {mode!r}")


def _kind(m: re.Match) -> str:
    if m.group("ins") is not None:
        return "ins"
    if m.group("dele") is not None:
        return "del"
    if m.group("sub_a") is not None:
        return "sub"
    if m.group("comment") is not None:
        return "comment"
    return "mark"


def _u16(s: str, i: int) -> int:
    """码点下标 → UTF-16 单元下标（JS string / CodeMirror 的坐标）。BMP 文本二者相同。"""
    return len(s[:i].encode("utf-16-le")) // 2


def parse(text: str) -> list[dict]:
    """全文 → marks（07 §4.2），按行、按列升序。

    每条 {id, kind, line, from, to, a, b, final, original}：line 全文 1-based（只以 \\n 分行，与内核一致）；
    from/to 为该行内 [含标记符] 的 0-based UTF-16 偏移，前端用 [from,to)→final|original 做纯文本替换，
    结果与 accept/reject 逐字节一致；a = 原文侧内容、b = 新文侧内容（ins a=""；del b=""；comment a=批注文 b=""；
    mark a=b=内文）；id = "line:from"。
    """
    marks: list[dict] = []
    for no, line in enumerate(text.split("\n"), 1):
        if "{" not in line:
            continue
        for m in TOKEN.finditer(line):
            kind = _kind(m)
            final, original = _final(m), _original(m)
            if kind == "ins":
                a, b = "", final
            elif kind == "del":
                a, b = original, ""
            elif kind == "sub":
                a, b = original, final
            elif kind == "comment":
                a, b = m.group("comment"), ""
            else:
                a, b = final, final
            start, end = _u16(line, m.start()), _u16(line, m.end())
            marks.append({"id": f"{no}:{start}", "kind": kind, "line": no, "from": start, "to": end,
                          "a": a, "b": b, "final": final, "original": original})
    return marks


OPENER = re.compile(r"\{(\+\+|--|~~|>>|==)")


def lint_marks(text: str) -> list[dict]:
    """标记 lint（07 §6.2），均为 warning：
    - nested：某条合法标记的内文里又出现开口符（accept/reject 后内层标记会以字面残留）；
    - unclosed：去掉一行内所有合法标记后仍剩开口符（本行未闭合或跨行）。"""
    out: list[dict] = []
    for no, line in enumerate(text.split("\n"), 1):
        if "{" not in line:
            continue
        for m in TOKEN.finditer(line):
            inner = m.group(0)[3:-3]
            if OPENER.search(inner):
                out.append({"id": f"critic.nested#L{no}", "severity": "warning", "source": "lint",
                            "message": f"修订标记嵌套：「{m.group(0)[:3]}」内含另一条标记，语义未定义", "line": no,
                            "fix": "拆成并列的多条标记，标记之间不要互相包含"})
                break
        rest = TOKEN.sub("", line)
        m2 = OPENER.search(rest)
        if m2 is not None:
            out.append({"id": f"critic.unclosed#L{no}", "severity": "warning", "source": "lint",
                        "message": f"修订标记「{m2.group(0)}」未在本行闭合，按普通文本排版", "line": no,
                        "fix": "在同一行补上闭合符（++} --} ~~} <<} ==}）；标记不能跨行"})
    return out
