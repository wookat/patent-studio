"""figspec JSON → PNG：结构化图元规格的确定性分层渲染（CNIPA 白底黑线）。

设计动机（dinov2/patchtst 自绘图实案）：让模型写自由格式 mermaid 流程图等于
盲画——它对节点位置零控制，auto-layout 出的拓扑永远是"链的变体"。专利附图
的真实画法是**分层框图**：输入层→处理层→输出层带状堆叠、层内模块横排、
辅助数据线（参数/均值/权重）虚线绕行。figspec 让模型直接描述这个结构：

    {"bands": [
       {"title": "输入层", "blocks": [{"id": "X", "label": "多视图输入"}]},
       {"title": "处理层", "blocks": [
           {"id": "A", "label": "掩码单元 105"}, {"id": "B", "label": "学生网络 101"}]},
       {"title": "输出层", "blocks": [{"id": "G", "label": "损失计算单元 110"}]}],
     "edges": [
       {"from": "X", "to": "A"},
       {"from": "B", "to": "G"},
       {"from": "G", "to": "B", "label": "参数更新", "dashed": true}]}

布局完全确定、与生成随机性无关：band 自上而下等距堆叠、block 带内居中
均排、边全部走正交折线（同层上下车道/跨层竖直通道/回授走右沟槽）。
"""

import json
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont

SS = 6  # 超采样倍率（与 mmd_render 同：出图按 SS/2 降采，印件不糊）
FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/msyh.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
FONT_INDEX = 2  # NotoSansCJK-Regular.ttc 内 SC 字模


def _font(size):
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size * SS, index=FONT_INDEX)
            except (OSError, ValueError):
                try:
                    return ImageFont.truetype(path, size * SS)
                except (OSError, ValueError):
                    continue
    return ImageFont.load_default(size * SS)


def _wrap(draw, text, font, max_px):
    # ASCII 词元原子化（与 mmd_render 同口径：英文/数字不在词中断行）
    out, cur = [], ""
    for piece in re.findall(r"[A-Za-z0-9_.-]+|\s|.", str(text)):
        if piece == "\n":
            out.append(cur)
            cur = ""
            continue
        if cur and draw.textlength(cur + piece, font=font) > max_px:
            out.append(cur.rstrip() or cur)
            cur = piece.lstrip()
            while draw.textlength(cur, font=font) > max_px and len(cur) > 1:
                cur = cur[1:]
        else:
            cur += piece
    if cur.strip() or not out:
        out.append(cur.strip() or cur)
    return out[:4]


def _dashed(d, pts):
    dash, gaplen = 14 * SS, 9 * SS
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        seg = max(abs(bx - ax), abs(by - ay)) or 1
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        pos = 0.0
        while pos < seg:
            end = min(pos + dash, seg)
            d.line([ax + ux * pos, ay + uy * pos, ax + ux * end, ay + uy * end],
                   fill="black", width=2 * SS)
            pos = end + gaplen


def _tip(d, px, py, fx, fy, w=3):
    ang = math.atan2(py - fy, px - fx)
    l = 16 * SS
    for s in (-1, 1):
        d.line([px, py,
                px - l * math.cos(ang + s * 0.42), py - l * math.sin(ang + s * 0.42)],
               fill="black", width=w * SS)


def parse_figspec(spec):
    """figspec dict/JSON 字符串 → 规范化结构。非法 → ValueError。"""
    if isinstance(spec, str):
        try:
            spec = json.loads(spec)
        except (ValueError, TypeError) as e:
            raise ValueError(f"figspec JSON 解析失败：{e}")
    if not isinstance(spec, dict):
        raise ValueError("figspec 必须是对象")
    bands = spec.get("bands")
    if not isinstance(bands, list) or not bands:
        raise ValueError("figspec.bands 缺失或为空")
    nodes = {}
    out_bands = []
    for i, band in enumerate(bands):
        if not isinstance(band, dict):
            raise ValueError(f"bands[{i}] 非对象")
        blocks = band.get("blocks")
        if not isinstance(blocks, list) or not blocks:
            raise ValueError(f"bands[{i}].blocks 缺失或为空")
        out_blocks = []
        for j, blk in enumerate(blocks):
            if not isinstance(blk, dict):
                raise ValueError(f"bands[{i}].blocks[{j}] 非对象")
            bid = str(blk.get("id") or "").strip()
            lab = str(blk.get("label") or bid).strip()
            if not bid:
                raise ValueError(f"bands[{i}].blocks[{j}] 缺 id")
            if bid in nodes:
                raise ValueError(f"block id 重复：{bid}")
            shape = blk.get("shape")
            w_raw = blk.get("weight")
            if w_raw is not None:
                if not isinstance(w_raw, (int, float)) or not (0 < w_raw <= 20):
                    raise ValueError(f"bands[{i}].blocks[{j}] weight 非法：{w_raw}")
            weight = float(w_raw) if w_raw is not None else 1.0
            nodes[bid] = {"label": lab, "shape": shape, "band": i, "idx": j}
            out = {"id": bid, "label": lab, "shape": shape}
            if weight != 1.0:
                out["weight"] = weight
            out_blocks.append(out)
        out_bands.append({"title": str(band.get("title") or "").strip(),
                          "blocks": out_blocks})
    edges = []
    for k, e in enumerate(spec.get("edges") or []):
        if not isinstance(e, dict):
            raise ValueError(f"edges[{k}] 非对象")
        a, b = str(e.get("from") or ""), str(e.get("to") or "")
        if a not in nodes or b not in nodes:
            raise ValueError(f"edges[{k}] 引用未知节点：{a}->{b}")
        edges.append({"from": a, "to": b,
                      "label": str(e.get("label") or "").strip(),
                      "dashed": bool(e.get("dashed"))})
    return {"bands": out_bands, "edges": edges, "nodes": nodes}


def render_figspec(spec):
    """figspec → PIL Image（白底黑线）。布局确定性：band 堆叠、block 带内均排。"""
    g = spec if isinstance(spec, dict) and spec.get("nodes") else parse_figspec(spec)
    probe = Image.new("RGB", (8, 8))
    d0 = ImageDraw.Draw(probe)
    f_node = _font(20)
    f_lab = _font(16)

    pad_x, pad_y = 20 * SS, 14 * SS
    line_h = 28 * SS
    wrap_px = 210 * SS
    gap_blk = 70 * SS      # 带内块间最小间距（兼作同层边车道）
    band_pad = 26 * SS     # 层框内边距
    band_title_h = 34 * SS
    gap_band = 96 * SS     # 层间车道高（跨层边在此横移）
    margin_x = 30 * SS
    margin_y = 30 * SS
    gutter_w = 96 * SS     # 右侧回授沟槽

    # ---- 测量
    for band in g["bands"]:
        for blk in band["blocks"]:
            weight = float(blk.get("weight") or 1.0)
            if blk["shape"] == "spacer":
                # 占位块：隐形槽位，只为对齐/汇边——无边无字，weight 控制槽宽
                blk["w"] = 60 * SS * weight
                blk["h"] = line_h + pad_y * 2
                blk["_lines"] = []
                continue
            lines = _wrap(d0, blk["label"], f_node, wrap_px)
            tw = max(d0.textlength(t, font=f_node) for t in lines)
            blk["w"] = (tw + pad_x * 2) * weight
            blk["h"] = len(lines) * line_h + pad_y * 2
            blk["_lines"] = lines

    # ---- 分层几何：band 内部块横排（居中均分），band 垂直堆叠
    band_w = []
    for band in g["bands"]:
        inner = sum(b["w"] for b in band["blocks"]) + gap_blk * (len(band["blocks"]) - 1)
        title_w = (d0.textlength(band["title"], font=f_lab) + 2 * pad_x) if band["title"] else 0
        band_w.append(max(inner, title_w, 80 * SS) + band_pad * 2)
    W = int(max(band_w) + 2 * margin_x + gutter_w)
    inner_w = max(band_w)  # 各层框同宽——视觉对齐专利分层框图惯例

    y = margin_y
    band_x0 = margin_x
    for i, band in enumerate(g["bands"]):
        bh = max(b["h"] for b in band["blocks"])
        title_h = band_title_h if band["title"] else 0
        band["x"] = band_x0
        band["y"] = y
        band["w"] = inner_w
        band["h"] = bh + band_pad * 2 + title_h
        band["_content_y"] = y + band_pad + title_h
        # 块在带内水平居中均排
        inner = sum(b["w"] for b in band["blocks"]) + gap_blk * (len(band["blocks"]) - 1)
        bx = band_x0 + (inner_w - inner) / 2
        for blk in band["blocks"]:
            blk["x"] = bx
            blk["y"] = band["_content_y"]
            blk["x2"] = bx + blk["w"]
            blk["y2"] = band["_content_y"] + blk["h"]
            blk["cx"] = bx + blk["w"] / 2
            blk["cy"] = band["_content_y"] + blk["h"] / 2
            bx += blk["w"] + gap_blk
        y += band["h"] + gap_band
    H = int(y - gap_band + margin_y)

    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    node_by_id = g["nodes"]
    for band in g["bands"]:
        for blk in band["blocks"]:
            node_by_id[blk["id"]]["_b"] = blk

    def blk(nid):
        return node_by_id[nid]["_b"]

    # ---- 层框（虚线边界，题注左上）
    for band in g["bands"]:
        x0, y0, x1, y1 = band["x"], band["y"], band["x"] + band["w"], band["y"] + band["h"]
        if band["title"]:
            _dashed(d, [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
            d.text((x0 + 12 * SS, y0 + 6 * SS), band["title"], fill="black", font=f_lab)

    # ---- 边（全部正交折线）
    def port_down(b):
        return b["cx"], b["y2"]

    def port_up(b):
        return b["cx"], b["y"]

    def port_right(b):
        return b["x2"], b["cy"]

    def port_left(b):
        return b["x"], b["cy"]

    def draw_edge(e):
        a = blk(e["from"])
        b = blk(e["to"])
        lab = e["label"]
        dashed = e["dashed"]
        pen = (lambda pts: _dashed(d, pts)) if dashed else (lambda pts: d.line(pts, fill="black", width=2 * SS, joint="curve"))
        band_a = node_by_id[e["from"]]["band"]
        band_b = node_by_id[e["to"]]["band"]

        if band_b > band_a and band_b - band_a == 1:
            # 下向相邻跨层：出底部 → 层间车道横移 → 入顶部（车道/框内均为空域）
            sx, sy = port_down(a)
            tx, ty = port_up(b)
            lane_y = g["bands"][band_a]["y"] + g["bands"][band_a]["h"] + gap_band / 2
            if abs(sx - tx) < 4 * SS:
                pts = [(sx, sy), (tx, ty)]
            else:
                pts = [(sx, sy), (sx, lane_y), (tx, lane_y), (tx, ty)]
            pen(pts)
            _tip(d, tx, ty, tx, lane_y if abs(sx - tx) >= 4 * SS else sy)
            if lab:
                lx = min(max((sx + tx) / 2, d.textlength(lab, font=f_lab) / 2 + 8 * SS),
                         W - gutter_w - d.textlength(lab, font=f_lab) / 2 - 8 * SS)
                d.rectangle([lx - d.textlength(lab, font=f_lab) / 2 - 4 * SS, lane_y - 13 * SS,
                             lx + d.textlength(lab, font=f_lab) / 2 + 4 * SS, lane_y + 13 * SS],
                            fill="white")
                d.text((lx, lane_y), lab, fill="black", font=f_lab, anchor="mm")
        elif band_b > band_a:
            # 下向跨多层：竖直段会穿过中间层块区——全程走空车道：出底部 →
            # 层间车道横移至右沟槽 → 沟槽竖行 → 目标层上车道横移 → 入顶部
            sx, sy = port_down(a)
            tx, ty = port_up(b)
            lane_a = g["bands"][band_a]["y"] + g["bands"][band_a]["h"] + gap_band / 2
            lane_b = g["bands"][band_b - 1]["y"] + g["bands"][band_b - 1]["h"] + gap_band / 2
            gx = W - margin_x - gutter_w / 2
            pts = [(sx, sy), (sx, lane_a), (gx, lane_a), (gx, lane_b), (tx, lane_b), (tx, ty)]
            pen(pts)
            _tip(d, tx, ty, tx, lane_b)
            if lab:
                ly = (lane_a + lane_b) / 2
                tw = d.textlength(lab, font=f_lab)
                d.rectangle([gx - tw / 2 - 4 * SS, ly - 13 * SS,
                             gx + tw / 2 + 4 * SS, ly + 13 * SS], fill="white")
                d.text((gx, ly), lab, fill="black", font=f_lab, anchor="mm")
        elif band_b == band_a:
            # 同层边：出顶部 → 带内顶车道横移 → 入目标顶部
            sx, sy = port_up(a)
            tx, ty = port_up(b)
            lane_y = a["y"] - (gap_blk * 0.55)
            pts = [(sx, sy), (sx, lane_y), (tx, lane_y), (tx, ty)]
            pen(pts)
            _tip(d, tx, ty, tx, lane_y)
            if lab:
                d.rectangle([(sx + tx) / 2 - d.textlength(lab, font=f_lab) / 2 - 4 * SS,
                             lane_y - 13 * SS,
                             (sx + tx) / 2 + d.textlength(lab, font=f_lab) / 2 + 4 * SS,
                             lane_y + 13 * SS], fill="white")
                d.text(((sx + tx) / 2, lane_y), lab, fill="black", font=f_lab, anchor="mm")
        else:
            # 回授/上行边：出底部 → 层间车道横移至右沟槽 → 沟槽竖行 →
            # 目标层下车道横移 → 自下方入目标块底部（全程空车道，不穿任何块/框）
            sx, sy = port_down(a)
            tx, ty = port_down(b)
            lane_a = g["bands"][band_a]["y"] + g["bands"][band_a]["h"] + gap_band / 2
            lane_b = g["bands"][band_b]["y"] + g["bands"][band_b]["h"] + gap_band / 2
            gx = W - margin_x - gutter_w / 2
            pts = [(sx, sy), (sx, lane_a), (gx, lane_a), (gx, lane_b), (tx, lane_b), (tx, ty)]
            pen(pts)
            _tip(d, tx, ty, tx, lane_b)
            if lab:
                ly = (lane_a + lane_b) / 2
                tw = d.textlength(lab, font=f_lab)
                d.rectangle([gx - tw / 2 - 4 * SS, ly - 13 * SS,
                             gx + tw / 2 + 4 * SS, ly + 13 * SS], fill="white")
                d.text((gx, ly), lab, fill="black", font=f_lab, anchor="mm")

    for e in g["edges"]:
        draw_edge(e)

    # ---- 块（实线框 + 居中文字；菱形判据）
    for band in g["bands"]:
        for b in band["blocks"]:
            if b["shape"] == "spacer":
                continue  # 占位块只占位不绘制（端口仍可用作汇边节点）
            x0, y0, x1, y1 = b["x"], b["y"], b["x2"], b["y2"]
            if b["shape"] == "diamond":
                cx, cy = b["cx"], b["cy"]
                d.polygon([(cx, y0 - 8 * SS), (x1 + 10 * SS, cy), (cx, y1 + 8 * SS),
                           (x0 - 10 * SS, cy)], outline="black", width=2 * SS)
            else:
                d.rectangle([x0, y0, x1, y1], outline="black", width=2 * SS)
            ty = y0 + pad_y
            for t in b["_lines"]:
                tw = d.textlength(t, font=f_node)
                d.text((b["cx"] - tw / 2, ty), t, fill="black", font=f_node)
                ty += line_h

    return img.resize((W * 2 // SS, H * 2 // SS), Image.LANCZOS)


RENDER_VERSION = "2"


def render_spec_to(spec, path):
    """render_figspec → 写 PNG 文件（带渲染版本印记，供派生物失新判定）。
    spec 可为 dict/JSON 字符串/.spec 文件路径。"""
    src = spec
    if isinstance(spec, str) and os.path.isfile(spec):
        with open(spec, encoding="utf-8") as f:
            src = f.read()
    img = render_figspec(src)
    from PIL.PngImagePlugin import PngInfo
    meta = PngInfo()
    meta.add_text("figspec_version", RENDER_VERSION)
    tmp = str(path) + ".tmp.png"
    img.save(tmp, "PNG", pnginfo=meta)
    os.replace(tmp, path)
    return path


def validate_figspec(spec):
    """不渲染只校验：返回错误信息或 None。"""
    try:
        parse_figspec(spec)
        return None
    except ValueError as e:
        return str(e)


def mmd_to_spec(src):
    """mermaid 图源 → figspec JSON（画板「转 .spec 画布」用，结构 1:1 映射）。

    分层规则：subgraph → 同名 band；无 subgraph 时按拓扑 rank 分层
    （TB/BT 纵向流一 rank 一层；LR/RL 横向流全部进单 band 保横排手感）。
    `-.->` 虚线边、diamond 判据、块 label 原样携带。返回规范化 dict。"""
    from patent_docx._mmd_parse import parse_mmd

    g = parse_mmd(src)
    if g is None or not g.nodes:
        raise ValueError("mmd 无可转换节点")

    order = {nid: i for i, nid in enumerate(g.nodes)}

    def blocks_of(nids):
        out = []
        for nid in nids:
            n = g.nodes[nid]
            blk = {"id": nid, "label": n.label}
            if n.shape == "diamond":
                blk["shape"] = "diamond"
            out.append(blk)
        return out

    bands = []
    used = set()
    if g.clusters:
        for cid, cl in g.clusters.items():
            members = sorted((nid for nid in cl["members"] if nid in g.nodes),
                             key=lambda n: (g.nodes[n].rank, order[n]))
            if members:
                bands.append({"title": cl["label"], "blocks": blocks_of(members)})
                used.update(members)
        rest = [nid for nid in g.nodes if nid not in used]
        for rk in sorted({g.nodes[n].rank for n in rest}):
            grp = sorted((n for n in rest if g.nodes[n].rank == rk), key=order.get)
            bands.append({"title": "", "blocks": blocks_of(grp)})
    elif g.direction in ("LR", "RL"):
        nids = sorted(g.nodes, key=lambda n: (g.nodes[n].rank, order[n]))
        if g.direction == "RL":
            nids.reverse()
        bands.append({"title": "", "blocks": blocks_of(nids)})
    else:
        ranks = sorted({g.nodes[n].rank for n in g.nodes},
                       reverse=(g.direction == "BT"))
        for rk in ranks:
            grp = sorted((n for n in g.nodes if g.nodes[n].rank == rk), key=order.get)
            bands.append({"title": "", "blocks": blocks_of(grp)})

    edges = []
    for a, b, lab in g.edges:
        e = {"from": a, "to": b}
        if lab:
            e["label"] = lab
        if (a, b) in g.dashed:
            e["dashed"] = True
        edges.append(e)

    norm = parse_figspec({"bands": bands, "edges": edges})
    return {"bands": norm["bands"], "edges": norm["edges"]}
