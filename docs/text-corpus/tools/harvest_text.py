#!/usr/bin/env python3
"""harvest_text.py — 拉 patentimages 公开文本 PDF → pypdf 抽正文全文 → docs/text-corpus/raw/<pub>.txt + meta.json
增量：已有 txt 跳过；links.json 追加条目重跑即扩容。
"""
import json, os, re, sys, urllib.request, concurrent.futures

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # docs/text-corpus
RAW = os.path.join(ROOT, "raw")
PDFD = os.path.join(ROOT, "pdfs")
LINKS = os.path.join(HERE, "..", "..", "figure-library", "tools", "links.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

def fetch(url, dest, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                f.write(r.read())
            return True
        except Exception:
            if i == tries - 1: return False

def extract_text(pdf_path):
    from pypdf import PdfReader
    try:
        rd = PdfReader(pdf_path)
        pages = []
        for p in rd.pages:
            try: pages.append(p.extract_text() or "")
            except Exception: pages.append("")
        return "\n".join(pages), len(rd.pages)
    except Exception:
        return "", 0

def meta_of(text, pub):
    t = text[:4000]
    title = ""
    m = re.search(r"发明名称[：\s]*(.{2,60})", t) or re.search(r"\(54\)\s*(.{2,60})", t)
    if m: title = re.sub(r"\s+", "", m.group(1))
    app = ""
    m = re.search(r"申请人[：\s]*(.{2,80})", t) or re.search(r"\(71\)\s*(.{2,80})", t)
    if m: app = re.sub(r"\s+", "", m.group(1))
    return {"pub": pub, "title": title, "applicant": app}

def work(item):
    pub, url = item
    txt_path = os.path.join(RAW, f"{pub}.txt")
    meta_path = os.path.join(RAW, f"{pub}.meta.json")
    if os.path.exists(txt_path) and os.path.getsize(txt_path) > 2000:
        return pub, "skip"
    pdf = os.path.join(PDFD, f"{pub}.pdf")
    if not os.path.exists(pdf) or os.path.getsize(pdf) < 10000:
        if not fetch(url, pdf): return pub, "dl-fail"
    text, npages = extract_text(pdf)
    if len(text) < 2000: return pub, "no-text"
    with open(txt_path, "w", encoding="utf-8") as f: f.write(text)
    meta = meta_of(text, pub); meta["pages"] = npages; meta["chars"] = len(text)
    with open(meta_path, "w", encoding="utf-8") as f: json.dump(meta, f, ensure_ascii=False)
    return pub, "ok"

def main():
    os.makedirs(RAW, exist_ok=True); os.makedirs(PDFD, exist_ok=True)
    links = json.load(open(LINKS, encoding="utf-8"))
    items = list(links.items()) if isinstance(links, dict) else links
    print(f"{len(items)} links")
    ok = skip = fail = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for pub, st in ex.map(work, items):
            if st == "ok": ok += 1
            elif st == "skip": skip += 1
            else:
                fail += 1; print("FAIL", pub, st)
    print(f"ok={ok} skip={skip} fail={fail}")

if __name__ == "__main__":
    main()
