# -*- coding: utf-8 -*-
"""content.md → 块 AST（docs/plan/04-r1-design.md §3；契约 ast_schema.json v1）。

后端唯一权威解析器：逐行状态机与 content.parse_md 语义逐字相同（tests/test_ast.py 以两案与边界用例
断言派生 spec == parse_md(text)[3]），在此之上附加源码行区间；说明书段号一律取自 numbering.number_spec
（builder.py 同一函数），不复制编号逻辑。

坐标：Lines 为书内相对行（1 起、闭区间），全文行 = books[book].offset + 相对行；
books[book].offset = 该书 `## 标题` 所在全文行；title.line 为全文行。

行内格式（W9）：paragraph / section / subsection / claim text segment 节点带 `inline: [{text, marks}]`
（inline.inline_spans，marks ⊆ {b,i,u,sub,sup}，sub_except 取 settings.sub_except）；
`text` / `title` 字段仍是原始 Markdown。
"""

import json
import os
import re

from .builder import DEFAULT_SUB_EXCEPT
from .cnipa_xml import SECTION_ELEMENTS  # 法定五节名 → DescriptionPart 枚举，与五书 XML 同源
from .content import INLINE_FIG_RE, is_table_separator, parse_table_opts
from .inline import inline_spans
from .numbering import number_spec
from .omml import to_mathml

AST_VERSION = 1
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ast_schema.json")

BOOK_OF_HEADING = {"摘要": "abstract", "权利要求书": "claims", "说明书": "description"}

_NUM_RE = re.compile(r"\s*(\d+)")
_DEPENDENT_RE = re.compile(r"\s*\d+\s*[.、．]?\s*(?:根据|如|按照|依据|依照)?权利要求")
_CATEGORY_INDEP_RE = re.compile(r"一种(.+?)[，,]")
_CATEGORY_DEP_RE = re.compile(r"所述的?(.+?)[，,]")
_REF_RE = re.compile(
    r"权利要求\s*(\d+)"
    r"((?:\s*(?:至|到|-|~|～|—)\s*\d+)?(?:\s*(?:或|和|及|、|与)\s*\d+)*)"
    r"((?:中的?)?任[一意](?:一项|项)?)?"
)
_REF_RANGE_RE = re.compile(r"(?:至|到|-|~|～|—)\s*(\d+)")
_REF_LIST_RE = re.compile(r"(或|和|及|、|与)\s*(\d+)")
_CHARACT_RE = re.compile(r"其特征在于[，,：:]?")
# 说明书附图说明「图N为…」题注；figures_md.captions_of / preflight figures.alt_mismatch 同用这一份
FIGURE_CAPTION_RE = re.compile(r"^图(\d+)[为是](.+?)[；。;]?$")
_FIGURE_CAPTION_RE = FIGURE_CAPTION_RE
_TABLE_CAPTION_RE = re.compile(r"^表\d+")


class AstError(Exception):
    """content.md 结构不成立，无法给出 AST（路由层 → 422 {kind,message,line,detail}）。"""

    def __init__(self, message, line=None):
        super().__init__(message)
        self.line = line


def load_schema():
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _lines(start, end):
    return {"start": start, "end": max(start, end)}


# ---------------- 权利要求 ----------------


def _claim_refs(segments):
    refs = []
    for si, seg in enumerate(segments):
        if seg["kind"] != "text":
            continue
        for m in _REF_RE.finditer(seg["text"]):
            first = int(m.group(1))
            targets = [first]
            alternative = bool(m.group(3))
            rest = m.group(2)
            rm = _REF_RANGE_RE.match(rest.strip()) if rest else None
            if rm:
                last = int(rm.group(1))
                targets = list(range(first, last + 1)) if last >= first else [first, last]
            for lm in _REF_LIST_RE.finditer(rest):
                targets.append(int(lm.group(2)))
                if lm.group(1) == "或":
                    alternative = True
            refs.append(
                {
                    "text": m.group(0),
                    "targets": targets,
                    "alternative": alternative,
                    "seg": si,
                    "start": m.start(),
                    "end": m.end(),
                }
            )
    return refs


def _claim_charact(segments):
    for si, seg in enumerate(segments):
        if seg["kind"] != "text":
            continue
        m = _CHARACT_RE.search(seg["text"])
        if m:
            return {"seg": si, "offset": m.end()}
    return None


def _claim(num, block, sub_except=DEFAULT_SUB_EXCEPT):
    """block: [(rel_line, raw_line)]，与 parse_md 的空行分块一致。"""
    cid = "claims/%d" % num
    segments = []
    for k, (ln_no, ln) in enumerate(block):
        seg = {"id": "%s/seg/%d" % (cid, k), "line": ln_no}
        if ln.startswith("$$") and ln.rstrip().endswith("$$"):
            seg.update(kind="equation", text=ln.rstrip()[2:-2], mathml=to_mathml(ln.rstrip()[2:-2]))
        else:
            seg.update(kind="text", text=ln, mathml=None, inline=inline_spans(ln, sub_except))
        segments.append(seg)
    head = block[0][1]
    nm = _NUM_RE.match(head)
    num_written = nm.group(1) if nm else None
    dependent = bool(_DEPENDENT_RE.match(head))
    cm = (_CATEGORY_DEP_RE if dependent else _CATEGORY_INDEP_RE).search(head)
    return {
        "id": cid,
        "kind": "claim",
        "lines": _lines(block[0][0], block[-1][0]),
        "num": num,
        "num_written": num_written,
        "claim_kind": "dependent" if dependent else "independent",
        "category": cm.group(1) if cm else None,
        "refs": _claim_refs(segments),
        "charact": _claim_charact(segments),
        "segments": segments,
    }


# ---------------- 说明书 ----------------


def _walk_description(lines):
    """与 parse_md 说明书分支逐字相同的状态机，额外记录每个 spec 项的行区间。
    返回 [[spec_item, start, end]]；spec_item 形状即 content.parse_md 的 spec 元素（段落为纯字符串）。
    表格区间覆盖紧邻其前的选项注释行、全部表格行（含 --- 分隔行）与表注行。
    """
    items = []
    rows, rows_start, rows_end = [], None, None
    topts, topts_line, topts_at = {}, None, -1
    in_code, code_lines, code_start = False, [], None

    def flush_table():
        nonlocal rows, topts
        if rows:
            start = topts_line if topts_at == len(items) else rows_start
            items.append([("t", rows, topts), start, rows_end])
            rows, topts = [], {}

    for no, ln in lines:
        if ln.strip().startswith("```"):
            if in_code:
                items.append([("c", code_lines), code_start, no])
                code_lines = []
            else:
                flush_table()
                code_start = no
            in_code = not in_code
            continue
        if in_code:
            code_lines.append(ln)
            continue
        if not ln.strip():
            flush_table()
            continue
        s = ln.strip()
        if s.startswith("<!--") and s.endswith("-->") and "表格" in s:
            topts, topts_line, topts_at = parse_table_opts(s[4:-3]), no, len(items)
            continue
        if s.startswith("注："):
            flush_table()
            if items and isinstance(items[-1][0], tuple) and items[-1][0][0] == "t" and "表注" not in items[-1][0][2]:
                items[-1][0][2]["表注"] = s
                items[-1][2] = no
                continue
        if ln.lstrip().startswith("|"):
            if not rows:
                rows_start = no
            rows_end = no
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if not is_table_separator(cells):
                rows.append(cells)
            continue
        flush_table()
        if ln.startswith("#### "):
            items.append([("s", ln[5:].strip()), no, no])
        elif ln.startswith("### "):
            items.append([("h", ln[4:].strip()), no, no])
        elif ln.startswith("$$"):
            body = ln[2:]
            if "$$" not in body:
                raise AstError("公式行缺少结尾 $$", no)
            formula, rest = body.rsplit("$$", 1)
            items.append([("e", formula, rest.strip()), no, no])
        elif m := INLINE_FIG_RE.match(s):
            items.append([("f", m.group("file"), float(m.group("width") or 15), m.group("alt").strip()), no, no])
        else:
            items.append([ln, no, no])
    flush_table()
    return items


class _Ids:
    def __init__(self):
        self.seen = set()

    def unique(self, base):
        cid, k = base, 1
        while cid in self.seen:
            k += 1
            cid = "%s#%d" % (base, k)
        self.seen.add(cid)
        return cid


def _description_blocks(lines, sub_except=DEFAULT_SUB_EXCEPT):
    walked = _walk_description(lines)
    spec = [it for it, _a, _b in walked]
    nums = number_spec(spec)
    ids = _Ids()
    blocks = []
    path, part = "description", "other"
    section_path = None
    eq_no = 0
    last_no = None
    for i, (it, start, end) in enumerate(walked):
        kind = it[0] if isinstance(it, tuple) else "p"
        n = nums[i]
        if kind == "h":
            part = SECTION_ELEMENTS.get(it[1], "other")
            section_path = ids.unique("description/%s" % it[1])
            path, eq_no = section_path, 0
            blocks.append(
                {
                    "id": path,
                    "kind": "section",
                    "lines": _lines(start, end),
                    "title": it[1],
                    "part": part,
                    "inline": inline_spans(it[1], sub_except),
                }
            )
        elif kind == "s":
            path = ids.unique("%s/%s" % (section_path or "description", it[1]))
            eq_no = 0
            blocks.append(
                {
                    "id": path,
                    "kind": "subsection",
                    "lines": _lines(start, end),
                    "title": it[1],
                    "part": part,
                    "inline": inline_spans(it[1], sub_except),
                }
            )
        elif kind == "p":
            nxt = spec[i + 1] if i + 1 < len(spec) else None
            caption = isinstance(nxt, tuple) and nxt[0] == "t" and _TABLE_CAPTION_RE.match(it.strip())
            blocks.append(
                {
                    "id": ids.unique("%s/p%04d" % (path, n.para_no)),
                    "kind": "paragraph",
                    "lines": _lines(start, end),
                    "text": it,
                    "para_no": n.para_no,
                    "role": "table-caption" if caption else "body",
                    "inline": inline_spans(it, sub_except),
                }
            )
            last_no = n.para_no
        elif kind == "e":
            eq_no += 1
            blocks.append(
                {
                    "id": ids.unique("%s/eq%d" % (path, eq_no)),
                    "kind": "equation",
                    "lines": _lines(start, end),
                    "source": it[1],
                    "label": it[2] or None,
                    "mathml": to_mathml(it[1]),
                    "anchor_para_no": last_no,
                }
            )
        elif kind == "t":
            rows, topts = it[1], it[2]
            widths = topts.get("列宽")
            blocks.append(
                {
                    "id": ids.unique("%s/p%04d" % (path, n.para_no)),
                    "kind": "table",
                    "lines": _lines(start, end),
                    "para_no": n.para_no,
                    "rows": rows,
                    "options": {
                        "three_line": bool(topts.get("三线")),
                        "repeat_header": bool(topts.get("重复表头")),
                        "num_left": bool(topts.get("段号居左")),
                        "col_widths": [float(w) for w in widths] if widths else None,
                    },
                    "caption_after": (
                        {"text": topts["表题后置"], "para_no": n.caption_after_no}
                        if n.caption_after_no is not None
                        else None
                    ),
                    "note": {"text": topts["表注"], "para_no": n.note_no} if n.note_no is not None else None,
                }
            )
            last_no = max(x for x in (n.para_no, n.caption_after_no, n.note_no) if x is not None)
        elif kind == "c":
            blocks.append(
                {
                    "id": ids.unique("%s/p%04d" % (path, n.para_no)),
                    "kind": "code",
                    "lines": _lines(start, end),
                    "code_lines": it[1],
                    "para_no": n.para_no,
                }
            )
            last_no = n.para_no
        elif kind == "f":
            blocks.append(
                {
                    "id": ids.unique("%s/fig%d" % (path, n.para_no)),
                    "kind": "figure",
                    "lines": _lines(start, end),
                    "file": it[1],
                    "width": it[2],
                    "alt": it[3],
                    "para_no": n.para_no,
                }
            )
            last_no = n.para_no
    return blocks


def _figures(blocks, settings, doc=None):
    """figures[]（book=figures）。图序 / file / width / alt 来自 docs/figures.md（figures_md.FiguresDoc）；
    没给 doc 时退到 settings.spec_figures（旧 studio.json 形状 / 测试 fixture），alt=None。
    caption 始终取自说明书「图N为…」，alt 只做显示与体检（figures.alt_mismatch）。"""
    if doc is not None:
        spec_figures = [(f.file, f.width, f.alt) for f in doc.spec]
    else:
        spec_figures = [(f, w, None) for f, w in ((settings or {}).get("spec_figures") or [])]
    captions = {}
    in_drawings = False
    for b in blocks:
        if b["kind"] == "section":
            in_drawings = b["part"] == "description-of-drawings"
        elif in_drawings and b["kind"] == "paragraph":
            m = _FIGURE_CAPTION_RE.match(b["text"].strip())
            if m and int(m.group(1)) not in captions:
                captions[int(m.group(1))] = (m.group(2), b["lines"]["start"])
    figures = []
    for k, (file, width, alt) in enumerate(spec_figures, 1):
        cap = captions.get(k)
        figures.append(
            {
                "id": "figures/%d" % k,
                "kind": "figure",
                "book": "figures",
                "num": k,
                "file": file,
                "width": float(width),
                "alt": alt,
                "caption": cap[0] if cap else None,
                "caption_line": cap[1] if cap else None,
            }
        )
    return figures


def _figures_bad_lines(doc):
    """docs/figures.md 里没解析成附图行的非空行（附图书顶部提示）；无 doc → []。"""
    return [{"line": no, "text": text} for no, text in (doc.bad_lines if doc is not None else [])]


# ---------------- 全文 ----------------


def _split_books(lines):
    """按 parse_md 的 `# `/`## ` 规则切书：返回 title(text,line)、{book: (offset, [(rel_line, raw)])}。"""
    title = None
    books = {}
    cur = None
    for no, ln in enumerate(lines, 1):
        if ln.startswith("# "):
            title = (ln[2:].strip(), no)
            continue
        if ln.startswith("## "):
            name = ln[3:].strip()
            book = BOOK_OF_HEADING.get(name)
            if book is None:
                raise AstError("未知章节「## %s」：仅允许 摘要 / 权利要求书 / 说明书" % name, no)
            if book in books:
                raise AstError("章节「## %s」重复出现" % name, no)
            books[book] = (no, [])
            cur = book
            continue
        if cur is not None:
            off, body = books[cur]
            body.append((no - off, ln))
    if title is None:
        raise AstError("缺少「# 标题」行", 1)
    for name, book in BOOK_OF_HEADING.items():
        if book not in books:
            raise AstError("缺少「## %s」章节" % name, None)
    return title, books


def parse_ast(text, settings=None, figures=None):
    """content.md 全文 → AST dict（ast_schema.json v1）。

    settings（运行时设置 dict，可省略）只用于 abstract.figure_num（abstract_figure）、无 figures 时的 figures[] 回退，
    以及 inline[] 的 sub_except 白名单（缺省 DEFAULT_SUB_EXCEPT）；
    figures（figures_md.FiguresDoc，可省略）= docs/figures.md 真源，给了就用它生成 figures[]（含 alt）；
    解析结构本身只依赖 text。
    """
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    (title_text, title_line), books = _split_books(lines)
    sub_except = tuple((settings or {}).get("sub_except") or DEFAULT_SUB_EXCEPT)

    abs_off, abs_lines = books["abstract"]
    abs_paras = [
        {
            "id": "abstract/p%d" % k,
            "kind": "paragraph",
            "lines": _lines(no, no),
            "text": ln,
            "para_no": None,
            "role": "body",
            "inline": inline_spans(ln, sub_except),
        }
        for k, (no, ln) in enumerate((x for x in abs_lines if x[1].strip()), 1)
    ]

    cl_off, cl_lines = books["claims"]
    claims, block = [], []
    for no, ln in cl_lines:
        if ln == "":
            if block:
                claims.append(_claim(len(claims) + 1, block, sub_except))
                block = []
        else:
            block.append((no, ln))
    if block:
        claims.append(_claim(len(claims) + 1, block, sub_except))

    desc_off, desc_lines = books["description"]
    try:
        description = _description_blocks(desc_lines, sub_except)
    except AstError as e:
        raise AstError(str(e), e.line + desc_off)

    return {
        "version": AST_VERSION,
        "title": {"text": title_text, "line": title_line},
        "books": {
            "abstract": {"offset": abs_off, "length": len(abs_lines)},
            "claims": {"offset": cl_off, "length": len(cl_lines)},
            "description": {"offset": desc_off, "length": len(desc_lines)},
        },
        "abstract": {
            "id": "abstract",
            "kind": "abstract",
            "lines": _lines(1, len(abs_lines)),
            "figure_num": 1 if (settings or {}).get("abstract_figure") else None,
            "paragraphs": abs_paras,
        },
        "claims": claims,
        "description": description,
        "figures": _figures(description, settings, figures),
        "figures_bad_lines": _figures_bad_lines(figures),
    }
