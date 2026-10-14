"""Agent query capabilities backed by the shared Capability Registry."""

from __future__ import annotations

from patent_studio.capabilities.registry import (
    CapabilityKind,
    CapabilityRegistry,
    CapabilityRisk,
    CapabilityScope,
    CapabilitySpec,
    InvocationContext,
)
from patent_studio.domain import agents

AGENT_QUERY_REGISTRY = CapabilityRegistry()


def _list_cases(session, payload: agents.CaseListInput, context: InvocationContext) -> agents.CaseListOutput:
    return agents.CaseListOutput(
        cases=agents.list_cases(session, principal_id=context.principal_id, organization_id=context.organization_id)
    )


def _read_document(session, payload: agents.DocumentReadInput, context: InvocationContext) -> agents.DocumentReadOutput:
    return agents.read_document(session, principal_id=context.principal_id, document_id=payload.document_id)


def _list_work_items(
    session, payload: agents.WorkItemListInput, context: InvocationContext
) -> agents.WorkItemListOutput:
    if context.case_id is None:
        raise ValueError("case context is required")
    return agents.WorkItemListOutput(
        work_items=agents.list_work_items(session, principal_id=context.principal_id, case_id=context.case_id)
    )


AGENT_QUERY_REGISTRY.register(
    CapabilitySpec(
        id="agent.case.list",
        version="1.0.0",
        kind=CapabilityKind.QUERY,
        risk=CapabilityRisk.LOW,
        scope=CapabilityScope.ORGANIZATION,
        input_model=agents.CaseListInput,
        output_model=agents.CaseListOutput,
        handler=_list_cases,
    )
)
AGENT_QUERY_REGISTRY.register(
    CapabilitySpec(
        id="agent.document.read",
        version="1.0.0",
        kind=CapabilityKind.QUERY,
        risk=CapabilityRisk.LOW,
        scope=CapabilityScope.CASE,
        input_model=agents.DocumentReadInput,
        output_model=agents.DocumentReadOutput,
        handler=_read_document,
    )
)
AGENT_QUERY_REGISTRY.register(
    CapabilitySpec(
        id="agent.workitem.list",
        version="1.0.0",
        kind=CapabilityKind.QUERY,
        risk=CapabilityRisk.LOW,
        scope=CapabilityScope.CASE,
        input_model=agents.WorkItemListInput,
        output_model=agents.WorkItemListOutput,
        handler=_list_work_items,
    )
)
