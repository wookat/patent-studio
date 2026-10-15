# -*- coding: utf-8 -*-
"""Capability Registry 命令通道：幂等绑定 / payload 指纹 / outbox 重放 / 审批挂起。"""

import os
from datetime import UTC, datetime

import pytest
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from test_capability_registry import _add_agent, _add_case, _add_human, _add_org, _grant

from patent_studio.capabilities import (
    CapabilityAuthorizationError,
    CapabilityError,
    CapabilityKind,
    CapabilityRegistrationError,
    CapabilityRegistry,
    CapabilityRisk,
    CapabilityScope,
    CapabilitySpec,
    CommandInput,
    CommandReceipt,
    InvocationContext,
)
from patent_studio.capabilities.registry import CapabilityOutputError
from patent_studio.domain.operations import Operation, OperationConflict, OutboxEvent
from patent_studio.domain.organization import CaseParticipant, OrganizationMembership
from patent_studio.domain.runs import decide_approval
from patent_studio.infra.db import database_url

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


class RenameInput(CommandInput):
    name: str


class LooseCommand(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    operation_id: str
    name: str


class OtherReceipt(CommandReceipt):
    pass


def _ctx(principal, organization, case):
    return InvocationContext(
        principal_id=principal.id, organization_id=organization.id, case_id=case.id, at=datetime.now(UTC)
    )


def _spec(handler, *, capability_id="case.rename", approval=False, input_model=RenameInput, output=CommandReceipt):
    return CapabilitySpec(
        id=capability_id,
        version="1.0.0",
        kind=CapabilityKind.COMMAND,
        risk=CapabilityRisk.MEDIUM,
        scope=CapabilityScope.CASE,
        input_model=input_model,
        output_model=output,
        handler=handler,
        requires_approval=approval,
    )


def _join_org(session, organization, principal):
    session.add(
        OrganizationMembership(
            organization_id=organization.id, principal_id=principal.id, role="member", status="active"
        )
    )


def test_command_registration_contract_is_fail_closed(db):
    handler = lambda s, p, c: None  # noqa: E731
    base = dict(
        id="case.rename",
        version="1.0.0",
        kind=CapabilityKind.COMMAND,
        risk=CapabilityRisk.MEDIUM,
        scope=CapabilityScope.CASE,
        input_model=RenameInput,
        output_model=CommandReceipt,
        handler=handler,
    )
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(**{**base, "output_model": OtherReceipt})
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(**{**base, "input_model": LooseCommand})
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(**{**base, "scope": CapabilityScope.ORGANIZATION, "requires_approval": True})
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(**{**base, "kind": CapabilityKind.QUERY, "requires_approval": True})
    registry = CapabilityRegistry()
    registry.register(CapabilitySpec(**base))
    assert registry.ids() == ("case.rename",)


def test_command_invoke_records_operation_replays_receipt_and_binds_payload(db):
    calls = {"n": 0}

    def handler(session, payload, context):
        calls["n"] += 1
        return CommandReceipt(operation_id=payload.operation_id, status="succeeded", result_json='{"n":1}')

    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_agent(session)
        organization = _add_org(session, owner)
        _join_org(session, organization, subject)
        case = _add_case(session, organization, owner)
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename"))
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_spec(handler))
        context = _ctx(subject, organization, case)
        payload = {"operation_id": "op-1", "name": "alpha"}
        receipt = registry.invoke(session, "case.rename", payload, context=context)
        assert receipt.status == "succeeded" and receipt.result_json == '{"n":1}'
        operation = session.scalar(select(Operation).where(Operation.operation_id == "op-1"))
        assert operation is not None and operation.status == "succeeded"
        assert session.scalar(select(OutboxEvent).where(OutboxEvent.operation_id == operation.id)) is not None
        session.commit()

        replay = registry.invoke(session, "case.rename", payload, context=context)
        assert replay == receipt and calls["n"] == 1
        with pytest.raises(CapabilityError):
            registry.invoke(session, "case.rename", {"operation_id": "op-1", "name": "beta"}, context=context)
        registry.register(_spec(handler, capability_id="case.rename2"))
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename2"))
        session.commit()
        with pytest.raises(OperationConflict):
            registry.invoke(session, "case.rename2", payload, context=context)


def test_command_requires_grant_and_failed_operation_is_terminal(db):
    def handler(session, payload, context):
        raise ValueError("boom")

    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_agent(session)
        organization = _add_org(session, owner)
        case = _add_case(session, organization, owner)
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_spec(handler))
        context = _ctx(subject, organization, case)
        with pytest.raises(CapabilityAuthorizationError):
            registry.invoke(session, "case.rename", {"operation_id": "op-x", "name": "n"}, context=context)
        assert session.scalar(select(Operation).where(Operation.operation_id == "op-x")) is None

        _join_org(session, organization, subject)
        session.add(CaseParticipant(case_id=case.id, principal_id=subject.id, role="agent"))
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename"))
        session.commit()
        with pytest.raises(ValueError):
            registry.invoke(session, "case.rename", {"operation_id": "op-y", "name": "n"}, context=context)
        operation = session.scalar(select(Operation).where(Operation.operation_id == "op-y"))
        assert operation.status == "failed" and "boom" in (operation.error_summary or "")
        with pytest.raises(CapabilityError):
            registry.invoke(session, "case.rename", {"operation_id": "op-y", "name": "n"}, context=context)


def test_approval_gated_command_suspends_then_executes_after_decision(db):
    calls = {"n": 0}

    def handler(session, payload, context):
        calls["n"] += 1
        return CommandReceipt(operation_id=payload.operation_id, status="succeeded", result_json='{"ok":true}')

    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_agent(session)
        organization = _add_org(session, owner)
        _join_org(session, organization, subject)
        case = _add_case(session, organization, owner)
        session.add(CaseParticipant(case_id=case.id, principal_id=subject.id, role="agent"))
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename"))
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_spec(handler, approval=True))
        context = _ctx(subject, organization, case)
        payload = {"operation_id": "op-gate", "name": "n"}

        first = registry.invoke(session, "case.rename", payload, context=context)
        assert first.status == "pending_approval" and calls["n"] == 0
        assert first.approval_id is not None and first.run_id == "cap-op-gate"
        again = registry.invoke(session, "case.rename", payload, context=context)
        assert again.status == "pending_approval" and calls["n"] == 0

        decide_approval(session, first.approval_id, principal_id=owner.id, decision="approved")
        done = registry.invoke(session, "case.rename", payload, context=context)
        assert done.status == "succeeded" and done.result_json == '{"ok":true}' and calls["n"] == 1
        operation = session.scalar(select(Operation).where(Operation.operation_id == "op-gate"))
        assert operation.status == "succeeded"
        session.commit()
        replay = registry.invoke(session, "case.rename", payload, context=context)
        assert replay.status == "succeeded" and calls["n"] == 1


def test_approval_rejection_fails_closed_without_executing(db):
    calls = {"n": 0}

    def handler(session, payload, context):
        calls["n"] += 1
        return CommandReceipt(operation_id=payload.operation_id, status="succeeded")

    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_agent(session)
        organization = _add_org(session, owner)
        _join_org(session, organization, subject)
        case = _add_case(session, organization, owner)
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename"))
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_spec(handler, approval=True))
        context = _ctx(subject, organization, case)
        payload = {"operation_id": "op-deny", "name": "n"}
        first = registry.invoke(session, "case.rename", payload, context=context)
        decide_approval(session, first.approval_id, principal_id=owner.id, decision="rejected", reason="不批")
        result = registry.invoke(session, "case.rename", payload, context=context)
        assert result.status == "failed" and calls["n"] == 0
        assert session.scalar(select(Operation).where(Operation.operation_id == "op-deny")).status == "failed"


def test_output_validation_on_command_receipt(db):
    def bad_handler(session, payload, context):
        return CommandReceipt(operation_id="other", status="succeeded")

    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_agent(session)
        organization = _add_org(session, owner)
        _join_org(session, organization, subject)
        case = _add_case(session, organization, owner)
        session.add(_grant(organization, owner, subject, case=case, capability="case.rename"))
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_spec(bad_handler))
        with pytest.raises(CapabilityOutputError):
            registry.invoke(
                session,
                "case.rename",
                {"operation_id": "op-bad", "name": "n"},
                context=_ctx(subject, organization, case),
            )
