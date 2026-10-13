#!/usr/bin/env python3
"""build_formlib.py — sentences.jsonl+forms.json → forms_library.json（运行时产物）
每角色给：真实例句集（去重取多样性）+ 高频骨架模板（占位槽化）。
槽化：发明名/模块名 → {X}，本体词 {SELF}，数字 #，图号 {FIG#}，权项号 {CL#}。
"""
import hashlib, json, os, re
from collections import Counter, defaultdict

def h64(s):
    return hashlib.blake2b(s.encode(), digest_size=8).hexdigest()

def shingles(s, n=12):
    """长度≥n 的句子的 n-gram 块（步长 n/2，最多取 12 块）——哨兵用。"""
    if len(s) < n: return set()
    gs = [s[i:i+n] for i in range(0, len(s)-n+1, n//2)]
    step = max(1, len(gs)//12)
    return set(gs[::step])

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")

ROLES = [
    "F1技术领域", "F2背景铺垫", "F3痛点转折", "F4发明内容", "F5方面枚举",
    "F6可选变体", "F7有益效果", "F8附图说明", "F9实施例转接",
    "C1独权句式", "C2从属起句", "C3单元定义",
]

SELF = ["本申请", "本发明", "本公开", "本方案", "本实施例", "本技术方案"]

def norm(s):
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"权利要求\s*\d+(?:\s*(?:至|-|—|~)\s*\d+)?\s*中?任一项?(?:所述|中)的?", "{CL#}", s)
    s = re.sub(r"图\s*\d+[A-Za-z]?(?:[-‑]\d+[A-Za-z]?)*", "{FIG#}", s)
    s = re.sub(r"S\d+", "S#", s)
    s = re.sub(r"\d+(?:\.\d+)?%?", "#", s)
    for w in SELF:
        s = s.replace(w, "{SELF}")
    return s

def slotify(s):
    """把「一种<发明名>」/「<名>模块/单元/装置/系统」抽槽 → {X}。"""
    s = re.sub(r"一种[^，。；：]{2,30}?(?:方法|装置|系统|设备|介质|产品|模型|网络|芯片|终端|平台|程序|电路|机器人|车辆|方法及装置)", lambda m: m.group(0)[2:], s)
    s = re.sub(r"^[一_]种", "一种", s)
    return s

def main():
    sents = [json.loads(l) for l in open(os.path.join(ROOT, "sentences.jsonl"), encoding="utf-8")]
    by_role = {}
    for r in sents:
        by_role.setdefault(r["role"], []).append(r)
    lib = {"roles": {}, "stats": {"pubs": len({r["pub"] for r in sents}), "sentences": len(sents)}}
    for role in ROLES:
        rows = by_role.get(role, [])
        # 按归一形频次排，取多样化例句（句首6字去重，跨案优先）
        cnt = Counter(norm(x["text"]) for x in rows)
        seen_heads = set()
        exemplars = []
        for n, c in cnt.most_common():
            cands = [x for x in rows if norm(x["text"]) == n]
            pubs = {x["pub"] for x in cands}
            head = n[:6]
            if head in seen_heads and len(exemplars) >= 8: continue
            seen_heads.add(head)
            ex = cands[0]["text"]
            exemplars.append({"ex": ex[:160], "pubs": len(pubs), "freq": c})
            if len(exemplars) >= 14: break
        # 骨架：把 top pubs>=2 的归一形再槽化
        frames = []
        for n, c in cnt.most_common(400):
            pubs = len({x["pub"] for x in rows if norm(x["text"]) == n})
            if pubs >= 2:
                frames.append({"frame": slotify(n)[:140], "pubs": pubs})
            if len(frames) >= 12: break
        lib["roles"][role] = {"exemplars": exemplars, "frames": frames, "total": len(rows)}
    # 哨兵索引：归一形全句哈希 + 12-gram 块哈希（查'整句搬运'与'大段撞车'）。
    # 另记每个哈希出现在多少不同案子——≥BOILER_PUBS 案的为行业套话，哨兵豁免
    # （撞一篇是搬运，撞一片是通行句式）。
    BOILER_PUBS = 5
    norms, grams = set(), set()
    norm_pubs, gram_pubs = defaultdict(set), defaultdict(set)
    for r in sents:
        n = norm(r["text"])
        nh = h64(n)
        norms.add(nh)
        norm_pubs[nh].add(r["pub"])
        for g in shingles(n):
            gh = h64(g)
            grams.add(gh)
            gram_pubs[gh].add(r["pub"])
    idx = {"norms": sorted(norms), "grams": sorted(grams),
           "boiler_norms": sorted(h for h, s in norm_pubs.items() if len(s) >= BOILER_PUBS),
           "boiler_grams": sorted(h for h, s in gram_pubs.items() if len(s) >= BOILER_PUBS)}
    json.dump(idx, open(os.path.join(ROOT, "corpus_index.json"), "w"))
    out = os.path.join(ROOT, "forms_library.json")
    json.dump(lib, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"-> {out}")
    for role, d in lib["roles"].items():
        print(f"  {role}: {len(d['exemplars'])} exemplars, {len(d['frames'])} frames, total={d['total']}")

if __name__ == "__main__":
    main()
