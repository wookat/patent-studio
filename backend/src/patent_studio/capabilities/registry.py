"""Pydantic 能力契约与 Grant 复用调用内核。

查询能力直接执行；命令能力必须声明 `operation_id` 幂等键并返回统一的
CommandReceipt——invoke 负责 record_operation 幂等绑定、payload 指纹比对、
outbox 事件落账与回执重放；`requires_approval` 的命令经 Run/Approval 挂起，
批准前返回 pending_approval，拒绝则 fail-closed。
入口适配器（HTTP、MCP、Agent）应只构造独立的 InvocationContext，不能从业务
payload 推导主体、机构、案件、Grant 或时钟。
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from threading import RLock
from typing import Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator
from sqlalchemy.orm import Session

from patent_studio.domain.authorization import GrantDecision, authorize_grant

InputModel = TypeVar("InputModel", bound=BaseModel)
OutputModel = TypeVar("OutputModel", bound=BaseModel)

_CAPABILITY_ID = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$")
_CONTRACT_VERSION = re.compile(r"^\d+\.\d+\.\d+$")
_CONTEXT_FIELDS = frozenset(
    {
        "principal_id",
        "subject_principal_id",
        "organization_id",
        "org_id",
        "case_id",
        "grant_id",
        "expected_epoch",
        "at",
        "clock",
        "capability_id",
        "delegator_principal_id",
        "invoker_principal_id",
    }
)
_UNSUPPORTED_CONTRACT_SCHEMA_TYPES = frozenset(
    {
        "any",
        "callable",
        "dataclass",
        "is-instance",
        "is-subclass",
    }
)


class CapabilityKind(StrEnum):
    QUERY = "query"
    COMMAND = "command"


class CapabilityRisk(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CapabilityScope(StrEnum):
    ORGANIZATION = "organization"
    CASE = "case"


class CapabilityError(ValueError):
    """能力契约、查找或调用被拒绝。"""


class CapabilityRegistrationError(CapabilityError):
    """能力定义不满足可注册的安全边界。"""


class UnknownCapabilityError(CapabilityError):
    """调用方请求了未注册的能力。"""


class CapabilityInputError(CapabilityError):
    """输入不符合已注册的 Pydantic 契约。"""


class CapabilityOutputError(CapabilityError):
    """处理器返回值不符合已注册的 Pydantic 契约。"""


class CapabilityAuthorizationError(CapabilityError):
    """Grant/关系/时间窗在线判定拒绝本次调用。"""

    def __init__(self, capability_id: str, decision: GrantDecision) -> None:
        self.capability_id = capability_id
        self.decision = decision
        super().__init__(f"capability {capability_id!r} is not authorized")


def _check_contract_schema(schema: object, *, checked: set[type[BaseModel]]) -> None:
    """Walk Pydantic's compiled schema without interpreting field annotations."""

    if isinstance(schema, dict):
        schema_type = schema.get("type")
        if schema_type == "computed-field":
            raise CapabilityRegistrationError("contract fields cannot use computed_field")
        serialization = schema.get("serialization")
        if isinstance(serialization, dict) and str(serialization.get("type", "")).startswith("function"):
            raise CapabilityRegistrationError("contract fields cannot use custom serializers")
        if "validation_alias" in schema or "serialization_alias" in schema:
            if schema.get("validation_alias") != schema.get("serialization_alias"):
                raise CapabilityRegistrationError("contract aliases must match for validation and serialization")
        if isinstance(schema_type, str) and schema_type in _UNSUPPORTED_CONTRACT_SCHEMA_TYPES:
            raise CapabilityRegistrationError(f"contract contains unsupported Pydantic schema type {schema_type!r}")
        if schema_type == "model":
            model = schema.get("cls")
            if isinstance(model, type) and issubclass(model, BaseModel) and model not in checked:
                checked.add(model)
                config = schema.get("config")
                if not isinstance(config, dict) or config.get("extra_fields_behavior") != "forbid":
                    raise CapabilityRegistrationError("contract model must forbid extra fields")
                if config.get("revalidate_instances") != "always":
                    raise CapabilityRegistrationError("contract model must revalidate existing instances")
        for value in schema.values():
            _check_contract_schema(value, checked=checked)
    elif isinstance(schema, (list, tuple)):
        for value in schema:
            _check_contract_schema(value, checked=checked)


def _check_contract_models(model: type[BaseModel], name: str) -> None:
    try:
        schema = TypeAdapter(model).core_schema
    except Exception as exc:
        raise CapabilityRegistrationError(f"{name} has an unsupported Pydantic schema") from exc
    _check_contract_schema(schema, checked=set())


def _validate_contract(model: type[BaseModel], value: object) -> BaseModel:
    """Use Pydantic's native instance revalidation without a serialization round trip."""

    return model.model_validate(value, by_name=True, by_alias=True)


class InvocationContext(BaseModel):
    """由可信入口注入的调用身份；业务输入不会合并到此模型。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    principal_id: UUID
    organization_id: UUID
    case_id: UUID | None = None
    grant_id: UUID | None = None
    expected_epoch: int | None = None
    at: datetime

    @field_validator("at")
    @classmethod
    def _require_aware_clock(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("invocation clock must be timezone-aware")
        return value.astimezone(UTC)


class CommandInput(BaseModel):
    """命令能力输入基类；operation_id 是调用方幂等键，绑定主体/能力/范围/payload。"""

    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    operation_id: str = Field(min_length=1, max_length=128)


class CommandReceipt(BaseModel):
    """命令能力统一回执。result_json 为处理器业务结果（序列化 JSON）；pending_approval / failed 语义化挂起。"""

    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    operation_id: str
    status: Literal["succeeded", "pending_approval", "failed"]
    result_json: str | None = None
    run_id: str | None = None
    approval_id: UUID | None = None
    error: str | None = None


def _fail_operation(session: Session, operation_id: str, reason: str) -> None:
    """pending → running → failed（转移表不允许 pending 直接 failed）。"""
    from patent_studio.domain.operations import transition_operation

    transition_operation(session, operation_id, "running")
    transition_operation(session, operation_id, "failed", error_summary=reason)


def _default_approver(session: Session, case_id: UUID) -> UUID:
    """审批人默认取案件创建人（human）；agent 创建的案件回退到机构 owner/admin。"""
    from sqlalchemy import select

    from patent_studio.domain.identity import Principal
    from patent_studio.domain.organization import Case, OrganizationMembership

    case = session.get(Case, case_id)
    if case is None:
        raise CapabilityError("approval case does not exist")
    creator = session.get(Principal, case.created_by_principal_id)
    if creator is not None and creator.kind == "human":
        return creator.id
    approver = session.scalars(
        select(OrganizationMembership.principal_id)
        .join(Principal, Principal.id == OrganizationMembership.principal_id)
        .where(
            OrganizationMembership.organization_id == case.organization_id,
            OrganizationMembership.status == "active",
            OrganizationMembership.role.in_(("owner", "admin")),
            Principal.kind == "human",
        )
    ).first()
    if approver is None:
        raise CapabilityError("no human approver is available for this case")
    return approver


CapabilityHandler = Callable[[Session, InputModel, InvocationContext], OutputModel]


@dataclass(frozen=True, slots=True)
class CapabilitySpec(Generic[InputModel, OutputModel]):
    """一个稳定能力 ID 对应的一次契约版本和可信处理器。"""

    id: str
    version: str
    kind: CapabilityKind
    risk: CapabilityRisk
    scope: CapabilityScope
    input_model: type[InputModel]
    output_model: type[OutputModel]
    handler: CapabilityHandler[InputModel, OutputModel]
    requires_approval: bool = False

    def __post_init__(self) -> None:
        try:
            kind = CapabilityKind(self.kind)
            risk = CapabilityRisk(self.risk)
            scope = CapabilityScope(self.scope)
        except ValueError as exc:
            raise CapabilityRegistrationError("invalid capability metadata") from exc
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "risk", risk)
        object.__setattr__(self, "scope", scope)
        if not _CAPABILITY_ID.fullmatch(self.id):
            raise CapabilityRegistrationError("capability id must be a stable lowercase dotted identifier")
        if not _CONTRACT_VERSION.fullmatch(self.version):
            raise CapabilityRegistrationError("capability version must use major.minor.patch")
        if not isinstance(self.input_model, type) or not issubclass(self.input_model, BaseModel):
            raise CapabilityRegistrationError("input_model must be a Pydantic BaseModel class")
        if not isinstance(self.output_model, type) or not issubclass(self.output_model, BaseModel):
            raise CapabilityRegistrationError("output_model must be a Pydantic BaseModel class")
        for name, model in (("input_model", self.input_model), ("output_model", self.output_model)):
            _check_contract_models(model, name)
        forbidden = _CONTEXT_FIELDS.intersection(self.input_model.model_fields)
        if forbidden:
            names = ", ".join(sorted(forbidden))
            raise CapabilityRegistrationError(f"input_model cannot carry invocation context fields: {names}")
        if not callable(self.handler):
            raise CapabilityRegistrationError("handler must be callable")
        if kind is CapabilityKind.COMMAND:
            if not issubclass(self.input_model, CommandInput):
                raise CapabilityRegistrationError("command input_model must extend CommandInput (operation_id)")
            if self.output_model is not CommandReceipt:
                raise CapabilityRegistrationError("command output_model must be CommandReceipt")
            if self.requires_approval and scope is not CapabilityScope.CASE:
                raise CapabilityRegistrationError("approval-gated commands require case scope")
        elif self.requires_approval:
            raise CapabilityRegistrationError("only command capabilities may require approval")


class CapabilityRegistry:
    """进程内显式注册表；不扫描模块、不生成入口、不假装提供审计。"""

    def __init__(self) -> None:
        self._specs: dict[str, CapabilitySpec[Any, Any]] = {}
        self._lock = RLock()

    def register(self, spec: CapabilitySpec[InputModel, OutputModel]) -> CapabilitySpec[InputModel, OutputModel]:
        with self._lock:
            if spec.id in self._specs:
                raise CapabilityRegistrationError(f"capability {spec.id!r} is already registered")
            self._specs[spec.id] = spec  # type: ignore[assignment]
        return spec

    def get(self, capability_id: str) -> CapabilitySpec[Any, Any]:
        with self._lock:
            spec = self._specs.get(capability_id)
        if spec is None:
            raise UnknownCapabilityError(f"unknown capability {capability_id!r}")
        return spec

    def ids(self) -> tuple[str, ...]:
        """返回稳定排序的契约 ID；这不是授权或审计结果。"""
        with self._lock:
            return tuple(sorted(self._specs))

    def invoke(
        self,
        session: Session,
        capability_id: str,
        payload: object,
        *,
        context: InvocationContext,
    ) -> BaseModel:
        spec = self.get(capability_id)
        self._check_scope(spec, context)
        try:
            parsed = _validate_contract(spec.input_model, payload)
        except ValidationError as exc:
            raise CapabilityInputError(f"input does not match capability {capability_id!r}") from exc

        decision = authorize_grant(
            session,
            context.principal_id,
            context.organization_id,
            capability_id,
            case_id=context.case_id,
            grant_id=context.grant_id,
            expected_epoch=context.expected_epoch,
            at=context.at,
        )
        if not decision.allowed:
            raise CapabilityAuthorizationError(capability_id, decision)

        if spec.kind is CapabilityKind.COMMAND:
            return self._invoke_command(session, spec, parsed, context)
        result = spec.handler(session, parsed, context)
        try:
            return _validate_contract(spec.output_model, result)
        except ValidationError as exc:
            raise CapabilityOutputError(f"handler output does not match capability {capability_id!r}") from exc

    def _invoke_command(
        self, session: Session, spec: CapabilitySpec[Any, Any], parsed: CommandInput, context: InvocationContext
    ) -> CommandReceipt:
        """幂等命令通道：operation 绑定+payload 指纹+outbox 回执重放+审批挂起。"""
        from patent_studio.domain.operations import (
            append_outbox_event,
            record_operation,
            transition_operation,
        )
        from patent_studio.infra.storage import object_ref

        operation_id = parsed.operation_id
        payload_ref = object_ref(
            json.dumps(parsed.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode(),
            "application/json",
        )
        operation = record_operation(
            session,
            operation_id,
            operation_type=spec.id,
            principal_id=context.principal_id,
            organization_id=context.organization_id,
            case_id=context.case_id,
            payload_ref=payload_ref,
        )
        if operation.payload_sha256 != payload_ref.sha256:
            raise CapabilityError(f"operation {operation_id!r} is bound to another payload")
        if operation.status == "succeeded":
            from sqlalchemy import select

            from patent_studio.domain.operations import OutboxEvent

            event = session.scalar(
                select(OutboxEvent).where(
                    OutboxEvent.operation_id == operation.id,
                    OutboxEvent.event_type == f"{spec.id}.completed",
                )
            )
            if event is None or not isinstance(event.payload_json, dict):
                raise CapabilityError(f"operation {operation_id!r} has no recorded receipt")
            try:
                return CommandReceipt.model_validate(event.payload_json)
            except ValidationError as exc:
                raise CapabilityOutputError(f"recorded receipt does not match {spec.id!r}") from exc
        if operation.status != "pending":
            raise CapabilityError(f"operation {operation_id!r} is {operation.status}")

        run = self._approval_gate(session, spec, operation_id, context)
        if isinstance(run, CommandReceipt):
            return run
        transition_operation(session, operation_id, "running")
        try:
            raw = spec.handler(session, parsed, context)
            try:
                receipt = CommandReceipt.model_validate(raw)
            except ValidationError as exc:
                raise CapabilityOutputError(f"handler output does not match {spec.id!r}") from exc
            if receipt.operation_id != operation_id or receipt.status != "succeeded":
                raise CapabilityOutputError(f"handler returned an inconsistent receipt for {spec.id!r}")
            append_outbox_event(
                session,
                operation_id,
                event_type=f"{spec.id}.completed",
                payload_json=receipt.model_dump(mode="json"),
            )
            transition_operation(session, operation_id, "succeeded")
            if run is not None:
                from patent_studio.domain.runs import transition_run

                transition_run(
                    session,
                    run.id,
                    principal_id=context.principal_id,
                    status="succeeded",
                    expected_epoch=run.fencing_epoch,
                )
            return receipt
        except Exception as exc:
            transition_operation(session, operation_id, "failed", error_summary=str(exc))
            raise

    def _approval_gate(
        self, session: Session, spec: CapabilitySpec[Any, Any], operation_id: str, context: InvocationContext
    ):
        """返回 Run（已批准可执行）、CommandReceipt（挂起/失败）或 None（无审批要求）。"""
        if not spec.requires_approval:
            return None
        from sqlalchemy import select

        from patent_studio.domain.runs import Approval, create_run, request_approval, transition_run

        assert context.case_id is not None
        run_id = f"cap-{operation_id}"[:128]
        run = create_run(
            session,
            run_id,
            run_type="capability",
            case_id=context.case_id,
            principal_id=context.principal_id,
            operation_id=operation_id,
        )
        if run.status == "queued":
            run = transition_run(session, run.id, principal_id=context.principal_id, status="running")
        approval = session.scalar(
            select(Approval).where(Approval.run_id == run.id).order_by(Approval.created_at.desc(), Approval.id.desc())
        )
        if run.status == "failed":
            reason = run.error_summary or "capability approval rejected"
            _fail_operation(session, operation_id, reason)
            return CommandReceipt(
                operation_id=operation_id,
                status="failed",
                run_id=run_id,
                approval_id=approval.id if approval else None,
                error=reason,
            )
        if approval is not None and approval.status == "approved":
            return run
        if approval is not None and approval.status == "rejected":
            reason = approval.reason or "capability approval rejected"
            _fail_operation(session, operation_id, reason)
            return CommandReceipt(
                operation_id=operation_id, status="failed", run_id=run_id, approval_id=approval.id, error=reason
            )
        if approval is None:
            approver = _default_approver(session, context.case_id)
            approval = request_approval(
                session, run.id, principal_id=context.principal_id, approver_principal_id=approver
            )
        return CommandReceipt(
            operation_id=operation_id, status="pending_approval", run_id=run_id, approval_id=approval.id
        )

    @staticmethod
    def _check_scope(spec: CapabilitySpec[Any, Any], context: InvocationContext) -> None:
        if spec.scope is CapabilityScope.CASE and context.case_id is None:
            raise CapabilityError(f"capability {spec.id!r} requires a case context")
        if spec.scope is CapabilityScope.ORGANIZATION and context.case_id is not None:
            raise CapabilityError(f"capability {spec.id!r} does not accept a case context")
