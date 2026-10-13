# -*- coding: utf-8 -*-
"""块模板（docs/plan/06-r3-structure-edit-design.md §3.5）：各 kind 的内核语法样板，后端唯一来源，前端只展示不硬编码。

  BLOCK_KINDS：可插入的块类型（与 ast_schema 的 kind 一致，figure-ref 是说明书里引用附图的普通段落）。
  Template = {"kind", "label", "book": 可插入的书, "markdown": 多行样板, "cursor": {"line", "col"} 样板内建议光标位置}
      cursor 为 0-based（line 0 = 样板首行；col = 该行内字符偏移，落在占位文字之前）。
  templates() -> list[Template]  GET /api/block-templates 直接返回 {"templates": [...]}。
  template(kind, **ctx) -> str    insert_block 缺省 markdown；ctx：claim 的 num（位置序号）、figure-ref 的 fig_num。

段落样板不为空：空行不会成为 AST 块，插入后前端无块可进入编辑；占位文字沿用新案模板的「……」。
"""
from __future__ import annotations

from typing import Literal, TypedDict

from .content import table_spec_line

BlockKind = Literal["paragraph", "section", "subsection", "equation", "table", "claim", "figure-ref", "figure"]
BLOCK_KINDS: tuple[BlockKind, ...] = (
    "paragraph", "section", "subsection", "equation", "table", "claim", "figure-ref", "figure")

_ALL = ["abstract", "claims", "description"]
_DESC = ["description"]


class Cursor(TypedDict):
    line: int
    col: int


class Template(TypedDict):
    kind: BlockKind
    label: str
    book: list[str]
    markdown: str
    cursor: Cursor


def template(kind: BlockKind, **ctx) -> str:
    if kind == "paragraph":
        return "……"
    if kind == "section":
        return "### 章节标题"
    if kind == "subsection":
        return "#### 小节标题"
    if kind == "equation":
        return "$$E = mc^2$$"
    if kind == "table":
        return table_spec_line(["三线"]) + "\n| 列1 | 列2 |\n| --- | --- |\n| | |"
    if kind == "claim":
        return "%d.一种……，其特征在于，" % ctx.get("num", 1)
    if kind == "figure-ref":
        return "图%d为……示意图。" % ctx.get("fig_num", 1)
    if kind == "figure":
        return "![](figs/fig.png){width=15}"
    raise KeyError(kind)


def _t(kind: BlockKind, label: str, book: list[str], line: int, col: int, **ctx) -> Template:
    return {"kind": kind, "label": label, "book": list(book), "markdown": template(kind, **ctx),
            "cursor": {"line": line, "col": col}}


def templates() -> list[Template]:
    return [
        _t("paragraph", "段落", _ALL, 0, 0),
        _t("section", "章节标题", _DESC, 0, 4),
        _t("subsection", "小节标题", _DESC, 0, 5),
        _t("equation", "公式", _DESC, 0, 2),
        _t("table", "表格", _DESC, 1, 2),
        _t("claim", "权利要求", ["claims"], 0, 2),
        _t("figure-ref", "附图引用", _DESC, 0, 3),
        _t("figure", "内嵌图", _DESC, 0, 6),
    ]
