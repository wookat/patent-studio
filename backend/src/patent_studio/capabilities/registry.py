"""Pydantic 能力契约与 Grant 复用调用内核。

这里只注册当前已经能安全执行的查询能力。命令能力需要审批、幂等键、版本
提交屏障和事务 outbox；这些控制面尚未落地，因此命令注册会 fail-closed。
入口适配器（HTTP、MCP、Agent）应只构造独立的 InvocationContext，不能从业务
payload 推导主体、机构、案件、Grant 或时钟。
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from threading import RLock
from typing import Any, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError, field_validator
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


class CapabilityRegistry:
    """进程内显式注册表；不扫描模块、不生成入口、不假装提供审计。"""

    def __init__(self) -> None:
        self._specs: dict[str, CapabilitySpec[Any, Any]] = {}
        self._lock = RLock()

    def register(self, spec: CapabilitySpec[InputModel, OutputModel]) -> CapabilitySpec[InputModel, OutputModel]:
        if spec.kind is not CapabilityKind.QUERY:
            raise CapabilityRegistrationError(
                "command capabilities are unavailable until approval, idempotency, version fencing, and outbox exist"
            )
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

        result = spec.handler(session, parsed, context)
        try:
            return _validate_contract(spec.output_model, result)
        except ValidationError as exc:
            raise CapabilityOutputError(f"handler output does not match capability {capability_id!r}") from exc

    @staticmethod
    def _check_scope(spec: CapabilitySpec[Any, Any], context: InvocationContext) -> None:
        if spec.scope is CapabilityScope.CASE and context.case_id is None:
            raise CapabilityError(f"capability {spec.id!r} requires a case context")
        if spec.scope is CapabilityScope.ORGANIZATION and context.case_id is not None:
            raise CapabilityError(f"capability {spec.id!r} does not accept a case context")
