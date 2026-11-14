# -*- coding: utf-8 -*-
"""C0/P01+P03+P05：GET /api/projects/{pid}/context 双面契约 + 机构外发策略门 + chat scope 门。

- off/无 PG：binding=unavailable（不伪造 unbound），role=null + 本地全权。
- on + PG：case_key=pid 0→unbound、1→bound（真实 case_id/org/谓词能力）、N→ambiguous（fail-closed）。
- 机构 egress_policy.ai_egress=false → bound 案 /ai/chat 403（撤销即生效，policy version 入审计语义）。
- _scope_check / _chat_scope：跨 pid、未授权正文/材料、路径穿越、别案真名。
需要 PATENT_STUDIO_TEST_DATABASE_URL 的部分按 pg_schema 约定 skip。
"""

import asyncio
import os
import shutil
import uuid
from types import SimpleNamespace

import pytest
import test_auth
import test_legacy_auth as tl
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.agent import chat_engine

pytest_plugins = ("test_auth",)

SECRET = tl.SECRET


def _projects(tmp_path):
    d = tmp_path / "projects"
    d.mkdir()
    shutil.copytree(
        os.path.join(tl.ROOT, "examples", "method"),
        d / "method",
        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
    )
    return d


# ---------------- 文件面（无 PG）----------------


def test_context_off_mode_local(client):
    c, _ = client
    r = c.get("/api/projects/method/context")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["pid"] == "method" and j["binding"] == "unavailable"
    assert j["case_id"] is None and j["organization"] is None
    assert j["auth"] == "off" and j["file_role"] is None
    assert "content_write" in j["capabilities"]  # off=本地全权
    assert len(j["content_sha"]) == 64


# ---------------- 双面（PG）----------------


@pytest.fixture()
def onpg(tmp_path, monkeypatch, pg_schema):
    """PG schema + tmp PROJECTS_DIR：完整 create_app（v1 平台 + legacy 文件面挂载）。

    顺序要点：先在 AUTH off 下重载 legacy（on 时 legacy /api/auth/* 会遮蔽平台认证，
    这是 asgi.py 既定部署语义）；再开平台 AUTH——此时 /api/auth/* 走 PG 面，
    平台签发的 studio_session cookie 同时被绑定解析与文件面识别。"""
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    tl._reload_app()
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    from patent_studio.settings import get_settings

    get_settings.cache_clear()
    from patent_studio.asgi import create_app

    yield SimpleNamespace(app=create_app())
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    get_settings.cache_clear()
    tl._reload_app()


def _su(on):
    """首个注册用户 = 超管：文件面 owner + PG 侧可建机构/案。"""
    email = f"su-{uuid.uuid4().hex[:8]}@example.com"
    test_auth._register(TestClient(on.app), email)
    return test_auth._login(on, email)


def _mk_org_case(c, key, tag):
    ro = c.post(
        "/api/v1/organizations",
        headers={"Idempotency-Key": f"{tag}-o"},
        json={"slug": f"{tag}-{uuid.uuid4().hex[:8]}", "name": f"机构{tag}"},
    )
    assert ro.status_code in (200, 201), ro.text
    org = ro.json()
    rc = c.post(
        f"/api/v1/organizations/{org['id']}/cases",
        headers={"Idempotency-Key": f"{tag}-c"},
        json={"case_key": key, "title": "案", "kind": "invention"},
    )
    assert rc.status_code in (200, 201), rc.text
    return org, rc.json()


def test_context_bound(onpg):
    c = _su(onpg)
    org, case = _mk_org_case(c, "method", "cb")
    r = c.get("/api/projects/method/context")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["binding"] == "bound"
    assert j["case_id"] == case["id"]
    assert j["organization"]["id"] == org["id"] and j["organization"]["status"] == "active"
    assert j["binding_capabilities"]["read"] is True
    assert j["file_role"] is None and len(j["content_sha"]) == 64  # legacy 面 off=本地全权（role=None）


def test_context_unbound_and_ambiguous(onpg):
    c = _su(onpg)
    j = c.get("/api/projects/method/context").json()
    assert j["binding"] == "unbound" and j["case_id"] is None
    _mk_org_case(c, "method", "am1")
    _mk_org_case(c, "method", "am2")
    j = c.get("/api/projects/method/context").json()
    assert j["binding"] == "ambiguous" and j["candidates"] == 2 and j["case_id"] is None


def test_org_policy_gate(onpg):
    c = _su(onpg)
    org, _ = _mk_org_case(c, "method", "pl")
    assert c.put("/api/projects/method/settings", json={"ai_enabled": True}).status_code == 200
    r = c.put(
        f"/api/v1/organizations/{org['id']}/policy",
        headers={"Idempotency-Key": "pol-1"},
        json={"ai_egress": False, "training_consent": False},
    )
    assert r.status_code == 200, r.text
    pol = r.json()
    assert pol["ai_egress"] is False and pol["version"] == 1 and pol["updated_by"]
    # 撤销即生效：bound 案 AI 路由 403 ai_disabled_by_org（机构策略覆盖放行）
    r2 = c.post(
        "/api/projects/method/ai/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "agent": False},
    )
    assert r2.status_code == 403, r2.text
    assert r2.json()["detail"]["kind"] == "ai_disabled_by_org"
    # 机构外成员无写权限（org_access manage）
    other_email = f"outsider-{uuid.uuid4().hex[:8]}@example.com"
    test_auth._register(TestClient(onpg.app), other_email)
    outsider = test_auth._login(onpg, other_email)
    r3 = outsider.put(
        f"/api/v1/organizations/{org['id']}/policy",
        headers={"Idempotency-Key": "pol-x"},
        json={"ai_egress": True},
    )
    assert r3.status_code == 403


def test_context_revoked_inactive_token_scope(onpg, pg_schema):
    """R1 真实授权边界（双挂载 + AUTH=on + PG 会话内变更）：
    移除成员 → denied（不伪装 unbound）且 AI 403；非 active org → read=false + AI 403；
    org-scoped agent token 跨机构 → denied。"""
    from sqlalchemy import create_engine, update
    from sqlalchemy.orm import Session

    from patent_studio.domain import agents as agent_domain
    from patent_studio.domain.identity import Principal
    from patent_studio.domain.organization import Organization, OrganizationMembership
    from patent_studio.infra.db import database_url

    c = _su(onpg)
    org, case = _mk_org_case(c, "method", "rv")
    eng = create_engine(database_url(pg_schema))
    oid = uuid.UUID(org["id"])

    # 他用户：同 key 存在但不可见 → denied（不是 unbound，也不回详情）
    other_email = f"u-{uuid.uuid4().hex[:8]}@example.com"
    test_auth._register(TestClient(onpg.app), other_email)
    b = test_auth._login(onpg, other_email)
    j = b.get("/api/projects/method/context").json()
    assert j["binding"] == "denied" and j["case_id"] is None and j["organization"] is None

    # 授予 member → bound；撤销 → denied + AI 403
    me_b = b.get("/api/v1/principals/me").json()
    with Session(eng) as s:
        s.add(
            OrganizationMembership(
                organization_id=oid, principal_id=uuid.UUID(me_b["id"]), role="member", status="active"
            )
        )
        s.commit()
    j = b.get("/api/projects/method/context").json()
    assert j["binding"] == "bound" and j["binding_capabilities"]["read"] is True
    with Session(eng) as s:
        s.execute(
            update(OrganizationMembership)
            .where(OrganizationMembership.principal_id == uuid.UUID(me_b["id"]))
            .values(status="removed")
        )
        s.commit()
    assert b.get("/api/projects/method/context").json()["binding"] == "denied"
    r = b.post("/api/projects/method/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 403

    # org-scoped agent token 指向另一机构 → 本案 denied（token scope 不覆盖）
    org2, _ = _mk_org_case(c, "other-key", "rv2")
    su_me = c.get("/api/v1/principals/me").json()
    with Session(eng) as s:
        agent = Principal(kind="agent", agent_key=f"tok-{uuid.uuid4().hex[:8]}", display_name="t")
        s.add(agent)
        s.flush()
        s.add(
            OrganizationMembership(
                organization_id=uuid.UUID(org2["id"]), principal_id=agent.id, role="member", status="active"
            )
        )
        raw = agent_domain.issue_agent_token(
            s,
            issuer_principal_id=uuid.UUID(su_me["id"]),
            principal_id=agent.id,
            organization_id=uuid.UUID(org2["id"]),
        )
        s.commit()  # token 行须落库——authenticate 按 sha 查
    jr = c.get("/api/projects/method/context", headers={"Authorization": f"Bearer {raw}"}).json()
    assert jr["binding"] == "denied" and jr["case_id"] is None

    # 非 active org（suspended）：绑定仍在但不可读；AI 入口 fail-closed
    with Session(eng) as s:
        s.execute(update(Organization).where(Organization.id == oid).values(status="suspended"))
        s.commit()
    j = c.get("/api/projects/method/context").json()
    assert j["binding"] == "bound"
    assert j["organization"]["status"] == "suspended"
    assert j["binding_capabilities"]["read"] is False
    r2 = c.post("/api/projects/method/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r2.status_code == 403


# ---------------- 真实双面 AUTH=on（复核4）----------------


@pytest.fixture()
def onpg_auth(tmp_path, monkeypatch, pg_schema):
    """真实双面 AUTH=on：PATENT_STUDIO_AUTH 在 legacy 重载前置位——
    文件面 ACL（app.config.AUTH_ON=True，project_access 全局依赖真生效）与 PG 授权同时约束；
    asgi 挂载 legacy /api/auth/*（cookie 同名同 secret，两侧互认同一 JWT）。
    身份桥（复核4 合成种子）：legacy 注册进 sqlite 后，镜像同一 id/email 的 PG users 行。"""
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", SECRET)
    tl._reload_app()
    from app import config as legacy_config

    assert legacy_config.AUTH_ON is True, "夹具必须真实启用文件面鉴权"
    from patent_studio.settings import get_settings

    get_settings.cache_clear()
    from patent_studio.asgi import create_app

    yield SimpleNamespace(app=create_app(), db=pg_schema)
    monkeypatch.delenv("PATENT_STUDIO_AUTH")
    monkeypatch.delenv("PATENT_STUDIO_SECRET")
    get_settings.cache_clear()
    tl._reload_app()


def _bridge(on, email):
    """legacy 栈注册（sqlite users）→ 同 id 镜像 PG users 行（测试合成种子，非手工同步密码）
    → legacy cookie 登录——同一 JWT 被文件面 ACL 与 PG Subject/transaction 共同识别。"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from patent_studio.domain.identity import User
    from patent_studio.infra.db import database_url

    u = test_auth._register(TestClient(on.app), email)
    eng = create_engine(database_url(on.db))
    try:
        with Session(eng) as s:
            s.add(
                User(
                    id=uuid.UUID(u["id"]),
                    email=email,
                    hashed_password="!seeded-by-test",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                    display_name=email,
                )
            )
            s.commit()
    finally:
        eng.dispose()
    return test_auth._login(on, email)


def test_double_face_auth_on_real(onpg_auth):
    """复核4：真实双面 AUTH=on——文件 ACL 与 PG 谓词共同约束同一身份。
    - config.AUTH_ON True（不是 legacy-off 夹具冒充）
    - 首用户（legacy superuser）：file_role=owner + PG bound
    - 无文件 ACL 用户：/context 403（文件面先拒，轮不到 binding）
    - 授文件 viewer 后 200：file_role=viewer，PG 无成员 → binding=denied（两面各自生效）
    - PG 授 member → binding=bound，file_role 仍 viewer（文件写权不随 PG 放大）
    """
    su = _bridge(onpg_auth, f"df-su-{uuid.uuid4().hex[:6]}@example.com")
    org, case = _mk_org_case(su, "method", "df")
    j = su.get("/api/projects/method/context").json()
    assert j["auth"] == "on" and j["binding"] == "bound"
    assert j["file_role"] == "owner" and "content_write" in j["capabilities"]

    ve = f"df-v-{uuid.uuid4().hex[:6]}@example.com"
    v = _bridge(onpg_auth, ve)
    r = v.get("/api/projects/method/context")
    assert r.status_code == 403, r.text  # 文件面无 ACL 行 → 先拒

    r = su.put("/api/projects/method/members", json={"email": ve, "role": "viewer"})
    assert r.status_code == 200, r.text
    j = v.get("/api/projects/method/context").json()
    assert j["file_role"] == "viewer" and "content_write" not in j["capabilities"]
    assert j["binding"] == "denied"  # 文件可读但 PG 谓词拒 → 不冒充 bound

    # PG 授 member → binding 翻 bound；file_role 不因 PG 角色放大
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from patent_studio.domain.organization import OrganizationMembership
    from patent_studio.infra.db import database_url

    me_v = v.get("/api/v1/principals/me").json()
    eng = create_engine(database_url(onpg_auth.db))
    try:
        with Session(eng) as s:
            s.add(
                OrganizationMembership(
                    organization_id=uuid.UUID(org["id"]),
                    principal_id=uuid.UUID(me_v["id"]),
                    role="member",
                    status="active",
                )
            )
            s.commit()
    finally:
        eng.dispose()
    j = v.get("/api/projects/method/context").json()
    assert j["binding"] == "bound" and j["binding_capabilities"]["read"] is True
    assert j["file_role"] == "viewer" and "content_write" not in j["capabilities"]


# ---------------- scope 门（纯逻辑，无 PG）----------------


def test_scope_check_pid_pin():
    err = chat_engine._scope_check("read_book", {"pid": "other"}, {"source": {"full": True}}, "method")
    assert err and err["error"]["kind"] == "scope"
    ok = chat_engine._scope_check(
        "read_book", {"pid": "method", "book": "claims"}, {"source": {"full": True}}, "method"
    )
    assert ok is None
    # scope=None（服务端未补全）：仍钉 pid，且按最小授权拒正文读
    assert chat_engine._scope_check("read_book", {"pid": "other"}, None, "method") is not None
    assert chat_engine._scope_check("read_book", {"pid": "method", "book": "claims"}, None, "method") is not None


def test_scope_check_source_and_materials():
    s = {"source": None, "materials": {"现有技术.pdf"}}
    assert chat_engine._scope_check("read_book", {"pid": "m", "book": "claims"}, s, "m")["error"]["kind"] == "scope"
    denied = chat_engine._scope_check("read_attachment_text", {"pid": "m", "name": "别案材料.pdf"}, s, "m")
    assert denied["error"]["kind"] == "scope"
    assert chat_engine._scope_check("read_attachment_text", {"pid": "m", "name": "现有技术.pdf"}, s, "m") is None
    assert chat_engine._scope_check("list_projects", {}, s, "m")["error"]["kind"] == "scope"
    # 声明空集 = 一件材料都不可读（materials=None 亦然——未声明 ≠ 全权）
    s0 = {"source": {"full": True}, "materials": set()}
    assert chat_engine._scope_check("read_attachment_text", {"pid": "m", "name": "x.pdf"}, s0, "m") is not None


def test_scope_check_granularity():
    """R3：book 授权只放行该书；整卷工具/未列名工具默认拒；行范围授权不放行任何正文读工具。"""
    book_only = {"source": {"book": "claims"}, "materials": set()}
    assert chat_engine._scope_check("read_book", {"pid": "m", "book": "claims"}, book_only, "m") is None
    assert chat_engine._scope_check("read_book", {"pid": "m", "book": "description"}, book_only, "m") is not None
    assert chat_engine._scope_check("lint", {"pid": "m"}, book_only, "m") is not None  # 整卷工具需 full
    sel = {"source": {"book": "claims", "lines": [10, 20]}, "materials": set()}
    assert chat_engine._scope_check("read_book", {"pid": "m", "book": "claims"}, sel, "m") is not None
    # 默认拒绝允许表：整卷正文读工具不在表内一律拒；元数据/写面放行
    full = {"source": {"full": True}, "materials": set()}
    for t in ("get_terms", "context_pack", "oa_parse"):
        assert chat_engine._scope_check(t, {"pid": "m"}, book_only, "m") is not None, t
        assert chat_engine._scope_check(t, {"pid": "m"}, full, "m") is None, t
    # 非正文材料读（机构模板全文/原始图源/图数据）移出 full 授权面：过 scope 门但出口恒投影
    for t in ("get_template", "get_figure_source", "get_figures"):
        assert chat_engine._scope_check(t, {"pid": "m"}, book_only, "m") is None, t
    # 衍生记录（OA单轮/历史日志）允许执行但出口恒投影——不含未授权全文
    for t in ("get_oa_round", "get_history"):
        assert chat_engine._scope_check(t, {"pid": "m"}, book_only, "m") is None, t
    # 跨案机构审计默认拒（无 scope 授权面）
    assert chat_engine._scope_check("list_org_audit", {"pid": "m"}, full, "m") is not None
    for t in ("get_proposals", "list_comments", "get_novelty", "case_summary"):
        assert chat_engine._scope_check(t, {"pid": "m"}, book_only, "m") is None, t
    assert chat_engine._scope_check("patch_block", {"pid": "m"}, {"source": None}, "m") is None
    assert chat_engine._scope_check("propose_plan", {}, {"source": None}, "m") is None


def test_run_one_denies_before_exec():
    res, ev = asyncio.run(
        chat_engine._run_one("read_book", {"pid": "other"}, None, {"source": {"full": True}}, "method")
    )
    assert res["error"]["kind"] == "scope"
    assert ev[-1]["step"]["status"] == "error"


def test_require_org_ai_fail_closed(monkeypatch):
    """R1：平台生效时 ambiguous/unavailable/denied 一律 403；unbound/本地模式才放行。"""
    import types

    from app.domain import context as ctx_domain
    from app.domain import org as org_domain
    from app.errors import kind_error  # noqa: F401

    req = types.SimpleNamespace(path_params={"pid": "p1"}, headers={})
    monkeypatch.setattr(org_domain, "ai_enabled", lambda: True)

    async def call(binding, configured=True):
        monkeypatch.setattr(ctx_domain, "resolve_binding", lambda r, p: _fake_resolve(binding))
        monkeypatch.setattr(ctx_domain, "platform_configured", lambda: configured)
        await org_domain.require_org_ai(req)

    async def _fake_resolve(binding):
        return {"binding": binding}

    for b in ("ambiguous", "denied", "unavailable"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(call(b))
        assert "机构外发授权未决" in str(e.value.detail)
    asyncio.run(call("unbound"))  # 真本地案放行
    asyncio.run(call("unavailable", configured=False))  # 明确本地模式放行
    with pytest.raises(HTTPException):
        asyncio.run(call("bound"))  # bound 无 org/policy 字段 → org None → status != active → 拒

    # bound+active+默认策略 ⇒ 放行
    async def bound_ok(r, p):
        return {
            "binding": "bound",
            "organization": {"id": "o", "name": "n", "status": "active"},
            "egress_policy": {"ai_egress": True},
        }

    monkeypatch.setattr(ctx_domain, "resolve_binding", bound_ok)
    asyncio.run(org_domain.require_org_ai(req))

    # bound + ai_egress=False ⇒ 拒
    async def bound_off(r, p):
        return {
            "binding": "bound",
            "organization": {"id": "o", "name": "n", "status": "active"},
            "egress_policy": {"ai_egress": False, "version": 3},
        }

    monkeypatch.setattr(ctx_domain, "resolve_binding", bound_off)
    with pytest.raises(HTTPException):
        asyncio.run(org_domain.require_org_ai(req))


def test_chat_scope_derives_minimal(client):
    """R3：scope 缺省按 ctx 派生最小授权——ctx.book ⇒ 该书；无声明 ⇒ 无正文/材料授权。"""
    c, _ = client
    from app.main import store
    from app.routes.ai import _chat_scope

    p = store.get("method")
    s = _chat_scope(p, "method", None, {"book": "claims"})
    assert s["source"] == {"book": "claims"}
    assert s["materials"] == set()
    s2 = _chat_scope(p, "method", None, {"selection": {"line_start": 1, "line_end": 3}})
    assert s2["source"] is None  # 仅选区 ⇒ 无正文工具授权（选区文本仍在 ctx）
    s3 = _chat_scope(p, "method", {"source": True}, None)
    assert s3["source"] == {"full": True}
    s4 = _chat_scope(p, "method", {}, None)
    assert s4["source"] is None and s4["materials"] == set()


# ---------------- _chat_scope / _chat_context 校验 ----------------


def test_chat_scope_materials_validation(client):
    c, _ = client
    from app.main import store
    from app.routes.ai import _chat_scope

    p = store.get("method")
    assert _chat_scope(p, "method", {"source": False, "materials": []}) == {"source": None, "materials": set()}
    with pytest.raises(HTTPException) as e1:
        _chat_scope(p, "method", {"materials": ["../../etc/passwd"]})
    assert e1.value.status_code == 400
    with pytest.raises(HTTPException) as e2:
        _chat_scope(p, "method", {"materials": ["不存在的材料.pdf"]})
    assert e2.value.status_code == 422  # 别案/不存在真名都拿不到


def test_chat_context_selection_bounds_422(client):
    c, _ = client
    from app.main import store
    from app.routes.ai import _chat_context

    p = store.get("method")
    content = "第一行\n第二行\n第三行\n" * 10  # 自足：不依赖全局 store 当前绑定的 projects 目录
    with pytest.raises(HTTPException) as e:
        _chat_context(p, content, {"selection": {"line_start": 999999, "line_end": 999999}})
    assert e.value.status_code == 422
    ctx, _ = _chat_context(p, content, {"selection": {"line_start": 1, "line_end": 2}})
    assert "选区" in ctx
