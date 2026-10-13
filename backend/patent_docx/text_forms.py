"""text_forms — 专利文「形库」：真实 CN 案句子的角色化范例，供提示词注入。

数据源 docs/text-corpus/forms_library.json（tools/harvest_text→segment_text→build_formlib 产物）。
懒加载一次；文件缺失时所有接口静默返回空串（提示词层不必判空）。

角色域：F1 技术领域 / F2 背景铺垫 / F3 痛点转折 / F4 发明内容 / F5 方面枚举 /
F6 可选变体 / F7 有益效果 / F8 附图说明 / F9 实施例转接 /
C1 独权句式 / C2 从属起句 / C3 单元定义。
"""
from __future__ import annotations

import json
import math
import os
import re
from functools import lru_cache

_LIB_ENV = "PATENT_FORMS_LIBRARY"
_DEFAULTS = [
    "docs/text-corpus/forms_library.json",          # 容器 / 仓库根
    "../docs/text-corpus/forms_library.json",       # backend/ 工作目录
]


def _find() -> str | None:
    p = os.environ.get(_LIB_ENV)
    if p:
        return p if os.path.exists(p) else None
    for rel in _DEFAULTS:
        if os.path.exists(rel):
            return rel
    here = os.path.dirname(os.path.abspath(__file__))
    for up in (here, os.path.dirname(here), os.path.dirname(os.path.dirname(here))):
        cand = os.path.join(up, "docs", "text-corpus", "forms_library.json")
        if os.path.exists(cand):
            return cand
    return None


@lru_cache(maxsize=1)
def _lib() -> dict:
    p = _find()
    if not p:
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def roles() -> list[str]:
    return list(_lib().get("roles", {}).keys())


def exemplars(role: str, k: int = 6, max_chars: int = 140) -> list[str]:
    """该角色真实专利例句（跨案优先，截断到 max_chars）。"""
    d = _lib().get("roles", {}).get(role, {})
    out = []
    for e in d.get("exemplars", [])[:k]:
        s = e["ex"]
        out.append(s[:max_chars])
    return out


def frames(role: str, k: int = 6) -> list[str]:
    """该角色高频骨架（{SELF}/{CL#}/{FIG#}/# 槽化）。"""
    d = _lib().get("roles", {}).get(role, {})
    return [f["frame"] for f in d.get("frames", [])[:k]]


def exemplar_block(role: str, k: int = 5) -> str:
    """可直嵌提示词的范例块：'「……」' 逐行列出，空库返回 ''。"""
    xs = exemplars(role, k)
    if not xs:
        return ""
    return "真实专利表述范例（模仿句式不抄内容）：" + "；".join(f"「{s}」" for s in xs)


def description_block(k_per_role: int = 3) -> str:
    """说明书各节打包范例块：技术领域/背景痛点/发明内容/效果/转接各取 k 条。"""
    parts = []
    for role, label in [("F1技术领域", "技术领域起句"), ("F3痛点转折", "背景痛点"),
                        ("F4发明内容", "发明内容"), ("F5方面枚举", "方面枚举"),
                        ("F6可选变体", "可选变体"), ("F7有益效果", "有益效果"),
                        ("F9实施例转接", "实施例转接")]:
        xs = exemplars(role, k_per_role)
        if xs:
            parts.append(f"{label}：" + "；".join(f"「{s[:110]}」" for s in xs))
    return "真实专利表述范例（句式参照，勿抄内容）：\n" + "\n".join(parts) if parts else ""


def section_sent_block(query: str, roles: list[str], k: int = 6, label: str = "") -> str:
    """句级同域检索：按节角色取向量最相似的真案原句——比案级粒度细，直命中句式层。
    空索引/无命中返回 ''。"""
    hits = match_sents(query, top=k * 3, roles=roles)
    seen, xs = set(), []
    for h in hits:
        t = h["text"]
        if t in seen:
            continue
        seen.add(t)
        xs.append(t)
        if len(xs) >= k:
            break
    if not xs:
        return ""
    head = f"同领域真实案{label or ''}句级范例（句式参照，勿抄内容）："
    return head + "\n" + "\n".join(f"「{x[:120]}」" for x in xs)


@lru_cache(maxsize=1)
def _skel() -> dict:
    p = _find()
    if not p:
        return {}
    sp = os.path.join(os.path.dirname(p), "claim_skeletons.json")
    if not os.path.exists(sp):
        return {}
    try:
        return json.load(open(sp, encoding="utf-8"))
    except Exception:
        return {}


def claims_skeleton_block(top: int = 5) -> str:
    """权项骨架范式块：真实案独权种类序分布 + 从属链深分布。空库返回 ''。"""
    d = _skel()
    seqs = d.get("indep_sequences") or []
    if not seqs:
        return ""
    name = {"method": "方法独权", "apparatus": "装置/系统/设备独权", "medium": "介质独权",
            "model": "模型独权", "product": "程序产品独权", "chip": "芯片独权", "other": "其他独权"}
    rows = []
    for s in seqs[:top]:
        rows.append("→".join(name.get(k, k) for k in s["seq"]) + f"（{s['count']}案）")
    dep = d.get("chain_depth_dist") or {}
    dep_s = "、".join(f"{k}层:{v}案" for k, v in sorted(dep.items(), key=lambda x: int(x[0]))[:5])
    return (f"真实权项骨架范式（{d.get('pubs', 0)}案分布）：" + "；".join(rows)
            + (f"。从属链深分布：{dep_s}" if dep_s else ""))


def claims_block(k: int = 4) -> str:
    """权项范例块：独权句式 + 从属起句。"""
    parts = []
    for role, label in [("C1独权句式", "独权句式"), ("C2从属起句", "从属起句")]:
        xs = exemplars(role, k)
        if xs:
            parts.append(f"{label}：" + "；".join(f"「{s[:110]}」" for s in xs))
    return "真实权项表述范例（句式参照，勿抄内容）：\n" + "\n".join(parts) if parts else ""


@lru_cache(maxsize=1)
def _trees() -> dict:
    p = _find()
    if not p:
        return {}
    tp = os.path.join(os.path.dirname(p), "claim_trees.json")
    if not os.path.exists(tp):
        return {}
    try:
        return json.load(open(tp, encoding="utf-8"))
    except Exception:
        return {}


def claim_tree_block(query: str, top: int = 1) -> str:
    """结构化引用：检索最相似真实案，给出该案权项树的「独权束+从属链」拓扑，
    让成稿按真案树形组织——宏观骨架参照而非句子范例。空库/无树返回 ''。"""
    trees = _trees()
    if not trees:
        return ""
    hits = [p for p in match_pubs(query, 12) if p in trees][:top]
    if not hits:
        return ""
    kind_name = {"method": "方法", "apparatus": "装置/系统", "medium": "介质",
                 "model": "模型", "product": "程序产品", "chip": "芯片", "other": "其他"}
    titles = pub_titles()
    parts = []
    for p in hits:
        t = trees[p]
        indep = [(i["num"], kind_name.get(i["kind"], i["kind"])) for i in t.get("indep", [])]
        edges = {int(k): v for k, v in (t.get("edges") or {}).items()}
        # 每个独权簇：独权号+种类 + 其引用的从属链
        indep_nums = [n for n, _ in indep]
        segs = []
        for idx, (num, kind) in enumerate(indep):
            nxt = indep_nums[idx + 1] if idx + 1 < len(indep_nums) else t.get("total", 999) + 1
            deps = sorted(d for d in edges if num < d < nxt)
            chain = "、".join(f"{d}→{','.join(map(str, edges[d]))}" for d in deps)
            segs.append(f"独权{num}({kind})" + (f" 从属链[{chain}]" if chain else ""))
        title = titles.get(p, "")
        parts.append(f"{p}（{title}）：共{t.get('total', '?')}项；" + "；".join(segs))
    return ("同领域真实案权项树形（架构参照——独权束种类序与从属链拓扑按此组织，非照抄内容）：\n"
            + "\n".join(parts))


def oa_argue_block(claim_text: str, top: int = 3) -> str:
    """OA 争辩引证块：以被指出权项检索最接近的授权现有技术，给出案号+授权独权句式供
    争辩定位与反向区分；附三步法争辩范式。空库返回 ''。"""
    _, sents = _pub_vecs()
    if not sents:
        return ""
    hits = match_pubs(claim_text, 10)
    titles = pub_titles()
    rows = []
    for p in hits:
        c1 = (sents.get(p, {}).get("C1独权句式") or [""])[0][:110]
        q = f"授权独权句式：「{c1}」" if c1 else "（题录未收录句式）"
        rows.append(f"- {p}《{titles.get(p, '')}》{q}")
        if len(rows) >= top:
            break
    if not rows:
        return ""
    return ("系统检索到的最接近授权现有技术（争辩引证参照——意见陈述中必须引用案号标注，"
            "用于区别特征对比、公知手段举证或反向区分论述）：\n" + "\n".join(rows)
            + "\n争辩范式（三步法）：先确定与最接近现有技术的区别特征→由区别特征确定实际解决的"
            "技术问题→论证现有技术未给出将该区别特征应用于最接近现有技术的技术启示（对比文件"
            "仅公开……未公开/未启示……）；惯用句式：「权利要求N与对比文件M的区别在于……，基于"
            "该区别特征实际解决的技术问题是……，对比文件M及本领域公知常识均未给出……的技术启示」。")


# ---------- 同领域语义检索（案级 TF-IDF 向量，勿抄内容只仿句式） ----------

def _qvec(query: str) -> dict:
    t = re.sub(r"\s+", "", query.lower())
    v = {}
    for i in range(len(t) - 2):
        g = t[i:i + 3]
        v[g] = v.get(g, 0) + 1.0
    return v


@lru_cache(maxsize=1)
def _pub_vecs() -> tuple[dict, dict]:
    p = _find()
    if not p:
        return {}, {}
    d = os.path.dirname(p)
    try:
        vecs = json.load(open(os.path.join(d, "pub_vectors.json"), encoding="utf-8"))["vectors"]
        sents = json.load(open(os.path.join(d, "pub_sents.json"), encoding="utf-8"))
        return vecs, sents
    except Exception:
        return {}, {}


def match_pubs(query: str, top: int = 6) -> list[str]:
    """query 文本 -> 余弦最相似的案号列表（无索引返回 []）。"""
    vecs, _ = _pub_vecs()
    if not vecs:
        return []
    qv = _qvec(query)
    qn = math.sqrt(sum(w * w for w in qv.values())) or 1.0
    scored = []
    for p, dv in vecs.items():
        dot = sum(w * dv.get(g, 0.0) for g, w in qv.items())
        if dot <= 0:
            continue
        dn = math.sqrt(sum(w * w for w in dv.values())) or 1.0
        scored.append((dot / (qn * dn), p))
    return [p for _, p in sorted(scored, reverse=True)[:top]]


@lru_cache(maxsize=1)
def _sent_vecs() -> list:
    """句级向量索引（sent_vectors.json，缺文件返回 []）。"""
    p = _find()
    if not p:
        return []
    fp = os.path.join(os.path.dirname(p), "sent_vectors.json")
    try:
        return json.load(open(fp, encoding="utf-8")) if os.path.exists(fp) else []
    except Exception:
        return []


def match_sents(query: str, top: int = 8, roles: list[str] | None = None) -> list[dict]:
    """句级语义检索：返回 [{pub, role, text, score}] 按余弦降序。无索引返回 []。"""
    sv = _sent_vecs()
    if not sv:
        return []
    qv = _qvec(query)
    qn = math.sqrt(sum(w * w for w in qv.values())) or 1.0
    scored = []
    for e in sv:
        if roles and e["role"] not in roles:
            continue
        dv = e["vec"]
        dot = sum(w * dv.get(g, 0.0) for g, w in qv.items())
        if dot <= 0:
            continue
        dn = math.sqrt(sum(w * w for w in dv.values())) or 1.0
        scored.append((dot / (qn * dn), e))
    return [{"pub": e["pub"], "role": e["role"], "text": e["text"], "score": round(s, 4)}
            for s, e in sorted(scored, key=lambda x: x[0], reverse=True)[:top]]


def pub_titles() -> dict:
    """案号->标题映射（pub_sents.json 内嵌 _titles）。"""
    _, sents = _pub_vecs()
    return sents.get("_titles", {}) if sents else {}


def domain_exemplar_block(query: str, roles: list[str] | None = None, per_role: int = 2,
                          top_pubs: int = 6) -> str:
    """同领域真实案表述块：找最近似的 top_pubs 个案，按角色抽其原句。空库返回 ''。"""
    _, sents = _pub_vecs()
    if not sents:
        return ""
    hits = match_pubs(query, top_pubs)
    if not hits:
        return ""
    roles = roles or ["C1独权句式", "C2从属起句", "F1技术领域", "F4发明内容", "F7有益效果"]
    label = {"C1独权句式": "独权句式", "C2从属起句": "从属起句", "C3单元定义": "单元定义",
             "F1技术领域": "技术领域起句", "F4发明内容": "发明内容", "F7有益效果": "有益效果",
             "F9实施例转接": "实施例转接", "F3痛点转折": "背景痛点"}
    parts, seen = [], set()
    for role in roles:
        xs = []
        for p in hits:
            for s in sents.get(p, {}).get(role, []):
                if s not in seen:
                    seen.add(s)
                    xs.append(s[:110])
                    if len(xs) >= per_role:
                        break
            if len(xs) >= per_role:
                break
        if xs:
            parts.append(f"{label.get(role, role)}：" + "；".join(f"「{s}」" for s in xs))
    if not parts:
        return ""
    return f"同领域真实案表述（{len(hits)}案相似，句式参照勿抄内容）：\n" + "\n".join(parts)


# ---------- 语料重叠哨兵（防搬运：形可借句不可搬） ----------

def _norm(s: str) -> str:
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"权利要求\s*\d+(?:\s*(?:至|-|—|~)\s*\d+)?\s*中?任一项?(?:所述|中)的?", "{CL#}", s)
    s = re.sub(r"图\s*\d+[A-Za-z]?(?:[-‑]\d+[A-Za-z]?)*", "{FIG#}", s)
    s = re.sub(r"\d+(?:\.\d+)?%?", "#", s)
    for w in ("本申请", "本发明", "本公开", "本方案", "本实施例", "本技术方案"):
        s = s.replace(w, "{SELF}")
    return s


def _h64(s: str) -> str:
    import hashlib
    return hashlib.blake2b(s.encode(), digest_size=8).hexdigest()


def _shingles(s: str, n: int = 12) -> set[str]:
    if len(s) < n:
        return set()
    gs = [s[i:i + n] for i in range(0, len(s) - n + 1, n // 2)]
    step = max(1, len(gs) // 12)
    return set(gs[::step])


@lru_cache(maxsize=1)
def _index() -> tuple[set, set, set, set]:
    p = _find()
    if not p:
        return set(), set(), set(), set()
    idx = os.path.join(os.path.dirname(p), "corpus_index.json")
    if not os.path.exists(idx):
        return set(), set(), set(), set()
    try:
        d = json.load(open(idx, encoding="utf-8"))
        return (set(d.get("norms", [])), set(d.get("grams", [])),
                set(d.get("boiler_norms", [])), set(d.get("boiler_grams", [])))
    except Exception:
        return set(), set(), set(), set()


# 通行套话白名单——图注「图N为…」与附图说明转接句在授权文本间本就逐字相同，
# 不算搬运（形库自身也教这些句式）；只对「整句皆套话」豁免，套话起头带实质内容的句子仍查。
_BOILERPLATE = re.compile(
    r"^(图\s*\d+\s*为|下面(将)?(结合|参照)\S{0,30}[。；]?$"
    r"|以上实施(方式|例)(和具体实施方式)?(仅|只)?用于说明\S{0,25}[。；]?$)")
_BOILERPLATE_CAPTION = re.compile(r"^图\s*\d+\s*为.{0,60}[。；]?$")


def _is_boilerplate(s: str) -> bool:
    s = s.strip()
    return bool(_BOILERPLATE.match(s) or _BOILERPLATE_CAPTION.match(s))


def corpus_overlap(sentences: list[str]) -> list[str]:
    """返回与语料撞车的原句：归一全句命中 或 ≥40% 采样 12-gram 命中。库缺失返回 []。
    boiler_* 为「≥5 篇不同案共用」的行业套话哈希——撞一片是通行句式不算搬运，
    撞一两篇才报警；gram 级只对非套话块计数。"""
    norms, grams, boiler_norms, boiler_grams = _index()
    if not norms:
        return []
    out = []
    for s in sentences:
        if _is_boilerplate(s):
            continue
        n = _norm(s)
        h = _h64(n)
        if h in norms:
            if h not in boiler_norms:
                out.append(s)
            continue
        gs = _shingles(n)
        if gs and sum(1 for g in gs if _h64(g) in grams and _h64(g) not in boiler_grams) / len(gs) >= 0.4:
            out.append(s)
    return out
