# -*- coding: utf-8 -*-
"""MCP v1 工具集契约（docs/plan/10 §3.2）。工具名固定；入参模型 = 工具函数签名，出参模型 = structured_content。"""
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.cases import CaseStatus
from patent_studio.kernel.docset import BOOKS

# 顺序 = 注册顺序（server.py）：tools.register → tools_figures → tools_case → tools_attachments → tools_semantic
TOOL_NAMES = (
    "list_projects", "read_book", "get_ast", "get_docs", "patch_block", "insert_block",
    "lint", "preflight", "build", "export_xml", "add_comment", "get_history",
    "list_figures", "set_figure_order", "set_figure_width",
    "list_figure_sources", "get_figure_source", "put_figure_source", "delete_figure_source",
    "get_case", "set_case_status",
    "list_attachments", "read_attachment_text",
    "get_claim_tree", "get_support_map", "get_figures", "get_terms", "context_pack",
    "get_settings", "case_summary", "get_deadlines", "get_timeline",
    "list_oa_rounds", "get_oa_round", "list_comments", "list_public_links",
    "get_proposals", "list_ai_jobs", "list_audit", "get_deliver_errors", "prior_art_search",
    "list_tags", "list_templates", "get_template", "oa_parse",
    "create_project", "import_docx_path", "update_case", "put_settings",
    "deadline_done", "update_deadline",
    "create_oa_round", "update_oa_round", "extend_oa_round", "delete_oa_round",
    "add_note", "reply_comment", "resolve_comment", "delete_comment",
    "create_public_link", "revoke_public_link", "apply_proposal", "dismiss_proposal",
    "apply_template", "create_tag", "run_scenario",
    "list_org_members", "update_org_member", "get_org_settings", "put_org_settings",
    "set_org_name", "list_org_audit",
    "get_novelty", "record_novelty",
)
__all__ = ["CaseStatus"]
RESOURCE_TEMPLATE = "patent://{pid}/docs/{book}"

Book = Literal["abstract", "claims", "description"]
assert set(Book.__args__) == set(BOOKS)

CriticMode = Literal["final", "original", "markup"]


class ProjectSummary(BaseModel):
    id: str
    title: str
    mtime: float


class BookOut(BaseModel):
    pid: str
    book: Book
    text: str


class DocsOut(BaseModel):
    pid: str
    title: str
    abstract: str
    claims: str
    description: str


class PatchIn(BaseModel):
    pid: str
    block_id: str
    markdown: str
    direct: bool = Field(False, description="false = 以 CriticMarkup 建议写入；true = 直改（AUTH=on 需 editor+）")


class InsertIn(BaseModel):
    pid: str
    kind: str
    after_block_id: str | None = None
    book: Book | None = None
    markdown: str | None = None
    direct: bool = False


class WriteOut(BaseModel):
    ok: bool
    mode: Literal["suggest", "direct"]
    sha: str | None = Field(None, description="写入后 history.head")
    block_id: str | None = None


class BuildIn(BaseModel):
    pid: str
    mode: CriticMode = "final"
    pdf: bool = True


class BuildOut(BaseModel):
    status: str
    build_id: str | None
    pdf_url: str | None
    docx_url: str | None
    diagnostics: list[dict]
    summary: dict | None
    error: dict | None = None


class CommentIn(BaseModel):
    pid: str
    anchor: dict = Field(description="与 POST /api/projects/{pid}/comments 的 anchor 同形")
    # 与 routes/comments.CommentIn.body 同口径（4000）：MCP 侧提前拦，免得提交后才 422
    body: str = Field(max_length=4000)


# ---------------------------------------------------------------- W4-E E3（docs/plan/17 §4）----


class AttachmentTextOut(BaseModel):
    name: str
    kind: Literal["docx", "pdf", "text"]
    text: str
    chars: int = Field(description="截断前总字数")
    truncated: bool = False


class ClaimNode(BaseModel):
    """preflight.run()["claim_tree"] 一项 + 权项原文；children 递归。"""

    num: int
    kind: Literal["independent", "dependent"]
    category: str = Field(description="主题名称短语（方法 / 系统 / 装置 / 介质…）")
    refs: list[int]
    line: int
    text: str
    issues: list[dict]
    children: list["ClaimNode"]


class SupportRow(BaseModel):
    term: str
    claims: list[int]
    matched: str | None = Field(None, description="说明书中实际匹配到的形式（可能是术语表别名）")
    description_lines: list[int]
    supported: bool


class FigureRow(BaseModel):
    """附图标记表：一张图 + 图中出现的附图标记（来自 numerals 的 lines 与该图 caption/段落的交集）。"""

    num: int
    file: str
    caption: str
    caption_line: int | None
    refs: list[int] = Field(description="正文中提到“图N”的行号")
    markers: list[dict] = Field(description="[{num, names, consistent}]，来自 preflight numerals")


class TermRow(BaseModel):
    name: str
    aliases: list[str]
    definition: str
    definition_line: int | None
    claims: list[int]


class ContextPack(BaseModel):
    """context_pack(pid, claim_id) 返回体（17 §4.4）：一次性给齐“理解一条权项”需要的全部上下文。
    体积上限 max_chars（默认 12000）：超出时按 support → terms → comments 顺序截列表并置 truncated=true。"""

    pid: str
    claim: ClaimNode
    chain: list[ClaimNode] = Field(description="从独立权项到本项的依赖链（不含本项，按递进顺序）")
    support: list[dict] = Field(description="[{para_no, line, text, terms}]：说明书支持段落（段号 [00xx] + 原文）")
    figures: list[FigureRow]
    terms: list[TermRow]
    comments: list[dict] = Field(description="锚在本权项行区间内的未解决批注；只含调用者可见的（详 17 §4.4）")
    issues: list[dict] = Field(description="preflight items 中 line 落在本项或支持段落内的诊断")
    truncated: bool = False


class ToolErrorDetail(BaseModel):
    """业务错误：与 app.errors.error_detail 同形，序列化为 ToolError 文本。"""

    kind: str
    message: str
    line: int | None = None
    detail: str | None = None
