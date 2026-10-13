# -*- coding: utf-8 -*-
"""两版全文的块级差异（W9 "已修改" Tab；GET /history/diff?format=blocks）。

block_diff(a_text, ast_a, b_text, ast_b) → [{book, block_id, kind, lines: [from, to]}]
  行 diff（difflib.SequenceMatcher，按 "\\n" 切行）→ 归并到 b 版 AST 的可编辑块
  （patch.iter_blocks：摘要段 / 权项 / 说明书块）：
    changed：b 块的全文行区间与某个 replace/insert 片段相交，且该块不是整块新增
    added  ：b 块整块落在 insert 片段之内（a 里没有对应行）
    removed：a 版 AST 里整块落在 delete 片段内的块；block_id 是 a 版 id，
             lines 为其在 b 里的落点 [p+1, p]（空区间，同 patch 删除）
  lines 是 b 版全文 1-based 闭区间；顺序按 b 版全文行（removed 按落点行）。
  同一块只出一条；不在任何块内的改动（标题行 / 书标题 / 空行）不出条。
"""
import difflib

from .patch import iter_blocks


def _block_ranges(ast):
    """[(book, block_id, from, to)]：全文 1-based 闭区间。"""
    out = []
    for book, b in iter_blocks(ast):
        off = ast["books"][book]["offset"]
        out.append((book, b["id"], off + b["lines"]["start"], off + b["lines"]["end"]))
    return out


def block_diff(a_text, ast_a, b_text, ast_b):
    a_lines, b_lines = a_text.split("\n"), b_text.split("\n")
    ops = [(tag, i1, i2, j1, j2) for tag, i1, i2, j1, j2 in
           difflib.SequenceMatcher(None, a_lines, b_lines, autojunk=False).get_opcodes() if tag != "equal"]
    inserted = set()  # b 版 1-based 行：a 里没有对应行
    touched = set()  # b 版 1-based 行：处于 replace/insert 片段
    for tag, _i1, _i2, j1, j2 in ops:
        rows = range(j1 + 1, j2 + 1)
        touched.update(rows)
        if tag == "insert":
            inserted.update(rows)
    out = []
    for book, bid, lo, hi in _block_ranges(ast_b):
        rows = range(lo, hi + 1)
        if not any(r in touched for r in rows):
            continue
        kind = "added" if all(r in inserted for r in rows) else "changed"
        out.append({"book": book, "block_id": bid, "kind": kind, "lines": [lo, hi]})
    deleted = {}  # a 版 1-based 行 → b 版落点（0-based j1）
    for tag, i1, i2, _j1, _j2 in ops:
        if tag == "delete":
            for r in range(i1 + 1, i2 + 1):
                deleted[r] = _j1
    for book, bid, lo, hi in _block_ranges(ast_a):
        if all(r in deleted for r in range(lo, hi + 1)):
            p = deleted[lo]
            out.append({"book": book, "block_id": bid, "kind": "removed", "lines": [p + 1, p]})
    out.sort(key=lambda x: (x["lines"][0], x["kind"] != "removed"))
    return out
