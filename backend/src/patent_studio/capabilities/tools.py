"""旧 MCP 工具面（git c2f4653 ``app/mcp`` TOOL_NAMES 74 项）的平台能力注册（B14）。

对齐口径：每个旧工具名在 ``TOOL_CAPABILITY_MAP``（注册能力）或 ``NON_MIGRATED``
（有意不迁 + 理由）中有归属，矩阵测试强制全集覆盖、不许静默漏项。

命令面语义：输入一律含 ``operation_id`` 幂等键（CommandInput），输出统一
``CommandReceipt``；registry 负责幂等绑定 / payload 指纹 / outbox 回执重放 /
审批挂起。涉及正文改写的旧工具（patch_block / insert_block / apply_proposal）
按平台语义落到提案路径——agent 产生 submitted 提案，正式修订仍由人工接受。
"""

from __future__ import annotations

import asyncio
import calendar
import concurrent.futures
import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from patent_studio.capabilities import semantic
from patent_studio.capabilities.registry import (
    CapabilityError,
    CapabilityKind,
    CapabilityRegistry,
    CapabilityRisk,
    CapabilityScope,
    CapabilitySpec,
    CommandInput,
    CommandReceipt,
    InvocationContext,
)
from patent_studio.domain import documents as d
from patent_studio.domain import figures as fig_domain
from patent_studio.domain import materials as mat
from patent_studio.domain import proposals as prop
from patent_studio.domain import releases as rel
from patent_studio.domain import work_items as wi
from patent_studio.domain.identity import Principal
from patent_studio.domain.operations import Operation
from patent_studio.domain.organization import Case, CaseParticipant, OrganizationMembership
from patent_studio.domain.runs import Run
from patent_studio.infra.storage import ObjectRef, open_store
from patent_studio.kernel import critic, docset, patch, preflight
from patent_studio.kernel.ast import AstError, parse_ast
from patent_studio.settings import get_settings

AGENT_TOOL_REGISTRY = CapabilityRegistry()


# ---------------------------------------------------------------- 共享基础设施 ----


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")


def _await(coro):
    """同步 handler 内跑异步 ObjectStore（处于运行中 loop 时换线程执行）。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _store():
    settings = get_settings()
    if not settings.storage_url:
        raise CapabilityError("object storage is not configured")
    return open_store(
        settings.storage_url,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_region=settings.s3_region,
    )


def _read(ref: ObjectRef) -> bytes:
    try:
        data = _await(_store().get(ref.key))
    except Exception as exc:
        raise CapabilityError("stored content is unavailable") from exc
    if len(data) != ref.size or hashlib.sha256(data).hexdigest() != ref.sha256:
        raise CapabilityError("stored content failed integrity check")
    return data


def _write(data: bytes, content_type: str) -> ObjectRef:
    return _await(_store().put(data, content_type))


def _case(session: Session, context: InvocationContext) -> Case:
    assert context.case_id is not None
    return d._ensure_case_access(session, context.case_id, context.principal_id)


def _case_books(session: Session, case_id: uuid.UUID) -> dict[str, str]:
    books: dict[str, str] = {}
    for doc in session.scalars(select(d.Document).where(d.Document.case_id == case_id)):
        if doc.current_revision_id is None or doc.book in books:
            continue
        revision = session.get(d.Revision, doc.current_revision_id)
        if revision is not None:
            books[doc.book] = _read(revision.content_ref).decode("utf-8")
    return books


_BOOK_HEADS = {"abstract": "摘要", "claims": "权利要求书", "description": "说明书"}


def _case_content_md(session: Session, case_id: uuid.UUID) -> tuple[Case, str]:
    case = session.get(Case, case_id)
    assert case is not None
    books = _case_books(session, case_id)
    return case, (
        f"# {case.title}\n\n## 摘要\n\n{books.get('abstract', '')}\n\n## 权利要求书\n\n"
        f"{books.get('claims', '')}\n\n## 说明书\n\n{books.get('description', '')}\n"
    )


def _figure_overlay(session: Session, case_id: uuid.UUID) -> dict:
    """附图域真值 → kernel 设置面（spec_figures 序位 ↔ 图N），同 B13 case_preflight。"""
    figure_docs = list(
        session.scalars(select(fig_domain.FigureDocument).where(fig_domain.FigureDocument.case_id == case_id))
    )
    max_fig_no = max((f.figure_no or 0) for f in figure_docs) if figure_docs else 0
    return {
        "spec_figures": [(f"fig{i}.png", 15.0) for i in range(1, max_fig_no + 1)],
        "abstract_figure": ("abstract.png", 15.0) if any(f.figure_no is None for f in figure_docs) else None,
    }


def _derive(session: Session, case_id: uuid.UUID) -> semantic.Derived:
    _case_obj, content = _case_content_md(session, case_id)
    overlay = _figure_overlay(session, case_id)
    try:
        ast = parse_ast(critic.accept(content), settings=overlay)
    except AstError as exc:
        raise CapabilityError(f"case content does not parse: {exc}") from exc
    return semantic.Derived(
        ast=ast, report=preflight.run(ast, settings=overlay), lines=critic.accept(content).split("\n")
    )


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


def _receipt(operation_id: str, result: dict[str, Any]) -> CommandReceipt:
    return CommandReceipt(operation_id=operation_id, status="succeeded", result_json=_json(result))


def _work_item_row(item: wi.WorkItem) -> dict:
    return {
        "work_item_id": str(item.id),
        "title": item.title,
        "type": item.type,
        "status": item.status,
        "deadline": item.deadline,
        "oa_deadline": item.oa_deadline,
        "official_no": item.official_no,
        "assignee_principal_id": item.assignee_principal_id,
        "is_overdue": item.is_overdue,
        "oa_is_overdue": item.oa_is_overdue,
    }


# ---------------------------------------------------------------- 查询契约 ----


class CaseDetailOut(_In):
    case_id: uuid.UUID
    case_key: str
    case_no: str | None
    title: str
    kind: str
    status: str
    created_at: datetime
    document_count: int
    figure_count: int
    open_work_items: int
    open_proposals: int


class DocumentRow(_In):
    document_id: uuid.UUID
    book: str
    current_revision_id: uuid.UUID | None
    updated_at: datetime


class DocumentListOut(_In):
    documents: list[DocumentRow] = Field(default_factory=list)


class DocumentContentIn(_In):
    document_id: uuid.UUID
    mode: Literal["final", "original", "markup"] = "final"


class DocumentContentOut(_In):
    document_id: uuid.UUID
    book: str
    revision_id: uuid.UUID | None
    text: str


class DocumentAstOut(_In):
    document_id: uuid.UUID
    ast_json: str


class RevisionsIn(_In):
    document_id: uuid.UUID
    limit: int = Field(20, ge=1, le=200)


class RevisionRow(_In):
    revision_id: uuid.UUID
    revision_no: int
    created_at: datetime
    author_principal_id: uuid.UUID
    source: str
    content_sha256: str
    content_size: int


class RevisionListOut(_In):
    revisions: list[RevisionRow] = Field(default_factory=list)


class ReportOut(_In):
    report_json: str


class SemanticOut(_In):
    claim_tree_json: str
    support_map_json: str
    figures_json: str
    terms_json: str


class ContextPackIn(_In):
    claim_id: str
    max_chars: int = Field(12000, ge=1)


class ContextPackOut(_In):
    pack_json: str


class WorkItemRow(_In):
    work_item_id: uuid.UUID
    title: str
    type: str
    status: str
    deadline: datetime | None
    oa_deadline: datetime | None
    official_no: str | None
    assignee_principal_id: uuid.UUID | None
    is_overdue: bool
    oa_is_overdue: bool


class WorkItemListOut(_In):
    work_items: list[WorkItemRow] = Field(default_factory=list)


class WorkItemIdIn(_In):
    work_item_id: uuid.UUID


class WorkItemDetailOut(WorkItemRow):
    priority: int
    document_id: uuid.UUID | None
    figure_document_id: uuid.UUID | None
    release_id: uuid.UUID | None
    response_document_id: uuid.UUID | None
    reporter_principal_id: uuid.UUID
    created_at: datetime
    completed_at: datetime | None


class OperationsIn(_In):
    status: Literal["pending", "running", "succeeded", "failed", "canceled"] | None = None
    limit: int = Field(50, ge=1, le=500)


class OperationRow(_In):
    operation_id: str
    operation_type: str
    status: str
    case_id: uuid.UUID | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_summary: str | None


class OperationListOut(_In):
    operations: list[OperationRow] = Field(default_factory=list)


class RunRow(_In):
    run_id: str
    run_type: str
    status: str
    fencing_epoch: int
    created_at: datetime
    finished_at: datetime | None


class RunListOut(_In):
    runs: list[RunRow] = Field(default_factory=list)


class ProposalsIn(_In):
    state: str | None = None


class ProposalRow(_In):
    proposal_id: uuid.UUID
    status: str
    target_kind: str
    document_revision_id: uuid.UUID | None
    figure_revision_id: uuid.UUID | None
    proposer_principal_id: uuid.UUID | None
    submitted_at: datetime | None
    decided_at: datetime | None


class ProposalListOut(_In):
    proposals: list[ProposalRow] = Field(default_factory=list)


class FigureRow(_In):
    figure_id: uuid.UUID
    figure_no: int | None
    title: str
    anchor: str | None
    current_revision_id: uuid.UUID | None
    updated_at: datetime


class FigureListOut(_In):
    figures: list[FigureRow] = Field(default_factory=list)


class MaterialsIn(_In):
    status: Literal["active", "archived"] | None = None


class MaterialRow(_In):
    material_id: uuid.UUID
    kind: str
    title: str
    status: str
    source_url: str | None
    content_size: int | None
    content_type: str | None
    created_at: datetime


class MaterialListOut(_In):
    materials: list[MaterialRow] = Field(default_factory=list)


class MaterialContentIn(_In):
    material_id: uuid.UUID
    max_chars: int = Field(20000, ge=1, le=200000)


class MaterialContentOut(_In):
    material_id: uuid.UUID
    title: str
    text: str
    truncated: bool


class MemberRow(_In):
    principal_id: uuid.UUID
    display_name: str
    kind: str
    role: str
    status: str
    joined_at: datetime | None


class MemberListOut(_In):
    members: list[MemberRow] = Field(default_factory=list)


class EmptyQueryIn(_In):
    pass


# ---------------------------------------------------------------- 查询处理器 ----


def _h_case_get(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> CaseDetailOut:
    case = _case(session, ctx)
    return CaseDetailOut(
        case_id=case.id,
        case_key=case.case_key,
        case_no=case.case_no,
        title=case.title,
        kind=case.kind,
        status=case.status,
        created_at=case.created_at,
        document_count=session.scalar(select(func.count(d.Document.id)).where(d.Document.case_id == case.id)) or 0,
        figure_count=session.scalar(
            select(func.count(fig_domain.FigureDocument.id)).where(fig_domain.FigureDocument.case_id == case.id)
        )
        or 0,
        open_work_items=session.scalar(
            select(func.count(wi.WorkItem.id)).where(
                wi.WorkItem.case_id == case.id, wi.WorkItem.status.not_in(("done", "canceled"))
            )
        )
        or 0,
        open_proposals=session.scalar(
            select(func.count(prop.Proposal.id)).where(
                prop.Proposal.case_id == case.id, prop.Proposal.status.in_(("draft", "submitted"))
            )
        )
        or 0,
    )


def _h_documents(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> DocumentListOut:
    case = _case(session, ctx)
    rows = session.scalars(select(d.Document).where(d.Document.case_id == case.id).order_by(d.Document.created_at))
    return DocumentListOut(
        documents=[
            DocumentRow(
                document_id=row.id,
                book=row.book,
                current_revision_id=row.current_revision_id,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    )


def _h_document_content(session: Session, payload: DocumentContentIn, ctx: InvocationContext) -> DocumentContentOut:
    doc = d._document_for(session, payload.document_id, ctx.principal_id)
    if doc.current_revision_id is None:
        return DocumentContentOut(document_id=doc.id, book=doc.book, revision_id=None, text="")
    revision = session.get(d.Revision, doc.current_revision_id)
    assert revision is not None
    raw = _read(revision.content_ref).decode("utf-8")
    return DocumentContentOut(
        document_id=doc.id, book=doc.book, revision_id=revision.id, text=critic.resolve(raw, payload.mode)
    )


def _h_document_ast(session: Session, payload: DocumentContentIn, ctx: InvocationContext) -> DocumentAstOut:
    doc = d._document_for(session, payload.document_id, ctx.principal_id)
    body = ""
    if doc.current_revision_id is not None:
        revision = session.get(d.Revision, doc.current_revision_id)
        body = _read(revision.content_ref).decode("utf-8")
    bodies = {"abstract": "", "claims": "", "description": ""}
    bodies[doc.book] = body.strip("\n")
    text = "# 文稿\n"
    for book in ("abstract", "claims", "description"):
        text += f"\n## {_BOOK_HEADS[book]}\n"
        if bodies[book]:
            text += f"\n{bodies[book]}\n"
    try:
        ast = parse_ast(critic.accept(text))
    except AstError as exc:
        raise CapabilityError(f"document content does not parse: {exc}") from exc
    return DocumentAstOut(document_id=doc.id, ast_json=_json(ast))


def _h_revisions(session: Session, payload: RevisionsIn, ctx: InvocationContext) -> RevisionListOut:
    revisions = d.list_revisions(session, payload.document_id, principal_id=ctx.principal_id)
    return RevisionListOut(
        revisions=[
            RevisionRow(
                revision_id=row.id,
                revision_no=row.revision_no,
                created_at=row.created_at,
                author_principal_id=row.author_principal_id,
                source=row.source,
                content_sha256=row.content_sha256,
                content_size=row.content_size,
            )
            for row in revisions[: payload.limit]
        ]
    )


def _h_preflight(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> ReportOut:
    _case(session, ctx)
    return ReportOut(report_json=_json(_derive(session, ctx.case_id).report))


def _h_lint(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> ReportOut:
    """旧 lint = preflight 诊断 + CriticMarkup 标记 lint（counts 合并）。"""
    _case(session, ctx)
    _case_obj, content = _case_content_md(session, ctx.case_id)
    report = _derive(session, ctx.case_id).report
    marks = critic.lint_marks(content)
    report["items"] = [*report["items"], *marks]
    for mark in marks:
        report["counts"][mark["severity"]] = report["counts"].get(mark["severity"], 0) + 1
    return ReportOut(report_json=_json(report))


def _h_semantic(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> SemanticOut:
    _case(session, ctx)
    derived = _derive(session, ctx.case_id)
    return SemanticOut(
        claim_tree_json=_json(semantic.claim_tree(derived)),
        support_map_json=_json(semantic.support_map(derived)),
        figures_json=_json(semantic.figures(derived)),
        terms_json=_json(semantic.term_rows(derived)),
    )


def _h_context_pack(session: Session, payload: ContextPackIn, ctx: InvocationContext) -> ContextPackOut:
    _case(session, ctx)
    derived = _derive(session, ctx.case_id)
    return ContextPackOut(pack_json=_json(semantic.context_pack(derived, payload.claim_id, payload.max_chars)))


def _h_deadlines(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> WorkItemListOut:
    case = _case(session, ctx)
    rows = session.scalars(
        select(wi.WorkItem)
        .where(wi.WorkItem.case_id == case.id)
        .order_by(wi.WorkItem.deadline.is_(None), wi.WorkItem.deadline, wi.WorkItem.created_at)
    )
    return WorkItemListOut(work_items=[WorkItemRow(**_work_item_row(row)) for row in rows])


def _h_work_item_get(session: Session, payload: WorkItemIdIn, ctx: InvocationContext) -> WorkItemDetailOut:
    item = wi._work_item_for(session, payload.work_item_id, ctx.principal_id)
    return WorkItemDetailOut(
        **_work_item_row(item),
        priority=item.priority,
        document_id=item.document_id,
        figure_document_id=item.figure_document_id,
        release_id=item.release_id,
        response_document_id=item.response_document_id,
        reporter_principal_id=item.reporter_principal_id,
        created_at=item.created_at,
        completed_at=item.completed_at,
    )


def _h_operations(session: Session, payload: OperationsIn, ctx: InvocationContext) -> OperationListOut:
    case = _case(session, ctx)
    query = (
        select(Operation)
        .where(Operation.case_id == case.id)
        .order_by(Operation.created_at.desc(), Operation.id.desc())
        .limit(payload.limit)
    )
    if payload.status is not None:
        query = query.where(Operation.status == payload.status)
    return OperationListOut(
        operations=[
            OperationRow(
                operation_id=row.operation_id,
                operation_type=row.operation_type,
                status=row.status,
                case_id=row.case_id,
                created_at=row.created_at,
                started_at=row.started_at,
                finished_at=row.finished_at,
                error_summary=row.error_summary,
            )
            for row in session.scalars(query)
        ]
    )


def _h_runs(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> RunListOut:
    case = _case(session, ctx)
    rows = session.scalars(select(Run).where(Run.case_id == case.id).order_by(Run.created_at.desc(), Run.id.desc()))
    return RunListOut(
        runs=[
            RunRow(
                run_id=row.run_id,
                run_type=row.run_type,
                status=row.status,
                fencing_epoch=row.fencing_epoch,
                created_at=row.created_at,
                finished_at=row.finished_at,
            )
            for row in rows
        ]
    )


def _h_proposals(session: Session, payload: ProposalsIn, ctx: InvocationContext) -> ProposalListOut:
    case = _case(session, ctx)
    query = select(prop.Proposal).where(prop.Proposal.case_id == case.id).order_by(prop.Proposal.created_at)
    if payload.state is not None:
        query = query.where(prop.Proposal.status == payload.state)
    return ProposalListOut(
        proposals=[
            ProposalRow(
                proposal_id=row.id,
                status=row.status,
                target_kind=row.target_kind,
                document_revision_id=row.document_revision_id,
                figure_revision_id=row.figure_revision_id,
                proposer_principal_id=row.proposer_principal_id,
                submitted_at=row.submitted_at,
                decided_at=row.decided_at,
            )
            for row in session.scalars(query)
        ]
    )


def _h_figures(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> FigureListOut:
    case = _case(session, ctx)
    rows = session.scalars(
        select(fig_domain.FigureDocument)
        .where(fig_domain.FigureDocument.case_id == case.id)
        .order_by(fig_domain.FigureDocument.figure_no.is_(None), fig_domain.FigureDocument.figure_no)
    )
    return FigureListOut(
        figures=[
            FigureRow(
                figure_id=row.id,
                figure_no=row.figure_no,
                title=row.title,
                anchor=row.anchor,
                current_revision_id=row.current_revision_id,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    )


def _h_materials(session: Session, payload: MaterialsIn, ctx: InvocationContext) -> MaterialListOut:
    case = _case(session, ctx)
    rows = mat.list_materials(session, case.id, principal_id=ctx.principal_id, status=payload.status)
    return MaterialListOut(
        materials=[
            MaterialRow(
                material_id=row.id,
                kind=row.kind,
                title=row.title,
                status=row.status,
                source_url=row.source_url,
                content_size=row.content_size,
                content_type=row.content_type,
                created_at=row.created_at,
            )
            for row in rows
        ]
    )


def _h_material_content(session: Session, payload: MaterialContentIn, ctx: InvocationContext) -> MaterialContentOut:
    material = mat.get_material(session, payload.material_id, principal_id=ctx.principal_id)
    if material.kind == "url" or material.content_key is None:
        raise CapabilityError("url materials have no stored text content")
    text = _read(material.content_ref).decode("utf-8", errors="replace")
    return MaterialContentOut(
        material_id=material.id,
        title=material.title,
        text=text[: payload.max_chars],
        truncated=len(text) > payload.max_chars,
    )


def _h_members(session: Session, _p: EmptyQueryIn, ctx: InvocationContext) -> MemberListOut:
    if ctx.case_id is not None:
        raise CapabilityError("member listing is organization scoped")
    if (
        session.scalar(
            select(OrganizationMembership.principal_id).where(
                OrganizationMembership.organization_id == ctx.organization_id,
                OrganizationMembership.principal_id == ctx.principal_id,
                OrganizationMembership.status == "active",
            )
        )
        is None
    ):
        raise CapabilityError("principal is not an active organization member")
    rows = session.execute(
        select(OrganizationMembership, Principal)
        .join(Principal, Principal.id == OrganizationMembership.principal_id)
        .where(OrganizationMembership.organization_id == ctx.organization_id)
        .order_by(OrganizationMembership.created_at)
    ).all()
    return MemberListOut(
        members=[
            MemberRow(
                principal_id=member.principal_id,
                display_name=principal.display_name,
                kind=principal.kind,
                role=member.role,
                status=member.status,
                joined_at=member.joined_at,
            )
            for member, principal in rows
        ]
    )


# ---------------------------------------------------------------- 命令契约 ----


class CaseCreateIn(CommandInput):
    title: str = Field(min_length=1, max_length=300)
    case_key: str | None = Field(None, max_length=64)
    case_no: str | None = Field(None, max_length=64)
    kind: Literal["invention", "utility", "design"] = "invention"


class CaseUpdateIn(CommandInput):
    title: str | None = Field(None, min_length=1, max_length=300)
    case_no: str | None = Field(None, max_length=64)
    kind: Literal["invention", "utility", "design"] | None = None


class CaseStatusIn(CommandInput):
    status: Literal[
        "intake", "drafting", "review", "client_review", "final", "filed", "oa", "granted", "rejected", "closed"
    ]
    note: str | None = Field(None, max_length=1000)


class DocumentProposeIn(CommandInput):
    document_id: uuid.UUID
    action: Literal["patch", "insert"] = "patch"
    block_id: str | None = Field(None, max_length=256)
    kind: str | None = Field(None, max_length=32)
    after_block_id: str | None = Field(None, max_length=256)
    book: Literal["abstract", "claims", "description"] | None = None
    markdown: str | None = None


class FigureReorderIn(CommandInput):
    figure_ids: list[uuid.UUID] = Field(min_length=1)


class ProposalIdIn(CommandInput):
    proposal_id: uuid.UUID


class ProposalWithdrawIn(CommandInput):
    proposal_id: uuid.UUID
    reason: str | None = Field(None, max_length=1000)


class WorkItemCreateIn(CommandInput):
    type: Literal["draft", "review", "figure", "oa-response", "search", "client-confirm", "deliver"]
    title: str = Field(min_length=1, max_length=300)
    assignee_principal_id: uuid.UUID | None = None
    deadline: datetime | None = None
    priority: int = Field(3, ge=1, le=5)
    document_id: uuid.UUID | None = None
    figure_document_id: uuid.UUID | None = None
    release_id: uuid.UUID | None = None
    official_no: str | None = Field(None, max_length=128)
    oa_deadline: datetime | None = None
    response_document_id: uuid.UUID | None = None


class WorkItemUpdateIn(CommandInput):
    work_item_id: uuid.UUID
    title: str | None = Field(None, min_length=1, max_length=300)
    priority: int | None = Field(None, ge=1, le=5)
    assignee_principal_id: uuid.UUID | None = None
    official_no: str | None = Field(None, max_length=128)


class WorkItemRescheduleIn(CommandInput):
    work_item_id: uuid.UUID
    deadline: datetime | None = None
    clear_deadline: bool = False
    extend_months: int | None = Field(None, ge=1, le=24)
    oa_deadline: datetime | None = None


class WorkItemTransitionIn(CommandInput):
    work_item_id: uuid.UUID
    status: Literal["open", "in_progress", "blocked", "in_review", "done", "canceled"]


class NoteAddIn(CommandInput):
    statement: str = Field(min_length=1, max_length=8000)
    material_id: uuid.UUID | None = None
    anchor_id: uuid.UUID | None = None


class EmptyCommandIn(CommandInput):
    pass


# ---------------------------------------------------------------- 命令处理器 ----


def _h_case_create(session: Session, payload: CaseCreateIn, ctx: InvocationContext) -> CommandReceipt:
    """create_project：机构范围内建案件；创建人落 case_manager 参与。"""
    if ctx.case_id is not None:
        raise CapabilityError("case creation is organization scoped")
    from patent_studio.domain.organization import Organization

    org = session.get(Organization, ctx.organization_id)
    if org is None or org.status != "active":
        raise CapabilityError("organization is not active")
    case_key = payload.case_key or f"C{uuid.uuid4().hex[:10].upper()}"
    case = Case(
        organization_id=ctx.organization_id,
        case_key=case_key.strip(),
        case_no=(payload.case_no or None),
        title=payload.title.strip(),
        kind=payload.kind,
        created_by_principal_id=ctx.principal_id,
    )
    session.add(case)
    session.flush()
    session.add(CaseParticipant(case_id=case.id, principal_id=ctx.principal_id, role="case_manager"))
    session.flush()
    return _receipt(
        payload.operation_id,
        {"case_id": str(case.id), "case_key": case.case_key, "title": case.title, "status": case.status},
    )


def _h_case_update(session: Session, payload: CaseUpdateIn, ctx: InvocationContext) -> CommandReceipt:
    case = _case(session, ctx)
    if payload.title is None and payload.case_no is None and payload.kind is None:
        raise CapabilityError("nothing to update")
    if payload.title is not None:
        case.title = payload.title.strip()
    if payload.case_no is not None:
        case.case_no = payload.case_no or None
    if payload.kind is not None:
        case.kind = payload.kind
    case.updated_at = datetime.now(UTC)
    session.flush()
    return _receipt(
        payload.operation_id,
        {"case_id": str(case.id), "title": case.title, "case_no": case.case_no, "kind": case.kind},
    )


def _h_case_status(session: Session, payload: CaseStatusIn, ctx: InvocationContext) -> CommandReceipt:
    case = _case(session, ctx)
    previous = case.status
    case.status = payload.status
    case.updated_at = datetime.now(UTC)
    session.flush()
    return _receipt(
        payload.operation_id,
        {"case_id": str(case.id), "previous_status": previous, "status": case.status, "note": payload.note},
    )


def _h_document_propose(session: Session, payload: DocumentProposeIn, ctx: InvocationContext) -> CommandReceipt:
    """patch_block / insert_block → 提案路径：kernel 补丁作用于组装全文，结果书正文入存储后开提案。"""
    doc = d._document_for(session, payload.document_id, ctx.principal_id)
    if doc.current_revision_id is None:
        raise CapabilityError("document has no revision to propose against")
    _case_obj, content = _case_content_md(session, doc.case_id)
    overlay = _figure_overlay(session, doc.case_id)
    try:
        if payload.action == "patch":
            if not payload.block_id or payload.markdown is None:
                raise CapabilityError("patch requires block_id and markdown")
            result = patch.patch_block(content, payload.block_id, payload.markdown, settings=overlay)
        else:
            result = patch.insert_block(
                content,
                payload.kind or "paragraph",
                after_block_id=payload.after_block_id,
                book=payload.book,
                markdown=payload.markdown,
                settings=overlay,
            )
    except patch.PatchError as exc:
        raise CapabilityError(f"patch rejected: {exc}") from exc
    new_body = docset.split(result.content).book(doc.book).strip("\n") + "\n"
    ref = _write(new_body.encode("utf-8"), "text/markdown")
    proposal = prop.create_proposal(
        session,
        doc.case_id,
        principal_id=ctx.principal_id,
        proposer_principal_id=ctx.principal_id,
        target_kind="document",
        target_revision_id=doc.current_revision_id,
        result_content_ref=ref,
    )
    return _receipt(
        payload.operation_id,
        {
            "proposal_id": str(proposal.id),
            "status": proposal.status,
            "document_id": str(doc.id),
            "book": doc.book,
            "changed_lines": result.changed_lines,
        },
    )


def _h_figure_reorder(session: Session, payload: FigureReorderIn, ctx: InvocationContext) -> CommandReceipt:
    case = _case(session, ctx)
    rows = list(
        session.scalars(
            select(fig_domain.FigureDocument).where(
                fig_domain.FigureDocument.case_id == case.id, fig_domain.FigureDocument.figure_no.is_not(None)
            )
        )
    )
    expected = {row.id for row in rows}
    given = list(payload.figure_ids)
    if len(set(given)) != len(given) or set(given) != expected:
        raise CapabilityError("figure_ids must be a permutation of all numbered figures in the case")
    by_id = {row.id: row for row in rows}
    for row in rows:
        row.figure_no = None
    session.flush()
    for i, figure_id in enumerate(given, 1):
        by_id[figure_id].figure_no = i
        by_id[figure_id].updated_at = datetime.now(UTC)
    session.flush()
    return _receipt(
        payload.operation_id, {"case_id": str(case.id), "order": [str(fid) for fid in given], "count": len(given)}
    )


def _h_proposal_submit(session: Session, payload: ProposalIdIn, ctx: InvocationContext) -> CommandReceipt:
    proposal = prop.submit_proposal(session, payload.proposal_id, principal_id=ctx.principal_id)
    return _receipt(payload.operation_id, {"proposal_id": str(proposal.id), "status": proposal.status})


def _h_proposal_withdraw(session: Session, payload: ProposalWithdrawIn, ctx: InvocationContext) -> CommandReceipt:
    proposal = prop.get_proposal(session, payload.proposal_id, principal_id=ctx.principal_id)
    if proposal.status == "draft":
        raise CapabilityError("draft proposals are not submitted yet; nothing to withdraw")
    if proposal.status != "submitted":
        raise CapabilityError(f"proposal is already {proposal.status}")
    proposal = prop.reject_proposal(session, payload.proposal_id, principal_id=ctx.principal_id)
    return _receipt(
        payload.operation_id,
        {"proposal_id": str(proposal.id), "status": proposal.status, "reason": payload.reason},
    )


def _h_work_item_create(session: Session, payload: WorkItemCreateIn, ctx: InvocationContext) -> CommandReceipt:
    item = wi.create_work_item(
        session,
        ctx.case_id,
        principal_id=ctx.principal_id,
        type=payload.type,
        title=payload.title,
        assignee_principal_id=payload.assignee_principal_id,
        deadline=payload.deadline,
        priority=payload.priority,
        document_id=payload.document_id,
        figure_document_id=payload.figure_document_id,
        release_id=payload.release_id,
        official_no=payload.official_no,
        oa_deadline=payload.oa_deadline,
        response_document_id=payload.response_document_id,
    )
    return _receipt(payload.operation_id, _work_item_row(item))


def _h_work_item_update(session: Session, payload: WorkItemUpdateIn, ctx: InvocationContext) -> CommandReceipt:
    item = wi._work_item_for(session, payload.work_item_id, ctx.principal_id)
    if item.status in {"done", "canceled"}:
        raise CapabilityError("terminal work item cannot be updated")
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.priority is not None:
        item.priority = payload.priority
    if payload.official_no is not None and item.type == "oa-response":
        item.official_no = payload.official_no
    if payload.assignee_principal_id is not None:
        item = wi.assign_work_item(
            session, item.id, principal_id=ctx.principal_id, assignee_principal_id=payload.assignee_principal_id
        )
    item.updated_at = datetime.now(UTC)
    session.flush()
    return _receipt(payload.operation_id, _work_item_row(item))


def _add_months(value: datetime, months: int) -> datetime:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _h_work_item_reschedule(session: Session, payload: WorkItemRescheduleIn, ctx: InvocationContext) -> CommandReceipt:
    item = wi._work_item_for(session, payload.work_item_id, ctx.principal_id)
    if (
        payload.deadline is None
        and not payload.clear_deadline
        and payload.extend_months is None
        and payload.oa_deadline is None
    ):
        raise CapabilityError("nothing to reschedule")
    if payload.deadline is not None or payload.clear_deadline:
        item = wi.reschedule_work_item(
            session,
            item.id,
            principal_id=ctx.principal_id,
            deadline=None if payload.clear_deadline else payload.deadline,
        )
    if payload.extend_months is not None:
        if item.type != "oa-response" or item.oa_deadline is None:
            raise CapabilityError("extend_months requires an oa-response item with an oa_deadline")
        item.oa_deadline = _add_months(item.oa_deadline, payload.extend_months)
        item.updated_at = datetime.now(UTC)
    if payload.oa_deadline is not None:
        if item.type != "oa-response":
            raise CapabilityError("oa_deadline requires an oa-response work item")
        item.oa_deadline = payload.oa_deadline
        item.updated_at = datetime.now(UTC)
    session.flush()
    return _receipt(payload.operation_id, _work_item_row(item))


def _h_work_item_transition(session: Session, payload: WorkItemTransitionIn, ctx: InvocationContext) -> CommandReceipt:
    item = wi.transition_work_item(session, payload.work_item_id, principal_id=ctx.principal_id, status=payload.status)
    return _receipt(payload.operation_id, _work_item_row(item))


def _h_release_build(session: Session, payload: EmptyCommandIn, ctx: InvocationContext) -> CommandReceipt:
    """build：组包三书 current revisions + 全部附图 current revisions → 封存 → kernel DOCX → artifact。"""
    case = _case(session, ctx)
    release = rel.create_release(session, case.id, principal_id=ctx.principal_id)
    packed = 0
    for book in ("abstract", "claims", "description"):
        doc = session.scalar(select(d.Document).where(d.Document.case_id == case.id, d.Document.book == book))
        if doc is None or doc.current_revision_id is None:
            continue
        rel.add_release_item(
            session,
            release.id,
            principal_id=ctx.principal_id,
            item_kind="document",
            revision_id=doc.current_revision_id,
        )
        packed += 1
    for figure in session.scalars(
        select(fig_domain.FigureDocument).where(fig_domain.FigureDocument.case_id == case.id)
    ):
        if figure.current_revision_id is None:
            continue
        rel.add_release_item(
            session,
            release.id,
            principal_id=ctx.principal_id,
            item_kind="figure",
            revision_id=figure.current_revision_id,
        )
        packed += 1
    rel.seal_release(session, release.id, principal_id=ctx.principal_id)
    filename, data, inputs = rel.render_release(session, release.id, principal_id=ctx.principal_id, read=_read)
    ref = _write(data, rel.DOCX_CONTENT_TYPE)
    artifact = rel.record_release_artifact(
        session, release.id, principal_id=ctx.principal_id, filename=filename, content_ref=ref, inputs=inputs
    )
    return _receipt(
        payload.operation_id,
        {
            "release_id": str(release.id),
            "artifact_id": str(artifact.id),
            "filename": artifact.filename,
            "size": artifact.content_size,
            "packed_items": packed,
        },
    )


def _h_note_add(session: Session, payload: NoteAddIn, ctx: InvocationContext) -> CommandReceipt:
    fact = mat.propose_fact(
        session,
        ctx.case_id,
        principal_id=ctx.principal_id,
        statement=payload.statement,
        material_id=payload.material_id,
        anchor_id=payload.anchor_id,
    )
    return _receipt(payload.operation_id, {"fact_id": str(fact.id), "status": fact.status, "statement": fact.statement})


# ---------------------------------------------------------------- 注册 ----


def _query(capability_id: str, risk: CapabilityRisk, scope: CapabilityScope, input_model, output_model, handler):
    AGENT_TOOL_REGISTRY.register(
        CapabilitySpec(
            id=capability_id,
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=risk,
            scope=scope,
            input_model=input_model,
            output_model=output_model,
            handler=handler,
        )
    )


def _command(capability_id: str, risk: CapabilityRisk, scope: CapabilityScope, input_model, handler, *, approval=False):
    AGENT_TOOL_REGISTRY.register(
        CapabilitySpec(
            id=capability_id,
            version="1.0.0",
            kind=CapabilityKind.COMMAND,
            risk=risk,
            scope=scope,
            input_model=input_model,
            output_model=CommandReceipt,
            handler=handler,
            requires_approval=approval,
        )
    )


CASE = CapabilityScope.CASE
ORG = CapabilityScope.ORGANIZATION
LOW, MED, HIGH = CapabilityRisk.LOW, CapabilityRisk.MEDIUM, CapabilityRisk.HIGH

_query("agent.case.get", LOW, CASE, EmptyQueryIn, CaseDetailOut, _h_case_get)
_query("agent.case.documents", LOW, CASE, EmptyQueryIn, DocumentListOut, _h_documents)
_query("agent.case.deadlines", LOW, CASE, EmptyQueryIn, WorkItemListOut, _h_deadlines)
_query("agent.case.operations", LOW, CASE, OperationsIn, OperationListOut, _h_operations)
_query("agent.case.runs", LOW, CASE, EmptyQueryIn, RunListOut, _h_runs)
_query("agent.case.proposals", LOW, CASE, ProposalsIn, ProposalListOut, _h_proposals)
_query("agent.case.figures", LOW, CASE, EmptyQueryIn, FigureListOut, _h_figures)
_query("agent.case.materials", LOW, CASE, MaterialsIn, MaterialListOut, _h_materials)
_query("agent.case.preflight", MED, CASE, EmptyQueryIn, ReportOut, _h_preflight)
_query("agent.case.lint", MED, CASE, EmptyQueryIn, ReportOut, _h_lint)
_query("agent.case.semantic", MED, CASE, EmptyQueryIn, SemanticOut, _h_semantic)
_query("agent.case.context", MED, CASE, ContextPackIn, ContextPackOut, _h_context_pack)
_query("agent.document.content", LOW, CASE, DocumentContentIn, DocumentContentOut, _h_document_content)
_query("agent.document.ast", MED, CASE, DocumentContentIn, DocumentAstOut, _h_document_ast)
_query("agent.document.revisions", LOW, CASE, RevisionsIn, RevisionListOut, _h_revisions)
_query("agent.material.content", LOW, CASE, MaterialContentIn, MaterialContentOut, _h_material_content)
_query("agent.workitem.get", LOW, CASE, WorkItemIdIn, WorkItemDetailOut, _h_work_item_get)
_query("agent.org.members", LOW, ORG, EmptyQueryIn, MemberListOut, _h_members)

_command("agent.case.create", MED, ORG, CaseCreateIn, _h_case_create)
_command("agent.case.update", MED, CASE, CaseUpdateIn, _h_case_update)
_command("agent.case.status", HIGH, CASE, CaseStatusIn, _h_case_status, approval=True)
_command("agent.document.propose", HIGH, CASE, DocumentProposeIn, _h_document_propose)
_command("agent.figure.reorder", MED, CASE, FigureReorderIn, _h_figure_reorder)
_command("agent.proposal.submit", MED, CASE, ProposalIdIn, _h_proposal_submit)
_command("agent.proposal.withdraw", MED, CASE, ProposalWithdrawIn, _h_proposal_withdraw)
_command("agent.workitem.create", MED, CASE, WorkItemCreateIn, _h_work_item_create)
_command("agent.workitem.update", MED, CASE, WorkItemUpdateIn, _h_work_item_update)
_command("agent.workitem.reschedule", MED, CASE, WorkItemRescheduleIn, _h_work_item_reschedule)
_command("agent.workitem.transition", MED, CASE, WorkItemTransitionIn, _h_work_item_transition)
_command("agent.release.build", HIGH, CASE, EmptyCommandIn, _h_release_build)
_command("agent.note.add", LOW, CASE, NoteAddIn, _h_note_add)


# ---------------------------------------------------------------- 旧工具对齐矩阵 ----

TOOL_CAPABILITY_MAP: dict[str, tuple[str, ...]] = {
    # tools.py
    "get_ast": ("agent.document.ast",),
    "get_docs": ("agent.case.documents", "agent.document.content"),
    "patch_block": ("agent.document.propose",),
    "insert_block": ("agent.document.propose",),
    "lint": ("agent.case.lint",),
    "preflight": ("agent.case.preflight",),
    "build": ("agent.release.build",),
    "export_xml": (),
    "add_comment": (),
    "get_history": ("agent.document.revisions",),
    # tools_figures.py
    "list_figures": ("agent.case.figures",),
    "set_figure_order": ("agent.figure.reorder",),
    "set_figure_width": (),
    "list_figure_sources": (),
    "get_figure_source": (),
    "put_figure_source": (),
    "delete_figure_source": (),
    # tools_case.py + case_summary
    "get_case": ("agent.case.get",),
    "set_case_status": ("agent.case.status",),
    "case_summary": ("agent.case.get",),
    # tools_attachments.py
    "list_attachments": ("agent.case.materials",),
    "read_attachment_text": ("agent.material.content",),
    # tools_semantic.py
    "get_claim_tree": ("agent.case.semantic",),
    "get_support_map": ("agent.case.semantic",),
    "get_figures": ("agent.case.semantic",),
    "get_terms": ("agent.case.semantic",),
    "context_pack": ("agent.case.context",),
    # tools_lifecycle.py 读面
    "get_settings": (),
    "get_deadlines": ("agent.case.deadlines",),
    "get_timeline": ("agent.case.operations",),
    "list_oa_rounds": ("agent.case.deadlines",),
    "get_oa_round": ("agent.workitem.get",),
    "list_comments": (),
    "list_public_links": (),
    "get_proposals": ("agent.case.proposals",),
    "list_audit": ("agent.case.operations",),
    "get_deliver_errors": ("agent.case.operations",),
    "prior_art_search": (),
    "list_tags": (),
    "list_templates": (),
    "get_template": (),
    "oa_parse": (),
    # tools_lifecycle.py 写面
    "create_project": ("agent.case.create",),
    "import_docx_path": (),
    "update_case": ("agent.case.update",),
    "put_settings": (),
    "deadline_done": ("agent.workitem.transition",),
    "update_deadline": ("agent.workitem.reschedule",),
    "create_oa_round": ("agent.workitem.create",),
    "update_oa_round": ("agent.workitem.update",),
    "extend_oa_round": ("agent.workitem.reschedule",),
    "delete_oa_round": ("agent.workitem.transition",),
    "add_note": ("agent.note.add",),
    "reply_comment": (),
    "resolve_comment": (),
    "delete_comment": (),
    "create_public_link": (),
    "revoke_public_link": (),
    "apply_proposal": ("agent.proposal.submit",),
    "dismiss_proposal": ("agent.proposal.withdraw",),
    "apply_template": (),
    "create_tag": (),
    "run_scenario": (),
    # tools_admin.py
    "list_org_members": ("agent.org.members",),
    "update_org_member": (),
    "get_org_settings": (),
    "put_org_settings": (),
    "set_org_name": (),
    "list_org_audit": (),
    # tools_novelty.py
    "get_novelty": (),
    "record_novelty": (),
    # B8 已对齐（AGENT_QUERY_REGISTRY 三项），列此仅为全集校验
    "list_projects": ("agent.case.list",),
    "read_book": ("agent.document.read", "agent.document.content"),
    "list_ai_jobs": ("agent.workitem.list", "agent.case.runs"),
}

NON_MIGRATED: dict[str, str] = {
    "export_xml": "CNIPA XML 导出依赖 LibreOffice docx2pdf + pdftoppm 外部工具链，新侧 release build 只产 DOCX",
    "add_comment": "批注域（comments 台账）未迁移，B10/B12 报告已列为缺口",
    "list_comments": "批注域未迁移",
    "reply_comment": "批注域未迁移",
    "resolve_comment": "批注域未迁移",
    "delete_comment": "批注域未迁移",
    "set_figure_width": "图宽元数据是旧 figures.md 台账字段，FigureDocument 无对应列",
    "list_figure_sources": "Mermaid 绘制图源（figs-src/*.mmd）域未迁移",
    "get_figure_source": "Mermaid 绘制图源域未迁移",
    "put_figure_source": "Mermaid 绘制图源域未迁移",
    "delete_figure_source": "Mermaid 绘制图源域未迁移",
    "list_public_links": "公开分享面未启用，PublicShareLink 仅为身份兼容表、无新侧写入",
    "create_public_link": "公开分享面未启用",
    "revoke_public_link": "公开分享面未启用",
    "get_settings": "编辑器/项目 settings 域未建（编号/样式仍 kernel 参数化）",
    "put_settings": "settings 域未建",
    "get_org_settings": "机构 settings 域未建",
    "put_org_settings": "机构 settings 域未建",
    "prior_art_search": "外部检索服务依赖未迁移",
    "list_tags": "标签域未建",
    "create_tag": "标签域未建",
    "list_templates": "模板库域未建",
    "get_template": "模板库域未建",
    "apply_template": "模板库域未建",
    "oa_parse": "OA 文本解析器在旧 app 层，kernel 无对应模块",
    "import_docx_path": "服务端路径导入对 agent 是文件系统越权面；新侧走 multipart 上传/importer CLI",
    "run_scenario": "内部测试场景运行器，非产品能力",
    "update_org_member": "权限变更需机构级审批面；Run/Approval 只覆盖案件域，fail-closed 不开放",
    "set_org_name": "机构元数据变更无审批面，fail-closed 不开放",
    "list_org_audit": "OrgAuditEvent 无新侧写入者，空表查询无意义",
    "get_novelty": "查新台账（novelty.jsonl）域未建；facts 是确认流语义不等同",
    "record_novelty": "查新台账域未建",
}
