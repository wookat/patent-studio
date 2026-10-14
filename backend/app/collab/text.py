# -*- coding: utf-8 -*-
"""服务端替换全文：把 pycrdt `Text` 就地改成目标字符串（保留未变部分，远端光标/选区不跳）。

pycrdt `Text` 的索引是 UTF-8 **字节**偏移（yrs OffsetKind::Bytes），difflib 给的是 Python 字符偏移，
按字符切时逐段换算成字节（spike 2026-09-05：直接用字符偏移会把中文切坏，客户端报 "Unexpected case"）。
"""

import difflib

from pycrdt import Text


def apply_full_text(ytext: Text, new: str, origin=None) -> bool:
    """一个事务内把 ytext 改为 new；返回是否有变化。"""
    old = str(ytext)
    if old == new:
        return False
    with ytext.doc.transaction(origin=origin):
        cur = old
        pos = 0
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
            if tag == "equal":
                pos += i2 - i1
                continue
            bpos = len(cur[:pos].encode("utf-8"))
            if tag in ("delete", "replace"):
                n = i2 - i1
                del ytext[bpos : bpos + len(cur[pos : pos + n].encode("utf-8"))]
                cur = cur[:pos] + cur[pos + n :]
            if tag in ("insert", "replace"):
                ins = new[j1:j2]
                ytext.insert(bpos, ins)
                cur = cur[:pos] + ins + cur[pos:]
                pos += len(ins)
    return True
