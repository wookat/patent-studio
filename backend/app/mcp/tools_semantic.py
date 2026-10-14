# -*- coding: utf-8 -*-
"""W4-E E3 只读语义工具（docs/plan/17 §4.3–4.4；12-agency-workbench 附录 A）。

全部只读、viewer+、不新增存储：一次 `derive(store, pid)` 跑 routes_ast._parse + preflight.run + terms.load，
其余工具都是对这份派生结果的裁切：
  get_claim_tree(pid)               → list[ClaimNode]      claim_tree（扁平、children 为 int）嵌套化 + AST claims 原文
  get_support_map(pid)              → list[SupportRow]     preflight support_map 原样
  get_figures(pid)                  → list[FigureRow]      preflight figures × numerals：标记 lines 落在该图说明段者
                                                           归该图；没落到任何图的标记按标记表段（legend_line）提到的图归属
  get_terms(pid)                    → list[TermRow]        terms.json 术语 + support_map 里的权项术语，定义句取说明书
                                                           「[所述]X 是指/指/为/即 …」首现行，claims 取 support_map
  context_pack(pid, claim_id, max_chars=12000) → ContextPack
      claim_id 接受 int 权项号或 AST 权项 block id（claims/3）；未找到 ⇒ ToolError not_found。
      support = 本项 + 依赖链术语命中的说明书段落（段号 [00xx] = AST para_no；原文取 critic.accept 后的 final 行）；
      comments = 锚点行落在本项行区间、未 resolved 的批注；MCP 调用者都是项目成员或本机（分享链接匿名 viewer
      拿不到 PAT），所以按 routes_comments 规则全部可见。
preflight.run 必须带 settings / terms / figs（同 routes_preflight._report）：裸 run(ast) 会多出 figures.ref_missing
假阳性。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.domain import comments, terms
from app.mcp import schemas
from app.mcp.tools import _err, _settings, open_project_for, run_audited
from app.routes import ast as routes_ast
from patent_studio.kernel import critic, preflight

MAX_CHARS_CAP = 40000
_CLAIM_ID_RE = re.compile(r"^(?:claims/)?(\d+)$")
_DEF_HEAD = r"(?:^|[，。；：,;:])\s*(?:所述|该|本)?"  # 句首/分句首才算定义句：「以 X 为参照」不是
_DEF_TAIL = r"(?:是指|指的是|指|为|即|，即|是)"


@dataclass
class Derived:
    pid: str
    dir: str
    ast: dict
    report: dict
    glossary: list[dict]
    lines: list[str]  # final 文本，index = 全文行号 - 1

    def line(self, n: int) -> str:
        return self.lines[n - 1] if 1 <= n <= len(self.lines) else ""


def derive(store, pid: str) -> Derived:
    p = store.get(pid)
    content = store.read_content(pid)
    ast = routes_ast._parse(store, pid, content, None)
    glossary = terms.load(p.dir)
    report = preflight.run(
        ast, _settings(store, p), glossary, figs=store.list_figs(p.dir), figures=store.load_figures(p.dir)
    )
    return Derived(
        pid=pid, dir=p.dir, ast=ast, report=report, glossary=glossary, lines=critic.accept(content).split("\n")
    )


# ---------------------------------------------------------------- 权利要求树 ----


def _claim_text(block: dict) -> str:
    return "\n".join(s["text"] for s in block["segments"] if s.get("text"))


def _claim_range(d: Derived, block: dict) -> tuple[int, int]:
    off = d.ast["books"]["claims"]["offset"]
    return off + block["lines"]["start"], off + block["lines"]["end"]


def _nodes(d: Derived) -> dict[int, schemas.ClaimNode]:
    """claim_tree 行 → ClaimNode；issues 取 items 里同 block_id 的完整诊断（claim_tree 只有规则名）。"""
    text = {c["num"]: _claim_text(c) for c in d.ast["claims"]}
    issues: dict[str, list[dict]] = {}
    for it in d.report["items"]:
        if it["book"] == "claims" and it.get("block_id"):
            issues.setdefault(it["block_id"], []).append(it)
    return {
        row["num"]: schemas.ClaimNode(
            num=row["num"],
            kind=row["kind"],
            category=row["category"],
            refs=row["refs"],
            line=row["line"],
            text=text.get(row["num"], ""),
            issues=issues.get(f"claims/{row['num']}", []),
            children=[],
        )
        for row in d.report["claim_tree"]
    }


def claim_tree(d: Derived) -> list[schemas.ClaimNode]:
    """独立项为根；从属项挂在其最小引用项下（多引用「权 2–6 任一」只挂一处，refs 保留全部）。"""
    nodes = _nodes(d)
    roots: list[schemas.ClaimNode] = []
    for node in nodes.values():
        parents = [r for r in node.refs if r in nodes and r != node.num]
        if node.kind == "independent" or not parents:
            roots.append(node)
        else:
            nodes[min(parents)].children.append(node)
    return roots


def _chain(nodes: dict[int, schemas.ClaimNode], num: int) -> list[schemas.ClaimNode]:
    """独立项 → … → 直接引用项（不含本项）；多引用取最小号，并在该节点 issues 标 alternative。"""
    out: list[schemas.ClaimNode] = []
    seen = {num}
    cur = nodes[num]
    while True:
        parents = [r for r in cur.refs if r in nodes and r not in seen]
        if not parents:
            break
        parent = min(parents)
        node = nodes[parent].model_copy(update={"children": []})
        if len(cur.refs) > 1:
            node.issues = [
                *node.issues,
                {
                    "rule": "chain.alternative",
                    "severity": "info",
                    "message": f"权利要求 {cur.num} 引用多项 {cur.refs}，依赖链取最小号 {parent}",
                    "book": "claims",
                    "line": cur.line,
                    "block_id": f"claims/{cur.num}",
                    "detail": ",".join(map(str, cur.refs)),
                },
            ]
        out.append(node)
        seen.add(parent)
        cur = nodes[parent]
    out.reverse()
    return out


# ---------------------------------------------------------------- 支持性 / 附图 / 术语 ----


def support_map(d: Derived) -> list[schemas.SupportRow]:
    return [schemas.SupportRow(**row) for row in d.report["support_map"]]


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


def figures(d: Derived) -> list[schemas.FigureRow]:
    caption = {f["num"]: f.get("caption") or f.get("alt") or "" for f in d.ast.get("figures", [])}
    rows: list[schemas.FigureRow] = []
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
            schemas.FigureRow(
                num=f["num"],
                file=f["file"],
                caption=caption.get(f["num"], ""),
                caption_line=f["caption_line"],
                refs=sorted(lines),
                markers=markers,
            )
        )
    for n in d.report["numerals"]:
        if n["num"] in placed or n.get("legend_line") is None:
            continue
        for row in rows:
            if n["legend_line"] in fig_lines[row.num]:
                row.markers.append(_marker(n))
    for row in rows:
        row.markers.sort(key=lambda m: (len(m["num"]), m["num"]))
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


def term_rows(d: Derived) -> list[schemas.TermRow]:
    claims_of = {row["term"]: row["claims"] for row in d.report["support_map"]}
    rows: list[schemas.TermRow] = []
    seen: set[str] = set()
    for t in d.glossary:
        definition, line = t.get("definition") or "", t.get("first_line")
        if not definition:
            definition, line = _definition(d, t["name"])
        rows.append(
            schemas.TermRow(
                name=t["name"],
                aliases=list(t.get("aliases") or []),
                definition=definition,
                definition_line=line,
                claims=claims_of.get(t["name"], []),
            )
        )
        seen.add(t["name"])
        seen.update(t.get("aliases") or [])
    for term, nums in claims_of.items():
        if term in seen:
            continue
        definition, line = _definition(d, term)
        rows.append(schemas.TermRow(name=term, aliases=[], definition=definition, definition_line=line, claims=nums))
    return rows


# ---------------------------------------------------------------- context_pack ----


def _resolve_claim(d: Derived, claim_id: str) -> int:
    m = _CLAIM_ID_RE.match(str(claim_id).strip())
    nums = {row["num"] for row in d.report["claim_tree"]}
    if not m or int(m.group(1)) not in nums:
        raise _err("not_found", f"权利要求不存在：{claim_id}", detail=str(claim_id))
    return int(m.group(1))


def context_pack(d: Derived, claim_id: str, max_chars: int = 12000) -> schemas.ContextPack:
    num = _resolve_claim(d, claim_id)
    nodes = _nodes(d)
    claim = nodes[num]
    chain = _chain(nodes, num)
    scope = {num, *(c.num for c in chain)}
    block = next(c for c in d.ast["claims"] if c["num"] == num)
    c_start, c_end = _claim_range(d, block)

    # 主题名称（方法 / 系统…）几乎命中每一段，不是支持信号；术语 = 依赖链内权项的其余术语
    subjects = {n.category for n in nodes.values()}
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

    fig_nums = set(re.findall(r"图\s*(\d+)", claim.text))
    fig_rows = []
    for f in figures(d):
        if (
            str(f.num) in fig_nums
            or set(f.refs) & support_lines
            or any(re.search(r"(?<!\d)" + re.escape(m["num"]) + r"(?!\d)", claim.text) for m in f.markers)
        ):
            fig_rows.append(f)

    term_list = [t for t in term_rows(d) if scope & set(t.claims)]

    pack_comments = []
    for c in comments.load(d.dir):
        if c.resolved:
            continue
        if c.anchor.block_id == block["id"] or c_start <= c.anchor.line <= c_end:
            pack_comments.append(
                {
                    "id": c.id,
                    "book": "claims",
                    "line": c.anchor.line,
                    "quote": c.anchor.quote,
                    "text": c.body,
                    "author": c.author.name,
                    "created_at": c.created_at,
                }
            )

    issue_lines = set(range(c_start, c_end + 1)) | support_lines
    issues = [it for it in d.report["items"] if it.get("block_id") == block["id"] or (it.get("line") in issue_lines)]

    pack = schemas.ContextPack(
        pid=d.pid,
        claim=claim.model_copy(update={"children": []}),
        chain=chain,
        support=support,
        figures=fig_rows,
        terms=term_list,
        comments=pack_comments,
        issues=issues,
    )
    return _truncate(pack, max(1, min(max_chars, MAX_CHARS_CAP)))


def _truncate(pack: schemas.ContextPack, max_chars: int) -> schemas.ContextPack:
    """序列化超长时按 support（先丢命中术语最少的段）→ terms → comments 依次截尾；claim / chain 不动。"""

    def size() -> int:
        return len(pack.model_dump_json())

    if size() <= max_chars:
        return pack
    pack.truncated = True
    by_hits = sorted(pack.support, key=lambda s: (len(s["terms"]), -s["line"]))
    while by_hits and size() > max_chars:
        dropped = by_hits.pop(0)
        pack.support = [s for s in pack.support if s is not dropped]
    while pack.terms and size() > max_chars:
        pack.terms.pop()
    while pack.comments and size() > max_chars:
        pack.comments.pop()
    return pack


def register(server, store):
    @server.tool(name="get_claim_tree")
    async def get_claim_tree_tool(pid: str) -> list[schemas.ClaimNode]:
        """权利要求树：独立项 → 从属项，含每项原文、引用、类别与体检问题。理解权项前先看这个。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_claim_tree", {}, lambda: claim_tree(derive(store, pid)))

    @server.tool(name="get_support_map")
    async def get_support_map_tool(pid: str) -> list[schemas.SupportRow]:
        """权项术语 → 说明书支持行：哪些术语在说明书找不到（supported=false）。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_support_map", {}, lambda: support_map(derive(store, pid)))

    @server.tool(name="get_figures")
    async def get_figures_tool(pid: str) -> list[schemas.FigureRow]:
        """附图标记表：每张图的图号、文件、说明行、被引用行，以及图中附图标记与名称是否一致。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_figures", {}, lambda: figures(derive(store, pid)))

    @server.tool(name="get_terms")
    async def get_terms_tool(pid: str) -> list[schemas.TermRow]:
        """术语库：术语、别名、定义句（说明书行号）、出现在哪些权项。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_terms", {}, lambda: term_rows(derive(store, pid)))

    @server.tool(name="context_pack")
    async def context_pack_tool(pid: str, claim_id: str, max_chars: int = 12000) -> schemas.ContextPack:
        """一条权项的完整上下文：正文 + 依赖链 + 支持段落（段号+原文）+ 涉及附图与标记 + 术语定义 + 未决批注。
        给建议前先调它，不要靠 read_book 全文自己找。"""
        await open_project_for(store, pid)
        return await run_audited(
            store,
            pid,
            "context_pack",
            {"claim_id": claim_id, "max_chars": max_chars},
            lambda: context_pack(derive(store, pid), claim_id, max_chars),
            result_of=lambda r: "ok:truncated" if r.truncated else "ok",
        )
