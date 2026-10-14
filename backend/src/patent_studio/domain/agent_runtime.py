"""Pydantic AI boundary: deterministic stub or a real OpenAI-compatible gateway.

The domain side accepts an injectable model (stub or `GatewayModel`) and only
ever creates a draft Proposal through the governed proposal path.
"""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from patent_studio.domain.agents import ProposalCreateInput, ProposalOutput, create_agent_proposal
from patent_studio.settings import Settings, get_settings


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


class AgentPlanError(ValueError):
    """LLM plan 生成失败（网关错误/坏 JSON/超时）；不会产生任何提案写入。"""


class GatewayModel:
    """OpenAI-compatible gateway → structured `AgentPlan` via pydantic-ai."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model_name: str,
        http_client: httpx.AsyncClient | None = None,
        timeout: float = 60.0,
    ) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        client = http_client or httpx.AsyncClient(timeout=timeout)
        provider = OpenAIProvider(base_url=base_url, api_key=api_key, http_client=client)
        self._agent = Agent(OpenAIChatModel(model_name, provider=provider), output_type=AgentPlan)

    def plan(self, prompt: str) -> AgentPlan:
        try:
            return self._agent.run_sync(prompt).output
        except Exception as exc:
            raise AgentPlanError(f"LLM plan generation failed: {type(exc).__name__}") from exc


def llm_configured(settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    return bool(s.llm_base_url and s.llm_api_key and s.llm_model)


def default_model(
    settings: Settings | None = None, *, http_client: httpx.AsyncClient | None = None
) -> GatewayModel | None:
    """Return a real gateway model when configured; `None` keeps callers on the stub path."""
    s = settings or get_settings()
    if not llm_configured(s):
        return None
    return GatewayModel(
        base_url=s.llm_base_url, api_key=s.llm_api_key, model_name=s.llm_model, http_client=http_client
    )


class PatentAgent:
    """Small domain adapter; Pydantic AI remains the provider-facing layer."""

    def __init__(self, *, agent_key: str, model: AgentModelStub) -> None:
        self.agent_key = agent_key
        self.model = model

    def run(
        self,
        session: Session,
        *,
        principal_id: UUID,
        case_id: UUID,
        prompt: str,
        run_id: UUID | None = None,
    ) -> ProposalOutput:
        try:
            plan = AgentPlan.model_validate(self.model.plan(prompt), by_name=True, by_alias=True)
            request = ProposalCreateInput.model_validate(plan.model_dump(), by_name=True, by_alias=True)
        except Exception as exc:
            if run_id is not None:
                from patent_studio.domain.runs import append_run_event

                append_run_event(
                    session,
                    run_id,
                    principal_id=principal_id,
                    event_type="agent.plan_failed",
                    payload={"error": str(exc), "agent_key": self.agent_key},
                )
            if isinstance(exc, AgentPlanError):
                raise
            raise AgentPlanError(f"agent plan invalid: {exc}") from exc
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
