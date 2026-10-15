"""MCP resource-server boundary for registered Agent tokens.

B14：旧 app/mcp 工具面经 ``TOOL_CAPABILITY_MAP`` 桥到 ``AGENT_TOOL_REGISTRY``。
本适配器只负责 bearer 认证与 token scope 收窄；能力授权（grant/epoch）、
命令幂等（operation_id）与审批挂起全部由 registry fail-closed 强制——
token 不替代 grant，未授权能力调用一律 CapabilityAuthorizationError。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from patent_studio.capabilities.agent import AGENT_QUERY_REGISTRY
from patent_studio.capabilities.registry import (
    CapabilityAuthorizationError,
    CapabilityRegistry,
    CapabilityScope,
    InvocationContext,
    UnknownCapabilityError,
)
from patent_studio.capabilities.tools import AGENT_TOOL_REGISTRY
from patent_studio.domain import agents
from patent_studio.domain.organization import Case


class MCPUnauthorized(PermissionError):
    """Bearer authentication or scope failed."""


def _legacy_alias() -> dict[str, str]:
    """旧工具名 → 能力 id；多映射工具取首个语义主面（其余经能力 id 直调）。"""
    from patent_studio.capabilities.tools import TOOL_CAPABILITY_MAP

    primary = {
        "get_docs": "agent.case.documents",
        "read_book": "agent.document.content",
        "list_ai_jobs": "agent.workitem.list",
    }
    aliases: dict[str, str] = {}
    for name, caps in TOOL_CAPABILITY_MAP.items():
        if not caps:
            continue
        aliases[name] = primary.get(name, caps[0])
    return aliases


_LEGACY_ALIASES = _legacy_alias()


class MCPQueryService:
    """Bearer-token boundary over the capability registries."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def _token(self, raw_token: str) -> agents.AgentAccessToken:
        try:
            return agents.authenticate_agent_token(self.session, raw_token, at=datetime.now(UTC))
        except agents.AgentError as exc:
            raise MCPUnauthorized("invalid bearer token") from exc

    def call(self, raw_token: str, tool: str, payload: dict[str, Any] | None = None) -> Any:
        token = self._token(raw_token)
        payload = dict(payload or {})
        principal_id = token.principal_id
        if tool == "list_cases":
            cases = agents.list_cases(
                self.session,
                principal_id=principal_id,
                organization_id=token.organization_id,
            )
            if token.case_id is not None:
                cases = [item for item in cases if item.case_id == token.case_id]
            return cases
        if tool == "read_document":
            try:
                document_id = uuid.UUID(str(payload.get("document_id", "")))
            except (ValueError, AttributeError) as exc:
                raise MCPUnauthorized("document id is invalid") from exc
            document = agents.read_document(self.session, principal_id=principal_id, document_id=document_id)
            self._check_scope(token, document.case_id)
            return document
        if tool == "list_work_items":
            try:
                case_id = uuid.UUID(str(payload.get("case_id", "")))
            except (ValueError, AttributeError) as exc:
                raise MCPUnauthorized("case id is invalid") from exc
            self._check_scope(token, case_id)
            return agents.list_work_items(self.session, principal_id=principal_id, case_id=case_id)
        return self._registry_call(token, tool, payload)

    def _registry_call(self, token: agents.AgentAccessToken, tool: str, payload: dict[str, Any]) -> Any:
        capability_id = tool if tool.startswith("agent.") else _LEGACY_ALIASES.get(tool)
        if capability_id is None:
            raise MCPUnauthorized("unknown MCP tool")
        try:
            spec = AGENT_TOOL_REGISTRY.get(capability_id)
        except UnknownCapabilityError:
            try:
                spec = AGENT_QUERY_REGISTRY.get(capability_id)
            except UnknownCapabilityError as exc:
                raise MCPUnauthorized("unknown MCP tool") from exc
            registry: CapabilityRegistry = AGENT_QUERY_REGISTRY
        else:
            registry = AGENT_TOOL_REGISTRY

        case_id = token.case_id
        if spec.scope is CapabilityScope.ORGANIZATION:
            case_id = None
        elif case_id is None:
            raw_case = payload.pop("case_id", None)
            try:
                case_id = uuid.UUID(str(raw_case)) if raw_case is not None else None
            except (ValueError, AttributeError) as exc:
                raise MCPUnauthorized("case id is invalid") from exc
            if case_id is None:
                raise MCPUnauthorized("case-scoped capability requires a case scope or case_id")
        if case_id is not None:
            self._check_scope(token, case_id)
        context = InvocationContext(
            principal_id=token.principal_id,
            organization_id=token.organization_id,
            case_id=case_id,
            at=datetime.now(UTC),
        )
        try:
            output = registry.invoke(self.session, capability_id, payload, context=context)
        except CapabilityAuthorizationError as exc:
            raise MCPUnauthorized(str(exc)) from exc
        return output.model_dump(mode="json") if hasattr(output, "model_dump") else output

    def _check_scope(self, token: agents.AgentAccessToken, case_id: uuid.UUID) -> None:
        case = self.session.get(Case, case_id)
        if case is None:
            raise MCPUnauthorized("case is outside token scope")
        if token.case_id is not None and token.case_id != case_id:
            raise MCPUnauthorized("case is outside token scope")
        if token.organization_id is not None and token.organization_id != case.organization_id:
            raise MCPUnauthorized("organization is outside token scope")
