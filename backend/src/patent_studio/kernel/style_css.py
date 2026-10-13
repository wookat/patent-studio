# -*- coding: utf-8 -*-
"""Style → 版面视图 CSS（docs/plan/16-w4d-layout-view-design.md §2）。

STYLE_CSS_VARS 是映射表真源：(Style 路径, CSS 变量名, 单位)。单位 "" = 无单位倍数，
"pt8" = builder 的 1/8 pt 线宽（值 ÷ 8 → pt）。路径与 style.DEFAULT_STYLE 逐键对应
（tests/test_w4d_prep.py 断言每条都可在 merge_style() 中解析）。

render_css(merge_style(settings["style"])) 输出：
  1. `:root,.ps-layout{…}` 变量块：STYLE_CSS_VARS 每条一个 --ps-* 变量（pt/cm/mm 原样给 CSS 物理单位，
     行距为无单位倍数）+ 组合字体族 --ps-font-body/heading/mono（西文优先、中文回退，与 docker/fonts-cjk-alias.conf
     同一替身表）+ 纸面 px 尺寸 --ps-page-w-px/--ps-page-h-px（96 dpi，无单位，供前端量宽缩放）+ 页眉字间距。
  2. PART_CLASSES 规则：每类只引变量，不写字面尺寸；对齐 builder.py 对应段落的 alignment / 字体 / 段后。
"""
from .style import PART_KEYS, heading_style

STYLE_CSS_VARS = (
    ("fonts.body_cjk", "--ps-font-body-cjk", ""),
    ("fonts.ascii", "--ps-font-body-ascii", ""),
    ("fonts.heading_cjk", "--ps-font-heading-cjk", ""),
    ("fonts.label_ascii", "--ps-font-heading-ascii", ""),
    ("fonts.mono", "--ps-font-mono", ""),
    ("sizes.body", "--ps-size-body", "pt"),
    ("sizes.title", "--ps-size-title", "pt"),
    ("sizes.section_heading", "--ps-size-h1", "pt"),
    ("sizes.subsection_heading", "--ps-size-h2", "pt"),
    ("sizes.header", "--ps-size-header", "pt"),
    ("sizes.para_number", "--ps-size-para-no", "pt"),
    ("sizes.table", "--ps-size-table", "pt"),
    ("sizes.equation", "--ps-size-eq", "pt"),
    ("sizes.code", "--ps-size-code", "pt"),
    ("paragraph.line_spacing", "--ps-line-height", ""),
    ("paragraph.first_indent_pt", "--ps-first-indent", "pt"),
    ("paragraph.space_after.body", "--ps-gap-body", "pt"),
    ("paragraph.space_after.title", "--ps-gap-title", "pt"),
    ("paragraph.space_after.section_heading", "--ps-gap-h1", "pt"),
    ("paragraph.space_after.subsection_heading", "--ps-gap-h2", "pt"),
    ("paragraph.space_after.claim_inner", "--ps-gap-claim-inner", "pt"),
    ("paragraph.space_after.claim_last", "--ps-gap-claim", "pt"),
    ("paragraph.space_after.table_label", "--ps-gap-table-label", "pt"),
    ("paragraph.space_after.table_gap", "--ps-gap-table", "pt"),
    ("paragraph.space_after.figure_caption", "--ps-gap-figure", "pt"),
    ("paragraph.space_after.equation_cell", "--ps-gap-eq", "pt"),
    ("page.width_cm", "--ps-page-w", "cm"),
    ("page.height_cm", "--ps-page-h", "cm"),
    ("page.margin_top_mm", "--ps-margin-t", "mm"),
    ("page.margin_bottom_mm", "--ps-margin-b", "mm"),
    ("page.margin_left_mm", "--ps-margin-l", "mm"),
    ("page.margin_right_mm", "--ps-margin-r", "mm"),
    ("page.header_distance_cm", "--ps-header-distance", "cm"),
    ("header.rule_sz", "--ps-header-rule", "pt8"),
    ("table.rule_outer_sz", "--ps-table-rule-outer", "pt8"),
    ("table.rule_head_sz", "--ps-table-rule-head", "pt8"),
    ("table.cell_space_after", "--ps-gap-cell", "pt"),
    ("equation.side_cm", "--ps-eq-side", "cm"),
)

# 版面视图 part 级类（前端节点按 AST 书 / 角色套用；名字固定，D3 使用）
PART_CLASSES = (
    "ps-paper", "ps-header", "ps-title", "ps-abstract", "ps-claim", "ps-desc-h", "ps-body", "ps-para-no",
    "ps-caption", "ps-table", "ps-eq", "ps-code", "ps-figure",
)

# 浏览器端字体回退（与 docker/fonts-cjk-alias.conf 的 LibreOffice 替身表同源：Word 名 → 英文名 → 免费替身）。
FONT_FALLBACKS = {
    "宋体": ("SimSun", "Songti SC", "AR PL UMing CN", "Noto Serif CJK SC"),
    "SimSun": ("宋体", "Songti SC", "AR PL UMing CN", "Noto Serif CJK SC"),
    "仿宋": ("FangSong", "SimSun", "AR PL UMing CN", "Noto Serif CJK SC"),
    "楷体": ("KaiTi", "Kaiti SC", "AR PL UKai CN", "Noto Serif CJK SC"),
    "黑体": ("SimHei", "Heiti SC", "WenQuanYi Micro Hei", "Noto Sans CJK SC"),
    "SimHei": ("黑体", "Heiti SC", "WenQuanYi Micro Hei", "Noto Sans CJK SC"),
    "Times New Roman": ("Times", "Liberation Serif", "Tinos"),
    "Courier New": ("Courier", "Liberation Mono", "Cousine"),
    "Arial": ("Liberation Sans", "Arimo"),
    "Cambria": ("Liberation Serif",),
    "Cambria Math": ("Liberation Serif",),
}

# 版面视图纸面（abstract_figure 不单独成纸，附图并入 figures 纸；12 §5.2）
PAPER_PARTS = tuple(k for k in PART_KEYS if k != "abstract_figure")
PX_PER_CM = 96 / 2.54


def style_value(style, path):
    """按 "a.b.c" 路径取 merge_style() 结果里的叶子值。"""
    cur = style
    for key in path.split("."):
        cur = cur[key]
    return cur


def css_number(v):
    """12 → "12"，10.5 → "10.5"，21.0 → "21"，1.3 → "1.3"。"""
    if isinstance(v, bool):
        raise TypeError("样式数值不能是 bool")
    f = float(v)
    if f == int(f):
        return str(int(f))
    return f"{f:.4f}".rstrip("0").rstrip(".")


def css_length(v, unit):
    if unit == "":
        return css_number(v)
    if unit == "pt8":
        return css_number(v / 8) + "pt"
    return css_number(v) + unit


def cm_to_px(cm):
    """cm → CSS px（96 dpi），保留 2 位。"""
    return round(float(cm) * PX_PER_CM, 2)


def font_family(*names, generic):
    """按给定顺序拼字体族，去重，每个 Word 字体名后跟 FONT_FALLBACKS 替身，末尾通用族。"""
    out = []
    for name in names:
        for fam in (name, *FONT_FALLBACKS.get(name, ())):
            if fam not in out:
                out.append(fam)
    return ", ".join(f'"{f}"' for f in out) + f", {generic}"


def render_vars(style):
    """返回 {变量名: 值}：映射表变量 + 组合字体族 + px 尺寸 + 页眉字间距（--ps-font-mono 取带回退的字体族）。"""
    out = {}
    for path, var, unit in STYLE_CSS_VARS:
        v = style_value(style, path)
        out[var] = f'"{v}"' if unit == "" and path.startswith("fonts.") else css_length(v, unit)
    fonts, page, header = style["fonts"], style["page"], style["header"]
    out["--ps-font-body"] = font_family(fonts["ascii"], fonts["body_cjk"], generic="serif")
    out["--ps-font-heading"] = font_family(fonts["label_ascii"], fonts["heading_cjk"], generic="sans-serif")
    out["--ps-font-mono"] = font_family(fonts["mono"], generic="monospace")
    out["--ps-page-w-px"] = css_number(cm_to_px(page["width_cm"]))
    out["--ps-page-h-px"] = css_number(cm_to_px(page["height_cm"]))
    # builder.part_heading：w:spacing 单位 1/20 pt；页眉 ≤3 字用 short
    out["--ps-header-spacing-short"] = css_number(header["spacing_short"] / 20) + "pt"
    out["--ps-header-spacing-long"] = css_number(header["spacing_long"] / 20) + "pt"
    # W9 决策 3：style.headings.section(###) → --ps-h3-*，subsection(####) → --ps-h4-*（与 builder.heading_style 同源）
    for level, tag in (("section", "h3"), ("subsection", "h4")):
        h = heading_style(style, level)
        # 标题字体被单独指定时中文字体排最前：西文字体（SimHei 等）自带汉字字形，排前会吞掉中文；
        # 缺省仍与 --ps-font-heading 同串
        ascii_first = h["font"] == fonts["heading_cjk"]
        order = (fonts["label_ascii"], h["font"]) if ascii_first else (h["font"], fonts["label_ascii"])
        out[f"--ps-{tag}-font"] = font_family(*order, generic="sans-serif")
        out[f"--ps-{tag}-size"] = css_length(h["size"], "pt")
        out[f"--ps-{tag}-weight"] = "bold" if h["bold"] else "normal"
        out[f"--ps-{tag}-align"] = h["align"]
        out[f"--ps-{tag}-numbering"] = h["numbering"]
    return out


def _rule(selector, decls):
    return selector + "{" + ";".join(decls) + "}"


def render_part_rules(style):
    """part 级类：只引 --ps-* 变量（对齐 builder.py 各段的 alignment / 字体 / 段后 / 缩进）。"""
    body_font = ("font-family:var(--ps-font-body)", "font-size:var(--ps-size-body)",
                 "line-height:var(--ps-line-height)")
    rules = [
        _rule(".ps-paper", ("box-sizing:border-box", "width:var(--ps-page-w)", "min-height:var(--ps-page-h)",
                            "padding:var(--ps-margin-t) var(--ps-margin-r) var(--ps-margin-b) var(--ps-margin-l)",
                            "font-family:var(--ps-font-body)", "font-size:var(--ps-size-body)",
                            "line-height:var(--ps-line-height)", "color:#000")),
        _rule(".ps-header", ("top:var(--ps-header-distance)", "font-family:var(--ps-font-heading)",
                             "font-size:var(--ps-size-header)", "letter-spacing:var(--ps-header-spacing-long)",
                             "text-align:center", "border-bottom:var(--ps-header-rule) solid #000",
                             "color:#000")),
    ]
    labels = style["header"]["labels"]
    for part in PAPER_PARTS:
        if len(labels[part]) <= 3:
            rules.append(_rule(f'.ps-paper[data-part="{part}"] .ps-header',
                               ("letter-spacing:var(--ps-header-spacing-short)",)))
    rules += [
        _rule(".ps-title", ("font-family:var(--ps-font-heading)", "font-size:var(--ps-size-title)",
                            "line-height:var(--ps-line-height)", "text-align:center", "font-weight:normal",
                            "margin:0 0 var(--ps-gap-title)")),
        _rule(".ps-abstract", (*body_font, "text-align:justify", "text-indent:var(--ps-first-indent)",
                               "margin:0 0 var(--ps-gap-body)")),
        _rule(".ps-claim", (*body_font, "text-align:justify", "margin:0 0 var(--ps-gap-claim)")),
        _rule(".ps-claim p", ("text-indent:var(--ps-first-indent)", "margin:0 0 var(--ps-gap-claim-inner)")),
        _rule(".ps-claim p:last-child", ("margin-bottom:0",)),
        _rule(".ps-desc-h", ("font-family:var(--ps-font-heading)", "font-size:var(--ps-size-h1)",
                             "line-height:var(--ps-line-height)", "font-weight:normal", "text-align:justify",
                             "text-indent:0", "margin:0 0 var(--ps-gap-h1)")),
        _rule('.ps-desc-h[data-level="2"]', ("font-size:var(--ps-size-h2)", "margin-bottom:var(--ps-gap-h2)")),
        _rule(".ps-body", (*body_font, "text-align:justify", "text-indent:0", "margin:0 0 var(--ps-gap-body)")),
        _rule(".ps-para-no", ("font-family:var(--ps-font-heading)", "font-size:var(--ps-size-para-no)",
                              "color:var(--color-muted-foreground, #6b7280)", "margin-right:1em",
                              "user-select:none", "-webkit-user-select:none")),
        _rule(".ps-caption", (*body_font, "text-align:center", "text-indent:0",
                              "margin:0 0 var(--ps-gap-table-label)")),
        _rule(".ps-table", ("font-family:var(--ps-font-body)", "font-size:var(--ps-size-table)",
                            "line-height:var(--ps-line-height)", "border-collapse:collapse", "width:100%",
                            "margin:0 0 var(--ps-gap-table)")),
        _rule(".ps-table th,.ps-table td", ("border:0.5pt solid #000", "padding:0 0.3em var(--ps-gap-cell)",
                                             "vertical-align:middle", "text-align:center", "font-weight:normal")),
        _rule(".ps-table[data-three-line]", ("border-top:var(--ps-table-rule-outer) solid #000",
                                             "border-bottom:var(--ps-table-rule-outer) solid #000")),
        _rule(".ps-table[data-three-line] th,.ps-table[data-three-line] td", ("border:0",)),
        _rule(".ps-table[data-three-line] thead th,.ps-table[data-three-line] tr:first-child td",
              ("border-bottom:var(--ps-table-rule-head) solid #000",)),
        _rule(".ps-eq", ("display:grid", "grid-template-columns:var(--ps-eq-side) minmax(0,1fr) var(--ps-eq-side)",
                         "align-items:center", "font-family:var(--ps-font-body)", "font-size:var(--ps-size-eq)",
                         "line-height:var(--ps-line-height)", "padding:var(--ps-gap-eq) 0")),
        _rule(".ps-eq > math,.ps-eq > .ps-eq-body", ("grid-column:2", "text-align:center", "justify-self:center")),
        _rule(".ps-eq > .ps-eq-math", ("grid-column:2", "min-width:0", "justify-self:stretch", "text-align:center")),
        _rule(".ps-eq > .ps-eq-label", ("grid-column:3", "text-align:right")),
        _rule(".ps-code", ("font-family:var(--ps-font-mono)", "font-size:var(--ps-size-code)",
                           "line-height:var(--ps-line-height)", "text-align:left", "white-space:pre-wrap",
                           "margin:0 0 var(--ps-gap-body)")),
        _rule(".ps-figure", ("text-align:center", "margin:0 0 var(--ps-gap-figure)")),
        _rule(".ps-figure figcaption", (*body_font, "text-align:center")),
    ]
    return rules


def render_css(style):
    """merge_style() 结果 → 完整 CSS 文本（:root/.ps-layout 变量 + part 级类）。"""
    vars_block = _rule(":root,.ps-layout", tuple(f"{var}:{val}" for var, val in render_vars(style).items()))
    return "\n".join(["/* Patent Studio 版面视图样式：由项目 studio.json.style 生成，勿手改 */",
                      vars_block, *render_part_rules(style)]) + "\n"
