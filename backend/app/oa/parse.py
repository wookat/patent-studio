# -*- coding: utf-8 -*-
"""审查意见通知书拆条（docs/plan/09 §3.4、21 §2.1 R-OA-01，确定性，不需 AI）。

parse(text) -> (items, warnings)
  条目起点（行首）三种写法，按优先级取一种：「1.」「2.」（阿拉伯数字 + . 、．）> 「关于权利要求N」标题
  > 「一、」「（一）」中文序号。
  一种都没命中 ⇒ 全文一条 + warning。
  每条：id="oa-N"、claims（条内出现的「权利要求 1-3、5」展开）、refs（「对比文件 1、2」展开）、
  kind（关键词判定）、confidence（规则命中数归一 0–1）、text。
  第一条之前的抬头（申请号、发文日等）丢弃，不进条目。

pdf_text(data) -> str
  pypdf 抽文字层（21 §1.3 A7：只支持文字层 PDF，OCR 推后）；无文字层或有效字数 < MIN_TEXT_CHARS ⇒ NoTextLayer。
"""

import io
import re
from typing import TypedDict

from pypdf import PdfReader
from pypdf.errors import PdfReadError

OaKind = str  # novelty | inventiveness | support | clarity | formal | other
MIN_TEXT_CHARS = 50


class OaItem(TypedDict):
    id: str
    claims: list[int]
    refs: list[int]
    kind: OaKind
    confidence: float
    text: str


class NoTextLayer(Exception):
    """PDF 无文字层（扫描件）或文字层太短，不能拆条。"""


_ARABIC = re.compile(r"^\s*(\d{1,2})\s*[.、．]\s*(?!\d)")
_ABOUT = re.compile(r"^\s*(?:[（(]?[一二三四五六七八九十\d]+[）)、.．]\s*)?关于(?:权利要求|说明书|摘要|附图)")
_CN = re.compile(r"^\s*(?:[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+、)")
_NUM_SPAN = r"(\d[\d\s,，、和及至\-–~—到]*\d|\d)"
_CLAIM_REF = re.compile(r"权利要求\s*" + _NUM_SPAN)
_DOC_REF = re.compile(r"对比文件\s*" + _NUM_SPAN)
_RANGE = re.compile(r"(\d+)\s*[\-–~—至到]\s*(\d+)")
_KINDS: tuple[tuple[OaKind, tuple[str, ...]], ...] = (
    ("novelty", ("新颖性", "第22条第2款", "22.2")),
    ("inventiveness", ("创造性", "第22条第3款", "22.3", "显而易见", "容易想到")),
    ("clarity", ("不清楚", "引用基础", "含义不明确", "不明确")),
    ("support", ("支持", "第26条第4款", "26.4", "公开不充分", "第26条第3款", "26.3")),
    ("formal", ("形式", "细则", "第17条", "第19条", "第20条", "第21条", "缺少必要技术特征", "摘要", "附图")),
)
# 新颖性 / 创造性评述必然引用对比文件；其余类型不要求
_KINDS_WITH_REFS = frozenset({"novelty", "inventiveness"})


def _numbers(pattern: re.Pattern, text: str) -> list[int]:
    nums: set[int] = set()
    for m in pattern.finditer(text):
        span = m.group(1)
        for a, b in _RANGE.findall(span):
            a, b = int(a), int(b)
            if a <= b <= a + 100:
                nums.update(range(a, b + 1))
        for n in re.findall(r"\d+", _RANGE.sub("", span)):
            nums.add(int(n))
    return sorted(n for n in nums if 0 < n < 1000)


def _claims_in(text: str) -> list[int]:
    return _numbers(_CLAIM_REF, text)


def _refs_in(text: str) -> list[int]:
    return _numbers(_DOC_REF, text)


def _kind(text: str) -> OaKind:
    for kind, keys in _KINDS:
        if any(k in text for k in keys):
            return kind
    return "other"


def _confidence(*, numbered: bool, claims: list[int], refs: list[int], kind: OaKind) -> float:
    """规则命中数 / 适用规则数：条目编号命中、涉及权项、类型判定、（新颖性/创造性）对比文件。"""
    hits = [numbered, bool(claims), kind != "other"]
    if kind in _KINDS_WITH_REFS:
        hits.append(bool(refs))
    return round(sum(hits) / len(hits), 2)


def _starts(lines: list[str]) -> list[int]:
    for pat in (_ARABIC, _ABOUT, _CN):
        hits = [i for i, ln in enumerate(lines) if pat.match(ln)]
        if pat is _ARABIC:
            hits = _sequential(hits, lines)
        if hits:
            return hits
    return []


def _sequential(hits: list[int], lines: list[str]) -> list[int]:
    """阿拉伯序号只认从 1 起递增的那一串（避免正文里「2. 」式列举被当条目；断号处停止）。"""
    out: list[int] = []
    for i in hits:
        n = int(_ARABIC.match(lines[i]).group(1))
        if n == len(out) + 1:
            out.append(i)
    return out


def parse(text: str) -> tuple[list[OaItem], list[str]]:
    lines = [ln.rstrip() for ln in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    body = "\n".join(lines).strip()
    if not body:
        return [], ["通知书文本为空"]
    starts = _starts(lines)
    warnings: list[str] = []
    if not starts:
        warnings.append("未识别到「1.」「2.」或「关于权利要求」式的条目编号，整篇作为一条")
        chunks = [body]
    else:
        chunks = ["\n".join(lines[a:b]).strip() for a, b in zip(starts, starts[1:] + [len(lines)])]
    items: list[OaItem] = []
    for k, chunk in enumerate(chunks, 1):
        claims, refs, kind = _claims_in(chunk), _refs_in(chunk), _kind(chunk)
        items.append(
            {
                "id": f"oa-{k}",
                "claims": claims,
                "refs": refs,
                "kind": kind,
                "confidence": _confidence(numbered=bool(starts), claims=claims, refs=refs, kind=kind),
                "text": chunk,
            }
        )
    return items, warnings


def _ocr_text(data: bytes) -> str:
    """扫描件兜底：pypdfium2 逐页栅格化 → RapidOCR(PP-OCRv4 ONNX) 识别。
    依赖缺失（未装 OCR 可选链）或识别失败返回 ""，由调用方回落 NoTextLayer。"""
    try:
        import numpy as np
        import pypdfium2 as pdfium
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return ""
    try:
        pdf = pdfium.PdfDocument(data)
        ocr = RapidOCR()
        out = []
        for page in pdf:
            bitmap = page.render(scale=2.0)  # ~144dpi
            arr = np.array(bitmap.to_pil())
            res, _ = ocr(arr)
            if res:
                out.append("\n".join(line[1] for line in res))
        return "\n\n".join(out)
    except Exception:
        return ""


def pdf_text(data: bytes) -> str:
    """抽取全部页面的文字层，页间以空行分隔；扫描件先走 pypdf 文字层，
    不足则 pypdfium2+OCR 兜底；仍无效 ⇒ NoTextLayer。"""
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
    except PdfReadError as e:
        raise NoTextLayer(f"PDF 无法读取：{e}") from e
    text = "\n\n".join(p for p in pages if p)
    if len(re.sub(r"\s", "", text)) < MIN_TEXT_CHARS:
        text = _ocr_text(data)
        if len(re.sub(r"\s", "", text)) < MIN_TEXT_CHARS:
            raise NoTextLayer("未检测到文字层")
    return text
