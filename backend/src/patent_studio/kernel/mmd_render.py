# -*- coding: utf-8 -*-
"""figs-src/*.mmd → figs/*.png：受限 mermaid flowchart 语法的确定性线稿渲染。

覆盖 s1 figsrc 产图源的语法面：`flowchart LR|TD|TB`（`graph` 同义）、
节点 `ID[文本]`（方框）/`ID{文本}`（菱形判据）/`ID(文本)`/`ID((文本))`（圆角/圆点统一画圆角框）、
`subgraph ID[标题] … end`（虚线区框）、
边 `A-->B`、`A-->|标注|B`、`A-- 标注 -->B`、`A-.->B`（虚线边，数据/参数传递线惯例）、`A==>B`、`A---B`、多目标 `A-->B & C`。
不识别的行跳过；超集语法按尽力渲染（未知节点以 id 作标签）。
CNIPA 惯例：纯白底、黑色线稿、无填充色；超采样抗锯齿。
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

from patent_studio.kernel._mmd_parse import (  # noqa: F401 — 回引保留原命名空间
    _CHAIN_SEP,
    _EDGE_RES,
    _HEADER,
    _MARK_RE,
    _NODE,
    _SUBGRAPH,
    _Graph,
    _Node,
    _node_of,
    _split_edge_chain,
    _unquote,
    describe_graph,
    parse_mmd,
    validate_graph,
)

SS = 6  # 超采样倍率（出图按 SS/2 降采——终 PNG 为版心 2× 像素密度，印件不糊）
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
    # ASCII 词元原子化：英文/数字不在词中断行（「编码器 105」不断成「1\n05」）
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


def _mmd_to_dot(g):
    """_Graph → graphviz dot 源码（CNIPA：白底黑框、正交折线）。"""
    rankdir = "LR" if g.direction in ("LR", "RL") else "TB"
    esc = lambda s: str(s).replace("\\", "\\\\").replace('"', '\\"')
    lines = ["digraph G {", '  bgcolor="white";',
             '  node [shape=box, style="filled", fillcolor="white", color="black",'
             ' fontname="Noto Sans CJK SC", fontsize=12, margin="0.14,0.09"];',
             '  edge [color="black", arrowsize=0.7, fontname="Noto Sans CJK SC", fontsize=10];',
             f"  rankdir={rankdir};",
             "  nodesep=0.4; ranksep=0.6; splines=ortho; concentrate=true;"]
    for nid, n in g.nodes.items():
        shape = ("diamond" if n.shape == "diamond" else
                 "ellipse" if n.shape in ("round", "circ") else "box")
        lines.append(f'  {nid} [label="{esc(n.label or nid)}", shape={shape}];')
    for cid, cl in g.clusters.items():
        lines.append(f'  subgraph cluster_{cid} {{ label="{esc(cl["label"])}"; style=dashed;')
        for nid in cl["members"]:
            if nid in g.nodes:
                lines.append(f"    {nid};")
        lines.append("  }")
    for e in g.edges:
        a, b, lab = e[0], e[1], e[2] if len(e) > 2 else ""
        dashed = (a, b) in g.dashed
        attrs = [f'style={"dashed" if dashed else "solid"}']
        if lab:
            attrs.append(f'label="{esc(lab)}"')
        if (a, b) in g.bidir:
            attrs.append('dir=both')
        if dashed:
            # 辅助/回授边不参与 rank 约束——否则目标节点被拖向源节点右侧，
            # 并行双路被拉歪（dinov2-10 fig2 实案：教师网络被指数滑动平均边拖到末端）
            attrs.append('constraint=false')
        lines.append(f"  {a} -> {b} [{', '.join(attrs)}];")
    lines.append("}")
    return "\n".join(lines)


def _graphviz_worth_it(g):
    """复杂拓扑走 graphviz：分叉/汇流/虚线边/分组/回边存在时 PIL 车道布线
    会把跨跳边拉成横贯长线（dinov2-9 fig3 实案）；纯直链仍走 PIL——
    单列折行更贴合 15cm 版心（dot 单行缩进字会变小）。"""
    if g.dashed or g.clusters or g.bidir:
        return True
    out_deg, in_deg = {}, {}
    for a, b, _ in g.edges:
        out_deg[a] = out_deg.get(a, 0) + 1
        in_deg[b] = in_deg.get(b, 0) + 1
    if any(v > 1 for v in out_deg.values()) or any(v > 1 for v in in_deg.values()):
        return True
    return False


def _render_via_dot(g):
    """graphviz dot → PNG 字节。dot 缺失/失败 → None（调用方回落 PIL 路径）。"""
    import shutil
    import subprocess
    import tempfile
    if not shutil.which("dot"):
        return None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".dot", delete=False,
                                         encoding="utf-8") as f:
            f.write(_mmd_to_dot(g))
            dot_path = f.name
        png_path = dot_path + ".png"
        r = subprocess.run(["dot", "-Tpng", "-Gdpi=150", dot_path, "-o", png_path],
                           capture_output=True, timeout=30)
        if r.returncode != 0 or not os.path.isfile(png_path):
            return None
        with open(png_path, "rb") as f:
            return f.read()
    except Exception:
        return None
    finally:
        for p in (locals().get("dot_path"), locals().get("png_path")):
            try:
                if p:
                    os.unlink(p)
            except OSError:
                pass


def render_mmd(src, engine="auto"):
    """mmd 源码 → PIL Image（白底黑线）。无可渲染节点 → ValueError。
    engine: "auto" 复杂拓扑走 graphviz、纯直链走 PIL；"pil" 强制 PIL 自绘；
    "gv" 强制 graphviz（dot 不可用抛 ValueError）。"""
    g = parse_mmd(src)
    if g is None:
        raise ValueError("无可渲染节点")
    if engine == "gv":
        _gv = _render_via_dot(g)
        if _gv is None:
            raise ValueError("graphviz dot 不可用或渲染失败")
        _img = Image.open(__import__("io").BytesIO(_gv))
        _img.graph = g
        return _img
    # 复杂拓扑优先 graphviz 布局；dot 不可用/失败回落 PIL 自绘
    if engine == "auto" and _graphviz_worth_it(g):
        _gv = _render_via_dot(g)
        if _gv is not None:
            _img = Image.open(__import__("io").BytesIO(_gv))
            _img.graph = g
            return _img
    horiz = g.direction in ("LR", "RL")
    probe = Image.new("RGB", (8, 8))
    d0 = ImageDraw.Draw(probe)
    f_node = _font(20)
    f_lab = _font(16)
    pad_x, pad_y = 18 * SS, 12 * SS
    line_h = 26 * SS
    wrap_px = 200 * SS
    # ---- 尺寸
    for n in g.nodes.values():
        lines = _wrap(d0, n.label, f_node, wrap_px)
        n._lines = lines
        n.w = max(int(d0.textlength(t, font=f_node)) for t in lines) + 2 * pad_x
        n.w = min(max(n.w, 96 * SS), 400 * SS)
        n.h = len(lines) * line_h + 2 * pad_y
        n.h = min(max(n.h, 56 * SS), 200 * SS)
        if n.shape == "vstrip":
            # 竖排窄条（授权件 CN110458178B 图1 画法）：CJK 逐字纵列，≤4 位
            # ASCII 串横放一格——「第 101 检测单元」排成 第·1·0·1·检·测…
            # 不如 第·101·检·测… 可读
            entries = re.findall(r"[A-Za-z0-9_.-]{1,4}|.", n.label)
            n._vlines = entries
            n.w = line_h + 2 * pad_x
            n.h = len(entries) * line_h + 2 * pad_y
            n.h = min(max(n.h, 56 * SS), 560 * SS)
        elif n.shape == "diamond":
            n.w, n.h = int(n.w * 1.5), int(n.h * 1.7)
        elif n.shape == "circ":
            # 算子圈（授权件 ⊕/⊗ 画法）：首字符入圈，余文置圈右——
            # 「⊕」独立算子；「⊕ 代表相加」为图例行
            glyph = n.label[0] if n.label else ""
            n._glyph = glyph
            n._side = n.label[1:].strip()
            dw = int(d0.textlength(glyph, font=f_node)) + 20 * SS
            n._d = max(44 * SS, dw)
            side_w = int(d0.textlength(n._side, font=f_node)) if n._side else 0
            n.w = n._d + (10 * SS + side_w if n._side else 0)
            n.h = max(n._d, line_h + 2 * pad_y if n._side else n._d)
    # ---- 分层排位（rank 蛇形折带：预测长宽比 >3.8 时按 rank 切成多带——
    #  长链单带会产生极端长宽比，印进 15cm 版心字小如蚁（vit-11 实案 fig1 8.3:1））
    gap = 110 * SS
    gap_in = 56 * SS
    band_gap = 150 * SS

    # 连通分量：互不连通的成员沿交叉轴各占独立窗口——全局同层交叉轴互插会让
    # 多簇框体叠穿（resnet fig2 基本/瓶颈块、fig4 方案一/二整簇互压实案）
    adj_u = {}
    for a, b, _ in g.edges:
        if a in g.nodes and b in g.nodes:
            adj_u.setdefault(a, set()).add(b)
            adj_u.setdefault(b, set()).add(a)
    # 同簇成员布局上视同连通——无边单元节点（ddpm fig5 存储器 7 程序单元实案）
    # 各成单点分量、各占一窗口会横排成细条；簇成员沿嵌套传递展开并入同分量
    _expanded: dict = {}
    def _members(cid, _depth=0):
        if cid in _expanded:
            return _expanded[cid]
        if _depth > len(g.clusters):
            return [cid] if cid in g.nodes else []
        out: list = []
        for i in g.clusters[cid]["members"]:
            out += _members(i, _depth + 1) if i in g.clusters else ([i] if i in g.nodes else [])
        _expanded[cid] = out
        return out
    for cid in g.clusters:
        ms = _members(cid)
        for i in ms[1:]:
            adj_u.setdefault(ms[0], set()).add(i)
            adj_u.setdefault(i, set()).add(ms[0])
        if cid in g.nodes and ms:
            # 簇 id 幽灵端点（A --> MEM）也归进簇分量——否则孤立占位横移版图
            adj_u.setdefault(cid, set()).add(ms[0])
            adj_u.setdefault(ms[0], set()).add(cid)
    comps, _seen = [], set()
    for nid in g.nodes:
        if nid in _seen:
            continue
        comp, stack = set(), [nid]
        while stack:
            u = stack.pop()
            if u in comp:
                continue
            comp.add(u)
            _seen.add(u)
            stack.extend(v for v in adj_u.get(u, ()) if v not in comp)
        comps.append(sorted(comp, key=lambda i: list(g.nodes).index(i)))
    _pos = {nid: i for i, nid in enumerate(g.nodes)}
    comps.sort(key=lambda c: _pos[c[0]])

    def lay(members, nodes, k, wrap_cap=None):
        """分量内 rank 分 k 带排位，返回 (主跨, 交叉跨) 并就地写节点局部坐标。
        wrap_cap：rank 内兄弟沿交叉轴排布的预算——超预算折到下一视觉行
        （同 rank 多行），主轴按折行数增高。"""
        ranks = sorted({n.rank for n in nodes})
        # 带界不许劈开簇：簇成员跨带时框体按全跨包裹全图（resnet fig3 RB2 实案）——
        # 理想均分点若落进某簇 (min,max] 区间，改取最近的合法 rank 界
        spans = []
        for cl in g.clusters.values():
            m = [g.nodes[i] for i in cl["members"] if i in members]
            if m:
                spans.append((min(x.rank for x in m), max(x.rank for x in m)))

        ideals = [ranks[min(i * len(ranks) // k, len(ranks) - 1)] for i in range(1, k)]

        def _plan(spans_in):
            allowed_ = [rk for rk in ranks[1:] if all(not (lo < rk <= hi) for lo, hi in spans_in)]
            bounds_ = {min(allowed_, key=lambda rk: abs(rk - iv)) for iv in ideals} if allowed_ else set()
            bs, cur = [], []
            for rk in ranks:
                if rk in bounds_ and cur:
                    bs.append(cur)
                    cur = []
                cur.append(rk)
            bs.append(cur)
            return bs

        bands = _plan(spans)
        # 巨簇禁劈可致带仍塌成单链细条——链尾合法界点救不了 12 层串联全包簇
        # （yolo fig3 3606×548 实案）：先只放开 ≥2/3 rank 轴的巨簇，仍塌再全放；
        # 被劈簇由 _cluster_boxes 按带分段出框
        if spans and (len(bands) == 1 or max(len(b) for b in bands) > len(ranks) * 0.75):
            span_all = max(ranks) - min(ranks)
            for cand in ([s for s in spans if (s[1] - s[0]) < span_all * 0.66], []):
                if cand == spans:
                    continue
                b2 = _plan(cand)
                if len(b2) > 1 and max(len(b) for b in b2) < max(len(b) for b in bands):
                    bands, spans = b2, cand
                    break
        band_span, cross = 0, 0
        for bi, band in enumerate(bands):
            acc_main, band_cross = 0, 0
            band_lines = []      # [(行内节点, 行跨)]——带内居中用
            for r in band:
                rnodes = [n for n in nodes if n.rank == r]
                dim = max((n.w if horiz else n.h) for n in rnodes)
                rank_off = acc_main
                line_pitch = dim + gap_in * 0.5
                off, line = 0, 0
                row_nodes, row_span = [], 0.0
                for n in rnodes:
                    n._band = bi
                    cross_dim = n.h if horiz else n.w
                    if wrap_cap and off > 0 and off + cross_dim > wrap_cap:
                        band_lines.append((row_nodes, row_span))
                        row_nodes, row_span = [], 0.0
                        line += 1
                        off = 0
                    if horiz:
                        n.x, n.y = rank_off + line * line_pitch, cross + off
                    else:
                        n.x, n.y = cross + off, rank_off + line * line_pitch
                    row_nodes.append(n)
                    off += cross_dim
                    row_span = off
                    band_cross = max(band_cross, off)
                    off += gap_in
                band_lines.append((row_nodes, row_span))
                acc_main += dim + line * line_pitch + gap
            band_span = max(band_span, acc_main - gap)
            # 带内各行按带宽居中——串联列节点垂直共轴（边成直线）、
            # 同层并联组水平对中（unet-seg fig2/3 左缘顺排斜连实案）
            for row_nodes, row_span in band_lines:
                shift = (band_cross - row_span) / 2
                if shift <= 0:
                    continue
                for n in row_nodes:
                    if horiz:
                        n.y += shift
                    else:
                        n.x += shift
            cross += band_cross + band_gap
        return band_span, cross - band_gap

    def fit(members, nodes):
        """分量内重排 rank（分量间无秩系）+ 折带/折行决策，返回 (主跨, 交叉跨)。"""
        for n in nodes:
            n.rank = 0
        for _ in range(len(nodes) + 1):
            moved = False
            for a, b, _ in g.edges:
                if (a, b) in g.back_edges or a not in members or b not in members:
                    continue
                if g.nodes[a].rank + 1 > g.nodes[b].rank:
                    g.nodes[b].rank = g.nodes[a].rank + 1
                    moved = True
            if not moved:
                break
        # 边指簇 id 的幽灵端点把 rank 传给簇成员——`CPU-->MEM` 应让整个存储器
        # 沉一层（成员无边时停 rank0 会与 CPU 同排，ddpm fig5 实案）
        for _cid in g.clusters:
            if _cid in members and _cid in g.nodes:
                _r = g.nodes[_cid].rank
                for _m in _members(_cid):
                    if _m in members and g.nodes[_m].rank < _r:
                        g.nodes[_m].rank = _r
        n_ranks = len({n.rank for n in nodes})
        k, (sm, sc) = 1, lay(members, nodes, 1)
        # 主轴过度延伸（LR 太宽 / TD 太高）则加带；主轴对应版心 15cm 宽，侧轴过深字会缩
        limit = 3.8 if horiz else 2.6
        # 纯串联链例外：授权件惯例图1就是单列长链（CN112364654B 4节点单列），
        # 拆带蛇形反而业余——单链放宽长宽比，宁细高不拆列
        rank_sizes = [sum(1 for n in nodes if n.rank == r) for r in sorted({n.rank for n in nodes})]
        if rank_sizes and max(rank_sizes) == 1:
            limit = 6.0
        while n_ranks > k and sm > sc * limit:
            k += 1
            sm, sc = lay(members, nodes, k)
        # 反向极端：同层兄弟过多把交叉轴撑成矮/窄条（ddpm fig5 1999×472 实案，
        # 8 个无入边单元同 rank 铺一行）——rank 行按交叉轴预算折行，长宽比压回限内
        cross_limit = 2.0 if horiz else 2.2
        for _ in range(4):
            if sc <= sm * cross_limit:
                break
            sm, sc = lay(members, nodes, k, wrap_cap=max(sm * cross_limit, 600 * SS))
        return sm, sc

    margin = 40 * SS
    lane_w, lane_pad = 26 * SS, 30 * SS

    # pass 1：各分量内布局（局部坐标）；带/折行定好后绕行边归属才可判定
    comp_nodes, comp_span = [], []
    for ci, comp in enumerate(comps):
        nodes = [g.nodes[i] for i in comp]
        sm, sc = fit(comp, nodes)
        nbands = max(n._band for n in nodes) + 1
        for n in nodes:
            n._comp = ci
            n._comp_bands = nbands
        comp_nodes.append(nodes)
        comp_span.append((sm, sc))

    def routed_kind(a, b):
        """'back' 回边 / 'fwd' 前向跨层或跨带 / None 邻层直连。"""
        if (a, b) in g.back_edges:
            return 'back'
        na, nb = g.nodes[a], g.nodes[b]
        if nb.rank - na.rank > 1 or na._band != nb._band:
            return 'fwd'
        return None

    def lane_of(a, b, kind):
        """绕行边车道归属：('gap', (分量,带)) 带间通道 | ('in', 0) 窗口内侧边 | ('out', 0) 窗口外侧边。"""
        na = g.nodes[a]
        bi = na._band
        if kind == 'back':
            return ('gap', (na._comp, bi - 1)) if bi > 0 else ('in', 0)
        return ('gap', (na._comp, bi)) if bi < na._comp_bands - 1 else ('out', 0)

    routed = {(a, b): (lab, kind, lane_of(a, b, kind))
              for a, b, lab in g.edges if (kind := routed_kind(a, b))}
    # 分量内绕行车道计数：in/out 车道只走本分量窗口上下侧的分量间隙——
    # 画布级最边车道会纵穿其它分量窗口（resnet fig4 残差映射边绕全底实案）
    in_cnt = {ci: 0 for ci in range(len(comps))}
    out_cnt = {ci: 0 for ci in range(len(comps))}
    for (a, _b), (_, _, ln) in routed.items():
        ci = g.nodes[a]._comp
        if ln[0] == 'in':
            in_cnt[ci] += 1
        elif ln[0] == 'out':
            out_cnt[ci] += 1
    in_space = {ci: (lane_pad + in_cnt[ci] * lane_w if in_cnt[ci] else 0.0) for ci in in_cnt}
    out_space = {ci: (lane_pad + out_cnt[ci] * lane_w if out_cnt[ci] else 0.0) for ci in out_cnt}

    # pass 2：分量沿交叉轴顺排，间隙里夹带两侧分量的绕行车道位
    comp_gap = band_gap * 1.4
    cur = float(in_space[0]) if comps else 0.0
    span_main = 0.0
    for ci, nodes in enumerate(comp_nodes):
        sm, sc = comp_span[ci]
        for n in nodes:
            if horiz:
                n.y += cur
            else:
                n.x += cur
        cur += sc + comp_gap + out_space[ci] + (in_space[ci + 1] if ci + 1 < len(comps) else 0.0)
        span_main = max(span_main, sm)
    span_cross = cur - comp_gap
    if horiz:
        W, H = int(span_main) + 2 * margin, int(span_cross) + 2 * margin
    else:
        W, H = int(span_cross) + 2 * margin, int(span_main) + 2 * margin
    # 节点归位：外边距
    for n in g.nodes.values():
        n.x += margin
        n.y += margin
    # 图例子图停角：LEG/图例簇成员整组平移至与非成员重叠最少的角（授权件惯例）
    for _cid, cl in g.clusters.items():
        if "图例" not in cl["label"] and not _cid.upper().startswith("LEG"):
            continue
        mem = [g.nodes[i] for i in cl["members"] if i in g.nodes]
        if not mem:
            continue
        # 按画框口径的外扩包围盒选角：框体向四周再扩 16·SS、向顶扩 44·SS 放簇标题——
        # 只按成员包围盒停角，顶部候选把簇标题裁出画布（ddpm fig3 图例框冒顶实案）
        box_l, box_t, box_r, box_b = 16 * SS, 44 * SS, 16 * SS, 16 * SS
        bw = max(n.x + n.w for n in mem) - min(n.x for n in mem) + box_l + box_r
        bh = max(n.y + n.h for n in mem) - min(n.y for n in mem) + box_t + box_b
        bx0, by0 = min(n.x for n in mem), min(n.y for n in mem)
        pad = 34 * SS
        others = [n for i, n in g.nodes.items() if i not in cl["members"]]

        def overlap(cx0, cy0, others=others, bw=bw, bh=bh, pad=pad):
            s = 0
            for n in others:
                ix = min(cx0 + bw + pad, n.x + n.w) - max(cx0 - pad, n.x)
                iy = min(cy0 + bh + pad, n.y + n.h) - max(cy0 - pad, n.y)
                s += max(0, ix) * max(0, iy)
            return s

        cands = [(W - bw - pad, pad), (W - bw - pad, H - bh - pad),
                 (pad, pad), (pad, H - bh - pad)]
        cands = [(min(max(x, 0), max(0, W - bw)), min(max(y, 0), max(0, H - bh)))
                 for x, y in cands]
        tx, ty = min(cands, key=lambda c: overlap(*c))
        dx, dy = tx - (bx0 - box_l), ty - (by0 - box_t)
        for n in mem:
            n.x += dx
            n.y += dy
    # circ 节点侧文本不占 n.w——图例簇框按有效右缘计，侧文本不再压出框外
    def _eff_right(n):
        r = n.x + n.w
        if getattr(n, "shape", "") == "circ" and getattr(n, "_side", ""):
            r += 12 * SS + d0.textlength(n._side, font=f_node)
        return r

    def _cluster_box(cl):
        mem = [g.nodes[i] for i in cl["members"] if i in g.nodes]
        if not mem:
            return None
        return (min(n.x for n in mem) - 16 * SS,
                min(n.y for n in mem) - 44 * SS,
                max(_eff_right(n) for n in mem) + 16 * SS,
                max(n.y + n.h for n in mem) + 16 * SS)

    def _cluster_boxes(_cid, cl):
        """按（分量, 带）分段出簇框——巨簇被劈带后每段独立成框，簇题只标首段。
        未劈簇成员同属一带 → 单框，与旧行为等价。成员按嵌套展开且跳过幽灵端点。"""
        mem = [g.nodes[i] for i in _members(_cid)
               if i in g.nodes and not getattr(g.nodes[i], "_ghost", False)]
        by_band: dict = {}
        for n in mem:
            by_band.setdefault((n._comp, n._band), []).append(n)
        boxes = []
        for key in sorted(by_band):
            m = by_band[key]
            boxes.append((min(n.x for n in m) - 16 * SS,
                          min(n.y for n in m) - (44 if not boxes else 16) * SS,
                          max(_eff_right(n) for n in m) + 16 * SS,
                          max(n.y + n.h for n in m) + 16 * SS))
        return boxes

    # 边指 subgraph id（MEM -->|存储| PRG）：该 id 被落成幽灵节点框（ddpm fig5
    # 底部「PRG」块实案）——几何改指其簇框、本体不画，边端口自然打到区框
    # 边界。须在界外兜底扫之前改写：幽灵随整组一起平移，坐标才自洽
    for _cid, cl in g.clusters.items():
        if _cid in g.nodes:
            box = _cluster_box(cl)
            if box is not None:
                n = g.nodes[_cid]
                n.x, n.y, n.w, n.h = box[0], box[1], box[2] - box[0], box[3] - box[1]
                n._ghost = True
    # 普通簇框外扩超界兜底：成员贴外边距（margin 40·SS < 标题外扩 44·SS）时
    # 框顶冒画布外、簇标题被裁（ddpm fig5「训练模块 101」标题截半实案）——
    # 整组移回界内并放大画布，移扫在带间车道计算前口径一致
    _dx = _dy = 0.0
    for _cid, cl in g.clusters.items():
        mem = [g.nodes[i] for i in cl["members"] if i in g.nodes]
        if not mem:
            continue
        _dx = max(_dx, 16 * SS - min(n.x for n in mem))
        _dy = max(_dy, 44 * SS - min(n.y for n in mem))
    if _dx > 0 or _dy > 0:
        for n in g.nodes.values():
            n.x += _dx
            n.y += _dy
        W += int(_dx)
        H += int(_dy)
    # 右/下向对称兜底：簇框右缘/底缘外扩 16·SS 出画布时撑大画布——
    # 否则区框虚线被裁（ddpm fig5 右缘节点贴边实案）
    _rx = _by = 0.0
    for _cid, cl in g.clusters.items():
        mem = [g.nodes[i] for i in cl["members"] if i in g.nodes]
        if not mem:
            continue
        _rx = max(_rx, max(n.x + n.w for n in mem) + 16 * SS - W)
        _by = max(_by, max(n.y + n.h for n in mem) + 16 * SS - H)
    W += int(max(0.0, _rx))
    H += int(max(0.0, _by))
    # 带间通道中线 + 各车道位（分量各自成系，同通道多车道按边数居中排开）
    ext = {}
    for n in g.nodes.values():
        lo_c, hi_c = (n.y, n.y + n.h) if horiz else (n.x, n.x + n.w)
        e = ext.setdefault((n._comp, n._band), [1e18, -1e18])
        e[0] = min(e[0], lo_c)
        e[1] = max(e[1], hi_c)
    gap_c = {k: (ext[k][1] + ext[(k[0], k[1] + 1)][0]) / 2
             for k in ext if (k[0], k[1] + 1) in ext}
    # in/out 车道按本分量窗口上下缘定（车道落在分量间隙内，不穿别家窗口）
    comp_lo, comp_hi = {}, {}
    for n in g.nodes.values():
        lo_c, hi_c = (n.y, n.y + n.h) if horiz else (n.x, n.x + n.w)
        comp_lo[n._comp] = min(comp_lo.get(n._comp, 1e18), lo_c)
        comp_hi[n._comp] = max(comp_hi.get(n._comp, -1e18), hi_c)
    gap_cnt, gap_seen, lane_pos = {}, {}, {}
    for _, _, ln in routed.values():
        if ln[0] == 'gap':
            gap_cnt[ln[1]] = gap_cnt.get(ln[1], 0) + 1
    li_in, li_out = {}, {}
    for (a, b), (_, _, ln) in routed.items():
        ci = g.nodes[a]._comp
        if ln[0] == 'gap':
            gi = ln[1]
            idx = gap_seen.get(gi, 0)
            gap_seen[gi] = idx + 1
            lane_pos[(a, b)] = gap_c[gi] + (idx - (gap_cnt[gi] - 1) / 2) * lane_w
        elif ln[0] == 'in':
            lane_pos[(a, b)] = comp_lo[ci] - lane_pad - li_in.get(ci, 0) * lane_w
            li_in[ci] = li_in.get(ci, 0) + 1
        else:
            lane_pos[(a, b)] = comp_hi[ci] + lane_pad + li_out.get(ci, 0) * lane_w
            li_out[ci] = li_out.get(ci, 0) + 1
    # 直边穿节点检测：邻层直连边的端口连线中途若穿过无关节点，改走本分量外侧
    # 车道（ddpm fig5 CPU-->生成图像 斜穿「存储器」簇内程序单元实案）
    for a, b, lab in g.edges:
        if (a, b) in routed:
            continue
        na, nb = g.nodes[a], g.nodes[b]
        ax, ay = na.x + na.w / 2, na.y + na.h / 2
        bx, by = nb.x + nb.w / 2, nb.y + nb.h / 2
        hit = False
        for n in g.nodes.values():
            if n in (na, nb) or getattr(n, "_ghost", False):
                continue
            for t in (0.2, 0.35, 0.5, 0.65, 0.8):
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                if n.x <= px <= n.x + n.w and n.y <= py <= n.y + n.h:
                    hit = True
                    break
            if hit:
                break
        if not hit:
            continue
        ci = na._comp
        routed[(a, b)] = (lab, 'fwd', ('out', 0))
        lane_pos[(a, b)] = comp_hi[ci] + lane_pad + li_out.get(ci, 0) * lane_w
        li_out[ci] = li_out.get(ci, 0) + 1
        _lane_edge = comp_hi[ci] + lane_pad + (li_out[ci] - 1) * lane_w + lane_w + margin
        if horiz:
            H = max(H, int(_lane_edge))
        else:
            W = max(W, int(_lane_edge))
    img = Image.new("RGB", (max(W, 64), max(H, 64)), "white")
    d = ImageDraw.Draw(img)

    def dashed_line(pts):
        """分组边界虚线：沿折线按 dash/gap 段铺画。"""
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

    # ---- 区框（虚线边界——分组记号非数据边，实线会被读成断头边）
    _titles: list[tuple[float, float, float, float]] = []
    for _cid, cl in g.clusters.items():
        boxes = _cluster_boxes(_cid, cl)
        for bi, (x0, y0, x1, y1) in enumerate(boxes):
            dashed_line([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
            if bi > 0:
                continue  # 簇题只标首段框
            # 嵌套簇共顶边时标题逐字下移——「电子设备 110」与「计算机程序」同位叠印实案
            tw = d.textlength(cl["label"], font=f_lab)
            th = 30 * SS
            tx, ty = x0 + 10 * SS, y0 + 8 * SS
            while any(min(ty + th, t[3]) - max(ty, t[1]) > 0 and
                      min(tx + tw, t[2]) - max(tx, t[0]) > 0 for t in _titles):
                ty += th + 4 * SS
            _titles.append((tx, ty, tx + tw, ty + th))
            d.text((tx, ty), cl["label"], fill="black", font=f_lab)
    # ---- 边（框边中点直连 + 三角箭头）
    def port(n, toward):
        cx, cy = n.x + n.w / 2, n.y + n.h / 2
        dx, dy = toward.x + toward.w / 2 - cx, toward.y + toward.h / 2 - cy
        if n.shape == "diamond":
            t = 1.0 / (abs(dx) / (n.w / 2 + 1) + abs(dy) / (n.h / 2 + 1) + 1e-9)
            return cx + dx * t, cy + dy * t
        tx = (n.w / 2) / abs(dx) if dx else 1e9
        ty = (n.h / 2) / abs(dy) if dy else 1e9
        t = min(tx, ty)
        return cx + dx * t, cy + dy * t

    def arrow_tip(px, py, fx, fy):
        import math
        ang = math.atan2(py - fy, px - fx)
        l = 16 * SS
        for s in (-1, 1):
            d.line([px, py,
                    px - l * math.cos(ang + s * 0.42), py - l * math.sin(ang + s * 0.42)],
                   fill="black", width=3 * SS)

    def draw_label(lab, mx, my):
        tw = d.textlength(lab, font=f_lab)
        # 边标签钳回画布内——外车道上的标签中心靠边时文字不再裁出图外
        # （ddpm-r85 fig3「时间嵌入注入」右缘截断实案）
        mx = min(max(mx, tw / 2 + 6 * SS), W - tw / 2 - 6 * SS)
        d.rectangle([mx - tw / 2 - 4 * SS, my - 14 * SS,
                     mx + tw / 2 + 4 * SS, my + 14 * SS], fill="white")
        d.text((mx, my), lab, fill="black", font=f_lab, anchor="mm")

    # 标签迟画：中点落上节点时先被盖住（fig5「反向转移核」首字压进 图像输出）——
    # 记位延后到节点画完再补，白底掩线本就该在最上层
    pending_labels: list[tuple[str, float, float]] = []
    for a, b, lab in g.edges:
        na, nb = g.nodes[a], g.nodes[b]
        if (a, b) in routed:
            # 绕行：源/宿按车道方位进出边中点，直交折线走带间通道或外边车道
            lane = lane_pos[(a, b)]
            if horiz:
                p0 = (na.x + na.w / 2, na.y + na.h if lane > na.y + na.h / 2 else na.y)
                p3 = (nb.x + nb.w / 2, nb.y if lane < nb.y + nb.h / 2 else nb.y + nb.h)
                pts = [p0, (p0[0], lane), (p3[0], lane), p3]
            else:
                p0 = (na.x + na.w if lane > na.x + na.w / 2 else na.x, na.y + na.h / 2)
                p3 = (nb.x if lane < nb.x + nb.w / 2 else nb.x + nb.w, nb.y + nb.h / 2)
                pts = [p0, (lane, p0[1]), (lane, p3[1]), p3]
            if (a, b) in g.dashed:
                dashed_line(pts)
            else:
                d.line(pts, fill="black", width=3 * SS)
            arrow_tip(pts[3][0], pts[3][1], pts[2][0], pts[2][1])
            if (a, b) in g.bidir:
                arrow_tip(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
            if lab:
                pending_labels.append(
                    (lab, (pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2,
                     pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]))
            continue
        x0, y0 = port(na, nb)
        x1, y1 = port(nb, na)
        if (a, b) in g.dashed:
            dashed_line([(x0, y0), (x1, y1)])
        else:
            d.line([x0, y0, x1, y1], fill="black", width=3 * SS)
        arrow_tip(x1, y1, x0, y0)
        if (a, b) in g.bidir:
            arrow_tip(x0, y0, x1, y1)
        if lab:
            pending_labels.append(
                (lab, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0))
    # ---- 节点
    for n in g.nodes.values():
        if getattr(n, "_ghost", False):
            continue  # subgraph 幽灵端点：几何=簇框，本体不画
        if n.shape == "diamond":
            cx, cy = n.x + n.w / 2, n.y + n.h / 2
            d.polygon([(cx, n.y), (n.x + n.w, cy), (cx, n.y + n.h), (n.x, cy)],
                      fill="white", outline="black", width=3 * SS)
        elif n.shape == "vstrip":
            d.rectangle([n.x, n.y, n.x + n.w, n.y + n.h], fill="white",
                        outline="black", width=3 * SS)
            cy = n.y + (n.h - len(n._vlines) * line_h) / 2 + line_h / 2
            for t in n._vlines:
                d.text((n.x + n.w / 2, cy), t, fill="black",
                       font=f_node, anchor="mm")
                cy += line_h
            continue
        elif n.shape == "circ":
            cy_mid = n.y + n.h / 2
            d.ellipse([n.x, cy_mid - n._d / 2, n.x + n._d, cy_mid + n._d / 2],
                      fill="white", outline="black", width=3 * SS)
            d.text((n.x + n._d / 2, cy_mid), n._glyph, fill="black",
                   font=f_node, anchor="mm")
            if n._side:
                tw = d.textlength(n._side, font=f_node)
                sx = min(n.x + n._d + 10 * SS,
                         max(n.x + n._d + 4 * SS, W - tw - 6 * SS))
                d.text((sx, cy_mid), n._side, fill="black",
                       font=f_node, anchor="lm")
            continue
        elif n.shape == "round":
            d.rounded_rectangle([n.x, n.y, n.x + n.w, n.y + n.h],
                                radius=min(n.h // 2, 18 * SS), fill="white",
                                outline="black", width=3 * SS)
        else:
            d.rectangle([n.x, n.y, n.x + n.w, n.y + n.h], fill="white",
                        outline="black", width=3 * SS)
        cy = n.y + (n.h - len(n._lines) * line_h) / 2 + line_h / 2
        for t in n._lines:
            d.text((n.x + n.w / 2, cy), t, fill="black", font=f_node, anchor="mm")
            cy += line_h
    # 标签压节点/标签让位：中点落点上与节点相交时迟画压框，两标签同位又互压
    # （fig5「反向转移核」压「采样模块 110」与「生成图像」三叠实案）——垂向
    # 让不开再沿边轴向让，候选串行试位；原位无撞不动、全撞留原位
    placed_rects: list[tuple[float, float, float, float]] = []
    for lab, lx, ly, edx, edy in pending_labels:
        tw = d.textlength(lab, font=f_lab)

        def _lab_rect(xx, yy, tw=tw):
            return (xx - tw / 2 - 4 * SS, yy - 14 * SS,
                    xx + tw / 2 + 4 * SS, yy + 14 * SS)

        def _lab_hit(xx, yy, tw=tw, nodes=g.nodes, placed=placed_rects):
            x0, y0, x1, y1 = _lab_rect(xx, yy, tw)
            for n in nodes.values():
                if getattr(n, "_ghost", False):
                    continue  # 区框幽灵端点不作节点障碍——边界标签照常落位
                if min(x1, n.x + n.w) - max(x0, n.x) > 0 and \
                        min(y1, n.y + n.h) - max(y0, n.y) > 0:
                    return True
            for px0, py0, px1, py1 in placed:
                if min(x1, px1) - max(x0, px0) > 0 and min(y1, py1) - max(y0, py0) > 0:
                    return True
            return False

        if _lab_hit(lx, ly):
            _n = (edx * edx + edy * edy) ** 0.5 or 1.0
            ux, uy = edx / _n, edy / _n   # 边单位向量
            nx_, ny_ = -uy, ux            # 法向
            cands = [(lx + nx_ * 20 * SS, ly + ny_ * 20 * SS),
                     (lx - nx_ * 20 * SS, ly - ny_ * 20 * SS),
                     (lx + ux * 24 * SS, ly + uy * 24 * SS),
                     (lx - ux * 24 * SS, ly - uy * 24 * SS)]
            # 标签比节点-区框缝隙还宽时轴向/法向都让不开（fig5「执行」压
            # 「处理器 111」实案）——环形螺旋扫描：半径递增 × 8 向取首个空位
            for r in (40, 60, 90, 120, 160):
                rr = r * SS
                cands += [(lx + rr, ly), (lx - rr, ly), (lx, ly + rr),
                          (lx, ly - rr), (lx + rr * 0.707, ly + rr * 0.707),
                          (lx - rr * 0.707, ly + rr * 0.707),
                          (lx + rr * 0.707, ly - rr * 0.707),
                          (lx - rr * 0.707, ly - rr * 0.707)]
            for cx, cy in cands:
                if not _lab_hit(cx, cy):
                    lx, ly = cx, cy
                    break
        lx = min(max(lx, tw / 2 + 6 * SS), W - tw / 2 - 6 * SS)
        ly = min(max(ly, 20 * SS), H - 20 * SS)
        placed_rects.append(_lab_rect(lx, ly, tw))
        draw_label(lab, lx, ly)
    out = img.resize((max(1, img.width * 2 // SS), max(1, img.height * 2 // SS)), Image.LANCZOS)
    out.graph = g      # 布局结果外露给测试/诊断——坐标为 SS 超采样系（渲染前）
    return out


# 渲染器版本：渲染行为变化时递增——figs/ 派生 PNG 据此失新重渲
RENDER_VERSION = "16"


def render_to(src, path):
    """渲染并原子写 PNG；返回 (宽, 高)。"""
    from PIL.PngImagePlugin import PngInfo
    img = render_mmd(src)
    meta = PngInfo()
    meta.add_text("mmd_render_version", RENDER_VERSION)
    tmp = path + ".tmp.png"
    img.save(tmp, "PNG", pnginfo=meta)
    os.replace(tmp, path)
    return img.width, img.height


__all__ = ["parse_mmd", "render_mmd", "render_to"]
