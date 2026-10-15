# -*- coding: utf-8 -*-
"""B14：旧 app/mcp 74 工具 → agent capability 对齐矩阵 + 真语料端到端行为。"""

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from test_capability_registry import _add_agent, _add_case, _add_human, _add_org

from patent_studio.capabilities import (
    CapabilityAuthorizationError,
    CapabilityError,
    InvocationContext,
)
from patent_studio.capabilities.agent import AGENT_QUERY_REGISTRY
from patent_studio.capabilities.tools import (
    AGENT_TOOL_REGISTRY,
    NON_MIGRATED,
    TOOL_CAPABILITY_MAP,
)
from patent_studio.domain import work_items as wi
from patent_studio.domain.authorization import Grant
from patent_studio.domain.documents import Document
from patent_studio.domain.importer import execute_import, plan_directory
from patent_studio.domain.operations import Operation
from patent_studio.domain.organization import Case, CaseParticipant, OrganizationMembership
from patent_studio.domain.proposals import Proposal
from patent_studio.domain.releases import ReleaseArtifact
from patent_studio.domain.runs import decide_approval
from patent_studio.infra.db import database_url
from patent_studio.infra.storage.fs import FileObjectStore
from patent_studio.settings import get_settings

pytestmark = pytest.mark.skipif(
    not os.environ.get("PATENT_STUDIO_TEST_DATABASE_URL"),
    reason="未设置 PATENT_STUDIO_TEST_DATABASE_URL",
)

EXAMPLES = Path(__file__).resolve().parents[2] / "examples" / "method"

# 旧 TOOL_NAMES（git show c2f4653:backend/app/mcp/schemas.py），对齐矩阵的权威清单
TOOL_NAMES = (
    "list_projects",
    "read_book",
    "get_ast",
    "get_docs",
    "patch_block",
    "insert_block",
    "lint",
    "preflight",
    "build",
    "export_xml",
    "add_comment",
    "get_history",
    "list_figures",
    "set_figure_order",
    "set_figure_width",
    "list_figure_sources",
    "get_figure_source",
    "put_figure_source",
    "delete_figure_source",
    "get_case",
    "set_case_status",
    "list_attachments",
    "read_attachment_text",
    "get_claim_tree",
    "get_support_map",
    "get_figures",
    "get_terms",
    "context_pack",
    "get_settings",
    "case_summary",
    "get_deadlines",
    "get_timeline",
    "list_oa_rounds",
    "get_oa_round",
    "list_comments",
    "list_public_links",
    "get_proposals",
    "list_ai_jobs",
    "list_audit",
    "get_deliver_errors",
    "prior_art_search",
    "list_tags",
    "list_templates",
    "get_template",
    "oa_parse",
    "create_project",
    "import_docx_path",
    "update_case",
    "put_settings",
    "deadline_done",
    "update_deadline",
    "create_oa_round",
    "update_oa_round",
    "extend_oa_round",
    "delete_oa_round",
    "add_note",
    "reply_comment",
    "resolve_comment",
    "delete_comment",
    "create_public_link",
    "revoke_public_link",
    "apply_proposal",
    "dismiss_proposal",
    "apply_template",
    "create_tag",
    "run_scenario",
    "list_org_members",
    "update_org_member",
    "get_org_settings",
    "put_org_settings",
    "set_org_name",
    "list_org_audit",
    "get_novelty",
    "record_novelty",
)


@pytest.fixture()
def db(pg_schema):
    engine = create_engine(database_url(pg_schema))
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def store_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PATENT_STUDIO_STORAGE_URL", f"file://{tmp_path / 'objects'}")
    get_settings.cache_clear()
    yield tmp_path / "objects"
    get_settings.cache_clear()


def _ctx(principal, organization, case=None):
    return InvocationContext(
        principal_id=principal.id,
        organization_id=organization.id,
        case_id=case.id if case else None,
        at=datetime.now(UTC),
    )


def _grant_all(session, organization, owner, subject, capabilities, case=None):
    session.add(
        Grant(
            organization_id=organization.id,
            case_id=case.id if case else None,
            grantor_principal_id=owner.id,
            subject_principal_id=subject.id,
            capabilities=list(capabilities),
            not_before=datetime.now(UTC) - timedelta(minutes=1),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )


def _world(session, objects_dir):
    """机构 + owner + agent + 导入 examples/method 真语料案件；agent 全能力 grant。"""
    owner = _add_human(session)
    organization = _add_org(session, owner)
    agent = _add_agent(session)
    session.add(
        OrganizationMembership(organization_id=organization.id, principal_id=agent.id, role="member", status="active")
    )
    session.flush()
    store = FileObjectStore(objects_dir)
    plan = plan_directory(EXAMPLES)
    result = asyncio.run(
        execute_import(
            session,
            store,
            plan,
            organization_id=organization.id,
            principal_id=owner.id,
            case_key="METHOD-1",
        )
    )
    case = session.get(Case, result.case_id)
    session.add(CaseParticipant(case_id=case.id, principal_id=agent.id, role="agent"))
    _grant_all(
        session,
        organization,
        owner,
        agent,
        [*AGENT_TOOL_REGISTRY.ids(), *AGENT_QUERY_REGISTRY.ids()],
        case=case,
    )
    _grant_all(session, organization, owner, agent, ["agent.case.create", "agent.org.members"])
    session.commit()
    return organization, case, owner, agent


def _invoke(session, capability_id, payload, context):
    registry = AGENT_TOOL_REGISTRY
    return registry.invoke(session, capability_id, payload, context=context)


# ---------------------------------------------------------------- 覆盖矩阵 ----


def test_tool_coverage_matrix_is_complete():
    assert len(TOOL_NAMES) == 74
    assert set(TOOL_NAMES) == set(TOOL_CAPABILITY_MAP)
    assert set(NON_MIGRATED) == {name for name, caps in TOOL_CAPABILITY_MAP.items() if not caps}
    registered = set(AGENT_TOOL_REGISTRY.ids()) | set(AGENT_QUERY_REGISTRY.ids())
    for name, caps in TOOL_CAPABILITY_MAP.items():
        for cap in caps:
            assert cap in registered, f"{name} → {cap} 未注册"
    assert len(NON_MIGRATED) == 32
    assert sum(1 for caps in TOOL_CAPABILITY_MAP.values() if caps) == 42
    # 每条注册能力都是 strict 契约：命令必须 CommandInput → CommandReceipt
    from patent_studio.capabilities import CommandInput, CommandReceipt
    from patent_studio.capabilities.registry import CapabilityKind

    commands = [
        spec.id
        for spec in (AGENT_TOOL_REGISTRY.get(i) for i in AGENT_TOOL_REGISTRY.ids())
        if spec.kind is CapabilityKind.COMMAND
    ]
    assert len(commands) == 13
    for cap_id in commands:
        spec = AGENT_TOOL_REGISTRY.get(cap_id)
        assert issubclass(spec.input_model, CommandInput)
        assert spec.output_model is CommandReceipt


def test_fail_closed_without_grant_and_unknown_capability(db, store_env):
    from patent_studio.capabilities import UnknownCapabilityError

    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        stranger = _add_agent(session)
        session.commit()
        with pytest.raises(CapabilityAuthorizationError):
            AGENT_TOOL_REGISTRY.invoke(session, "agent.case.get", {}, context=_ctx(stranger, organization, case))
        with pytest.raises(UnknownCapabilityError):
            AGENT_TOOL_REGISTRY.invoke(session, "agent.case.unknown", {}, context=_ctx(agent, organization, case))


# ---------------------------------------------------------------- 查询面 ----


def test_read_capabilities_on_real_corpus(db, store_env):
    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        ctx = _ctx(agent, organization, case)
        docs = {doc.book: doc for doc in session.scalars(select(Document).where(Document.case_id == case.id))}
        assert set(docs) == {"abstract", "claims", "description"}

        detail = _invoke(session, "agent.case.get", {}, ctx)
        assert detail.title and detail.document_count == 3 and detail.figure_count == 4

        listed = _invoke(session, "agent.case.documents", {}, ctx)
        assert len(listed.documents) == 3

        content = _invoke(session, "agent.document.content", {"document_id": str(docs["claims"].id)}, ctx)
        assert "指纹" in content.text and content.revision_id is not None
        marked = _invoke(
            session,
            "agent.document.content",
            {"document_id": str(docs["claims"].id), "mode": "markup"},
            ctx,
        )
        assert marked.text == content.text  # 导入语料无 CriticMarkup，三种 mode 一致

        ast = json.loads(_invoke(session, "agent.document.ast", {"document_id": str(docs["claims"].id)}, ctx).ast_json)
        assert len(ast["claims"]) == 10

        revisions = _invoke(session, "agent.document.revisions", {"document_id": str(docs["claims"].id)}, ctx)
        assert len(revisions.revisions) == 1 and revisions.revisions[0].source == "migration"

        report = json.loads(_invoke(session, "agent.case.preflight", {}, ctx).report_json)
        assert "claim_tree" in report and len(report["claim_tree"]) == 10
        assert report["counts"]["error"] == 0

        lint = json.loads(_invoke(session, "agent.case.lint", {}, ctx).report_json)
        assert "items" in lint and "counts" in lint

        bundle = _invoke(session, "agent.case.semantic", {}, ctx)
        tree = json.loads(bundle.claim_tree_json)
        assert {n["kind"] for n in tree} == {"independent"}
        assert json.loads(bundle.support_map_json)
        assert json.loads(bundle.terms_json)

        pack = json.loads(_invoke(session, "agent.case.context", {"claim_id": "5"}, ctx).pack_json)
        assert pack["claim"]["num"] == 5 and pack["chain"]

        figures = _invoke(session, "agent.case.figures", {}, ctx)
        assert len(figures.figures) == 4 and figures.figures[0].figure_no == 1

        assert _invoke(session, "agent.case.deadlines", {}, ctx).work_items == []
        assert _invoke(session, "agent.case.proposals", {}, ctx).proposals == []
        _invoke(session, "agent.case.runs", {}, ctx)
        _invoke(session, "agent.case.operations", {}, ctx)

        members = _invoke(session, "agent.org.members", {}, _ctx(agent, organization))
        assert {m.role for m in members.members} >= {"owner", "member"}


# ---------------------------------------------------------------- 命令面 ----


def test_work_item_commands_roundtrip_and_idempotent_replay(db, store_env):
    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        ctx = _ctx(agent, organization, case)
        oa_due = datetime.now(UTC) + timedelta(days=60)
        receipt = _invoke(
            session,
            "agent.workitem.create",
            {
                "operation_id": "wi-1",
                "type": "oa-response",
                "title": "一通答复",
                "official_no": "2024-CN-001",
                "oa_deadline": oa_due.isoformat(),
            },
            ctx,
        )
        result = json.loads(receipt.result_json)
        item_id = uuid.UUID(result["work_item_id"])
        replay = _invoke(
            session,
            "agent.workitem.create",
            {
                "operation_id": "wi-1",
                "type": "oa-response",
                "title": "一通答复",
                "official_no": "2024-CN-001",
                "oa_deadline": oa_due.isoformat(),
            },
            ctx,
        )
        assert replay == receipt
        assert session.scalar(select(Operation).where(Operation.operation_id == "wi-1")).status == "succeeded"

        _invoke(
            session,
            "agent.workitem.update",
            {"operation_id": "wi-2", "work_item_id": str(item_id), "priority": 2},
            ctx,
        )
        item = session.get(wi.WorkItem, item_id)
        assert item.priority == 2
        oa_before = item.oa_deadline

        _invoke(
            session,
            "agent.workitem.reschedule",
            {"operation_id": "wi-3", "work_item_id": str(item_id), "extend_months": 1},
            ctx,
        )
        extended = session.get(wi.WorkItem, item_id)
        assert (extended.oa_deadline - oa_before).days >= 28

        _invoke(
            session,
            "agent.workitem.transition",
            {"operation_id": "wi-4", "work_item_id": str(item_id), "status": "in_progress"},
            ctx,
        )
        _invoke(
            session,
            "agent.workitem.transition",
            {"operation_id": "wi-5", "work_item_id": str(item_id), "status": "done"},
            ctx,
        )
        assert session.get(wi.WorkItem, item_id).status == "done"
        deadlines = _invoke(session, "agent.case.deadlines", {}, ctx)
        assert deadlines.work_items[0].official_no == "2024-CN-001"


def test_document_propose_submit_withdraw_and_release_build(db, store_env):
    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        ctx = _ctx(agent, organization, case)
        claims_doc = session.scalar(select(Document).where(Document.case_id == case.id, Document.book == "claims"))
        ast = json.loads(_invoke(session, "agent.document.ast", {"document_id": str(claims_doc.id)}, ctx).ast_json)
        block_id = ast["claims"][0]["id"]

        receipt = _invoke(
            session,
            "agent.document.propose",
            {
                "operation_id": "prop-1",
                "document_id": str(claims_doc.id),
                "action": "patch",
                "block_id": block_id,
                "markdown": "1.一种改进的私钥生成方法，其特征在于，包括采集指纹并生成密钥。",
            },
            ctx,
        )
        result = json.loads(receipt.result_json)
        proposal = session.get(Proposal, uuid.UUID(result["proposal_id"]))
        assert proposal.status == "draft" and proposal.target_kind == "document"
        # agent 不产生正式修订：正文仍是指向提案的 result ref
        assert claims_doc.current_revision_id == proposal.document_revision_id

        submitted = _invoke(
            session,
            "agent.proposal.submit",
            {"operation_id": "prop-2", "proposal_id": result["proposal_id"]},
            ctx,
        )
        assert json.loads(submitted.result_json)["status"] == "submitted"
        withdrawn = _invoke(
            session,
            "agent.proposal.withdraw",
            {"operation_id": "prop-3", "proposal_id": result["proposal_id"], "reason": "撤回"},
            ctx,
        )
        assert json.loads(withdrawn.result_json)["status"] == "rejected"

        build = _invoke(session, "agent.release.build", {"operation_id": "rel-1"}, ctx)
        built = json.loads(build.result_json)
        assert built["packed_items"] == 7 and built["size"] > 10000
        artifact = session.get(ReleaseArtifact, uuid.UUID(built["artifact_id"]))
        assert artifact is not None and artifact.content_type.endswith("wordprocessingml.document")
        replay = _invoke(session, "agent.release.build", {"operation_id": "rel-1"}, ctx)
        assert replay == build


def test_figure_reorder_and_note_and_case_status_gate(db, store_env):
    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        ctx = _ctx(agent, organization, case)
        figs = _invoke(session, "agent.case.figures", {}, ctx).figures
        numbered = [f for f in figs if f.figure_no is not None]
        assert len(numbered) == 3 and len(figs) == 4  # 4 附图含 1 张无图号摘要图
        order = [str(f.figure_id) for f in reversed(numbered)]

        receipt = _invoke(session, "agent.figure.reorder", {"operation_id": "fig-1", "figure_ids": order}, ctx)
        assert json.loads(receipt.result_json)["count"] == 3
        after = {f.figure_id: f.figure_no for f in _invoke(session, "agent.case.figures", {}, ctx).figures}
        assert after[uuid.UUID(order[0])] == 1
        with pytest.raises(CapabilityError):
            _invoke(
                session,
                "agent.figure.reorder",
                {"operation_id": "fig-2", "figure_ids": order[:-1]},
                ctx,
            )

        note = _invoke(
            session,
            "agent.note.add",
            {"operation_id": "note-1", "statement": "客户确认指纹模组供应商为汇顶"},
            ctx,
        )
        assert json.loads(note.result_json)["status"] == "pending"

        gate = _invoke(
            session,
            "agent.case.status",
            {"operation_id": "st-1", "status": "review", "note": "送审"},
            ctx,
        )
        assert gate.status == "pending_approval" and session.get(Case, case.id).status == "intake"
        decide_approval(session, gate.approval_id, principal_id=owner.id, decision="approved")
        done = _invoke(
            session,
            "agent.case.status",
            {"operation_id": "st-1", "status": "review", "note": "送审"},
            ctx,
        )
        assert done.status == "succeeded" and session.get(Case, case.id).status == "review"


def test_case_create_update_and_material_content(db, store_env):
    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        org_ctx = _ctx(agent, organization)
        created = json.loads(
            _invoke(
                session,
                "agent.case.create",
                {"operation_id": "cc-1", "title": "新案-测试", "case_no": "2026-001"},
                org_ctx,
            ).result_json
        )
        new_case = session.get(Case, uuid.UUID(created["case_id"]))
        assert new_case.title == "新案-测试" and new_case.organization_id == organization.id

        new_ctx = _ctx(agent, organization, new_case)
        session.add(
            Grant(
                organization_id=organization.id,
                case_id=new_case.id,
                grantor_principal_id=owner.id,
                subject_principal_id=agent.id,
                capabilities=["agent.case.update"],
                not_before=datetime.now(UTC) - timedelta(minutes=1),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        session.flush()
        _invoke(
            session,
            "agent.case.update",
            {"operation_id": "cc-2", "title": "新案-改名"},
            new_ctx,
        )
        assert session.get(Case, new_case.id).title == "新案-改名"

        from patent_studio.domain import materials as mat

        text = "答复要点：权1 创造性争辩".encode()
        store = FileObjectStore(store_env)
        ref = asyncio.run(store.put(text, "text/plain"))
        material = mat.register_material(
            session, case.id, principal_id=owner.id, kind="text", title="OA 要点", content_ref=ref
        )
        session.flush()
        session.add(
            Grant(
                organization_id=organization.id,
                case_id=case.id,
                grantor_principal_id=owner.id,
                subject_principal_id=agent.id,
                capabilities=["agent.case.materials", "agent.material.content"],
                not_before=datetime.now(UTC) - timedelta(minutes=1),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        session.flush()
        ctx = _ctx(agent, organization, case)
        listed = _invoke(session, "agent.case.materials", {}, ctx)
        assert listed.materials[0].title == "OA 要点"
        content = _invoke(
            session,
            "agent.material.content",
            {"material_id": str(material.id), "max_chars": 10},
            ctx,
        )
        assert content.truncated and len(content.text) == 10


def test_mcp_bearer_bridges_legacy_names_and_commands(db, store_env):
    """MCPQueryService：旧工具名→能力；token 只认证，授权/幂等仍由 registry 强制。"""
    from patent_studio.domain.agents import issue_agent_token, provision_agent
    from patent_studio.domain.organization import OrganizationMembership
    from patent_studio.mcp.agent_server import MCPQueryService, MCPUnauthorized

    with Session(db) as session:
        organization, case, owner, agent = _world(session, store_env)
        other_case_owner = _add_human(session)
        other_org = _add_org(session, other_case_owner)
        other_case = _add_case(session, other_org, other_case_owner)
        token = issue_agent_token(
            session,
            principal_id=agent.id,
            issuer_principal_id=owner.id,
            organization_id=organization.id,
        )
        session.commit()
        service = MCPQueryService(session)

        # 查询别名：get_case → agent.case.get（org token 需 case_id）
        detail = service.call(token, "get_case", {"case_id": str(case.id)})
        assert detail["document_count"] == 3
        # 能力 id 直调
        figs = service.call(token, "agent.case.figures", {"case_id": str(case.id)})
        assert len(figs["figures"]) == 4
        # 命令别名：create_oa_round → agent.workitem.create（幂等键必填）
        receipt = service.call(
            token,
            "create_oa_round",
            {
                "case_id": str(case.id),
                "operation_id": "mcp-oa-1",
                "type": "oa-response",
                "title": "二通答复",
            },
        )
        assert receipt["status"] == "succeeded"
        replay = service.call(
            token,
            "create_oa_round",
            {
                "case_id": str(case.id),
                "operation_id": "mcp-oa-1",
                "type": "oa-response",
                "title": "二通答复",
            },
        )
        assert replay == receipt

        # fail-closed：未知工具 / 未标不迁工具 / 他机构案件 / 无 grant
        with pytest.raises(MCPUnauthorized):
            service.call(token, "proposal.create", {})
        with pytest.raises(MCPUnauthorized):
            service.call(token, "export_xml", {"case_id": str(case.id)})
        with pytest.raises(MCPUnauthorized):
            service.call(token, "get_case", {"case_id": str(other_case.id)})
        stranger = provision_agent(session, agent_key="mcp-stranger", display_name="S")
        session.add(OrganizationMembership(organization_id=organization.id, principal_id=stranger.id, role="member"))
        session.flush()
        stranger_token = issue_agent_token(
            session,
            principal_id=stranger.id,
            issuer_principal_id=owner.id,
            organization_id=organization.id,
        )
        session.commit()
        with pytest.raises(MCPUnauthorized):
            service.call(stranger_token, "get_case", {"case_id": str(case.id)})
        # 无幂等键的命令 → 输入校验失败（注册契约 fail-closed）
        from patent_studio.capabilities import CapabilityInputError

        with pytest.raises(CapabilityInputError):
            service.call(token, "deadline_done", {"case_id": str(case.id)})
