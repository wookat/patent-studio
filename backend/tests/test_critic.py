# -*- coding: utf-8 -*-
"""CriticMarkup 逐字节法则（docs/plan/07 §6.3）。prep 锁定恒等/行数/幂等；C2 追加 parse→marks 用例。"""

import os

import pytest

from patent_studio.kernel import critic

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CASES = {
    "A{++B++}C": ("ABC", "AC"),
    "A{--B--}C": ("AC", "ABC"),
    "A{~~B~>D~~}C": ("ADC", "ABC"),
    "A{>>note<<}C": ("AC", "AC"),
    "A{==B==}C": ("ABC", "ABC"),
    "| a | {~~1~>2~~} |": ("| a | 2 |", "| a | 1 |"),
    "$$x_{~~1~>2~~}$$": ("$$x_2$$", "$$x_1$$"),
    "1.一种{~~方法~>装置~~}，其特征在于{>>需商议<<}：": ("1.一种装置，其特征在于：", "1.一种方法，其特征在于："),
    # 跨行不是标记：原样保留
    "多行{++x\ny++}不跨行": ("多行{++x\ny++}不跨行", "多行{++x\ny++}不跨行"),
}


@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_without_markup_are_identity(pid):
    with open(os.path.join(ROOT, "examples", pid, "content.md"), encoding="utf-8") as f:
        md = f.read()
    assert not critic.has_markup(md)
    assert critic.accept(md) == md
    assert critic.reject(md) == md
    assert critic.resolve(md, "markup") is md


@pytest.mark.parametrize("src,expect", list(CASES.items()))
def test_accept_reject(src, expect):
    final, original = expect
    assert critic.accept(src) == final
    assert critic.reject(src) == original
    assert critic.resolve(src, "final") == final
    assert critic.resolve(src, "original") == original
    assert critic.resolve(src, "markup") == src


@pytest.mark.parametrize("src", list(CASES))
def test_line_count_and_idempotent(src):
    assert critic.accept(src).count("\n") == src.count("\n") == critic.reject(src).count("\n")
    assert critic.accept(critic.accept(src)) == critic.accept(src)
    assert critic.reject(critic.reject(src)) == critic.reject(src)


def test_unknown_mode():
    with pytest.raises(ValueError):
        critic.resolve("x", "draft")


# ---------------- C2：parse → marks（07 §4.2）----------------


def apply_marks(text: str, marks: list[dict], pick: str) -> str:
    """frontend/src/store/review.ts applyMarks 的逐字节等价实现（同行右→左替换 [from,to)），用于 A5 对照。"""
    lines = text.split("\n")
    by_line: dict[int, list[dict]] = {}
    for m in marks:
        by_line.setdefault(m["line"], []).append(m)
    for no, arr in by_line.items():
        s = lines[no - 1]
        for m in sorted(arr, key=lambda x: -x["from"]):
            s = s[: m["from"]] + m[pick] + s[m["to"] :]
        lines[no - 1] = s
    return "\n".join(lines)


SAMPLE = "\n".join(
    [
        "# 一种{~~方法~>装置~~}",
        "",
        "## 摘要",
        "",
        "本发明{++公开了++}一种装置{--和方法--}。{>>摘要要不要提方法？<<}",
        "",
        "## 权利要求书",
        "",
        "1.一种{==装置==}，其特征在于：",
        "| a | {~~1~>2~~} |",
        "$$x_{~~1~>2~~}$$",
    ]
)


def test_parse_fields_and_offsets():
    marks = critic.parse(SAMPLE)
    assert [m["kind"] for m in marks] == ["sub", "ins", "del", "comment", "mark", "sub", "sub"]
    assert [m["line"] for m in marks] == [1, 5, 5, 5, 9, 10, 11]
    assert all(m["id"] == f"{m['line']}:{m['from']}" for m in marks)
    sub = marks[0]
    assert (sub["from"], sub["to"]) == (4, 16) and SAMPLE.split("\n")[0][4:16] == "{~~方法~>装置~~}"
    assert (sub["a"], sub["b"], sub["final"], sub["original"]) == ("方法", "装置", "装置", "方法")
    ins, dele, com = marks[1:4]
    assert (ins["a"], ins["b"], ins["final"], ins["original"]) == ("", "公开了", "公开了", "")
    assert (dele["a"], dele["b"], dele["final"], dele["original"]) == ("和方法", "", "", "和方法")
    assert (com["a"], com["b"], com["final"], com["original"]) == ("摘要要不要提方法？", "", "", "")
    mark = marks[4]
    assert (mark["a"], mark["b"], mark["final"], mark["original"]) == ("装置",) * 4
    # 同行多条：区间互不重叠且按列升序
    same = [m for m in marks if m["line"] == 5]
    assert all(x["to"] <= y["from"] for x, y in zip(same, same[1:]))


@pytest.mark.parametrize("src", [SAMPLE, *CASES])
def test_a5_apply_marks_matches_accept_reject(src):
    marks = critic.parse(src)
    assert apply_marks(src, marks, "final") == critic.accept(src)
    assert apply_marks(src, marks, "original") == critic.reject(src)


def test_parse_offsets_are_utf16_units():
    # 非 BMP 字符（𠀀 = 2 个 UTF-16 单元）出现在标记之前，前端 JS 偏移须按 UTF-16 计
    src = "𠀀{++x++}"
    (m,) = critic.parse(src)
    assert (m["from"], m["to"]) == (2, 9)
    js_len = len(src.encode("utf-16-le")) // 2
    assert m["to"] == js_len


def test_parse_no_markup_is_empty():
    assert critic.parse("普通文本\n{ 花括号 } 无标记") == []
    assert critic.parse("多行{++x\ny++}不跨行") == []


def test_lint_marks():
    warns = critic.lint_marks("正常 {++a++}\n{++x\ny++}\n{++a{--b--}c++}\n{--未闭合 {++ok++}")
    assert [(w["id"], w["line"]) for w in warns] == [
        ("critic.unclosed#L2", 2),
        ("critic.nested#L4", 4),
        ("critic.unclosed#L5", 5),
    ]
    assert {w["severity"] for w in warns} == {"warning"}
    assert all(w["source"] == "lint" and w["message"] and w["fix"] for w in warns)
    assert critic.lint_marks(SAMPLE) == []


@pytest.mark.parametrize("pid", ["method", "system"])
def test_examples_have_no_marks_or_warnings(pid):
    with open(os.path.join(ROOT, "examples", pid, "content.md"), encoding="utf-8") as f:
        md = f.read()
    assert critic.parse(md) == []
    assert critic.lint_marks(md) == []
