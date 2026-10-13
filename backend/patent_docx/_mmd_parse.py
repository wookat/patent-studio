"""拆分件：按职责搬出；公开名经显式 import 收回原模块命名空间。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_NODE = re.compile(
    r"^\s*(?P<id>[A-Za-z_][\w]*)\s*"
    r"(?:\(\((?P<circle>.*?)\)\)|\((?P<round>.*?)\)|\[/(?P<vstrip>.*?)/\]|"
    r"\[(?P<box>.*?)\]|\{(?P<diamond>.*?)\})?\s*$")


_EDGE_RES = (
    re.compile(r"^(?P<l>.+?)\s*(?P<bi><)?--\s+(?P<lab>[^|>-][^->]*?)\s*-->\s*(?P<r>.+)$"),   # A -- 文本 --> B
    re.compile(r"^(?P<l>.+?)\s*-\.\s*(?P<lab>[^.]+?)\s*\.-+>\s*(?P<r>.+)$"),        # A -.文本.-> B（恒虚线）
    re.compile(r"^(?P<l>.+?)\s*(?P<bi><)?(?P<op>-+>|\.-+>|-\.-+>)\s*\|(?P<lab>[^|]*)\|\s*(?P<r>.+)$"),
    re.compile(r"^(?P<l>.+?)\s*(?P<bi><)?(?P<op>-\.-+>|\.-+>|-+>|=+>|--)\s*(?P<r>.+)$"),         # --> / -.-> / ==> / --
)


def _edge_dashed(seg):
    """边符/边行片段 → 虚线？`-.->`/`..>`/`-. 文本 .->` 为虚线（数据/参数传递线惯例）；
    `-->`/`==>`/`-->`/`-- 文本 -->` 为实线。判据：分隔符以 `-.` 或 `.` 开头。"""
    return bool(re.match(r"\s*(-\.|\.+)", seg))


_HEADER = re.compile(r"^\s*(?:flowchart|graph)\s+(?P<dir>LR|RL|TB|TD|BT)", re.I)


_SUBGRAPH = re.compile(r"^\s*subgraph\s+(?P<id>[A-Za-z_][\w]*)\s*(?:\[(?P<label>.*?)\])?\s*$")


_CHAIN_SEP = re.compile(
    r"\s*(--\s+[^|>-][^->]*?\s*-->"                    # -- 文本 -->
    r"|-\.\s*[^.]+?\s*\.-+>"                            # -. 文本 .->
    r"|(?:-+>|\.-+>|-\.-+>)\s*\|[^|]*\|"                 # -->|文本| / -.->|文本|
    r"|-\.-+>|\.-+>|<*-+>|=+>|<*--)\s*")                   # -.-> / ..> / --> / ==> / --


def _split_edge_chain(ln):
    """mmd 链式边 `A -->|x| B -.->|y| C` → [(left, label, right), …]。
    非链式/词元不可解析 → None（`A & B --> C` 扇出回落 _EDGE_RES 老路）。
    unet-seg 实案：模型产 `IN --> D1 -->|下采样| D2 …` 整行链式，旧路只命中
    首段边正则后右词元含边符被 _node_of 拒——4/21 边存活，全节点 rank0 塌条。"""
    seps = list(_CHAIN_SEP.finditer(ln))
    if not seps or seps[0].start() == 0:
        return None
    out = []
    for i, m in enumerate(seps):
        left = ln[:m.start()] if i == 0 else ln[seps[i - 1].end():m.start()]
        right = ln[m.end():seps[i + 1].start() if i + 1 < len(seps) else len(ln)]
        left, right = left.strip(), right.strip()
        if not left or not right:
            return None
        seg = m.group(0)
        lab_m = (re.match(r"\s*--\s+(?P<t>[^|>-][^->]*?)\s*-->\s*$", seg)
                 or re.match(r"\s*-\.\s*(?P<t>[^.]+?)\s*\.-+>\s*$", seg)
                 or re.search(r"\|(?P<t>[^|]*)\|", seg))
        lab = _unquote(lab_m.group("t") or "") if lab_m else ""
        out.append((left, lab, right, "<-" in seg, _edge_dashed(seg)))
    return out


@dataclass
class _Node:
    label: str
    shape: str = "box"  # box | diamond | round
    cluster: str | None = None
    rank: int = 0
    w: float = 0
    h: float = 0
    x: float = 0
    y: float = 0


@dataclass
class _Graph:
    direction: str = "TB"
    nodes: dict = field(default_factory=dict)   # id → _Node
    edges: list = field(default_factory=list)   # (a, b, label)
    bidir: set = field(default_factory=set)     # A <--> B 双向边 (a,b)
    dashed: set = field(default_factory=set)    # -.-> 虚线边 (a,b)（数据/参数传递线）
    clusters: dict = field(default_factory=dict)  # id → {label, members:set}


def _unquote(label):
    """mmd 引号标签 `A["文本"]` 的引号是界定符不是文本——剥外层一对。
    bert-12 实案：不剥则成品节点字面带 \"文本\"。"""
    s = label.strip()
    return s[1:-1] if len(s) > 1 and s[0] == s[-1] and s[0] in ('"', "'") else s


def _node_of(seg):
    """段文本 → (id, label, shape)；无法解析 → None。"""
    m = _NODE.match(seg.strip())
    if not m:
        return None
    label = next((m.group(k) for k in ("circle", "round", "vstrip", "box", "diamond")
                  if m.group(k) is not None), None)
    shape = ("diamond" if m.group("diamond") is not None else
             "circ" if m.group("circle") is not None else
             "vstrip" if m.group("vstrip") is not None else
             "round" if m.group("round") is not None else "box")
    return m.group("id"), (_unquote(label) if label is not None else m.group("id")), shape


def parse_mmd(src):
    """mmd 源码 → _Graph。返回 None 表示无可渲染节点。"""
    g = _Graph()
    cluster_stack = []
    for raw in src.split("\n"):
        ln = raw.strip()
        if not ln or ln.startswith("%%"):
            continue
        h = _HEADER.match(ln)
        if h:
            g.direction = h.group("dir").upper()
            continue
        if re.match(r"^\s*direction\s+(LR|RL|TB|TD|BT)", ln, re.I):
            continue  # subgraph 内方向声明暂按全局方向处理
        sg = _SUBGRAPH.match(ln)
        if sg:
            cid = sg.group("id")
            g.clusters[cid] = {"label": _unquote(sg.group("label") or cid), "members": set()}
            cluster_stack.append(cid)
            continue
        if ln == "end":
            if cluster_stack:
                cluster_stack.pop()
            continue
        if ln.startswith(("classDef ", "class ", "style ", "linkStyle ", "click ")):
            continue
        chain = _split_edge_chain(ln)
        if chain is not None and all(
                _node_of(t) for edge in chain
                for seg in (edge[0], edge[2]) for t in seg.split("&")):
            for sa, lab, sb, bi, dsh in chain:
                # `&` 扇出/扇入：A --> B & C 拆为逐边（授权件分流/汇流画法基础）
                a_nodes = [_node_of(t) for t in sa.split("&")]
                b_nodes = [_node_of(t) for t in sb.split("&")]
                for nd in a_nodes + b_nodes:
                    nid, lab_tx, shp = nd
                    if nid not in g.nodes:
                        g.nodes[nid] = _Node(label=lab_tx, shape=shp,
                                             cluster=cluster_stack[-1] if cluster_stack else None)
                    if cluster_stack:
                        g.clusters[cluster_stack[-1]]["members"].add(nid)
                for a in a_nodes:
                    for b in b_nodes:
                        g.edges.append((a[0], b[0], lab))
                        if bi:
                            g.bidir.add((a[0], b[0]))
                        if dsh:
                            g.dashed.add((a[0], b[0]))
            continue
        for pat in _EDGE_RES:
            em = pat.match(ln)
            if em:
                lefts = [s for s in em.group("l").split("&")]
                rights = [s for s in em.group("r").split("&")]
                lab = _unquote(em.groupdict().get("lab") or "")
                lid_pool = []
                for s in lefts + rights:
                    nd = _node_of(s)
                    if nd:
                        lid_pool.append(nd[0])
                        nid, lab_tx, shp = nd
                        if nid not in g.nodes:
                            g.nodes[nid] = _Node(label=lab_tx, shape=shp,
                                                 cluster=cluster_stack[-1] if cluster_stack else None)
                        if cluster_stack:
                            g.clusters[cluster_stack[-1]]["members"].add(nid)
                _op = em.groupdict().get("op") or ""
                _dsh = (_op.startswith(("-.", "."))
                        or _EDGE_RES.index(pat) == 1)  # -.文本.-> 型整式即虚线
                for s in lefts:
                    for t in rights:
                        a, b = _node_of(s), _node_of(t)
                        if a and b:
                            g.edges.append((a[0], b[0], lab))
                            if em.groupdict().get("bi"):
                                g.bidir.add((a[0], b[0]))
                            if _dsh:
                                g.dashed.add((a[0], b[0]))
                break
        else:
            nd = _node_of(ln)
            if nd:
                nid, lab_tx, shp = nd
                g.nodes.setdefault(nid, _Node(label=lab_tx, shape=shp,
                                              cluster=cluster_stack[-1] if cluster_stack else None))
                if cluster_stack:
                    g.clusters[cluster_stack[-1]]["members"].add(nid)
    if not g.nodes:
        return None
    seen_edges = []
    edge_set = set()
    for a, b, lab in g.edges:
        if (a, b) not in edge_set and a in g.nodes and b in g.nodes and a != b:
            edge_set.add((a, b))
            seen_edges.append((a, b, lab))
    g.edges = seen_edges
    # 去环：DFS 标灰回边（源在栈内指向祖先）后只在 DAG 上最长路分层——
    # 回边不抬 rank，否则循环回边把回指目标一路压到末层（vit-11 fig4 实证：
    # H→A 使「编码层输入」落到 rank89 与输出同排）
    adj = {}
    for a, b, _ in g.edges:
        adj.setdefault(a, []).append(b)
    state = {}  # nid → 1 在栈内 / 2 完成
    g.back_edges = set()

    def dfs(u):
        state[u] = 1
        for v in adj.get(u, []):
            if state.get(v) == 1:
                g.back_edges.add((u, v))
            elif state.get(v) is None:
                dfs(v)
        state[u] = 2

    for nid in g.nodes:
        if state.get(nid) is None:
            dfs(nid)
    for _ in range(len(g.nodes) + 1):
        moved = False
        for a, b, _ in g.edges:
            if (a, b) in g.back_edges:
                continue
            if g.nodes[a].rank + 1 > g.nodes[b].rank:
                g.nodes[b].rank = g.nodes[a].rank + 1
                moved = True
        if not moved:
            break
    return g


_MARK_RE = re.compile(r"^(.*?)\s+(\d{3,4})\s*$")


def validate_graph(g):
    """图源确定性体检——生成侧自查通道：返回 [{code, level, detail}]，空表 = 无发现。
    level: 'warn' 大概率画错 / 'info' 惯例提醒。模型看不见渲染，这些就是它的眼睛。"""
    out = []
    if g is None:
        return [{"code": "unparseable", "level": "warn",
                 "detail": "图源没有可解析的节点或边——检查 flowchart 头与节点写法"}]
    ids = set(g.nodes)
    deg_in = {i: 0 for i in ids}
    deg_out = {i: 0 for i in ids}
    adj = {i: set() for i in ids}
    for a, b, _ in g.edges:
        deg_out[a] += 1
        deg_in[b] += 1
        adj[a].add(b)
        adj[b].add(a)
    iso = [nid for nid in ids if deg_in[nid] == 0 and deg_out[nid] == 0]
    if iso:
        out.append({"code": "isolated", "level": "warn",
                    "detail": "未连通节点：" + "、".join(g.nodes[i].label for i in iso[:6])})
    # 弱连通分量 >1 → 图碎成几摊，渲染器会并排摆开但语义上是断的
    seen = set()
    parts = 0
    for nid in ids:
        if nid in seen:
            continue
        parts += 1
        stack = [nid]
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
    if parts > 1:
        out.append({"code": "disconnected", "level": "warn",
                    "detail": f"图分裂为 {parts} 个不连通分量"})
    sources = [nid for nid in ids if deg_in[nid] == 0 and deg_out[nid] > 0]
    sinks = [nid for nid in ids if deg_out[nid] == 0 and deg_in[nid] > 0]
    if g.edges and not sources:
        out.append({"code": "no_entry", "level": "warn",
                    "detail": "无入度0起点——流程没有源头（纯环或断链）"})
    if g.edges and not sinks:
        out.append({"code": "no_exit", "level": "warn",
                    "detail": "无出度0终点——流程没有收口"})
    marks = {}
    for nid, n in g.nodes.items():
        m = _MARK_RE.match(n.label)
        if m:
            marks.setdefault(m.group(2), []).append(m.group(1).strip() or nid)
    dups = [k for k, v in marks.items() if len(v) > 1]
    if dups:
        out.append({"code": "dup_mark", "level": "warn",
                    "detail": "元件标号重号：" + "、".join(dups[:6])})
    if g.edges and not marks:
        out.append({"code": "no_marks", "level": "info",
                    "detail": "无元件标号——结构图惯例是每层/单元带三位标号（如 注意力模块 301）"})
    if 0 < len(g.nodes) < 4 and len(g.edges) > 0:
        out.append({"code": "sparse", "level": "info",
                    "detail": f"仅 {len(g.nodes)} 节点——授权件惯例 15-30 元件级，检查是否三步抽象"})
    return out


def describe_graph(g):
    """图源语义回执——渲染器实际理解到的结构，白话一句喂回生成侧自查。"""
    if g is None:
        return "无法解析：源码没有可识别的节点/边"
    deg_in = {i: 0 for i in g.nodes}
    deg_out = {i: 0 for i in g.nodes}
    for a, b, _ in g.edges:
        deg_out[a] += 1
        deg_in[b] += 1
    def lab(i):
        return g.nodes[i].label

    bits = [f"{g.direction}向，{len(g.nodes)}节点 {len(g.edges)}边"]
    sources = [i for i in g.nodes if deg_in[i] == 0 and deg_out[i] > 0]
    sinks = [i for i in g.nodes if deg_out[i] == 0 and deg_in[i] > 0]
    if sources:
        bits.append("起点 " + "、".join(lab(i) for i in sources[:4]))
    for nid in g.nodes:
        outs = [b for a, b, _ in g.edges if a == nid and (a, b) not in g.back_edges]
        ins = [a for a, b, _ in g.edges if b == nid and (a, b) not in g.back_edges]
        if len(outs) > 1:
            bits.append(f"{lab(nid)} 分流 → " + "、".join(lab(o) for o in outs[:5]))
        if len(ins) > 1:
            bits.append("、".join(lab(o) for o in ins[:5]) + f" 汇流 → {lab(nid)}")
    if g.back_edges:
        bits.append("回边 " + "、".join(f"{lab(a)}→{lab(b)}" for a, b in list(g.back_edges)[:4]))
    if sinks:
        bits.append("终点 " + "、".join(lab(i) for i in sinks[:4]))
    return "；".join(bits)

__all__ = [
    "_CHAIN_SEP",
    "_EDGE_RES",
    "_Graph",
    "_HEADER",
    "_MARK_RE",
    "_NODE",
    "_Node",
    "_SUBGRAPH",
    "_node_of",
    "_split_edge_chain",
    "_unquote",
    "describe_graph",
    "parse_mmd",
    "validate_graph",
]
