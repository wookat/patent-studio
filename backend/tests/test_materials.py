"""Material/SourceAnchor/Fact: sourced evidence model over real PostgreSQL + file storage."""

import hashlib
import os

import pytest
from test_rest_routes import _rest_case, _rest_user

pytest_plugins = ("test_auth",)

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"), reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL"
)


@pytest.fixture
def store_env(tmp_path, monkeypatch):
    from patent_studio.settings import get_settings

    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", f"file://{tmp_path / 'objects'}")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _material(client, case_id, tag, *, kind="text", **extra):
    body = {"kind": kind, "title": "交底书草稿", **extra}
    if kind != "url":
        body.setdefault("content", "本发明的技术方案包括注意力模块与序列转导步骤。")
    response = client.post(
        f"/api/v1/cases/{case_id}/materials", headers={"Idempotency-Key": f"{tag}-mat"}, json=body
    )
    assert response.status_code == 201, response.text
    return response.json()


def _fact(client, case_id, tag, **kwargs):
    response = client.post(
        f"/api/v1/cases/{case_id}/facts",
        headers={"Idempotency-Key": tag},
        json={"statement": "编码器堆叠 N=6 个相同层", **kwargs},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_material_anchor_fact_chain_with_confirm(on, store_env):
    """材料(text)→锚点(locator+excerpt)→fact→confirm：字节 sha256 可回读，链路全绿。"""
    owner = _rest_user(on, "mf-owner")
    _org, case = _rest_case(owner, "mf")

    material = _material(owner, case["id"], "mf1")
    assert material["kind"] == "text" and material["status"] == "active"
    ref = material["content_ref"]
    assert ref["sha256"] == hashlib.sha256(
        "本发明的技术方案包括注意力模块与序列转导步骤。".encode()
    ).hexdigest()

    content = owner.get(f"/api/v1/materials/{material['id']}/content")
    assert content.status_code == 200
    assert hashlib.sha256(content.content).hexdigest() == ref["sha256"]

    anchor = owner.post(
        f"/api/v1/materials/{material['id']}/anchors",
        headers={"Idempotency-Key": "mf1-anchor"},
        json={"locator": {"page": 3, "paragraph": 2}, "excerpt": "编码器堆叠 N=6"},
    )
    assert anchor.status_code == 201, anchor.text
    assert anchor.json()["locator"] == {"page": 3, "paragraph": 2}
    assert anchor.json()["excerpt_ref"]["sha256"] == hashlib.sha256("编码器堆叠 N=6".encode()).hexdigest()
    anchor_id = anchor.json()["id"]

    # anchor 溯源推断 material；无锚点 fact 不能 confirm
    floating = _fact(owner, case["id"], "mf1-float")
    blocked = owner.post(
        f"/api/v1/facts/{floating['id']}/confirm", headers={"Idempotency-Key": "mf1-float-confirm"}
    )
    assert blocked.status_code == 409 and blocked.json()["detail"]["kind"] == "conflict"

    fact = _fact(owner, case["id"], "mf1-fact", anchor_id=anchor_id)
    assert fact["material_id"] == material["id"] and fact["status"] == "pending"
    confirmed = owner.post(
        f"/api/v1/facts/{fact['id']}/confirm", headers={"Idempotency-Key": "mf1-confirm"}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["decided_by_principal_id"] is not None

    # 已决事实不可二次裁决
    again = owner.post(
        f"/api/v1/facts/{fact['id']}/reject",
        headers={"Idempotency-Key": "mf1-late"},
        json={"reason": "too late"},
    )
    assert again.status_code == 409


def test_fact_reject_leaves_audit_trail(on, store_env):
    """驳回留痕：行不删、状态 rejected、理由落库；幂等键重放同一裁决。"""
    owner = _rest_user(on, "mf-reject")
    _org, case = _rest_case(owner, "mfr")
    material = _material(owner, case["id"], "mfr")
    anchor = owner.post(
        f"/api/v1/materials/{material['id']}/anchors",
        headers={"Idempotency-Key": "mfr-anchor"},
        json={"locator": {"offset": 120}},
    ).json()
    fact = _fact(owner, case["id"], "mfr-fact", anchor_id=anchor["id"])

    rejected = owner.post(
        f"/api/v1/facts/{fact['id']}/reject",
        headers={"Idempotency-Key": "mfr-reject"},
        json={"reason": "与交底书不符"},
    )
    assert rejected.status_code == 200
    body = rejected.json()
    assert body["status"] == "rejected" and body["rejection_reason"] == "与交底书不符"

    replay = owner.post(
        f"/api/v1/facts/{fact['id']}/reject",
        headers={"Idempotency-Key": "mfr-reject"},
        json={"reason": "与交底书不符"},
    )
    assert replay.status_code == 200 and replay.json()["id"] == fact["id"]

    facts = owner.get(f"/api/v1/cases/{case['id']}/facts").json()
    assert any(f["id"] == fact["id"] and f["status"] == "rejected" for f in facts)
    # 驳回后 confirm 也被拒
    late = owner.post(f"/api/v1/facts/{fact['id']}/confirm", headers={"Idempotency-Key": "mfr-late"})
    assert late.status_code == 409


def test_material_kinds_and_cross_case_fail_closed(on, store_env):
    """url 材料不存字节；锚点/fact 跨 case fail-closed；outsider 全面拒绝。"""
    owner = _rest_user(on, "mf-kinds")
    outsider = _rest_user(on, "mf-outsider")
    _org, case = _rest_case(owner, "mfk")
    _org2, other_case = _rest_case(owner, "mfk2")

    url_material = _material(
        owner, case["id"], "mfk-url", kind="url", source_url="https://example.com/paper.pdf"
    )
    assert url_material["source_url"] == "https://example.com/paper.pdf"
    assert url_material["content_ref"] is None
    assert owner.get(f"/api/v1/materials/{url_material['id']}/content").status_code == 404

    # kind 校验：url 缺 source_url → 422/409；upload 缺 content → 422
    bad_url = owner.post(
        f"/api/v1/cases/{case['id']}/materials",
        headers={"Idempotency-Key": "mfk-bad-url"},
        json={"kind": "url", "title": "无链接"},
    )
    assert bad_url.status_code in (409, 422)
    bad_upload = owner.post(
        f"/api/v1/cases/{case['id']}/materials",
        headers={"Idempotency-Key": "mfk-bad-upload"},
        json={"kind": "upload", "title": "无字节"},
    )
    assert bad_upload.status_code == 422

    # 跨 case 锚点溯源被拒
    material_a = _material(owner, case["id"], "mfk-a")
    anchor_a = owner.post(
        f"/api/v1/materials/{material_a['id']}/anchors",
        headers={"Idempotency-Key": "mfk-anchor-a"},
        json={"locator": {"page": 1}},
    ).json()
    cross = owner.post(
        f"/api/v1/cases/{other_case['id']}/facts",
        headers={"Idempotency-Key": "mfk-cross"},
        json={"statement": "跨案引用", "anchor_id": anchor_a["id"]},
    )
    assert cross.status_code == 409

    # outsider 读/写均拒
    assert outsider.get(f"/api/v1/cases/{case['id']}/materials").status_code in (403, 404)
    assert outsider.get(f"/api/v1/materials/{material_a['id']}/anchors").status_code in (403, 404)
    assert outsider.post(
        f"/api/v1/cases/{case['id']}/facts",
        headers={"Idempotency-Key": "mfk-out-fact"},
        json={"statement": "越权事实"},
    ).status_code in (403, 404)


def test_material_archive_and_status_filter(on, store_env):
    owner = _rest_user(on, "mf-arch")
    _org, case = _rest_case(owner, "mfa")
    material = _material(owner, case["id"], "mfa")
    archived = owner.post(
        f"/api/v1/materials/{material['id']}/archive", headers={"Idempotency-Key": "mfa-arch"}
    )
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    active = owner.get(f"/api/v1/cases/{case['id']}/materials?status=active").json()
    assert all(m["status"] == "active" for m in active)
    double = owner.post(
        f"/api/v1/materials/{material['id']}/archive", headers={"Idempotency-Key": "mfa-arch-2"}
    )
    assert double.status_code == 409


def test_material_migration_is_reversible(on, pg_schema):
    """迁移 0013 可逆：upgrade→表存在→downgrade→表消失→再 upgrade。"""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect

    from patent_studio.infra.db import database_url
    from patent_studio.infra.db.migrate import _MIGRATIONS_DIR, _cfg_url

    engine = create_engine(database_url(pg_schema))
    cfg = Config()
    cfg.set_main_option("script_location", _MIGRATIONS_DIR)
    cfg.set_main_option("sqlalchemy.url", _cfg_url(database_url(pg_schema)))
    try:
        with engine.connect() as conn:
            names = inspect(conn).get_table_names()
        assert {"materials", "source_anchors", "facts"} <= set(names)
        command.downgrade(cfg, "0012")
        with engine.connect() as conn:
            names = inspect(conn).get_table_names()
        assert "facts" not in names and "materials" not in names
        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            names = inspect(conn).get_table_names()
        assert {"materials", "source_anchors", "facts"} <= set(names)
    finally:
        engine.dispose()
