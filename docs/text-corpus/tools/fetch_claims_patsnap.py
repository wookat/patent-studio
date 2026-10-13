#!/usr/bin/env python3
"""fetch_claims_patsnap.py — 在 VPS 容器内跑：按 pub 清单调 PatSnap claim-data，
解析 indep/dep div → claims_patsnap/{pub}.json {blocks:[{num,dep,body}]}。
replace_by_related=1：本家无权项时取同族授权案。"""
import json, os, re, sys, time
import httpx

NEED = sys.argv[1] if len(sys.argv) > 1 else "/tmp/need_claims.txt"
OUTD = sys.argv[2] if len(sys.argv) > 2 else "/tmp/claims_patsnap"
os.makedirs(OUTD, exist_ok=True)
KEY = os.environ.get("PATENT_STUDIO_PATSNAP_KEY") or os.environ.get("PATSNAP_KEY")
URL = "https://connect.patsnap.com/basic-patent-data/claim-data"
DIV = re.compile(r'<div class="(indep|dep)-clm" num="(\d+)">(.*?)</div>', re.S)
TAG = re.compile(r"<[^>]+>")

def parse_claims(html):
    blocks, seen = [], {}
    for kind, num, body in DIV.findall(html):
        txt = TAG.sub("", body).strip()
        txt = re.sub(r"\s+", " ", txt)
        if not txt: continue
        n = int(num)
        if n in seen:
            seen[n]["body"] += " " + txt
        else:
            seen[n] = {"num": n, "dep": kind == "dep", "body": txt}
            blocks.append(seen[n])
    return blocks

pubs = [l.strip() for l in open(NEED) if l.strip()]
done = {f[:-5] for f in os.listdir(OUTD) if f.endswith(".json")}
todo = [p for p in pubs if p not in done]
print(f"total={len(pubs)} done={len(done)} todo={len(todo)}", flush=True)
ok = empty = fail = 0
for i, p in enumerate(todo):
    for attempt in range(3):
        try:
            r = httpx.get(URL, params={"patent_number": p, "replace_by_related": "1"},
                          headers={"Authorization": f"Bearer {KEY}"}, timeout=20)
            if r.status_code == 429:
                time.sleep(2 + attempt * 2); continue
            data = r.json()
            blocks = []
            for d in (data.get("data") or []):
                for c in (d.get("claims") or []):
                    if c.get("lang") == "CN" or not blocks:
                        blocks = parse_claims(c.get("claim_text") or "")
                    if blocks: break
                if blocks: break
            if blocks:
                json.dump({"pub": p, "blocks": blocks},
                          open(os.path.join(OUTD, p + ".json"), "w", encoding="utf-8"),
                          ensure_ascii=False)
                ok += 1
            else:
                empty += 1
            break
        except Exception as e:
            if attempt == 2:
                fail += 1
                print(f"fail {p}: {e}", flush=True)
            else:
                time.sleep(1 + attempt)
    if (i + 1) % 50 == 0:
        print(f"[{i+1}/{len(todo)}] ok={ok} empty={empty} fail={fail}", flush=True)
    time.sleep(0.2)
print(f"DONE ok={ok} empty={empty} fail={fail}", flush=True)
