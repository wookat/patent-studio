#!/usr/bin/env python3
"""claim_trees.py — 权项树形骨架：每案权项块 → 独权束类型序 + 从属引用链 → 全库骨架范式分布。
数据源：pages/*.txt（## Claims 区）+ raw/*.txt（PDF 权项区，经 segment_text.split_claims）。
产出 claim_trees.json：{pub: {indep: [{num,kind}], edges: {num:[refs]}, total}}
     claim_skeletons.json：骨架频次表（注入提示词用）"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CLAIMS_RE = re.compile(r"^## Claims?\s*(?:\(\d+\))?\s*$", re.M)
CLAIM_NUM = re.compile(r"^\s*(\d{1,2})\s*[.．、]\s*")
REF_RE = re.compile(r"(?:权利要求|权)\s*(\d+)\s*(?:(?:至|-|—|~)\s*(\d+))?\s*(?:中?任一项)?")
KINDS = [("method", "方法"), ("apparatus", "装置|系统|设备|终端|平台"), ("medium", "介质|存储介质"),
         ("model", "模型"), ("product", "程序产品|计算机程序产品|产品"), ("chip", "芯片|电路")]

def kind_of(head):
    for k, pat in KINDS:
        if re.search(pat, head): return k
    return "other"

def parse_claims(blocks, dep_hint=None):
    """blocks: [(num, body)] → indep/edges。dep_hint：来源自带从属标记的权项号集（PatSnap dep-clm）。"""
    indep, deps, edges = [], [], {}
    dep_hint = dep_hint or set()
    for num, body in blocks:
        first = body[:80]
        refs = []
        for m in REF_RE.finditer(first):
            lo = int(m.group(1))
            if m.group(2):
                refs.extend(range(lo, int(m.group(2)) + 1))
            else:
                refs.append(lo)
        if num in dep_hint or re.search(r"权利要求|根据权利要求|如权利要求|按照权利要求|依据权利要求", first) or refs:
            deps.append(num); edges[num] = [r for r in refs if r != num]
        else:
            indep.append({"num": num, "kind": kind_of(first)})
    return indep, deps, edges

CLAIM_START = re.compile(r"^\s*1\s*[.．、]\s*一?[种个]?", re.M)
TAIL_RE = re.compile(r"^## |CN\s*\d{9,}\s|Priority Applications", re.M)


def claims_of_pages(fn):
    t = open(fn, encoding="utf-8").read()
    m = CLAIMS_RE.search(t) or CLAIM_START.search(t)
    if not m: return []
    txt = t[m.end():] if m.group(0).startswith("#") else t[m.start():]
    out = []
    for b in re.split(r"(?m)^(?=\s*\d{1,2}\s*[.．、])", txt):
        mm = CLAIM_NUM.match(b)
        if not mm: continue
        body = re.split(r"\n\s*(?:CN\s*\d|## )", b[mm.end():])[0]
        out.append((int(mm.group(1)), body))
    return out

def claims_of_raw(fn):
    from segment_text import clean, split_claims, CLAIM_NUM as CN2
    t = clean(open(fn, encoding="utf-8").read())
    claims_txt, _ = split_claims(t)
    if not claims_txt: return []
    out = []
    for b in re.split(r"(?m)^(?=\s*\d{1,2}\s*[.．、])", claims_txt):
        mm = CN2.match(b)
        if not mm: continue
        out.append((int(mm.group(1)), b[mm.end():].strip()))
    return out

def claims_of_patsnap(fn):
    """claims_patsnap/{pub}.json {blocks:[{num,dep,body}]} → (blocks, dep_nums)。"""
    try:
        d = json.load(open(fn, encoding="utf-8"))
    except Exception:
        return [], set()
    blocks = [(b["num"], b["body"]) for b in d.get("blocks") or []
              if isinstance(b.get("num"), int)]
    return blocks, {b["num"] for b in (d.get("blocks") or []) if b.get("dep")}


def main():
    trees = {}
    for d, fn_of in [("pages", claims_of_pages), ("raw", claims_of_raw)]:
        dd = os.path.join(ROOT, d)
        if not os.path.isdir(dd): continue
        for fn in sorted(os.listdir(dd)):
            if not fn.endswith(".txt"): continue
            pub = fn[:-4]
            if pub in trees: continue
            blocks = fn_of(os.path.join(dd, fn))
            if len(blocks) < 2: continue
            indep, deps, edges = parse_claims(blocks)
            trees[pub] = {"indep": indep, "deps": deps, "edges": edges,
                          "total": len(blocks)}
    # PatSnap claim-data 补源（pages 无 ## Claims 锚的案）
    ps = os.path.join(ROOT, "claims_patsnap")
    if os.path.isdir(ps):
        for fn in sorted(os.listdir(ps)):
            if not fn.endswith(".json"): continue
            pub = fn[:-5]
            if pub in trees: continue
            blocks, dep_nums = claims_of_patsnap(os.path.join(ps, fn))
            if len(blocks) < 2: continue
            indep, deps, edges = parse_claims(blocks, dep_nums)
            trees[pub] = {"indep": indep, "deps": deps, "edges": edges,
                          "total": len(blocks), "src": "patsnap"}
    json.dump(trees, open(os.path.join(ROOT, "claim_trees.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # 骨架聚合：独权种类序（去重保序）+ 从属链形态
    from collections import Counter
    seqs = Counter()
    chain_depths = []
    for pub, t in trees.items():
        seqs[tuple(i["kind"] for i in t["indep"])] += 1
        # 链深：从权引从权的最大层数
        dep_set = set(t["deps"])
        depth = 0
        for e in t["edges"].values():
            depth = max(depth, sum(1 for r in e if r in dep_set))
        chain_depths.append(depth)
    skel = {"pubs": len(trees),
            "indep_sequences": [{"seq": list(s), "count": c} for s, c in seqs.most_common(15)],
            "chain_depth_dist": {str(d): chain_depths.count(d) for d in sorted(set(chain_depths))}}
    json.dump(skel, open(os.path.join(ROOT, "claim_skeletons.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"trees={len(trees)}")
    for s, c in seqs.most_common(8):
        print(f"  {c:4d}  {'+'.join(s)}")
    print("  chain_depth:", {d: chain_depths.count(d) for d in sorted(set(chain_depths))})

if __name__ == "__main__":
    main()
