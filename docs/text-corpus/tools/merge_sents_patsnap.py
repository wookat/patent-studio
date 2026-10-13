#!/usr/bin/env python3
"""merge_sents_patsnap.py — claims_patsnap/*.json 权项块 → 追加进 sentences.jsonl 的 claims 区记录。
口径与 segment_text 一致：{pub, zone:claims, num, role, text}；role 用同一 claim_role。
某案已有 claims 记录 ⇒ 跳过（不改写旧源）。幂等可复跑。"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from segment_text import claim_role

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SRC = os.path.join(ROOT, "claims_patsnap")
OUT = os.path.join(ROOT, "sentences.jsonl")

existing_claim_pubs = set()
rows = []
for l in open(OUT, encoding="utf-8"):
    d = json.loads(l)
    rows.append(d)
    if d["zone"] == "claims":
        existing_claim_pubs.add(d["pub"])

added = {}
for fn in sorted(os.listdir(SRC)):
    if not fn.endswith(".json"): continue
    pub = fn[:-5]
    if pub in existing_claim_pubs: continue
    d = json.load(open(os.path.join(SRC, fn), encoding="utf-8"))
    n = 0
    for b in d.get("blocks") or []:
        body = (b.get("body") or "").strip()
        if len(body) < 8: continue
        rows.append({"pub": pub, "zone": "claims", "num": b["num"],
                     "role": claim_role(b["num"], body), "text": body})
        n += 1
    if n: added[pub] = n

with open(OUT, "w", encoding="utf-8") as f:
    for d in rows:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
print(f"原有claims案={len(existing_claim_pubs)} 新增={len(added)}案 +{sum(added.values())}句 总行={len(rows)}")
