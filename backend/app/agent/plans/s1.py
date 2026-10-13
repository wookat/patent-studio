# -*- coding: utf-8 -*-
"""S1 交底书 → 三书初稿（21 §6.1；R-AI-03）。

params: {"text": 交底书全文} 或 {"attachment": 案卷 attachments/ 内文件名}；可选 questionnaire（发明人问卷 dict）；
target: "current"（缺省，现案）| "new"（新案）。

新案：走现有一键转专利管线 convert.pipeline.run(is_new=True)——按文件名新建案卷并 save_content 到**新案**；
      本案（ctx.pid）不动。新案的 owner 授权（auth.grant_owner 需 User 对象）由调用方（routes_agent）在 done 后完成。
现案：heavy 规划 1 步（大纲 JSON）+ 成稿 gen ×3（权利要求 / 说明书各节 / 摘要）→ 虚拟装入现案 → parse +
      preflight_delta → patch（BlocksPatch 新块：权项接在末项后并续号、说明书各节接在该节末尾、摘要仅在为空时插入）。
      两次装不进则降级为 comment 附草稿。
"""
from __future__ import annotations

import json
import os
import re

from app.agent import checks
from app.agent.plans import CheckStep, GenStep, Plan, RunContext, ToolStep, common
from app.agent.plans._s1_claims import (
    _carrier_method_ref_violations,
    _claim_ref_nums,  # noqa: F401 — 测试经 s1._x 取址
    _extra_carrier_indeps,
    _flat_gradient_violations,
    _insert_characterizing,
    _multi_multi_violations,
    _no_characterizing,
    _normalize_claim_order,
    _type_bundle_missing,
)
from app.agent.plans._s1_eqtab import (
    _CAPTION_LINE,
    _TAB_CAPTION,
    _caption_orphan_tables,
    _dedupe_captions,
    _eq_decls,
    _eq_renumber,
    _explode_caption_paras,
    _fix_semantic_tab_refs,
    _formulas_missing_body,
    _is_table_block,  # noqa: F401 — 测试经 s1._x 取址
    _pipe_cols,  # noqa: F401 — 测试经 s1._x 取址
    _rejoin_split_tables,
    _retable,
    _single_pipe_frag,  # noqa: F401 — 测试经 s1._x 取址
    _strip_detached_tables,
    _table_refs_missing,
    _table_zone_end,
    _tables_missing_body,
    _wrap_bare_latex,
    _wrap_pipe_frag_tables,
    _wrap_text_formulas,
)
from app.agent.types import BlocksPatch, CheckResult, FileAnchor, FilePatch, PatchBlock
from app.ai import prompts_agent
from app.convert import extract, pipeline, questionnaire
from app.convert.pipeline import DESC_SECTIONS
from app.domain import attachments, cases
from app.routes.convert import new_pid
from patent_docx import patch, text_forms
from patent_docx.preflight import _ABSTRACT_ELEMENTS as _ABS_ELEMENTS
from patent_docx.preflight import (
    _LEGEND_RE,
    _META_WORDS,
    _NUMERAL_RE,
    _PAPER_TONE,
    _PROMO_RE,
    _abbr,
    _numeral_name,
    limit_abstract,
    normalize_self_ref,
)

_ABS_SCHEME = next(p for n, p in _ABS_ELEMENTS if n == "技术方案")
_EFFECT_VERB = re.compile(r"提高|降低|改善|提升|减少|避免|简化|加快|缩短|从而|使得|达到了?[^，。]{0,20}效果")
_EFFECT_MARK = re.compile(r"从而|使得|由此|可见")

PLAN = Plan(
    scenario="s1",
    steps=(
        ToolStep("read_source", "读取交底书文本"),
        GenStep("outline", "规划三书大纲（heavy 1 步）", "heavy"),
        GenStep("claims", "成稿：权利要求", "interactive"),
        GenStep("description", "成稿：说明书各节", "interactive"),
        GenStep("abstract", "成稿：摘要", "interactive"),
        GenStep("figsrc", "成稿：附图图源草图（含缺号补弹）", "interactive"),
        CheckStep("verify", "虚拟装入现案并体检", ("parse", "preflight_delta")),
    ),
    model_route="heavy",
    budget_key="s1",
    output_kind=("patch", "comment"),
)


_DESC_GROUPS = (("技术领域", "背景技术"), ("发明内容",), ("附图说明",), ("具体实施方式",))
# 各节组对应的句级检索角色——拉同域真案原句当句式参照（附图说明为套话节不检）
_DESC_SENT_ROLES = {
    ("技术领域", "背景技术"): ["F1技术领域", "F3痛点转折"],
    ("发明内容",): ["F4发明内容", "F5方面枚举", "F6可选变体", "F7有益效果"],
    ("具体实施方式",): ["F9实施例转接"],
}


def read_source(store, pid: str, params: dict) -> tuple[str, str, extract.Extracted]:
    """(filename, text, extracted)。attachment 用 convert.extract 抽取（docx/pdf/md/txt）；text 直接用。"""
    name = str(params.get("attachment") or "")
    if name:
        path = attachments.attachment_path(store, pid, name)
        with open(path, "rb") as f:
            ex = extract.extract(name, f.read())
        return name, ex["text"], ex
    text = str(params.get("text") or "")
    if not text.strip():
        raise ValueError("S1 需要 params.text 或 params.attachment")
    return "disclosure.txt", text, extract.Extracted(text=text, pages=1, warnings=[], figures=[])


def _section_tail(d, name: str) -> str | None:
    """说明书某节最后一个可编辑块 id（节标题块本身也可编辑）；无该节 → None。"""
    tail = None
    inside = False
    for b in d.ast["description"]:
        if b["kind"] == "section":
            if inside:
                break
            inside = b.get("title") == name
        if inside:
            tail = b["id"]
    return tail


_STUB = re.compile(r"XXX|步骤一|……")
_HEADING = re.compile(r"^\s*#+\s")


def _clean_book_text(t: str) -> str:
    """模型输出混入的书名/节名行（# 题、## 摘要）→ 除名后扁平成一行。"""
    return " ".join(l.strip() for l in t.split("\n") if l.strip() and not _HEADING.match(l))


_ABS_STUB = re.compile(r"XXX|……|≤\s*300|（≤[^）]*字）")


_ABS_JSON_RE = re.compile(r'\{?\s*"?abstract"?\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}?')


def _unwrap_abstract_json(t: str) -> str:
    """模型可能照字面输出 {"abstract": "正文"} 或把 {abstract: "…"} 片段内联进正文
    ——整串 JSON 取字段值；内联片段就地展开为字段值；取不到按原文。"""
    t = t.strip()
    if t.startswith("{"):
        try:
            d = json.loads(t)
            if isinstance(d, dict) and isinstance(d.get("abstract"), str):
                return d["abstract"].strip()
        except (json.JSONDecodeError, ValueError):
            pass
    return _ABS_JSON_RE.sub(lambda m: m.group(1).replace('\\"', '"'), t).strip()


_ABS_OPEN = re.compile(r"^\s*本(?:申请|实用新型)(公开|涉及|实施|提出|提供)")


def _clean_abstract(t: str) -> str:
    """摘要行级清洗：剥离模型回声行——占位模板（XXX/……）、字数标记（≤300 字）
    与节名行，再扁平；真实摘要不会含这些占位模式。
    起句口径归一「本发明公开」——语料该型 ~700 件占绝对多数，说明书首段也用本发明，
    摘要写「本申请公开」是族内不一致（bert-12 实案同案两书两种自称）。"""
    s = _unwrap_abstract_json(" ".join(l.strip() for l in (t or "").split("\n")
                                      if l.strip() and not _HEADING.match(l) and not _ABS_STUB.search(l)))
    return _ABS_OPEN.sub(r"本发明\1", s, count=1)


# 存疑/撰写性措辞禁令——所有成稿 ask 分支必须携带（漏进分支即漏进正文，实案曾产出
# 「待补图面…建议核对」自圆其说段）
_META_WORD_BAN = ("正文只写技术内容——不得出现交底书、建议核对、请核对、暂按、疑似、待补、"
                  "待补充、拟定等撰写性/存疑措辞；对图面或材料的存疑不要在正文表达。"
                  "不得出现论文式评论/类比句（如「可视为…的推广」「换句话说」「值得注意的是」"
                  "「本质上」「容易看出」）——每句须是技术事实或技术效果陈述。"
                  "不得出现宣传性/基准超群式用语（最佳、最先进、领先、首创、独创、"
                  "刷新纪录、SOTA、第一名等——实验数据只陈数值不评优劣）。")


# 附图图源规约——主产弹与缺号补弹共用同一份（口径漂移=两张图两种画法，实案锤过）
_FIGSRC_ASK = (
    "为以下附图清单各产出一份 mermaid 图源草稿，输出 {figsrc: [{num, name, mmd}]}。"
    "name 为 <英文slug>（如 pipeline-arch，不带 .mmd 后缀）。"
    "mmd 为 mermaid flowchart，CNIPA 授权专利附图工程画法，硬性约束："
    "①节点文本只写中文元件/步骤名称+附图标记（与大纲 marks 表一致的阿拉伯数字，"
    "如「加噪单元 102」）——禁止把数学符号/公式写进节点文本（不得出现 x_0、ε_θ、"
    "p_θ、N(0,I)、‖·‖、β_t 之类记号，公式属于说明书正文不属于图）；"
    "②方法/流程类附图用 flowchart TD 自上而下步骤链：步骤节点=方框+步骤名+标记，"
    "步骤名为 ≤15 字动宾短语（如「随机遮盖部分输入 token 105」），不得照搬整句——"
    "比例/条件等限定写进说明书正文或附图说明，不进节点文本；"
    "有判据处用菱形判据节点（如{t 是否大于 1？}）并以「是/否」分支回环或收束；"
    "③架构/系统类附图用扁平方框模块+连线（flowchart LR 或 TD），"
    "模块间连线标简短中文流向词（如「加噪」「去噪」「输出」）而非公式；"
    "④subgraph 仅用于真实模块分组与图例（见⑦），方法图不用；"
    "⑤不用颜色/图片/emoji/圆角样式，节点一律方框（判定用菱形，算子用圆形——见⑦）；"
    "⑥边可用带文字箭头；参数/均值/权重/坐标等辅助数据传递线用 `-.标注.->` 虚线边"
    "（渲染为虚线，与主数据流实线区分，授权件惯例）；"
    "⑦特征融合/相加/相乘/拼接等汇合或逐点运算点用圆形算子节点（((⊕))、((⊗))），"
    "需带附图标记时写作 ((⊕ 109))——首个字符入圈、余文置圈右；"
    "用了算子符号时图内补 subgraph LEG[图例] 说明，"
    "图例行写作 ((⊕ 特征相加))、((⊗ 特征相乘))；"
    "⑧架构图分解到元件级：每个层/单元/端口各自成节点并可带标号（授权件惯例单图 15-30 元件，"
    "如「第1个变量词元嵌入层 301」逐层画）；主干之外画出分流（A --> B & C）与汇流（B & C --> D）"
    "真实拓扑，不要把多步职能塞进一个大方框、更不许「输入→运算→输出」三步抽象；"
    "⑨结构/块图主干单列自上而下：主数据流成一条纵列，残差/旁路以弧线从旁路汇入圆形算子节点，"
    "不得左右双链分裂；结构图元件节点带附图标记（与说明书标号一致的三位/四位数字，"
    "如「注意力模块 301」）；"
    "⑩流程图步骤节点带步骤号（S101、S102…）；嵌入/编码/投影类节点在文本内注明维度映射"
    "（如「嵌入 T→D」「投影 D→S」）；节点文本不得出现 Ours、ours、本文方法 等学术自我指称词；"
    "⑪元件名偏长（≥8 字）或并列模块较多的结构图，节点用竖排窄条写法 N[/元件名称 标号/]——"
    "长名逐字纵排成窄条（授权件稠密网惯例），ASCII 标号横放一格，别横排硬折行；"
    "⑫分支与并行画法：判据分叉用菱形节点+「是/否」标边收束或回环；并行同层模块用"
    "分流（A --> B & C）扇出后各自成链再汇流；功能分区/泳道用 subgraph 簇框。"
    "图源会过确定性体检（未连通/断链/重号/缺标号），命中须重产。"
    "清单每张图都必须产出一条。\n")


_MMD_MATH_RESIDUE = (
    re.compile(r"[A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω0-9_]*\s*\([^)]*\)"),  # q(x|y)、N(0,I) 调用式
    re.compile(r"[A-Za-zα-ωΑ-Ω]+\s*(?:_\{[^}]*\}|_[A-Za-z0-9θβαελμσ∑]+)"),  # ε_θ、x_{t-1}
    re.compile(r"\\[A-Za-z]+"),          # \mathcal 等 LaTeX 命令
    re.compile(r"[‖∥·~∼→←]"),           # 范数/分布/映射记号
    re.compile(r"=[^\s]*"),              # 公式片段
    re.compile(r"[{}]"),                # LaTeX 花括号
    re.compile(r"\(\s*[,:：|]*\s*\)"),   # 剥净变量后的空括号残渣 (|) (,)
    re.compile(r"[\(\)]"),              # 悬挂 ASCII 括号
    re.compile(r"(?<=\s)[A-Za-z](?=\s)|^[A-Za-z]\s|\s[A-Za-z]$"),  # 孤立单字母变量（护住 U-Net）
    re.compile(r"[α-ωΑ-Ω₀-₉⁰-⁹±×÷¹²³−]+"),  # 希腊字母/上下标数字/散算符残渣
)


def _sanitize_mmd_label(label: str) -> str:
    """mmd 节点/边标签内剥除数学记号（公式属正文不属图）。
    `N×N`/`N÷N` 维度记号是工程规格（1×1卷积）不是残渣——先钉哨兵再剥。"""
    t = re.sub(r"(?<=\d)[×÷]|[×÷](?=\d)",
               lambda m: "\x00" if m.group(0) == "×" else "\x01", label)
    for rx in _MMD_MATH_RESIDUE:
        t = rx.sub("", t)
    t = t.replace("\x00", "×").replace("\x01", "÷")
    t = re.sub(r"<br\s*/?>\s*$", "", t)   # 尾部空行
    t = re.sub(r"(?i)\s*[\(（]?\bours?\b[\)）]?", "", t)  # 学术自我指称词禁入图（itransformer 图5「(Ours)」实案）
    t = re.sub(r"\s+", " ", t).strip(" ,;，；|").strip()
    return t


def _sanitize_mmd(mmd: str) -> str:
    """整段 mmd 图源消毒：标签内数学残渣就地剥除（模型不守约束时的确定性兜底）。
    剥空的节点回退为节点 id，剥空的边标签整段移除（变无标签箭头）。"""
    def _node(m):
        label = _sanitize_mmd_label(m.group(3)) or m.group(1)
        return m.group(1) + m.group(2) + '"' + label + '"' + m.group(4)
    out = re.sub(r'([A-Za-z0-9_]+)([\[\{\(])"([^"]*)"([\]\}\)])', _node, mmd)  # 引号节点
    out = re.sub(r'([A-Za-z0-9_]+)\[([^\[\]\"|<>]+)\]',
                 lambda m: m.group(1) + '[' + (_sanitize_mmd_label(m.group(2)) or m.group(1)) + ']',
                 out)                                                            # 裸括号节点
    out = re.sub(r'\|"([^"]*)"\|',
                 lambda m: '|"' + _sanitize_mmd_label(m.group(1)) + '"|'
                 if _sanitize_mmd_label(m.group(1)) else '', out)              # 边文本（剥空整段移除）
    out = re.sub(r'\|([^|"<>\[\]{}]+)\|',
                 lambda m: '|' + _sanitize_mmd_label(m.group(1)) + '|'
                 if _sanitize_mmd_label(m.group(1)) else '', out)              # 非引号边文本
    return out


def _limit_abstract(t: str, limit: int = 290) -> str:
    """CNIPA 摘要 ≤300 字：模型超限不再让整案降级，在最近的标点边界截断兜底。"""
    return limit_abstract(t, limit)


def _abstract_floor_pad(a4: str, seg: str) -> str:
    """摘要长度下限确定性兜底——重写燃尽仍 <240（bert-14 实案 162 字）时，
    从发明内容摘句并入方案段（与效果句/方案句摘句同源——纯搬位不编造）；
    摘句插入效果句原位之前，按 290 限幅预算拼接防二次截断。"""
    if len(a4) >= 240:
        return a4
    pad = ""
    for s in re.split(r"(?<=[。；])", seg):
        s = s.strip()
        if s and len(s) > 20 and s not in a4 and not _EFFECT_VERB.search(s):
            pad += s
            if len(a4) + len(pad) >= 240:
                break
    if not pad:
        return a4
    sents = [s for s in re.split(r"(?<=[。；])", a4) if s.strip()]
    eff_i = next((i for i in range(len(sents) - 1, -1, -1)
                  if _EFFECT_MARK.search(sents[i]) or _EFFECT_VERB.search(sents[i])),
                 len(sents))
    body, eff = "".join(sents[:eff_i]), "".join(sents[eff_i:])
    return _limit_abstract(body, 290 - len(eff) - len(pad)) + pad + eff


def _plan_figures(outline) -> list[dict]:
    """大纲 figures 字段归一化为 [{num:int, title:str}]——模型给的可能是 dict/数字/字符串。"""
    out = []
    for f in (outline or {}).get("figures") or []:
        if isinstance(f, dict) and f.get("num") is not None:
            try:
                out.append({"num": int(f["num"]), "title": str(f.get("title") or "")})
            except (TypeError, ValueError):
                continue
    # 确定性排秩：按图号升序、重号去重——模型偶发乱序/重号（ddpm-5 实案起编图2）
    seen = set()
    deduped = []
    for f in sorted(out, key=lambda x: x["num"]):
        if f["num"] not in seen:
            seen.add(f["num"])
            deduped.append(f)
    return deduped


def _claim_stub(c) -> bool:
    txt = "".join(s.get("text", "") for s in c.get("segments") or [])
    return bool(txt) and len(txt) <= 300 and bool(_STUB.search(txt))


def _desc_stub(b) -> bool:
    t = b.get("text") or ""
    return bool(t) and len(t) <= 150 and bool(_STUB.search(t))


def _section_paras(d, name: str) -> list:
    inside = False
    out = []
    for b in d.ast["description"]:
        if b["kind"] == "section":
            if inside:
                break
            inside = b.get("title") == name
            continue
        if inside:
            out.append(b)
    return out


def build_blocks(d, claims: list[str], description: dict, abstract: str) -> list[PatchBlock]:
    """生成三书的 PatchBlock 序列。现案中的占位块（XXX/……/步骤一）走 replace_block_id 原位替换——
    应用后被占位脚手架不会混在真稿里；非占位既有内容只在其后追加。"""
    blocks: list[PatchBlock] = []
    existing = d.ast["claims"]
    stub_ids = [c["id"] for c in existing if _claim_stub(c)]
    if stub_ids and len(stub_ids) == len(existing):
        n_rep = min(len(stub_ids), len(claims))
        for i, c in enumerate(claims):
            lines = pipeline.claim_lines(c)
            if not lines:
                continue
            lines[0] = f"{i + 1}.{lines[0]}"
            if i < n_rep:
                rid = stub_ids[i]
                blocks.append(PatchBlock(after_block_id=rid, replace_block_id=rid,
                                         markdown="\n".join(lines)))
            else:
                blocks.append(PatchBlock(after_block_id=stub_ids[-1], markdown="\n".join(lines)))
    else:
        # 已成稿案重跑：旧权项按序原位替换而非续号追加——追加则新旧两套并存
        # （ddpm-13 实案 1-7 旧稿 + 8-18 新稿 = 18 项重复）。替换走提案确认，旧稿仍可被审回
        last_claim = common.last_block(d, "claims")
        n_rep = min(len(existing), len(claims))
        for i, c in enumerate(claims):
            lines = pipeline.claim_lines(c)
            if not lines:
                continue
            lines[0] = f"{i + 1}.{lines[0]}"
            if i < n_rep:
                rid = existing[i]["id"]
                blocks.append(PatchBlock(after_block_id=rid, replace_block_id=rid,
                                         markdown="\n".join(lines)))
            else:
                after = last_claim["id"] if last_claim else "claims"
                blocks.append(PatchBlock(after_block_id=after, markdown="\n".join(lines)))
    for name in DESC_SECTIONS:
        body = description.get(name)
        if not body:
            continue
        text = body if isinstance(body, str) else "\n\n".join(map(str, body))
        if name == "附图说明":
            text = _dedupe_captions(text)
        paras = list(pipeline.blocks(text, drop=(name,)))
        sec_paras = _section_paras(d, name)
        rep_new, cap_new = paras, []
        if name == "附图说明":
            # 题注段走图号原位替换、非题注段走位置替换——拆段后分道，
            # 题注段不占非题注位置名额（否则标号说明段会被图1题注吃掉）
            paras = _explode_caption_paras(paras)
            rep_new = [p for p in paras
                       if not _CAPTION_LINE.match(p.split("\n", 1)[0])]
            cap_new = [p for p in paras
                       if _CAPTION_LINE.match(p.split("\n", 1)[0])]
        # 占位与已成稿正文段都按文档序原位替换（题注行走专属图号对位）——
        # 只对占位段替换会让重跑的新稿追加在旧稿之后混排（ddpm-13 实案）
        rep_seq = [b for b in sec_paras
                   if _desc_stub(b) or not _CAPTION_LINE.match(b.get("text") or "")]
        n_rep = min(len(rep_seq), len(rep_new))
        for b, para in zip(rep_seq[:n_rep], rep_new[:n_rep]):
            blocks.append(PatchBlock(after_block_id=b["id"], replace_block_id=b["id"],
                                     markdown=para))
        rest = rep_new[n_rep:]
        anchor = rep_seq[n_rep - 1]["id"] if n_rep else (
            _section_tail(d, name) or (common.last_block(d, "description") or {}).get("id")
            or "description")
        if name == "附图说明":
            # 既有「图N为…」题注行（含新案占位题注）按图号原位替换——
            # 不替换则新旧题注并存成双题注，比生成端 dedupe 更靠根
            cap_targets = [b for b in sec_paras
                           if not _desc_stub(b) and _CAPTION_LINE.match(b.get("text") or "")]
            taken: set[int] = set()
            for b in cap_targets:
                n = _CAPTION_LINE.match(b["text"]).group(1)
                for j, para in enumerate(cap_new):
                    if j in taken:
                        continue
                    m = _CAPTION_LINE.match(para.split("\n", 1)[0])
                    if m and m.group(1) == n:
                        blocks.append(PatchBlock(after_block_id=b["id"], replace_block_id=b["id"],
                                                 markdown=para))
                        taken.add(j)
                        anchor = b["id"]  # 未配对新题注顺接最后替换的题注块，不沉到节尾
                        break
            rest = [p for j, p in enumerate(cap_new) if j not in taken] + rest
        for para in rest:
            blocks.append(PatchBlock(after_block_id=anchor, markdown=para))
    abs_paras = d.ast["abstract"]["paragraphs"]
    abs_text = _limit_abstract(_wrap_bare_latex(_clean_abstract(abstract)))
    if abs_text:
        if abs_paras:
            # 已成稿案重跑也原位替换首段摘要——不替则旧稿留存，新稿无处可去
            rid = abs_paras[0]["id"]
            blocks.append(PatchBlock(after_block_id=rid, replace_block_id=rid, markdown=abs_text))
        else:
            blocks.append(PatchBlock(after_block_id="abstract", markdown=abs_text))
    return blocks


async def _new_case(ctx: RunContext, filename: str, extracted: extract.Extracted, q) -> None:
    pid = new_pid(ctx.store, filename)
    title = os.path.splitext(os.path.basename(filename))[0] or pid
    p = ctx.tool("create_case", ctx.store.create, pid=pid, title=title)
    cases.claim_owner(p.dir, ctx.user)
    ctx.calls += 1  # convert 管线内部 1 次 heavy gen（+ 至多 1 次修正）
    result = await pipeline.run(store=ctx.store, ai=ctx.ai, pid=pid, is_new=True, filename=filename,
                                extracted=extracted, questionnaire=q, progress=lambda _p, _m: None, job_id=ctx.job_id)
    ctx.finish(new_pid=pid, convert=result)


async def run(ctx: RunContext) -> None:
    ctx.start(PLAN)
    filename, text, extracted = ctx.tool("read_source", read_source, store=ctx.store, pid=ctx.pid, params=ctx.params)
    q = questionnaire.parse(json.dumps(ctx.params.get("questionnaire") or {}, ensure_ascii=False))
    if ctx.params.get("target") == "new":
        await _new_case(ctx, filename, extracted, q)
        return

    d = common.derive(ctx)
    # 1 heavy + 11 medium 成稿槽（说明书 5 组+实施方式两弹+缺项补弹+图源≤2+摘要≤4），留 format_retry 余量
    # 独权类型附图覆盖补齐后图源清单多 2 张，预算同步放宽两槽
    ctx.max_calls = 19
    src = ctx.clip(text, "s1")
    qtext = questionnaire.render(q)
    figs = d.ast.get("figures") or []
    if figs:
        fig_line = ("案卷现有附图：" + "、".join(f"图{f['num']}（{f['file']}）" for f in figs)
                    + "；大纲拟声明的新增附图图号正文亦可引用（配图后续补绘），"
                    "其余图号不可引用。")
    else:
        fig_line = ("案卷现有附图：无；说明书正文不要引用图号。"
                    "附图说明一节按发明要点声明 3-6 张拟补充附图（方法流程图、系统/模型架构图、"
                    "模块框图、效果对比图等），每图一行，且只写「图N为……」的正式图注措辞——"
                    "不得写撰写说明、建议或存疑性文字（如「建议核对」「暂按」「疑似」）。")
    base = f"交底书原文（{filename}）：\n{src}" + (f"\n\n发明要点（发明人问卷）：\n{qtext}" if qtext else "") \
        + "\n\n" + fig_line
    outline, _ = await common.gen_json(ctx, "outline", prompts_agent.build(
        "s1", "outline", "请先给出三书大纲 JSON。同时给出 marks 字段：为拟在说明书中出现的"
        "6-12 个关键模块/部件/单元/步骤分配附图标记（阿拉伯数字，百位起编 101、102……），"
        "形如 {\"101\": \"编码器\", \"102\": \"分词模块\"}；说明书各节使用标记须与本表一致。"
        "同时给出 figures 字段：拟声明的 3-6 张附图清单，"
        "形如 [{\"num\": 1, \"title\": \"方法总体流程图\"}, {\"num\": 2, \"title\": \"系统架构图\"}]——"
        "方法流程图、系统/模型架构图、模块框图按发明点实际需要组合；"
        "编号自 1 连续不跳号，且发明属方法类时图 1 固定为方法总体流程图"
        "（语料授权件 74% 惯例，摘要附图随之取图 1）；"
        "附图类型须覆盖独权类型——装置/系统独权配「装置结构框图」（模块与数据流）、"
        "电子设备独权配「计算机设备内部结构图」（处理器/存储器/总线）",
        context=base, pid=ctx.pid))
    outline_text = json.dumps(outline or {}, ensure_ascii=False)
    ctx_text = base + "\n\n大纲：\n" + outline_text
    # 同领域语义检索——案级 TF-IDF 向量按交底书+大纲找最相似真案，抽其句式回喂
    _dom_block = text_forms.domain_exemplar_block((filename + "\n" + src + "\n" + outline_text)[:4000])
    plan_figs = _plan_figures(outline)
    # 独权类型附图覆盖——授权件惯例装置/设备独权各配专图（CN111242948B 图9 装置框图、
    # 图11 计算机设备内部结构图）；四型束必含该二型，大纲已声明图时确定性补齐
    if plan_figs:
        _fig_titles = "；".join(str(f.get("title") or "") for f in plan_figs)
        _fig_next = max((int(f["num"]) for f in plan_figs if str(f.get("num") or "").isdigit()),
                        default=0) + 1
        if not re.search(r"框图|结构图", _fig_titles):
            plan_figs.append({"num": _fig_next, "title": "装置结构框图"})
            _fig_next += 1
        if not re.search(r"设备|硬件", _fig_titles):
            plan_figs.append({"num": _fig_next, "title": "计算机设备内部结构图"})

    claims_data, _ = await common.gen_json(ctx, "claims", prompts_agent.build(
        "s1", "claims", "请按大纲写出权利要求，输出 {claims: [每项一个字符串，不编号]}。"
        "独立权项按类型成组齐全——方法独权 1 项起首；其后装置/系统独权 1 项"
        "（以「…模块/单元，被配置为/用于执行权利要求1至N任一项所述方法的各步骤」表述）、"
        "电子设备独权 1 项（「处理器与存储器，存储器存储的计算机程序被处理器执行时实现"
        "权利要求1至N任一项所述方法」）、计算机可读存储介质独权 1 项"
        "（「存储有计算机程序，被处理器执行时实现权利要求1至N任一项所述方法」）。"
        "从权 6-10 项，每项须新增具体限定（数值范围/结构细节/判定条件）；"
        "每个独权的从权簇内至少 1 项从权引用在先从权形成特征梯度递进"
        "（如从权3引从权2进一步限定其结构细节），不得全部从权均平铺引同一独权；"
        "多项引多项的权项不得再被多项引多项的权项引用；权项总数 10-14。"
        "功能载体独权至多 1 项——装置/系统/模型同类载体不得并立（核心产物为模型时"
        "可以「一种…模型」独权替代装置独权，二者只取其一）；"
        "从属引用一律写「根据权利要求N所述」带显式权号，不得用「根据前项/上项/上述」"
        "等非标准引用形式；同一元件/方法名词同权项内重复提及时用「所述X」回指，不复述全称；"
        "独权/从权中的网络、模块、单元等元件名称沿用大纲 marks 表的正式命名"
        "（表中有则照写其名称），不得在权项中另起别名——三书术语经 marks 表对齐统一。"
        "权项中的数学公式须独占一行，并按出现顺序编号（式(1)、式(2)……）。"
        "每项独立权项须自含全部必要技术特征——使用「经训练的/预先获得的/预设的 X」"
        "时，其获得或训练方式须在本权项内限定（或改写为从属权项引用在前方法权项），"
        "不得假定读者参看其他权项。"
        "独权以结构连接关系或可执行步骤限定发明点——不得以期望实现的数学关系或功能"
        "本身限定（数学关系与公式归说明书表述，权项写清结构/步骤/数据流）；"
        "限定手段须覆盖其适用情形（如写「维度不一致时执行 X」的，X 须能处理该情形下的"
        "全部形态——空间尺寸不一致与通道数不一致分别限定，「不一致」须写明指哪种不一致）；"
        "每项从权须新增一层技术特征，不得对在先限定作解释性重复；"
        "出现「预设/预定」的参数须给出具体取值、取值依据或参数化关系；"
        "数值界限须有技术出处（与结构堆叠数、参数维度等挂钩，不写任意数字）；"
        "数学符号全文统一（同一参数在权项与说明书保持同一写法）；"
        "同一数学记号不得兼任映射/函数名与张量输出名——映射与输出须分号命名"
        "（如映射 F(x,{Wi}) 与其输出残差映射 H 用不同记号）；"
        "不得写「配合/结合……调整」式无具体内容的含糊限定——训练超参若限定须写"
        "具体值或参数化策略（如学习率数值与衰减规则）；"
        "技术手段存在多种常见实现时须指明采用哪一种——「步长降采样」须写明"
        "由步长为 2 的卷积实现还是池化实现，「归一化」须写明 LayerNorm/BatchNorm；"
        "部件结构名一律用中文（基本块、步长、特征图），通用方法名词保留英文"
        "（ReLU、softmax、U-Net）；"
        "独权限定的运算/处理若以特定条件为前提（如按元素相加要求两路维度一致），"
        "须以保障手段概括限定（如「与残差特征图维度匹配的特征」），不得覆盖无法实施的情形；"
        "从权内并选/备选限定须与主句执行主体一致——替代手段不属该主体职责时分权另起"
        "（如零填充恒等映射与线性投影单元分属两案，不得在同一权项混列）；"
        "方法权项的附加限定须作用于方法本身——仅约束训练过程的特征不得写入"
        "推理/识别方法权项（训练特征写训练方法独权或归说明书）；"
        "装置独权不得半结构半功能混写——要么逐模块结构限定，要么纯功能引用"
        "（被配置为执行权N所述方法各步骤），不得同一权项内结构概括与功能引用叠加；"
        "纯功能引用写法的装置/系统独权须在模块表述中含模块间数据流关系"
        "（「X 模块的输出输入 Y 模块」式衔接），不得整权仅是步骤名罗列；"
        "不得使用不产生结构/步骤区分的限定词（「仅」「只有」修饰本属必然的操作）；"
        "以公式限定数量/尺寸关系时须覆盖说明书公开的边界情形（如整除不成立时的"
        "补齐或裁剪口径），不得让公式在公开边界情形不成立；"
        "否定式限定（「不包括/不含 X」）仅用于与现有技术划界——说明书不得把被排除的"
        "方案表述为本发明实施方式，确需写入须明确标注「对照方案/参考实施方式」；"
        "以层数/规模限定网络时须定义计数口径（是否计归一化/池化/分类层）并以结构特征"
        "限定替代（各阶段块数与通道数），不得只写层数而无拓扑依据；"
        "装置/系统独权的模块构成须覆盖所引方法权项的全部步骤——不得以单一模块概括"
        "执行全部方法步骤。"
        + "\n" + text_forms.claims_skeleton_block()
        + "\n" + (text_forms.claim_tree_block((filename + "\n" + src + "\n" + outline_text)[:4000]) or "")
        + "\n" + text_forms.claims_block()
        + (_dom_block and "\n" + _dom_block or ""),
        context=ctx_text, pid=ctx.pid))
    # 多项引多项确定性核对——ask 禁令模型照犯（ddpm-4 权9被权12/13/15 再引、bert-7 同型），
    # 命中即点名重弹一次；残余由 preflight claims.multi_multi 警告兜住
    _claims_list = [str(c) for c in (claims_data or {}).get("claims") or []]
    _mm_viol = _multi_multi_violations(_claims_list)
    if _mm_viol:
        _mm_detail = "；".join(f"权{n}引用了多项从属权{'、'.join(map(str, bad))}"
                              for n, bad in _mm_viol)
        ctx.check(CheckResult(name="claims.multi_multi", ok=False, why=_mm_detail))
        _mm_fix, _ = await common.gen_json(ctx, "claims-mmfix", prompts_agent.build(
            "s1", "claims-mmfix",
            "以下权项构成多项引多项违规（" + _mm_detail + "）：多项从属权利要求（引用两项以上权项的）"
            "不得被另一项多项从属权利要求引用。重写违规权项使其不再引用多项从属权项——"
            "可改为择一引用某个非多项从属的在前权项、或将其改写为自带全部特征的独立权项；"
            "引用与被引用双方在授权范围上等效即可，不得改限定实质。其余权项保持不变。"
            "输出 {fixes: {权项序号字符串: 该权项新文本}}。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        for _k, _v in ((_mm_fix or {}).get("fixes") or {}).items():
            try:
                _claims_list[int(_k) - 1] = str(_v)
            except (ValueError, IndexError):
                continue
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    _mm_resid = _multi_multi_violations(_claims_list)
    ctx.check(CheckResult(name="claims.multi_multi", ok=not _mm_resid,
                          why="；".join(f"权{n}引用了多项从属权{'、'.join(map(str, bad))}"
                                       for n, bad in _mm_resid)))
    # 权项计数上限 10-14 确定性核对——vit-9 实案模型写满 17 项 ask 界照样破；
    # 超限即点名重弹整体收敛重写（引用号随删并重排由模型自洽处理）
    if not 10 <= len(_claims_list) <= 14:
        ctx.check(CheckResult(name="claims.count", ok=False, why=f"{len(_claims_list)} 项超出 10-14 范围"))
        _dir = ("整体重写收敛到 10-14 项内——次要从权合并或删去" if len(_claims_list) > 14
                else "整体重写补足到 10-14 项内——为独权补充从权（新限定须具体且自洽）")
        _cnt_fix, _ = await common.gen_json(ctx, "claims-countfix", prompts_agent.build(
            "s1", "claims-countfix",
            f"以下权利要求共 {len(_claims_list)} 项，超出 10-14 项范围。" + _dir +
            "；独权四型束（方法/装置或系统/电子设备/存储介质）与每条实质限定全部保留，"
            "全部引用号随删并重排自洽，引用形式须为「根据权利要求N所述」。"
            "输出 {claims: [每项一个字符串，不编号]}。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        _nc = [str(c) for c in (_cnt_fix or {}).get("claims") or []]
        if 10 <= len(_nc) <= 14:
            _claims_list = _nc
            claims_data = {**(claims_data or {}), "claims": _claims_list}
    ctx.check(CheckResult(name="claims.count", ok=10 <= len(_claims_list) <= 14,
                          why="" if 10 <= len(_claims_list) <= 14 else f"重弹后仍 {len(_claims_list)} 项"))
    # 「根据前项/上项所述」非标准引用形式确定性改写为显式权号（vit-9 实案权16/17 同型）——
    # 前项即上一项，改写零歧义；其余含糊形式留 ask 禁
    _ns_nums = []
    for _i, _c in enumerate(_claims_list):
        _n = _i + 1
        _fixed = re.sub(r"根据(前项|上项|前一权)所述",
                        f"根据权利要求{_n - 1}所述", _c) if _n > 1 else _c
        if _fixed != _c:
            _claims_list[_i] = _fixed
            _ns_nums.append(_n)
    if _ns_nums:
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    ctx.check(CheckResult(name="claims.ref_form", ok=True,
                          why=f"权{'、权'.join(map(str, _ns_nums))}前项引用已归位显式权号" if _ns_nums else ""))
    # 从权梯度同款核对——ask 要求递进布局模型仍平铺（ddpm-10 权1/权5 各 3-4 项全平引），
    # 命中即点名重弹一次把簇内至少一项改为引用在先从权递进限定
    _fg_viol = _flat_gradient_violations(_claims_list)
    if _fg_viol:
        _fg_detail = "；".join(f"权{n}的{k}项从属全部平铺引用权{n}、无一递进" for n, k in _fg_viol)
        ctx.check(CheckResult(name="claims.gradient", ok=False, why=_fg_detail))
        _fg_fix, _ = await common.gen_json(ctx, "claims-gradient-fix", prompts_agent.build(
            "s1", "claims-gradient-fix",
            "以下从权簇无特征梯度（" + _fg_detail + "）：授权权项簇常见递进式布局——"
            "把各簇内至少一项从属权项改为引用在先从属权项作递进限定"
            "（如「根据权利要求X所述…进一步限定…」），递进的被引项须承载可再细化的限定；"
            "不得引入多项引多项（多项从属不得再引多项从属）。其余权项保持不变。"
            "输出 {fixes: {权项序号字符串: 该权项新文本}}。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        for _k, _v in ((_fg_fix or {}).get("fixes") or {}).items():
            try:
                _claims_list[int(_k) - 1] = str(_v)
            except (ValueError, IndexError):
                continue
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    _fg_resid = _flat_gradient_violations(_claims_list)
    ctx.check(CheckResult(name="claims.gradient", ok=not _fg_resid,
                          why="；".join(f"权{n}的{k}项从属全部平铺引用权{n}、无一递进" for n, k in _fg_resid)))
    # 四型束覆盖核对——独权须按 方法/装置或系统/电子设备/存储介质 成组齐全（r14 起 ask
    # 已要求，模型仍可能漏型），缺型即点名补弹追加独权；resnet-8 实测四型齐备 0 命中
    _tb_missing = _type_bundle_missing(_claims_list)
    if _tb_missing:
        ctx.check(CheckResult(name="claims.type_bundle", ok=False, why="缺：" + "、".join(_tb_missing)))
        _tb_fix, _ = await common.gen_json(ctx, "claims-typefix", prompts_agent.build(
            "s1", "claims-typefix",
            "以下权项的独立权项类型组不齐，缺：" + "、".join(_tb_missing) + "。"
            "为每个缺失类型各写 1 项独立权项+至多 2 项从属于它的从权"
            "（独权以「一种…」起句、含「其特征在于」；装置/系统类独权须含与方法独权各步骤"
            "对应的组成单元、模块被配置为执行相应步骤；电子设备独权以「处理器与存储器，"
            "存储器存储的计算机程序被处理器执行时实现权利要求1至N任一项所述方法」表述；"
            "存储介质独权以「存储有计算机程序、被处理器执行时实现权利要求1至N任一项所述"
            "方法」表述；从权只引其所属新独权）。输出 {claims: [新增权项文本]}，不编号。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        for _t in ((_tb_fix or {}).get("claims") or []):
            _claims_list.append(f"{len(_claims_list) + 1}.{str(_t).strip()}")
        if _tb_fix and _tb_fix.get("claims"):
            claims_data = {**(claims_data or {}), "claims": _claims_list}
    _tb_resid = _type_bundle_missing(_claims_list)
    ctx.check(CheckResult(name="claims.type_bundle", ok=not _tb_resid,
                          why="缺：" + "、".join(_tb_resid) if _tb_resid else ""))
    # 功能载体独权并立核对——装置/系统/模型同族独权至多 1 项（vit-9 实案权6模型+权15装置
    # 并立且双双复制权1 步骤撑破上限）；命中即点名重弹：合并为 1 项载体独权，其原从权簇改挂
    _xc = _extra_carrier_indeps(_claims_list)
    if _xc:
        ctx.check(CheckResult(name="claims.carrier_bundle", ok=False,
                              why="载体独权并立：权" + "、权".join(map(str, _xc))))
        _xc_fix, _ = await common.gen_json(ctx, "claims-carrierfix", prompts_agent.build(
            "s1", "claims-carrierfix",
            f"以下权项中权{'、权'.join(map(str, _xc))}为功能载体独权（装置/系统/模型），"
            "与在先同族载体独权保护范围重叠——将其删除，并把仅引用它的从权改写为引用"
            "在前的首个同族载体独权（从权条数、实质限定不变，权号重新顺排）。"
            "输出 {claims: [全文权项，每项一个字符串，不编号]}，保持其余权项文本不变。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        _nc = [str(x).strip() for x in (_xc_fix or {}).get("claims") or [] if str(x).strip()]
        if _nc and len(_nc) >= len(_claims_list) - len(_xc) and not _extra_carrier_indeps(_nc):
            _claims_list = _nc
            claims_data = {**(claims_data or {}), "claims": _claims_list}
    _xc_resid = _extra_carrier_indeps(_claims_list)
    ctx.check(CheckResult(name="claims.carrier_bundle", ok=not _xc_resid,
                          why="载体独权并立：权" + "、权".join(map(str, _xc_resid)) if _xc_resid else ""))
    # 权项簇归位——ddpm-r84 实案 1-4 全独权、从权 5-14 后置，载体权引
    # 「权利要求1至2任一项所述方法」把系统独权拽进方法范围；确定性重排为
    # 「独权+从权簇」惯例序、改写引用号并把载体方法引用归一至方法族全块
    _claims_list = _normalize_claim_order(_claims_list)
    if _carrier_method_ref_violations(_claims_list):
        ctx.check(CheckResult(name="claims.carrier_ref", ok=False,
                              why="载体引用含非方法权项：权"
                                  + "、权".join(map(str, _carrier_method_ref_violations(_claims_list)))))
        _cm_fix, _ = await common.gen_json(ctx, "claims-carrierreffix", prompts_agent.build(
            "s1", "claims-carrierreffix",
            "以下载体权项引「所述方法」的范围含非方法权项（权"
            + "、权".join(map(str, _carrier_method_ref_violations(_claims_list)))
            + "）：把这些引用改写为只覆盖方法族权项（引用方法独权及其全部方法从权，"
            "表述为「权利要求X至Y任一项所述方法」，X..Y 须全为方法族权项）。"
            "输出 {fixes: {权项序号字符串: 该权项新文本}}，其余不变。",
            context="\n".join(map(str, _claims_list)), pid=ctx.pid))
        for _k, _v in ((_cm_fix or {}).get("fixes") or {}).items():
            try:
                _claims_list[int(_k) - 1] = re.sub(r"^\s*\d+\s*[.、．)]?\s*", "", str(_v), count=1)
            except (ValueError, IndexError):
                continue
        _claims_list = _normalize_claim_order(_claims_list)
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    else:
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    _cm_resid = _carrier_method_ref_violations(_claims_list)
    ctx.check(CheckResult(name="claims.carrier_ref", ok=not _cm_resid,
                          why="载体引用含非方法权项：权" + "、权".join(map(str, _cm_resid)) if _cm_resid else ""))
    # 「其特征在于」缺失确定性核对——家族末位闸（mamba 实案 933ea/7394a：初稿或后续
    # typefix/carrierfix/归位/carrierref 整体重写把两部分式再丢，闸须跑在全部重写之后）
    # 先确定性插入（引用语/特征动词分界），残余异形才点名重弹——
    # 长 JSON 输出易被输出上限截断，模型路只作兜底
    _nz = _no_characterizing(_claims_list)
    if _nz:
        for _i in _nz:
            _claims_list[_i - 1] = _insert_characterizing(_claims_list[_i - 1])
        _nz = _no_characterizing(_claims_list)
    if _nz:
        _nz_fix, _ = await common.gen_json(ctx, "claims-charfix", prompts_agent.build(
            "s1", "claims-charfix",
            "以下权项缺「其特征在于」（权" + "、权".join(map(str, _nz))
            + "）：细则第 24 条两部分式为授权惯例——独权在前序部分与特征部分之间插入"
            "「，其特征在于，」（特征部分为区别于现有技术的必要技术特征）；从权在引用语"
            "后加「，其特征在于，」再接进一步限定。只补短语、限定实质与其余权项保持不变。"
            "输出 {fixes: {权项序号字符串: 该权项新文本}}。",
            context="\n".join(f"{i + 1}.{c}" for i, c in enumerate(_claims_list)), pid=ctx.pid))
        for _k, _v in ((_nz_fix or {}).get("fixes") or {}).items():
            try:
                _claims_list[int(_k) - 1] = re.sub(r"^\s*\d+\s*[.、．)]?\s*", "", str(_v), count=1)
            except (ValueError, IndexError):
                continue
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    else:
        claims_data = {**(claims_data or {}), "claims": _claims_list}
    _nz_resid = _no_characterizing(_claims_list)
    ctx.check(CheckResult(name="claims.characterizing", ok=not _nz_resid,
                          why="缺「其特征在于」：权" + "、权".join(map(str, _nz_resid)) if _nz_resid else ""))
    # 式号跨书接续——实案出现权项自编 式(1)-(4)、说明书又自编 式(1)-(8) 同号不同所指；
    # 说明书公式自权项末号+1 续编，引用权项公式沿用原式号
    _claims_joined = "\n".join(map(str, (claims_data or {}).get("claims") or []))
    _eq_next = max([int(n) for n in re.findall(r"式[（(]\s*(\d+)", _claims_joined)] or [0]) + 1
    _eq_line = (f"说明书中的公式独占一行并接续权利要求编号，自式({_eq_next})起按出现顺序编号"
                "（引用权项中的公式沿用其原式号）。定义式、递推式、计算式等成段公式一律写"
                "`$$式体$$式(N)`独占行；句中引用写「如式(N)所示」，不得把$$公式嵌入句中作行内式。")
    desc_sections: dict = {}
    for names in _DESC_GROUPS:
        _sent_roles = _DESC_SENT_ROLES.get(names)
        _sent_block = (text_forms.section_sent_block(
            (filename + "\n" + outline_text + "\n" + "、".join(names))[:3000],
            _sent_roles, k=6, label="/".join(names)) if _sent_roles else "")
        ask = (f"请按大纲写说明书以下各节：{'、'.join(names)}，"
               "输出 {description: {节名: 多段纯文本，段落之间空一行}}。"
               + "\n" + text_forms.description_block()
               + (_sent_block and "\n" + _sent_block or "")
               + (_dom_block and "\n" + _dom_block or ""))
        if "背景技术" in names:
            ask += ("「技术领域」一两句即可；「背景技术」按应用场景→技术路线演进→现有方案的具体不足"
                    "逐条枚举（每条不足给出技术成因，不只写结论性描述）→本发明切入点逐段展开，"
                    "不少于 1200 字。")
        if names == ("发明内容",):
            claims_text = "\n".join(
                f"权项{i+1}：{c}" for i, c in enumerate(
                    (claims_data or {}).get("claims") or []))
            ask += ("按「要解决的技术问题→技术方案→有益效果」三段式展开；"
                    "技术方案部分逐项重述各项权项的技术要点——每项独权各自成段"
                    "（不得把整条权项连同公式塞入同一段），从权可合并表述为「进一步地…」，"
                    "装置/电子设备/存储介质独权各以「基于同一发明构思，本发明还提供…」起段重述；"
                    "不少于 2200 字。" + _eq_line + "权利要求正文供重述参考：\n" + claims_text)
        if names == ("具体实施方式",):
            cite = [f["num"] for f in plan_figs] or [f["num"] for f in figs]
            # 两弹生成——单次 JSON 调用输出上限结构性压制深度（实案 ~5400 触顶，
            # 语料中位 5769/p75 10661，cv 域 9666）；分「实施例一/二」与「实施例三+变体」两弹合并
            impl_parts = [
                ("本节按「实施例一/实施例二」展开：实施例一按独立方法权项的步骤顺序逐条展开"
                 "——每一步先复述该步技术特征（可以权项步骤名为小标题或「步骤 N」表述），"
                 "再以「具体为……」给出实现细节（含符号定义、参数取值依据与数据结构），"
                 "不得写成论文式连贯叙述段；"
                 "给足工程可实施细节——涉及网络/模块结构时给出整体架构构成（各阶段单元数、"
                 "维度演进、降采样/池化位置、输入预处理与输出结构，可用表格列层配置），"
                 "涉及变换顺序时写明先后约定（如归一化→激活→卷积的次序）；"
                 "关键模块须给出实现参数（注意力头数、缩放因子、层数、隐藏维、插值或采样"
                 "方式、核大小等），不得以模块符号或名称带过；"
                 "公式一律写 LaTeX 式 `$$式体$$式(N)` 独占段（式号续前编号），"
                 "不得写 `f(x)=…　式(N)` 式纯文本公式行；"
                 "实施例二给出与装置/系统类权项对应的组成实施方式；"
                 "本部分不少于 4200 字。"),
                ("本节续写并以「实施例三」为小节标题起段：先给出与电子设备、计算机可读"
                 "存储介质独权对应的实施方式（电子设备以「处理器执行存储器中程序实现上述"
                 "方法」表述，存储介质以「存储有计算机程序、被处理器执行时实现上述方法」"
                 "表述，各一段）；再以「变体与替代实施方式」为小节标题给出等效变体与参数"
                 "替代方案（逐项给出替代依据与效果差异）；再以「效果验证」为小节标题给出"
                 "技术效果实证段——交底材料含实验/性能数据（误差率、准确率、分数、对比数字）"
                 "时如实整理为验证表述（可用表格对比本方案与现有方案），数据只得取自材料、"
                 "不得编造；有益效果不得借用材料所载竞赛名次、获奖记录或他人论文的指标断言；"
                 "材料无数据时以定性方式给出预期技术效果；末段收束全文总结技术效果；"
                 "本部分不少于 2400 字。"
                 "实施段术语须与对应独权用语逐字一致（如独权写「存储器存储有计算机程序」，"
                 "实施段就逐字写「存储器存储有计算机程序」而非「存储有程序」），"
                 "权项特征在说明书中不得只有近义表述。正文同前约束："),
            ]
            _sent_impl = text_forms.section_sent_block(
                (filename + "\n" + outline_text + "\n具体实施方式")[:3000],
                ["F9实施例转接"], k=6, label="实施方式")
            mark_ask = (_sent_impl and _sent_impl + "\n" or "") + (
                "正文中的关键模块、部件、单元、步骤按大纲 marks 表标注附图"
                        "标记（如「编码器101」——元件名与编号直接相连不加空格），同一元件全文使用同一标记，"
                        "且元件名称须与 marks 表中该编号的名称逐字一致，不得简化、改写或另起别名。"
                        "同一技术动作/关系全文统一用词，不混用近义词（如「拟合」「逼近」择一使用）；"
                        "数学符号与权项保持同一写法。"
                        "行文按授权件惯例：细节限定以「其中，…」从句承接展开；可选手段与替代"
                        "方案用「可以」「还可以包括」「可选地」「在一些实施方式中」表述（不得全部写成"
                        "必然路径，变体支撑才有修改余地）；层级导引用「具体地」「进一步地」；"
                        "同一元件/方法名词再次提及时用「所述X」「该X」回指，不复述全称。"
                        + _META_WORD_BAN +
                        "拟声明附图尚未配图时直接引用图号展开实施方式即可，不要解释配图状态。"
                        + _eq_line + "正文以式(N)引用。"
                        + "表格（表N 题注 + | 分隔表体）须紧随其题注成块出现，"
                        + "表头与全部数据行同在一段连续表格块内，不得拆散成逐行散段、"
                        + "更不得挪到文末堆放。"
                        + ("结合附图展开各实施方式，正文至少引用一次每一图号"
                           f"（{('、'.join(f'图{n}' for n in cite))}，如图N所示）。" if cite else ""))
            for part_ask in impl_parts:
                sec, _ = await common.gen_json(ctx, "description", prompts_agent.build(
                    "s1", "description",
                    f"请按大纲写说明书以下各节：{'、'.join(names)}，"
                    "输出 {description: {节名: 多段纯文本，段落之间空一行}}。" + part_ask + mark_ask,
                    context=ctx_text, pid=ctx.pid))
                part = (sec or {}).get("description") or {}
                if isinstance(part, dict) and part.get("具体实施方式"):
                    prev = desc_sections.get("具体实施方式")
                    body = part["具体实施方式"]
                    body = body if isinstance(body, str) else "\n\n".join(map(str, body))
                    desc_sections["具体实施方式"] = (prev + "\n\n" + body) if prev else body
            # 结构性缺项补弹——实案出现第二弹不写「实施例三」标题、变体段整段缺席，
            # 合并后确定性核对，缺什么点名补什么
            impl = desc_sections.get("具体实施方式") or ""
            missing_bits = []
            if "实施例三" not in impl:
                missing_bits.append("「实施例三」小节（电子设备、计算机可读存储介质实施方式各一段）")
            if "变体" not in impl and "替代" not in impl:
                missing_bits.append("「变体与替代实施方式」小节（逐项替代依据与效果差异）")
            if "效果验证" not in impl:
                missing_bits.append("「效果验证」小节（材料含实验/性能数据时如实整理对比表述，"
                                    "无数据时定性预期效果，不得编造数值）")
            if missing_bits:
                sec, _ = await common.gen_json(ctx, "description", prompts_agent.build(
                    "s1", "description",
                    "请按大纲补写说明书具体实施方式缺失部分："
                    + "、".join(missing_bits) + "。"
                    "输出 {description: {具体实施方式: 多段纯文本}}，"
                    "只写缺失小节不要重复已有内容。" + mark_ask,
                    context=ctx_text, pid=ctx.pid))
                part = (sec or {}).get("description") or {}
                if isinstance(part, dict) and part.get("具体实施方式"):
                    body = part["具体实施方式"]
                    body = body if isinstance(body, str) else "\n\n".join(map(str, body))
                    desc_sections["具体实施方式"] = impl + "\n\n" + body
            continue
        if names == ("附图说明",):
            ask += ("本节每图一行，只写「图N为……」的正式图注措辞——"
                    "不得包含撰写说明、建议或存疑性文字，同一图号只声明一次不得重复。"
                    "末尾另起一段写「元件标号说明：」，按大纲 marks 表逐条列出"
                    "（形如「101为编码器；102为分词模块」），与具体实施方式所用标记一致。"
                    + ("按大纲附图清单逐图声明：" +
                       "、".join(f"图{f['num']} {f['title']}" for f in plan_figs) + "。"
                       if plan_figs else ""))
        else:
            ask += _META_WORD_BAN
        sec, _ = await common.gen_json(ctx, "description", prompts_agent.build(
            "s1", "description", ask, context=ctx_text, pid=ctx.pid))
        part = (sec or {}).get("description") or {}
        if isinstance(part, dict):
            desc_sections.update({k: v for k, v in part.items() if k in names})
    # 论文腔确定性核对——_META_WORD_BAN 已带禁令模型仍漏（ddpm-10 四处「可视为…的推广」），
    # 命中段点名重弹保技术内容、漏网句末位剥离兜底；残余由 preflight spec.paper_tone 兜住。
    # 同链并入撰写过程词（交底书/交底范围/待补……resnet-10 实案 6 处残留）——同族 ask 天花板
    def _pt_paras() -> list[tuple[str, int, str]]:
        out = []
        for _s, _b in desc_sections.items():
            _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
            for _i, _p in enumerate(_b.split("\n\n")):
                if (_PAPER_TONE.search(_p) or _PROMO_RE.search(_p)
                        or _META_WORDS.search(_p)):
                    out.append((_s, _i, _p))
        return out
    _pt = _pt_paras()
    if _pt:
        _pt_fix, _ = await common.gen_json(ctx, "spec-papertone-fix", prompts_agent.build(
            "s1", "spec-papertone-fix",
            "以下说明书段落含论文式评论/类比措辞（可视为/换句话说/值得注意的是/容易看出等）、"
            "宣传性用语（最佳/最先进/领先/竞赛名次等）或撰写过程词（交底书/交底范围/待补等），"
            "授权说明书只写技术事实与技术效果——逐段重写去掉评论、类比、宣传与过程措辞，"
            "原有技术限定、数值、步骤、标号全部保留不得删改。输出 {fixes: [{idx, text}]}。",
            context="\n\n".join(f"[{_i}]（{_s}节）{_p}" for _i, (_s, _pi, _p) in enumerate(_pt)),
            pid=ctx.pid))
        _fix_map = {int(f["idx"]): str(f["text"]) for f in (_pt_fix or {}).get("fixes") or []
                    if isinstance(f, dict) and "idx" in f and "text" in f}
        if _fix_map:
            _paras = {s: (b if isinstance(b, str) else "\n\n".join(map(str, b))).split("\n\n")
                      for s, b in desc_sections.items()}
            for _i, (_s, _pi, _p) in enumerate(_pt):
                if _i in _fix_map:
                    _paras[_s][_pi] = _fix_map[_i]
            for _s, _ps in _paras.items():
                desc_sections[_s] = "\n\n".join(_ps)
        # 残余兜底：补弹漏项或回写仍命中的段落剥除论文腔句（此类句整句为评论）
        for _s in list(desc_sections):
            _b = desc_sections[_s]
            _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
            _keep, _dirty = [], False
            for _p in _b.split("\n\n"):
                if (_PAPER_TONE.search(_p) or _PROMO_RE.search(_p)
                        or _META_WORDS.search(_p)):
                    _sents = [x for x in re.split(r"(?<=[。；])", _p)
                              if x.strip() and not _PAPER_TONE.search(x)
                              and not _PROMO_RE.search(x) and not _META_WORDS.search(x)]
                    _dirty = True
                    if _sents:
                        _keep.append("".join(_sents))
                else:
                    _keep.append(_p)
            if _dirty:
                desc_sections[_s] = "\n\n".join(_keep)
    # 自称归一「本发明」——摘要起句已钉本发明公开（轮75），说明书/权项再自称本申请
    # 则同文两制（语料首自称 本发明180 : 本申请63，且本发明处处合法）；bert-12 实案
    # [0001] 本申请涉及 vs 摘要本发明公开即此族
    for _s in list(desc_sections):
        _b = desc_sections[_s]
        _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
        if "本申请" in _b:
            desc_sections[_s] = _b.replace("本申请", "本发明")
    # 标号名确定性归一——同一标号在正文对应多个非后缀一致的基名即漂移
    # （resnet-4 实案「深度残差神经网络102」与「深度残差网络模块102」混用）。
    # 与 lint 同口径归一：先按图例（剥 ASCII 括注缩写）/大纲 marks 做碎片映射，
    # 只对残余真异名动刀；正名优先级 图例>marks>最长名——避免碎片名抢正名位。
    _mark_canon = {str(k): _abbr(str(v)) for k, v in ((outline or {}).get("marks") or {}).items()}
    _mtexts = [(_b if isinstance(_b, str) else "\n\n".join(map(str, _b)))
               for _b in desc_sections.values()]
    _mtexts += [str(c) for c in (claims_data or {}).get("claims") or []]
    _mlegend: dict[str, str] = {}
    _muse: dict[str, set] = {}
    for _t in _mtexts:
        for _m in _LEGEND_RE.finditer(_t):
            _mlegend.setdefault(_m.group(1), _abbr(_m.group(2)))
        for _m in _NUMERAL_RE.finditer(_t):
            _nm = _numeral_name(_m.group(1))
            if _nm:
                _muse.setdefault(_m.group(2), set()).add(_nm)
    _mdrift: dict[tuple[str, str], str] = {}
    for _num, _names in _muse.items():
        _canon = _mlegend.get(_num) or _mark_canon.get(_num) or ""
        _mapped = set()
        for _n in _names:
            _m2 = None
            if _canon and (_n in _canon or _canon in _n):
                _m2 = _canon
            elif _canon:
                for _k in range(len(_n) - 2):
                    if len(_n[_k:]) >= 3 and _n[_k:] in _canon:
                        _m2 = _canon
                        break
            _mapped.add(_m2 or _n)
        if not _canon:
            continue  # 无图例/marks 锚——碎片名抢位风险大于收益，留给 lint 报
        for _n in _mapped:
            if _n != _canon and not _canon.endswith(_n):
                _mdrift[(_num, _n)] = _canon
    # 反向漂移——同一名称绑到多个标号（disclosure 实案「分类头109」与
    # 「分类头110」并存）。锚定图例/marks 绑定的正号，游离号回正。
    _nuse: dict[str, dict[str, int]] = {}
    for _t in _mtexts:
        for _m in _NUMERAL_RE.finditer(_t):
            _nm = _numeral_name(_m.group(1))
            if _nm:
                _nuse.setdefault(_nm, {})
                _nuse[_nm][_m.group(2)] = _nuse[_nm].get(_m.group(2), 0) + 1
    _ndrift: dict[tuple[str, str], str] = {}
    for _nm, _nums in _nuse.items():
        if len(_nums) < 2:
            continue
        _bound = next((n for n, v in _mlegend.items() if _abbr(v) == _nm), None) or \
            next((n for n, v in _mark_canon.items()
                  if v == _nm or v.endswith(_nm) or _nm.endswith(v)), None)
        if _bound and _bound in _nums:
            for _n in _nums:
                if _n != _bound:
                    _ndrift[(_nm, _n)] = _bound

    def _fix_mark_nums(text: str) -> str:
        if not text or not _ndrift:
            return text
        repls = []
        for _m in _NUMERAL_RE.finditer(text):
            _nm = _numeral_name(_m.group(1))
            _bound = _nm and _ndrift.get((_nm, _m.group(2)))
            if _bound:
                repls.append((_m.start(2), _m.end(2), _bound))
        for _a, _b_, _c in reversed(repls):
            text = text[:_a] + _c + text[_b_:]
        # 图例行「110为分类头」同步归正
        for (_nm, _n), _bound in _ndrift.items():
            text = re.sub(rf"(?<!\d){re.escape(_n)}为{re.escape(_nm)}(?=[；;，,。]|$)",
                          f"{_bound}为{_nm}", text)
        return text

    def _fix_mark_names(text: str) -> str:
        if not text or not _mdrift:
            return text
        repls = []
        for _m in _NUMERAL_RE.finditer(text):
            _nm = _numeral_name(_m.group(1))
            _canon = _nm and _mdrift.get((_m.group(2), _nm))
            if _canon and _m.group(1).endswith(_nm):
                repls.append((_m.start(1) + len(_m.group(1)) - len(_nm), _m.end(1), _canon))
        for _a, _b_, _c in reversed(repls):
            text = text[:_a] + _c + text[_b_:]
        # 图例行「102为<旧名>」同步（_LEGEND_RE 只认 为）
        for (_num, _n), _canon in _mdrift.items():
            text = re.sub(rf"(?<!\d){_num}为{re.escape(_n)}(?=[；;，,。]|$)", f"{_num}为{_canon}", text)
        return text
    for _s in list(desc_sections):
        _b = desc_sections[_s]
        _b = _fix_mark_names(_b if isinstance(_b, str) else "\n\n".join(map(str, _b)))
        desc_sections[_s] = _fix_mark_nums(_b)
    if _ndrift:
        _cl = (claims_data or {}).get("claims") or []
        if _cl:
            claims_data["claims"] = [_fix_mark_nums(str(c)) for c in _cl]
    # 跨书编号归一——式(N)/表N 各书自编号导致同号异式、表号重号（resnet-9 实案：
    # 权项式(1)=y=F+x 而实施方式式(1)=F=H-x；「表1」先后指配置表与验证表）。
    # 按书序确定性重编：权项→说明书各节，声明与台账同号异式者换新号全段同步引用
    _eq_taken: dict[str, str] = {}
    _claims_list = [str(c) for c in (claims_data or {}).get("claims") or []]
    _claims_list = [_fix_mark_names(c) for c in _claims_list]
    # 纯文本公式行先包 $$（vit-9 实施方式 `z_0=[x_class; …]　式(3)` 形）——
    # 包壳后才被式号台账/声明检出收治，DOCX 走 OMML 不再印 _{}/^{} 记号
    _claims_list = [c.replace("本申请", "本发明") for c in _claims_list]
    _claims_list = [_wrap_text_formulas(c) for c in _claims_list]
    claims_data = {**(claims_data or {}), "claims": _claims_list}
    _eq_taken.update(_eq_decls("\n\n".join(_claims_list)))
    _tab_taken: set[str] = set()
    for _s in list(desc_sections):
        _b = desc_sections[_s]
        _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
        _fired: list[str] = []
        for _fn, _tag in ((_wrap_text_formulas, "公式包壳"),
                          (lambda t: _eq_renumber(t, _eq_taken), "式号重编"),
                          (lambda t: _retable(t, _tab_taken), "表号重编"),
                          (_fix_semantic_tab_refs, "表引用改号")):
            _nb = _fn(_b)
            if _nb != _b:
                _fired.append(_tag)
            _b = _nb
        desc_sections[_s] = _b
        ctx.check(CheckResult(name="spec.xbook_norm", ok=True,
                              why=f"{_s}：" + "、".join(_fired) if _fired else ""))
    # 声明了表却没有表体——resnet-9 实案「表1 152层残差网络层配置表」题注后无表格，
    # 点名补弹生成表体就地插入（表体内容取自说明书结构描述，模型按上下文整理）
    for _s in list(desc_sections):
        _b = desc_sections[_s]
        _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
        _b = _rejoin_split_tables(_b)
        _b = _wrap_pipe_frag_tables(_b)
        _miss = _tables_missing_body(_b)
        _refs = _table_refs_missing(_b)
        if not _miss and not _refs:
            # 无题注缺表也要剥游离表片（模型把表体堆在文末的情形与题注缺表并存，
            # vit-8 实案三组残片都在同节）；裸表/单行残段同走配题注+剥离
            desc_sections[_s] = _strip_detached_tables(_caption_orphan_tables(_b, []))
            ctx.check(CheckResult(name="spec.tables", ok=True))
            continue
        ctx.check(CheckResult(name="spec.tables", ok=False,
                              why=f"{_s}：缺表体「{'；'.join(_miss)}」" * bool(_miss)
                                  + " / " * (bool(_miss) and bool(_refs))
                                  + f"缺题注引用「{'；'.join(_refs)}」" * bool(_refs)))
        _fix_num: dict[str, dict] = {}
        _tb, _ = await common.gen_json(ctx, "spec-table-fix", prompts_agent.build(
            "s1", "spec-table-fix",
            "以下说明书段落声明了表格但表体缺席，或正文引用了表号但题注与表体均缺席。"
            "按上下文描述为每个表号生成题注与一张 markdown 表（| 分隔的表头与数据行），"
            "表体内容只取自上下文所载参数与数值、不得编造。"
            "输出 {tables: [{num: 表号, caption: 题注（含表N起首）, markdown: 表格}]。}",
            context="缺表体题注清单：" + "；".join(_miss) +
                    "\n缺题注表号清单：" + "；".join(_refs) +
                    "\n\n上下文：\n" + _b[:4000],
            pid=ctx.pid))
        # 按表号匹配——模型回写题注措辞可能变体（bert-13 实案精确匹配落空），号对齐即认
        for f in (_tb or {}).get("tables") or []:
            if not isinstance(f, dict):
                continue
            _num = (re.search(r"表\s*(\d+)", str(f.get("num") or "")) or
                    _TAB_CAPTION.match(str(f.get("caption") or "")) or
                    re.search(r"表\s*(\d+)", str(f.get("caption") or "")))
            if _num and str(f.get("markdown") or ""):
                _fix_num[_num.group(1)] = {
                    "caption": str(f.get("caption") or f"表{_num.group(1)}").strip(),
                    "markdown": str(f.get("markdown") or "")}
        if _fix_num:
            _paras = _b.split("\n\n")
            _out: list[str] = []
            _done_refs: set[str] = set()
            _i = 0
            while _i < len(_paras):
                _p = _paras[_i]
                _cap = _TAB_CAPTION.match(_p.strip())
                # 命中题注 → 题注+补回表体 整段替换原「表区」（含残缺表头/散行表体，
                # vit-8 实案表2 表体被拆成逐段散行，原位替换才不留残）
                if _cap and _cap.group(1) in _fix_num and "|" in _fix_num[_cap.group(1)]["markdown"]:
                    _out.append(_p)
                    _out.append(_fix_num[_cap.group(1)]["markdown"])
                    _i = _table_zone_end(_paras, _i) + 1
                    continue
                # 首个 表N 引用段 → 紧跟其后补 题注+表体（vit-9 实案引用悬空）
                _out.append(_p)
                for _rn in _refs:
                    if (_rn in _fix_num and _rn not in _done_refs
                            and re.search(r"表\s*" + re.escape(_rn) + r"(?!\d)", _p)
                            and "|" in _fix_num[_rn]["markdown"]):
                        _out.append(_fix_num[_rn]["caption"])
                        _out.append(_fix_num[_rn]["markdown"])
                        _done_refs.add(_rn)
                _i += 1
            desc_sections[_s] = "\n\n".join(_out)
        # 补弹漏项兜底——仍缺题注的引用号与无题注表区按序配题注、孤头残段剥除
        # （vit-10 实案：补弹漏回 表1，表头单段遗弃在正文、数据表体粘在表2 后）；
        # 先配题注再剥残——配过题注的表块即合法，游离剥离只清真残片
        _still = _table_refs_missing(desc_sections[_s])
        desc_sections[_s] = _strip_detached_tables(_caption_orphan_tables(desc_sections[_s], _still))
        _bf = desc_sections[_s]
        _bf = _bf if isinstance(_bf, str) else "\n\n".join(map(str, _bf))
        _miss2 = _tables_missing_body(_bf)
        _refs2 = _table_refs_missing(_bf)
        ctx.check(CheckResult(name="spec.tables", ok=not (_miss2 or _refs2),
                              why=f"{_s}：补弹后仍缺 " + "、".join([*_miss2, *_refs2]) if (_miss2 or _refs2) else ""))
    # 宣告了式却没有式——resnet-9 实案两处「输出y满足式(1)：」后接正文无公式块，
    # 点名补弹生成 LaTeX 式体就地插入（上下文同节公式与符号约定可推得式体）
    _dang: list[tuple[str, int, str]] = []
    for _s, _b0 in desc_sections.items():
        _b0 = _b0 if isinstance(_b0, str) else "\n\n".join(map(str, _b0))
        _dang += [(_s, _i, _p) for _i, _p in _formulas_missing_body(_b0)]
    if _dang:
        ctx.check(CheckResult(name="spec.formulas", ok=False,
                              why=f"宣告式而无式 {len(_dang)} 处：" + "；".join(
                                  f"{_s}节…{_p[-30:]}" for _s, _pi, _p in _dang[:3])))
        _fx, _ = await common.gen_json(ctx, "spec-formula-fix", prompts_agent.build(
            "s1", "spec-formula-fix",
            "以下说明书段落在段末宣告了公式（「式(N)：」「表示为：」「即：」）但式体缺席。"
            "按上下文为每处补一个 LaTeX 式体（只写式子本身，不要 $ 定界、不要式号），"
            "式体须与上下文符号约定一致、不得编造新关系。"
            "输出 {formulas: [{idx, latex}]}。",
            context="\n".join(f"[{_i}]（{_s}节）…{_p[-80:]}" for _i, (_s, _pi, _p) in enumerate(_dang))
            + "\n\n同节上下文：\n" + "\n".join(
                (b if isinstance(b, str) else "")[-2000:] for _s, b in desc_sections.items()
                if _s in {_d[0] for _d in _dang}),
            pid=ctx.pid))
        _f_map = {int(f["idx"]): str(f["latex"]) for f in (_fx or {}).get("formulas") or []
                  if isinstance(f, dict) and "idx" in f and "latex" in f}
        if _f_map:
            # 同节多处缺式按段序倒序插入，先插者不移后插者之位
            for _i, (_s, _pi, _p) in sorted(
                    enumerate(_dang), key=lambda t: (t[1][0], -t[1][1])):
                if _i not in _f_map:
                    continue
                _lat = _f_map[_i].strip().strip("$").strip()
                if not _lat:
                    continue
                _b0 = desc_sections[_s]
                _b0 = _b0 if isinstance(_b0, str) else "\n\n".join(map(str, _b0))
                _paras = _b0.split("\n\n")
                _paras.insert(_pi + 1, "$$" + _lat + "$$")
                desc_sections[_s] = "\n\n".join(_paras)
        _dang2 = sum((_formulas_missing_body(b if isinstance(b, str) else "\n\n".join(map(str, b)))
                      for _s, b in desc_sections.items()), [])
        ctx.check(CheckResult(name="spec.formulas", ok=not _dang2,
                              why=f"补弹后仍缺式 {len(_dang2)} 处" if _dang2 else ""))
    abs_ask = ("请写摘要，一段纯文本，不少于 240 字且 ≤290 字；细则第23条四要素齐备——"
               "以「本发明公开」起句（与说明书首段自称一致），"
               "写明技术领域、所解决的技术问题、技术方案要点与有益效果"
               "（效果须落在「提高/降低/实现/改善」类动词上，且只能写说明书已公开的"
               "效果表述或其直接推论，不得引入说明书未载的新效果断言或竞赛名次）。")
    abstract = (await ctx.gen("abstract", prompts_agent.build(
        "s1", "abstract", abs_ask, context=ctx_text, pid=ctx.pid), "interactive")).text
    # 四要素确定性核对——实案出现领域/问题/方案齐但整段无效果句（ask 已写要求仍漏），
    # 长度下限检查放行不了，补检效果动词与字数
    # 效果句是末段收束元素——动词在句中作定语不算数（实案「以…为简化训练目标」骗过全文扫描）
    def _has_effect(t):
        sents = [s for s in re.split(r"(?<=[。；])", t) if s.strip()]
        return bool(_EFFECT_VERB.search("".join(sents[-2:])) or _EFFECT_MARK.search(t))
    # 重写补弹最多两轮——实案出现补弹仍 <150 字直接放行的死角，四要素不齐就再要；
    # 下限对齐语料 p25（授权摘要中位 284/p25 244，原 150 下限放过 175-182 实案）
    for _ in range(2):
        _a = _limit_abstract(_clean_abstract(abstract or ""))
        if len(_a) >= 240 and _has_effect(_a) and _ABS_SCHEME.search(_a):
            break
        abstract = (await ctx.gen("abstract", prompts_agent.build(
            "s1", "abstract", abs_ask + "上次答复不完整（字数不足、缺技术方案要点或缺有益效果表述），"
            "请补足四要素完整表述——须写明「方法/装置包括…步骤/模块」的方案要点，"
            "末句必须以「从而/使得/达到了…的效果」句式写明有益效果。",
            context=ctx_text, pid=ctx.pid), "interactive")).text
    # 补弹后仍缺效果句（模型句式定势两连漏）：确定性拼尾——在前文末句后补效果收束句
    # 先按落库限幅收口再核对——实案 _a2=421 字效果句在尾端，检查放行后被 build_blocks
    # 按 290 二次截断恰好切掉效果句；核对文本必须与实际落库文本一致
    _a2 = _limit_abstract(_clean_abstract(abstract or ""))
    if not _has_effect(_a2):
        abstract = (await ctx.gen("abstract", prompts_agent.build(
            "s1", "abstract",
            "只输出一句有益效果收束句（不超过 60 字），以「从而」或「使得」开头，"
            "概括上述技术方案带来的技术效果，输出 {abstract: 单句文本}。",
            context=ctx_text, pid=ctx.pid), "interactive")).text
        tail = _clean_abstract(abstract or "")
        if not (tail and len(tail) <= 80):
            # 模型补弹失控（空回/超限）时，从发明内容效果段确定性摘句——
            # 效果句本就写过，摘 ≤60 字那半句复用即可
            _seg = desc_sections.get("发明内容") or ""
            _seg = _seg if isinstance(_seg, str) else "\n\n".join(map(str, _seg))
            _sents = re.split(r"(?<=[。；])", _seg)
            cand = [s for s in _sents if _EFFECT_VERB.search(s)]
            tail = ""
            for s in reversed(_sents):
                s = s.strip()
                if s and _EFFECT_VERB.search(s) and len(s) <= 60:
                    tail = s
                    break
            else:
                tail = cand[-1][:60] if cand else ""
        if tail:
            # 限幅要在拼尾前，且预算按 build_blocks 的实际限幅 290 算——
            # 按 300 预留会在末端被二次限幅把尾句再截掉
            abstract = _limit_abstract(_a2, 290 - len(tail)) + tail

    # 「技术方案」要素同款确定性收口——实案两轮补弹仍通篇无 包括/步骤/模块 词。
    # 方案句在四要素里位次在效果句之前：先定位效果句原位中插，失控则从发明内容摘句。
    _a3 = _limit_abstract(_clean_abstract(abstract or ""))
    if not _ABS_SCHEME.search(_a3):
        abstract = (await ctx.gen("abstract", prompts_agent.build(
            "s1", "abstract",
            "只输出一句技术方案要点句（不超过 60 字），须含「包括」或「步骤」并概括核心方案，"
            "输出 {abstract: 单句文本}。",
            context=ctx_text, pid=ctx.pid), "interactive")).text
        scheme = _clean_abstract(abstract or "")
        # 过短方案句形同截句——「该方法包括：获取待识别图像」形式上含包括
        # 但机制缺席（disclosure 实案），不足 20 字直接判负走兜底。
        if not (scheme and _ABS_SCHEME.search(scheme) and 20 <= len(scheme) <= 80):
            _seg = desc_sections.get("发明内容") or ""
            _seg = _seg if isinstance(_seg, str) else "\n\n".join(map(str, _seg))
            scheme = ""
            for s in re.split(r"(?<=[。；])", _seg):
                s = s.strip()
                if s and _ABS_SCHEME.search(s) and len(s) <= 60:
                    scheme = s
                    break
            if not scheme:
                # 兜底二：发明内容的方案句普遍超 60 字（disclosure 实案摘句全空）——
                # 从独权「包括：」子句截 ≤55 字合成「所述方法包括…」方案句。
                _claims_txt = "\n".join(str(c) for c in (claims_data or {}).get("claims") or [])
                _m = re.search(r"包括[：:]?", _claims_txt)
                if _m:
                    _seg2 = _claims_txt[_m.start():_m.start() + 55]
                    _cut = max(_seg2.rfind(x) for x in "、，；。")
                    _seg2 = (_seg2[:_cut + 1] if _cut > 12 else _seg2).rstrip("，、；：。")
                    _cand = "所述方法" + _seg2 + "。"
                    if _ABS_SCHEME.search(_cand) and len(_cand) <= 80:
                        scheme = _cand
        if scheme:
            _sents = [s for s in re.split(r"(?<=[。；])", _a3) if s.strip()]
            _eff_i = next((i for i in range(len(_sents) - 1, -1, -1)
                           if _EFFECT_MARK.search(_sents[i]) or _EFFECT_VERB.search(_sents[i])),
                          len(_sents))
            _body, _eff = "".join(_sents[:_eff_i]), "".join(_sents[_eff_i:])
            abstract = _limit_abstract(_body, 290 - len(_eff) - len(scheme)) + scheme + _eff

    # 问题句去重——重写后问题表述可能二次出现（disclosure 实案方案句后
    # 又插「本发明要解决的技术问题是：…」整段），保首次出现、剥后续。
    _ad = _limit_abstract(_clean_abstract(abstract or ""))
    _ad_sents = [s for s in re.split(r"(?<=[。；])", _ad) if s.strip()]
    # 只认问题宣告句式——效果句也可能带「问题」（避免…问题），不误剥。
    if sum(1 for s in _ad_sents if re.search(r"要解决|技术问题|的问题", s)) > 1:
        _seen_q = False
        _kept = []
        for _s in _ad_sents:
            if re.search(r"要解决|技术问题|的问题", _s):
                if _seen_q:
                    continue
                _seen_q = True
            _kept.append(_s)
        abstract = "".join(_kept)

    # 长度下限确定性兜底——重写两轮燃尽后仍 <240（bert-14 实案 162 字）
    _a4 = _limit_abstract(_clean_abstract(abstract or ""))
    _seg = desc_sections.get("发明内容") or ""
    _seg = _seg if isinstance(_seg, str) else "\n\n".join(map(str, _seg))
    abstract = _abstract_floor_pad(_a4, _seg)
    _af = _limit_abstract(_clean_abstract(abstract or ""))
    _a_missing = ([f"字数{len(_af)}"] if len(_af) < 240 else [])
    _a_missing += [] if _has_effect(_af) else ["有益效果句"]
    _a_missing += [] if _ABS_SCHEME.search(_af) else ["技术方案要点"]
    ctx.check(CheckResult(name="abstract.elements", ok=not _a_missing,
                          why="缺：" + "、".join(_a_missing) if _a_missing else ""))

    # 自称归一收口闸——中段归一（1889/1954）之后的表体补弹/式体插段/重写覆盖
    # 仍可能回写「本申请」（sam2 [0002]、yolo 发明内容实案）；出口处再过一遍
    for _s in list(desc_sections):
        _b = desc_sections[_s]
        _b = _b if isinstance(_b, str) else "\n\n".join(map(str, _b))
        _nb = normalize_self_ref(_b)
        if _nb != _b:
            desc_sections[_s] = _nb
            ctx.check(CheckResult(name="spec.self_ref", ok=False,
                                  why=f"{_s}：末段重写回写「本申请」，已归一"))
    claims = [normalize_self_ref(str(c)) for c in (claims_data or {}).get("claims") or []]
    abstract = normalize_self_ref(abstract)
    description = desc_sections
    blocks = build_blocks(d, claims, description, abstract)
    if not blocks:
        ctx.check(CheckResult(name="format", ok=False, why="三书成稿为空"))
        ctx.finish()
        return
    content = ctx.store.read_content(ctx.pid)
    try:
        applied = checks.apply_blocks(content, blocks)
    except patch.PatchError as e:
        ctx.check(CheckResult(name="parse", ok=False, why=str(e)))
        _degrade(ctx, d, claims, description, abstract)
        ctx.finish()
        return
    results = [checks.parse(applied),
               checks.preflight_delta(d.report, checks.report_for(ctx.store, ctx.pid, applied))]
    ok = all([ctx.check(r) for r in results])
    if ok:
        ctx.propose("patch", FileAnchor(file="content.md"), patch=BlocksPatch(blocks=blocks), checks_=results)
        # 声明了图就要给草稿——为规划图各产一份 mmd 图源提案（FilePatch 确认闸写入 figs-src/）
        fig_src, _ = await common.gen_json(ctx, "figsrc", prompts_agent.build(
            "s1", "figsrc",
            _FIGSRC_ASK
            + "清单：" + "、".join(f"图{f['num']} {f['title']}" for f in plan_figs),
            context=ctx_text, pid=ctx.pid)) if plan_figs else (None, None)
        fig_entries = list((fig_src or {}).get("figsrc") or [])
        got = {f.get("num") for f in fig_entries}
        missing = [f for f in plan_figs if f["num"] not in got]
        if missing:  # 模型漏产：补弹一轮点名缺号
            fig_src2, _ = await common.gen_json(ctx, "figsrc-missing", prompts_agent.build(
                "s1", "figsrc",
                _FIGSRC_ASK
                + "清单（只产出以下图号）："
                + "、".join(f"图{f['num']} {f['title']}" for f in missing),
                context=ctx_text, pid=ctx.pid))
            fig_entries += list((fig_src2 or {}).get("figsrc") or [])
        # figlint 确定性体检：warn 命中即点名重产一次——语义回执告诉模型渲染器
        # 到底把图理解成了什么（模型看不见渲染，这是它的自查通道）
        from patent_docx import mmd_render

        def _lint_of(entry):
            _m = str(entry.get("mmd") or "").strip()
            if not _m.startswith(("flowchart", "graph")):
                return []
            return [h for h in mmd_render.validate_graph(mmd_render.parse_mmd(_m))
                    if h["level"] == "warn"]

        linted = [(f, h) for f in fig_entries if (h := _lint_of(f))]
        if linted:
            ctx.check(CheckResult(name="figsrc.lint", ok=False, why="；".join(
                f"图{f.get('num')} 命中 " + "、".join(x["code"] for x in hits)
                for f, hits in linted)))
            fix_lines = []
            for f, hits in linted:
                _g = mmd_render.parse_mmd(str(f.get("mmd") or ""))
                fix_lines.append(
                    f"图{f.get('num')} {f.get('name')}：" + "；".join(h["detail"] for h in hits)
                    + f"；渲染器当前理解：{mmd_render.describe_graph(_g)}")
            fig_src3, _ = await common.gen_json(ctx, "figsrc-lint", prompts_agent.build(
                "s1", "figsrc",
                _FIGSRC_ASK + "以下图源确定性体检发现问题，只重产这些图号、修正结构：\n"
                + "\n".join(fix_lines),
                context=ctx_text, pid=ctx.pid))
            fixed = {f.get("num"): f for f in (fig_src3 or {}).get("figsrc") or []
                     if str(f.get("mmd") or "").strip().startswith(("flowchart", "graph"))}
            fig_entries = [fixed.get(f.get("num"), f) for f in fig_entries]
        for i, f in enumerate(fig_entries):
            stem = re.sub(r"[^A-Za-z0-9_-]", "", str(f.get("name") or ""))[:40]
            mmd = str(f.get("mmd") or "").strip()
            if not stem or not mmd.startswith(("flowchart", "graph")):
                continue
            num = f.get("num")
            fname = f"fig{num}-{stem}.mmd" if num is not None else f"fig{i+1}-{stem}.mmd"
            ctx.propose("patch", FileAnchor(file=f"figs-src/{fname}"),
                        patch=FilePatch(file=f"figs-src/{fname}",
                                        content=_sanitize_mmd(mmd) + "\n"))
    else:
        _degrade(ctx, d, claims, description, abstract)
    ctx.finish()


def _degrade(ctx: RunContext, d, claims: list[str], description: dict, abstract: str) -> None:
    draft = "\n".join(f"- {c}" for c in claims) + "\n\n" + \
        "\n".join(f"{k}：{v if isinstance(v, str) else ' '.join(map(str, v))}" for k, v in description.items()) + \
        ("\n\n摘要：" + abstract if abstract else "")
    root = common.last_block(d, "claims")
    if root is None:
        return
    line = d.ast["books"]["claims"]["offset"] + root["lines"]["start"]
    common.comment(ctx, d, line, f"{root['num']}.",
                   "三书初稿未能直接装入现案，草稿请核对后自行取用：\n\n```\n" + draft + "\n```")
