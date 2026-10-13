# -*- coding: utf-8 -*-
"""批注线程存储（docs/plan/07 §4.2）：<project>/reviews/comments.json（数组，UTF-8，indent=2）。

锚点 {block_id, line, quote}：block_id 为 AST 块 id（04-r1-design §3，随结构稳定），line 全文 1-based，
quote 为用户选中的源码片段。读取时 reanchor：块内搜 quote → 全文搜 quote → 都失败保留 line 并标 stale。

W5（docs/plan/21 R-PDF-05 / R-REV-02）：锚点可选带 book / line_start / line_end（版面与 PDF 视图按行区间定位），
或 {file}（对新文件 / 附件的批注，不参与重锚）；这些字段为 None 时不写入 JSON，老批注形状不变。
线程字段：parent_id（回复所属根批注；根批注为 None）、resolved_at / resolved_by、source（human | ai | client）、
mentions（正文 `@名字` 解析出的显示名，路由层再对成员表做匹配并 emit comment.mention）。
"""
import asyncio
import json
import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Literal

from app import atomic

Source = Literal["human", "ai", "client"]
BOOKS: tuple[str, ...] = ("abstract", "claims", "description")

_MENTION_RE = re.compile(r"(?<![A-Za-z0-9._@])@([^\s@，,。；;：:！!？?（）()<>\[\]{}\"'`]{1,32})")

# 台账 load→mutate→save 中夹 await（权限检查等）即丢更新——按案目录串行化所有写方（R84）
_ledger_locks: dict[str, asyncio.Lock] = {}


def ledger_lock(project_dir: str) -> asyncio.Lock:
    return _ledger_locks.setdefault(project_dir, asyncio.Lock())


def file_lock(project_dir: str):
    """comments.json 跨进程写锁（R92/R93）：web 与 stdio MCP 是两个进程，asyncio.Lock 只管单进程。
    锁内必须纯同步；约定用法：锁内重新 load → mutate → save。"""
    return atomic.studio_lock(project_dir, "comments")


@dataclass
class Anchor:
    block_id: str = ""
    line: int = 0      # 全文 1-based（文件锚为 0）
    quote: str = ""
    stale: bool = False
    book: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    file: str | None = None

    def to_dict(self) -> dict:
        d = {"block_id": self.block_id, "line": self.line, "quote": self.quote, "stale": self.stale}
        for k in ("book", "line_start", "line_end", "file"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        return d


def anchor_from_dict(a: dict) -> Anchor:
    """{block_id, line, quote} | {book, block_id, line_start, line_end?, quote?} | {file}；缺 line 时取 line_start。"""
    line_start = a.get("line_start")
    line = a.get("line", line_start)
    return Anchor(block_id=a.get("block_id") or "", line=int(line or 0), quote=a.get("quote") or "",
                  stale=bool(a.get("stale", False)), book=a.get("book"),
                  line_start=int(line_start) if line_start is not None else None,
                  line_end=int(a["line_end"]) if a.get("line_end") is not None else None,
                  file=a.get("file"))


@dataclass
class Author:
    id: str | None     # auth=off ⇒ None；客户访客 ⇒ None
    name: str          # auth=off ⇒ "本机"


LOCAL_AUTHOR = Author(id=None, name="本机")


@dataclass
class Reply:
    id: str
    body: str
    author: Author
    created_at: float
    parent_id: str = ""
    source: str = "human"
    mentions: list[str] = field(default_factory=list)


@dataclass
class Comment:
    id: str
    anchor: Anchor
    body: str
    author: Author
    created_at: float
    updated_at: float
    resolved: bool = False
    replies: list[Reply] = field(default_factory=list)
    parent_id: str | None = None
    resolved_at: float | None = None
    resolved_by: Author | None = None
    source: str = "human"
    mentions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["anchor"] = self.anchor.to_dict()
        return d


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def parse_mentions(body: str) -> list[str]:
    """`@张律师 请看` → ["张律师"]；去重保序。邮箱里的 @ 不算（前面紧贴字母）。"""
    out: list[str] = []
    for m in _MENTION_RE.findall(body):
        if m not in out:
            out.append(m)
    return out


def _reply_from_dict(r: dict, parent_id: str) -> Reply:
    return Reply(id=r["id"], body=r["body"], author=Author(**r["author"]), created_at=r["created_at"],
                 parent_id=r.get("parent_id") or parent_id, source=r.get("source", "human"),
                 mentions=list(r.get("mentions", [])))


def _from_dict(d: dict) -> Comment:
    rb = d.get("resolved_by")
    return Comment(
        id=d["id"],
        anchor=anchor_from_dict(d["anchor"]),
        body=d["body"],
        author=Author(**d["author"]),
        created_at=d["created_at"],
        updated_at=d["updated_at"],
        resolved=bool(d.get("resolved", False)),
        replies=[_reply_from_dict(r, d["id"]) for r in d.get("replies", [])],
        parent_id=d.get("parent_id"),
        resolved_at=d.get("resolved_at"),
        resolved_by=Author(**rb) if rb else None,
        source=d.get("source", "human"),
        mentions=list(d.get("mentions", [])),
    )


def comments_path(project_dir: str) -> str:
    return os.path.join(project_dir, "reviews", "comments.json")


def load(project_dir: str) -> list[Comment]:
    p = comments_path(project_dir)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [_from_dict(d) for d in json.load(f)]


def save(project_dir: str, comments: list[Comment]) -> None:
    p = comments_path(project_dir)
    atomic.write_json(p, [c.to_dict() for c in comments])


def find(comments: list[Comment], cid: str) -> Comment | None:
    return next((c for c in comments if c.id == cid), None)


def create(anchor: Anchor, body: str, author: Author, source: str = "human") -> Comment:
    now = time.time()
    return Comment(id=_new_id(), anchor=anchor, body=body, author=author, created_at=now, updated_at=now,
                   source=source, mentions=parse_mentions(body))


def update(c: Comment, body: str | None = None, anchor: Anchor | None = None) -> Comment:
    if body is not None:
        c.body = body
        c.mentions = parse_mentions(body)
    if anchor is not None:
        c.anchor = anchor
    c.updated_at = time.time()
    return c


def reply(c: Comment, body: str, author: Author, source: str = "human") -> Comment:
    now = time.time()
    c.replies.append(Reply(id=_new_id(), body=body, author=author, created_at=now, parent_id=c.id, source=source,
                           mentions=parse_mentions(body)))
    c.updated_at = now
    return c


def resolve(c: Comment, resolved: bool, by: Author | None = None) -> Comment:
    """resolved=True 记 resolved_at / resolved_by；False（重开）清掉两者。"""
    now = time.time()
    c.resolved = resolved
    c.resolved_at = now if resolved else None
    c.resolved_by = by if resolved else None
    c.updated_at = now
    return c


def select(comments: list[Comment], *, author: str | None = None, status: str | None = None,
           source: str | None = None, mention: str | None = None) -> list[Comment]:
    """筛选：author = 作者 id 或显示名（含回复作者）；status open | resolved；source；mention = 被 @ 者（含回复）。"""
    out = comments
    if author:
        out = [c for c in out if author in (c.author.id, c.author.name)
               or any(author in (r.author.id, r.author.name) for r in c.replies)]
    if status == "open":
        out = [c for c in out if not c.resolved]
    elif status == "resolved":
        out = [c for c in out if c.resolved]
    if source:
        out = [c for c in out if c.source == source]
    if mention:
        out = [c for c in out if mention in c.mentions or any(mention in r.mentions for r in c.replies)]
    return out


# ---------------- 重锚 ----------------

def _block_ranges(ast: dict) -> dict[str, tuple[int, int]]:
    """AST 块 id → 全文行闭区间 [start, end]（books[book].offset + 书内相对行）。"""
    out: dict[str, tuple[int, int]] = {}

    def put(book: str, block: dict):
        off = ast["books"][book]["offset"]
        out[block["id"]] = (off + block["lines"]["start"], off + block["lines"]["end"])

    put("abstract", ast["abstract"])
    for p in ast["abstract"]["paragraphs"]:
        put("abstract", p)
    for c in ast["claims"]:
        put("claims", c)
    for b in ast["description"]:
        put("description", b)
    return out


def _find_quote(lines: list[str], quote: str, rng: tuple[int, int] | None) -> int | None:
    lo, hi = rng if rng else (1, len(lines))
    for no in range(max(lo, 1), min(hi, len(lines)) + 1):
        if quote in lines[no - 1]:
            return no
    return None


def _block_at(ranges: dict[str, tuple[int, int]], line: int) -> str | None:
    """包含该行的最小块（段落/权项优先于章节）。"""
    best = None
    for bid, (s, e) in ranges.items():
        if s <= line <= e and (best is None or (e - s) < (best[1] - best[0])):
            best = (s, e, bid)
    return best[2] if best else None


def reanchor(comments: list[Comment], ast: dict, content: str) -> list[Comment]:
    """先按 block_id 在块内搜 quote，再全文搜 quote；都失败保留 line 并标 stale（07 §4.2）。就地修改并返回。"""
    lines = content.split("\n")
    ranges = _block_ranges(ast)
    for c in comments:
        a = c.anchor
        if a.file is not None:
            continue
        rng = ranges.get(a.block_id)
        hit = None
        if a.quote:
            hit = _find_quote(lines, a.quote, rng) or _find_quote(lines, a.quote, None)
        if hit is not None:
            a.line = hit
            a.block_id = _block_at(ranges, hit) or a.block_id
            a.stale = False
        elif rng is not None:
            if not (rng[0] <= a.line <= rng[1]):
                a.line = rng[0]
            a.stale = bool(a.quote)
        else:
            a.stale = True
    return comments
