"""Run-event SSE stream: live push, Last-Event-ID resume, heartbeat, terminal close, authz."""

import json
import os
import threading
import uuid

import pytest
from test_infra_rest_org_case import _rest_case, _rest_user

pytest_plugins = ("test_infra_auth",)

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)


@pytest.fixture
def fast_sse(monkeypatch):
    from patent_studio.settings import get_settings

    monkeypatch.setenv("PATENT_STUDIO_SSE_POLL_SECONDS", "0.05")
    monkeypatch.setenv("PATENT_STUDIO_SSE_HEARTBEAT_SECONDS", "0.2")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _session(pg_schema):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from patent_studio.infra.db import database_url

    engine = create_engine(database_url(pg_schema))
    return engine, Session(engine)


def _parse(frames_iter):
    """Iterate SSE wire lines into (kind, frame) tuples; kind in {comment, event}."""
    event_id, event_name, data = None, "message", ""
    for line in frames_iter:
        if line.startswith(":"):
            yield "comment", line
        elif line == "":
            if event_name is not None:
                yield "event", {"id": event_id, "event": event_name, "data": data}
            event_id, event_name, data = None, "message", ""
        elif line.startswith("id:"):
            event_id = line[3:].strip()
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data += line[5:].strip()


def _mk_run(client, case_id, tag):
    run = client.post(
        f"/api/v1/cases/{case_id}/runs",
        headers={"Idempotency-Key": f"{tag}-run"},
        json={"run_type": "draft"},
    )
    assert run.status_code == 201, run.text
    return run.json()


def _spawn(pg_schema, fn):
    thread = threading.Thread(target=fn, daemon=True)
    thread.start()
    return thread


def test_sse_stream_pushes_live_events_and_done_on_terminal(on, pg_schema, fast_sse):
    owner = _rest_user(on, "sse-owner")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "sse")
    run = _mk_run(owner, case["id"], "sse")
    run_pk = uuid.UUID(run["id"])

    def drive():
        import uuid as _u

        from patent_studio.domain.runs import transition_run

        engine, session = _session(pg_schema)
        try:
            import time

            time.sleep(0.2)
            with session.begin():
                transition_run(session, run_pk, principal_id=_u.UUID(owner_pid), status="running")
            time.sleep(0.2)
            with session.begin():
                transition_run(session, run_pk, principal_id=_u.UUID(owner_pid), status="succeeded")
        finally:
            engine.dispose()

    writer = _spawn(pg_schema, drive)
    frames = []
    with owner.stream("GET", f"/api/v1/runs/{run['run_id']}/events/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        for kind, frame in _parse(response.iter_lines()):
            frames.append((kind, frame))
            if kind == "event" and frame["event"] == "done":
                break
    writer.join(timeout=10)

    events = [f for k, f in frames if k == "event"]
    kinds = [e["event"] for e in events]
    assert "run-event" in kinds and kinds[-1] == "done"
    seqs = [json.loads(e["data"])["seq"] for e in events if e["event"] == "run-event"]
    assert seqs == sorted(seqs) and seqs[0] == 1
    event_types = [json.loads(e["data"])["event_type"] for e in events if e["event"] == "run-event"]
    assert "run.queued" in event_types and "run.running" in event_types and "run.succeeded" in event_types
    assert json.loads(events[-1]["data"])["status"] == "succeeded"
    # heartbeat comments may appear while the run was mid-flight
    assert all(k == "comment" and f.startswith(":") for k, f in frames if k == "comment")


def test_sse_last_event_id_resumes_after_seq(on, pg_schema, fast_sse):
    owner = _rest_user(on, "sse-resume")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "sser")
    run = _mk_run(owner, case["id"], "sser")

    engine, session = _session(pg_schema)
    try:
        import uuid as _u

        from patent_studio.domain.runs import append_run_event, transition_run

        with session.begin():
            transition_run(session, uuid.UUID(run["id"]), principal_id=_u.UUID(owner_pid), status="running")
            append_run_event(
                session,
                uuid.UUID(run["id"]),
                principal_id=_u.UUID(owner_pid),
                event_type="progress",
                payload={"pct": 50},
            )
            transition_run(session, uuid.UUID(run["id"]), principal_id=_u.UUID(owner_pid), status="succeeded")
    finally:
        engine.dispose()

    # seqs: 1=run.queued 2=run.running 3=progress 4=run.succeeded
    with owner.stream(
        "GET",
        f"/api/v1/runs/{run['run_id']}/events/stream",
        headers={"Last-Event-ID": "2"},
    ) as response:
        assert response.status_code == 200
        events = [f for k, f in _parse(response.iter_lines()) if k == "event"]
    assert events[-1]["event"] == "done"
    seqs = [json.loads(e["data"])["seq"] for e in events if e["event"] == "run-event"]
    assert seqs == [3, 4]
    assert all(e["id"] == str(json.loads(e["data"])["seq"]) for e in events if e["event"] == "run-event")

    bad = owner.get(f"/api/v1/runs/{run['run_id']}/events/stream", headers={"Last-Event-ID": "bogus"})
    assert bad.status_code == 422


def test_sse_terminal_run_closes_immediately(on, pg_schema, fast_sse):
    owner = _rest_user(on, "sse-term")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    _org, case = _rest_case(owner, "sset")
    run = _mk_run(owner, case["id"], "sset")

    engine, session = _session(pg_schema)
    try:
        import uuid as _u

        from patent_studio.domain.runs import transition_run

        with session.begin():
            transition_run(session, uuid.UUID(run["id"]), principal_id=_u.UUID(owner_pid), status="running")
            transition_run(
                session, uuid.UUID(run["id"]), principal_id=_u.UUID(owner_pid), status="failed", error_summary="boom"
            )
    finally:
        engine.dispose()

    with owner.stream("GET", f"/api/v1/runs/{run['run_id']}/events/stream") as response:
        events = [f for k, f in _parse(response.iter_lines()) if k == "event"]
    assert events[-1]["event"] == "done"
    assert json.loads(events[-1]["data"])["status"] == "failed"


def test_sse_stream_scoped_and_rejects_outsiders(on, pg_schema, fast_sse):
    owner = _rest_user(on, "sse-scope-owner")
    outsider = _rest_user(on, "sse-scope-outsider")
    owner_pid = owner.get("/api/v1/principals/me").json()["id"]
    organization, case = _rest_case(owner, "sess")
    other = owner.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "sess-other"},
        json={"case_key": "SESS-2", "title": "Other", "kind": "invention"},
    ).json()
    run = _mk_run(owner, case["id"], "sess")

    # anonymous → 401; outsider → 403/404
    from fastapi.testclient import TestClient

    assert TestClient(on.app).get(f"/api/v1/runs/{run['run_id']}/events/stream").status_code == 401
    denied = outsider.get(f"/api/v1/runs/{run['run_id']}/events/stream")
    assert denied.status_code in (403, 404)

    # agent token scoped to the OTHER case → 403 on this run's stream
    from patent_studio.domain.agents import issue_agent_token, provision_agent
    from patent_studio.domain.organization import CaseParticipant, OrganizationMembership

    engine, session = _session(pg_schema)
    try:
        with session.begin():
            agent = provision_agent(session, agent_key="sse-agent", display_name="SSE Agent")
            for cid in (case["id"], other["id"]):
                session.add(CaseParticipant(case_id=uuid.UUID(cid), principal_id=agent.id, role="drafter"))
            session.add(
                OrganizationMembership(
                    organization_id=uuid.UUID(organization["id"]),
                    principal_id=agent.id,
                    role="member",
                    status="active",
                )
            )
            scoped = issue_agent_token(
                session,
                principal_id=agent.id,
                issuer_principal_id=uuid.UUID(owner_pid),
                organization_id=uuid.UUID(organization["id"]),
                case_id=uuid.UUID(other["id"]),
            )
    finally:
        engine.dispose()

    denied_agent = TestClient(on.app).get(
        f"/api/v1/runs/{run['run_id']}/events/stream", headers={"Authorization": f"Bearer {scoped}"}
    )
    assert denied_agent.status_code == 403


def test_sse_connection_limit_closes_stream(on, pg_schema, monkeypatch):
    from patent_studio.settings import get_settings

    monkeypatch.setenv("PATENT_STUDIO_SSE_POLL_SECONDS", "0.05")
    monkeypatch.setenv("PATENT_STUDIO_SSE_MAX_SECONDS", "0.3")
    get_settings.cache_clear()
    try:
        owner = _rest_user(on, "sse-cap")
        _org, case = _rest_case(owner, "ssec")
        run = _mk_run(owner, case["id"], "ssec")  # stays queued → never terminal
        with owner.stream("GET", f"/api/v1/runs/{run['run_id']}/events/stream") as response:
            events = [f for k, f in _parse(response.iter_lines()) if k == "event"]
        assert events[-1]["event"] == "done"
        assert json.loads(events[-1]["data"])["reason"] == "connection_limit"
    finally:
        get_settings.cache_clear()
