# -*- coding: utf-8 -*-
"""DOCX → PDF 转换：优先走常驻 LibreOffice（unoserver，XML-RPC），不可用时回退到 soffice CLI。

soffice CLI 每次都要冷启动一个 LibreOffice 进程（实测 1.3–2 s），而 unoserver 让 LibreOffice
常驻，单次转换只剩排版+导出本身（实测同一文档 ~0.6 s）。两者产出的 PDF 除元数据时间戳外一致。
"""
import http.client
import logging
import os
import shutil
import subprocess
import threading
import time
from xmlrpc.client import Fault, ServerProxy, Transport

from app import config

log = logging.getLogger("patent_studio.lo")

_state_lock = threading.Lock()
_uno_down_until = 0.0  # unoserver 连接失败后的退避截止时间（monotonic）
_last_backend = "cli"
_last_tagged = False


class _TimeoutTransport(Transport):
    def __init__(self, timeout):
        super().__init__()
        self._timeout = timeout

    def make_connection(self, host):
        conn = super().make_connection(host)
        conn.timeout = self._timeout
        return conn


def _proxy(timeout):
    return ServerProxy(config.UNOSERVER_URL, allow_none=True, transport=_TimeoutTransport(timeout))


def soffice_available():
    return shutil.which(config.SOFFICE) is not None or os.path.isfile(config.SOFFICE)


def unoserver_available(timeout=1.0):
    """探测 unoserver 是否在线（info() 调用）。"""
    if not config.UNOSERVER_URL:
        return False
    try:
        info = _proxy(timeout).info()
        return isinstance(info, dict)
    except (TimeoutError, OSError, http.client.HTTPException, Fault):
        return False


def last_backend():
    return _last_backend


def last_tagged():
    """最近一次 docx_to_pdf 是否真的产出 tagged PDF（仅 unoserver 路径可能为 True）。"""
    return _last_tagged


def _mark(backend, tagged=False):
    global _last_backend, _last_tagged
    _last_backend = backend
    _last_tagged = tagged


class PdfConvertError(RuntimeError):
    """DOCX → PDF 阶段失败（LibreOffice 缺失 / 超时 / 转换报错）；str() 是给用户看的一句话，detail 保留实现日志。"""

    def __init__(self, message, detail):
        super().__init__(message)
        self.detail = detail


def _uno_convert(docx_path, pdf_path, timeout, tagged=False):
    """通过 unoserver 转换；服务端与本进程同机，直接传路径避免拷贝字节。

    tagged → 写 PDF 导出过滤器选项 UseTaggedPDF（结构树 + MCID，前端 struct 配对用）。
    """
    _proxy(timeout).convert(
        os.path.abspath(docx_path), None, os.path.abspath(pdf_path),
        "pdf", None, ["UseTaggedPDF=true"] if tagged else [], True, None, None,
    )
    if not os.path.isfile(pdf_path):
        raise PdfConvertError("PDF 转换失败：未产出 PDF 文件", "unoserver 未产出 PDF")


def _cli_convert(docx_path, out_dir, timeout):
    os.makedirs(config.LO_PROFILE_DIR, exist_ok=True)
    cmd = [
        config.SOFFICE, "--headless", "--norestore", "--nologo",
        f"-env:UserInstallation=file://{config.LO_PROFILE_DIR}",
        "--convert-to", "pdf", "--outdir", out_dir, docx_path,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        raise PdfConvertError("PDF 转换失败：未检测到 LibreOffice，DOCX 已生成", f"{config.SOFFICE}: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise PdfConvertError(f"PDF 转换超时（{timeout} s），DOCX 已生成", str(e)) from e
    pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    if r.returncode != 0 or not os.path.isfile(pdf):
        raise PdfConvertError("PDF 转换失败：LibreOffice 未能完成转换，DOCX 已生成",
                              f"soffice exit {r.returncode}\n{(r.stderr or r.stdout).strip()[-800:]}")
    return pdf


def docx_to_pdf(docx_path, out_dir, timeout=None, *, tagged: bool = False):
    """把 docx 转成同名 pdf 放到 out_dir，返回 pdf 路径。

    unoserver 在线 → 用它；连接失败 → 记 30 s 退避并回退 CLI（Fault 是文档本身的错误，不退避，直接抛）。
    tagged 只在 unoserver 路径生效（21 §1.4 B2，仅预览构建传 True）；CLI 回退忽略它，last_tagged() 为 False。
    """
    global _uno_down_until
    timeout = timeout or config.SOFFICE_TIMEOUT
    pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    if config.UNOSERVER_URL and time.monotonic() >= _uno_down_until:
        try:
            _uno_convert(docx_path, pdf, timeout, tagged)
            _mark("unoserver", tagged)
            return pdf
        except Fault as e:
            _mark("unoserver")
            raise PdfConvertError("PDF 转换失败：LibreOffice 未能完成转换，DOCX 已生成", e.faultString[-800:]) from e
        except (TimeoutError, OSError, http.client.HTTPException) as e:
            with _state_lock:
                _uno_down_until = time.monotonic() + config.UNOSERVER_RETRY_S
            log.warning("unoserver 不可用（%s），%ss 内回退 soffice CLI", e, config.UNOSERVER_RETRY_S)
    _mark("cli")
    return _cli_convert(docx_path, out_dir, timeout)
