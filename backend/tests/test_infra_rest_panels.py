# -*- coding: utf-8 -*-
"""B13：/api/v1 面板支撑面（附图上传/预览、release 组包项列表、案件体检）。

- POST /figures/{id}/revisions（multipart 图片 → 对象存储 → 不可变 FigureRevision）
- GET  /figures/{id}/content（当前修订图片字节，缩略预览/导出链路共用）
- GET  /releases/{id}/items（组包项按 ordinal 列表）
- GET  /cases/{id}/preflight（三书组装 → kernel preflight.run）
基建复用 test_auth / test_infra_rest_org_case / test_infra_rest_editor。
"""

import pathlib

import pytest
from test_infra_rest_editor import _committed_revision_doc
from test_infra_rest_org_case import _rest_case, _rest_user

from patent_studio.settings import get_settings

pytest_plugins = ("test_auth",)

_EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "examples" / "method"
_PNG = (_EXAMPLES / "figs" / "fig1.png").read_bytes()


@pytest.fixture()
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", f"file://{tmp_path / 'objects'}")
    get_settings.cache_clear()
    yield tmp_path / "objects"
    get_settings.cache_clear()


def _book_docs(client, case, tag):
    docs = {}
    for book in ("abstract", "claims", "description"):
        docs[book] = _committed_revision_doc(
            client, case, f"{tag}-{book}", body=(_EXAMPLES / "docs" / f"{book}.md").read_text("utf-8"), book=book
        )
    return docs


def test_figure_upload_preview_and_fail_closed(on, storage):
    owner = _rest_user(on, "b13-fig-owner")
    _org, case = _rest_case(owner, "b13fig")
    figure = owner.post(
        f"/api/v1/cases/{case['id']}/figures",
        headers={"Idempotency-Key": "b13-fig-create"},
        json={"figure_no": 1, "title": "方法流程图"},
    ).json()

    # 无修订 → content 404
    assert owner.get(f"/api/v1/figures/{figure['id']}/content").status_code == 404

    revision = owner.post(
        f"/api/v1/figures/{figure['id']}/revisions",
        headers={"Idempotency-Key": "b13-fig-rev1"},
        files={"file": ("fig1.png", _PNG, "image/png")},
    )
    assert revision.status_code == 201, revision.text
    assert revision.json()["revision_no"] == 1
    assert revision.json()["content_ref"]["size"] == len(_PNG)

    # 同 key 重放返回同 DTO，不再追加修订
    replay = owner.post(
        f"/api/v1/figures/{figure['id']}/revisions",
        headers={"Idempotency-Key": "b13-fig-rev1"},
        files={"file": ("fig1.png", _PNG, "image/png")},
    )
    assert replay.status_code == 201 and replay.json()["id"] == revision.json()["id"]
    assert len(owner.get(f"/api/v1/figures/{figure['id']}/revisions").json()) == 1

    content = owner.get(f"/api/v1/figures/{figure['id']}/content")
    assert content.status_code == 200
    assert content.headers["content-type"] == "image/png"
    assert content.content == _PNG

    # 当前修订推进：二次上传 → revision_no=2，content 仍回新字节
    fig2 = (_EXAMPLES / "figs" / "fig2.png").read_bytes()
    revision2 = owner.post(
        f"/api/v1/figures/{figure['id']}/revisions",
        headers={"Idempotency-Key": "b13-fig-rev2"},
        files={"file": ("fig2.png", fig2, "image/png")},
    )
    assert revision2.json()["revision_no"] == 2
    assert owner.get(f"/api/v1/figures/{figure['id']}/content").content == fig2

    # outsider 全链 fail-closed
    outsider = _rest_user(on, "b13-fig-outsider")
    for method, path, kwargs in (
        ("get", f"/api/v1/figures/{figure['id']}/content", {}),
        ("get", f"/api/v1/figures/{figure['id']}/revisions", {}),
        (
            "post",
            f"/api/v1/figures/{figure['id']}/revisions",
            {"files": {"file": ("x.png", _PNG, "image/png")}, "headers": {"Idempotency-Key": "b13-fig-out"}},
        ),
    ):
        denied = getattr(outsider, method)(path, **kwargs)
        assert denied.status_code == 403, (method, path, denied.text)


def test_release_items_list_and_real_docx_build(on, storage):
    owner = _rest_user(on, "b13-rel-owner")
    _org, case = _rest_case(owner, "b13rel")
    docs = _book_docs(owner, case, "b13rel")
    figure = owner.post(
        f"/api/v1/cases/{case['id']}/figures",
        headers={"Idempotency-Key": "b13-rel-fig"},
        json={"figure_no": 1, "title": "方法流程图"},
    ).json()
    fig_revision = owner.post(
        f"/api/v1/figures/{figure['id']}/revisions",
        headers={"Idempotency-Key": "b13-rel-figrev"},
        files={"file": ("fig1.png", _PNG, "image/png")},
    ).json()

    release = owner.post(
        f"/api/v1/cases/{case['id']}/releases",
        headers={"Idempotency-Key": "b13-rel-create"},
        json={},
    ).json()
    assert owner.get(f"/api/v1/releases/{release['id']}/items").json() == []

    for i, book in enumerate(("abstract", "claims", "description"), 1):
        revision = owner.get(f"/api/v1/documents/{docs[book]['id']}/revisions").json()[0]
        item = owner.post(
            f"/api/v1/releases/{release['id']}/items",
            headers={"Idempotency-Key": f"b13-rel-item-{book}"},
            json={"item_kind": "document", "revision_id": revision["id"], "ordinal": i},
        )
        assert item.status_code == 201, item.text
    fig_item = owner.post(
        f"/api/v1/releases/{release['id']}/items",
        headers={"Idempotency-Key": "b13-rel-item-fig"},
        json={"item_kind": "figure", "revision_id": fig_revision["id"], "ordinal": 4},
    )
    assert fig_item.status_code == 201 and fig_item.json()["item_kind"] == "figure"

    items = owner.get(f"/api/v1/releases/{release['id']}/items").json()
    assert [it["ordinal"] for it in items] == [1, 2, 3, 4]
    assert [it["item_kind"] for it in items] == ["document", "document", "document", "figure"]

    # 未封存 → build 409
    early = owner.post(f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "b13-rel-early"}, json={})
    assert early.status_code == 409

    owner.post(f"/api/v1/releases/{release['id']}/seal", headers={"Idempotency-Key": "b13-rel-seal"}, json={})
    artifact = owner.post(
        f"/api/v1/releases/{release['id']}/build", headers={"Idempotency-Key": "b13-rel-build"}, json={}
    )
    assert artifact.status_code == 201, artifact.text
    assert artifact.json()["filename"].endswith(".docx")

    artifacts = owner.get(f"/api/v1/releases/{release['id']}/artifacts").json()
    assert [a["id"] for a in artifacts] == [artifact.json()["id"]]

    blob = owner.get(f"/api/v1/artifacts/{artifact.json()['id']}/content")
    assert blob.status_code == 200
    assert blob.content[:4] == b"PK\x03\x04"  # 真 DOCX（zip 容器魔数）
    assert blob.headers["content-disposition"].endswith('.docx"')


def test_case_preflight_runs_kernel_rules(on, storage):
    owner = _rest_user(on, "b13-pf-owner")
    _org, case = _rest_case(owner, "b13pf")

    # 空案件（无修订）→ 200 + 结构化报告（kernel 对空说明书报 spec.section_missing 属正确行为）
    empty = owner.get(f"/api/v1/cases/{case['id']}/preflight")
    assert empty.status_code == 200, empty.text
    assert isinstance(empty.json()["items"], list) and "error" in empty.json()["counts"]

    # 说明书正文引用不存在的图1 → kernel 报 figures.ref_missing error（真规则链；refs 扫描只覆盖摘要/说明书段落）
    _committed_revision_doc(owner, case, "b13pf", body="### 具体实施方式\n\n传感器模块如图1所示。", book="description")
    report = owner.get(f"/api/v1/cases/{case['id']}/preflight")
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["counts"]["error"] >= 1
    assert any(it["rule"] == "figures.ref_missing" and it["severity"] == "error" for it in body["items"])
    hit = next(it for it in body["items"] if it["rule"] == "figures.ref_missing")
    assert hit["book"] == "description" and hit["line"]

    # outsider / 匿名 fail-closed
    outsider = _rest_user(on, "b13-pf-outsider")
    assert outsider.get(f"/api/v1/cases/{case['id']}/preflight").status_code == 403


def test_release_items_outsider_fail_closed(on, storage):
    owner = _rest_user(on, "b13-out-owner")
    outsider = _rest_user(on, "b13-out-outsider")
    _org, case = _rest_case(owner, "b13out")
    release = owner.post(
        f"/api/v1/cases/{case['id']}/releases", headers={"Idempotency-Key": "b13-out-rel"}, json={}
    ).json()
    assert outsider.get(f"/api/v1/releases/{release['id']}/items").status_code == 403
    assert outsider.get(f"/api/v1/releases/{release['id']}/artifacts").status_code == 403
