# -*- coding: utf-8 -*-
"""文本抽取（docs/plan/09 §3.3.2）：docx（python-docx，段落 + 表格逐行）/ pdf（pypdf 逐页）/ md / txt。

extract(filename, data) -> Extracted{text, pages, warnings, figures}
  - 20 MB 上限、pdf 200 页上限、正文 60 000 字上限（超出截断并记 warning）；
  - pdf 抽不出文字 ⇒ ExtractError("scanned_pdf")；不支持的扩展名 ⇒ ExtractError("unsupported_media")；
  - figures：docx / pdf 内嵌图片（png/jpg/gif/bmp/tiff/emf），按出现顺序 [(ext, bytes)]，供写入案卷 figs/。
"""
import glob
import io
import os
import posixpath
import re
import tempfile
from typing import TypedDict

import docx
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

SUPPORTED = ("docx", "pdf", "md", "txt")
MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 200
MAX_CHARS = 60_000
MAX_FIGURES = 20
FIG_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".emf")
# 抽图质量闸：长宽比超界（>8:1 条形碎片）、近空白图不入 figs/（往复轮105——YOLO fig2 7013×476 白粉条实案）
_FIG_MAX_ASPECT = 8.0
_FIG_MIN_INK = 0.005


def _flatten(blob: bytes):
    """位图解码 + alpha 白底合成：PDF 抽出的图常是 RGB 全黑、alpha 近全 0 的透明空壳
    （Transformer 实案 cv-fig2-5 四角圆框假象）——不合成直接测墨会把全黑透明图判成满墨。
    返回 PIL Image；解码失败返回 None。"""
    from PIL import Image
    try:
        with Image.open(io.BytesIO(blob)) as im:
            if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
                base = Image.new("RGBA", im.size, (255, 255, 255, 255))
                base.alpha_composite(im.convert("RGBA"))
                return base.convert("RGB")
            return im.convert("RGB")
    except Exception:
        return None


def _thumb(im) -> bytes | None:
    """归一化指纹图：白底合成 → 墨区 autocrop → 16x16 灰度 → bytes。
    供位图/墨带渲染去重：同图不同来源（内嵌位图 vs 页区渲染）指纹近似。"""
    from PIL import Image, ImageChops
    try:
        g = im.convert("L")
        bg = Image.new("L", g.size, 255)
        box = ImageChops.difference(g, bg).getbbox()
        if box:
            g = g.crop(box)
        return g.resize((16, 16)).tobytes()
    except Exception:
        return None


def _same_fig(a: bytes | None, b: bytes | None) -> bool:
    """两 16x16 指纹近似即同图——均差阈值 32/255（留边框/裁剪余量）。"""
    if a is None or b is None:
        return False
    diff = sum(abs(x - y) for x, y in zip(a, b)) / len(a)
    return diff < 32


def _to_gray(blob: bytes) -> bytes:
    """统一转灰度——CNIPA 附图禁彩色；矢量带渲图与位图同口径。"""
    from PIL import Image
    im = Image.open(io.BytesIO(blob))
    if im.mode == "L":
        return blob
    buf = io.BytesIO()
    im.convert("L").save(buf, "PNG")
    return buf.getvalue()


def _band_ink_ok(blob: bytes) -> bool:
    """题注墨带渲染质量闸：除位图闸外，要求墨行纵向覆盖 ≥25%——题注贴页眉/图在题注下方时
    带内只剩一行页眉文字（itransformer nf01/nf04 实案：页眉条带被当图收编）。"""
    im = _flatten(blob)
    if im is None:
        return False
    import numpy as _np
    a = _np.asarray(im.convert("L"))
    if a.size == 0:
        return False
    rows = (a < 200).any(axis=1).mean()
    return rows >= 0.25


def _figure_ok(blob: bytes) -> bool:
    """内嵌图质量闸：无法解码 → 丢；长宽比 >8:1 → 丢；白底合成后非白像素 <0.5% 近空白 → 丢。
    .emf 矢量图 PIL 解不了但可能是真图——放行（写 figs/ 后由人/构建侧判断）。"""
    im = _flatten(blob)
    if im is None:
        return blob.lstrip()[:4] == b"\x01\x00\x00\x00"  # emf 头放行
    w, h = im.size
    if not w or not h:
        return False
    if max(w, h) / min(w, h) > _FIG_MAX_ASPECT:
        return False
    gray = im.convert("L")
    hist = gray.histogram()
    dark = sum(hist[:200])
    return dark / (w * h) >= _FIG_MIN_INK


class Extracted(TypedDict):
    text: str
    pages: int
    warnings: list[str]
    figures: list[tuple[str, bytes]]
    # 与 figures 平行：每张图在原文的题注文本（PDF 题注通道有；位图/docx 无题为 None）。
    # 供生成端把「提取图序号 ↔ 论文 Figure N」对齐，附图说明不得脱离真实图面脑补。
    fig_captions: list[str | None]


class ExtractError(Exception):
    def __init__(self, kind: str, message: str, status: int):
        super().__init__(message)
        self.kind = kind
        self.status = status


def ext_of(filename: str) -> str:
    return posixpath.splitext(os.path.basename(filename or ""))[1].lstrip(".").lower()


def extract(filename: str, data: bytes) -> Extracted:
    ext = ext_of(filename)
    if ext not in SUPPORTED:
        raise ExtractError("unsupported_media", f"不支持的文件类型「.{ext or '?'}」，仅支持 docx / pdf / md / txt", 415)
    if len(data) > MAX_BYTES:
        raise ExtractError("too_large", f"文件超过 {MAX_BYTES // 1024 // 1024} MB", 413)
    warnings: list[str] = []
    figures: list[tuple[str, bytes]] = []
    fig_captions: list[str | None] = []
    pages = 0
    if ext == "docx":
        text, figures = _docx(data)
        fig_captions = [None] * len(figures)
    elif ext == "pdf":
        text, pages, figures, warnings, fig_captions = _pdf(data)
    else:
        text = data.decode("utf-8-sig", errors="replace")
    text = _clean(text)
    if len(text) > MAX_CHARS:
        warnings.append(f"正文 {len(text)} 字超过 {MAX_CHARS} 字上限，已截断")
        text = text[:MAX_CHARS]
    if len(figures) > MAX_FIGURES:
        warnings.append(f"内嵌图片 {len(figures)} 张，只保留前 {MAX_FIGURES} 张")
        figures = figures[:MAX_FIGURES]
        fig_captions = fig_captions[:MAX_FIGURES]
    return {"text": text, "pages": pages, "warnings": warnings, "figures": figures,
            "fig_captions": fig_captions}


def _clean(text: str) -> str:
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return "\n".join(out).strip()


def _docx(data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    try:
        d = docx.Document(io.BytesIO(data))
    except Exception as e:  # python-docx 对非 OOXML 抛 PackageNotFoundError / KeyError 等
        raise ExtractError("bad_file", f"无法读取 docx：{e}", 422)
    lines: list[str] = []
    body = d.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            lines.append(Paragraph(child, d).text)
        elif tag == "tbl":
            for row in Table(child, d).rows:
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                lines.append("| " + " | ".join(cells) + " |")
            lines.append("")
    figures: list[tuple[str, bytes]] = []
    for rel in d.part.rels.values():
        if rel.reltype != RT.IMAGE or rel.is_external:
            continue
        ext = posixpath.splitext(rel.target_part.partname)[1].lower()
        if ext in FIG_EXTS:
            figures.append((ext.lstrip("."), rel.target_part.blob))
    return "\n".join(lines), figures


def _pdf(data: bytes
         ) -> tuple[str, int, list[tuple[str, bytes]], list[str], list[str | None]]:
    try:
        reader = PdfReader(io.BytesIO(data))
        n = len(reader.pages)
    except Exception as e:
        raise ExtractError("bad_file", f"无法读取 pdf：{e}", 422)
    warnings: list[str] = []
    if n > MAX_PAGES:
        warnings.append(f"pdf 共 {n} 页，只抽取前 {MAX_PAGES} 页")
    texts: list[str] = []
    dropped = 0
    # 先按「Figure N:」题注墨带收编——图序=文档序，矢量/TikZ/透明壳位图全兜住；
    # 位图后对墨带指纹去重补位。反过来的旧序让散图位图（注意力热力图等）先占满
    # 配额，题注主图反而落选（itransformer 实案：图2-4 真图丢失只剩附录热力图）。
    figures, band_thumbs, vec_drop, academic, fig_captions = _pdf_vector_figures(
        data, MAX_FIGURES)
    if figures:
        warnings.append(f"按图题注渲染图形区 {len(figures)} 张")
    if vec_drop:
        warnings.append(f"剔除渲染劣图 {vec_drop} 张（过矮/近空白/长宽比超界）")
    if academic:
        warnings.append(f"剔除学术类图 {academic} 张（自我指称/分类对比），已降级素材不晋级附图")
    for page in reader.pages[:MAX_PAGES]:
        texts.append(page.extract_text() or "")
        if len(figures) >= MAX_FIGURES:
            continue
        try:
            imgs = list(page.images)
        except Exception:
            imgs = []
        for img in imgs:
            if len(figures) >= MAX_FIGURES:
                break
            ext = posixpath.splitext(img.name)[1].lower()
            if ext not in FIG_EXTS:
                continue
            if not _figure_ok(img.data):
                dropped += 1
                continue
            th = _thumb(_flatten(img.data))
            if any(_same_fig(th, t) for ts in band_thumbs.values() for t in ts):
                continue  # 该图已按题注墨带收编，位图不重复占位
            figures.append((ext.lstrip("."), img.data))
            fig_captions.append(None)
    if dropped:
        warnings.append(f"剔除劣化内嵌图片 {dropped} 张（条形碎片/近空白/无法解码）")
    text = "\n\n".join(texts)
    if len("".join(text.split())) < 20:
        raise ExtractError("scanned_pdf", "pdf 抽不出文字（扫描件或图片 pdf），请先 OCR 或提供 docx/文本", 422)
    return text, n, figures, warnings, fig_captions


_CAPTION_WORD = re.compile(r"^(?:Figure|Fig\.?)$")
_CAPTION_NUM = re.compile(r"^\d+[:：.]?$")
# 学术图禁入附图节：自我指称词（Ours/our method）与文献分类/性能对比类题注——
# 专利附图只收技术方案图，这类图降级为素材不晋级（itransformer 图5「(Ours)」实案）
_FIG_SELF_REF = re.compile(r"(?i)\bours?\b|我们(?:的)?方法|本文方法")
_FIG_ACADEMIC_CAP = re.compile(r"(?i)classification|taxonomy|benchmark")
_BBOX_PAGE = re.compile(r"<page[^>]*width=\"([\d.]+)\"[^>]*height=\"([\d.]+)\"")
_BBOX_WORD = re.compile(
    r"<word[^>]*xMin=\"([\d.]+)\"[^>]*yMin=\"([\d.]+)\"[^>]*"
    r"xMax=\"([\d.]+)\"[^>]*yMax=\"([\d.]+)\"[^>]*>([^<]*)</word>")
_CAPTION_MIN_H = 40.0   # 题注上方图形区最小高度（pt）——低于则不是独立图区
_RENDER_DPI = 200


def _words_per_page(data: bytes) -> list[tuple[float, float, list[tuple[float, float, float, float, str]]]]:
    """pdftotext -bbox-layout → [(page_w, page_h, [(x0,y0,x1,y1,word)…])…]——零新依赖取字框。"""
    import subprocess
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            pdf_path = f.name
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
            html_path = f.name
        subprocess.run(["pdftotext", "-bbox-layout", pdf_path, html_path],
                       check=True, capture_output=True, timeout=60)
        html = open(html_path, encoding="utf-8", errors="replace").read()
    except Exception:
        return []
    finally:
        for _p in (locals().get("pdf_path"), locals().get("html_path")):
            try:
                if _p:
                    os.unlink(_p)
            except OSError:
                pass
    pages: list[tuple[float, float, list[tuple[float, float, float, float, str]]]] = []
    for chunk in re.split(r"</page>", html):
        pm = _BBOX_PAGE.search(chunk)
        if not pm:
            continue
        import html as _html
        words = [(float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)),
                  _html.unescape(m.group(5)))
                 for m in _BBOX_WORD.finditer(chunk)]
        pages.append((float(pm.group(1)), float(pm.group(2)), words))
    return pages


def _page_png(pdf_path: str, page_no: int, dpi: int,
              clip_pts: tuple[float, float, float, float] | None = None) -> bytes | None:
    """pdftoppm 渲染单页（可选按点坐标裁剪）——poppler 已在部署依赖（Dockerfile L36）。"""
    import subprocess
    for old in glob.glob("/tmp/_vec_fig-*.png"):
        try:
            os.unlink(old)
        except OSError:
            pass
    args = ["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-png", "-r", str(dpi)]
    if clip_pts:
        x0, y0, x1, y1 = clip_pts
        scale = dpi / 72.0
        args += ["-x", str(int(x0 * scale)), "-y", str(int(y0 * scale)),
                 "-W", str(max(1, int((x1 - x0) * scale))), "-H", str(max(1, int((y1 - y0) * scale)))]
    args += [pdf_path, "/tmp/_vec_fig"]
    try:
        subprocess.run(args, check=True, capture_output=True, timeout=60)
        for cand in sorted(glob.glob("/tmp/_vec_fig-*.png"), key=os.path.getmtime):
            with open(cand, "rb") as f:
                blob = f.read()
            os.unlink(cand)
            return blob
    except Exception:
        return None
    return None


_SCAN_DPI = 100   # 墨带探测页渲染分辨率——低 dpi 够用且快
_GAP_MAX = 6      # 行内允许的最大空白行（px@100dpi ≈ 4pt）——正文行间隙 ~5px 不断带，段距/图文间隔断开


def _ink_band_above(png: bytes, y_px: int) -> tuple[int, int, int, int] | None:
    """在页渲染图上自 y_px 向上找图区「连续墨带」：
    先向上跨过题注自身的墨带与其上空白（图-注间距），再量紧邻的图形墨带；
    带内允许 _GAP_MAX 空白行缝合图内稀疏线。返回 (x_min, top, x_max, bottom)。"""
    from PIL import Image
    try:
        with Image.open(io.BytesIO(png)) as im:
            gray = im.convert("L")
            w, h = gray.size
            if y_px <= 0 or y_px > h:
                return None
            px = gray.load()
            # 阶段一：自题注行内向上，跨过题注墨带 + 其上一个 >_GAP_MAX 的空白段，记 fig_bot
            fig_bot = None
            gap = 0
            seen_ink = False
            for y in range(min(y_px + 8, h - 1), -1, -1):
                ink = any(px[x, y] < 200 for x in range(0, w, 3))
                if ink:
                    seen_ink = True
                    gap = 0
                else:
                    if not seen_ink:
                        continue
                    gap += 1
                    if gap > _GAP_MAX:
                        fig_bot = y + gap  # 空白段前最后的墨行 = 题注带顶
                        break
            if fig_bot is None:
                return None
            # 阶段二：fig_bot 之上的墨带即图形区——图-注之间可能隔着子图标号/
            # 图内标题等第二条墨带（patchtst 实案：紧邻带高 37px 只是子标注行），
            # 逐带向上找，取首个高度达标且非正文段的带；跨过 >300px 空白即放弃。
            min_h = _CAPTION_MIN_H * _SCAN_DPI / 72
            y_scan = fig_bot - 1
            while y_scan > 0:
                band_top = None
                gap = 0
                x_lo, x_hi = w, 0
                bottom = y_scan + 1
                for y in range(y_scan, -1, -1):
                    xs = [x for x in range(0, w, 3) if px[x, y] < 200]
                    if xs:
                        gap = 0
                        band_top = y
                        x_lo, x_hi = min(x_lo, min(xs)), max(x_hi, max(xs))
                    else:
                        if band_top is None:
                            continue
                        gap += 1
                        if gap > _GAP_MAX:
                            break
                if band_top is None:
                    return None
                if (bottom - band_top) >= min_h:
                    # 正文段闸门：≥5 个「正文条纹」（连续 ≥8px 高、x 覆盖 ≥65%
                    # 带宽的致密行簇）即段落文字非图形——表格横线/坐标轴细线高
                    # <8px 不计；用于图被裁到别页、题注紧随正文时带上来的前文段落
                    stripes = 0
                    run = 0
                    for y in range(band_top, bottom):
                        xs = [x for x in range(0, w, 3) if px[x, y] < 200]
                        if xs and max(xs) - min(xs) >= (x_hi - x_lo) * 0.65:
                            run += 1
                        else:
                            if run >= 8:
                                stripes += 1
                            run = 0
                    if run >= 8:
                        stripes += 1
                    if stripes < 5:
                        return x_lo, band_top, x_hi, bottom
                # 此带不合格，越过其上方空白继续找上一带
                y_scan = band_top - 1
                gap = 0
                while y_scan > 0 and not any(px[x, y_scan] < 200 for x in range(0, w, 3)):
                    gap += 1
                    if gap > 300:
                        return None
                    y_scan -= 1
            return None
    except Exception:
        return None


_FIG_CAP_RE = re.compile(r"^\s*(?:Figure|Fig\.?)\s*(\d+)(?:[\.:：]|\s|$)")


class _Rect:
    """pdfplumber bbox 的最小并集包装（替代原 pymupdf.Rect；pdfplumber 与 MuPDF
    同为左上原点坐标系，x0/x1 横向、top/bottom 记为 y0/y1）。"""

    __slots__ = ("x0", "y0", "x1", "y1")

    def __init__(self, x0: float, y0: float, x1: float, y1: float):
        self.x0, self.y0, self.x1, self.y1 = (float(v) for v in (x0, y0, x1, y1))

    def __ior__(self, other: "_Rect") -> "_Rect":
        self.x0 = min(self.x0, other.x0)
        self.y0 = min(self.y0, other.y0)
        self.x1 = max(self.x1, other.x1)
        self.y1 = max(self.y1, other.y1)
        return self

    def get_area(self) -> float:
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)


def _crop_png(page, region: "_Rect", dpi: int) -> bytes:
    box = (region.x0, region.y0, region.x1, region.y1)
    im = page.crop(box).to_image(resolution=dpi).original.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _pdf_vector_figures(data: bytes, cap: int
                        ) -> tuple[list[tuple[str, bytes]], dict[int, list[bytes]],
                                   int, int, list[str | None]]:
    """按「Figure N:」题注定位，pdfplumber 矢量绘制/位图元素同栏聚类裁剪——图序=文档序。
    返回 (figures, 每页指纹, dropped, academic, 各图题注)。取代原 pdftoppm 墨带扫描：
    不再靠像素猜图区（正文墨带误抓/lora 图1 离散笔画漏抓实证），直接读图形元素坐标。"""
    import pdfplumber
    if cap <= 0:
        return [], {}, 0, 0, []
    try:
        doc = pdfplumber.open(io.BytesIO(data))
    except Exception:
        return [], {}, 0, 0, []
    out: list[tuple[str, bytes]] = []
    out_caps: list[str | None] = []
    thumbs: dict[int, list[bytes]] = {}
    dropped = 0
    academic = 0
    seen: set[tuple[int, int, int]] = set()
    with doc:
        for pi, page in enumerate(doc.pages):
            if pi >= MAX_PAGES or len(out) >= cap:
                break
            pw = page.width
            lines: list[tuple[object, str]] = []
            for ln in page.extract_text_lines():
                t = ln.get("text", "").strip()
                if t:
                    box = _Rect(ln["x0"], ln["top"], ln["x1"], ln["bottom"])
                    lines.append((box, t))
            ink = [_Rect(o["x0"], o["top"], o["x1"], o["bottom"])
                   for o in page.rects + page.lines + page.curves]
            ink += [_Rect(im["x0"], im["top"], im["x1"], im["bottom"])
                    for im in page.images]
            for r, m in [(rr, _FIG_CAP_RE.match(tt)) for rr, tt in lines]:
                if not m or len(out) >= cap:
                    continue
                col_mid = (r.x0 + r.x1) / 2
                above = sorted([x for x in ink
                                if abs((x.x0 + x.x1) / 2 - col_mid) < pw / 3
                                and x.y1 <= r.y0 + 2 and (r.y0 - x.y1) < 400],
                               key=lambda x: x.y1, reverse=True)
                # 自题注向上聚类：水平相邻(±30pt)且与区域顶边垂直间隙 ≤60pt 才并入
                region = None
                for x in above:
                    if region is None:
                        region = _Rect(x.x0, x.y0, x.x1, x.y1)
                        continue
                    if x.x1 < region.x0 - 30 or x.x0 > region.x1 + 30:
                        continue
                    if x.y1 <= region.y0 and region.y0 - x.y1 > 60:
                        break
                    region |= x
                if region is None or region.get_area() < 900:
                    continue
                key = (pi, int(region.y0) // 20, int(region.y1) // 20)
                if key in seen:
                    continue
                seen.add(key)
                region.y0 = max(0, region.y0 - 3)
                region.x0 = max(0, region.x0 - 3)
                region.y1 = min(page.height, region.y1 + 3)
                region.x1 = min(pw, region.x1 + 3)
                blob = _crop_png(page, region, _RENDER_DPI)
                if not blob or not _figure_ok(blob) or not _band_ink_ok(blob):
                    dropped += 1
                    continue
                cap_line = " ".join(t for rr, t in lines if abs(rr.y0 - r.y0) <= 4)
                band_words = " ".join(t for rr, t in lines
                                      if region.y0 - 6 <= (rr.y0 + rr.y1) / 2 <= region.y1 + 6)
                if _FIG_SELF_REF.search(band_words) or _FIG_ACADEMIC_CAP.search(cap_line):
                    academic += 1
                    continue
                blob = _to_gray(blob)
                th = _thumb(_flatten(blob))
                if th:
                    thumbs.setdefault(pi, []).append(th)
                out.append(("png", blob))
                out_caps.append(cap_line.strip() or None)
    return out, thumbs, dropped, academic, out_caps


def _pdf_vector_figures_legacy(data: bytes, cap: int
                               ) -> tuple[list[tuple[str, bytes]], dict[int, list[bytes]],
                                          int, int, list[str | None]]:
    """按「Figure N:」题注定位，pdftoppm 渲染题注上方墨带为 png——图序=文档序。
    返回 (figures, 每页墨带指纹, dropped, academic, 各图题注)；指纹供位图通道去重，
    题注供生成端对齐「提取图序号↔论文图号」。无题注论文则全空，
    位图通道照常收编（mamba 实案论文图全 TikZ，pypdf 位图通道 0 产出全靠本函数）。"""
    if cap <= 0:
        return [], {}, 0, 0, []
    pages = _words_per_page(data)
    if not pages:
        return [], {}, 0, 0, []
    out: list[tuple[str, bytes]] = []
    out_caps: list[str | None] = []
    thumbs: dict[int, list[bytes]] = {}
    dropped = 0
    academic = 0
    seen_bands: set[tuple[int, int, int]] = set()
    pdf_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            pdf_path = f.name
        for pi, (_pw, _ph, words) in enumerate(pages[:MAX_PAGES]):
            if len(out) >= cap:
                break
            png = _page_png(pdf_path, pi + 1, _SCAN_DPI)
            if not png:
                continue
            scale = _SCAN_DPI / 72.0
            # 题注行：「Figure|Fig.」后随编号词的同一行（y 中位相近）
            for i, (_x0, y0, x1, y1, w) in enumerate(words):
                if len(out) >= cap:
                    break
                if not _CAPTION_WORD.match(w):
                    continue
                nxt = words[i + 1] if i + 1 < len(words) else None
                if (not nxt or not _CAPTION_NUM.match(nxt[4])
                        or abs((nxt[1] + nxt[3]) - (y0 + y1)) > 4 or nxt[0] - x1 > 8):
                    continue
                # 「Figure」必须是该行行首词——正文行内引用「…as shown in Figure 1.」
                # 不是题注，抓它会把上面的正文段落/公式墨带当图收编（patchtst/lora 实案）。
                line_x0 = min(xa for (xa, la, _b, lb, _w) in words
                              if abs((la + lb) - (y0 + y1)) <= 4)
                if _x0 - line_x0 > 2:
                    continue
                band = _ink_band_above(png, int(y0 * scale))
                if not band:
                    continue
                bx_lo, top_px, bx_hi, bot_px = band
                key = (pi, top_px // 10, bot_px // 10)
                if key in seen_bands:
                    continue
                seen_bands.add(key)
                clip = (max(0.0, bx_lo / scale - 4), top_px / scale,
                        min(_pw, bx_hi / scale + 4), bot_px / scale)
                blob = _page_png(pdf_path, pi + 1, _RENDER_DPI, clip)
                if not blob:
                    continue
                if not _figure_ok(blob) or not _band_ink_ok(blob):
                    dropped += 1
                    continue
                band_words = " ".join(
                    ww for (_a, by0, _b, by1, ww) in words
                    if top_px / scale - 6 <= (by0 + by1) / 2 <= bot_px / scale + 6)
                cap_line = " ".join(
                    ww for (_a, cy0, _b, cy1, ww) in words
                    if abs((cy0 + cy1) - (y0 + y1)) <= 4)
                if _FIG_SELF_REF.search(band_words) or _FIG_ACADEMIC_CAP.search(cap_line):
                    academic += 1
                    continue
                blob = _to_gray(blob)
                th = _thumb(_flatten(blob))
                if th:
                    thumbs.setdefault(pi, []).append(th)
                out.append(("png", blob))
                out_caps.append(cap_line.strip() or None)
    finally:
        try:
            if pdf_path:
                os.unlink(pdf_path)
        except OSError:
            pass
    return out, thumbs, dropped, academic, out_caps
