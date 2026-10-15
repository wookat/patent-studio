# -*- coding: utf-8 -*-
"""术语表 <project>/terms.json（docs/plan/09 §3.2，单元 E2-terms）。

{"version": 1, "terms": [{"name", "aliases": [], "en", "definition", "first_line"}]}
prep：Term 形状 + load/save；E2：validate（重名 / alias==name ⇒ 422）、extract（确定性候选）、unify（CriticMarkup）。
"""

import json
import os
import re
from typing import TypedDict

from app import atomic
from patent_studio.kernel import critic, preflight
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.kernel.terms_lint import iter_hits, scan_lines

TERMS_FILE = "terms.json"
VERSION = 1

# ---- 确定性候选抽取 ----
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fa5A-Za-z]+")
_CJK_CHAR_RE = re.compile(r"[\u4e00-\u9fa5]")
# 切分名词短语的功能字：取 preflight 支持性匹配的口径，去掉常作名词首字的「在/含/用/各」，再加常见副词/连词
_CUT_CHARS = (set(preflight._TERM_CUT_CHARS) - set("在含用各")) | set("之以此这那若如但也又已仅只再更最很较都皆每另某")
_CUT_WORDS = (
    "所述",
    "包括",
    "包含",
    "其中",
    "根据",
    "通过",
    "利用",
    "采用",
    "基于",
    "以及",
    "或者",
    "并且",
    "具有",
    "设有",
    "设置",
    "用于",
    "在于",
    "在每",
    "也不",
    "包括了",
    "进行",
    "得到",
    "获得",
    "获取",
    "作为",
    "实现",
    "使得",
    "能够",
    "可以",
    "需要",
    "是否",
    "是指",
    "称为",
    "表示",
    "如图",
    "所示",
    "步骤",
    "优选",
    "进一步",
    "例如",
    "比如",
    "此时",
    "然后",
    "接着",
    "最后",
    "首先",
    "其次",
    "另外",
    "此外",
    "同时",
    "因此",
    "从而",
    "由于",
    "因为",
    "如果",
    "否则",
    "直到",
    "直至",
    "至少",
    "不再",
    "不会",
    "没有",
    "无需",
    "不同",
    "相同",
    "相应",
    "对应",
    "分别",
    "依次",
    "逐一",
    "一种",
    "一个",
    "多个",
    "若干",
    "任一",
    "任意",
    "全部",
    "部分",
    "上述",
    "下述",
    "如下",
    "以上",
    "以下",
)
_CUT_RE = re.compile("|".join(map(re.escape, _CUT_WORDS)) + "|[" + re.escape("".join(sorted(_CUT_CHARS))) + "]")
_STRIP_PREFIX = ("所述", "该", "本", "各", "其")
_STOP = {
    "本发明",
    "发明",
    "发明实施例",
    "申请",
    "本申请",
    "本实施例",
    "实施例",
    "发明内容",
    "技术领域",
    "背景技术",
    "附图说明",
    "具体实施方式",
    "技术方案",
    "技术效果",
    "有益效果",
    "现有技术",
    "权利要求",
    "权利要求书",
    "说明书",
    "摘要",
    "特征在于",
    "其特征在于",
    "特征",
    "实施方式",
    "以下步骤",
    "步骤一",
    "步骤二",
    "步骤三",
    "步骤四",
    "步骤五",
    "步骤六",
    "步骤七",
    "步骤八",
    "方法",
    "系统",
    "装置",
    "设备",
    "模块",
    "单元",
    "方式",
    "过程",
    "结果",
    "问题",
    "情况",
    "条件",
    "时候",
    "作用",
    "效果",
    "目的",
    "内容",
    "领域",
    "实施",
    "技术",
    "要求",
    "公开",
    "提供",
    "涉及",
    "存在",
    "输入",
    "输出",
    "数据",
    "参数",
    "数值",
    "信息",
    "处理",
    "计算",
    "更新",
    "生成",
    "确定",
    "判断",
    "控制",
    "当前",
    "预设",
    "预定",
    "对外",
    "在线",
    "离线",
    "实时",
    "完整",
    "有效",
    "正常",
    "异常",
    "自动",
    "手动",
}
_MIN_LEN, _MAX_LEN = 2, 12
_CLAIM_SUBJECT_RE = re.compile(r"^\s*\d+\s*[.\uff0e\u3001]\s*(?:一种|一个|一款)?(.+?)[\uff0c,\uff1a:\uff1b;]")
_REF_PREFIX_RE = re.compile(r"^(?:根据|如|按照)?权利要求")


class Term(TypedDict, total=False):
    name: str
    aliases: list[str]
    en: str | None
    definition: str | None
    first_line: int | None


class TermsError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def terms_path(project_dir: str) -> str:
    return os.path.join(project_dir, TERMS_FILE)


def load(project_dir: str) -> list[Term]:
    p = terms_path(project_dir)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            raw = json.load(f)
        terms = raw.get("terms", []) if isinstance(raw, dict) else raw
        return [normalize(t) for t in terms]
    except (ValueError, TypeError, AttributeError) as e:
        raise TermsError(f"terms.json 无法读取：{e}") from e


def save(project_dir: str, terms: list[Term]) -> list[Term]:
    terms = [normalize(t) for t in terms]
    atomic.write_json(terms_path(project_dir), {"version": VERSION, "terms": terms})
    return terms


def normalize(t: dict) -> Term:
    name = str(t.get("name", "")).strip()
    aliases = [str(a).strip() for a in (t.get("aliases") or []) if str(a).strip()]
    fl = t.get("first_line")
    return {
        "name": name,
        "aliases": aliases,
        "en": (str(t["en"]).strip() or None) if t.get("en") else None,
        "definition": (str(t["definition"]).strip() or None) if t.get("definition") else None,
        "first_line": int(fl) if fl is not None else None,
    }


def validate(terms: list[Term]) -> None:
    """name 非空且唯一；alias 非空、不得等于任何 name、不得同时归属两个术语。"""
    names: set[str] = set()
    for i, t in enumerate(terms, 1):
        name = t.get("name") or ""
        if not name:
            raise TermsError(f"第 {i} 条术语缺少主名")
        if name in names:
            raise TermsError(f"术语主名重复：「{name}」")
        names.add(name)
    owner: dict[str, str] = {}
    for t in terms:
        for a in t.get("aliases") or []:
            if a in names:
                raise TermsError(f"别名「{a}」与术语主名重名")
            if a in owner and owner[a] != t["name"]:
                raise TermsError(f"别名「{a}」同时属于「{owner[a]}」与「{t['name']}」")
            owner[a] = t["name"]


def count_lines(name: str, lines: list) -> tuple[int, list[int]]:
    hit_lines: list[int] = []
    count = 0
    for ln in lines:
        c = ln.text.count(name)
        if c:
            count += c
            hit_lines.append(ln.line)
    return count, hit_lines


def _phrases(text: str):
    """一行文本 → 名词短语片段（中文连续串按功能字/词切开，去前缀，长度 2–12 且含 ≥ 2 个汉字）。"""
    for run in _CJK_RUN_RE.findall(text):
        for seg in _CUT_RE.split(run):
            for p in _STRIP_PREFIX:
                if seg.startswith(p) and len(seg) > len(p):
                    seg = seg[len(p) :]
                    break
            if _MIN_LEN <= len(seg) <= _MAX_LEN and seg not in _STOP and len(_CJK_CHAR_RE.findall(seg)) >= _MIN_LEN:
                yield seg


def extract(content: str, settings: dict | None = None, min_count: int = 2, limit: int = 60) -> list[dict]:
    """确定性候选 → [{name, count, lines, source, aliases?}]，lines[0] 即首现行。

    freq：作为独立短语出现 ≥ min_count 次的中文名词短语（count = 独立出现次数，不计作为更长短语子串的出现）；
    claim：独立权利要求主题名（「1.一种 X，」）；
    figure-label：preflight 附图标记表（主名取图例名，否则取正文最长名称；其余名称作 aliases）。
    content 传入前请先 critic.accept；代码块与 $$ 行不参与统计。
    """
    lines = list(scan_lines(content))
    seen: dict[str, dict] = {}

    def add(name: str, source: str, aliases: list[str] | None = None, stat: tuple[int, list[int]] | None = None):
        if not name or name in seen or name in _STOP:
            return
        count, hit = stat or count_lines(name, lines)
        if not hit:
            return
        row = {"name": name, "count": count, "lines": hit, "source": source}
        if aliases:
            row["aliases"] = aliases
        seen[name] = row

    for ln in lines:
        if ln.book != "claims":
            continue
        m = _CLAIM_SUBJECT_RE.match(ln.text)
        if m and not _REF_PREFIX_RE.match(m.group(1)):
            add(m.group(1).strip(), "claim")

    try:
        rep = preflight.run(parse_ast(content, settings), settings)
    except AstError:
        rep = None
    if rep:
        for row in rep["numerals"]:
            names = [n for n in row["names"] if n and len(n) <= _MAX_LEN]
            main = row["legend"] or (max(names, key=lambda s: (len(s), s)) if names else None)
            if not main:
                continue
            others = sorted({n for n in names if n != main}, key=lambda s: (-len(s), s))
            add(main, "figure-label", others)

    freq: dict[str, tuple[int, list[int]]] = {}
    for ln in lines:
        for p in _phrases(ln.text):
            c, hit = freq.get(p, (0, []))
            if not hit or hit[-1] != ln.line:
                hit = hit + [ln.line]
            freq[p] = (c + 1, hit)
    for p, stat in sorted(freq.items(), key=lambda kv: (-kv[1][0], kv[1][1][0], kv[0])):
        if stat[0] >= min_count:
            add(p, "freq", stat=stat)

    order = {"claim": 0, "figure-label": 1, "freq": 2}
    out = sorted(seen.values(), key=lambda r: (order[r["source"]], -r["count"], r["lines"][0], r["name"]))
    return out[:limit]


def unify(
    content: str, terms: list[Term], names: list[str] | None = None, books: list[str] | None = None
) -> tuple[str, list[int]]:
    """别名 → {~~别名~>主名~~}（跳过已有标记 / 代码块 / $$ 行 / ASCII 括注）→ (critic_markdown, changed_lines)。

    只生成 CriticMarkup 建议，不落盘；未命中行逐字节不变，行数不变。critic.accept 后等于直接替换，
    critic.reject 后等于原文。
    """
    lines = content.split("\n")
    by_line: dict[int, list] = {}
    for h in iter_hits(content, terms, names, skip_marks=True):
        if books is not None and h.book not in books:
            continue
        by_line.setdefault(h.line, []).append(h)
    for no, hits in by_line.items():
        src = lines[no - 1]
        out = []
        pos = 0
        for h in sorted(hits, key=lambda h: h.col):
            out.append(src[pos : h.col])
            out.append("{~~" + h.alias + "~>" + h.name + "~~}")
            pos = h.col + len(h.alias)
        out.append(src[pos:])
        lines[no - 1] = "".join(out)
    return "\n".join(lines), sorted(by_line)


def unify_count(content: str, terms: list[Term], names: list[str] | None = None, books: list[str] | None = None) -> int:
    return sum(1 for h in iter_hits(content, terms, names, skip_marks=True) if books is None or h.book in books)


def accept(text: str) -> str:
    """extract/lint 面对的都是终稿文本；路由层统一在此 accept，避免各处重复。"""
    return critic.accept(text)
