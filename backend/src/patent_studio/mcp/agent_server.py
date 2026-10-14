"""Query-only MCP resource-server boundary for registered Agent tokens.

The existing legacy MCP application remains separate. This adapter deliberately
accepts a DB session and a bearer token so transports cannot invent identity.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from patent_studio.domain import agents
from patent_studio.domain.organization import Case


class MCPUnauthorized(PermissionError):
    """Bearer authentication or scope failed."""


class MCPQueryService:
    """Expose only registry query handlers; no command is accepted here."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def _token(self, raw_token: str) -> agents.AgentAccessToken:
        try:
            return agents.authenticate_agent_token(self.session, raw_token, at=datetime.now(UTC))
        except agents.AgentError as exc:
            raise MCPUnauthorized("invalid bearer token") from exc

    def call(self, raw_token: str, tool: str, payload: dict[str, Any] | None = None) -> Any:
        token = self._token(raw_token)
        payload = payload or {}
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
        raise MCPUnauthorized("unknown or non-query MCP tool")

    def _check_scope(self, token: agents.AgentAccessToken, case_id: uuid.UUID) -> None:
        case = self.session.get(Case, case_id)
        if case is None:
            raise MCPUnauthorized("case is outside token scope")
        if token.case_id is not None and token.case_id != case_id:
            raise MCPUnauthorized("case is outside token scope")
        if token.organization_id is not None and token.organization_id != case.organization_id:
            raise MCPUnauthorized("organization is outside token scope")
