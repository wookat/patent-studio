"""Pydantic AI boundary with an injectable model stub.

Provider configuration is intentionally absent in this batch. The domain side
accepts a deterministic model stub and only creates a draft Proposal.
"""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from patent_studio.domain.agents import ProposalCreateInput, ProposalOutput, create_agent_proposal


class AgentPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")

    target_kind: str = Field(pattern=r"^(document|figure)$")
    target_revision_id: UUID
    result_content_key: str = Field(min_length=1, max_length=512)
    result_content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    result_content_size: int = Field(ge=0)
    result_content_type: str = Field(min_length=1, max_length=128)


class AgentModelStub(Protocol):
    def plan(self, prompt: str) -> AgentPlan | dict[str, Any]:
        """Return a structured plan without external network access."""


class PatentAgent:
    """Small domain adapter; Pydantic AI remains the provider-facing layer."""

    def __init__(self, *, agent_key: str, model: AgentModelStub) -> None:
        self.agent_key = agent_key
        self.model = model

    def run(self, session: Session, *, principal_id: UUID, case_id: UUID, prompt: str) -> ProposalOutput:
        plan = AgentPlan.model_validate(self.model.plan(prompt), by_name=True, by_alias=True)
        request = ProposalCreateInput.model_validate(plan.model_dump(), by_name=True, by_alias=True)
        return create_agent_proposal(session, principal_id=principal_id, case_id=case_id, request=request)


def build_pydantic_ai_agent(*, result_type: type[BaseModel] = AgentPlan, model: Any = None) -> Any:
    """Construct the mature Pydantic AI object when a provider adapter is supplied.

    Import is lazy so deployments without provider extras can still use the
    deterministic stub path and registry/MCP query tools.
    """

    try:
        from pydantic_ai import Agent
    except ImportError as exc:
        raise RuntimeError("pydantic-ai provider extras are unavailable") from exc
    if model is None:
        raise ValueError("a model must be injected; no provider is configured")
    return Agent(model=model, result_type=result_type)
