"""Temporal connection configuration and deterministic review workflow sample."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from temporalio.client import Client


@dataclass(frozen=True)
class TemporalSettings:
    address: str = "localhost:7233"
    namespace: str = "default"
    task_queue: str = "patent-studio"

    @classmethod
    def from_env(cls) -> TemporalSettings:
        import os

        return cls(
            address=os.getenv("PATENT_STUDIO_TEMPORAL_ADDRESS", cls.address),
            namespace=os.getenv("PATENT_STUDIO_TEMPORAL_NAMESPACE", cls.namespace),
            task_queue=os.getenv("PATENT_STUDIO_TEMPORAL_TASK_QUEUE", cls.task_queue),
        )


async def connect_temporal(settings: TemporalSettings | None = None) -> Client:
    settings = settings or TemporalSettings.from_env()
    return await Client.connect(settings.address, namespace=settings.namespace)


@workflow.defn
class ReviewWorkflow:
    """Review pipeline: durable steps -> approval signal -> finalize/reject."""

    def __init__(self):
        self._decision: bool | None = None
        self._cancelled = False

    @workflow.run
    async def run(self, run_id: str, principal_id: str, approver_id: str) -> str:
        await workflow.execute_activity(
            "mark_run_running",
            args=[run_id, principal_id],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        await workflow.execute_activity(
            "request_review_approval",
            args=[run_id, principal_id, approver_id],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        await workflow.wait_condition(lambda: self._decision is not None or self._cancelled)
        if self._cancelled:
            return "canceled"
        if self._decision:
            await workflow.execute_activity(
                "finalize_review",
                args=[run_id, principal_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=None,
            )
            return "succeeded"
        await workflow.execute_activity(
            "reject_review",
            args=[run_id, principal_id],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=None,
        )
        return "failed"

    @workflow.signal
    async def approval(self, approved: bool) -> None:
        self._decision = approved

    @workflow.signal
    async def cancel(self) -> None:
        self._cancelled = True
