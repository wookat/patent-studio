# -*- coding: utf-8 -*-
"""块补丁内核（docs/plan/06-r3-structure-edit-design.md §3 / §4）。

  serialize_block(block) -> list[str]
      AST 块 → 内核 Markdown 行（序列化法则 §4 的后端参考实现，已对两案 212 块逐字节验证，
      见 tests/test_patch.py）。
      前端 structure/edit 的 TS 序列化器必须与之逐字节一致（vitest golden 用同一两案）。
  patch_block(content, block_id, markdown, settings=None) -> PatchResult
      用 parse_ast(content) 找到 block_id 的书相对 lines，换成 markdown 的行；重解析校验；
      返回新全文 + 新 AST + changed_lines。
  insert_block(content, kind, after_block_id=None, book=None, markdown=None, settings=None) -> PatchResult
      在 after_block_id 之后（或 book 标题行之后）插入「空行 + 块行」；markdown 缺省用 block_templates.template(kind)。
  delete_block(content, block_id, settings=None) -> PatchResult
      删除块行并合并多出的空行，使块间恒为单空行。

坐标：块 lines 是书相对 1-based 闭区间（ast.py）；全文行 = books[book].offset + line。changed_lines 用全文行。
以 content 为基准（可以是编辑区未保存全文），不比对磁盘。
错误：找不到 block_id → PatchError(kind="stale", line=None)；kind 不适用于该书 → PatchError(kind="kind")；
重解析失败 / 删法定章节 → PatchError(kind="content", line=<全文行>)。
落盘不在此模块：路由层拿 PatchResult.content 走 ProjectStore.save_content（.bak + docs/*.md 镜像）。
"""
from __future__ import annotations

import dataclasses
import re

from . import block_templates, critic
from .ast import AstError, parse_ast
from .cnipa_xml import SECTION_ELEMENTS
from .content import table_spec_line

STATUTORY_PARTS = frozenset(SECTION_ELEMENTS.values())

KIND_BOOKS = {
    "paragraph": ("abstract", "claims", "description"),
    "claim": ("claims",),
    "section": ("description",),
    "subsection": ("description",),
    "equation": ("description",),
    "table": ("description",),
    "figure-ref": ("description",),
    "figure": ("description",),
}


class PatchError(Exception):
    """kind ∈ {"stale", "content", "kind"}；line 为全文 1-based 行或 None。"""

    def __init__(self, message, kind="content", line=None):
        super().__init__(message)
        self.kind = kind
        self.line = line


@dataclasses.dataclass(frozen=True)
class PatchResult:
    content: str
    ast: dict
    changed_lines: dict  # {"start": int, "end": int}  全文行，闭区间；删除时 end = start - 1
    block_id: str | None  # 新 AST 里该块的 id（删除为 None）


def _table_option_tokens(options, caption_after):
    toks = []
    if options["three_line"]:
        toks.append("三线")
    if options["repeat_header"]:
        toks.append("重复表头")
    if options["num_left"]:
        toks.append("段号居左")
    if options["col_widths"]:
        toks.append("列宽=" + ",".join("%g" % x for x in options["col_widths"]))
    if caption_after:
        toks.append("表题后置=" + caption_after["text"])
    return toks


def serialize_block(block):
    """AST 块 → 内核 Markdown 行（不含块间空行）。abstract 整块不可序列化（按其 paragraphs 逐段编辑）。"""
    k = block["kind"]
    if k in ("paragraph", "figure-ref"):
        return [block["text"]]
    if k == "section":
        return ["### " + block["title"]]
    if k == "subsection":
        return ["#### " + block["title"]]
    if k == "equation":
        return [("$$%s$$ %s" % (block["source"], block["label"] or "")).rstrip()]
    if k == "claim":
        return [("$$%s$$" % s["text"]) if s["kind"] == "equation" else s["text"] for s in block["segments"]]
    if k == "code":
        return ["```", *block["code_lines"], "```"]
    if k == "figure":
        w = block.get("width")
        wtxt = "%g" % w if isinstance(w, float) else str(w or 15)
        return [f"![{block.get('alt') or ''}](figs/{block['file']}){{width={wtxt}}}"]
    if k == "table":
        out = []
        toks = _table_option_tokens(block["options"], block["caption_after"])
        if toks:
            out.append(table_spec_line(toks))
        head, *body = block["rows"]
        out.append("| " + " | ".join(head) + " |")
        out.append("| " + " | ".join("---" for _ in head) + " |")
        out.extend("| " + " | ".join(r) + " |" for r in body)
        if block["note"]:
            out.extend(["", block["note"]["text"]])
        return out
    raise PatchError("不可序列化的块类型：%s" % k, kind="kind")


# ---------------- 定位 ----------------

def iter_blocks(ast):
    """可编辑块：(book, block)。摘要按段；title / abstract 整块 / figures 不在内。"""
    for b in ast["abstract"]["paragraphs"]:
        yield "abstract", b
    for b in ast["claims"]:
        yield "claims", b
    for b in ast["description"]:
        yield "description", b


def find_block(ast, block_id):
    """返回 (book, block, s, e)：s/e 为全文 0-based 半开区间 lines[s:e]；找不到 → PatchError(stale)。"""
    for book, b in iter_blocks(ast):
        if b["id"] == block_id:
            off = ast["books"][book]["offset"]
            return book, b, off + b["lines"]["start"] - 1, off + b["lines"]["end"]
    raise PatchError("块 %s 不在当前源码的结构中（结构已过期，请刷新）" % block_id, kind="stale")


def block_at_line(ast, line):
    """全文 1-based 行 → 覆盖该行的可编辑块 id；无则 None。"""
    for book, b in iter_blocks(ast):
        off = ast["books"][book]["offset"]
        if off + b["lines"]["start"] <= line <= off + b["lines"]["end"]:
            return b["id"]
    return None


def _reparse(text, settings, figures=None):
    # 块定位视图必须与产 id 的 AST 同口径（routes_ast/derive 皆按接受后文本解析）——
    # 接受后视图：{--…--} 行不再占段落序号，pNNNN 排序与产 id 侧一致；
    # critic.accept 逐行保数，接受侧 lines 偏移与原文行 1:1，行级拼接仍走原文 text。
    try:
        return parse_ast(critic.accept(text), settings, figures=figures)
    except AstError as e:
        raise PatchError(str(e), kind="content", line=e.line)


_BOOK_HEAD_RE = re.compile(r"^##\s+(摘要|权利要求书|说明书)\s*(.*)$")


def _block_lines(markdown):
    # AI 产出的补丁正文会把书标题粘进行首（`## 摘要本发明…`）或携带裸书头行——
    # 块级补丁的书界由锚点决定，markdown 内不允许任何 `## ` 行：一旦进入全文，
    # AST 把非三书名目的 `## ` 行当未知章节拒（提案 apply 422）。确定性归一：
    # 书名行剥除（胶水行的正文尾部保留）、其余 `## ` 行剥前缀降为正文文本。
    out = []
    for ln in markdown.strip("\n").split("\n"):
        stripped = ln.strip()
        if stripped.startswith("## "):
            m = _BOOK_HEAD_RE.match(stripped)
            if m:
                tail = m.group(2).strip()
                if tail:
                    out.append(tail)
                continue
            out.append(stripped[3:])
            continue
        out.append(ln)
    return out


# ---------------- 三个动作 ----------------

def patch_block(content, block_id, markdown, settings=None, figures=None, base=None):
    ast = _reparse(content, settings, figures)
    _book, _b, s, e = find_block(ast, block_id)
    lines = content.split("\n")
    if base is not None and "\n".join(lines[s:e]) != base:
        raise PatchError("该块内容已被他人修改，请重新打开编辑", kind="conflict")
    new_lines = _block_lines(markdown)
    text = "\n".join(lines[:s] + new_lines + lines[e:])
    new_ast = _reparse(text, settings, figures)
    return PatchResult(text, new_ast, {"start": s + 1, "end": s + len(new_lines)}, block_at_line(new_ast, s + 1))


def insert_block(content, kind, after_block_id=None, book=None, markdown=None, settings=None, figures=None):
    if kind not in KIND_BOOKS:
        raise PatchError("未知块类型：%s" % kind, kind="kind")
    ast = _reparse(content, settings, figures)
    lines = content.split("\n")
    if after_block_id is not None:
        book, _b, _s, at = find_block(ast, after_block_id)
    elif book in ast["books"]:
        at = ast["books"][book]["offset"]
    else:
        raise PatchError("插入位置缺失：需给 after_block_id 或 book", kind="kind")
    if book not in KIND_BOOKS[kind]:
        raise PatchError("%s 不能插入%s" % (kind, {"abstract": "摘要", "claims": "权利要求书",
                                                   "description": "说明书"}[book]), kind="kind")
    if markdown is None:
        markdown = block_templates.template(kind, num=_claim_position(ast, at), fig_num=len(ast["figures"]) + 1)
    new_lines = _block_lines(markdown)
    tail = lines[at:]
    if tail and tail[0] != "":
        tail = ["", *tail]
    text = "\n".join(lines[:at] + ["", *new_lines] + tail)
    new_ast = _reparse(text, settings, figures)
    return PatchResult(text, new_ast, {"start": at + 2, "end": at + 1 + len(new_lines)}, block_at_line(new_ast, at + 2))


def _claim_position(ast, at):
    """在全文 0-based 行 at 处插入的权项会成为第几项。"""
    off = ast["books"]["claims"]["offset"]
    return sum(1 for c in ast["claims"] if off + c["lines"]["end"] <= at) + 1


def delete_block(content, block_id, settings=None, figures=None):
    ast = _reparse(content, settings, figures)
    _book, b, s, e = find_block(ast, block_id)
    if b["kind"] == "section" and b["part"] in STATUTORY_PARTS:
        raise PatchError("「%s」是说明书法定章节，不能删除" % b["title"], kind="content", line=s + 1)
    lines = content.split("\n")
    new = lines[:s] + lines[e:]
    if 0 < s < len(new) and new[s] == "" and new[s - 1] == "":
        del new[s]
    text = "\n".join(new)
    return PatchResult(text, _reparse(text, settings, figures), {"start": s + 1, "end": s}, None)
