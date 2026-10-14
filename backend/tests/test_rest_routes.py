"""Platform REST routes: authenticated PostgreSQL happy path and fail-closed edges."""

import uuid

from fastapi.testclient import TestClient
from test_auth import _login, _register

from patent_studio.infra.storage import object_ref

pytest_plugins = ("test_auth",)


def _ref(value: str):
    ref = object_ref(value.encode(), "text/markdown")
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def test_platform_route_requires_authenticated_principal(client):
    client, _ = client
    response = client.get("/api/v1/principals/me")
    assert response.status_code == 401
    assert response.json()["detail"]["kind"] == "auth"


def test_platform_openapi_is_exposed(client):
    client, _ = client
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/organizations" in paths
    assert "/api/v1/working-copies/{working_copy_id}/commit" in paths


def test_authenticated_rest_document_commit_is_idempotent(on):
    client = TestClient(on.app)
    email = f"rest-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email, display_name="REST owner")
    client = _login(on, email)

    response = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "rest-org-1"},
        json={"slug": f"rest-{uuid.uuid4().hex[:8]}", "name": "REST Org"},
    )
    assert response.status_code == 201, response.text
    organization = response.json()
    replay = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "rest-org-1"},
        json={"slug": organization["slug"], "name": "REST Org"},
    )
    assert replay.status_code == 201 and replay.json()["id"] == organization["id"]

    case_response = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "rest-case-1"},
        json={"case_key": "REST-1", "title": "REST 案件", "kind": "invention"},
    )
    assert case_response.status_code == 201, case_response.text
    case = case_response.json()

    document_response = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": "rest-doc-1"},
        json={"book": "claims"},
    )
    assert document_response.status_code == 201, document_response.text
    document = document_response.json()
    revision_response = client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": "rest-rev-1"},
        json={"content_ref": _ref("claims v1")},
    )
    assert revision_response.status_code == 201, revision_response.text
    revision = revision_response.json()
    copy_response = client.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": "rest-wc-1"},
        json={},
    )
    assert copy_response.status_code == 201, copy_response.text
    working_copy = copy_response.json()
    assert working_copy["base_revision_id"] == revision["id"]

    save_response = client.put(
        f"/api/v1/working-copies/{working_copy['id']}",
        headers={"Idempotency-Key": "rest-save-1"},
        json={"expected_version": 1, "content_ref": _ref("claims v2")},
    )
    assert save_response.status_code == 200, save_response.text
    commit_response = client.post(
        f"/api/v1/working-copies/{working_copy['id']}/commit",
        headers={"Idempotency-Key": "rest-commit-1"},
        json={"expected_version": 2},
    )
    assert commit_response.status_code == 200, commit_response.text
    operation = commit_response.json()
    assert operation["status"] == "succeeded"
    commit_replay = client.post(
        f"/api/v1/working-copies/{working_copy['id']}/commit",
        headers={"Idempotency-Key": "rest-commit-1"},
        json={"expected_version": 2},
    )
    assert commit_replay.status_code == 200
    assert commit_replay.json()["id"] == operation["id"]


def test_platform_cross_case_and_invalid_command_are_structured(on):
    client = TestClient(on.app)
    email = f"rest-deny-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    client = _login(on, email)
    missing = client.get(f"/api/v1/cases/{uuid.uuid4()}")
    assert missing.status_code == 404
    assert missing.json()["detail"]["kind"] == "not_found"
    invalid = client.post("/api/v1/organizations", json={"slug": "bad", "name": "bad"})
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["kind"] == "validation"


def test_authenticated_rest_proposal_release_work_item_flow(on):
    client = TestClient(on.app)
    email = f"rest-flow-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    client = _login(on, email)
    organization = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "flow-org"},
        json={"slug": f"flow-{uuid.uuid4().hex[:8]}", "name": "Flow Org"},
    ).json()
    case = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "flow-case"},
        json={"case_key": "FLOW-1", "title": "Flow", "kind": "invention"},
    ).json()
    document = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": "flow-doc"},
        json={"book": "claims"},
    ).json()
    revision = client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": "flow-rev"},
        json={"content_ref": _ref("flow v1")},
    ).json()
    proposal = client.post(
        f"/api/v1/cases/{case['id']}/proposals",
        headers={"Idempotency-Key": "flow-proposal"},
        json={
            "target_kind": "document",
            "target_revision_id": revision["id"],
            "result_content_ref": _ref("accepted v2"),
        },
    ).json()
    submitted = client.post(
        f"/api/v1/proposals/{proposal['id']}/submit",
        headers={"Idempotency-Key": "flow-submit"},
        json={},
    )
    assert submitted.status_code == 200, submitted.text
    accepted = client.post(
        f"/api/v1/proposals/{proposal['id']}/accept",
        headers={"Idempotency-Key": "flow-accept"},
        json={},
    )
    assert accepted.status_code == 200, accepted.text
    accepted_revision_id = accepted.json()["accepted_document_revision_id"]
    release = client.post(
        f"/api/v1/cases/{case['id']}/releases",
        headers={"Idempotency-Key": "flow-release"},
        json={},
    ).json()
    item = client.post(
        f"/api/v1/releases/{release['id']}/items",
        headers={"Idempotency-Key": "flow-release-item"},
        json={"item_kind": "document", "revision_id": accepted_revision_id},
    )
    assert item.status_code == 201, item.text
    sealed = client.post(
        f"/api/v1/releases/{release['id']}/seal",
        headers={"Idempotency-Key": "flow-seal"},
        json={},
    )
    assert sealed.status_code == 200 and sealed.json()["status"] == "sealed"
    work_item = client.post(
        f"/api/v1/cases/{case['id']}/work-items",
        headers={"Idempotency-Key": "flow-work-item"},
        json={"type": "review", "title": "审阅", "priority": 2},
    ).json()
    assigned = client.put(
        f"/api/v1/work-items/{work_item['id']}/assignment",
        headers={"Idempotency-Key": "flow-assignment"},
        json={"assignee_principal_id": work_item["reporter_principal_id"]},
    )
    assert assigned.status_code == 200, assigned.text
    notifications = client.get("/api/v1/notifications")
    assert notifications.status_code == 200
    assert any(n["work_item_id"] == work_item["id"] for n in notifications.json())


def test_authenticated_run_rest_query_and_events(on):
    client = TestClient(on.app)
    email = f"rest-run-{uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    client = _login(on, email)
    organization = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "run-rest-org"},
        json={"slug": f"run-{uuid.uuid4().hex[:8]}", "name": "Run Org"},
    ).json()
    case = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "run-rest-case"},
        json={"case_key": "RUN-1", "title": "Run", "kind": "invention"},
    ).json()
    run = client.post(
        f"/api/v1/cases/{case['id']}/runs",
        headers={"Idempotency-Key": "run-rest-create"},
        json={"run_type": "review"},
    )
    assert run.status_code == 201, run.text
    body = run.json()
    assert body["status"] == "queued" and body["operation_id"]
    queried = client.get(f"/api/v1/runs/{body['run_id']}")
    assert queried.status_code == 200 and queried.json()["run_id"] == body["run_id"]
    events = client.get(f"/api/v1/runs/{body['run_id']}/events")
    assert events.status_code == 200 and events.json()[0]["event_type"] == "run.queued"
