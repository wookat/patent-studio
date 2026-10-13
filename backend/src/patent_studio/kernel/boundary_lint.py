# -*- coding: utf-8 -*-
"""源码边界 lint（docs/plan/06-r3-structure-edit-design.md §3.6）：用户手写了本应由内核生成的编号。

  lint_boundary(ast, content) -> list[Diagnostic]
      Diagnostic 与 app/lint.py 同形：{id, severity:"warning", source:"boundary", message, line, section, fix}
      line 为全文 1-based 行；fix = {"block_id", "markdown"}（修正后的整块 Markdown，可直接喂 patch.patch_block）。

规则：
  boundary.para_no    说明书段落 / 摘要段以 `[0001]` 样式开头 → 删前缀
                      （表注前写了编号就不再是“注：”行，会被解析为普通段，同样命中）
  boundary.claim_num  权项首行前导数字 ≠ 位置序号 → 改写为 `{num}.`
  boundary.figure_num 附图说明第 k 条「图N为…」的 N ≠ figures[k].num → 改写为 `图{num}`

并入 app/lint.py 由 integrate 做；本模块只是纯函数。
"""
from __future__ import annotations

import re

from .patch import serialize_block

RULES = ("boundary.para_no", "boundary.claim_num", "boundary.figure_num")

_PARA_NO_RE = re.compile(r"^\s*[\[【]\s*\d{1,4}\s*[\]】]\s*")
_CLAIM_NUM_RE = re.compile(r"^\s*(\d+)\s*[.、．]?\s*")
_FIGURE_RE = re.compile(r"^(\s*图)(\d+)([为是])")

_SECTION = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}


def _d(id_, message, line, section, block_id, markdown):
    return {"id": id_, "severity": "warning", "source": "boundary", "message": message, "line": line,
            "section": section, "fix": {"block_id": block_id, "markdown": markdown}}


def _para_no(ast):
    out = []
    for book in ("abstract", "description"):
        off = ast["books"][book]["offset"]
        blocks = ast["abstract"]["paragraphs"] if book == "abstract" else ast["description"]
        for b in blocks:
            if b["kind"] == "paragraph" and _PARA_NO_RE.match(b["text"]):
                out.append(_d("boundary.para_no", "段号由内核生成，请删除手写的段号前缀", off + b["lines"]["start"],
                              _SECTION[book], b["id"], _PARA_NO_RE.sub("", b["text"], 1)))
    return out


def _claim_num(ast):
    out = []
    off = ast["books"]["claims"]["offset"]
    for c in ast["claims"]:
        if c["num_written"] is None or int(c["num_written"]) == c["num"]:
            continue
        lines = serialize_block(c)
        lines[0] = _CLAIM_NUM_RE.sub("%d." % c["num"], lines[0], 1)
        msg = "权利要求手写编号 %s 与其位置序号 %d 不符" % (c["num_written"], c["num"])
        out.append(_d("boundary.claim_num", msg, off + c["lines"]["start"], _SECTION["claims"], c["id"],
                      "\n".join(lines)))
    return out


def _figure_num(ast):
    out = []
    figures = ast["figures"]
    if not figures:
        return out
    off = ast["books"]["description"]["offset"]
    k = 0
    in_drawings = False
    for b in ast["description"]:
        if b["kind"] == "section":
            in_drawings = b["part"] == "description-of-drawings"
        elif in_drawings and b["kind"] == "paragraph":
            m = _FIGURE_RE.match(b["text"])
            if not m:
                continue
            if k < len(figures) and int(m.group(2)) != figures[k]["num"]:
                num = figures[k]["num"]
                msg = "附图说明第 %d 条写的是「图%s」，对应附图为图%d" % (k + 1, m.group(2), num)
                fixed = m.group(1) + str(num) + m.group(3) + b["text"][m.end():]
                out.append(_d("boundary.figure_num", msg, off + b["lines"]["start"], _SECTION["description"],
                              b["id"], fixed))
            k += 1
    return out


def lint_boundary(ast, content):
    return _para_no(ast) + _claim_num(ast) + _figure_num(ast)
