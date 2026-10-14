# -*- coding: utf-8 -*-
"""迁移导入器验收：真实 PostgreSQL + file:// 对象存储，旧案件目录 → 新模型。"""

import asyncio
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from test_documents import _case

from patent_studio.domain.documents import Document, Revision, WorkingCopy
from patent_studio.domain.figures import FigureDocument, FigureRevision
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.importer import (
    ImportConflict,
    ImportPlanError,
    execute_import,
    plan_directory,
    resolve_organization_id,
    resolve_principal_id,
)
from patent_studio.domain.organization import Case
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import open_store

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)


@pytest.fixture()
def db(pg_schema):
    engine = create_engine(database_url(pg_schema))
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def store(tmp_path):
    return open_store(f"file://{tmp_path / 'objects'}")


CONTENT_MD = """# 一种腐蚀监测系统及方法

## 摘要

本发明公开了一种腐蚀监测系统及方法，涉及结构健康监测技术领域。

## 权利要求书

1.一种腐蚀监测系统，其特征在于，包括感知单元。

2.根据权利要求1所述的系统，其特征在于，所述感知单元采集多模态信号。

## 说明书

### 技术领域

本发明涉及结构健康监测技术领域。

### 附图说明

图1为系统总体框图。
"""

FIGURES_MD = """# 说明书附图

![图1 系统总体框图](figs/fig1.png){width=15}
![图2 信号流图](figs/fig2.png){width=12}

# 摘要附图

![](figs/fig1.png){width=14.5}
"""


def _old_dir(tmp_path: Path, *, with_figures_md: bool = True) -> Path:
    d = tmp_path / "legacy-case-01"
    (d / "figs").mkdir(parents=True)
    (d / "docs").mkdir()
    (d / ".studio").mkdir()
    (d / "attachments").mkdir()
    (d / "content.md").write_text(CONTENT_MD, encoding="utf-8")
    if with_figures_md:
        (d / "docs" / "figures.md").write_text(FIGURES_MD, encoding="utf-8")
    (d / "figs" / "fig1.png").write_bytes(b"PNG1\x89fakedata")
    (d / "figs" / "fig2.png").write_bytes(b"PNG2\x89fakedata")
    (d / "figs" / "orphan.bmp").write_bytes(b"BMP-orphan")  # 未被 figures.md 引用
    (d / "figs-src").mkdir()
    (d / "readme.doc").write_bytes(b"noise")  # 无法识别的文件
    (d / "content.md.bak-20240101").write_text("old", encoding="utf-8")
    (d / "studio.json").write_text('{"abstract_limit": 300, "ai_enabled": true}', encoding="utf-8")
    return d


def _import(session, store, plan, org, principal, **kw):
    return asyncio.run(
        execute_import(
            session,
            store,
            plan,
            organization_id=org.id,
            principal_id=principal.id,
            case_key=kw.pop("case_key", "IMP-0001"),
            **kw,
        )
    )


def test_plan_is_deterministic_and_splits_books(tmp_path):
    d = _old_dir(tmp_path)
    p1, p2 = plan_directory(d), plan_directory(d)
    assert p1 == p2  # 同一输入两次 dry-run 计划一致
    assert p1.title == "一种腐蚀监测系统及方法"
    books = {b.book: b for b in p1.books}
    assert set(books) == {"abstract", "claims", "description"}
    assert "多模态信号" in books["claims"].text and "权利要求书" not in books["claims"].text
    assert "### 技术领域" in books["description"].text
    assert "腐蚀监测系统及方法" in books["abstract"].text
    figs = {(f.kind, f.figure_no): f for f in p1.figures}
    assert ("spec", 1) in figs and ("spec", 2) in figs and ("abstract", None) in figs
    skipped = {(s.path, s.reason) for s in p1.skipped}
    assert ("figs/orphan.bmp", "unreferenced") in skipped
    assert ("readme.doc", "unrecognized") in skipped
    assert (".studio/", "auxiliary") in skipped and ("attachments/", "auxiliary") in skipped
    assert ("content.md.bak-20240101", "auxiliary") in skipped
    assert any("readme.doc" in w for w in p1.warnings)


def test_import_lands_case_documents_figures(db, store, tmp_path):
    d = _old_dir(tmp_path)
    plan = plan_directory(d)
    with Session(db) as session:
        org, _existing_case, owner = _case(session, "imp-owner")
        result = _import(session, store, plan, org, owner)
        session.commit()
        assert result.status == "imported"
        case = session.get(Case, result.case_id)
        assert case.title == "一种腐蚀监测系统及方法" and case.case_key == "IMP-0001"

        docs = session.scalars(select(Document).where(Document.case_id == case.id)).all()
        assert {doc.book for doc in docs} == {"abstract", "claims", "description"}
        revs = session.scalars(
            select(Revision).join(Document, Revision.document_id == Document.id).where(Document.case_id == case.id)
        ).all()
        assert len(revs) == 3 and all(r.source == "migration" and r.revision_no == 1 for r in revs)
        rev_by_doc = {r.document_id: r for r in revs}
        books = {b.book: b for b in plan.books}
        for doc in docs:
            rev = rev_by_doc[doc.id]
            assert rev.content_sha256 == books[doc.book].sha256
            assert asyncio.run(store.get(rev.content_key)).decode("utf-8") == books[doc.book].text

        fig_docs = session.scalars(select(FigureDocument).where(FigureDocument.case_id == case.id)).all()
        assert sorted(fd.figure_no or 0 for fd in fig_docs) == [0, 1, 2]
        fig_revs = session.scalars(
            select(FigureRevision)
            .join(FigureDocument, FigureRevision.figure_document_id == FigureDocument.id)
            .where(FigureDocument.case_id == case.id)
        ).all()
        assert len(fig_revs) == 3 and all(r.source == "migration" for r in fig_revs)
        stored = {asyncio.run(store.get(r.content_key)): None for r in fig_revs}
        assert {b"PNG1\x89fakedata", b"PNG2\x89fakedata"} <= set(stored)
        spec_fig = next(fd for fd in fig_docs if fd.figure_no == 1)
        assert spec_fig.title == "图1 系统总体框图"
        desc_id = next(doc.id for doc in docs if doc.book == "description")
        assert spec_fig.document_id == desc_id and spec_fig.anchor == "figs/fig1.png"


def test_import_is_idempotent_by_case_key(db, store, tmp_path):
    d = _old_dir(tmp_path)
    plan = plan_directory(d)
    with Session(db) as session:
        org, _c, owner = _case(session, "imp-idem")
        first = _import(session, store, plan, org, owner)
        session.commit()
        second = _import(session, store, plan, org, owner)
        session.commit()
        assert second.status == "existing" and second.case_id == first.case_id
        cases = session.scalars(select(Case).where(Case.organization_id == org.id, Case.case_key == "IMP-0001")).all()
        assert len(cases) == 1
        assert (
            session.scalar(
                select(func.count())
                .select_from(Revision)
                .join(Document, Revision.document_id == Document.id)
                .where(Document.case_id == first.case_id)
            )
            == 3
        )


def test_import_conflicts_with_non_migration_case(db, store, tmp_path):
    d = _old_dir(tmp_path)
    plan = plan_directory(d)
    with Session(db) as session:
        org, case, owner = _case(session, "imp-conflict")
        case.case_key = "IMP-0001"  # 占住键但不是迁移产物
        session.flush()
        with pytest.raises(ImportConflict):
            _import(session, store, plan, org, owner)
        session.rollback()
        assert session.scalar(select(func.count()).select_from(Document).where(Document.case_id == case.id)) == 0


def test_import_rejects_unparseable_directory(db, store, tmp_path):
    bad = tmp_path / "bad-case"
    bad.mkdir()
    (bad / "content.md").write_text("没有章节头的纯文本", encoding="utf-8")
    with pytest.raises(ImportPlanError):
        plan_directory(bad)
    missing = tmp_path / "empty-case"
    missing.mkdir()
    with pytest.raises(ImportPlanError):
        plan_directory(missing)
    with pytest.raises(ImportPlanError):
        plan_directory(tmp_path / "does-not-exist")


def test_bad_plan_writes_nothing(db, store, tmp_path):
    bad = tmp_path / "bad2"
    bad.mkdir()
    (bad / "content.md").write_text("# 只有标题没有节\n", encoding="utf-8")
    with Session(db) as session:
        org, _c, owner = _case(session, "imp-bad")
        before_cases = session.scalar(select(func.count()).select_from(Case))
        before_docs = session.scalar(select(func.count()).select_from(Document))
        # 坏输入在 plan_directory 阶段即抛错，execute_import 根本不会被调用 → 零写入
        with pytest.raises(ImportPlanError):
            plan_directory(bad)
        session.flush()
        assert session.scalar(select(func.count()).select_from(Case)) == before_cases
        assert session.scalar(select(func.count()).select_from(Document)) == before_docs


def test_legacy_content_txt_fallback(db, store, tmp_path):
    d = tmp_path / "txt-case"
    (d / "figs").mkdir(parents=True)
    (d / "content.txt").write_text(
        "#TITLE\n老系统标题\n#ABSTRACT\n旧摘要一句话。\n#CLAIMS\n1.旧权利要求一。\n#SPEC\n[H]技术领域\n旧说明书正文。\n",
        encoding="utf-8",
    )
    plan = plan_directory(d)
    assert plan.title == "老系统标题"
    assert {b.book for b in plan.books} == {"abstract", "claims", "description"}
    with Session(db) as session:
        org, _c, owner = _case(session, "imp-txt")
        result = _import(session, store, plan, org, owner, case_key="IMP-TXT")
        session.commit()
        assert result.status == "imported"
        rev = session.scalar(
            select(Revision).join(Document, Revision.document_id == Document.id).where(Document.book == "claims")
        )
        assert asyncio.run(store.get(rev.content_key)).decode("utf-8").strip() == "1.旧权利要求一。"


def test_with_working_copy_and_resolvers(db, store, tmp_path):
    d = _old_dir(tmp_path)
    plan = plan_directory(d)
    with Session(db) as session:
        org, _c, owner = _case(session, "imp-wc")
        email = session.scalar(
            select(User.email).join(Principal, Principal.user_id == User.id).where(Principal.id == owner.id)
        )
        assert resolve_principal_id(session, str(owner.id)) == owner.id
        assert resolve_principal_id(session, email) == owner.id
        assert resolve_organization_id(session, org.slug) == org.id
        assert resolve_organization_id(session, str(org.id)) == org.id
        result = _import(session, store, plan, org, owner, case_key="IMP-WC", with_working_copy=True)
        session.commit()
        wcs = session.scalars(
            select(WorkingCopy)
            .join(Document, WorkingCopy.document_id == Document.id)
            .where(Document.case_id == result.case_id)
        ).all()
        assert len(wcs) == 3 and all(wc.principal_id == owner.id for wc in wcs)


def test_cli_dry_run_and_missing_db(tmp_path, capsys):
    from patent_studio.cli import main

    d = _old_dir(tmp_path)
    assert main(["import", str(d), "--org", "x", "--principal", "y", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "一种腐蚀监测系统及方法" in out and "unreferenced" in out
    # 无数据库配置 → 非 dry-run 报清晰错误（conftest 默认摘掉 PATENT_STUDIO_DATABASE_URL）
    assert main(["import", str(d), "--org", "x", "--principal", "y"]) == 2
    assert "数据库" in capsys.readouterr().err
    assert main(["import", str(tmp_path / "nope"), "--org", "x", "--principal", "y", "--dry-run"]) == 2
