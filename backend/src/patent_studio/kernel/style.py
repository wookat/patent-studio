# -*- coding: utf-8 -*-
"""排版参数（style）：builder 中全部可调常量的默认值与合并逻辑。

DEFAULT_STYLE 的每一项默认值即 builder 原硬编码值；不传 style 时输出与原实现逐字节一致。
style 以嵌套 dict 表达，允许部分覆盖（merge_style 深合并）。
"""
import copy

PART_KEYS = ("abstract", "abstract_figure", "claims", "description", "figures")

DEFAULT_STYLE = {
    "fonts": {
        "body_cjk": "宋体",            # 正文中文字体
        "heading_cjk": "黑体",         # 标题/页眉/页脚/段号中文字体
        "ascii": "Times New Roman",    # 西文默认字体
        "label_ascii": "SimHei",       # 页眉/页脚/段号的西文字体
        "mono": "Courier New",         # 伪代码等宽字体
    },
    "sizes": {                         # 单位 pt
        "body": 12,
        "title": 14,
        "section_heading": 12,
        "subsection_heading": 12,
        "header": 14,
        "footer": 9,
        "page_number": 10.5,
        "para_number": 10.5,
        "table": 10.5,
        "equation": 12,
        "code": 10.5,
    },
    "paragraph": {
        "line_spacing": 1.3,
        "first_indent_pt": 24,
        "space_after": {
            "body": 6,
            "title": 12,
            "section_heading": 8,
            "subsection_heading": 6,
            "claim_inner": 4,
            "claim_last": 8,
            "table_label": 2,
            "table_gap": 6,
            "figure_caption": 12,
            "equation_cell": 3,
        },
    },
    "page": {
        "width_cm": 21.0,
        "height_cm": 29.7,
        "margin_top_mm": 25,
        "margin_bottom_mm": 15,
        "margin_left_mm": 25,
        "margin_right_mm": 15,
        "header_distance_cm": 1.4,
        "footer_distance_cm": 0.2,
        "line_pitch": 312,
        "default_tab_stop": 420,
    },
    "header": {
        "labels": {
            "abstract": "说明书摘要",
            "abstract_figure": "摘要附图",
            "claims": "权利要求书",
            "description": "说明书",
            "figures": "说明书附图",
        },
        "spacing_short": 130,          # ≤3 字时的字间距（twips/20）
        "spacing_long": 90,
        "rule_sz": 8,                  # 页眉下横线粗细（1/8 pt）
        "rule_space": 6,
    },
    "footer": {
        "codes": {
            "abstract": "100004",
            "abstract_figure": "100005",
            "claims": "100001",
            "description": "100002",
            "figures": "100003",
        },
        "year_text": "2023.03",
        "rule_sz": 8,
        "rule_space": 3,
    },
    "table": {
        "defaults": {"三线": False, "重复表头": False, "段号居左": False},
        "cell_space_after": 2,
        "rule_outer_sz": 12,           # 三线表顶/底线
        "rule_head_sz": 6,             # 三线表表头下线
    },
    "equation": {
        "side_cm": 2.2,
    },
    # W9 决策 3：章节（###）/ 小节（####）标题样式。font / size 为 None ⇒ 继承 fonts.heading_cjk /
    # sizes.section_heading|subsection_heading；bold=False、align=left、numbering=none 即 builder 现行为（零漂移）。
    "headings": {
        "section": {"font": None, "size": None, "bold": False, "align": "left", "numbering": "none"},
        "subsection": {"font": None, "size": None, "bold": False, "align": "left", "numbering": "none"},
    },
}

HEADING_LEVELS = ("section", "subsection")
HEADING_ALIGNS = ("left", "center")
HEADING_NUMBERINGS = ("none", "cn", "arabic")
_CN_DIGITS = "零一二三四五六七八九"


def cn_number(n):
    """1 → 一，10 → 十，12 → 十二，21 → 二十一（章节数不会超过 99）。"""
    if n < 10:
        return _CN_DIGITS[n]
    tens, ones = divmod(n, 10)
    return ("十" if tens == 1 else _CN_DIGITS[tens] + "十") + (_CN_DIGITS[ones] if ones else "")


def heading_style(style, level):
    """解析 style.headings[level]：font/size 的 None 落到 fonts.heading_cjk / sizes.<level>_heading。
    返回 {font, size, bold, align, numbering}（全部已解析，供 builder 与 style_css 同源使用）。"""
    h = dict(DEFAULT_STYLE["headings"][level])
    h.update(style.get("headings", {}).get(level, {}) or {})
    if h["font"] is None:
        h["font"] = style["fonts"]["heading_cjk"]
    if h["size"] is None:
        h["size"] = style["sizes"][level + "_heading"]
    h["bold"] = bool(h["bold"])
    if h["align"] not in HEADING_ALIGNS:
        h["align"] = "left"
    if h["numbering"] not in HEADING_NUMBERINGS:
        h["numbering"] = "none"
    return h


def validate_headings(style):
    """normalize_settings 入口校验：style.headings.{section,subsection} 的 font(str|None) / size(数值>0|None) /
    bold(bool) / align∈HEADING_ALIGNS / numbering∈HEADING_NUMBERINGS；不合法抛 ValueError（路由 → 422）。"""
    hs = style.get("headings")
    if hs is None:
        return
    if not isinstance(hs, dict):
        raise ValueError("style.headings 须为对象")
    for level, h in hs.items():
        if level not in HEADING_LEVELS:
            raise ValueError(f"style.headings.{level}：未知层级（只允许 {'/'.join(HEADING_LEVELS)}）")
        if not isinstance(h, dict):
            raise ValueError(f"style.headings.{level} 须为对象")
        for k in h:
            if k not in DEFAULT_STYLE["headings"][level]:
                raise ValueError(f"style.headings.{level}.{k}：未知字段")
        font, size = h.get("font"), h.get("size")
        if font is not None and (not isinstance(font, str) or not font.strip()):
            raise ValueError(f"style.headings.{level}.font 须为非空字符串或 null")
        if size is not None and (isinstance(size, bool) or not isinstance(size, (int, float)) or size <= 0):
            raise ValueError(f"style.headings.{level}.size 须为正数或 null")
        if not isinstance(h.get("bold", False), bool):
            raise ValueError(f"style.headings.{level}.bold 须为布尔")
        if h.get("align", "left") not in HEADING_ALIGNS:
            raise ValueError(f"style.headings.{level}.align 只允许 {'|'.join(HEADING_ALIGNS)}")
        if h.get("numbering", "none") not in HEADING_NUMBERINGS:
            raise ValueError(f"style.headings.{level}.numbering 只允许 {'|'.join(HEADING_NUMBERINGS)}")


def heading_prefix(numbering, section_no, subsection_no=None):
    """编号前缀：section cn → "一、"，arabic → "1."；subsection cn → "1."，arabic → "1.1"；none → ""。"""
    if numbering == "none":
        return ""
    if subsection_no is None:
        return cn_number(section_no) + "、" if numbering == "cn" else "%d." % section_no
    return "%d." % subsection_no if numbering == "cn" else "%d.%d" % (section_no, subsection_no)


def merge_style(overrides=None):
    """深合并：返回 DEFAULT_STYLE 与 overrides 合并后的新 dict（未知键原样保留）。"""
    base = copy.deepcopy(DEFAULT_STYLE)
    if not overrides:
        return base
    _deep_update(base, overrides)
    return base


def _deep_update(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_update(dst[k], v)
        else:
            dst[k] = v
    return dst


def style_diff(style):
    """返回 style 相对 DEFAULT_STYLE 的差异（只含被修改的叶子），用于持久化。"""
    return _diff(DEFAULT_STYLE, style)


def _diff(base, cur):
    out = {}
    for k, v in cur.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            d = _diff(base[k], v)
            if d:
                out[k] = d
        elif k not in base or base[k] != v:
            out[k] = v
    return out
