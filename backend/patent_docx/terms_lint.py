# -*- coding: utf-8 -*-
"""术语一致性 lint（docs/plan/09 §3.2 / §4，单元 E2-terms）。

lint_terms(content, terms) → 每个别名命中一条 warning：
  {"id": "terms.alias#<line>:<alias>", "severity": "warning", "source": "lint",
   "message": "「别名」是术语「主名」的别名，请统一为主名", "line": n, "section": "…",
   "fix": "改为「主名」", "replace": {"from": "别名", "to": "主名"}}
只扫描 critic.accept 后的源码（app.lint.lint 已处理），跳过代码块行与 $$ 公式行；最长匹配优先；
（…）内 ASCII 英文括注不扫描。terms 为空 ⇒ []（零漂移）。

scan_lines / iter_hits 是 lint 与 terms.unify 共用的扫描器：同一套跳过规则、同一套最长匹配，
unify 额外跳过既有 CriticMarkup 标记内部（lint 面对的是 accept 后的文本，天然没有标记）。
"""
import re
from collections.abc import Iterator
from dataclasses import dataclass

from .critic import TOKEN
from .docset import BOOK_HEADINGS

_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_FORMULA_LINE_RE = re.compile(r"^\s*\$\$")
_ASCII_PAREN_RE = re.compile(r"[（(][\x20-\x7e]*[)）]")
_BOOK_OF_LINE = {v: k for k, v in BOOK_HEADINGS.items()}


@dataclass(frozen=True)
class Hit:
    line: int
    col: int
    alias: str
    name: str
    section: str
    book: str | None


@dataclass(frozen=True)
class Line:
    """一行可扫描文本：line 1-based；section 为「## 书/### 节」；book 为 abstract/claims/description。"""
    line: int
    text: str
    section: str
    book: str | None


def scan_lines(content: str) -> Iterator[Line]:
    """逐行产出可扫描行：跳过 ``` 代码块与 $$ 公式行，同时跟踪章节。"""
    h2 = ""
    h3 = ""
    book = None
    in_fence = False
    fence = ""
    for no, raw in enumerate(content.split("\n"), 1):
        m = _FENCE_RE.match(raw)
        if m:
            if not in_fence:
                in_fence, fence = True, m.group(1)
            elif m.group(1) == fence:
                in_fence, fence = False, ""
            continue
        if in_fence or _FORMULA_LINE_RE.match(raw):
            continue
        s = raw.rstrip()
        if s.startswith("## ") and not s.startswith("### "):
            h2, h3 = s[3:].strip(), ""
            book = _BOOK_OF_LINE.get(s)
        elif s.startswith("### "):
            h3 = s[4:].strip()
        section = h2 + ("/" + h3 if h3 else "") if h2 else ""
        yield Line(no, raw, section, book)


def alias_map(terms: list[dict], names: list[str] | None = None) -> dict[str, str]:
    """别名 → 主名；names 限定只统一这些主名（None=全部）。"""
    out: dict[str, str] = {}
    want = set(names) if names is not None else None
    for t in terms:
        name = str(t.get("name", "")).strip()
        if not name or (want is not None and name not in want):
            continue
        for a in t.get("aliases") or []:
            a = str(a).strip()
            if a and a != name and a not in out:
                out[a] = name
    return out


def build_pattern(terms: list[dict], amap: dict[str, str]) -> re.Pattern | None:
    """所有主名 ∪ 待统一别名的最长优先交替式：主名命中不报，避免「预测模型」误伤「基础预测模型」。"""
    words = {str(t.get("name", "")).strip() for t in terms} | set(amap)
    words.discard("")
    if not amap:
        return None
    return re.compile("|".join(re.escape(w) for w in sorted(words, key=lambda w: (-len(w), w))))


def _masked(text: str) -> str:
    """把（…）内纯 ASCII 括注换成等长空格，位置不变。"""
    return _ASCII_PAREN_RE.sub(lambda m: " " * len(m.group(0)), text)


def iter_hits(content: str, terms: list[dict], names: list[str] | None = None,
              skip_marks: bool = False) -> Iterator[Hit]:
    amap = alias_map(terms, names)
    pat = build_pattern(terms, amap)
    if pat is None:
        return
    for ln in scan_lines(content):
        text = _masked(ln.text)
        if skip_marks:
            spans = [(m.start(), m.end()) for m in TOKEN.finditer(ln.text)]
        else:
            spans = []
        for m in pat.finditer(text):
            w = m.group(0)
            if w not in amap:
                continue
            if any(a <= m.start() < b for a, b in spans):
                continue
            yield Hit(ln.line, m.start(), w, amap[w], ln.section, ln.book)


def lint_terms(content: str, terms: list[dict]) -> list[dict]:
    if not terms:
        return []
    out: list[dict] = []
    seen: set[tuple[int, str]] = set()
    for h in iter_hits(content, terms):
        key = (h.line, h.alias)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "id": f"terms.alias#{h.line}:{h.alias}",
            "severity": "warning",
            "source": "lint",
            "message": f"「{h.alias}」是术语「{h.name}」的别名，请统一为主名",
            "line": h.line,
            "section": h.section,
            "fix": f"改为「{h.name}」",
            "replace": {"from": h.alias, "to": h.name},
        })
    return out
