# -*- coding: utf-8 -*-
"""旧文件目录 → 新模型一次性迁移导入器（方案 Stage 6）。

旧案件目录形态（以 app/domain/projects.py / kernel.content / kernel.figures_md 为准）：
    <dir>/content.md        三书合一 Markdown（# 标题 / ## 摘要 / ## 权利要求书 / ## 说明书）
    <dir>/content.txt       更旧的行式格式（kernel.content.load_content 保留，仅迁移用）
    <dir>/docs/figures.md   附图顺序 / 宽度 / 摘要图真源；缺失时退回 studio.json 旧字段，再退回 figs/ 推断
    <dir>/studio.json       设置（含旧 spec_figures / abstract_figure）
    <dir>/figs/             附图字节
    .studio/、attachments/、figs-src/、docs/ 其它文件、content.md.bak-* 等 → 辅助件，不进新模型

导入产物：Case + 三个 Document（abstract/claims/description，首 revision source='migration'）
+ FigureDocument/FigureRevision（source='migration'）+ 可选 working copy。
内容字节一律经 ObjectStore.put，ObjectRef 语义与 object_ref 一致（sha256 寻址）。

两段式：plan_directory() 纯函数产出确定性 ImportPlan（dry-run 不落库、两次运行相等）；
execute_import() 在既有事务里执行计划，异常由调用方回滚，不写半个案件。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from patent_studio.domain import documents as doc_domain
from patent_studio.domain import figures as fig_domain
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.storage import ObjectStore
from patent_studio.kernel import content as kernel_content
from patent_studio.kernel import figures_md

FIG_EXTS = (".emf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".svg")
DOCX_FIG_EXTS = (".emf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff")

CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
    ".emf": "image/x-emf",
}
MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8"

BOOK_SECTIONS = {"摘要": "abstract", "权利要求书": "claims", "说明书": "description"}

_AUX_DIRS = (".studio", "attachments", "figs-src", "docs")


class ImportPlanError(ValueError):
    """旧目录不可导入：缺 content.md、三书节缺失或结构无法解析。"""


class ImportConflict(ValueError):
    """case_key 已被非迁移来源的案件占用。"""


@dataclass(frozen=True)
class BookPlan:
    book: str
    text: str
    sha256: str
    size: int


@dataclass(frozen=True)
class FigurePlan:
    file: str
    kind: str  # "spec" | "abstract"
    figure_no: int | None
    title: str
    width: float
    sha256: str
    size: int
    content_type: str


@dataclass(frozen=True)
class SkippedEntry:
    path: str
    reason: str  # "auxiliary" | "unrecognized" | "unreferenced" | "missing"


@dataclass(frozen=True)
class ImportPlan:
    source_dir: str
    title: str
    books: tuple[BookPlan, ...]
    figures: tuple[FigurePlan, ...]
    skipped: tuple[SkippedEntry, ...]
    warnings: tuple[str, ...] = field(default=())


@dataclass(frozen=True)
class ImportResult:
    case_id: uuid.UUID
    case_key: str
    title: str
    status: str  # "imported" | "existing"
    documents: dict[str, uuid.UUID]
    revisions: dict[str, uuid.UUID]
    figures: dict[str, uuid.UUID]  # "spec|abstract:<file>" -> figure_document_id
    working_copies: dict[str, uuid.UUID]


def _fig_sort_key(name: str) -> tuple[int, str]:
    m = re.search(r"(\d+)", name)
    return (int(m.group(1)) if m else 10**9, name)


def _list_fig_files(figs_dir: Path) -> list[str]:
    if not figs_dir.is_dir():
        return []
    return sorted(
        (f.name for f in figs_dir.iterdir() if f.is_file() and f.name.lower().endswith(FIG_EXTS)),
        key=_fig_sort_key,
    )


def _legacy_content_text(project_dir: Path) -> str | None:
    """content.txt 行式旧格式 → 经 load_content + dump_md 还原为 content.md 文本。"""
    legacy = project_dir / "content.txt"
    if not legacy.is_file():
        return None
    try:
        title, abstract, claims, spec = kernel_content.load_content(str(legacy))
    except (KeyError, IndexError, ValueError) as e:
        raise ImportPlanError(f"content.txt 无法解析：{e}") from e
    with tempfile.NamedTemporaryFile("r", encoding="utf-8", suffix=".md", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        kernel_content.dump_md(tmp_path, title, abstract, claims, spec)
        return Path(tmp_path).read_text(encoding="utf-8")
    finally:
        os.unlink(tmp_path)


def _split_book_sections(text: str) -> dict[str, str]:
    """content.md → 各书正文（按 '## ' 节头切分，节体逐字节保留，去掉首尾空行）。"""
    sections: dict[str, list[str]] = {}
    cur = None
    for ln in text.rstrip("\n").split("\n"):
        if ln.startswith("## "):
            cur = ln[3:].strip()
        elif ln.startswith("# "):
            cur = None
        elif cur is not None:
            sections.setdefault(cur, []).append(ln)
    return {book: ("\n".join(sections.get(head, [])).strip("\n") + "\n") for head, book in BOOK_SECTIONS.items()}


def _figures_doc(project_dir: Path, content_text: str) -> figures_md.FiguresDoc:
    """docs/figures.md → studio.json 旧字段 → figs/ 推断（与 ProjectStore.load_figures 同优先级）。"""
    fmd = project_dir / "docs" / "figures.md"
    if fmd.is_file():
        return figures_md.parse(fmd.read_text(encoding="utf-8"))
    raw: dict = {}
    settings_file = project_dir / "studio.json"
    if settings_file.is_file():
        try:
            parsed = json.loads(settings_file.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                raw = parsed
        except ValueError:
            raw = {}
    if raw.get("spec_figures") or raw.get("abstract_figure"):
        return figures_md.from_legacy(raw.get("spec_figures") or [], raw.get("abstract_figure"), content_text)
    return figures_md.infer(_list_fig_files(project_dir / "figs"), DOCX_FIG_EXTS)


def plan_directory(project_dir: str | os.PathLike[str]) -> ImportPlan:
    """扫描旧案件目录产出确定性导入计划；不可导入时抛 ImportPlanError。纯函数，不写库不写存储。"""
    root = Path(project_dir)
    if not root.is_dir():
        raise ImportPlanError(f"目录不存在：{project_dir}")
    md_path = root / "content.md"
    if md_path.is_file():
        content_text = md_path.read_text(encoding="utf-8")
        source_label = "content.md"
    else:
        converted = _legacy_content_text(root)
        if converted is None:
            raise ImportPlanError("缺少 content.md（且无可转换的 content.txt）")
        content_text, source_label = converted, "content.txt→md"

    title, abstract, claims, spec = kernel_content.parse_md(content_text)
    missing = [
        name
        for name, value in (("标题", title), ("摘要", abstract), ("权利要求书", claims), ("说明书", spec))
        if not value
    ]
    if missing:
        raise ImportPlanError(f"{source_label} 缺少必要章节：{'、'.join(missing)}")

    books = tuple(
        BookPlan(
            book=book,
            text=text,
            sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            size=len(text.encode("utf-8")),
        )
        for book, text in _split_book_sections(content_text).items()
    )

    warnings: list[str] = []
    skipped: list[SkippedEntry] = []
    figs_dir = root / "figs"
    fig_doc = _figures_doc(root, content_text)
    for no, line in fig_doc.bad_lines:
        warnings.append(f"figures.md 第{no}行无法识别：{line.strip()!r}")

    figures: list[FigurePlan] = []
    referenced: set[str] = set()
    for kind, seq in (("spec", fig_doc.spec), ("abstract", [fig_doc.abstract] if fig_doc.abstract else [])):
        for i, fig in enumerate(seq, 1):
            referenced.add(fig.file)
            data_path = figs_dir / fig.file
            if not data_path.is_file():
                skipped.append(SkippedEntry(path=f"figs/{fig.file}", reason="missing"))
                warnings.append(f"附图文件缺失：figs/{fig.file}")
                continue
            data = data_path.read_bytes()
            figures.append(
                FigurePlan(
                    file=fig.file,
                    kind=kind,
                    figure_no=i if kind == "spec" else None,
                    title=fig.alt if kind == "spec" else (fig.alt or "摘要附图"),
                    width=fig.width,
                    sha256=hashlib.sha256(data).hexdigest(),
                    size=len(data),
                    content_type=CONTENT_TYPES.get(Path(fig.file).suffix.lower(), "application/octet-stream"),
                )
            )
    for name in _list_fig_files(figs_dir):
        if name not in referenced:
            skipped.append(SkippedEntry(path=f"figs/{name}", reason="unreferenced"))

    recognized = {"content.md", "content.txt", "studio.json"}
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        name = entry.name
        if name in recognized or name in ("figs",):
            continue
        if entry.is_dir() and name in _AUX_DIRS:
            skipped.append(SkippedEntry(path=name + "/", reason="auxiliary"))
        elif name.startswith("content.md.bak-"):
            skipped.append(SkippedEntry(path=name, reason="auxiliary"))
        else:
            skipped.append(SkippedEntry(path=name + ("/" if entry.is_dir() else ""), reason="unrecognized"))
            warnings.append(f"无法识别的文件：{name}")

    return ImportPlan(
        source_dir=str(root),
        title=title.strip(),
        books=books,
        figures=tuple(figures),
        skipped=tuple(skipped),
        warnings=tuple(warnings),
    )


def _case_by_key(session: Session, organization_id: uuid.UUID, case_key: str) -> Case | None:
    return session.scalar(select(Case).where(Case.organization_id == organization_id, Case.case_key == case_key))


def _has_migration_revision(session: Session, case_id: uuid.UUID) -> bool:
    return (
        session.scalar(
            select(doc_domain.Revision.id)
            .join(doc_domain.Document, doc_domain.Revision.document_id == doc_domain.Document.id)
            .where(doc_domain.Document.case_id == case_id, doc_domain.Revision.source == "migration")
            .limit(1)
        )
        is not None
    )


async def execute_import(
    session: Session,
    store: ObjectStore,
    plan: ImportPlan,
    *,
    organization_id: uuid.UUID,
    principal_id: uuid.UUID,
    case_key: str,
    kind: str = "invention",
    with_working_copy: bool = False,
) -> ImportResult:
    """执行导入计划；幂等：同 (org, case_key) 且已有 migration revision → 返回既有案件不再写入。

    调用方负责事务边界（session.begin()/rollback/commit）；任何异常都留给调用方回滚，
    本函数自身不吞异常、不写半成品。
    """
    principal = session.get(Principal, principal_id)
    if principal is None:
        raise ImportPlanError("principal 不存在")
    organization = session.get(Organization, organization_id)
    if organization is None:
        raise ImportPlanError("organization 不存在")
    member = session.scalar(
        select(OrganizationMembership.principal_id).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.principal_id == principal_id,
            OrganizationMembership.status == "active",
        )
    )
    if member is None:
        raise ImportPlanError("principal 不是该机构的 active 成员")

    existing = _case_by_key(session, organization_id, case_key)
    if existing is not None:
        if _has_migration_revision(session, existing.id):
            return ImportResult(
                case_id=existing.id,
                case_key=case_key,
                title=existing.title,
                status="existing",
                documents={},
                revisions={},
                figures={},
                working_copies={},
            )
        raise ImportConflict(f"case_key {case_key!r} 已被该机构中非迁移案件占用")

    case = Case(
        organization_id=organization_id,
        case_key=case_key,
        title=plan.title,
        kind=kind,
        created_by_principal_id=principal_id,
    )
    session.add(case)
    session.flush()
    session.add(CaseParticipant(case_id=case.id, principal_id=principal_id, role="case_manager"))
    session.flush()

    documents: dict[str, uuid.UUID] = {}
    revisions: dict[str, uuid.UUID] = {}
    working_copies: dict[str, uuid.UUID] = {}
    for book_plan in plan.books:
        document = doc_domain.create_document(
            session,
            case.id,
            book=book_plan.book,
            principal_id=principal_id,  # type: ignore[arg-type]
        )
        ref = await store.put(book_plan.text.encode("utf-8"), MARKDOWN_CONTENT_TYPE)
        revision = doc_domain.create_revision(
            session,
            document.id,
            author_principal_id=principal_id,
            content_ref=ref,
            source="migration",
        )
        documents[book_plan.book] = document.id
        revisions[book_plan.book] = revision.id
        if with_working_copy:
            wc = doc_domain.open_working_copy(session, document.id, principal_id=principal_id)
            working_copies[book_plan.book] = wc.id

    book_to_doc = {b.book: documents[b.book] for b in plan.books}
    figures: dict[str, uuid.UUID] = {}
    for fig_plan in plan.figures:
        host_book = "description" if fig_plan.kind == "spec" else "abstract"
        figure = fig_domain.create_figure_document(
            session,
            case.id,
            principal_id=principal_id,
            document_id=book_to_doc.get(host_book),
            anchor=f"figs/{fig_plan.file}",
            figure_no=fig_plan.figure_no,
            title=fig_plan.title,
        )
        data = (Path(plan.source_dir) / "figs" / fig_plan.file).read_bytes()
        ref = await store.put(data, fig_plan.content_type)
        fig_domain.create_figure_revision(
            session,
            figure.id,
            author_principal_id=principal_id,
            content_ref=ref,
            source="migration",
        )
        figures[f"{fig_plan.kind}:{fig_plan.file}"] = figure.id

    return ImportResult(
        case_id=case.id,
        case_key=case_key,
        title=plan.title,
        status="imported",
        documents=documents,
        revisions=revisions,
        figures=figures,
        working_copies=working_copies,
    )


def resolve_principal_id(session: Session, ident: str) -> uuid.UUID:
    """CLI 归属解析：Principal UUID 或用户 email。"""
    try:
        pid = uuid.UUID(ident)
    except ValueError:
        pid = None
    if pid is not None and session.get(Principal, pid) is not None:
        return pid
    principal = session.scalar(select(Principal).join(User, User.id == Principal.user_id).where(User.email == ident))
    if principal is None:
        raise ImportPlanError(f"找不到 principal：{ident!r}（可传 Principal UUID 或用户 email）")
    return principal.id


def resolve_organization_id(session: Session, ident: str) -> uuid.UUID:
    """CLI 归属解析：Organization UUID 或 slug。"""
    try:
        oid = uuid.UUID(ident)
    except ValueError:
        oid = None
    org = (
        session.get(Organization, oid)
        if oid is not None
        else session.scalar(select(Organization).where(Organization.slug == ident.lower()))
    )
    if org is None:
        raise ImportPlanError(f"找不到 organization：{ident!r}（可传 UUID 或 slug）")
    return org.id
