"""Run/approval state machine and Temporal time-skipping pipeline."""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from test_documents import _case

from patent_studio.domain.operations import record_operation
from patent_studio.domain.runs import (
    Approval,
    Run,
    RunConflict,
    RunEvent,
    append_run_event,
    cancel_run,
    create_run,
    decide_approval,
    request_approval,
    transition_run,
)
from patent_studio.infra.db import database_url
from patent_studio.temporal import ReviewWorkflow
from patent_studio.temporal_activities import (
    finalize_review,
    mark_run_running,
    reject_review,
    request_review_approval,
)

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


def test_run_state_events_approval_and_fencing(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "run-owner")
        record_operation(
            session,
            "run-op-1",
            operation_type="run.create",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        run = create_run(
            session,
            "run-1",
            run_type="review",
            case_id=case.id,
            principal_id=principal.id,
            operation_id="run-op-1",
        )
        transition_run(session, run.id, principal_id=principal.id, status="running")
        approval = request_approval(
            session,
            run.id,
            principal_id=principal.id,
            approver_principal_id=principal.id,
        )
        assert run.status == "waiting_approval"
        decide_approval(session, approval.id, principal_id=principal.id, decision="approved")
        transition_run(session, run.id, principal_id=principal.id, status="succeeded")
        session.commit()
        events = list(session.scalars(select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.seq)))
        assert [event.seq for event in events] == list(range(1, len(events) + 1))

        record_operation(
            session,
            "run-op-2",
            operation_type="run.create",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        canceled = create_run(
            session,
            "run-2",
            run_type="review",
            case_id=case.id,
            principal_id=principal.id,
            operation_id="run-op-2",
        )
        epoch = canceled.fencing_epoch
        cancel_run(session, canceled.id, principal_id=principal.id, expected_epoch=epoch)
        with pytest.raises(RunConflict):
            append_run_event(
                session,
                canceled.id,
                principal_id=principal.id,
                event_type="stale.activity",
                expected_epoch=epoch,
            )


def test_activity_key_is_idempotent_and_reject_has_no_business_write(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "run-reject")
        record_operation(
            session,
            "run-op-3",
            operation_type="run.create",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        run = create_run(
            session,
            "run-3",
            run_type="review",
            case_id=case.id,
            principal_id=principal.id,
            operation_id="run-op-3",
        )
        first = append_run_event(
            session,
            run.id,
            principal_id=principal.id,
            event_type="activity.result",
            payload={"proposal": "p"},
            activity_key="activity-1",
        )
        second = append_run_event(
            session,
            run.id,
            principal_id=principal.id,
            event_type="activity.result",
            payload={"proposal": "different"},
            activity_key="activity-1",
        )
        assert first.id == second.id
        session.commit()
        assert session.scalar(select(Run).where(Run.id == run.id)).status == "queued"

        record_operation(
            session,
            "run-op-rejected",
            operation_type="run.create",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        rejected = create_run(
            session,
            "run-rejected",
            run_type="review",
            case_id=case.id,
            principal_id=principal.id,
            operation_id="run-op-rejected",
        )
        transition_run(session, rejected.id, principal_id=principal.id, status="running")
        approval = request_approval(
            session,
            rejected.id,
            principal_id=principal.id,
            approver_principal_id=principal.id,
        )
        decide_approval(
            session,
            approval.id,
            principal_id=principal.id,
            decision="rejected",
            reason="needs revision",
        )
        session.commit()
        assert session.get(Run, rejected.id).status == "failed"


def test_temporal_review_waits_for_approval_then_succeeds(db):
    with Session(db) as session:
        organization, case, principal = _case(session, "temporal")
        record_operation(
            session,
            "run-op-temporal",
            operation_type="run.create",
            principal_id=principal.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        run = create_run(
            session,
            "run-temporal",
            run_type="review",
            case_id=case.id,
            principal_id=principal.id,
            operation_id="run-op-temporal",
        )
        session.commit()
        run_id, principal_id = run.run_id, str(principal.id)

    async def scenario():
        async with await WorkflowEnvironment.start_time_skipping() as env:
            with ThreadPoolExecutor(max_workers=4) as executor:
                async with Worker(
                    env.client,
                    task_queue="run-test",
                    workflows=[ReviewWorkflow],
                    activities=[mark_run_running, request_review_approval, finalize_review, reject_review],
                    activity_executor=executor,
                ):
                    handle = await env.client.start_workflow(
                        ReviewWorkflow.run,
                        args=[run_id, principal_id, principal_id],
                        id="workflow-run-temporal",
                        task_queue="run-test",
                    )
                    deadline = asyncio.get_running_loop().time() + 20
                    approval_id = None
                    while approval_id is None:
                        assert asyncio.get_running_loop().time() < deadline
                        await asyncio.sleep(0.05)
                        with Session(db) as session:
                            approval_id = session.scalar(select(Approval.id).where(Approval.run_id == run.id))
                    with Session(db) as session:
                        decide_approval(session, approval_id, principal_id=principal.id, decision="approved")
                        session.commit()
                    await handle.signal(ReviewWorkflow.approval, True)
                    assert await handle.result() == "succeeded"

    asyncio.run(scenario())
    with Session(db) as session:
        assert session.get(Run, run.id).status == "succeeded"
