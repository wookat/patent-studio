# -*- coding: utf-8 -*-
"""Figures, Proposal/ChangeSet and Release domain acceptance on real PostgreSQL."""

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from test_documents import _case, _ref

from patent_studio.domain.documents import DocumentAuthorizationError, create_document, create_revision
from patent_studio.domain.figures import (
    FigureConflict,
    FigureRevisionImmutableError,
    create_figure_document,
    create_figure_revision,
    list_figure_revisions,
)
from patent_studio.domain.proposals import (
    ProposalAuthorizationError,
    ProposalConflict,
    accept_proposal,
    add_change,
    create_proposal,
    reject_proposal,
    submit_proposal,
)
from patent_studio.domain.releases import ReleaseConflict, add_release_item, create_release, seal_release
from patent_studio.infra.db import database_url

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


def test_figure_revision_chain_is_immutable_and_case_scoped(db):
    with Session(db) as session:
        _org_a, case_a, owner_a = _case(session, "figure-a")
        _org_b, case_b, owner_b = _case(session, "figure-b")
        figure = create_figure_document(
            session, case_a.id, principal_id=owner_a.id, figure_no=1, title="系统图"
        )
        first = create_figure_revision(
            session, figure.id, author_principal_id=owner_a.id, content_ref=_ref("svg-v1")
        )
        second = create_figure_revision(
            session,
            figure.id,
            author_principal_id=owner_a.id,
            content_ref=_ref("svg-v2"),
            parent_revision_id=first.id,
            source="agent",
        )
        session.commit()
        assert [(r.revision_no, r.parent_revision_id) for r in list_figure_revisions(
            session, figure.id, principal_id=owner_a.id
        )] == [(1, None), (2, first.id)]
        second.content_key = "sha256/00/00/" + "0" * 64
        with pytest.raises(FigureRevisionImmutableError):
            session.flush()
        session.rollback()
        with pytest.raises(FigureConflict):
            create_figure_revision(
                session,
                figure.id,
                author_principal_id=owner_a.id,
                content_ref=_ref("stale"),
                parent_revision_id=first.id,
            )
        with pytest.raises(DocumentAuthorizationError):
            list_figure_revisions(session, figure.id, principal_id=owner_b.id)


def test_proposal_state_machine_accepts_with_authorized_principal_and_source(db):
    with Session(db) as session:
        _org, case, owner = _case(session, "proposal-owner")
        document = create_document(session, case.id, book="claims", principal_id=owner.id)
        base = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("claims-v1"))
        proposal = create_proposal(
            session,
            case.id,
            principal_id=owner.id,
            target_kind="document",
            target_revision_id=base.id,
            proposer_agent_key="agent-proposer",
            result_content_ref=_ref("claims-agent-proposal"),
            changes=[{"target_anchor": "claims/1", "payload": {"replace": "new text"}}],
        )
        add_change(session, proposal.id, principal_id=owner.id, target_anchor="claims/2", payload={"delete": True})
        submit_proposal(session, proposal.id, principal_id=owner.id)
        with pytest.raises(ProposalConflict):
            add_change(session, proposal.id, principal_id=owner.id, target_anchor="claims/3", payload={})
        accepted = accept_proposal(session, proposal.id, principal_id=owner.id)
        session.commit()
        assert accepted.status == "accepted"
        assert accepted.accepted_document_revision_id is not None
        accepted_revision = session.get(type(base), accepted.accepted_document_revision_id)
        assert accepted_revision is not None
        assert accepted_revision.parent_revision_id == base.id
        assert accepted_revision.source == "agent_suggested_accepted"
        with pytest.raises(ProposalConflict):
            reject_proposal(session, proposal.id, principal_id=owner.id)


def test_proposal_rejects_unauthorized_accept_and_invalid_transition(db):
    with Session(db) as session:
        _org_a, case_a, owner_a = _case(session, "proposal-a")
        _org_b, _case_b, owner_b = _case(session, "proposal-b")
        document = create_document(session, case_a.id, book="description", principal_id=owner_a.id)
        base = create_revision(session, document.id, author_principal_id=owner_a.id, content_ref=_ref("desc-v1"))
        proposal = create_proposal(
            session,
            case_a.id,
            principal_id=owner_a.id,
            target_kind="document",
            target_revision_id=base.id,
            proposer_principal_id=owner_a.id,
            result_content_ref=_ref("desc-v2"),
        )
        with pytest.raises(ProposalConflict):
            accept_proposal(session, proposal.id, principal_id=owner_a.id)
        submit_proposal(session, proposal.id, principal_id=owner_a.id)
        with pytest.raises(ProposalAuthorizationError):
            accept_proposal(session, proposal.id, principal_id=owner_b.id)
        reject_proposal(session, proposal.id, principal_id=owner_a.id)
        with pytest.raises(ProposalConflict):
            submit_proposal(session, proposal.id, principal_id=owner_a.id)


def test_release_seal_freezes_revision_snapshot(db):
    with Session(db) as session:
        _org, case, owner = _case(session, "release-owner")
        document = create_document(session, case.id, book="abstract", principal_id=owner.id)
        revision = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("abstract-v1"))
        figure = create_figure_document(session, case.id, principal_id=owner.id, figure_no=1)
        figure_revision = create_figure_revision(
            session, figure.id, author_principal_id=owner.id, content_ref=_ref("figure-v1")
        )
        release = create_release(session, case.id, principal_id=owner.id)
        first = add_release_item(
            session,
            release.id,
            principal_id=owner.id,
            item_kind="document",
            revision_id=revision.id,
        )
        second = add_release_item(
            session,
            release.id,
            principal_id=owner.id,
            item_kind="figure",
            revision_id=figure_revision.id,
        )
        sealed = seal_release(session, release.id, principal_id=owner.id)
        session.commit()
        assert sealed.status == "sealed" and first.content_ref.sha256 == revision.content_ref.sha256
        assert second.content_ref.sha256 == figure_revision.content_ref.sha256
        with pytest.raises(ReleaseConflict):
            add_release_item(
                session,
                release.id,
                principal_id=owner.id,
                item_kind="document",
                revision_id=revision.id,
            )
        with pytest.raises(ReleaseConflict):
            seal_release(session, release.id, principal_id=owner.id)
