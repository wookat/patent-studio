# -*- coding: utf-8 -*-
"""Collaborative update log and submission barrier acceptance on PostgreSQL."""

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from test_documents import _case, _ref

from patent_studio.domain.collab import (
    CollabConflict,
    CollabUpdateInput,
    SubmissionBarrierError,
    append_collab_updates,
    create_collab_room,
    enforce_working_copy_barrier,
    flush_collab_updates,
    read_collab_updates,
)
from patent_studio.domain.documents import (
    DocumentAuthorizationError,
    commit_working_copy,
    create_document,
    create_revision,
    open_working_copy,
)
from patent_studio.domain.proposals import create_proposal, reject_proposal, submit_proposal
from patent_studio.domain.releases import add_release_item, create_release, seal_release
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import object_ref

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


def _update(label: str, clock: int) -> CollabUpdateInput:
    return CollabUpdateInput(clock=clock, content_ref=object_ref(label.encode(), "application/octet-stream"))


def test_collab_room_append_flush_read_and_gap_checks(db):
    with Session(db) as session:
        _org, case, owner = _case(session, "collab-owner")
        document = create_document(session, case.id, book="claims", principal_id=owner.id)
        revision = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("claims"))
        working_copy = open_working_copy(session, document.id, principal_id=owner.id)
        room = create_collab_room(session, working_copy.id, principal_id=owner.id)
        rows = append_collab_updates(
            session, room.id, principal_id=owner.id, updates=[_update("u1", 1), _update("u2", 2)]
        )
        session.commit()
        assert [row.seq for row in rows] == [1, 2]
        assert [row.seq for row in read_collab_updates(session, room.id, principal_id=owner.id)] == [1, 2]
        with pytest.raises(CollabConflict):
            read_collab_updates(session, room.id, principal_id=owner.id, after_seq=0, through_seq=3)
        assert flush_collab_updates(session, room.id, principal_id=owner.id) == 2
        assert all(row.flushed_at is not None for row in read_collab_updates(session, room.id, principal_id=owner.id))
        assert revision.id == working_copy.base_revision_id


def test_submission_barrier_blocks_pending_updates_and_proposals_then_allows_commit(db):
    with Session(db) as session:
        _org, case, owner = _case(session, "barrier-owner")
        document = create_document(session, case.id, book="description", principal_id=owner.id)
        base = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("v1"))
        working_copy = open_working_copy(session, document.id, principal_id=owner.id)
        room = create_collab_room(session, working_copy.id, principal_id=owner.id)
        append_collab_updates(session, room.id, principal_id=owner.id, updates=[_update("pending", 1)])
        session.commit()
        with pytest.raises(SubmissionBarrierError) as pending:
            commit_working_copy(session, working_copy.id, principal_id=owner.id, expected_version=1)
        assert pending.value.reasons == ("pending_collab_updates",)
        with pytest.raises(SubmissionBarrierError):
            enforce_working_copy_barrier(
                session, working_copy.id, principal_id=owner.id, force=True, force_reason=None
            )
        flush_collab_updates(session, room.id, principal_id=owner.id)
        proposal = create_proposal(
            session,
            case.id,
            principal_id=owner.id,
            target_kind="document",
            target_revision_id=base.id,
            proposer_principal_id=owner.id,
            result_content_ref=_ref("proposal"),
        )
        submit_proposal(session, proposal.id, principal_id=owner.id)
        session.commit()
        with pytest.raises(SubmissionBarrierError) as unresolved:
            commit_working_copy(session, working_copy.id, principal_id=owner.id, expected_version=1)
        assert unresolved.value.reasons == ("unresolved_proposals",)
        reject_proposal(session, proposal.id, principal_id=owner.id)
        committed = commit_working_copy(session, working_copy.id, principal_id=owner.id, expected_version=1)
        session.commit()
        assert committed.parent_revision_id == base.id


def test_release_seal_uses_case_barrier_and_nonparticipant_is_rejected(db):
    with Session(db) as session:
        _org_a, case_a, owner_a = _case(session, "release-a")
        _org_b, _case_b, owner_b = _case(session, "release-b")
        document = create_document(session, case_a.id, book="abstract", principal_id=owner_a.id)
        revision = create_revision(session, document.id, author_principal_id=owner_a.id, content_ref=_ref("abstract"))
        working_copy = open_working_copy(session, document.id, principal_id=owner_a.id)
        room = create_collab_room(session, working_copy.id, principal_id=owner_a.id)
        release = create_release(session, case_a.id, principal_id=owner_a.id)
        add_release_item(
            session, release.id, principal_id=owner_a.id, item_kind="document", revision_id=revision.id
        )
        append_collab_updates(session, room.id, principal_id=owner_a.id, updates=[_update("pending", 1)])
        session.commit()
        with pytest.raises(DocumentAuthorizationError):
            seal_release(session, release.id, principal_id=owner_b.id)
        with pytest.raises(SubmissionBarrierError):
            seal_release(session, release.id, principal_id=owner_a.id)
        flush_collab_updates(session, room.id, principal_id=owner_a.id)
        seal_release(session, release.id, principal_id=owner_a.id)
        session.commit()
