"""Release DOCX render: sealed snapshot → kernel builder → object-store artifact."""

import asyncio
import hashlib
import io
import os

import pytest

pytest_plugins = ("test_auth",)

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)

ABSTRACT = "本发明公开一种仅基于注意力机制的序列转导模型。"
CLAIMS = (
    "1.一种序列转导模型，其特征在于，包括编码器与解码器，信息传递完全由注意力机制实现。\n\n"
    "2.根据权利要求1所述的模型，编码器包括堆叠的编码层。"
)
DESCRIPTION = "### 技术领域\n\n本发明涉及序列建模。\n\n### 发明内容\n\n完全基于注意力机制。"


def _book_ref(client, store_url, text: str) -> dict:
    from patent_studio.infra.storage import object_ref, open_store

    data = text.encode()
    ref = object_ref(data, "text/markdown")
    asyncio.run(open_store(store_url).put(data, ref.content_type))
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _setup(on, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from test_auth import _login, _register

    from patent_studio.settings import get_settings

    store_url = f"file://{tmp_path / 'objects'}"
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", store_url)
    get_settings.cache_clear()

    client = TestClient(on.app)
    import uuid as _uuid

    email = f"render-{_uuid.uuid4().hex[:10]}@example.com"
    _register(client, email)
    client = _login(on, email)
    organization = client.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": "r-org"},
        json={"slug": f"r-{_uuid.uuid4().hex[:8]}", "name": "Render Org"},
    ).json()
    case = client.post(
        f"/api/v1/organizations/{organization['id']}/cases",
        headers={"Idempotency-Key": "r-case"},
        json={"case_key": "RENDER-1", "title": "注意力机制序列转导模型", "kind": "invention"},
    ).json()
    revisions = {}
    for book, text in (("abstract", ABSTRACT), ("claims", CLAIMS), ("description", DESCRIPTION)):
        document = client.post(
            f"/api/v1/cases/{case['id']}/documents",
            headers={"Idempotency-Key": f"r-doc-{book}"},
            json={"book": book},
        ).json()
        revisions[book] = client.post(
            f"/api/v1/documents/{document['id']}/revisions",
            headers={"Idempotency-Key": f"r-rev-{book}"},
            json={"content_ref": _book_ref(client, store_url, text)},
        ).json()
    return client, case, revisions, store_url


def _release_with_items(client, case_id, revisions):
    release = client.post(
        f"/api/v1/cases/{case_id}/releases",
        headers={"Idempotency-Key": "r-rel"},
        json={},
    ).json()
    for i, book in enumerate(("claims", "description", "abstract"), 1):
        item = client.post(
            f"/api/v1/releases/{release['id']}/items",
            headers={"Idempotency-Key": f"r-item-{book}"},
            json={"item_kind": "document", "revision_id": revisions[book]["id"], "ordinal": i},
        )
        assert item.status_code == 201, item.text
    return release


def test_sealed_release_builds_docx_artifact(on, tmp_path, monkeypatch):
    client, case, revisions, _store_url = _setup(on, tmp_path, monkeypatch)
    try:
        release = _release_with_items(client, case["id"], revisions)

        early = client.post(
            f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "r-build-0"}
        )
        assert early.status_code == 409 and early.json()["detail"]["kind"] == "conflict"

        sealed = client.post(
            f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "r-seal"}, json={}
        )
        assert sealed.status_code == 200 and sealed.json()["status"] == "sealed"

        built = client.post(
            f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "r-build-1"}
        )
        assert built.status_code == 201, built.text
        artifact = built.json()
        assert artifact["filename"].startswith("RENDER-1-") and artifact["filename"].endswith(".docx")
        assert artifact["content_ref"]["content_type"].endswith("wordprocessingml.document")
        assert len(artifact["inputs"]) == 3

        replay = client.post(
            f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "r-build-1"}
        )
        assert replay.status_code == 201 and replay.json()["id"] == artifact["id"]

        again = client.post(
            f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "r-build-2"}
        )
        assert again.status_code == 201 and again.json()["id"] == artifact["id"]

        listing = client.get(f"/api/v1/releases/{release['id']}/artifacts")
        assert listing.status_code == 200 and listing.json()[0]["id"] == artifact["id"]

        data = client.get(f"/api/v1/artifacts/{artifact['id']}/content")
        assert data.status_code == 200
        assert hashlib.sha256(data.content).hexdigest() == artifact["content_ref"]["sha256"]

        import docx

        doc = docx.Document(io.BytesIO(data.content))
        text = "\n".join(p.text for p in doc.paragraphs)
        for marker in ("注意力机制序列转导模型", "本发明公开", "1.一种序列转导模型", "本发明涉及序列建模"):
            assert marker in text, marker
    finally:
        from patent_studio.settings import get_settings

        get_settings.cache_clear()
