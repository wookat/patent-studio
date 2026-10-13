# -*- coding: utf-8 -*-
"""专利申请文件结构化内容源：content.md（Markdown）的序列化与解析。

Markdown 约定（无损往返）：
  # 标题            → TITLE（全文唯一一级标题）
  ## 摘要 / ## 权利要求书 / ## 说明书   → 三大节
  权利要求书内：空行分隔的块 = 一项权利要求；块内每行一个段，
               以 $$公式$$ 独立行表示权利要求内独立成行公式。
  说明书内：### 章节标题 = 主标题（h）；#### 小节标题 = 小节（s）；
           普通段落块 = 一个编号段（[0001]…）；
           $$公式$$ （编号） 独立行 = 独立成行编号公式；
           连续 | 单元格 | 行 = 表格（Markdown 表格语法，--- 分隔行可选），
           表格本身占用一个空段号（对齐授权案版式），表题写成其前的普通段落，
           如"表1 xxx对比结果"。

旧行式 content.txt 格式的解析保留在 load_content()，用于迁移。
"""

import re


def load_content(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read().rstrip("\n").split("\n")
    sections, cur = {}, None
    for ln in raw:
        if ln.startswith("#") and ln[1:] in ("TITLE", "ABSTRACT", "CLAIMS", "SPEC"):
            cur = ln[1:]
            sections[cur] = []
        else:
            sections[cur].append(ln)
    title = [l for l in sections["TITLE"] if l][0]
    abstract = [l for l in sections["ABSTRACT"] if l][0]
    claims, block = [], []
    for ln in sections["CLAIMS"]:
        if ln == "":
            if block:
                claims.append("\n".join(block))
                block = []
        else:
            block.append(ln)
    if block:
        claims.append("\n".join(block))
    spec = []
    for ln in sections["SPEC"]:
        if ln == "":
            continue
        if ln.startswith("[H]"):
            spec.append(("h", ln[3:]))
        elif ln.startswith("[S]"):
            spec.append(("s", ln[3:]))
        elif ln.startswith("[E]"):
            num, formula = ln[3:].split("\t", 1)
            spec.append(("e", formula, num))
        else:
            spec.append(ln)
    return title, abstract, claims, spec


def dump_md(path, title, abstract, claims, spec):
    lines = ["# " + title, "", "## 摘要", "", abstract, "", "## 权利要求书"]
    for c in claims:
        lines.append("")
        for seg in c.split("\n"):
            if seg.startswith("@EQ@"):
                lines.append("$$%s$$" % seg[4:])
            else:
                lines.append(seg)
    lines.extend(["", "## 说明书"])
    for item in spec:
        lines.append("")
        if isinstance(item, tuple):
            if item[0] == "e":
                lines.append(("$$%s$$ %s" % (item[1], item[2])).rstrip())
            elif item[0] == "t":
                opts = item[2] if len(item) > 2 else {}
                toks = [k for k in ("三线", "重复表头", "段号居左") if opts.get(k)]
                if opts.get("列宽"):
                    toks.append("列宽=" + ",".join("%g" % x for x in opts["列宽"]))
                if opts.get("表题后置"):
                    toks.append("表题后置=" + opts["表题后置"])
                if toks:
                    lines.append(table_spec_line(toks))
                for r in item[1]:
                    lines.append("| " + " | ".join(r) + " |")
                if opts.get("表注"):
                    lines.append(opts["表注"])
            elif item[0] == "c":
                lines.append("```")
                lines.extend(item[1])
                lines.append("```")
            elif item[0] == "h":
                lines.append("### " + item[1])
            elif item[0] == "f":
                w = item[2]
                wtxt = "%g" % w if isinstance(w, float) else str(w)
                lines.append(f"![{item[3] or ''}](figs/{item[1]}){{width={wtxt}}}")
            else:
                lines.append("#### " + item[1])
        else:
            lines.append(item)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def load_md(path):
    with open(path, encoding="utf-8") as f:
        return parse_md(f.read())


def is_table_separator(cells):
    """GFM 分隔行：每格都是 `-`/`:`/空格且至少含一个 `-`；全空行 `|  |  |` 是真正的空数据行，不是分隔行。"""
    return all(c and "-" in c and set(c) <= set("-: ") for c in cells)


INLINE_FIG_RE = re.compile(r"^!\[(?P<alt>[^\]]*)\]\(figs/(?P<file>[^()\s]+)\)(?:\{width=(?P<width>\d+(?:\.\d+)?)\})?\s*$")
"""说明书内嵌图行（W18）：![alt](figs/x){width=N} → spec 项 ("f", file, width, alt)。
与 figures_md.LINE_RE 同语法；非 figs/ 路径或不规范形态不匹配 → 落普通段落（保持原样文本）。"""


def parse_md(text):
    """load_md 的纯文本入口（AST 路由对未保存内容解析时复用；语义与 load_md 逐字相同）。"""
    raw = text.rstrip("\n").split("\n")
    title, cur = None, None
    sec = {"摘要": [], "权利要求书": [], "说明书": []}
    for ln in raw:
        if ln.startswith("# ") and not ln.startswith("## "):
            title = ln[2:].strip()
        elif ln.startswith("## "):
            cur = ln[3:].strip()
        elif cur is not None:
            sec[cur].append(ln)
    abstract = "\n".join(l for l in sec["摘要"] if l.strip())
    claims, block = [], []
    for ln in sec["权利要求书"] + [""]:
        if ln == "":
            if block:
                claims.append("\n".join(block))
                block = []
            continue
        if ln.startswith("$$") and ln.rstrip().endswith("$$"):
            block.append("@EQ@" + ln.rstrip()[2:-2])
        else:
            block.append(ln)
    spec = []
    rows = []
    topts = {}
    in_code, code_lines = False, []

    def flush_table():
        nonlocal topts
        if rows:
            spec.append(("t", list(rows), dict(topts)))
            rows.clear()
            topts = {}

    for ln in sec["说明书"]:
        if ln.strip().startswith("```"):
            if in_code:
                spec.append(("c", list(code_lines)))
                code_lines = []
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
            topts = parse_table_opts(s[4:-3])
            continue
        if s.startswith("注："):
            flush_table()
            if spec and isinstance(spec[-1], tuple) and spec[-1][0] == "t" \
                    and "表注" not in spec[-1][2]:
                spec[-1][2]["表注"] = s
                continue
        if ln.lstrip().startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if not is_table_separator(cells):
                rows.append(cells)
            continue
        flush_table()
        if ln.startswith("#### "):
            spec.append(("s", ln[5:].strip()))
        elif ln.startswith("### "):
            spec.append(("h", ln[4:].strip()))
        elif ln.startswith("$$"):
            body = ln[2:]
            formula, rest = body.rsplit("$$", 1)
            spec.append(("e", formula, rest.strip()))
        elif (m := INLINE_FIG_RE.match(s)):
            spec.append(("f", m.group("file"), float(m.group("width") or 15), m.group("alt").strip()))
        else:
            spec.append(ln)
    flush_table()
    return title, abstract, claims, spec


TABLE_SPEC_OPEN = "<!-- 表格: "


def table_spec_line(toks):
    """表格选项注释行（写端唯一口；解析见 parse_table_opts）。空 toks 应不调用。"""
    return TABLE_SPEC_OPEN + " ".join(toks) + " -->"


def parse_table_opts(body):
    """解析表格选项注释：<!-- 表格: 三线 重复表头 段号居左 列宽=30,20,50 表题后置=表1 xx -->

    选项（全部可选）：
      三线        三线表样式（顶线/表头下线/底线，无竖线）
      重复表头    跨页时自动重复表头行
      段号居左    段号纵向居中于表格左侧（授权案多数派版式）
      列宽=a,b,c  各列宽度百分比
      表题后置=…  表题置于表格之后（少数派版式）
    单元格写 ^^ 表示与上一行同列单元格竖向合并。"""
    opts = {}
    body = body.split(":", 1)[1] if ":" in body else body
    for tok in body.split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            if k == "列宽":
                opts["列宽"] = [float(x) for x in v.split(",")]
            elif k == "表题后置":
                opts["表题后置"] = v
        elif tok in ("三线", "重复表头", "段号居左"):
            opts[tok] = True
    return opts
