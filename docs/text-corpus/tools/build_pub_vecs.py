#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按案构建 TF-IDF 稀疏向量 -> pub_vectors.json + pub_sents.json。

pub_vectors: 每案全部句子(截断) -> char-3gram TF-IDF，每案留 top-160 个 gram。
pub_sents:   {pub: {role: [原句]}} 仅留检索注入用角色。
"""
import json, math, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from segment_text import clean  # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP_ROLES = ["C1独权句式", "C2从属起句", "C3单元定义", "F1技术领域", "F4发明内容", "F7有益效果", "F9实施例转接", "F3痛点转折"]
TOP_GRAMS, MAX_SENTS_PER_ROLE = 160, 6


def grams(text):
    t = re.sub(r"\s+", "", text.lower())
    return [t[i:i+3] for i in range(len(t) - 2)]


def main():
    pubs = {}
    for line in open(os.path.join(ROOT, "sentences.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        pubs.setdefault(r["pub"], []).append(r)

    df, pub_tf = {}, {}
    for p, rows in pubs.items():
        txt = " ".join(r["text"] for r in rows)
        g = grams(txt)
        tf = {}
        for x in g:
            tf[x] = tf.get(x, 0) + 1
        pub_tf[p] = tf
        for x in set(tf):
            df[x] = df.get(x, 0) + 1

    n = len(pubs)
    idf = {g: math.log(n / (c + 1) + 1) for g, c in df.items()}
    vectors = {}
    for p, tf in pub_tf.items():
        items = sorted(tf.items(), key=lambda kv: kv[1] * idf[kv[0]], reverse=True)[:TOP_GRAMS]
        vectors[p] = {g: round(c * idf[g], 4) for g, c in items if c * idf[g] > 0}

    sents = {}
    for p, rows in pubs.items():
        per = {}
        for r in rows:
            if r["role"] in KEEP_ROLES:
                per.setdefault(r["role"], [])
                if len(per[r["role"]]) < MAX_SENTS_PER_ROLE:
                    per[r["role"]].append(r["text"])
        sents[p] = per

    # 句级向量：KEEP_ROLES 全部句子（不限每角色 6 条）各留 top-48 gram
    SENT_TOP_GRAMS = 32
    sent_vecs = []
    for p, rows in pubs.items():
        for r in rows:
            if r["role"] not in KEEP_ROLES:
                continue
            tf = {}
            for x in grams(r["text"]):
                tf[x] = tf.get(x, 0) + 1
            items = sorted(tf.items(), key=lambda kv: kv[1] * idf[kv[0]], reverse=True)[:SENT_TOP_GRAMS]
            vec = {g: round(c * idf[g], 4) for g, c in items if c * idf[g] > 0}
            if vec:
                sent_vecs.append({"pub": p, "role": r["role"], "text": r["text"], "vec": vec})

    # 案号->标题（pages/ 页头「## Page N: CNxxx - 标题」提取），查新命中卡用
    titles = {}
    re_title = re.compile(r"^## Page \d+:\s*(CN\d+[A-Z]?)\s*-\s*(.+?)\s*$", re.M)
    for p in pubs:
        fp = os.path.join(ROOT, "pages", p + ".txt")
        if not os.path.exists(fp):
            continue
        head = open(fp, encoding="utf-8", errors="ignore").read(2000)
        m = re_title.search(head)
        if m:
            titles[p] = re.sub(r"\s*-\s*Google Patents.*$", "", m.group(2)).strip()

    json.dump({"pubs": n, "vectors": vectors}, open(os.path.join(ROOT, "pub_vectors.json"), "w", encoding="utf-8"), ensure_ascii=False)
    sents["_titles"] = titles
    json.dump(sents, open(os.path.join(ROOT, "pub_sents.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(sent_vecs, open(os.path.join(ROOT, "sent_vectors.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"pubs={n} sents={len(sent_vecs)} -> pub_vectors.json, pub_sents.json, sent_vectors.json")
    for fn in ("pub_vectors.json", "pub_sents.json", "sent_vectors.json"):
        print(" ", fn, round(os.path.getsize(os.path.join(ROOT, fn)) / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
