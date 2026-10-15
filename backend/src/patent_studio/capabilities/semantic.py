"""旧 ``app/mcp/tools_semantic.py`` 只读语义工具的平台化移植（B14）。

真源差异如实标注：旧侧的 terms.json 术语台账与批注（comments）未迁移到新域，
因此 glossary=[]、context_pack 的 comments=[]；其余推导（claim_tree /
support_map / figures / terms / context_pack）与旧实现同构，输入改为
``Derived``（三书 current revisions 组装 → parse_ast → preflight.run）。
行号约定同旧侧：ast.books[book].offset + 块相对行 = 全文 1-based 行号。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

MAX_CHARS_CAP = 40000
_CLAIM_ID_RE = re.compile(r"^(?:claims/)?(\d+)$")
_DEF_HEAD = r"(?:^|[，。；：,;:])\s*(?:所述|该|本)?"  # 句首/分句首才算定义句：「以 X 为参照」不是
_DEF_TAIL = r"(?:是指|指的是|指|为|即|，即|是)"


@dataclass
class Derived:
    """一次派生：AST + preflight 报告 + final 文本行（index = 全文行号 - 1）。"""

    ast: dict
    report: dict
    lines: list[str]
    glossary: list[dict] = field(default_factory=list)  # 术语台账未迁移：恒为空

    def line(self, n: int) -> str:
        return self.lines[n - 1] if 1 <= n <= len(self.lines) else ""


# ---------------------------------------------------------------- 权利要求树 ----


def _claim_text(block: dict) -> str:
    return "\n".join(s["text"] for s in block["segments"] if s.get("text"))


def _claim_range(d: Derived, block: dict) -> tuple[int, int]:
    off = d.ast["books"]["claims"]["offset"]
    return off + block["lines"]["start"], off + block["lines"]["end"]


def _nodes(d: Derived) -> dict[int, dict]:
    """claim_tree 行 → 节点 dict；issues 取 items 里同 block_id 的完整诊断。"""
    text = {c["num"]: _claim_text(c) for c in d.ast["claims"]}
    issues: dict[str, list[dict]] = {}
    for it in d.report["items"]:
        if it["book"] == "claims" and it.get("block_id"):
            issues.setdefault(it["block_id"], []).append(it)
    return {
        row["num"]: {
            "num": row["num"],
            "kind": row["kind"],
            "category": row["category"],
            "refs": row["refs"],
            "line": row["line"],
            "text": text.get(row["num"], ""),
            "issues": issues.get(f"claims/{row['num']}", []),
            "children": [],
        }
        for row in d.report["claim_tree"]
    }


def claim_tree(d: Derived) -> list[dict]:
    """独立项为根；从属项挂在其最小引用项下（多引用「权 2–6 任一」只挂一处，refs 保留全部）。"""
    nodes = _nodes(d)
    roots: list[dict] = []
    for node in nodes.values():
        parents = [r for r in node["refs"] if r in nodes and r != node["num"]]
        if node["kind"] == "independent" or not parents:
            roots.append(node)
        else:
            nodes[min(parents)]["children"].append(node)
    return roots


def _chain(nodes: dict[int, dict], num: int) -> list[dict]:
    """独立项 → … → 直接引用项（不含本项）；多引用取最小号，并在该节点 issues 标 alternative。"""
    out: list[dict] = []
    seen = {num}
    cur = nodes[num]
    while True:
        parents = [r for r in cur["refs"] if r in nodes and r not in seen]
        if not parents:
            break
        parent = min(parents)
        node = {**nodes[parent], "children": []}
        if len(cur["refs"]) > 1:
            node["issues"] = [
                *node["issues"],
                {
                    "rule": "chain.alternative",
                    "severity": "info",
                    "message": f"权利要求 {cur['num']} 引用多项 {cur['refs']}，依赖链取最小号 {parent}",
                    "book": "claims",
                    "line": cur["line"],
                    "block_id": f"claims/{cur['num']}",
                    "detail": ",".join(map(str, cur["refs"])),
                },
            ]
        out.append(node)
        seen.add(parent)
        cur = nodes[parent]
    out.reverse()
    return out


# ---------------------------------------------------------------- 支持性 / 附图 / 术语 ----


def support_map(d: Derived) -> list[dict]:
    return [dict(row) for row in d.report["support_map"]]


def _paragraphs(d: Derived) -> list[dict]:
    """说明书段落：{para_no, line(全文), text(final), id}，按行号。"""
    off = d.ast["books"]["description"]["offset"]
    return [
        {
            "id": b["id"],
            "para_no": b["para_no"],
            "line": off + b["lines"]["start"],
            "end": off + b["lines"]["end"],
            "text": d.line(off + b["lines"]["start"]),
        }
        for b in d.ast["description"]
        if b["kind"] == "paragraph"
    ]


def figures(d: Derived) -> list[dict]:
    caption = {f["num"]: f.get("caption") or f.get("alt") or "" for f in d.ast.get("figures", [])}
    rows: list[dict] = []
    placed: set[str] = set()
    fig_lines: dict[int, set[int]] = {}
    for f in d.report["figures"]:
        lines = {r["line"] for r in f["refs"]}
        fig_lines[f["num"]] = lines
        markers = []
        for n in d.report["numerals"]:
            if lines & set(n["lines"]):
                markers.append(_marker(n))
                placed.add(n["num"])
        rows.append(
            {
                "num": f["num"],
                "file": f["file"],
                "caption": caption.get(f["num"], ""),
                "caption_line": f["caption_line"],
                "refs": sorted(lines),
                "markers": markers,
            }
        )
    for n in d.report["numerals"]:
        if n["num"] in placed or n.get("legend_line") is None:
            continue
        for row in rows:
            if n["legend_line"] in fig_lines[row["num"]]:
                row["markers"].append(_marker(n))
    for row in rows:
        row["markers"].sort(key=lambda m: (len(m["num"]), m["num"]))
    return rows


def _marker(n: dict) -> dict:
    return {
        "num": n["num"],
        "legend": n["legend"],
        "names": n["names"],
        "lines": n["lines"],
        "consistent": n["consistent"],
    }


def _definition(d: Derived, name: str) -> tuple[str, int | None]:
    pat = re.compile(_DEF_HEAD + "(" + re.escape(name) + _DEF_TAIL + ")")
    candidates = [(p["text"], p["line"]) for p in _paragraphs(d)]
    candidates += [(_claim_text(c), _claim_range(d, c)[0]) for c in d.ast["claims"]]
    for text, line in candidates:
        m = pat.search(text)
        if m:
            tail = text[m.start(1) :]
            end = re.search(r"[。；;]", tail)
            return tail[: end.end()] if end else tail, line
    return "", None


def term_rows(d: Derived) -> list[dict]:
    claims_of = {row["term"]: row["claims"] for row in d.report["support_map"]}
    rows: list[dict] = []
    seen: set[str] = set()
    for t in d.glossary:
        definition, line = t.get("definition") or "", t.get("first_line")
        if not definition:
            definition, line = _definition(d, t["name"])
        rows.append(
            {
                "name": t["name"],
                "aliases": list(t.get("aliases") or []),
                "definition": definition,
                "definition_line": line,
                "claims": claims_of.get(t["name"], []),
            }
        )
        seen.add(t["name"])
        seen.update(t.get("aliases") or [])
    for term, nums in claims_of.items():
        if term in seen:
            continue
        definition, line = _definition(d, term)
        rows.append({"name": term, "aliases": [], "definition": definition, "definition_line": line, "claims": nums})
    return rows


# ---------------------------------------------------------------- context_pack ----


def _resolve_claim(d: Derived, claim_id: str) -> int:
    from patent_studio.capabilities.registry import CapabilityError

    m = _CLAIM_ID_RE.match(str(claim_id).strip())
    nums = {row["num"] for row in d.report["claim_tree"]}
    if not m or int(m.group(1)) not in nums:
        raise CapabilityError(f"claim does not exist: {claim_id!r}")
    return int(m.group(1))


def context_pack(d: Derived, claim_id: str, max_chars: int = 12000) -> dict:
    num = _resolve_claim(d, claim_id)
    nodes = _nodes(d)
    claim = nodes[num]
    chain = _chain(nodes, num)
    scope = {num, *(c["num"] for c in chain)}
    block = next(c for c in d.ast["claims"] if c["num"] == num)
    c_start, c_end = _claim_range(d, block)

    # 主题名称（方法 / 系统…）几乎命中每一段，不是支持信号；术语 = 依赖链内权项的其余术语
    subjects = {n["category"] for n in nodes.values()}
    hit_terms: dict[int, list[str]] = {}
    for row in d.report["support_map"]:
        if row["term"] not in subjects and scope & set(row["claims"]):
            for ln in row["description_lines"]:
                hit_terms.setdefault(ln, []).append(row["term"])
    support = []
    for p in _paragraphs(d):
        lines = range(p["line"], p["end"] + 1)
        hits = sorted({t for ln in lines for t in hit_terms.get(ln, [])})
        if hits:
            support.append({"para_no": f"[{p['para_no']:04d}]", "line": p["line"], "text": p["text"], "terms": hits})
    support_lines = {s["line"] for s in support}

    fig_nums = set(re.findall(r"图\s*(\d+)", claim["text"]))
    fig_rows = []
    for f in figures(d):
        if (
            str(f["num"]) in fig_nums
            or set(f["refs"]) & support_lines
            or any(re.search(r"(?<!\d)" + re.escape(m["num"]) + r"(?!\d)", claim["text"]) for m in f["markers"])
        ):
            fig_rows.append(f)

    term_list = [t for t in term_rows(d) if scope & set(t["claims"])]

    # 批注域未迁移：comments 恒为空（旧侧语义 = 未 resolved 且锚在本项行区间）。
    pack_comments: list[dict] = []

    issue_lines = set(range(c_start, c_end + 1)) | support_lines
    issues = [it for it in d.report["items"] if it.get("block_id") == block["id"] or (it.get("line") in issue_lines)]

    pack = {
        "claim": {**claim, "children": []},
        "chain": chain,
        "support": support,
        "figures": fig_rows,
        "terms": term_list,
        "comments": pack_comments,
        "issues": issues,
        "truncated": False,
    }
    return _truncate(pack, max(1, min(max_chars, MAX_CHARS_CAP)))


def _truncate(pack: dict, max_chars: int) -> dict:
    """序列化超长时按 support（先丢命中术语最少的段）→ terms → comments 依次截尾；claim / chain 不动。"""
    import json

    def size() -> int:
        return len(json.dumps(pack, ensure_ascii=False))

    if size() <= max_chars:
        return pack
    pack["truncated"] = True
    by_hits = sorted(pack["support"], key=lambda s: (len(s["terms"]), -s["line"]))
    while by_hits and size() > max_chars:
        dropped = by_hits.pop(0)
        pack["support"] = [s for s in pack["support"] if s is not dropped]
    while pack["terms"] and size() > max_chars:
        pack["terms"].pop()
    while pack["comments"] and size() > max_chars:
        pack["comments"].pop()
    return pack


def semantic_bundle(d: Derived) -> dict[str, Any]:
    """agent.case.semantic 输出：四张结构图一次派生（与旧 4 工具一一对应）。"""
    return {
        "claim_tree": claim_tree(d),
        "support_map": support_map(d),
        "figures": figures(d),
        "terms": term_rows(d),
    }
