# -*- coding: utf-8 -*-
"""CriticMarkup → Word 原生修订（w:ins / w:del / w:delText / 批注 / 高亮）。docs/plan/10 §4，单元 F2-tracked-docx。

builder.PatentBuilder(run_hook=...) 在 add_math_text 里按 hook.split 切段、逐段生成 run、
再交给 hook.wrap 包裹；hook 为 None 时 builder 路径与原来逐字节相同（零漂移）。
标记不跨源码行，与 critic.parse 逐行解析对齐。

    {++X++}      <w:ins w:id w:author w:date><w:r>…<w:t>X</w:t></w:r></w:ins>
    {--X--}      <w:del …><w:r>…<w:delText>X</w:delText></w:r></w:del>
    {~~A~>B~~}   w:del(A) 紧接 w:ins(B)
    {>>C<<}      comments.xml 批注，锚在本段前一 run（段首则锚在一个空 run）
    {==X==}      w:highlight yellow 的普通 run

修订只作用于经 add_math_text 的文本（正文段、权项、编号段、标题、表格单元格）；
公式行 `$$…$$` 与 ``` 代码块是 OMML / 等宽原样对象，不做 run 级修订，其中的标记按 final 处理。
"""

import os
from datetime import UTC, datetime
from typing import Protocol

from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.run import Run

from . import critic
from .builder import build_patent_ex
from .content import parse_md

UNIT = "F2-tracked-docx"
DEFAULT_AUTHOR = "知撰"

RunKind = str  # "keep" | "ins" | "del" | "mark" | "comment"


class RunHook(Protocol):
    def split(self, text: str) -> list[tuple[RunKind, str]]:
        """把一行文本切成 (kind, 片段) 序列；无标记时返回 [("keep", text)]。"""

    def wrap(self, p, kind: RunKind, runs: list) -> None:
        """runs 是刚为该片段追加到 p._p 尾部的 CT_R 元素；按 kind 包进 w:ins / w:del（del 需把 w:t 改为 w:delText）。"""


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class TrackedRuns:
    """RunHook 实现：split 用 critic.TOKEN；wrap 生成 w:ins/w:del（w:id 全文档递增、w:author、w:date）。"""

    def __init__(self, author: str = DEFAULT_AUTHOR, date: str | None = None):
        self.author = author
        self.date = date or _now_iso()
        self.next_id = 1
        self.comments = 0
        self._pending_comments: list[str] = []

    def split(self, text: str) -> list[tuple[RunKind, str]]:
        if "{" not in text:
            return [("keep", text)]
        out: list[tuple[RunKind, str]] = []
        pos = 0
        for m in critic.TOKEN.finditer(text):
            if m.start() > pos:
                out.append(("keep", text[pos : m.start()]))
            if m.group("ins") is not None:
                out.append(("ins", m.group("ins")))
            elif m.group("dele") is not None:
                out.append(("del", m.group("dele")))
            elif m.group("sub_a") is not None:
                out.append(("del", m.group("sub_a")))
                out.append(("ins", m.group("sub_b")))
            elif m.group("comment") is not None:
                out.append(("comment", m.group("comment")))
            else:
                out.append(("mark", m.group("mark")))
            pos = m.end()
        if pos < len(text):
            out.append(("keep", text[pos:]))
        segs = [(k, s) for k, s in out if s]
        # 批注原文经 split→wrap 直传（wrap 拿到的 run 文本已过 _emit_math_text，不再等于原文）
        self._pending_comments.extend(s for k, s in segs if k == "comment")
        return segs or [("keep", "")]

    def wrap(self, p, kind: RunKind, runs: list) -> None:
        if kind == "comment":
            self._comment(p, runs, self._pending_comments.pop(0))
            return
        if kind == "keep" or not runs:
            return
        if kind == "mark":
            for r in runs:
                Run(r, p).font.highlight_color = WD_COLOR_INDEX.YELLOW
            return
        change = OxmlElement("w:ins" if kind == "ins" else "w:del")
        change.set(qn("w:id"), str(self.next_id))
        change.set(qn("w:author"), self.author)
        change.set(qn("w:date"), self.date)
        self.next_id += 1
        runs[0].addprevious(change)
        for r in runs:
            change.append(r)
            if kind == "del":
                for t in r.findall(qn("w:t")):
                    t.tag = qn("w:delText")

    def _comment(self, p, runs, text):
        """批注文本不进正文：删掉刚生成的 run，把批注范围锚在段内前一个 run / w:ins / w:del 上；
        段首无锚时留一个空 run 做锚。范围标记放在段级（不钻进 w:del），批注引用 run 不会被当成已删除文本。"""
        anchor = runs[0].getprevious()
        while anchor is not None and (
            anchor.tag not in (qn("w:r"), qn("w:ins"), qn("w:del")) or anchor.find(qn("w:commentReference")) is not None
        ):
            anchor = anchor.getprevious()
        if anchor is None:
            anchor = runs[0]
            for t in anchor.findall(qn("w:t")):
                anchor.remove(t)
            runs = runs[1:]
        for r in runs:
            p._p.remove(r)
        comment = p.part.document.comments.add_comment(text=text, author=self.author, initials=None)
        cid = str(comment.comment_id)
        anchor.addprevious(OxmlElement("w:commentRangeStart", attrs={qn("w:id"): cid}))
        ref = OxmlElement("w:r")
        ref.append(OxmlElement("w:commentReference", attrs={qn("w:id"): cid}))
        anchor.addnext(ref)
        anchor.addnext(OxmlElement("w:commentRangeEnd", attrs={qn("w:id"): cid}))
        self.comments += 1


def _final_outside_runs(md: str) -> str:
    """公式行与 ``` 代码块内的标记按 final 处理（这些对象不经 add_math_text，标记无法映射成修订）。"""
    out, in_code = [], False
    for ln in md.split("\n"):
        if ln.strip().startswith("```"):
            in_code = not in_code
            out.append(ln)
        elif in_code or ln.startswith("$$"):
            out.append(critic.accept(ln))
        else:
            out.append(ln)
    return "\n".join(out)


def build_tracked(config: dict, author: str = DEFAULT_AUTHOR, date: str | None = None):
    """config 同 build_patent_ex（content_md 为 critic.resolve(raw, "markup") 保留标记的文本）；返回 BuildResult。

    摘要字数按 final 文本核对（标记符不计入），再交给 builder 出 DOCX。
    """
    with open(config["content_md"], encoding="utf-8") as f:
        raw = f.read()
    md = _final_outside_runs(raw)
    if md != raw or critic.has_markup(md):
        _, abstract, _, _ = parse_md(md)
        limit = config.get("abstract_limit", 300)
        final_len = len(critic.accept(abstract))
        assert final_len <= limit, f"摘要超过{limit}字：{final_len}"
        content_md = os.path.splitext(config["out"])[0] + ".tracked.md"
        with open(content_md, "w", encoding="utf-8") as f:
            f.write(md)
        config = {**config, "content_md": content_md, "abstract_limit": 10**9}
        try:
            return build_patent_ex({**config, "run_hook": TrackedRuns(author, date)})
        finally:
            os.remove(content_md)
    return build_patent_ex({**config, "run_hook": TrackedRuns(author, date)})
