#!/usr/bin/env python3
"""cluster_forms.py — sentences.jsonl → 句型骨架库 forms.json
归一化：数字→#，本体词→{SELF}，权项引用→{CL#}，图号→{FIG#}，再按 (role, norm) 聚合。
产出: docs/text-corpus/forms.json  {role: [{form, freq, ex, pubs}]}
同时产 frame_signature（句首6字+连接词链）做松散骨架比对。
"""
import json, os, re, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "sentences.jsonl")
OUT = os.path.join(HERE, "..", "forms.json")

SELF = ["本申请", "本发明", "本公开", "本方案", "本实施例", "本技术方案", "本方法", "本装置", "本系统", "本设备"]

def norm(s):
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"权利要求\s*\d+(?:\s*(?:至|-|—|~)\s*\d+)?\s*中?任一项?(?:所述|中)的?", "{CL#}", s)
    s = re.sub(r"权利要求\s*\d+", "{CL#}", s)
    s = re.sub(r"图\s*\d+[A-Za-z]?(?:[-‑]\d+[A-Za-z]?)*", "{FIG#}", s)
    s = re.sub(r"S\d+", "S#", s)
    s = re.sub(r"\d+(?:\.\d+)?%?", "#", s)
    for w in SELF:
        s = s.replace(w, "{SELF}")
    s = re.sub(r"\[#\]", "[#]", s)
    return s

def frame_sig(s):
    """松散骨架：句首 4 字 + 全部功能词链，判定'同类句式'。"""
    parts = []
    for w in ["根据", "按照", "依据", "所述", "其中", "用于", "对", "通过", "以", "进行", "将", "在",
              "包括", "可选", "具体地", "进一步", "例如", "若", "当", "响应于", "使得", "从而", "并", "再"]:
        if w in s: parts.append(w)
    return s[:4] + "|" + ",".join(parts[:6])

def main():
    groups = defaultdict(list)
    sig_groups = defaultdict(list)
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            n = norm(r["text"])
            if len(n) < 5: continue
            groups[(r["role"], n)].append(r)
            sig_groups[(r["role"], frame_sig(n))].append(r)
    forms = {}
    for (role, n), rows in groups.items():
        pubs = sorted({x["pub"] for x in rows})
        forms.setdefault(role, []).append({
            "form": n, "freq": len(rows), "pubs": len(pubs),
            "ex": rows[0]["text"][:120]})
    out = {}
    for role, lst in forms.items():
        lst.sort(key=lambda x: (-x["pubs"], -x["freq"]))
        out[role] = lst[:60]
    sigs = {}
    for (role, sig), rows in sig_groups.items():
        pubs = {x["pub"] for x in rows}
        if len(pubs) >= 2:
            sigs.setdefault(role, []).append({"sig": sig, "pubs": len(pubs), "freq": len(rows),
                                              "ex": rows[0]["text"][:100]})
    for role, lst in sigs.items():
        lst.sort(key=lambda x: -x["pubs"])
        sigs[role] = lst[:40]
    json.dump({"exact": out, "sigs": sigs}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"roles={len(out)} -> {OUT}")
    for role, lst in sorted(out.items()):
        if not lst: continue
        top = lst[0]
        print(f"{role}: {len(forms[role])} forms, top pubs={top['pubs']} freq={top['freq']} :: {top['form'][:70]}")

if __name__ == "__main__":
    main()
