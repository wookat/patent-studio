# -*- coding: utf-8 -*-
"""Z20 权项沙盘：只读依赖分析 + 「若调整引用」安全预览（不写正文）。

输入是 preflight.run 的 claim_tree（num/kind/category/refs/children/line/issues）与 support_map。
preview(nodes, claim, new_refs) 在假设图上做确定性校验：
  missing  引用了不存在的权项          —— 阻断
  self     引用自身                    —— 阻断
  forward  从属引用编号在后的权项      —— 阻断（claims.forward_ref 同口径）
  cycle    新引用使 claim 进入引用环   —— 阻断，附环路径
另给 warnings（变独立 / 权1 变从属 / 多引）与下游受影响权项、支持术语锚点。
纯函数、不碰文件系统；路由层负责取报告与项目读权限。
"""


def _adj(nodes):
    """num → refs（去掉指向不存在权项的引用边）。"""
    nums = {n["num"] for n in nodes}
    return {n["num"]: [r for r in n.get("refs") or [] if r in nums] for n in nodes}


def _reverse(adj):
    """num → 直接引用它的权项集合。"""
    rev = {k: set() for k in adj}
    for num, refs in adj.items():
        for r in refs:
            if r in rev:
                rev[r].add(num)
    return rev


def _reach(adj, starts, target):
    """从 starts 沿引用边走，能否到达 target；返回到达路径（不含 target 自身则 None）。"""
    stack = [(s, [s]) for s in starts]
    seen = set()
    while stack:
        cur, path = stack.pop()
        if cur == target:
            return path
        if cur in seen:
            continue
        seen.add(cur)
        for nxt in adj.get(cur, ()):
            if nxt not in seen:
                stack.append((nxt, [*path, nxt]))
    return None


def _downstream(rev, num):
    """直接或间接引用 num 的权项（下游受影响），升序。"""
    out, stack, seen = [], [num], {num}
    while stack:
        cur = stack.pop()
        for d in sorted(rev.get(cur, ())):
            if d not in seen:
                seen.add(d)
                out.append(d)
                stack.append(d)
    return sorted(out)


def _upstream(adj, starts):
    """新引用链上游（不含 claim 自身），升序。"""
    seen = set()
    stack = list(starts)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, ()))
    return sorted(seen)


def preview(nodes: list[dict], support_map: list[dict], claim_num: int, new_refs: list[int]) -> dict:
    """「若权 claim_num 的引用改为 new_refs」的只读预览结果。

    → {claim, ok, blockers:[{kind,message,path?}], warnings:[{kind,message}],
       current_refs, proposed_refs, ref_diff:{added,removed},
       downstream[], upstream[], support:[support_map 行子集]}"""
    nums = {n["num"] for n in nodes}
    by_num = {n["num"]: n for n in nodes}
    node = by_num.get(claim_num)
    if node is None:
        return {
            "claim": claim_num,
            "ok": False,
            "blockers": [{"kind": "unknown_claim", "message": f"权 {claim_num} 不存在"}],
            "warnings": [],
        }

    # 归一：去重保序、只收正整数
    refs: list[int] = []
    for r in new_refs:
        if isinstance(r, int) and not isinstance(r, bool) and r >= 1 and r not in refs:
            refs.append(r)

    blockers: list[dict] = []
    warnings: list[dict] = []

    missing = [r for r in refs if r not in nums]
    if missing:
        blockers.append({"kind": "missing", "message": f"引用了不存在的权利要求：{missing}", "refs": missing})
    if claim_num in refs:
        blockers.append({"kind": "self", "message": f"权利要求 {claim_num} 不能引用自身", "refs": [claim_num]})
    forward = [r for r in refs if r in nums and r > claim_num]
    if forward:
        blockers.append(
            {
                "kind": "forward",
                "message": f"从属权利要求只能引用编号在前的权利要求（{forward} 在权 {claim_num} 之后）",
                "refs": forward,
            }
        )

    # 循环检测：把 claim 的 refs 替换为提议值后，新引用的上游若能回到 claim 即成环
    adj = _adj(nodes)
    adj[claim_num] = [r for r in refs if r in nums]
    if not (missing or claim_num in refs):
        path = _reach(adj, [r for r in refs if r in nums], claim_num)
        if path is not None:
            blockers.append(
                {
                    "kind": "cycle",
                    "message": f"调整后形成循环引用：{claim_num} → {' → '.join(map(str, path))}",
                    "path": [claim_num, *path],
                }
            )

    current = node.get("refs") or []
    if not refs and node.get("kind") == "dependent":
        warnings.append({"kind": "becomes_independent", "message": f"权 {claim_num} 将变为独立权利要求"})
    if claim_num == 1 and refs:
        warnings.append({"kind": "first_dependent", "message": "第 1 项原则上应为独立权利要求"})
    if len(refs) > 1:
        warnings.append({"kind": "multi", "message": f"多引 {refs}：注意择一/并列表述与多引多限制"})

    rev = _reverse(_adj(nodes))  # 下游按现状图算（受本次调整影响的对象范围）
    upstream = _upstream(adj, [r for r in refs if r in nums]) if not blockers else []

    touched = {claim_num, *refs}
    support = [row for row in support_map if touched.intersection(row.get("claims") or [])]

    return {
        "claim": claim_num,
        "ok": not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "current_refs": current,
        "proposed_refs": refs,
        "ref_diff": {
            "added": sorted(set(refs) - set(current)),
            "removed": sorted(set(current) - set(refs)),
        },
        "downstream": _downstream(rev, claim_num),
        "upstream": upstream,
        "support": support,
    }


def detail(nodes: list[dict], support_map: list[dict], claim_num: int) -> dict:
    """只读详情：当前引用 / 直接+全部下游 / 现状上游 / 支持术语锚点 / 命中规则。"""
    by_num = {n["num"]: n for n in nodes}
    node = by_num.get(claim_num)
    if node is None:
        return {
            "claim": claim_num,
            "ok": False,
            "blockers": [{"kind": "unknown_claim", "message": f"权 {claim_num} 不存在"}],
        }
    adj = _adj(nodes)
    rev = _reverse(adj)
    touched = {claim_num}
    support = [row for row in support_map if touched.intersection(row.get("claims") or [])]
    return {
        "claim": claim_num,
        "ok": True,
        "node": node,
        "current_refs": node.get("refs") or [],
        "direct_dependents": sorted(rev.get(claim_num, ())),
        "downstream": _downstream(rev, claim_num),
        "upstream": _upstream(adj, node.get("refs") or []),
        "support": support,
    }
