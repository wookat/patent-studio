# -*- coding: utf-8 -*-
"""平台 /api/v1 编辑器支撑面（B12 旧编辑器页面移植）：
- POST /documents/{id}/ast：kernel AST（单书正文 → 三书合一包裹 → parse_ast；content=None 用 current revision）
- POST /kernel/mathml：线性公式 / LaTeX → MathML（旧编辑器公式对话框）
基建复用 test_auth / test_infra_rest_org_case。
"""

import uuid

from fastapi.testclient import TestClient
from test_infra_rest_org_case import _rest_case, _rest_user

from patent_studio.infra.storage import object_ref
from patent_studio.settings import get_settings

pytest_plugins = ("test_auth",)

_CLAIMS = "1.一种装置，其特征在于，包括：传感器模块。\n\n2.根据权利要求1所述的装置，其特征在于，还包括控制器。"

_EMPTY_REF = object_ref(b"", "text/markdown; charset=utf-8")


def _ref(value: str):
    ref = object_ref(value.encode(), "text/markdown; charset=utf-8")
    return {"key": ref.key, "sha256": ref.sha256, "size": ref.size, "content_type": ref.content_type}


def _doc(client, case, tag, book="claims"):
    return client.post(
        f"/api/v1/cases/{case['id']}/documents",
        headers={"Idempotency-Key": f"{tag}-doc"},
        json={"book": book},
    ).json()


def _committed_revision_doc(client, case, tag, body=_CLAIMS, book="claims"):
    """经 working-copy 链路写入真实对象并 commit → current revision 内容在对象存储中可读。"""
    document = _doc(client, case, tag, book=book)
    # 无修订文档：open_working_copy 需显式 content_ref（空对象 ref）
    empty_ref = {"key": _EMPTY_REF.key, "sha256": _EMPTY_REF.sha256, "size": 0, "content_type": _EMPTY_REF.content_type}
    copy = client.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": f"{tag}-wc"},
        json={"content_ref": empty_ref},
    ).json()
    saved = client.put(
        f"/api/v1/working-copies/{copy['id']}/content",
        headers={"Idempotency-Key": f"{tag}-save"},
        json={"expected_version": copy["version"], "content": body},
    ).json()
    client.post(
        f"/api/v1/working-copies/{copy['id']}/commit",
        headers={"Idempotency-Key": f"{tag}-commit"},
        json={"expected_version": saved["version"]},
    )
    return document


def test_document_ast_from_current_revision(on, tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", f"file://{tmp_path / 'objects'}")
    get_settings.cache_clear()
    try:
        client = _rest_user(on, "ast-owner")
        _org, case = _rest_case(client, "ast")
        document = _committed_revision_doc(client, case, "ast")

        r = client.post(f"/api/v1/documents/{document['id']}/ast", json={})
        assert r.status_code == 200, r.text
        out = r.json()
        ast, content = out["ast"], out["content"]
        # 包裹为三书合一布局：# 标题 + ## 摘要 / 权利要求书 / 说明书
        assert content.startswith("# 文稿\n\n## 摘要\n\n## 权利要求书\n")
        assert content.rstrip().endswith("## 说明书")
        assert ast["title"]["text"] == "文稿"
        # claims = 权利要求块列表；全文行号 = books.claims.offset + lines.start（offset 为 ## 行号）
        assert len(ast["claims"]) == 2
        offset = ast["books"]["claims"]["offset"]
        lines = ast["claims"][0]["lines"]
        assert content.split("\n")[offset + lines["start"] - 1].startswith("1.一种装置")
        assert lines["end"] >= lines["start"]
    finally:
        get_settings.cache_clear()


def test_document_ast_preview_body_and_storage_unavailable(on):
    client = _rest_user(on, "ast-prev")
    _org, case = _rest_case(client, "ap")
    document = _doc(client, case, "ap")

    # content 预览：按所给单书正文解析，不依赖对象存储 / revision
    r = client.post(f"/api/v1/documents/{document['id']}/ast", json={"content": "1.预览权项。"})
    assert r.status_code == 200, r.text
    assert len(r.json()["ast"]["claims"]) == 1
    assert r.json()["content"].startswith("# 文稿\n\n## 摘要\n\n## 权利要求书\n")

    # 无修订文档：content=None → 空正文包裹（新建文稿进编辑器即空书），不触存储
    r = client.post(f"/api/v1/documents/{document['id']}/ast", json={})
    assert r.status_code == 200, r.text
    assert r.json()["ast"]["claims"] == []

    # 有 revision（只挂 ref 元数据、对象未上传）+ storage 未配 → 503 storage_unavailable
    client.post(
        f"/api/v1/documents/{document['id']}/revisions",
        headers={"Idempotency-Key": "ap-rev"},
        json={"content_ref": _ref("1.历史权项。")},
    )
    r = client.post(f"/api/v1/documents/{document['id']}/ast", json={})
    assert r.status_code == 503 and r.json()["detail"]["kind"] == "storage_unavailable"


def test_document_ast_fail_closed_and_parse_error(on):
    owner = _rest_user(on, "ast-fc-owner")
    outsider = _rest_user(on, "ast-fc-out")
    _org, case = _rest_case(owner, "af")
    document = _doc(owner, case, "af", book="description")

    # 非参与者：403 denied
    r = outsider.post(f"/api/v1/documents/{document['id']}/ast", json={"content": "x"})
    assert r.status_code == 403 and r.json()["detail"]["kind"] == "denied"
    # 不存在：404 not_found
    r = owner.post(f"/api/v1/documents/{uuid.uuid4()}/ast", json={"content": "x"})
    assert r.status_code == 404 and r.json()["detail"]["kind"] == "not_found"
    # 结构不成立（说明书未闭合公式行）→ 422 content + 折算后的全文行号
    r = owner.post(
        f"/api/v1/documents/{document['id']}/ast",
        json={"content": "技术领域\n\n$$\n未闭合公式"},
    )
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "content"
    assert r.json()["detail"]["detail"]["line"] is not None


def test_working_copies_list_scoped_to_principal(on):
    owner = _rest_user(on, "wcl-owner")
    outsider = _rest_user(on, "wcl-out")
    _org, case = _rest_case(owner, "wl")
    document = _doc(owner, case, "wl")
    empty_ref = {"key": _EMPTY_REF.key, "sha256": _EMPTY_REF.sha256, "size": 0, "content_type": _EMPTY_REF.content_type}
    copy = owner.post(
        f"/api/v1/documents/{document['id']}/working-copies",
        headers={"Idempotency-Key": "wl-wc"},
        json={"content_ref": empty_ref},
    ).json()

    listed = owner.get(f"/api/v1/documents/{document['id']}/working-copies")
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()] == [copy["id"]]
    # 非本人 / 非参与者不可见、不可读
    assert outsider.get(f"/api/v1/documents/{document['id']}/working-copies").status_code == 403


def test_kernel_mathml_roundtrip_and_auth(on):
    client = _rest_user(on, "mml-user")
    r = client.post("/api/v1/kernel/mathml", json={"source": "x_i = \\frac{1}{2} t^2"})
    assert r.status_code == 200, r.text
    mathml = r.json()["mathml"]
    assert mathml.startswith("<math") and 'display="block"' in mathml

    anon = TestClient(on.app)
    r = anon.post("/api/v1/kernel/mathml", json={"source": "x"})
    assert r.status_code == 401


def test_editor_openapi_paths_exposed(client):
    client, _ = client
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/documents/{document_id}/ast" in paths
    assert "/api/v1/kernel/mathml" in paths
