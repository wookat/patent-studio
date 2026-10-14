# -*- coding: utf-8 -*-
"""把内核异常翻译成可读错误 + content.md 行号。"""

import re
import traceback
from typing import Literal, get_args

from fastapi import HTTPException

from app.lo import PdfConvertError
from patent_studio.kernel.builder import EquationError, FigureError
from patent_studio.kernel.cnipa_xml import XmlContentError

_ABSTRACT_RE = re.compile(r"摘要超过(\d+)字：(\d+)")
_TOP_SECTIONS = ("摘要", "权利要求书", "说明书")


def _find_line(lines, predicate, start=0):
    for i in range(start, len(lines)):
        if predicate(lines[i]):
            return i + 1
    return None


def _section_start(lines, heading):
    return _find_line(lines, lambda s: s.strip() == heading)


def error_detail(kind, message, line=None, detail=None):
    return {"kind": kind, "message": message, "line": line, "detail": detail}


# W5（docs/plan/21 §7.4.8）：全部错误码枚举；前端 lib/api.ts `W5ErrorKind` / errorKind() 按 kind 选文案，
# 不解析 message。
# 已有 kind（build/abstract_limit/equation/figure/file/content/settings/auth/forbidden/validation/ai_*/internal/
# not_implemented）保持不变；新增：
#   ai_disabled_by_org  403  机构关闭 AI（org settings.ai_enabled=false；所有 /ai /agent）
#   ai_disabled         403  案级关闭 AI（studio.json ai_enabled=false；现有 routes_ai 已用）
#   budget              429  每案日预算耗尽（settings.ai_daily_tokens）；heavy 场景拒绝，interactive 仍可跑
#   share.expired       410  公开链接过期；share.revoked 410 已撤销；
#   share.scope         403  链接权限不足（read 想 comment / confirm）
#   oa.pdf_no_text      422  OA PDF 无文字层（扫描件），需 OCR 或手工录入
#   deadline.rule       422  期限规则缺基准日 / 规则未知；deadline.holidays_missing 只作 warning 字段，不是错误
#   not_found           404  统一「资源不存在」（case / deadline / notification / proposal…）
#   conflict            409  并发 / 重复（已有确认、已应用的 proposal 再应用…）
ErrorKind = Literal[
    "build",
    "abstract_limit",
    "equation",
    "figure",
    "file",
    "content",
    "settings",
    "auth",
    "forbidden",
    "validation",
    "internal",
    "not_implemented",
    "ai_disabled",
    "ai_disabled_by_org",
    "ai_timeout",
    "ai_upstream",
    "ai_format",
    "ai_no_key",
    "budget",
    "share.expired",
    "share.revoked",
    "share.scope",
    "oa.pdf_no_text",
    "deadline.rule",
    "not_found",
    "conflict",
    # 其余线上 kind：走 error_detail / dict 直写（kind_error 很少用，多状态者无 KIND_STATUS 缺省）
    "project",
    "case",
    "history",
    "unavailable",
    "stale",
    "kind",
    "attachments",
    "figures",
    "figure-referenced",
    "terms",
    "questionnaire",
    "bundle",
    "job_busy",
    "oa_empty",
    "oa_answer_missing",
    "expired",
    "empty",
    "import",
    "ai",
    "source",
]
ERROR_KINDS: frozenset[str] = frozenset(get_args(ErrorKind))

# kind → 缺省 HTTP 状态（路由自定义 message 时用 `kind_error`）
KIND_STATUS: dict[str, int] = {
    "auth": 401,
    "forbidden": 403,
    "ai_disabled": 403,
    "ai_disabled_by_org": 403,
    "share.scope": 403,
    "not_found": 404,
    "conflict": 409,
    "share.expired": 410,
    "share.revoked": 410,
    "validation": 422,
    "oa.pdf_no_text": 422,
    "deadline.rule": 422,
    "content": 422,
    "settings": 422,
    "budget": 429,
    "not_implemented": 501,
    "internal": 500,
    # 补充 kind（单一已建立状态者；多状态 kind 如 project/attachments 不设缺省）
    "expired": 410,
    "unavailable": 503,
    "stale": 409,
    "job_busy": 409,
    "oa_empty": 409,
    "oa_answer_missing": 404,
    "figure-referenced": 409,
    "figures": 422,
    "terms": 422,
    "questionnaire": 422,
    "bundle": 422,
    "empty": 422,
    "source": 422,
    "kind": 422,
}


def kind_error(kind: str, message: str, *, detail=None, status: int | None = None) -> HTTPException:
    """按 ErrorKind 造 HTTPException（`raise kind_error("budget", "…")`）；kind 必须在 ERROR_KINDS 内。"""
    if kind not in ERROR_KINDS:
        raise ValueError(f"未知错误码 {kind!r}")
    return HTTPException(status or KIND_STATUS.get(kind, 400), error_detail(kind, message, detail=detail))


def not_implemented(unit, message):
    """R6 占位路由：501，detail 形状与结构错误一致，detail 字段 = 负责单元名（07 §4）。"""
    return HTTPException(501, error_detail("not_implemented", message, detail=unit))


def describe_error(exc, content):
    """返回 {message, line, kind, detail}。line 为 1-based，可能为 None。"""
    lines = content.splitlines()
    kind, line, message = "build", None, str(exc)
    detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()

    if isinstance(exc, AssertionError) and _ABSTRACT_RE.search(message):
        kind = "abstract_limit"
        m = _ABSTRACT_RE.search(message)
        message = f"摘要超过 {m.group(1)} 字（当前 {m.group(2)} 字），请精简摘要正文"
        start = _section_start(lines, "## 摘要") or 1
        line = _find_line(lines, lambda s: s.strip() and not s.startswith("#"), start) or start
    elif isinstance(exc, EquationError):
        kind = "equation"
        f = exc.formula.strip()
        line = _find_line(lines, lambda s: f in s or f[:20] in s) if f else None
    elif isinstance(exc, FigureError):
        kind = "figure"
        line = None
    elif isinstance(exc, XmlContentError):
        kind = "content"
        line = _section_start(lines, f"## {exc.section}") or 1
    elif isinstance(exc, PdfConvertError):
        detail = exc.detail
    elif isinstance(exc, FileNotFoundError):
        kind = "file"
        message = f"文件不存在：{exc.filename or exc}"
    elif isinstance(exc, KeyError) and exc.args and isinstance(exc.args[0], str):
        key = exc.args[0]
        heading = _section_start(lines, f"## {key}")
        if heading is not None:
            kind = "content"
            line = heading
            message = f"未知章节「{key}」：仅允许 摘要/权利要求书/说明书"
        else:
            kind = "settings"
            message = f"设置项缺失或不合法：{key}"
    elif isinstance(exc, (TypeError, AttributeError)) and _missing_structure(content):
        kind = "content"
        missing = _missing_structure(content)
        if not content.strip():
            message = "文档为空：请以「# 标题」开始，并包含 ## 摘要 / ## 权利要求书 / ## 说明书 章节"
        else:
            secs = [m for m in missing if m.startswith("## ")]
            parts = ["「# 标题」行"] if "「# 标题」" in missing else []
            if secs:
                parts.append(" / ".join(secs) + " 章节")
            message = "文档缺少 " + " 与 ".join(parts)
        line = 1
    elif isinstance(exc, ValueError):
        kind = "content"
        line = _guess_line_from_message(lines, message)
    return {"kind": kind, "message": message, "line": line, "detail": detail}


def _missing_structure(content):
    """缺失的结构项列表：「# 标题」与三大 ## 节；全齐返回 []。"""
    lines = content.splitlines()
    missing = []
    if not any(s.startswith("# ") for s in lines):
        missing.append("「# 标题」")
    for name in _TOP_SECTIONS:
        if _section_start(lines, f"## {name}") is None:
            missing.append(f"## {name}")
    return missing


def _guess_line_from_message(lines, message):
    # 常见 ValueError 里带了原文片段（例如表格/公式），尽力匹配一行。
    frag = message.strip()[:30]
    if len(frag) < 4:
        return None
    return _find_line(lines, lambda s: frag in s)
