"""Agent identity, query-only MCP boundary and fake executor regressions."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from test_documents import _case

from patent_studio.capabilities.agent import AGENT_QUERY_REGISTRY
from patent_studio.domain.agent_runtime import AgentPlan, PatentAgent
from patent_studio.domain.agents import (
    AgentTokenError,
    issue_agent_token,
    provision_agent,
)
from patent_studio.domain.documents import Revision, create_document, create_revision
from patent_studio.domain.executors import (
    DelegationRequest,
    ExecutorError,
    FakeExecutor,
    receive_executor_event,
    submit_delegation,
)
from patent_studio.domain.operations import record_operation
from patent_studio.domain.organization import CaseParticipant, OrganizationMembership
from patent_studio.domain.proposals import Proposal
from patent_studio.domain.runs import RunEvent, create_run, transition_run
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import ObjectRef
from patent_studio.mcp.agent_server import MCPQueryService, MCPUnauthorized

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


def _ref(label: str) -> ObjectRef:
    return ObjectRef(label, "a" * 64, len(label), "text/plain")


def test_agent_registration_is_not_authorization_and_stub_only_creates_proposal(db):
    with Session(db) as session:
        organization, case, owner = _case(session, "agent")
        agent = provision_agent(session, agent_key="reviewer-v1", display_name="Reviewer")
        assert session.scalar(
            select(CaseParticipant).where(CaseParticipant.principal_id == agent.id)
        ) is None
        session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
        session.flush()
        document = create_document(session, case.id, book="claims", principal_id=owner.id)
        revision = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("base"))

        class Stub:
            def plan(self, prompt: str):
                assert prompt == "review"
                return AgentPlan(
                    target_kind="document",
                    target_revision_id=revision.id,
                    result_content_key="proposal",
                    result_content_sha256="b" * 64,
                    result_content_size=8,
                    result_content_type="text/plain",
                )

        result = PatentAgent(agent_key="reviewer-v1", model=Stub()).run(
            session, principal_id=agent.id, case_id=case.id, prompt="review"
        )
        proposal = session.get(Proposal, result.proposal_id)
        assert result.status == "draft"
        assert proposal is not None and proposal.status == "draft"
        assert session.scalar(select(Revision).where(Revision.content_key == "proposal")) is None


def test_mcp_bearer_scope_and_registry_queries_are_fail_closed(db):
    assert AGENT_QUERY_REGISTRY.ids() == ("agent.case.list", "agent.document.read", "agent.workitem.list")
    with Session(db) as session:
        organization, case, owner = _case(session, "mcp")
        agent = provision_agent(session, agent_key="mcp-v1", display_name="MCP")
        session.add(OrganizationMembership(organization_id=organization.id, principal_id=agent.id, role="member"))
        session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
        session.flush()
        document = create_document(session, case.id, book="description", principal_id=owner.id)
        token = issue_agent_token(
            session,
            principal_id=agent.id,
            issuer_principal_id=owner.id,
            organization_id=organization.id,
        )
        session.commit()
        service = MCPQueryService(session)
        assert service.call(token, "list_cases")[0].case_id == case.id
        assert service.call(token, "read_document", {"document_id": str(document.id)}).document_id == document.id
        with pytest.raises(MCPUnauthorized):
            service.call("agt_invalid", "list_cases")
        with pytest.raises(MCPUnauthorized):
            service.call(token, "proposal.create", {})


def test_token_expiry_and_executor_allowlist_callback_proposal(db):
    with Session(db) as session:
        organization, case, owner = _case(session, "executor")
        agent = provision_agent(session, agent_key="executor-v1", display_name="Executor")
        session.add(OrganizationMembership(organization_id=organization.id, principal_id=agent.id, role="member"))
        session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
        session.flush()
        with pytest.raises(AgentTokenError):
            issue_agent_token(
                session,
                principal_id=agent.id,
                issuer_principal_id=owner.id,
                case_id=case.id,
                expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        document = create_document(session, case.id, book="abstract", principal_id=owner.id)
        revision = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("base2"))
        record_operation(
            session,
            "agent-run-op",
            operation_type="run.create",
            principal_id=agent.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        run = create_run(
            session,
            "agent-run",
            run_type="agent",
            case_id=case.id,
            principal_id=agent.id,
            operation_id="agent-run-op",
        )
        transition_run(session, run.id, principal_id=agent.id, status="running")
        executor = FakeExecutor()
        with pytest.raises(ExecutorError):
            submit_delegation(
                session,
                DelegationRequest(run.id, agent.id, case.id, None, "review", {"secret": "x"}),
                executor=executor,
            )
        with pytest.raises(ExecutorError):
            submit_delegation(
                session,
                DelegationRequest(run.id, agent.id, case.id, None, "review", recursive=True),
                executor=executor,
            )
        task = submit_delegation(
            session,
            DelegationRequest(
                run.id,
                agent.id,
                case.id,
                None,
                "review",
                {"document": str(document.id)},
                confirmed=True,
            ),
            executor=executor,
            allowed_outbound_keys=frozenset({"document"}),
            expected_epoch=run.fencing_epoch,
        )
        output = receive_executor_event(
            session,
            run_id=run.id,
            principal_id=agent.id,
            task_id=task.task_id,
            event_type="proposal.ready",
            payload={
                "target_kind": "document",
                "target_revision_id": str(revision.id),
                "result_content_key": "executor-proposal",
                "result_content_sha256": "c" * 64,
                "result_content_size": 16,
                "result_content_type": "text/plain",
            },
        )
        assert output is not None and output.status == "draft"
        assert session.scalar(select(RunEvent).where(RunEvent.event_type == "executor.proposal.ready")) is not None
        assert session.scalar(select(Revision).where(Revision.content_key == "executor-proposal")) is None
