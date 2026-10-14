# -*- coding: utf-8 -*-
"""docs/figures.md：附图顺序 / 宽度 / 摘要图的真源（docs/plan/12-agency-workbench.md §4.3；15 §2）。

语法（行级，逐行独立，不是 CommonMark）：
    # 说明书附图
    ![图1 信任协议闭环总体流程图](figs/fig1.emf){width=15}
    ![图2 成熟反馈时间轴图](figs/fig2.emf){width=15}

    # 摘要附图
    ![](figs/fig1.emf){width=14.5}

- 图号由 `# 说明书附图` 下的行序生成，源码不写号；alt 只做显示与体检（preflight figures.alt_mismatch）。
- `{width=N}` 单位 cm，缺省说明书 15 / 摘要 14.5；`# 摘要附图` 只取第一行，多出的行进 bad_lines。
- 其它 `# 标题` 结束当前节并被忽略；节外或节内不匹配的非空行不抛错，记入 `FiguresDoc.bad_lines`
  （/ast 响应 `figures_bad_lines`，附图书顶部提示），案卷仍可打开。
- `serialize` 是唯一写法：`parse(serialize(doc)) == doc`（去掉 line / bad_lines），
  `serialize(parse(serialize(doc))) == serialize(doc)` 逐字节。
- 本文件不进 content.md，docset.assemble/split 与三书装配律不受影响。
- W5 R-FIG-02：说明书附图行下可选 marks 表（标记号 → 名称，标记号 3~4 位数字，与 preflight §4.1 一致）：
      ![图3 控制器实例结构框图](figs/fig3.emf){width=15}
      marks:
      - 1031 冻结骨干
      - 1032 检索安全门控控制器
  无 marks 的图不写这几行，旧文件 parse → serialize 逐字节不变；摘要图不带 marks（写了进 bad_lines）。
"""

import os
import re
from dataclasses import dataclass, field

from .ast import FIGURE_CAPTION_RE as CAPTION_RE
from .content import INLINE_FIG_RE

FILE = "figures.md"
DOCS_DIR = "docs"
SPEC_HEADING = "# 说明书附图"
ABSTRACT_HEADING = "# 摘要附图"
DEFAULT_WIDTH = 15.0
DEFAULT_ABSTRACT_WIDTH = 14.5

LINE_RE = INLINE_FIG_RE  # 图行语法与说明书内嵌图共用一份定义（content.INLINE_FIG_RE）
MARKS_HEADING = "marks:"
MARK_RE = re.compile(r"^-\s+(?P<num>\d{3,4})\s+(?P<name>\S.*?)\s*$")


@dataclass
class Figure:
    file: str
    width: float
    alt: str = ""
    line: int = 0  # figures.md 1-based 行号；0 = 内存构造
    marks: dict[str, str] = field(default_factory=dict)  # 标记号 → 名称，保持书写顺序


@dataclass
class FiguresDoc:
    spec: list[Figure] = field(default_factory=list)
    abstract: Figure | None = None
    bad_lines: list[tuple[int, str]] = field(default_factory=list)

    def num_of(self, file):
        """file 的图号（1-based）；未编入 → None。"""
        for i, f in enumerate(self.spec, 1):
            if f.file == file:
                return i
        return None

    def legacy_view(self):
        """旧 studio.json 字段形状（本波次内 lint / ast / 设置页 / cnipa_xml 仍读它）。"""
        return {
            "spec_figures": [[f.file, f.width] for f in self.spec],
            "abstract_figure": [self.abstract.file, self.abstract.width] if self.abstract else None,
        }


def path_of(project_dir):
    return os.path.join(project_dir, DOCS_DIR, FILE)


def fmt_width(w):
    return f"{float(w):g}"


def parse(text):
    doc = FiguresDoc()
    section = None
    marks_of = None  # 正在接收 marks 行的说明书附图
    for no, raw in enumerate(text.split("\n"), 1):
        ln = raw.rstrip()
        if not ln.strip():
            continue
        if ln == SPEC_HEADING:
            section, marks_of = "spec", None
            continue
        if ln == ABSTRACT_HEADING:
            section, marks_of = "abstract", None
            continue
        if ln.startswith("# "):
            section, marks_of = None, None
            continue
        if section == "spec" and doc.spec and ln == MARKS_HEADING:
            marks_of = doc.spec[-1]
            continue
        if marks_of is not None:
            mk = MARK_RE.match(ln)
            if mk:
                marks_of.marks[mk.group("num")] = mk.group("name")
                continue
            marks_of = None
        m = LINE_RE.match(ln)
        if not m or section is None:
            doc.bad_lines.append((no, ln))
            continue
        default = DEFAULT_WIDTH if section == "spec" else DEFAULT_ABSTRACT_WIDTH
        fig = Figure(
            file=m.group("file"), width=float(m.group("width") or default), alt=m.group("alt").strip(), line=no
        )
        if section == "spec":
            doc.spec.append(fig)
        elif doc.abstract is None:
            doc.abstract = fig
        else:
            doc.bad_lines.append((no, ln))
    return doc


def _line(fig):
    return f"![{fig.alt}](figs/{fig.file}){{width={fmt_width(fig.width)}}}"


def _spec_lines(fig):
    yield _line(fig)
    if fig.marks:
        yield MARKS_HEADING
        for num, name in fig.marks.items():
            yield f"- {num} {name}"


def serialize(doc):
    out = [SPEC_HEADING, ""]
    for f in doc.spec:
        out.extend(_spec_lines(f))
    out.append("")
    out.append(ABSTRACT_HEADING)
    out.append("")
    if doc.abstract:
        out.append(_line(doc.abstract))
    return "\n".join(out) + "\n"


def captions_of(content_md):
    """content.md 说明书「图N为…」题注 {N: 题注}（迁移时填 alt 用）。"""
    caps = {}
    for ln in content_md.split("\n"):
        # 多题注挤在一段（「图1是…。图2是…。」）→ 按「。图N为/是」边界切开逐段匹配
        for seg in re.split(r"。(?=图\d+[为是])", ln.strip()):
            m = CAPTION_RE.match(seg)
            if m and int(m.group(1)) not in caps:
                caps[int(m.group(1))] = m.group(2).strip()
    return caps


def from_legacy(spec_figures, abstract_figure, content_md=""):
    """studio.json 旧字段 → FiguresDoc（alt = `图N 题注`，题注取自说明书附图说明；无题注只写 `图N`）。"""
    caps = captions_of(content_md) if content_md else {}
    spec = []
    for i, (f, w) in enumerate(spec_figures or [], 1):
        alt = f"图{i} {caps[i]}" if caps.get(i) else f"图{i}"
        spec.append(Figure(file=str(f), width=float(w), alt=alt))
    abstract = Figure(file=str(abstract_figure[0]), width=float(abstract_figure[1])) if abstract_figure else None
    return FiguresDoc(spec=spec, abstract=abstract)


def infer(figs, docx_exts):
    """无 figures.md 也无旧字段：摘要图 = 第一张可入 DOCX 的图，说明书附图 = 全部
    （与 projects.default_settings 同规则）。"""
    docx_figs = [f for f in figs if f.lower().endswith(docx_exts)]
    return from_legacy(
        [[f, DEFAULT_WIDTH] for f in docx_figs], [docx_figs[0], DEFAULT_ABSTRACT_WIDTH] if docx_figs else None
    )


def read(project_dir):
    """存在 → FiguresDoc；不存在 → None。"""
    p = path_of(project_dir)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return parse(f.read())


def write(project_dir, doc):
    os.makedirs(os.path.join(project_dir, DOCS_DIR), exist_ok=True)
    with open(path_of(project_dir), "w", encoding="utf-8", newline="") as f:
        f.write(serialize(doc))
    return doc


def apply_legacy(doc, spec_figures=None, abstract_figure=None):
    """把旧字段形状的改动（顺序 / 宽度 / 摘要图）套到 doc 上，保留同名文件已有的 alt。
    spec_figures / abstract_figure 为 None 表示该项不变。"""
    if spec_figures is not None:
        olds = {f.file: f for f in doc.spec}
        new = []
        for i, (f, w) in enumerate(spec_figures, 1):
            old = olds.get(str(f))
            new.append(
                Figure(
                    file=str(f),
                    width=float(w),
                    alt=old.alt if old is not None else f"图{i}",
                    marks=dict(old.marks) if old is not None else {},
                )
            )
        doc.spec = new
    if abstract_figure is not None:
        doc.abstract = Figure(
            file=str(abstract_figure[0]), width=float(abstract_figure[1]), alt=doc.abstract.alt if doc.abstract else ""
        )
    return doc
