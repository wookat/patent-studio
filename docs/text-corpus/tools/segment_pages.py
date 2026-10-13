#!/usr/bin/env python3
"""segment_pages.py — pages/*.txt（Google Patents /zh 抓取页）→ 追加进 sentences.jsonl
页格式：## Claims (N) 后是编号权项；说明书五区标题为行内锚。
已在 sentences.jsonl 中的 pub 跳过（PDF 版为准）。"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from segment_text import sentences_of, claim_role, classify_para, SECTIONS, clean

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, "..", "pages")
OUT = os.path.join(HERE, "..", "sentences.jsonl")

CLAIMS_RE = re.compile(r"^## Claims?\s*(?:\(\d+\))?\s*$", re.M)
CLAIM_NUM = re.compile(r"^\s*(\d{1,2})\s*[.．、]\s*")
SEC_RE = re.compile(r"^\s*(技术领域|背景技术|发明内容|附图说明|具体实施方式)\s*$", re.M)
SEC_INLINE = re.compile(r"(技术领域|背景技术|发明内容|附图说明|具体实施方式)\s*\n")
ZONE = {"技术领域": "field", "背景技术": "background", "发明内容": "content",
        "附图说明": "figdesc", "具体实施方式": "embodiment"}

def split_page(text):
    """(claims_text, desc_text)。"""
    m = CLAIMS_RE.search(text)
    if m:
        return text[m.end():], text[:m.start()]
    return "", text

def main():
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT, encoding="utf-8"):
            try: done.add(json.loads(line)["pub"])
            except Exception: pass
    out = open(OUT, "a", encoding="utf-8")
    n_pub = n_sent = 0
    for fn in sorted(os.listdir(PAGES)):
        if not fn.endswith(".txt"): continue
        pub = fn[:-4]
        if pub in done: continue
        raw = open(os.path.join(PAGES, fn), encoding="utf-8").read()
        claims_txt, desc = split_page(raw)
        wrote = False
        if claims_txt:
            blocks = re.split(r"(?m)^(?=\s*\d{1,2}\s*[.．、])", claims_txt)
            for b in blocks:
                m = CLAIM_NUM.match(b)
                if not m: continue
                num = int(m.group(1))
                body = b[m.end():].strip()
                # 切断尾部非权项内容（Priority Applications 等附录）
                body = re.split(r"\n\s*(?:CN\s*\d|## )", body)[0]
                role = claim_role(num, body)
                for s in sentences_of(body):
                    out.write(json.dumps({"pub": pub, "zone": "claims", "role": role,
                                          "num": num, "text": s}, ensure_ascii=False) + "\n")
                    n_sent += 1; wrote = True
        # 说明书：五区标题行内切
        marks = [(m.start(), m.group(1)) for m in SEC_INLINE.finditer(desc)]
        if not marks:
            # 版式变体页：按 ## 节切片取中文密度最高的一段当 content 区
            chunks = re.split(r"(?m)^## [^\n]*\n", desc)
            def _zhlen(t): return len(re.sub(r"[A-Za-z0-9\s\W]", "", t))
            tail = max(chunks, key=_zhlen) if chunks else ""
            if _zhlen(tail) >= 200:
                marks = [(desc.find(tail), "发明内容")]
        for i, (pos, sec) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(desc)
            zone = ZONE[sec]
            seg = desc[pos:end]
            # 段按空行分
            for para in re.split(r"\n\s*\n", seg):
                para = para.strip()
                if len(para) < 8: continue
                if SEC_RE.match(para): continue
                # 去掉纯英文行（/zh 页混排 EN 段落）
                zh = "\n".join(l for l in para.split("\n")
                               if len(re.sub(r"[A-Za-z0-9\s\W]", "", l)) >= 2)
                if not zh.strip(): continue
                for s in sentences_of(zh):
                    role = classify_para(zone, 0, s)
                    out.write(json.dumps({"pub": pub, "zone": zone, "role": role,
                                          "num": 0, "text": s}, ensure_ascii=False) + "\n")
                    n_sent += 1; wrote = True
        if wrote: n_pub += 1
    out.close()
    print(f"pages -> +{n_pub} pubs, +{n_sent} sentences")

if __name__ == "__main__":
    main()
