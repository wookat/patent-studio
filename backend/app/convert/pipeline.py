# -*- coding: utf-8 -*-
"""一键转专利流水线（docs/plan/09 §3.3）。

run(...) 在后台任务里执行：
  1. 发明要点（确定性）：问卷非空字段 + 论文原文（按预算截断）拼成 user 提示；
  2. heavy 提示词（prompts.build("convert")）→ JSON（prompts.parse_json）→ render_markdown
     （内核语法，权项编号由本模块统一重写为
     「N.」，段号 [000N] 一律剥掉由内核生成）→ docset.validate + parse_ast + lint(error)；
  3. 校验失败 ⇒ 带错误清单回修 1 次；仍失败 ⇒ AiError(format) ⇒ 任务 error(kind="ai_format")；
  4. 写入：target=new ⇒ 抽取到的图片写 figs/、store.save_content；
     target=pid ⇒ history.commit_draft(author="ai")，工作区不动；
  5. 返回 report{warnings, unmapped, chars_in, claims, paragraphs, figures, lint, terms, notes, usage}。
"""

import asyncio
import json
import os
import re

from app import atomic
from app.ai import prompts
from app.ai.client import AiError
from app.convert import runner
from app.convert.extract import Extracted
from app.convert.questionnaire import Questionnaire, render
from app.domain import history, lint
from app.domain.projects import DOCX_FIG_EXTS
from patent_studio.kernel import docset, figures_md, spec_templates
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.kernel.preflight import _ABSTRACT_ELEMENTS, limit_abstract, normalize_self_ref

DRAFT_MESSAGE = "draft: 论文转专利"
PROMPT_BUDGET = 30_000
DESC_SECTIONS = ("技术领域", "背景技术", "发明内容", "附图说明", "具体实施方式")
_CLAIM_NUM = re.compile(r"^\s*(?:权利要求\s*)?\d+\s*[.、．:：]\s*")
_PARA_NUM = re.compile(r"^\s*(?:[\[【]\s*\d{3,5}\s*[\]】]|\d{4})\s*")
_HEADING = re.compile(r"^\s*#{1,4}\s+")


def user_prompt(extracted: Extracted, q: Questionnaire, filename: str) -> tuple[str, list[str]]:
    warnings: list[str] = []
    text = extracted["text"]
    if len(text) > PROMPT_BUDGET:
        warnings.append(f"论文正文 {len(text)} 字，送入模型的原文截断到前 {PROMPT_BUDGET} 字")
        text = text[:PROMPT_BUDGET]
    parts = [
        "任务：把下面的论文/技术交底书改写成一份中国发明专利申请文件（摘要、权利要求书、说明书五节），输出 JSON。",
        "撰写红线：深度挖掘不等于创造性扩展——只能提取原文信息，绝不编造、修改、歪曲；原文未提及的细节宁可不写、"
        "缺失处列入 notes 待确认，不要脑补参数、实验、附图或效果；"
        "先提炼三要素闭环（区别点 / 技术问题 / 技术效果）再落笔。",
        "要求：权利要求至少 1 项独立权利要求 + 若干从属权利要求，每项一个字符串、不要自行编号；独立权项只含区别所必需的"
        "最少技术特征，从属权项放有意义的退路限定（预处理 / 参数范围 / 阈值 / 实施细节）；先行词先引出再用「所述」；"
        "说明书各节为多段纯文本，段落之间空一行，不写段号；"
        "附图规则：附图只收说明技术方案的流程图、结构示意图、模块框图——指标对比图、性能/损失曲线、"
        "效果可视化、照片、正文截图一律不收，其结论改为正文文字叙述；附图说明中每图题注各占一行、"
        "只写一句「图N是本发明实施例的XX图」，不得照抄论文题注的细节描述、不得把多图题注合并在一段内；"
        "figures 数组逐项写 {num: 图号自 1 顺排, src: 提取图序号, "
        "caption: 那句附图说明}，未收录的提取图不写入 figures；收录的提取图本身是多子图拼版时，按"
        "「图N(a)」「图N(b)」引用其子图，不得拆占新图号（图号总数=figures 数组长度）；"
        "若提取图中没有任何合格的流程/结构/模块示意图而本发明为方法/系统类，应自绘 1~3 张工程示意图——"
        "figures 项写 {num, spec, marks, caption}（spec 为分层框图 JSON，直接描述图面结构："
        '{"bands":[{"title":"层名","blocks":[{"id":"A","label":"元件名 标记号"}]},'
        '"edges":[{"from":"A","to":"B","label":"标注","dashed":false}]}——bands 自上而下'
        "逐层排列（数据流向从上层流向下层），blocks 层内从左到右排列，edges 全部正交连线，"
        'dashed:true 画虚线边（参数/均值/权重等辅助数据传递线惯例用虚线），判据节点加 "shape":"diamond"；'
        "标签用中文、不含公式记号；"
        "构图要求：结构图按分层框图画——层代表数据流阶段（输入层→预处理层→编码/网络层→汇聚层→输出/更新层"
        "或类似命名），每 band 1~4 个块、全图≤12 块；主干信号链沿各层向下，并行支路放在同 band 并列块、"
        "回授/参数传递用 dashed:true 边；方法流程图用单块逐层直排（每层一个 S10N 步骤块），"
        "条件判据用 diamond 块并各出「是/否」分支边（label 写是/否），回环边用虚线；细节塞不下拆成"
        "图N/图N+1 两张分画，不得把训练循环、正则化、适配等全部细节堆进一张图；"
        "图型模板库（真实专利图型归纳，按图型套骨架再改文案）："
        + spec_templates.catalog()
        + "；"
        + (
            (
                "真实专利附图题注参照（模仿其命名与图型配比，勿照抄文案细节）："
                + spec_templates.exemplar_captions()
                + "；"
            )
            if spec_templates.exemplar_captions()
            else ""
        )
        + '合格结构图范例：{"bands":[{"title":"输入","blocks":[{"id":"X","label":"多视图输入"}]},'
        '{"title":"增强层","blocks":[{"id":"A","label":"双视图增强模块 101"}]},'
        '{"title":"网络层","blocks":[{"id":"B","label":"学生网络 102"},{"id":"C","label":"教师网络 103"}]},'
        '{"title":"输出层","blocks":[{"id":"D","label":"损失计算模块 104"}]}],'
        '"edges":[{"from":"X","to":"A"},{"from":"A","to":"B"},{"from":"A","to":"C"},'
        '{"from":"B","to":"D"},{"from":"C","to":"D"},'
        '{"from":"D","to":"C","label":"教师参数","dashed":true}]}'
        "（学生/教师两路同层并行、虚线回授——呈清晰分层拓扑而非直链）；"
        "自绘图必须带附图标记：为图中 6~12 个关键元件/步骤分配三位阿拉伯数字标记（百位起编 101、102…），"
        "节点文本写「中文元件名 标记号」如 [加噪单元 102]，方法流程图的步骤节点带步骤号 S101、S102…，"
        "说明书正文按号引用且名称与标记号紧邻无空格（如「图像嵌入模块101」），figures 项的 marks 字段给该图"
        " {标记号: 名称} 全表（marks 只收三位数字元件标记号，步骤号 S101 等不进 marks）；"
        "同一标记号在全文只对应同一个名称，正文每次引用该号时元件名必须与 marks 表一字不差（如 207 永远是"
        "「教师网络」，不得写成「输入教师网络」「指数滑动平均方式更新教师网络」等其他叫法）；"
        "授权件行文：每项独立权利要求用两段式「……，其特征在于，……」（细则第 24 条）；从属权利要求必须以"
        "「根据权利要求N所述的XX」开头按编号引用在先从权（特征递进限定），不得写「进一步地，在前述方法中」"
        "式泛指引用；权项中每个「所述XX」必须先在说明书或该权项前序部分引出定义，且「所述」后只接名词性"
        "术语——不接「所述N取值」「所述先前训练阶段」式描述短语（应写「所述N」「上述先前训练阶段」或在说明书中"
        "先定义该术语）；摘要按细则第 23 条四要素写——技术领域、所解决的技术问题、技术方案要点、有益效果，且全长"
        "不得超过 280 字（超长作废）；发明内容节按授权件铺陈式写：先一段「本发明提供一种……，包括：」逐点"
        "重述独立权利要求技术方案要点，后一段专写有益效果（不混入背景或细节实现）；"
        "具体实施方式承接细节限定用「其中，…」句式，可选/替代手段用"
        "「可以/可选地/在一些实施方式中」表述，且须给出足以实施的细节密度：关键数值参数、维度取值、"
        "阈值范围、每处可选特征给≥2种替代方案，方案要点多时拆「实施例一/实施例二」多个实施例；"
        "实验结果只写客观数据，竞赛名次、获奖记录、最佳/最先进/领先等宣传性对比用语不写入申请文件；"
        "不得出现论文腔/口语化措辞：可视为、换句话说、值得注意的是、直观地说、容易看出、众所周知、"
        "在某种意义上、的推广——审查口径只写技术事实与技术效果；"
        "说明书不引用「表N」——性能/对比数据只写文字叙述或引公式编号，不写「如表1所示」类指向不存在表格的表述；"
        "定义/递推/核心计算式等行间公式一律独立成行写作 `$$式体$$式(N)`（式号按出现顺序自 式(1) 顺排），"
        "正文以「如式(N)所示」引用，不得把 `$$…$$` 公式嵌在句中作行内式；变量等短符号用 $…$；"
        "专业名词统一写法并列入 terms；"
        "论文里无法映射进专利文件的内容（致谢、参考文献、实验环境等）列入 notes，不要编造。",
    ]
    qtext = render(q)
    if qtext:
        parts.append("发明要点（发明人问卷，优先于论文原文）：\n" + qtext)
    figs = extracted.get("figures") or []
    if figs:
        caps = extracted.get("fig_captions") or []
        lines = []
        for i in range(len(figs)):
            cap = (caps[i] or "").strip() if i < len(caps) else ""
            cap = re.sub(r"\s+", " ", cap)[:200]
            lines.append(f"提取图{i + 1}：{'原题注『' + cap + '』' if cap else '（未识别题注）'}")
        parts.append("已从原文提取以下图片（提取图序号为 src 取值）：\n" + "\n".join(lines))
    parts.append(f"论文/交底书原文（{filename}）：\n" + text)
    return "\n\n".join(parts), warnings


def blocks(text: str, drop: tuple[str, ...] = ()) -> list[str]:
    """按空行分块，块内保留多行（表格 / 多行公式 / 分步权项）；剥掉每行首的段号与 Markdown 标题号，
    丢掉与节名重复的行。"""
    out: list[str] = []
    cur: list[str] = []
    for raw in (text or "").replace("\r\n", "\n").split("\n") + [""]:
        ln = _HEADING.sub("", _PARA_NUM.sub("", raw).strip())
        if ln in drop:
            ln = ""
        if ln:
            cur.append(ln)
        elif cur:
            out.append("\n".join(cur))
            cur = []
    return out


def _render_gen_fig(spec_or_mmd) -> bytes | None:
    """模型自绘图源 → PNG 字节——figspec dict/JSON 走确定性分层渲染，
    旧案 mmd 文本走 mmd_render 兜底；渲染失败（语法/空图）→ None。"""
    try:
        import io

        if isinstance(spec_or_mmd, (dict, list)):
            from patent_studio.kernel import figspec

            img = figspec.render_figspec(spec_or_mmd)
        else:
            src = str(spec_or_mmd or "").strip()
            if not src:
                return None
            if src.lstrip().startswith("{"):
                from patent_studio.kernel import figspec

                img = figspec.render_figspec(src)
            else:
                from patent_studio.kernel import mmd_render

                img = mmd_render.render_mmd(src)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        return None


def _order_figures(
    figures: list[tuple[str, bytes]], items, gen_src: dict[str, str] | None = None, marks_out: list[dict] | None = None
) -> list[tuple[str, bytes]]:
    """按模型 figures[] 挑选并重排图——src（提取图序号，1 起）收提取图，mmd 渲染自绘工程示意。
    items 为 None（模型未输出 figures 键）→ 原样全收；[] → 模型判定全不收；全无效 → 原序兑底。
    gen_src 收集本次用到的 {图名: mmd 源}——写 figs-src/ 供后续人工改图源；
    marks_out 与产出顺序对齐收集每项的附图标记表 {标记号: 名称}。"""
    if items is None:
        return figures
    if isinstance(items, list) and not items:
        return []
    order: list[tuple[str, bytes]] = []
    seen: set[int] = set()
    for it in items if isinstance(items, list) else []:
        src = (it or {}).get("src")
        try:
            s = int(src)
        except (TypeError, ValueError):
            s = 0
        if 1 <= s <= len(figures) and s not in seen:
            seen.add(s)
            order.append(figures[s - 1])
            if marks_out is not None:
                marks_out.append(dict((it or {}).get("marks") or {}))
            continue
        spec = (it or {}).get("spec")
        mmd = str((it or {}).get("mmd") or "").strip()
        fig_src = spec if spec is not None else (mmd or None)
        if fig_src is not None:
            blob = _render_gen_fig(fig_src)
            if blob:
                if gen_src is not None:
                    stem = f"fig{len(order) + 1}"
                    if spec is not None:
                        import json as _json

                        gen_src[stem + ".spec"] = _json.dumps(spec, ensure_ascii=False, indent=2)
                    else:
                        gen_src[stem + ".mmd"] = mmd
                order.append(("png", blob))
                if marks_out is not None:
                    marks_out.append(dict((it or {}).get("marks") or {}))
    return order or figures


def claim_lines(text: str) -> list[str]:
    lines = [ln.strip() for ln in (text or "").replace("\r\n", "\n").split("\n") if ln.strip()]
    if lines:
        lines[0] = _CLAIM_NUM.sub("", lines[0])
    return lines


def render_markdown(data: dict, warnings: list[str] | None = None) -> str:
    """AI JSON → content.md 全文（docset.assemble），编号/段号由本模块与内核负责，AI 写的一律剥掉。"""
    title = " ".join(str(data.get("title") or "").split()) or "未命名发明"
    abstract = "\n\n".join(blocks(str(data.get("abstract") or "")))
    capped = limit_abstract(abstract)
    if capped != abstract and warnings is not None:
        warnings.append(f"AI 摘要 {len(abstract)} 字超 300 字上限，按标点边界确定性截断到 {len(capped)} 字")
    abstract = capped
    claims = []
    for i, c in enumerate(data.get("claims") or [], 1):
        lines = claim_lines(str(c))
        if lines:
            lines[0] = f"{i}.{lines[0]}"
            claims.append("\n".join(lines))
    desc = data.get("description") or {}
    if not isinstance(desc, dict):
        raise ValueError("description 必须是对象")
    sections = []
    for name in DESC_SECTIONS:
        body = desc.get(name)
        paras = blocks(body if isinstance(body, str) else "\n\n".join(map(str, body or [])), drop=(name,))
        sections.append(f"### {name}\n\n" + "\n\n".join(paras))
    ds = docset.DocSet(
        head=f"# {title}\n\n",
        abstract="\n" + abstract + "\n\n",
        claims="\n" + "\n\n".join(claims) + "\n\n",
        description="\n" + "\n\n".join(sections) + "\n",
        headings={b: h + "\n" for b, h in docset.BOOK_HEADINGS.items()},
    )
    return normalize_self_ref(docset.assemble(ds))


def check(content: str) -> list[str]:
    """返回错误清单（空 = 通过）：docset 规范 → parse_ast → lint error 级。"""
    try:
        docset.validate(docset.split(content))
    except docset.DocsetError as e:
        return [str(e)]
    try:
        parse_ast(content)
    except AstError as e:
        return [f"第 {e.line} 行：{e}" if e.line else str(e)]
    report = lint.lint(content)
    return [
        f"第 {d['line']} 行：{d['message']}" if d.get("line") else d["message"]
        for d in report["diagnostics"]
        if d["severity"] == "error"
    ]


def _fix_prompt(errors: list[str], previous: str) -> str:
    return (
        "上一轮输出装配成案卷后校验失败，请修正后重新输出完整 JSON（同一 schema，不要解释）。\n校验错误：\n- "
        + "\n- ".join(errors)
        + "\n\n上一轮输出：\n"
        + previous
    )


def _gen_quality_errors(data: dict) -> list[str]:
    """AI 初稿的生成质量回修项——规则与 preflight 同名（作者稿里是 warning，
    成稿环节按 error 回修一次，仍未过则退为告警交付、不报废整案）：
    摘要未写全细则第 23 条四要素 / figures[].marks 声明的标记号未在说明书正文出现。"""
    errors: list[str] = []
    missing = [name for name, pat in _ABSTRACT_ELEMENTS if not pat.search(str(data.get("abstract") or ""))]
    if missing:
        errors.append(
            "摘要未体现"
            + "、".join(missing)
            + "（细则第 23 条：技术领域、所解决的技术问题、技术方案要点、有益效果四要素须写全）"
        )
    desc = data.get("description") or {}
    desc_text = "\n".join(str(v) for v in desc.values()) if isinstance(desc, dict) else str(desc)
    for fig in data.get("figures") or []:
        if not isinstance(fig, dict):
            continue
        missing_marks = [
            f"{n}（{name}）"
            for n, name in (fig.get("marks") or {}).items()
            if not re.search(rf"(?<![0-9]){re.escape(str(n))}(?![0-9])", desc_text)
        ]
        if missing_marks:
            errors.append(
                f"图{fig.get('num')} 标记表中的 {'、'.join(missing_marks)} 在说明书正文未出现"
                "——正文须按号引用图中全部标记号"
            )
    return errors


_FIG_REF = re.compile(r"图\s*(\d+)")
_ATTACHMENT_FIG_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


_CV_FIG_MANIFEST = "cv-fig-manifest.json"


def _stage_figures_as_attachments(
    project_dir: str, figures: list[tuple[str, bytes]], draft_sha: str | None = None
) -> list[str]:
    """草稿模式（is_new=False）抽出的图不落 figs/，写 attachments/cv-figN.ext——
    附加文件属新增不动现有引用；另留 cv-fig-manifest.json 记录批次与草稿提交号，
    采纳草稿（恢复该 commit）时按序号晋级附图节，图号不悬空。"""
    ad = os.path.join(project_dir, "attachments")
    os.makedirs(ad, exist_ok=True)
    staged = []
    i = 0
    for ext, blob in figures:
        i += 1
        e = ext.lower()
        if e not in _ATTACHMENT_FIG_EXTS:
            continue
        e, data = _normalize_fig(e, blob)
        name = f"cv-fig{i}.{e}"
        n = 2
        while os.path.exists(os.path.join(ad, name)):
            name = f"cv-fig{i}-{n}.{e}"
            n += 1
        atomic.write_bytes(os.path.join(ad, name), data)
        staged.append(name)
    if staged:
        atomic.write_json(os.path.join(ad, _CV_FIG_MANIFEST), {"draft_sha": draft_sha, "files": staged})
    return staged


def promote_staged_figures(project_dir: str, draft_sha: str, content: str = "") -> list[str]:
    """采纳转换草稿时把暂存的 cv-fig 图晋级 figs/ 并按正文声明图号编入 figures.md——
    仅当 manifest 记录的 draft_sha 与被恢复的 commit 完全一致才动；
    返回晋级文件名列表，不匹配/无清单 → []。"""
    ad = os.path.join(project_dir, "attachments")
    mp = os.path.join(ad, _CV_FIG_MANIFEST)
    try:
        with open(mp, encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return []
    if manifest.get("draft_sha") != draft_sha:
        return []
    staged = [n for n in manifest.get("files") or [] if isinstance(n, str)]
    declared = max((int(m.group(1)) for m in _FIG_REF.finditer(content)), default=0)
    fd = os.path.join(project_dir, "figs")
    os.makedirs(fd, exist_ok=True)
    promoted = []
    for name in staged[:declared]:
        src = os.path.join(ad, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(fd, name)
        n = 2
        stem, dot, ext = name.rpartition(".")
        while os.path.exists(dst):
            dst = os.path.join(fd, f"{stem}-{n}.{ext}")
            n += 1
        os.replace(src, dst)
        promoted.append(os.path.basename(dst))
    if promoted:
        caps = figures_md.captions_of(content)
        doc = figures_md.read(project_dir) or figures_md.FiguresDoc()
        doc.spec = [
            figures_md.Figure(
                file=n, width=figures_md.DEFAULT_WIDTH, alt=f"图{i} {caps[i]}" if caps.get(i) else f"图{i}"
            )
            for i, n in enumerate(promoted, 1)
        ]
        if doc.abstract is None or doc.abstract.file not in promoted:
            doc.abstract = figures_md.Figure(file=promoted[0], width=figures_md.DEFAULT_ABSTRACT_WIDTH)
        figures_md.write(project_dir, doc)
        try:
            os.remove(mp)
        except OSError:
            pass
    return promoted


def _normalize_fig(ext: str, blob: bytes) -> tuple[str, bytes]:
    """附图落盘归一化：位图 → 白底合成去透明 + 转灰度 PNG（CNIPA 附图禁彩色、
    透明壳图不该以黑像素现身——Transformer 实案 cv-fig1 彩色雷达图/cv-fig2 透明空壳）。
    PIL 解不了的（.emf 矢量）原样放行。"""
    import io as _io

    from app.convert.extract import _flatten

    im = _flatten(blob)
    if im is None:
        return ext, blob
    buf = _io.BytesIO()
    im.convert("L").save(buf, "PNG")
    return "png", buf.getvalue()


def _write_figures(
    project_dir: str, figures: list[tuple[str, bytes]], content: str = "", marks: list[dict] | None = None
) -> int:
    fd = os.path.join(project_dir, "figs")
    os.makedirs(fd, exist_ok=True)
    for name in os.listdir(fd):  # projects.create 放的占位图让位——模型 0 收录时也须清空
        os.remove(os.path.join(fd, name))
    names = []
    for i, (ext, blob) in enumerate(figures, 1):
        e, data = _normalize_fig(ext, blob)
        name = f"fig{i}.{e}"
        with open(os.path.join(fd, name), "wb") as f:
            f.write(data)
        names.append(name)
    # 占位期 figures.md 指向 fig1.png；真图扩展名/数量不同步会悬空——按实际文件回写，
    # 模型一张未收录（names 空）也要回写空 spec，否则占位图声明悬空。
    # 抽出的图多于草稿声明图号时，多余图只留 figs/ 作素材，不进附图节；
    # 摘要附图排版内核强制存在，保留首图。
    declared = max((int(m.group(1)) for m in _FIG_REF.finditer(content)), default=0)
    doc = figures_md.infer(names, DOCX_FIG_EXTS)
    doc.spec = doc.spec[:declared]
    if marks:  # 模型给的附图标记表（自绘示意图为主）落 figures.md marks: 节
        for i, m in enumerate(marks):
            if i < len(doc.spec) and m:
                doc.spec[i].marks = {str(k): str(v) for k, v in m.items()}
    figures_md.write(project_dir, doc)
    return len(figures)


async def run(
    *,
    store,
    ai,
    pid: str,
    is_new: bool,
    filename: str,
    extracted: Extracted,
    questionnaire: Questionnaire,
    progress,
    job_id: str | None = None,
) -> dict:
    project_dir = store._dir(pid)
    progress(0.1, "整理发明要点")
    user, warnings = user_prompt(extracted, questionnaire, filename)
    warnings = list(extracted["warnings"]) + warnings
    messages = prompts.build("convert", user)
    schema = prompts.SCHEMAS["convert"]
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    content = data = None
    errors: list[str] = []
    for attempt in (1, 2):
        progress(0.2 if attempt == 1 else 0.6, "生成三书草稿" if attempt == 1 else "校验未通过，带错误回修")
        text = None
        for t in range(2):
            # 瞬断（超时/429/5xx/断连）再补一次同批重试——模型链内重试已燃尽仍挂
            # （mamba 实案：主模型与兜底模型接连 ReadTimeout 致整案报废）
            try:
                text, usage = await runner.heavy_chat(ai, messages, project_dir=project_dir, job_id=job_id)
                break
            except AiError as e:
                if not e.retryable or t == 1:
                    raise
                progress(0.2 if attempt == 1 else 0.6, "中转站瞬断，稍后重试")
                await asyncio.sleep(30)
        if text is None:
            raise AiError("upstream", "AI 中转站两次瞬断未恢复", 502)
        for k in usage_total:
            usage_total[k] += int(usage.get(k) or 0)
        try:
            data = prompts.parse_json(text, schema)
            content = render_markdown(data, warnings)
        except ValueError as e:
            errors = [f"输出不是合法的转换 JSON：{e}"]
        else:
            errors = check(content)
            quality = [] if errors else _gen_quality_errors(data)
            if attempt == 1:
                errors += quality
            else:
                warnings.extend(quality)
        if not errors:
            break
        messages = prompts.build("convert", _fix_prompt(errors, text))
    if errors:
        raise AiError("format", "AI 生成的三书两次均未通过内核校验：" + "；".join(errors), 502)
    assert content is not None and data is not None

    progress(0.85, "写入案卷")
    ast = parse_ast(content)
    fig_count = 0
    draft_sha = None
    gen_src: dict[str, str] = {}
    gen_marks: list[dict] = []
    ordered_figs = _order_figures(extracted["figures"], data.get("figures"), gen_src, gen_marks)
    if len(ordered_figs) != len(extracted["figures"]):
        warnings.append(
            f"模型按附图规则剔除 {len(extracted['figures']) - len(ordered_figs)} 张提取图"
            f"（效果/指标/照片类不入附图），收录 {len(ordered_figs)} 张"
        )
    if gen_src:
        warnings.append(f"提取图无合格示意图，模型自绘 {len(gen_src)} 张工程示意（图源存 figs-src/）")
    if is_new:
        # 批80：写附图+save_content 内含 git commit——job 协程也在事件循环上，同步活要 offload
        fig_count = _write_figures(project_dir, ordered_figs, content, marks=gen_marks)
        if gen_src:  # 自绘图源落 figs-src/——图源是唯一真相，可改后重渲
            fsd = os.path.join(project_dir, "figs-src")
            os.makedirs(fsd, exist_ok=True)
            for fname, src_text in gen_src.items():
                with open(os.path.join(fsd, fname), "w", encoding="utf-8") as f:
                    f.write(src_text)
        await asyncio.to_thread(store.save_content, pid, content)
    else:
        draft_sha = await asyncio.to_thread(history.commit_draft, project_dir, content, DRAFT_MESSAGE, author="ai")
        if ordered_figs:
            # 草稿版本不改动 figs/，但抽出的图不能白丢——落 attachments/ 并记清单，
            # 采纳草稿（恢复该 commit）时自动晋级附图节
            staged = _stage_figures_as_attachments(project_dir, ordered_figs, draft_sha=draft_sha)
            if staged:
                warnings.append(
                    f"抽取到 {len(staged)} 张图片已存至附件（{staged[0]} 等）；"
                    "草稿版本不改动现有案卷，采纳草稿时自动编入附图节"
                )
            dropped = len(ordered_figs) - len(staged)
            if dropped:
                warnings.append(f"另有 {dropped} 张图片格式不入附件（emf 等），未保留")
    report = {
        "warnings": warnings,
        "unmapped": [str(n) for n in data.get("notes") or []],
        "chars_in": len(extracted["text"]),
        "pages": extracted["pages"],
        "claims": len(ast["claims"]),
        "paragraphs": sum(1 for b in ast["description"] if b["kind"] == "paragraph"),
        "figures": fig_count,
        "lint": lint.lint(content)["counts"],
        "terms": [t for t in (data.get("terms") or []) if isinstance(t, dict)],
        "notes": [str(n) for n in data.get("notes") or []],
        "usage": usage_total,
    }
    return {
        "pid": pid,
        "new_pid": pid if is_new else None,
        "draft_sha": draft_sha,
        "title": ast["title"]["text"],
        "report": report,
    }
