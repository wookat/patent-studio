# -*- coding: utf-8 -*-
"""说明书段号（[0001]…）的唯一计数实现，DOCX（builder）/ XML（cnipa_xml）/ AST 共用。

规则（与 builder.build_patent_ex 历史行为逐项相同）：
  普通段落 +1；表格本体 +1，表题后置 +1，表注 +1；代码块 +1；
  公式（e）与章节/小节标题（h/s）不计号。
输入为 content.load_md / parse_md 返回的 spec 列表。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ItemNumbers:
    """spec 单项的段号；None 表示该项不带号。"""

    para_no: int | None = None
    caption_after_no: int | None = None
    note_no: int | None = None


def number_spec(spec):
    """返回与 spec 等长的 ItemNumbers 列表。"""
    out = []
    n = 0
    for item in spec:
        if isinstance(item, tuple):
            kind = item[0]
            if kind in ("e", "h", "s"):
                out.append(ItemNumbers())
                continue
            if kind == "t":
                topts = item[2] if len(item) > 2 else {}
                n += 1
                nums = {"para_no": n}
                if topts.get("表题后置"):
                    n += 1
                    nums["caption_after_no"] = n
                if topts.get("表注"):
                    n += 1
                    nums["note_no"] = n
                out.append(ItemNumbers(**nums))
                continue
            if kind == "c":
                n += 1
                out.append(ItemNumbers(para_no=n))
                continue
            if kind == "f":
                n += 1
                out.append(ItemNumbers(para_no=n))
                continue
            raise ValueError(f"未知 spec 项：{kind!r}")
        n += 1
        out.append(ItemNumbers(para_no=n))
    return out


def para_label(n):
    """段号显示形式：13 → '[0013]'。"""
    return f"[{n:04d}]"
