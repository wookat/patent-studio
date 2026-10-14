"""Temporal activities backed by the Run domain services."""

from __future__ import annotations

import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from temporalio import activity

from patent_studio.domain.identity import Principal
from patent_studio.domain.runs import (
    Run,
    request_approval,
    transition_run,
)
from patent_studio.infra.db import database_url
from patent_studio.settings import get_settings


def _db():
    url = get_settings().database_url
    if not url:
        raise RuntimeError("PostgreSQL is not configured")
    return create_engine(database_url(url), poolclass=NullPool, hide_parameters=True)


def _principal(session: Session, value: str) -> uuid.UUID:
    principal = session.get(Principal, uuid.UUID(value))
    if principal is None:
        raise ValueError("principal does not exist")
    return principal.id


@activity.defn
def mark_run_running(run_id: str, principal_id: str) -> None:
    engine = _db()
    try:
        with Session(engine) as session, session.begin():
            run = session.scalar(select(Run).where(Run.run_id == run_id))
            if run is None:
                raise ValueError("run does not exist")
            if run.status == "queued":
                transition_run(session, run.id, principal_id=_principal(session, principal_id), status="running")
            elif run.status not in {"running", "waiting_approval"}:
                raise ValueError("run is no longer executable")
    finally:
        engine.dispose()


@activity.defn
def request_review_approval(run_id: str, principal_id: str, approver_id: str) -> None:
    engine = _db()
    try:
        with Session(engine) as session, session.begin():
            run = session.scalar(select(Run).where(Run.run_id == run_id))
            if run is None:
                raise ValueError("run does not exist")
            if run.status == "waiting_approval":
                return
            request_approval(
                session,
                run.id,
                principal_id=_principal(session, principal_id),
                approver_principal_id=_principal(session, approver_id),
            )
    finally:
        engine.dispose()


@activity.defn
def finalize_review(run_id: str, principal_id: str) -> None:
    engine = _db()
    try:
        with Session(engine) as session, session.begin():
            run = session.scalar(select(Run).where(Run.run_id == run_id))
            if run is None:
                raise ValueError("run does not exist")
            if run.status == "succeeded":
                return
            transition_run(session, run.id, principal_id=_principal(session, principal_id), status="succeeded")
    finally:
        engine.dispose()


@activity.defn
def reject_review(run_id: str, principal_id: str) -> None:
    engine = _db()
    try:
        with Session(engine) as session, session.begin():
            run = session.scalar(select(Run).where(Run.run_id == run_id))
            if run is None:
                raise ValueError("run does not exist")
            if run.status == "failed":
                return
            transition_run(
                session,
                run.id,
                principal_id=_principal(session, principal_id),
                status="failed",
                error_summary="approval rejected",
            )
    finally:
        engine.dispose()
