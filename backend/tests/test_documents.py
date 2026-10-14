# -*- coding: utf-8 -*-
"""Document / Revision / WorkingCopy domain tests on disposable PostgreSQL databases."""

import os
import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from patent_studio.domain.documents import (
    DocumentAuthorizationError,
    DocumentConflict,
    DocumentNotFound,
    RevisionConflict,
    RevisionImmutableError,
    WorkingCopyConflict,
    commit_working_copy,
    create_document,
    create_revision,
    get_document,
    get_working_copy,
    list_revisions,
    open_working_copy,
    save_working_copy,
)
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import object_ref

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"),
    reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL",
)


@pytest.fixture()
def db(pg_schema):
    engine = create_engine(database_url(pg_schema))
    try:
        yield engine
    finally:
        engine.dispose()


def _user(label: str) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:12]}@documents.example",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
        display_name=label,
    )


def _case(session: Session, label: str) -> tuple[Organization, Case, Principal]:
    user = _user(label)
    session.add(user)
    session.flush()
    principal = Principal(kind="human", user_id=user.id, display_name=label)
    session.add(principal)
    session.flush()
    organization = Organization(
        slug=f"doc-{uuid.uuid4().hex[:10]}",
        name=f"机构-{label}",
        created_by_principal_id=principal.id,
    )
    session.add(organization)
    session.flush()
    session.add(
        OrganizationMembership(
            organization_id=organization.id,
            principal_id=principal.id,
            role="owner",
            status="active",
        )
    )
    session.flush()
    case = Case(
        organization_id=organization.id,
        case_key=f"DOC-{uuid.uuid4().hex[:8]}",
        title=f"案件-{label}",
        created_by_principal_id=principal.id,
    )
    session.add(case)
    session.flush()
    session.add(CaseParticipant(case_id=case.id, principal_id=principal.id, role="attorney"))
    session.commit()
    return organization, case, principal


def _ref(text: str):
    return object_ref(text.encode(), "text/markdown")


def test_document_tables_migrated(db):
    assert {"documents", "document_revisions", "working_copies"} <= set(inspect(db).get_table_names())


def test_document_revision_chain_is_ordered_and_immutable(db):
    with Session(db) as session:
        _organization, case, owner = _case(session, "owner")
        document = create_document(session, case.id, book="claims", principal_id=owner.id)
        first = create_revision(
            session,
            document.id,
            author_principal_id=owner.id,
            content_ref=_ref("claims v1"),
            source="manual",
        )
        second = create_revision(
            session,
            document.id,
            author_principal_id=owner.id,
            content_ref=_ref("claims v2"),
            source="agent",
            parent_revision_id=first.id,
        )
        session.commit()

        assert [(row.revision_no, row.parent_revision_id) for row in list_revisions(
            session, document.id, principal_id=owner.id
        )] == [(1, None), (2, first.id)]
        assert get_document(session, document.id, principal_id=owner.id).current_revision_id == second.id
        assert second.content_ref.sha256 == _ref("claims v2").sha256

        second.content_key = "sha256/00/00/" + "0" * 64
        with pytest.raises(RevisionImmutableError):
            session.flush()
        session.rollback()
        with pytest.raises(RevisionConflict):
            create_revision(
                session,
                document.id,
                author_principal_id=owner.id,
                content_ref=_ref("stale branch"),
                parent_revision_id=first.id,
            )
        with pytest.raises(DocumentConflict):
            create_document(session, case.id, book="claims", principal_id=owner.id)


def test_working_copy_save_commit_and_fencing(db):
    with Session(db) as session:
        _organization, case, owner = _case(session, "owner")
        document = create_document(session, case.id, book="description", principal_id=owner.id)
        first = create_revision(
            session,
            document.id,
            author_principal_id=owner.id,
            content_ref=_ref("description v1"),
        )
        copy = open_working_copy(session, document.id, principal_id=owner.id)
        stale_copy = open_working_copy(session, document.id, principal_id=owner.id)
        session.commit()

        saved = save_working_copy(
            session,
            copy.id,
            principal_id=owner.id,
            expected_version=1,
            content_ref=_ref("description draft"),
        )
        assert saved.version == 2 and saved.base_revision_id == first.id
        with pytest.raises(WorkingCopyConflict):
            save_working_copy(
                session,
                copy.id,
                principal_id=owner.id,
                expected_version=1,
                content_ref=_ref("old draft"),
            )

        committed = commit_working_copy(
            session,
            copy.id,
            principal_id=owner.id,
            expected_version=2,
        )
        session.commit()
        assert committed.revision_no == 2 and committed.parent_revision_id == first.id
        refreshed = get_working_copy(session, copy.id, principal_id=owner.id)
        assert refreshed.base_revision_id == committed.id and refreshed.version == 3
        with pytest.raises(RevisionConflict):
            commit_working_copy(session, stale_copy.id, principal_id=owner.id, expected_version=1)


def test_working_copy_and_document_access_are_case_scoped(db):
    with Session(db) as session:
        _org_a, case_a, owner_a = _case(session, "a")
        _org_b, case_b, owner_b = _case(session, "b")
        document_a = create_document(session, case_a.id, book="abstract", principal_id=owner_a.id)
        copy_a = open_working_copy(session, document_a.id, principal_id=owner_a.id, content_ref=_ref("abstract"))
        session.commit()

        with pytest.raises(DocumentAuthorizationError):
            get_document(session, document_a.id, principal_id=owner_b.id)
        with pytest.raises(DocumentAuthorizationError):
            open_working_copy(session, document_a.id, principal_id=owner_b.id)
        with pytest.raises(DocumentAuthorizationError):
            get_working_copy(session, copy_a.id, principal_id=owner_b.id)
        with pytest.raises(DocumentNotFound):
            get_document(session, uuid.uuid4(), principal_id=owner_a.id)
        assert case_b.id != case_a.id
