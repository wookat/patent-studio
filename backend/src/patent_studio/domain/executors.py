"""Safe external executor boundary; real Codex app-server wiring is deferred."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy.orm import Session

from patent_studio.domain import agents
from patent_studio.domain.runs import Run, append_run_event
from patent_studio.domain.work_items import WorkItem


class ExecutorError(ValueError):
    """Delegation rejected or callback invalid."""


@dataclass(frozen=True, slots=True)
class DelegationRequest:
    run_id: uuid.UUID
    principal_id: uuid.UUID
    case_id: uuid.UUID
    work_item_id: uuid.UUID | None
    prompt: str
    outbound: dict[str, str] = field(default_factory=dict)
    recursive: bool = False
    confirmed: bool = False


@dataclass(frozen=True, slots=True)
class ExecutorTask:
    task_id: str
    run_id: uuid.UUID


class ExecutorAdapter(Protocol):
    def submit(self, request: DelegationRequest) -> ExecutorTask:
        """Submit an already-authorized request to an external executor."""


class FakeExecutor:
    """Deterministic test adapter; it never leaves the process."""

    def __init__(self) -> None:
        self.requests: list[DelegationRequest] = []

    def submit(self, request: DelegationRequest) -> ExecutorTask:
        self.requests.append(request)
        return ExecutorTask(task_id=f"fake-{len(self.requests)}", run_id=request.run_id)


def submit_delegation(
    session: Session,
    request: DelegationRequest,
    *,
    executor: ExecutorAdapter,
    allowed_outbound_keys: frozenset[str] = frozenset(),
    expected_epoch: int | None = None,
) -> ExecutorTask:
    if request.recursive:
        raise ExecutorError("recursive agent delegation is disabled")
    if not request.confirmed:
        raise ExecutorError("external delegation requires an explicit confirmation gate")
    if not request.prompt.strip() or any(key not in allowed_outbound_keys for key in request.outbound):
        raise ExecutorError("outbound content is outside the allowlist")
    run = session.get(Run, request.run_id)
    if run is None or run.case_id != request.case_id:
        raise ExecutorError("delegation run is outside the case scope")
    if request.work_item_id is not None:
        item = session.get(WorkItem, request.work_item_id)
        if item is None or item.case_id != request.case_id:
            raise ExecutorError("delegation work item is outside the case scope")
    task = executor.submit(request)
    append_run_event(
        session,
        request.run_id,
        principal_id=request.principal_id,
        event_type="delegation.submitted",
        payload={"task_id": task.task_id, "work_item_id": str(request.work_item_id) if request.work_item_id else None},
        expected_epoch=expected_epoch,
        activity_key=f"delegation:{task.task_id}",
    )
    return task


def receive_executor_event(
    session: Session,
    *,
    run_id: uuid.UUID,
    principal_id: uuid.UUID,
    task_id: str,
    event_type: str,
    payload: dict[str, Any],
    expected_epoch: int | None = None,
) -> agents.ProposalOutput | None:
    if not task_id.strip() or not event_type.strip():
        raise ExecutorError("task_id and event_type are required")
    append_run_event(
        session,
        run_id,
        principal_id=principal_id,
        event_type=f"executor.{event_type}",
        payload={"task_id": task_id, **payload},
        expected_epoch=expected_epoch,
        activity_key=f"executor:{task_id}:{event_type}",
    )
    if event_type != "proposal.ready":
        return None
    try:
        request = agents.ProposalCreateInput.model_validate(payload, by_name=True, by_alias=True)
        from patent_studio.domain.runs import Run

        run = session.get(Run, run_id)
        if run is None:
            raise ExecutorError("run does not exist")
        return agents.create_agent_proposal(
            session,
            principal_id=principal_id,
            case_id=run.case_id,
            request=request,
        )
    except Exception as exc:
        if isinstance(exc, ExecutorError):
            raise
        raise ExecutorError("executor proposal payload is invalid") from exc
