# -*- coding: utf-8 -*-
"""生成 oa_text.pdf / oa_scan.pdf（确定性手写 PDF，无外部依赖、无时间戳）。python3 make_fixtures.py

加 --synthetic 时还把 notice_synthetic.md（合成一通：3 条意见 + 2 份对比文件）经 LibreOffice 转成 notice_synthetic.pdf
（真字体文字层，pypdf 可抽中文）；需 soffice，输出含 LibreOffice 版本 / 时间戳，不要求逐字节稳定。"""
import html
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

TEXT_LINES = [
    "Office Action (First) - Application No. 2026100000001",
    "1. Claim 1 lacks inventive step over reference D1.",
    "2. Claim 3 is not supported by the description.",
    "3. The abstract exceeds 300 characters.",
]


def _pdf(objects: list[bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def text_pdf() -> bytes:
    stream = b"BT /F1 12 Tf 72 720 Td 16 TL " + b" ".join(
        b"(" + ln.encode("latin-1") + b") Tj T*" for ln in TEXT_LINES) + b" ET"
    return _pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def scan_pdf() -> bytes:
    # 1x1 灰度图铺满页面，无任何文本对象 ⇒ extract_text() == ""
    img = b"\xff"
    stream = b"q 595 0 0 842 0 0 cm /Im1 Do Q"
    return _pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /XObject << /Im1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 "
        b"/Length 1 >>\nstream\n"
        + img + b"\nendstream",
    ])


def _md_to_html(md: str) -> str:
    """夹具专用的最小转换（只认 # / ## 标题与段落），不是专利正文解析器。"""
    parts = []
    for ln in md.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("## "):
            parts.append(f"<h2>{html.escape(s[3:])}</h2>")
        elif s.startswith("# "):
            parts.append(f"<h1>{html.escape(s[2:])}</h1>")
        else:
            parts.append(f"<p>{html.escape(s)}</p>")
    return ('<html><head><meta charset="utf-8"><style>body{font-family:"宋体",SimSun,serif;font-size:12pt}'
            "</style></head><body>" + "\n".join(parts) + "</body></html>")


def synthetic_pdf() -> bytes:
    soffice = shutil.which("soffice")
    if soffice is None:
        raise SystemExit("需要 LibreOffice（soffice）生成 notice_synthetic.pdf")
    with open(os.path.join(HERE, "notice_synthetic.md"), encoding="utf-8") as f:
        md = f.read()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "notice_synthetic.html")
        with open(src, "w", encoding="utf-8") as f:
            f.write(_md_to_html(md))
        subprocess.run([soffice, "--headless", "--convert-to", "pdf:writer_web_pdf_Export", "--outdir", tmp, src],
                       check=True, capture_output=True, timeout=120)
        with open(os.path.join(tmp, "notice_synthetic.pdf"), "rb") as f:
            return f.read()


if __name__ == "__main__":
    outputs = [("oa_text.pdf", text_pdf), ("oa_scan.pdf", scan_pdf)]
    if "--synthetic" in sys.argv:
        outputs.append(("notice_synthetic.pdf", synthetic_pdf))
    for name, make in outputs:
        data = make()
        with open(os.path.join(HERE, name), "wb") as f:
            f.write(data)
        print(name, len(data))
