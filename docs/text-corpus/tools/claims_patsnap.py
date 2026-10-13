"""claims_patsnap.py — PatSnap claim-data 落盘 JSON → 与 pages/raw 同构树 + C 句式。

claims_patsnap/{pub}.json: {blocks:[{num,dep,body}]}（dep=True 为 div dep-clm）
provide:
  claims_of_dir(fn)     → [(num,body,dep_flag)] 供 claim_trees.parse_claims 类消费
  claim_sents(blocks)   → [sent] 独权整句（C1）/ 从属首句（C2）供 sentences.jsonl 增补
"""
import json, re

REF_RE = re.compile(r"(?:权利要求|权)\s*(\d+)\s*(?:(?:至|-|—|~)\s*(\d+))?\s*(?:中?任一项)?")


def blocks_of(fn):
    try:
        d = json.load(open(fn, encoding="utf-8"))
    except Exception:
        return []
    return d.get("blocks") or []


def to_claims(blocks):
    """blocks → [(num, body)] 与 claims_of_pages 同形（独/从标志由 body 里回引判，
    patsnap dep 标志直接并入 body 前缀不可见——树判定仍走回引解析，口径一致）。"""
    return [(b["num"], b["body"]) for b in blocks if isinstance(b.get("num"), int)]


def refs_of(body):
    """从属回引：body 前 120 字内出现的权利要求号（多段体/分号枚举都算）。"""
    refs = []
    for m in REF_RE.finditer(body[:120]):
        lo = int(m.group(1))
        refs.extend(range(lo, int(m.group(2)) + 1) if m.group(2) else [lo])
    return refs


def dep_flag(block):
    """patsnap dep-clm 标志 ∪ 回引判定——两个任一命中即从权。"""
    return bool(block.get("dep")) or bool(refs_of(block["body"]))
