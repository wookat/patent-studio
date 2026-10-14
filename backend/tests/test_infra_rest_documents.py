# -*- coding: utf-8 -*-
"""平台 /api/v1 documents/revisions/working-copies 面（B4）：
文档→修订→工作副本→commit 幂等链、内容往返+乐观锁 409、跨 case fail-closed、对象存储未配 503。
改自参照分支 test_rest_routes.py 的 documents 段。基建复用 test_infra_auth/test_infra_rest_org_case。
"""

import uuid

from test_infra_rest_org_case import _rest_case, _rest_user

from patent_studio.infra.storage import object_ref
from patent_studio.settings import get_settings

pytest_plugins = ("test_infra_auth",)


def _ref(value: str):
    ref = object_ref(value.encode(), "text/markdown")
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _doc_with_revision(client, case, tag="d"):
    document = client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": f"{tag}-doc"},
        json={"book": "claims"},
    ).json()
    revision = client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": f"{tag}-rev"},
        json={"content_ref": _ref("权利要求 v1")},
    ).json()
    return document, revision


def test_document_revision_working_copy_commit_is_idempotent(on):
    client = _rest_user(on, "doc-owner")
    _organization, case = _rest_case(client, "doc")
    document, revision = _doc_with_revision(client, case)

    copy_response = client.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": "doc-wc"},
        json={},
    )
    assert copy_response.status_code == 201, copy_response.text
    working_copy = copy_response.json()
    assert working_copy["base_revision_id"] == revision["id"]

    save_response = client.put(
        f"/api/v1/working-copies/{working_copy['id']}",
        headers={"Idempotency-Key": "doc-save"},
        json={"expected_version": 1, "content_ref": _ref("权利要求 v2")},
    )
    assert save_response.status_code == 200, save_response.text
    commit_response = client.post(
        f"/api/v1/working-copies/{working_copy['id']}/commit",
        headers={"Idempotency-Key": "doc-commit"},
        json={"expected_version": 2},
    )
    assert commit_response.status_code == 200, commit_response.text
    operation = commit_response.json()
    assert operation["status"] == "succeeded"
    # 同 key 同载荷重放：同一 Operation DTO
    commit_replay = client.post(
        f"/api/v1/working-copies/{working_copy['id']}/commit",
        headers={"Idempotency-Key": "doc-commit"},
        json={"expected_version": 2},
    )
    assert commit_replay.status_code == 200
    assert commit_replay.json()["id"] == operation["id"]
    # 提交落新修订：链长 +1
    revisions = client.get(f"/api/v1/documents/{document['id']}/revisions").json()
    assert len(revisions) == 2 and revisions[-1]["parent_revision_id"] == revision["id"]


def test_working_copy_content_roundtrip_and_stale_409(on, tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", f"file://{tmp_path / 'objects'}")
    get_settings.cache_clear()
    try:
        client = _rest_user(on, "wc-content")
        _organization, case = _rest_case(client, "wcc")
        document, revision = _doc_with_revision(client, case, tag="wcc")
        copy = client.post(
            f"/api/v1/documents/{document['id']}/working-copies",
            headers={"Idempotency-Key": "wcc-wc"},
            json={"base_revision_id": revision["id"]},
        ).json()

        saved = client.put(
            f"/api/v1/working-copies/{copy['id']}/content",
            headers={"Idempotency-Key": "wcc-save"},
            json={"expected_version": copy["version"], "content": "权利要求 v2 正文"},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["version"] == copy["version"] + 1
        fetched = client.get(f"/api/v1/working-copies/{copy['id']}/content")
        assert fetched.status_code == 200
        assert fetched.text == "权利要求 v2 正文"

        # 乐观锁：过期 expected_version → 409 conflict
        stale = client.put(
            f"/api/v1/working-copies/{copy['id']}/content",
            headers={"Idempotency-Key": "wcc-stale"},
            json={"expected_version": copy["version"], "content": "过期版本写入"},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"]["kind"] == "conflict"
    finally:
        get_settings.cache_clear()


def test_document_routes_fail_closed(on):
    owner = _rest_user(on, "df-owner")
    outsider = _rest_user(on, "df-outsider")
    _organization, case = _rest_case(owner, "df")
    document, _revision = _doc_with_revision(owner, case, tag="df")

    # 跨 case：非参与者读文档面 403 denied
    r = outsider.get(f"/api/v1/cases/{case['id']}/documents")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"
    r = outsider.get(f"/api/v1/documents/{document['id']}")
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"
    # 不存在：404 not_found
    r = owner.get(f"/api/v1/documents/{uuid.uuid4()}")
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"


def test_copy_content_requires_configured_storage(on):
    client = _rest_user(on, "st-owner")
    _organization, case = _rest_case(client, "st")
    document, revision = _doc_with_revision(client, case, tag="st")
    copy = client.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": "st-wc"},
        json={"base_revision_id": revision["id"]},
    ).json()
    # PATENT_STUDIO_STORAGE_URL 未设 → 503 storage_unavailable
    r = client.get(f"/api/v1/working-copies/{copy['id']}/content")
    assert r.status_code == 503 and r.json()["detail"]["kind"] == "storage_unavailable"


def test_documents_openapi_paths_exposed(client):
    client, _ = client
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/cases/{case_id}/documents" in paths
    assert "/api/v1/working-copies/{working_copy_id}/commit" in paths
