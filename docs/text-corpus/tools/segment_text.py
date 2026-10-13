#!/usr/bin/env python3
"""segment_text.py — CN 案全文 → 句子角色标注语料（sentences.jsonl）
每行: {pub, zone, role, num, text}
zone: claims | field | background | content | figdesc | embodiment
role 详见 ROLE 规则；切分原子 = 权项区按「N.」条款、说明书区按 [NNNN] 段落，再按 ；。！？ 分句。
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")
OUT = os.path.join(HERE, "..", "sentences.jsonl")

PAGE_JUNK = re.compile(r"(?:权　利　要　求　书|说　明　书|说　明　书　附　图|摘　要　附　图)\s*\d+/\d+\s*页|CN\s*\d+\s*[A-Z]\s*\n?|\n\s*\d{1,3}\s*\n")

SECTIONS = ["技术领域", "背景技术", "发明内容", "附图说明", "具体实施方式"]
CLAIM_START = re.compile(r"^\s*1\s*[.．、]\s*一?[种个]?", re.M)
CLAIM_NUM = re.compile(r"^\s*(\d{1,2})\s*[.．、]\s*")
PARA_NUM = re.compile(r"^\[(\d{4})\]\s*")

def clean(text):
    t = PAGE_JUNK.sub("\n", text)
    t = re.sub(r"[ \t　]+", "", t)
    t = re.sub(r"\n{2,}", "\n", t)
    return t

def sentences_of(para):
    """按中文标点分句；保留分隔标点到句尾。"""
    parts = re.split(r"(?<=[。！？；])", para)
    out = []
    for p in parts:
        p = p.strip()
        if len(p) >= 6:
            out.append(p)
    return out

def claim_role(num, body):
    first = body[:120]
    if re.search(r"权利要求\s*\d+\s*(?:至|-|—|~)\s*\d+\s*中?任一项|权利要求\d+.*(?:所述|中)的", first):
        return "C2从属起句"
    if "其特征在于" in first or "特征在于" in first:
        # 装置权项内的单元定义
        if re.search(r"，用于|，配置为|，用于执行", body[60:]):
            return "C1独权句式"
        return "C1独权句式"
    if re.match(r"根据权利要求|如权利要求|按照权利要求|依据权利要求", first.lstrip("可选的其中， 　")):
        return "C2从属起句"
    if "用于" in first:
        return "C3单元定义"
    return "C0权项其他"

FIELD_HINTS = [
    ("F5方面枚举", ["第一方面", "第二方面", "第三方面", "第四方面", "第五方面"]),
    ("F4发明内容", ["本申请提供", "本发明提供", "根据本申请", "根据本发明", "为解决", "本公开提供", "提供一种"]),
    ("F6可选变体", ["可选的", "在一些实施例中", "在一种可能的实现", "在另一些实施例", "作为其中一种", "作为一种可选", "在一种实现方式", "可选地"]),
    ("F7有益效果", ["有益效果", "由以上技术方案", "从而", "使得", "提高了", "降低了", "缩短了", "减少了", "提升了", "避免了", "克服了", "本申请的技术方案", "与现有技术相比", "相较于现有技术"]),
    ("F8附图说明", ["附图", "图", "所示", "示意"]),
]
BG_HINTS = [
    ("F3痛点转折", ["然而", "但是", "存在", "不足", "缺陷", "难以", "无法", "导致", "效率低", "准确性", "误差", "局限性", "相关技术中", "现有技术中", "目前的", "现有的", "传统的"]),
]
EMB_HINTS = [
    ("F9实施例转接", ["参照图", "参见图", "如图", "结合图", "结合附图", "下面", "接下来", "以图", "举例来说", "举例而言", "在一示例", "在一个实施例", "在一实施例", "具体实施例", "具体地", "示例性的", "需要说明", "值得注意", "可选地", "应当理解", "在本实施例", "在实际应用", "例如", "其中"]),
]

def classify_para(zone, num, body):
    if zone == "claims":
        return claim_role(num, body)
    head = body[:60]
    if zone == "field":
        return "F1技术领域"
    if zone == "figdesc":
        return "F8附图说明"
    if zone == "background":
        for r, kws in BG_HINTS:
            if any(k in body for k in kws): return r
        return "F2背景铺垫"
    if zone == "content":
        for r, kws in FIELD_HINTS:
            if any(k in head for k in kws): return r
        if any(k in body for k in ["有益", "效果", "提高", "降低"]): return "F7有益效果"
        return "F0发明内容其他"
    if zone == "embodiment":
        for r, kws in EMB_HINTS:
            if any(k in head for k in kws): return r
        if re.search(r"步骤\s*S?\d+|如图|参照图|参见图", body[:150]): return "F9实施例转接"
        return "F10实施例句"
    return "F0其他"

def zone_of_section(sec):
    return {"技术领域": "field", "背景技术": "background", "发明内容": "content",
            "附图说明": "figdesc", "具体实施方式": "embodiment"}.get(sec, "content")

def split_claims(text):
    """权项区：从首个 '1 .一种' 到说明书标题（再次出现的发明名称+技术领域）。"""
    m = CLAIM_START.search(text)
    if not m: return "", text
    end = re.search(r"\n\s*一种[^\n]{2,40}\n\s*技术领域", text[m.start():])
    if end:
        claims = text[m.start():m.start() + end.start()]
        rest = text[m.start() + end.start():]
    else:
        end2 = re.search(r"技术领域", text[m.start():])
        claims = text[m.start():m.start() + end2.start()] if end2 else text[m.start():]
        rest = text[m.start() + end2.start():] if end2 else ""
    return claims, rest

def split_sections(text):
    """说明书区按五段标题切区。"""
    marks = []
    for s in SECTIONS:
        for m in re.finditer(rf"\n\s*{s}\s*\n", text):
            marks.append((m.start(), s)); break
    marks.sort()
    zones = []
    for i, (pos, sec) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        zones.append((zone_of_section(sec), text[pos:end]))
    return zones

def process(pub, text):
    t = clean(text)
    claims_txt, desc_txt = split_claims(t)
    rows = []
    # 权项：按 'N .' 切块
    blocks = []
    cur = None
    for ln in claims_txt.split("\n"):
        m = CLAIM_NUM.match(ln)
        if m:
            if cur: blocks.append(cur)
            cur = [int(m.group(1)), ln[m.end():]]
        elif cur is not None:
            cur[1] += " " + ln.strip()
    if cur: blocks.append(cur)
    for num, body in blocks:
        body = re.sub(r"\s+", "", body)
        if len(body) < 8: continue
        rows.append({"pub": pub, "zone": "claims", "num": num,
                     "role": claim_role(num, body), "text": body})
    # 说明书：section → [NNNN] 段落 → 句子
    for zone, ztext in split_sections(desc_txt):
        paras = []
        cur = None
        for m in re.finditer(r"\[(\d{4})\]([^\[\]]+)", ztext):
            paras.append((int(m.group(1)), re.sub(r"\s+", "", m.group(2))))
        for num, para in paras:
            if len(para) < 8: continue
            for s in sentences_of(para):
                rows.append({"pub": pub, "zone": zone, "num": num,
                             "role": classify_para(zone, num, s), "text": s})
    return rows

def main():
    files = sorted(f for f in os.listdir(RAW) if f.endswith(".txt"))
    out = open(OUT, "w", encoding="utf-8")
    total = 0
    from collections import Counter
    roles = Counter()
    for fn in files:
        pub = fn[:-4]
        text = open(os.path.join(RAW, fn), encoding="utf-8").read()
        rows = process(pub, text)
        for r in rows:
            roles[r["role"]] += 1
            out.write(json.dumps(r, ensure_ascii=False) + "\n")
        total += len(rows)
    out.close()
    print(f"{len(files)} pubs -> {total} sentences -> {OUT}")
    for r, c in roles.most_common():
        print(f"  {r}: {c}")

if __name__ == "__main__":
    main()
