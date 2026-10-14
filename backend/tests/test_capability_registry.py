# -*- coding: utf-8 -*-
"""Capability Registry 的 Pydantic 契约与在线 Grant 调用边界。"""

import os
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError, computed_field, field_serializer
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from patent_studio.capabilities import (
    CapabilityAuthorizationError,
    CapabilityError,
    CapabilityInputError,
    CapabilityKind,
    CapabilityOutputError,
    CapabilityRegistrationError,
    CapabilityRegistry,
    CapabilityRisk,
    CapabilityScope,
    CapabilitySpec,
    InvocationContext,
    UnknownCapabilityError,
)
from patent_studio.domain.authorization import Grant, GrantDecision
from patent_studio.domain.identity import Principal, User
from patent_studio.domain.organization import Case, CaseParticipant, Organization, OrganizationMembership
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


class InspectInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    marker: str


class InspectOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    principal_id: uuid.UUID
    organization_id: uuid.UUID
    case_id: uuid.UUID
    marker: str


class LooseInput(BaseModel):
    marker: str


class ForgedContextInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    organization_id: uuid.UUID


class NoRevalidateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    marker: str


class AmountInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(gt=0)


class AmountOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(gt=0)


class NestedLeaf(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(gt=0)


class UnsafeNestedLeaf(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(gt=0)


class NestedInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    leaf: NestedLeaf
    items: list[NestedLeaf]
    by_key: dict[str, NestedLeaf]


class UnsafeNestedInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    leaf: UnsafeNestedLeaf


class NestedOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    leaf: NestedLeaf
    items: list[NestedLeaf]


class AliasLeaf(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(alias="amount_value", gt=0)


class ComputedContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int

    @computed_field
    @property
    def calculated(self) -> int:
        return "invalid integer"  # type: ignore[return-value]


class DistinctAliasContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(validation_alias="incoming", serialization_alias="outgoing")


class SerializedContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int

    @field_serializer("amount")
    def serialize_amount(self, value: int) -> str:
        return str(value)


class RecursiveNode(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    value: int
    child: "RecursiveNode | None" = None


RecursiveNode.model_rebuild()


class BoundaryContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    leaf: AliasLeaf = Field(alias="leaf_data")
    node: RecursiveNode


class UnsupportedContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    payload: object


class CompiledConfigContract(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    marker: str


# Deliberately diverge the mutable declaration after Pydantic compiled its validator.
CompiledConfigContract.model_config["extra"] = "allow"
CompiledConfigContract.model_config["revalidate_instances"] = "never"


def _user() -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:12]}@capability.example",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
        display_name="能力测试用户",
    )


def _add_human(session: Session) -> Principal:
    user = _user()
    session.add(user)
    session.flush()
    principal = Principal(kind="human", user_id=user.id, display_name=user.display_name)
    session.add(principal)
    session.flush()
    return principal


def _add_agent(session: Session) -> Principal:
    principal = Principal(
        kind="agent",
        agent_key=f"cap-agent-{uuid.uuid4().hex[:12]}",
        display_name="能力测试 Agent",
    )
    session.add(principal)
    session.flush()
    return principal


def _add_org(session: Session, owner: Principal) -> Organization:
    organization = Organization(
        slug=f"cap-org-{uuid.uuid4().hex[:10]}",
        name="能力测试机构",
        created_by_principal_id=owner.id,
    )
    session.add(organization)
    session.flush()
    session.add(
        OrganizationMembership(
            organization_id=organization.id,
            principal_id=owner.id,
            role="owner",
            status="active",
        )
    )
    session.flush()
    return organization


def _add_case(session: Session, organization: Organization, owner: Principal) -> Case:
    case = Case(
        organization_id=organization.id,
        case_key=f"CAP-{uuid.uuid4().hex[:8]}",
        title="能力测试案件",
        created_by_principal_id=owner.id,
    )
    session.add(case)
    session.flush()
    return case


def _grant(
    organization: Organization,
    grantor: Principal,
    subject: Principal,
    *,
    case: Case | None = None,
    capability: str = "case.inspect",
) -> Grant:
    return Grant(
        organization_id=organization.id,
        case_id=case.id if case else None,
        grantor_principal_id=grantor.id,
        subject_principal_id=subject.id,
        capabilities=[capability],
        not_before=datetime.now(UTC) - timedelta(minutes=1),
        expires_at=datetime.now(UTC) + timedelta(minutes=30),
    )


def _inspect_handler(_session: Session, payload: InspectInput, context: InvocationContext) -> InspectOutput:
    assert context.case_id is not None
    return InspectOutput(
        principal_id=context.principal_id,
        organization_id=context.organization_id,
        case_id=context.case_id,
        marker=payload.marker,
    )


def _inspect_spec(
    *,
    capability_id: str = "case.inspect",
    scope: CapabilityScope = CapabilityScope.CASE,
    handler=_inspect_handler,
) -> CapabilitySpec[InspectInput, InspectOutput]:
    return CapabilitySpec(
        id=capability_id,
        version="1.0.0",
        kind=CapabilityKind.QUERY,
        risk=CapabilityRisk.LOW,
        scope=scope,
        input_model=InspectInput,
        output_model=InspectOutput,
        handler=handler,
    )


def test_query_contract_uses_online_grant_and_separate_context(db):
    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_human(session)
        organization = _add_org(session, owner)
        session.add(
            OrganizationMembership(
                organization_id=organization.id,
                principal_id=subject.id,
                role="member",
                status="active",
            )
        )
        case = _add_case(session, organization, owner)
        session.add(CaseParticipant(case_id=case.id, principal_id=subject.id, role="reviewer"))
        session.add(_grant(organization, owner, subject, case=case))
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_inspect_spec())
        context = InvocationContext(
            principal_id=subject.id,
            organization_id=organization.id,
            case_id=case.id,
            at=datetime.now(UTC),
        )
        result = registry.invoke(session, "case.inspect", {"marker": "from-payload"}, context=context)
        assert result == InspectOutput(
            principal_id=subject.id,
            organization_id=organization.id,
            case_id=case.id,
            marker="from-payload",
        )
        assert registry.ids() == ("case.inspect",)
        assert registry.get("case.inspect").version == "1.0.0"

        with pytest.raises(CapabilityInputError):
            registry.invoke(
                session,
                "case.inspect",
                {"marker": "ok", "organization_id": str(uuid.uuid4())},
                context=context,
            )
        with pytest.raises(ValidationError):
            context.case_id = uuid.uuid4()  # type: ignore[misc]


def test_registry_rechecks_current_auth_and_keeps_foreign_grant_opaque(db):
    with Session(db) as session:
        owner = _add_human(session)
        subject = _add_human(session)
        organization = _add_org(session, owner)
        session.add(
            OrganizationMembership(
                organization_id=organization.id,
                principal_id=subject.id,
                role="member",
                status="active",
            )
        )
        case = _add_case(session, organization, owner)
        session.add(CaseParticipant(case_id=case.id, principal_id=subject.id, role="reviewer"))
        grant = _grant(organization, owner, subject, case=case)
        session.add(grant)
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_inspect_spec())
        context = InvocationContext(
            principal_id=subject.id,
            organization_id=organization.id,
            case_id=case.id,
            grant_id=grant.id,
            at=datetime.now(UTC),
        )
        subject_user = session.get(User, subject.user_id)
        assert subject_user is not None
        subject_user.is_active = False
        session.flush()
        with pytest.raises(CapabilityAuthorizationError) as inactive:
            registry.invoke(session, "case.inspect", {"marker": "x"}, context=context)
        assert inactive.value.decision.reason == "subject_inactive"

        subject_user.is_active = True
        session.flush()
        other_owner = _add_human(session)
        other_org = _add_org(session, other_owner)
        other_case = _add_case(session, other_org, other_owner)
        foreign = _grant(other_org, other_owner, subject, case=other_case)
        session.add(foreign)
        session.commit()
        foreign_context = context.model_copy(update={"grant_id": foreign.id})
        with pytest.raises(CapabilityAuthorizationError) as foreign_error:
            registry.invoke(session, "case.inspect", {"marker": "x"}, context=foreign_context)
        assert foreign_error.value.decision.reason == "grant_missing"
        assert foreign_error.value.decision.grant_id is None
        assert foreign_error.value.decision.fencing_epoch is None


def test_agent_is_not_admin_but_can_use_explicit_case_grant(db):
    with Session(db) as session:
        owner = _add_human(session)
        agent = _add_agent(session)
        organization = _add_org(session, owner)
        case = _add_case(session, organization, owner)
        session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
        grant = _grant(organization, owner, agent, case=case)
        session.add(grant)
        session.commit()

        registry = CapabilityRegistry()
        registry.register(_inspect_spec())
        context = InvocationContext(
            principal_id=agent.id,
            organization_id=organization.id,
            case_id=case.id,
            grant_id=grant.id,
            at=datetime.now(UTC),
        )
        result = registry.invoke(session, "case.inspect", {"marker": "agent"}, context=context)
        assert result.marker == "agent" and result.principal_id == agent.id


def test_registry_rejects_duplicates_unknown_commands_and_forged_context_fields(db):
    registry = CapabilityRegistry()
    spec = _inspect_spec()
    registry.register(spec)
    with pytest.raises(CapabilityRegistrationError):
        registry.register(spec)
    with pytest.raises(UnknownCapabilityError):
        registry.get("case.unknown")

    command_spec = CapabilitySpec(
        id="case.apply",
        version="1.0.0",
        kind=CapabilityKind.COMMAND,
        risk=CapabilityRisk.HIGH,
        scope=CapabilityScope.CASE,
        input_model=InspectInput,
        output_model=InspectOutput,
        handler=_inspect_handler,
    )
    with pytest.raises(CapabilityRegistrationError):
        registry.register(command_spec)

    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.forged",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=ForgedContextInput,
            output_model=InspectOutput,
            handler=_inspect_handler,
        )
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.stale",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=NoRevalidateInput,
            output_model=InspectOutput,
            handler=_inspect_handler,
        )
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.loose",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=LooseInput,
            output_model=InspectOutput,
            handler=_inspect_handler,
        )


def test_registry_scope_and_output_contracts_fail_closed(db):
    with Session(db) as session:
        registry = CapabilityRegistry()
        registry.register(_inspect_spec(capability_id="organization.inspect", scope=CapabilityScope.ORGANIZATION))
        context = InvocationContext(
            principal_id=uuid.uuid4(),
            organization_id=uuid.uuid4(),
            case_id=uuid.uuid4(),
            at=datetime.now(UTC),
        )
        with pytest.raises(CapabilityError):
            registry.invoke(session, "organization.inspect", {"marker": "x"}, context=context)

        owner = _add_human(session)
        subject = _add_human(session)
        organization = _add_org(session, owner)
        session.add(
            OrganizationMembership(
                organization_id=organization.id,
                principal_id=subject.id,
                role="member",
                status="active",
            )
        )
        case = _add_case(session, organization, owner)
        session.add(CaseParticipant(case_id=case.id, principal_id=subject.id, role="reviewer"))
        grant = _grant(organization, owner, subject, case=case, capability="case.badoutput")
        session.add(grant)
        session.commit()

        def bad_output(_session, _payload, _context):
            return {"reason": "success"}

        registry.register(_inspect_spec(capability_id="case.badoutput", handler=bad_output))
        valid_context = InvocationContext(
            principal_id=subject.id,
            organization_id=organization.id,
            case_id=case.id,
            grant_id=grant.id,
            at=datetime.now(UTC),
        )
        with pytest.raises(CapabilityOutputError):
            registry.invoke(
                session,
                "case.badoutput",
                {"marker": "x"},
                context=valid_context,
            )


def test_registry_revalidates_existing_input_and_output_instances():
    registry = CapabilityRegistry()
    returned_output = AmountOutput(amount=1)
    calls = []

    def handler(_session, payload, _context):
        calls.append(payload)
        return returned_output

    registry.register(
        CapabilitySpec(
            id="case.amount",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=AmountInput,
            output_model=AmountOutput,
            handler=handler,
        )
    )
    context = InvocationContext(
        principal_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        at=datetime.now(UTC),
    )
    allowed = GrantDecision(True, "allowed")
    with patch("patent_studio.capabilities.registry.authorize_grant", return_value=allowed):
        assert registry.invoke(None, "case.amount", {"amount": 2}, context=context).amount == 1
        valid_input = AmountInput(amount=3)
        assert registry.invoke(None, "case.amount", valid_input, context=context).amount == 1
        assert len(calls) == 2

        invalid_input = AmountInput.model_construct(amount="invalid integer")
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.amount", invalid_input, context=context)
        assert len(calls) == 2

        modified_input = AmountInput(amount=4)
        modified_input.amount = "invalid integer"
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.amount", modified_input, context=context)
        assert len(calls) == 2

        returned_output = AmountOutput.model_construct(amount="invalid integer")
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.amount", {"amount": 5}, context=context)

        returned_output = AmountOutput(amount=6)
        returned_output.amount = "invalid integer"
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.amount", {"amount": 7}, context=context)


def test_registry_revalidates_nested_direct_container_and_mutated_instances():
    registry = CapabilityRegistry()
    returned_output = NestedOutput(
        leaf=NestedLeaf(amount=1),
        items=[NestedLeaf(amount=2)],
    )
    calls = []

    def handler(_session, payload, _context):
        calls.append(payload)
        return returned_output

    registry.register(
        CapabilitySpec(
            id="case.nested",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=NestedInput,
            output_model=NestedOutput,
            handler=handler,
        )
    )
    context = InvocationContext(
        principal_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        at=datetime.now(UTC),
    )
    allowed = GrantDecision(True, "allowed")
    valid_payload = {
        "leaf": {"amount": 1},
        "items": [{"amount": 2}],
        "by_key": {"first": {"amount": 3}},
    }
    with patch("patent_studio.capabilities.registry.authorize_grant", return_value=allowed):
        assert registry.invoke(None, "case.nested", valid_payload, context=context).items[0].amount == 2
        valid_instance = NestedInput(
            leaf=NestedLeaf(amount=4),
            items=[NestedLeaf(amount=5)],
            by_key={"first": NestedLeaf(amount=6)},
        )
        assert registry.invoke(None, "case.nested", valid_instance, context=context).leaf.amount == 1

        with pytest.raises(CapabilityInputError):
            registry.invoke(
                None,
                "case.nested",
                {**valid_payload, "leaf": NestedLeaf.model_construct(amount="invalid integer")},
                context=context,
            )
        with pytest.raises(CapabilityInputError):
            registry.invoke(
                None,
                "case.nested",
                {**valid_payload, "items": [NestedLeaf.model_construct(amount="invalid integer")]},
                context=context,
            )

        mutated = NestedInput.model_validate(valid_payload)
        mutated.items[0].amount = "invalid integer"
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.nested", mutated, context=context)
        assert len(calls) == 2

        returned_output = NestedOutput.model_construct(
            leaf=NestedLeaf.model_construct(amount="invalid integer"),
            items=[NestedLeaf(amount=2)],
        )
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.nested", valid_payload, context=context)

        returned_output = NestedOutput(leaf=NestedLeaf(amount=1), items=[NestedLeaf(amount=2)])
        returned_output.items[0].amount = "invalid integer"
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.nested", valid_payload, context=context)


def test_registry_accepts_alias_and_recursive_contracts():
    registry = CapabilityRegistry()

    def handler(_session, payload, _context):
        return payload

    registry.register(
        CapabilitySpec(
            id="case.boundary",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=BoundaryContract,
            output_model=BoundaryContract,
            handler=handler,
        )
    )
    context = InvocationContext(
        principal_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        at=datetime.now(UTC),
    )
    allowed = GrantDecision(True, "allowed")
    with patch("patent_studio.capabilities.registry.authorize_grant", return_value=allowed):
        result = registry.invoke(
            None,
            "case.boundary",
            {
                "leaf_data": {"amount_value": 2},
                "node": {"value": 1, "child": {"value": 2}},
            },
            context=context,
        )
    assert result.leaf.amount == 2
    assert result.node.child is not None and result.node.child.value == 2


def test_registry_rejects_computed_fields():
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.computed",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=ComputedContract,
            output_model=NestedOutput,
            handler=lambda _session, payload, _context: NestedOutput(
                leaf=NestedLeaf(amount=1), items=[NestedLeaf(amount=2)]
            ),
        )


@pytest.mark.parametrize("model", [DistinctAliasContract, SerializedContract])
def test_registry_rejects_ambiguous_alias_or_custom_serializer(model):
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.unsupportedcodec",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=model,
            output_model=NestedOutput,
            handler=lambda _session, payload, _context: NestedOutput(
                leaf=NestedLeaf(amount=1), items=[NestedLeaf(amount=2)]
            ),
        )


def test_registry_uses_compiled_config_when_model_config_is_mutated():
    registry = CapabilityRegistry()
    registry.register(
        CapabilitySpec(
            id="case.compiledconfig",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=CompiledConfigContract,
            output_model=CompiledConfigContract,
            handler=lambda _session, payload, _context: payload,
        )
    )


def test_registry_rejects_unsupported_nested_contract_schema():
    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.unsupported",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=UnsupportedContract,
            output_model=NestedOutput,
            handler=lambda _session, payload, _context: NestedOutput(
                leaf=NestedLeaf(amount=1), items=[NestedLeaf(amount=2)]
            ),
        )

    with pytest.raises(CapabilityRegistrationError):
        CapabilitySpec(
            id="case.unsafe-nested",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=UnsafeNestedInput,
            output_model=NestedOutput,
            handler=lambda _session, payload, _context: NestedOutput(
                leaf=NestedLeaf(amount=1), items=[NestedLeaf(amount=2)]
            ),
        )


class ExcludeLeaf(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(default=7, exclude=True)


class ExcludeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    marker: str
    amount: int = Field(default=7, exclude=True)


class ExcludeNestedInput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    leaf: ExcludeLeaf


class ExcludeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    amount: int = Field(default=7, exclude=True)


def test_registry_exclude_fields_revalidated_without_dump_roundtrip():
    """exclude=True 字段走原生 model_validate（by_name/by_alias），不经 dump 往返：
    construct / 变异 / 嵌套坏实例必须报错；合法 dict / 实例通过，输出原值不被重写为默认值。"""
    registry = CapabilityRegistry()
    calls = []
    returned_output = ExcludeOutput(amount=9)

    def handler(_session, payload, _context):
        calls.append(payload)
        return returned_output

    registry.register(
        CapabilitySpec(
            id="case.exclude",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=ExcludeInput,
            output_model=ExcludeOutput,
            handler=handler,
        )
    )
    registry.register(
        CapabilitySpec(
            id="case.excludenested",
            version="1.0.0",
            kind=CapabilityKind.QUERY,
            risk=CapabilityRisk.LOW,
            scope=CapabilityScope.CASE,
            input_model=ExcludeNestedInput,
            output_model=ExcludeOutput,
            handler=handler,
        )
    )
    context = InvocationContext(
        principal_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        at=datetime.now(UTC),
    )
    allowed = GrantDecision(True, "allowed")
    with patch("patent_studio.capabilities.registry.authorize_grant", return_value=allowed):
        result = registry.invoke(None, "case.exclude", {"marker": "a"}, context=context)
        assert calls[-1].amount == 7
        assert result.amount == 9  # exclude 字段原值保留：证明没有 dump 往返重写为默认 7
        registry.invoke(None, "case.exclude", ExcludeInput(marker="b"), context=context)
        assert calls[-1].amount == 7
        assert len(calls) == 2

        constructed = ExcludeInput.model_construct(marker="x", amount="invalid integer")
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.exclude", constructed, context=context)
        assert len(calls) == 2

        mutated = ExcludeInput(marker="y")
        mutated.amount = "invalid integer"
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.exclude", mutated, context=context)
        assert len(calls) == 2

        nested_bad = ExcludeNestedInput.model_construct(leaf=ExcludeLeaf.model_construct(amount="invalid integer"))
        with pytest.raises(CapabilityInputError):
            registry.invoke(None, "case.excludenested", nested_bad, context=context)
        assert len(calls) == 2

        returned_output = ExcludeOutput.model_construct(amount="invalid integer")
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.exclude", {"marker": "c"}, context=context)

        returned_output = ExcludeOutput(amount=8)
        returned_output.amount = "invalid integer"
        with pytest.raises(CapabilityOutputError):
            registry.invoke(None, "case.exclude", {"marker": "d"}, context=context)
