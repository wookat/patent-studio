# -*- coding: utf-8 -*-
"""附图文件操作（R2 A1 单元实现；契约 docs/plan/05-r2-figures-preflight-design.md §2/§3.1；W4-C C2 docs/plan/15 §3.1）。

职责：figs/ 目录扫描 → FigureItem 列表（与 docs/figures.md 合并）；上传命名与白名单（projects.DOCX_FIG_EXTS）；
删除守卫（被「图N」引用 → FigureReferencedError）；排序 / 宽度 / 摘要图 直接写 figures_md.FiguresDoc；zip 导出。

真源 = docs/figures.md：`store.load_figures(dir)` → 改 FiguresDoc → `store.save_figures(pid, doc)`（写文件 + history）。
响应里的 settings 仍是 `ProjectStore.load_settings` 的运行时视图（spec_figures / abstract_figure 由 figures.md 派生），
路径 / 响应形状 / 错误形状与 R2 不变。图号 = 说明书节行序；alt 随文件走，重排 / 改宽不改 alt。
摘要图不能为空（内核要求）：置空 / 删掉摘要图时回落到第一张可入 DOCX 的图（与 projects.default_settings 同规则）。
"""

import io
import logging
import os
import re
import tempfile
import zipfile

from app import atomic
from app.domain.projects import DOCX_FIG_EXTS, ProjectError, _fig_sort_key
from patent_studio.kernel import critic, figures_md
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.kernel.builder import probe_image
from patent_studio.kernel.content import INLINE_FIG_RE
from patent_studio.kernel.preflight import scan_refs

log = logging.getLogger(__name__)

DEFAULT_WIDTH = figures_md.DEFAULT_WIDTH
DEFAULT_ABSTRACT_WIDTH = figures_md.DEFAULT_ABSTRACT_WIDTH
# A4 版心上限（与前端 CmInput max=17 同口径；R37-01：此前只查 >0，1512 也收）
MAX_WIDTH_CM = 17.0
PREVIEW_EXTS = (".png", ".svg", ".jpg", ".jpeg", ".gif", ".bmp")
_STEM_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
_FIG_N_RE = re.compile(r"^fig(\d+)$")
_REF_RE = re.compile(r"图(\d+)")


class FigureReferencedError(Exception):
    """删除被引用的图：refs = [{book, line(全文), text}]。

    num 为图号（说明书附图节内引用）；label 覆盖消息主语——W18 内嵌图无图号，传文件名。
    路由层转 409 {"detail": {kind: "figure-referenced", message, line, detail, refs}}。
    """

    def __init__(self, num, refs, label=None):
        super().__init__(f"{label or f'图{num}'} 被引用 {len(refs)} 处，先删除或改写引用再删图")
        self.num = num
        self.refs = refs


class FiguresError(Exception):
    """order 集合不对 / 宽度非正：路由层转 422 {"detail": {kind: "figures", message, line: null, detail}}。"""

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.detail = detail


# ---------------- 列表 ----------------


def _check_name(name):
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise ProjectError("非法文件名", 400)


def _groups(files):
    """figs/ 文件按 stem 分组：{stem: [name, …]}（保持 list_figs 顺序）。"""
    groups = {}
    for f in files:
        groups.setdefault(os.path.splitext(f)[0], []).append(f)
    return groups


def _listed(doc):
    """figures.md 已编入的文件名集合（说明书节 + 摘要图）。"""
    listed = {f.file for f in doc.spec}
    if doc.abstract:
        listed.add(doc.abstract.file)
    return listed


def _main_of(names, listed):
    """一组同 stem 文件中的主文件：已编入者优先，否则按 DOCX_FIG_EXTS 顺序；无可编入文件 → None。"""
    for n in names:
        if n in listed:
            return n
    for ext in DOCX_FIG_EXTS:
        for n in names:
            if n.lower().endswith(ext):
                return n
    return None


def _preview_of(main, companions):
    if main.lower().endswith(PREVIEW_EXTS):
        return main
    for ext in (".png", ".svg", ".jpg", ".jpeg"):
        for c in companions:
            if c.lower().endswith(ext):
                return c
    return None


def _items(project, files, doc):
    spec = {f.file: (i, f) for i, f in enumerate(doc.spec, 1)}
    listed = _listed(doc)
    items = []
    for names in _groups(files).values():
        main = _main_of(names, listed)
        if main is None:
            continue
        companions = [n for n in names if n != main]
        num, fig = spec.get(main, (None, None))
        is_abstract = bool(doc.abstract) and doc.abstract.file == main
        items.append(
            {
                "name": main,
                "ext": os.path.splitext(main)[1].lower(),
                "size": os.path.getsize(os.path.join(project.figs_dir, main)),
                "num": num,
                "width": fig.width if fig else None,
                "alt": fig.alt if fig else None,
                "is_abstract": is_abstract,
                "abstract_width": doc.abstract.width if is_abstract else None,
                "preview": _preview_of(main, companions),
                "companions": companions,
                "marks": dict(fig.marks) if fig else None,
            }
        )
    items.sort(key=lambda it: (0, it["num"], "") if it["num"] else (1, 0, _fig_sort_key(it["name"])))
    return items


def list_figures(store, pid):
    """{figures: FigureItem[], settings}；顺序 = figures.md 说明书节，其后是未编入文件。"""
    p = store.get(pid)
    return {"figures": _items(p, store.list_figs(p.dir), store.load_figures(p.dir)), "settings": p.settings}


def _main_file(store, project, name):
    """name 必须是 figs/ 中存在的可编入文件（DOCX_FIG_EXTS）。"""
    _check_name(name)
    if not name.lower().endswith(DOCX_FIG_EXTS) or name not in store.list_figs(project.dir):
        raise ProjectError(f"附图不存在：{name}", 404)
    return name


def _save(store, pid, doc):
    store.save_figures(pid, doc)
    return list_figures(store, pid)


def _default_abstract(store, project):
    """摘要图缺省：第一张可入 DOCX 的图（projects.default_settings 同规则）；没有图 → None。"""
    for f in store.list_figs(project.dir):
        if f.lower().endswith(DOCX_FIG_EXTS):
            return figures_md.Figure(file=f, width=DEFAULT_ABSTRACT_WIDTH)
    return None


def _append_spec(store, pid, doc, name, width, captions=None):
    """追加一行到说明书节；alt = 「图N 题注」（说明书已有「图N为…」时）或「图N」。"""
    n = len(doc.spec) + 1
    if captions is None:
        captions = figures_md.captions_of(store.read_content(pid))
    alt = f"图{n} {captions[n]}" if captions.get(n) else f"图{n}"
    doc.spec.append(figures_md.Figure(file=name, width=float(width), alt=alt))


# ---------------- 上传 ----------------


def _split_upload_name(filename):
    stem, ext = os.path.splitext(os.path.basename((filename or "").replace("\\", "/")))
    ext = ext.lower()
    if ext not in DOCX_FIG_EXTS:
        raise ProjectError(f"不支持的附图格式：{ext or '(无后缀)'}（允许 {' '.join(DOCX_FIG_EXTS)}）", 400)
    return stem, ext


def _check_decodable(name, data):
    """后缀对但内容不是图的文件在上传阶段拒掉，不等到构建才报「附图无法读取」。"""
    try:
        probe_image(data)
    except Exception as e:  # noqa: BLE001 - 识图器对坏文件抛的异常类型不一
        raise ProjectError(f"附图无法读取：{name}（不是有效的图片文件：{type(e).__name__}）", 400) from e


def upload_figures(store, pid, files):
    """files = [(filename, bytes), …]；逐件校验，坏件跳过记入 skipped，其余写入。
    新 stem 追加到说明书节末尾，同 stem 视为伴生。"""
    p = store.get(pid)
    doc = store.load_figures(p.dir)
    existing = store.list_figs(p.dir)
    existing_stems = set(_groups(existing))
    next_no = max((int(m.group(1)) for m in map(_FIG_N_RE.match, existing_stems) if m), default=0) + 1
    planned = []  # (name, data)
    taken = set(existing)
    skipped = []
    for filename, data in files:
        try:
            stem, ext = _split_upload_name(filename)
        except ProjectError as e:
            skipped.append({"name": filename, "reason": str(e)})
            continue
        if not _STEM_RE.match(stem):
            stem = f"fig{next_no}"
        m = _FIG_N_RE.match(stem)
        if m:
            next_no = max(next_no, int(m.group(1)) + 1)
        name = stem + ext
        if name in taken:
            skipped.append({"name": filename, "reason": f"figs/{name} 已存在"})
            continue
        try:
            _check_decodable(os.path.basename(filename or name), data)
        except ProjectError as e:
            skipped.append({"name": filename, "reason": str(e)})
            continue
        taken.add(name)
        planned.append((name, data))
    for name, data in planned:
        atomic.write_bytes(os.path.join(p.figs_dir, name), data)
    new_stems = {}
    for name, _d in planned:
        stem = os.path.splitext(name)[0]
        if stem not in existing_stems:
            new_stems.setdefault(stem, []).append(name)
    out = list_figures(store, pid)
    if new_stems:
        captions = figures_md.captions_of(store.read_content(pid))
        listed = _listed(doc)
        for names in new_stems.values():
            _append_spec(store, pid, doc, _main_of(names, listed), DEFAULT_WIDTH, captions)
        out = _save(store, pid, doc)
    out["skipped"] = skipped
    return out


# ---------------- 排序 / 宽度 / 摘要图 ----------------


def replace_figure_image(store, pid, name, files):
    """整组替换某 stem 下的图片文件（被「图N」引用也可换——引用按编号、spec 按文件名）。
    files = [(filename, bytes)]：所有文件 stem 须 == name 的 stem（前端把所选文件改名回本组 stem 再发）。
    新组主文件由 _main_of 决定；主文件名变化时同步 spec/abstract.file（「图N」引用不受影响）。
    任一校验失败整组不写；旧组中未再上传的文件删除。"""
    p = store.get(pid)
    _main_file(store, p, name)
    stem = os.path.splitext(name)[0]
    existing = store.list_figs(p.dir)
    old_group = [f for f in existing if os.path.splitext(f)[0] == stem]
    others = set(existing) - set(old_group)
    planned = []
    for filename, data in files:
        s2, ext = _split_upload_name(filename)
        if s2 != stem:
            raise FiguresError(f"换图文件须与本图同组（{stem}.*）", f"{filename}")
        nn = s2 + ext
        if nn in others or any(n == nn for n, _ in planned):
            raise FiguresError(f"figs/{nn} 与其它图重名", nn)
        _check_decodable(os.path.basename(filename or nn), data)
        planned.append((nn, data))
    if not planned:
        raise FiguresError("未收到图片文件", None)
    doc = store.load_figures(p.dir)
    new_names = [n for n, _ in planned]
    main_new = _main_of(new_names, _listed(doc))
    if main_new is None:
        raise FiguresError("新图组须包含可编入图片（png/jpg/tiff/emf 等）", "、".join(new_names))
    for nn, data in planned:
        atomic.write_bytes(os.path.join(p.figs_dir, nn), data)
    for f in old_group:
        if f not in new_names:
            os.remove(os.path.join(p.figs_dir, f))
    abstract_deleted = doc.abstract and doc.abstract.file in old_group and doc.abstract.file not in new_names
    if main_new != name or abstract_deleted:
        for f_ in doc.spec:
            if f_.file == name:
                f_.file = main_new
        if abstract_deleted:
            doc.abstract.file = main_new  # 摘要图指向被删的旧组文件（含主文件改名）→ 回落新主文件
        return _save(store, pid, doc)
    return list_figures(store, pid)


def reorder_figures(store, pid, order):
    p = store.get(pid)
    doc = store.load_figures(p.dir)
    current = [f.file for f in doc.spec]
    if sorted(order) != sorted(current):
        missing = [f for f in current if f not in order]
        extra = [f for f in order if f not in current]
        dups = sorted({f for f in order if order.count(f) > 1})
        parts = (
            ([f"缺 {'、'.join(missing)}"] if missing else [])
            + ([f"多出 {'、'.join(extra)}"] if extra else [])
            + ([f"重复 {'、'.join(dups)}"] if dups else [])
        )
        raise FiguresError("order 必须是当前全部附图的排列", "；".join(parts) or None)
    by_file = {f.file: f for f in doc.spec}
    doc.spec = [by_file[f] for f in order]  # 宽度 / alt 随文件走
    return _save(store, pid, doc)


_MARK_NUM_RE = re.compile(r"^\d{3,4}$")


def update_figure(store, pid, name, width=None, abstract=None, abstract_width=None, marks=None):
    p = store.get(pid)
    _main_file(store, p, name)
    for v in (width, abstract_width):
        if v is not None and (v <= 0 or v > MAX_WIDTH_CM):
            raise FiguresError(f"宽度须在 0–{MAX_WIDTH_CM} 厘米之间（A4 版心上限）", f"{name}: {v}")
    doc = store.load_figures(p.dir)
    if width is not None:
        for fig in doc.spec:
            if fig.file == name:
                fig.width = float(width)
                break
        else:
            _append_spec(store, pid, doc, name, width)
    if marks is not None:
        target = next((f for f in doc.spec if f.file == name), None)
        if target is None:
            raise FiguresError("标号表只对已编入说明书附图节的图有效", name)
        cleaned = {}
        for num, label in marks.items():
            num_s, name_s = str(num).strip(), str(label).strip()
            if not _MARK_NUM_RE.match(num_s):
                raise FiguresError(f"附图标记号须为 3–4 位数字：{num_s or '(空)'}", name)
            if not name_s:
                raise FiguresError(f"附图标记 {num_s} 缺名称", name)
            cleaned[num_s] = name_s
        target.marks = cleaned
    cur = doc.abstract
    is_abstract = bool(cur) and cur.file == name
    if abstract is True:
        if is_abstract:
            if abstract_width is not None:
                cur.width = float(abstract_width)
        else:
            w = abstract_width if abstract_width is not None else DEFAULT_ABSTRACT_WIDTH
            doc.abstract = figures_md.Figure(file=name, width=float(w))
    elif abstract is False and is_abstract:
        doc.abstract = _default_abstract(store, p)
    elif abstract_width is not None and is_abstract:
        cur.width = float(abstract_width)
    return _save(store, pid, doc)


# ---------------- 删除守卫 ----------------


def _refs_to(store, pid, settings, num):
    """「图num」的引用行（preflight.scan_refs，05-r2 §3.4）；AST 不成立时退化为逐行正则。"""
    content = store.read_content(pid)
    try:
        refs = scan_refs(parse_ast(content, settings))
    except AstError:
        refs = [
            {"book": None, "line": i, "num": int(m.group(1)), "text": ln}
            for i, ln in enumerate(content.split("\n"), 1)
            for m in _REF_RE.finditer(ln)
        ]
    return [{"book": r["book"], "line": r["line"], "text": r["text"]} for r in refs if r["num"] == num]


def _inline_refs_to(store, pid, name):
    """W18 说明书内嵌图引用（独立行 ![alt](figs/<file>)）：按 stem 同组命中——删除会一并清同组文件。"""
    stem = os.path.splitext(name)[0]
    refs = []
    for i, ln in enumerate(store.read_content(pid).split("\n"), 1):
        s = ln.strip()
        m = INLINE_FIG_RE.match(s)
        if m and os.path.splitext(m.group("file"))[0] == stem:
            refs.append({"book": "description", "line": i, "text": s})
    return refs


def delete_figure(store, pid, name):
    p = store.get(pid)
    _main_file(store, p, name)
    doc = store.load_figures(p.dir)
    num = doc.num_of(name)
    if num is not None:
        refs = _refs_to(store, pid, p.settings, num)
        if refs:
            raise FigureReferencedError(num, refs)
    inline_refs = _inline_refs_to(store, pid, name)
    if inline_refs:
        raise FigureReferencedError(None, inline_refs, label=f"内嵌图 {name}")
    stem = os.path.splitext(name)[0]
    for f in store.list_figs(p.dir):
        if os.path.splitext(f)[0] == stem:
            os.remove(os.path.join(p.figs_dir, f))
    doc.spec = [f for f in doc.spec if f.file != name]
    if doc.abstract and doc.abstract.file == name:
        doc.abstract = _default_abstract(store, p)
    return _save(store, pid, doc)


# ---------------- 导出 ----------------


def export_zip(store, pid):
    """说明书节顺序的主文件 + 摘要图（若不在其中）；不含伴生。返回 zip 字节。"""
    p = store.get(pid)
    doc = store.load_figures(p.dir)
    names = [f.file for f in doc.spec]
    if doc.abstract and doc.abstract.file not in names:
        names.append(doc.abstract.file)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            path = os.path.join(p.figs_dir, n)
            if os.path.isfile(path):
                z.write(path, n)
    return buf.getvalue()


# ---------------- 绘制图源（figs-src/*.mmd，W16） ----------------

FIGSRC_EXT = ".mmd"
FIGSRC_SPEC_EXT = ".spec"  # 分层框图 JSON 图源（figspec.py 确定性渲染）
FIGSRC_MAX_BYTES = 256 * 1024
_FIGSRC_TEXT_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}\.(mmd|spec)$")
_FIGSRC_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}\.(mmd|spec|png|jpe?g|tiff?|bmp|webp)$", re.I)


def _figsrc_path(project, name):
    """{name} 必须是 <stem>.<mmd|spec>；stem 与附图同字符集，返回 figs-src/ 下绝对路径。"""
    if not _FIGSRC_TEXT_RE.match(name or ""):
        raise ProjectError("图源名须为 <名称>.<mmd|spec>（字母/数字/_/-，≤64 字符）", 400)
    return os.path.join(project.figsrc_dir, name)


def _figsrc_any_path(project, name):
    """figs-src 任意图源名（.mmd 或图片）校验，返回绝对路径。"""
    if not _FIGSRC_NAME_RE.match(name or ""):
        raise ProjectError("图源名须为 <名称>.<mmd|png|jpg|jpeg|tif|tiff|bmp|webp>（字母/数字/_/-，≤64 字符）", 400)
    return os.path.join(project.figsrc_dir, name)


def _figsrc_files(project):
    d = project.figsrc_dir
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if _FIGSRC_NAME_RE.match(f))


def list_figure_sources(store, pid):
    """{sources: [{name, size}]}——figs-src/ 下全部图源（.mmd 与图片）。"""
    p = store.get(pid)
    return {"sources": [{"name": f, "size": os.path.getsize(os.path.join(p.figsrc_dir, f))} for f in _figsrc_files(p)]}


def get_figure_source(store, pid, name):
    p = store.get(pid)
    path = _figsrc_path(p, name)
    if not os.path.isfile(path):
        raise ProjectError(f"图源不存在：{name}", 404)
    with open(path, encoding="utf-8") as f:
        return {"name": name, "source": f.read()}


def save_figure_image_source(store, pid, name, data: bytes):
    """写 figs-src/<name> 图片源（原子写）——上传通道收二进制，与 .mmd 文本源同级。"""
    p = store.get(pid)
    path = _figsrc_any_path(p, name)
    if name.lower().endswith(FIGSRC_EXT):
        raise ProjectError(".mmd 图源走文本写入接口", 400)
    if not data:
        raise ProjectError("图源内容为空", 400)
    os.makedirs(p.figsrc_dir, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return {"name": name, "size": os.path.getsize(path)}


def put_figure_source(store, pid, name, source):
    """写 figs-src/<name>（原子写；首次建目录）。source 非空、≤256KB。"""
    p = store.get(pid)
    path = _figsrc_path(p, name)
    if not isinstance(source, str) or not source.strip():
        raise ProjectError("图源内容为空", 400)
    if len(source.encode("utf-8")) > FIGSRC_MAX_BYTES:
        raise ProjectError(f"图源超过 {FIGSRC_MAX_BYTES // 1024}KB 上限", 413)
    atomic.write_text(path, source)
    out = {"name": name, "size": os.path.getsize(path)}
    low = name.lower()
    if low.endswith(FIGSRC_EXT):
        from patent_studio.kernel import mmd_render

        g = mmd_render.parse_mmd(source)
        out["lint"] = mmd_render.validate_graph(g)
        out["readback"] = mmd_render.describe_graph(g)
    elif low.endswith(FIGSRC_SPEC_EXT):
        from patent_studio.kernel import figspec

        err = figspec.validate_figspec(source)
        out["lint"] = [{"level": "warn", "code": "spec_invalid", "detail": err}] if err else []
        out["readback"] = "figspec 分层框图" if not err else f"无效：{err}"
    return out


def preview_figure_source(store, pid, source):
    """图源文本 → 预览 PNG 字节（不落盘）——画板 .spec/.mmd 实时预览通道。
    { 开头走 figspec 分层渲染，其余走 mmd_render；渲染失败 → ProjectError。"""
    store.get(pid)  # 案子存在性/权限与其他图源接口一致
    src = (source or "").strip()
    if not src:
        raise ProjectError("图源内容为空", 400)
    try:
        if src.startswith("{"):
            from patent_studio.kernel import figspec

            img = figspec.render_figspec(src)
        else:
            from patent_studio.kernel import mmd_render

            img = mmd_render.render_mmd(src)
    except Exception as e:
        raise ProjectError(f"图源渲染失败：{e}", 422)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def mmd_to_spec_source(store, pid, source):
    """mmd 图源文本 → figspec JSON 字符串——画板「转 .spec 画布」通道。
    subgraph→band / rank→层 / -.->→dashed / diamond 判据全携带。"""
    store.get(pid)
    src = (source or "").strip()
    if not src:
        raise ProjectError("图源内容为空", 400)
    try:
        from patent_studio.kernel import figspec

        spec = figspec.mmd_to_spec(src)
    except Exception as e:
        raise ProjectError(f"mmd 转 spec 失败：{e}", 422)
    import json as _json

    return _json.dumps(spec, ensure_ascii=False, indent=2)


def delete_figure_source(store, pid, name):
    p = store.get(pid)
    path = _figsrc_any_path(p, name)
    if not os.path.isfile(path):
        raise ProjectError(f"图源不存在：{name}", 404)
    os.remove(path)
    return {"deleted": name}


def _derived_png_fresh(tgt, src, src_name=""):
    """派生 PNG 是否仍新鲜：源码未更新且内嵌渲染器版本一致——渲染器升级不失效会
    静默沿用旧图（mtime 判定够不到代码变化）。版本印记按图源类型取（.spec 走
    figspec_version，其余走 mmd_render_version）。"""
    if not (os.path.isfile(tgt) and os.path.getmtime(tgt) >= os.path.getmtime(src)):
        return False
    try:
        from PIL import Image

        if src_name.lower().endswith(FIGSRC_SPEC_EXT):
            from patent_studio.kernel import figspec

            tag, want = "figspec_version", figspec.RENDER_VERSION
        else:
            from patent_studio.kernel import mmd_render

            tag, want = "mmd_render_version", mmd_render.RENDER_VERSION
        with Image.open(tgt) as im:
            return im.info.get(tag) == want
    except Exception:  # noqa: BLE001 - 读不出按失新重渲
        return False


# ---------------- 图源自动晋级（figs-src/*.{mmd,图片} → figs/<stem>.png） ----------------


def _convert_figsrc_image(src, tgt):
    """图片图源 → 灰度 PNG：CNIPA 说明书附图不得彩色，抽出的论文数据图/结果照片
    统一降采样前转 L 模式（1/LA/RGB(A)/P 全归一）。带渲染版本印记沿用失新判定。"""
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo

    from patent_studio.kernel import mmd_render

    with Image.open(src) as im:
        gray = im.convert("L")
    meta = PngInfo()
    meta.add_text("mmd_render_version", mmd_render.RENDER_VERSION)
    tmp = tgt + ".tmp.png"
    gray.save(tmp, "PNG", pnginfo=meta)
    os.replace(tmp, tgt)


def _is_template_fig(path):
    """figs/fig1.png 是否仍是新案占位图（逐字节等于 write_template_fig 产物）。"""
    try:
        from app.domain.projects import write_template_fig

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
            tmp = t.name
        try:
            write_template_fig(tmp)
            with open(tmp, "rb") as f:
                want = f.read()
        finally:
            os.unlink(tmp)
        with open(path, "rb") as f:
            return f.read() == want
    except Exception:  # noqa: BLE001 - 比对失败按非占位处理（保守不误删）
        return False


_FIGSRC_NUM_RE = re.compile(r"^fig(\d+)[-_]", re.I)


def _figsrc_sort_key(name):
    """晋级序按图号数值排序——字母序会把 fig10 插到 fig2 前，收录索引错位。"""
    m = _FIGSRC_NUM_RE.match(name)
    return (0, int(m.group(1)), name) if m else (1, 0, name)


def _dedupe_figsrc(project, names):
    """figN-<slug>.mmd 同号多份图源（多轮 s1 各写不同 slug 变体）——按图号只留最新
    一份晋级，其余连同其派生 PNG/收录行清出附图节，避免 图6+ 无声明裸号。
    非 figN- 前缀的图源不参与归并。返回 (kept, losers)。"""
    groups = {}
    kept = []
    for name in names:
        m = _FIGSRC_NUM_RE.match(name)
        if m:
            groups.setdefault(int(m.group(1)), []).append(name)
        else:
            kept.append(name)
    losers = []
    for num in sorted(groups):
        files = groups[num]
        if len(files) == 1:
            kept.append(files[0])
            continue
        files.sort(key=lambda n: os.path.getmtime(os.path.join(project.figsrc_dir, n)), reverse=True)
        kept.append(files[0])
        losers.extend(files[1:])
        log.warning("figsrc 同号多源 fig%d：留最新 %s，跳过 %s", num, files[0], files[1:])
    return sorted(kept, key=_figsrc_sort_key), losers


def promote_figure_sources(store, pid):
    """figs-src/*.mmd → figs/<stem>.png + figures.md 收录。

    语义：源码是唯一真相，PNG 是派生物——图源缺失或比 PNG 新时重渲；渲染成功的图收进
    说明书附图节（占位图1 自动让位），摘要图为空/失效时补第一张。返回本次晋级文件名。
    渲染失败只跳过该图（图源语法不合法等），不中断构建。"""
    from patent_studio.kernel import mmd_render

    p = store.get(pid)
    names, losers = _dedupe_figsrc(p, _figsrc_files(p))
    if not names:
        return []
    os.makedirs(p.figs_dir, exist_ok=True)
    rendered = []
    for name in names:
        stem = os.path.splitext(name)[0]
        src = os.path.join(p.figsrc_dir, name)
        tgt = os.path.join(p.figs_dir, stem + ".png")
        try:
            if not _derived_png_fresh(tgt, src, name):
                low = name.lower()
                if low.endswith(FIGSRC_EXT):
                    with open(src, encoding="utf-8") as f:
                        mmd_src = f.read()
                    for hit in mmd_render.validate_graph(mmd_render.parse_mmd(mmd_src)):
                        if hit["level"] == "warn":
                            log.warning("figsrc %s lint %s: %s", name, hit["code"], hit["detail"])
                    mmd_render.render_to(mmd_src, tgt)
                elif low.endswith(FIGSRC_SPEC_EXT):
                    from patent_studio.kernel import figspec

                    figspec.render_spec_to(src, tgt)
                else:
                    _convert_figsrc_image(src, tgt)
            rendered.append(stem + ".png")
        except Exception as e:  # noqa: BLE001 - 单图失败不拖垮整案晋级/构建
            log.warning("promote figure %s failed: %s", name, e)
    if not rendered:
        return []

    doc = figures_md.read(p.dir) or figures_md.FiguresDoc()
    listed = _listed(doc)
    # 题注按接受后正文取——提案待审时 caps 只看无标记题注会数漏（unet-seg 实案）
    raw_content = store.read_content(pid) if os.path.isfile(os.path.join(p.dir, "content.md")) else ""
    caps = figures_md.captions_of(critic.accept(raw_content)) if raw_content else {}
    # 占位图让位：fig1.png 仍是种子占位且未被人为替换时移出说明书节
    placeholder = next(
        (f for f in doc.spec if f.file == "fig1.png" and _is_template_fig(os.path.join(p.figs_dir, f.file))), None
    )
    if placeholder is not None and any(n not in listed for n in rendered):
        doc.spec.remove(placeholder)
        listed.discard(placeholder.file)
    # 已失效的收录行让位（文件不在 figs/）
    doc.spec = [f for f in doc.spec if os.path.isfile(os.path.join(p.figs_dir, f.file))]
    # 同号落选图源的派生物/收录行一并清出——否则附图节仍带落选旧图
    if losers:
        loser_png = {os.path.splitext(n)[0] + ".png" for n in losers}
        doc.spec = [f for f in doc.spec if f.file not in loser_png]
        if doc.abstract and doc.abstract.file in loser_png:
            doc.abstract = None
        for fname in loser_png:
            try:
                os.unlink(os.path.join(p.figs_dir, fname))
            except OSError:
                pass
    listed = _listed(doc)
    # figN-<slug>.png 由图源名声明其图号位——占位 N 而非排到节尾（unet-seg 实案：
    # 5 张图源图被追加在论文抽图后成图6-9，与声明图号全错配）；同位既有条目
    # （convert 抽图/旧稿收录）让位退留 figs/ 作素材。非图号前缀的新图仍按序追加。
    claimed: dict[int, str] = {}
    for f in doc.spec:
        m = _FIGSRC_NUM_RE.match(f.file)
        if m:
            claimed[int(m.group(1))] = f.file
    appended: list[str] = []
    for fname in rendered:
        if fname in listed:
            continue
        m = _FIGSRC_NUM_RE.match(fname)
        if m:
            claimed[int(m.group(1))] = fname
        else:
            appended.append(fname)
    if claimed:
        by_file = {f.file: f for f in doc.spec}
        others = [f for f in doc.spec if f.file not in set(claimed.values())]
        rebuilt: list = []
        oi = 0
        for pos in range(1, max(claimed) + len(others) + 1):
            fname = claimed.get(pos)
            if fname is not None:
                old = by_file.get(fname)
                # alt 按新位重写——沿用旧 Figure 会把错位的旧图号带进新位（实案留图6-9标签在图1-5位）
                rebuilt.append(
                    figures_md.Figure(
                        file=fname,
                        width=(old.width if old is not None else DEFAULT_WIDTH),
                        alt=f"图{pos} {caps[pos]}" if caps.get(pos) else f"图{pos}",
                    )
                )
            elif oi < len(others):
                f = others[oi]
                oi += 1
                rebuilt.append(
                    figures_md.Figure(
                        file=f.file, width=f.width, alt=f"图{pos} {caps[pos]}" if caps.get(pos) else f"图{pos}"
                    )
                )
        doc.spec = rebuilt
    for fname in appended:
        idx = len(doc.spec) + 1
        doc.spec.append(
            figures_md.Figure(
                file=fname, width=DEFAULT_WIDTH, alt=f"图{idx} {caps[idx]}" if caps.get(idx) else f"图{idx}"
            )
        )
    # 正文声明图号即附图节上限——超出声明位的收录条目退回素材（多余抽图/旧稿残留）
    limit = max(max(caps, default=0), max(claimed, default=0))
    if limit:
        doc.spec = doc.spec[:limit]
    in_spec = {f.file for f in doc.spec}
    af_ok = (
        doc.abstract
        and doc.abstract.file in in_spec
        and os.path.isfile(os.path.join(p.figs_dir, doc.abstract.file))
        and not _is_template_fig(os.path.join(p.figs_dir, doc.abstract.file))
    )
    if not af_ok and doc.spec:
        doc.abstract = figures_md.Figure(file=doc.spec[0].file, width=DEFAULT_ABSTRACT_WIDTH)
    atomic.write_text(figures_md.path_of(p.dir), figures_md.serialize(doc))
    return rendered
