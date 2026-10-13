"""s1 拆分件（按职责搬出；名照旧私有下划线，s1.py 经 star re-export 保持原命名空间）。"""
from __future__ import annotations

import re

# 权项引用结构核对——与 preflight claims.multi_multi 同口径的生成侧前置闸：
# 「N至M」区间展开 + 「N或M」「N、M」列举逐项收齐；从属权项以「根据/如/按照…权利要求」起句识别
_CLAIM_REF_ANY = re.compile(
    r"权利要求\s*(\d+)\s*(?:至|到|-|~|～|—)\s*(\d+)"
    r"|权利要求\s*(\d+)((?:\s*(?:或|和|及|、)\s*\d+)*)")


_CLAIM_DEP_LEAD = re.compile(r"^\s*(?:根据|如|按照|依据|依照|按)\s*权利要求")


_CLAIM_NUM_PREFIX = re.compile(r"^\s*\d+\s*[.、．)]?\s*")


def _claim_ref_nums(text: str, self_num: int) -> set[int]:
    refs: set[int] = set()
    for m in _CLAIM_REF_ANY.finditer(text):
        if m.group(2):
            a, b = int(m.group(1)), int(m.group(2))
            refs.update(range(min(a, b), max(a, b) + 1))
        else:
            refs.add(int(m.group(3)))
            refs.update(int(x) for x in re.findall(r"\d+", m.group(4) or ""))
    refs.discard(self_num)
    return refs


def _multi_multi_violations(claims: list[str]) -> list[tuple[int, list[int]]]:
    """多项从属权项（引≥2项的从属）再引多项从属权——§22 违规对；独权型引用（四型束）不算。"""
    refs = {i + 1: _claim_ref_nums(c, i + 1) for i, c in enumerate(claims)}
    dep = {n for n, c in enumerate(claims, 1)
           if _CLAIM_DEP_LEAD.match(_CLAIM_NUM_PREFIX.sub("", c))}
    multi_dep = {n for n in dep if len(refs[n]) > 1}
    return [(n, sorted(refs[n] & multi_dep)) for n in sorted(multi_dep) if refs[n] & multi_dep]


# 独权类型判定钉类型词的句读边界——ddpm-13 实案「一种…概率模型的训练方法」
# 被惰性匹配先撞上「模型」误归装置族，四型束缺型核对与载体并立检出双双被绕过
_CLAIM_SUBJECT = re.compile(
    r"一种[^,，；;]{0,40}?(存储介质|程序产品|电子设备|装置|系统|模型|方法|设备)"
    r"(?=[,，；;:：]|其特征|包括|$)")


def _type_bundle_missing(claims: list[str]) -> list[str]:
    """独权类型组缺型枚举：方法/装置或系统/电子设备/存储介质四族各至少一项独权；
    从属权项不算入，名称含族名后缀识别（系统计入装置族）。"""
    fams: set[str] = set()
    for c in claims:
        head = _CLAIM_NUM_PREFIX.sub("", str(c))
        if _CLAIM_DEP_LEAD.search(head):
            continue
        m = _CLAIM_SUBJECT.search(head)
        if not m:
            continue
        w = m.group(1)
        fams.add("介质" if w in ("存储介质", "程序产品") else
                 "装置" if w in ("装置", "系统", "模型") else
                 "设备" if w in ("电子设备", "设备") else w)
    return [f for f in ("方法", "装置", "设备", "介质") if f not in fams]


def _extra_carrier_indeps(claims: list[str]) -> list[int]:
    """功能载体独权并立检出——装置/系统/模型同族载体独权至多一项（vit-9 实案
    模型+装置并立撑破 14 项上限）；返回超出的独权号（首项保留，其后超出）。"""
    carrier: list[int] = []
    for i, c in enumerate(claims, 1):
        head = _CLAIM_NUM_PREFIX.sub("", str(c))
        if _CLAIM_DEP_LEAD.search(head):
            continue
        m = _CLAIM_SUBJECT.search(head)
        if m and m.group(1) in ("装置", "系统", "模型"):
            carrier.append(i)
    return carrier[1:]


def _no_characterizing(claims: list[str]) -> list[int]:
    """缺「其特征在于」的权项号——两部分式为授权惯例（语料 ~88%，preflight
    claims.characterizing 同口径）。mamba 实案 s1 重写权项整族丢式（14 项
    独权带从权全无此短语）；独权缺失=法定形式缺陷，从权缺失同式。"""
    return [i for i, c in enumerate(claims, 1) if "其特征在于" not in str(c)]


_CLAIM_DEP_REF_HEAD = re.compile(
    r"^(根据|如|按照|依照)权利要求[0-9０-９至—\-或和以及之中任一项\s]+所述的[^，。；：]{1,80}?([，,：:])")


_CLAIM_IND_FEATURE = re.compile(r"(包括|包含|具有|由|步骤如下|包括以下|采用)")


def _insert_characterizing(claim: str) -> str:
    """确定性两部分式插入——不耗模型调用：
    - 从权：引用语「根据权利要求…所述的X，」逗号后即「其特征在于，」，
      原起句引导词（其中/所述/进一步地）并入特征部分；
    - 独权：首个技术特征动词（包括/包含/具有/由…）之前插入，动词并入特征部分；
    - 兜底：首个逗号后插入。
    """
    c = str(claim).strip()
    if "其特征在于" in c:
        return c
    pre_m = re.match(r"^\s*(\d+[.、．)]?\s*)", c)
    pre, body = (pre_m.group(1), c[pre_m.end():]) if pre_m else ("", c)
    m = _CLAIM_DEP_REF_HEAD.match(body)
    if m:
        head, rest = body[: m.start(2)], body[m.end(2):]
        rest = re.sub(r"^\s*(其中|另|此外|进一步地|进一步的|进一步|所述之|所述)[，,、]?", "", rest, count=1)
        return f"{pre}{head}，其特征在于，{rest}"
    m = _CLAIM_IND_FEATURE.search(body)
    if m and m.start() >= 6:
        return pre + body[: m.start()] + "其特征在于，" + body[m.start():]
    m = re.search(r"[，,]", body)
    if m:
        return pre + body[: m.end()] + "其特征在于，" + body[m.end():]
    return pre + body + "，其特征在于，"


def _flat_gradient_violations(claims: list[str]) -> list[tuple[int, int]]:
    """从权无梯度——与 preflight claims.gradient 同口径：同一独权的从权簇（含链式子孙）
    ≥3 项而无一引用在先从权 = 平铺星形。返回 [(独权号, 簇大小)]。"""
    refs = {i + 1: _claim_ref_nums(c, i + 1) for i, c in enumerate(claims)}
    dep = {n for n, c in enumerate(claims, 1)
           if _CLAIM_DEP_LEAD.match(_CLAIM_NUM_PREFIX.sub("", c))}
    children: dict[int, list[int]] = {}
    for n in dep:
        for t in refs[n]:
            children.setdefault(t, []).append(n)
    out = []
    for indep, kids in sorted(children.items()):
        if indep in dep:
            continue
        stack, cluster = list(kids), []
        while stack:
            d = stack.pop()
            if d in dep and d not in cluster:
                cluster.append(d)
                stack.extend(children.get(d, []))
        if len(cluster) >= 3 and not any(t in dep for d in cluster for t in refs[d]):
            out.append((indep, len(cluster)))
    return out


def _claim_family(head: str) -> str | None:
    m = _CLAIM_SUBJECT.search(head)
    if not m:
        return None
    w = m.group(1)
    return ("介质" if w in ("存储介质", "程序产品") else
            "装置" if w in ("装置", "系统", "模型") else
            "设备" if w in ("电子设备", "设备") else w)


def _claim_families(claims: list[str]) -> list[str | None]:
    """逐项权项族别：独权按句读边界类型词；从权按其归属独权链根的族别
    （从权头形为重述独权名，族词归链根最稳，链根判不出再回退头部族词）。"""
    heads = [_CLAIM_NUM_PREFIX.sub("", str(c)) for c in claims]
    dep = {n for n, h in enumerate(heads, 1) if _CLAIM_DEP_LEAD.search(h)}
    refs = {n: _claim_ref_nums(c, n) for n, c in enumerate(claims, 1)}
    fams: list[str | None] = [None] * len(claims)

    def root_family(n: int, seen: set[int] | None = None) -> str | None:
        seen = seen or set()
        if n in seen or n < 1 or n > len(claims):
            return None
        seen.add(n)
        if n not in dep:
            return _claim_family(heads[n - 1])
        for t in sorted(refs.get(n) or []):
            f = root_family(t, seen)
            if f:
                return f
        return None

    for n in range(1, len(claims) + 1):
        if n in dep:
            fams[n - 1] = root_family(n)
            if not fams[n - 1]:
                m = re.search(r"(存储介质|程序产品|电子设备|装置|系统|模型|方法|设备)", heads[n - 1])
                if m:
                    w = m.group(1)
                    fams[n - 1] = ("介质" if w in ("存储介质", "程序产品") else
                                   "装置" if w in ("装置", "系统", "模型") else
                                   "设备" if w in ("电子设备", "设备") else w)
        else:
            fams[n - 1] = _claim_family(heads[n - 1])
    return fams


# 载体权「…任一项所述方法」引用——只许指向方法族权项；ddpm-r84 实案权3/4 引用
# 「权利要求1至2任一项所述方法」而权2为系统独权，非方法权项被拽进方法引用范围
_CARRIER_METHOD_REF = re.compile(
    r"权利要求[\s\d至到\-~～—、或和及]*任一项?所述方法|权利要求\s*\d+\s*所述方法")


def _carrier_method_ref_violations(claims: list[str]) -> list[int]:
    """载体权（装置/设备/介质族）引「所述方法」时，被引范围含非方法族权项的权项号。"""
    heads = [_CLAIM_NUM_PREFIX.sub("", str(c)) for c in claims]
    fams = _claim_families(claims)
    bad = []
    for n, h in enumerate(heads, 1):
        if fams[n - 1] == "方法" or fams[n - 1] is None:
            continue
        for m in _CARRIER_METHOD_REF.finditer(h):
            seg = m.group(0)
            rng = re.search(r"(\d+)\s*(?:至|到|-|~|～|—)\s*(\d+)", seg)
            if rng:
                a, b = int(rng.group(1)), int(rng.group(2))
                tgt = range(min(a, b), max(a, b) + 1)
            else:
                nums = [int(x) for x in re.findall(r"\d+", seg)]
                tgt = nums[:1]
            if any(1 <= t <= len(claims) and fams[t - 1] != "方法" for t in tgt):
                bad.append(n)
                break
    return sorted(set(bad))


def _normalize_claim_order(claims: list[str]) -> list[str]:
    """权项簇确定性重排为授权件惯例序——各独权后紧随其从权簇（DFS 保持原序），
    再按新号改写全部「权利要求N」引用；载体权的「所述方法」引用归一至方法族全块。
    已成惯例序时为重排恒等操作。返回新权项表（编号重排）。"""
    heads = [_CLAIM_NUM_PREFIX.sub("", str(c)) for c in claims]
    dep = {n for n, h in enumerate(heads, 1) if _CLAIM_DEP_LEAD.search(h)}
    refs = {n: _claim_ref_nums(c, n) for n, c in enumerate(claims, 1)}
    indeps = [n for n in range(1, len(claims) + 1) if n not in dep]

    # 从权挂其引用号中最大者（同簇内最近被引节点作父）
    children: dict[int, list[int]] = {}
    for n in sorted(dep):
        cand = [t for t in refs.get(n) or set() if t != n]
        if not cand:
            continue
        children.setdefault(max(cand), []).append(n)

    order: list[int] = []
    seen: set[int] = set()

    def emit(n: int) -> None:
        if n in seen or n < 1 or n > len(claims):
            return
        seen.add(n)
        order.append(n)
        for k in children.get(n, []):
            emit(k)

    for i in indeps:
        emit(i)
    for n in range(1, len(claims) + 1):
        emit(n)
    if order != sorted(order) and len(order) == len(claims):
        remap = {old: new for new, old in enumerate(order, 1)}
        reordered = [claims[old - 1] for old in order]

        def _reno(text: str) -> str:
            def sub(m: re.Match) -> str:
                if m.group(2):
                    a, b = remap.get(int(m.group(1)), int(m.group(1))), remap.get(int(m.group(2)), int(m.group(2)))
                    conn = re.search(r"至|到|-|~|～|—", m.group(0))
                    return f"权利要求{a}{conn.group(0) if conn else '至'}{b}"
                tail = re.sub(r"\d+", lambda x: str(remap.get(int(x.group(0)), int(x.group(0)))), m.group(4) or "")
                return f"权利要求{remap.get(int(m.group(3)), int(m.group(3)))}{tail}"
            return _CLAIM_REF_ANY.sub(sub, text)
        reordered = [_reno(str(c)) for c in reordered]
    else:
        reordered = [str(c) for c in claims]

    # 载体权「所述方法」引用归一：仅对违约权项（引用范围含非方法族）改写至
    # 方法族全块；合法单引（如系统权「执行权利要求1所述方法」）保留不动
    fams = _claim_families(reordered)
    mnums = [n for n, f in enumerate(fams, 1) if f == "方法"]
    bad = set(_carrier_method_ref_violations(reordered))
    if mnums and bad:
        lo, hi = min(mnums), max(mnums)
        block = f"权利要求{lo}至{hi}任一项" if hi > lo else f"权利要求{lo}"
        if any(1 <= t <= len(reordered) and fams[t - 1] != "方法" for t in range(lo, hi + 1)):
            block = "权利要求" + "、".join(map(str, mnums)) + "任一项"
        reordered = [
            _CARRIER_METHOD_REF.sub(block + "所述方法", c) if i + 1 in bad else c
            for i, c in enumerate(reordered)]
    return [f"{i + 1}.{_CLAIM_NUM_PREFIX.sub('', c, count=1).lstrip()}"
            for i, c in enumerate(reordered)]

__all__ = [
    "_CARRIER_METHOD_REF",
    "_CLAIM_DEP_LEAD",
    "_CLAIM_DEP_REF_HEAD",
    "_CLAIM_IND_FEATURE",
    "_CLAIM_NUM_PREFIX",
    "_CLAIM_REF_ANY",
    "_CLAIM_SUBJECT",
    "_carrier_method_ref_violations",
    "_claim_families",
    "_claim_family",
    "_claim_ref_nums",
    "_extra_carrier_indeps",
    "_flat_gradient_violations",
    "_insert_characterizing",
    "_multi_multi_violations",
    "_no_characterizing",
    "_normalize_claim_order",
    "_type_bundle_missing",
]
