"""LLM gateway: settings fail-closed, structured plan → draft Proposal, error containment."""

import json
import os
import uuid

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from test_documents import _case

from patent_studio.domain.agent_runtime import (
    AgentPlanError,
    GatewayModel,
    PatentAgent,
    default_model,
    llm_configured,
)
from patent_studio.domain.agents import provision_agent
from patent_studio.domain.documents import create_document, create_revision
from patent_studio.domain.operations import record_operation
from patent_studio.domain.organization import CaseParticipant, OrganizationMembership
from patent_studio.domain.proposals import Proposal
from patent_studio.domain.runs import RunEvent, create_run, transition_run
from patent_studio.infra.db import database_url
from patent_studio.infra.storage import ObjectRef
from patent_studio.settings import Settings

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)

GATEWAY = "https://llm.example.test/v1"


@pytest.fixture()
def db(pg_schema):
    engine = create_engine(database_url(pg_schema))
    try:
        yield engine
    finally:
        engine.dispose()


def _ref(label: str) -> ObjectRef:
    return ObjectRef(label, "a" * 64, len(label), "text/plain")


def _plan_json(revision_id: uuid.UUID) -> str:
    return json.dumps(
        {
            "target_kind": "document",
            "target_revision_id": str(revision_id),
            "result_content_key": "llm-suggestion",
            "result_content_sha256": "b" * 64,
            "result_content_size": 99,
            "result_content_type": "text/plain",
        }
    )


def _completion(arguments: str) -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1,
        "model": "demo-model",
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "final_result", "arguments": arguments},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=GATEWAY)


def _seed(session, tag: str):
    organization, case, owner = _case(session, tag)
    agent = provision_agent(session, agent_key=f"llm-{tag}", display_name="LLM Agent")
    session.add(
        OrganizationMembership(organization_id=organization.id, principal_id=agent.id, role="member", status="active")
    )
    session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
    session.flush()
    document = create_document(session, case.id, book="claims", principal_id=owner.id)
    revision = create_revision(session, document.id, author_principal_id=owner.id, content_ref=_ref("base"))
    return organization, case, owner, agent, revision


def test_llm_settings_fail_closed(db):
    settings = Settings()
    assert not llm_configured(settings)
    assert default_model(settings) is None
    configured = Settings(llm_base_url=GATEWAY, llm_api_key="k", llm_model="demo-model")
    assert llm_configured(configured)
    assert isinstance(default_model(configured, http_client=_client(lambda r: None)), GatewayModel)


def test_gateway_plan_produces_draft_proposal(db):
    with Session(db) as session:
        _org, case, _owner, agent, revision = _seed(session, "ok")
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(200, json=_completion(_plan_json(revision.id)))

        model = GatewayModel(
            base_url=GATEWAY,
            api_key="test-key",
            model_name="demo-model",
            http_client=_client(handler),
        )
        result = PatentAgent(agent_key="llm-ok", model=model).run(
            session, principal_id=agent.id, case_id=case.id, prompt="审阅权利要求并给出修改建议"
        )
        proposal = session.get(Proposal, result.proposal_id)
        assert proposal is not None and proposal.status == "draft"
        assert proposal.proposer_principal_id == agent.id
        assert calls, "gateway should have been called"
        body = json.loads(calls[0].content)
        assert body["model"] == "demo-model"
        assert calls[0].headers.get("authorization") == "Bearer test-key"


def test_bad_llm_output_never_writes_proposal_and_emits_event(db):
    with Session(db) as session:
        organization, case, _owner, agent, _revision = _seed(session, "bad")
        op_id = f"llm-op-{uuid.uuid4().hex[:8]}"
        record_operation(
            session,
            op_id,
            operation_type="run.create",
            principal_id=agent.id,
            organization_id=organization.id,
            case_id=case.id,
        )
        run = create_run(
            session,
            f"llm-run-{uuid.uuid4().hex[:8]}",
            run_type="agent",
            case_id=case.id,
            principal_id=agent.id,
            operation_id=op_id,
        )
        transition_run(session, run.id, principal_id=agent.id, status="running")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_completion('{"target_kind":"nonsense"'))

        model = GatewayModel(base_url=GATEWAY, api_key="k", model_name="demo-model", http_client=_client(handler))
        with pytest.raises(AgentPlanError):
            PatentAgent(agent_key="llm-bad", model=model).run(
                session, principal_id=agent.id, case_id=case.id, prompt="x", run_id=run.id
            )
        assert session.scalar(select(Proposal).where(Proposal.case_id == case.id)) is None
        event = session.scalar(
            select(RunEvent).where(RunEvent.run_id == run.id, RunEvent.event_type == "agent.plan_failed")
        )
        assert event is not None and "llm-bad" in (event.payload or {}).get("agent_key", "")


def test_gateway_timeout_is_contained(db):
    with Session(db) as session:
        _org, case, _owner, agent, _revision = _seed(session, "slow")

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("simulated upstream timeout")

        model = GatewayModel(base_url=GATEWAY, api_key="k", model_name="demo-model", http_client=_client(handler))
        with pytest.raises(AgentPlanError):
            PatentAgent(agent_key="llm-slow", model=model).run(
                session, principal_id=agent.id, case_id=case.id, prompt="x"
            )
        assert session.scalar(select(Proposal).where(Proposal.case_id == case.id)) is None
