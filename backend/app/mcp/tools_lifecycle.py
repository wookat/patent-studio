# -*- coding: utf-8 -*-
"""生命周期工具集（case-engineer 批1）：案卷从创建到产出的全链能力对 MCP 暴露。

与 tools.py 同一套约束：open_project_for 校验存在 + ACL（读 viewer / 写 editor），
run_audited 落 audit.jsonl；org 级工具（无 pid）审计写 <projects>/.studio/audit.jsonl。

async fn 在 run_audited 的 to_thread 里执行——线程内无运行中 loop，可 asyncio.run。
写面均 editor+ 直写（与 patch_block direct 同模型），全部审计。
"""

from __future__ import annotations

import asyncio
import functools
import glob
import json
import os
import time
from typing import Any

from mcp.server.mcpserver.exceptions import ToolError

from app import atomic, config
from app.agent import loop as agent_loop
from app.agent import prior_art
from app.agent import proposals as agent_proposals
from app.agent import registry as agent_registry
from app.agent.types import SCENARIO_BY_ID
from app.ai import client as ai_client
from app.ai import require_enabled
from app.ai.jobs import JOBS_DIR, JobStore
from app.domain import cases, comments, events, history, org, public_share, templates, timeline
from app.domain.cases import CasePatch
from app.domain.importer import import_project
from app.mcp import audit
from app.mcp.tools import _allow, _settings, actor, open_project_for, run_audited
from app.oa import parse as oa_parse_mod
from app.oa import rounds as oa_rounds_mod

# org 级（无案卷）审计落点——与 org.json/tags.json 同目录语义
ORG_DIR = os.path.join(config.PROJECTS_DIR, ".studio")


def _err(kind, message, detail=None) -> ToolError:
    from app.mcp.tools import _err as _t_err

    return _t_err(kind, message, detail=detail)


async def _run_org(store, tool, args, fn, result_of=lambda _r: "ok"):
    """run_audited 的 org 版：审计目录固定为 PROJECTS_DIR/.studio。"""
    try:
        result = await __import__("anyio").to_thread.run_sync(fn)
    except Exception as e:
        from app.mcp.tools import _BUSINESS, _detail_of

        if isinstance(e, _BUSINESS):
            detail = _detail_of(e)
        elif isinstance(e, ToolError):
            audit.record(ORG_DIR, actor().name, tool, args, "error:" + json.loads(str(e))["kind"])
            raise
        else:
            raise
        audit.record(ORG_DIR, actor().name, tool, args, f"error:{detail.kind}")
        raise ToolError(json.dumps(detail.model_dump(), ensure_ascii=False)) from e
    audit.record(ORG_DIR, actor().name, tool, args, result_of(result))
    return result


def _author_of(who):
    return comments.LOCAL_AUTHOR if who.user_id is None else comments.Author(id=who.user_id, name=who.name)


def register(server, store):
    run = functools.partial(run_audited, store)
    open_project = functools.partial(open_project_for, store)

    async def _require_egress(pid: str) -> None:
        """P03 统一外发门禁（MCP 面）：案级 ai_enabled（require_enabled）+ 部署全局 org.ai_enabled
        + PG 机构 egress_policy（fail-closed）。Actor.user_id（PAT 身份）→ PG Principal 走与
        require_org_ai 同一绑定解析；无法关联主体或绑定非 bound 在平台生效时拒——不拿
        「无 cookie」当放行理由。仅未配置 PG 且 AUTH=off 的本地模式落回全局闸门。"""
        from fastapi import HTTPException

        from app.domain import context as ctx_domain

        try:
            require_enabled(store, pid, "agent")
        except HTTPException as e:
            d = e.detail if isinstance(e.detail, dict) else {}
            raise _err(d.get("kind", "ai_disabled"), d.get("message", "本案未允许外发"), detail=d.get("detail"))
        if not org.ai_enabled():
            raise _err("ai_disabled_by_org", "机构已关闭 AI 助手，请联系机构管理员", detail="org")
        if not ctx_domain.platform_configured():
            return  # 明确本地模式：无 PG 机构面可执行
        b = await asyncio.to_thread(ctx_domain.resolve_binding_for_user, pid, actor().user_id)
        binding = b.get("binding")
        if binding == "unbound":
            return  # PG 全局无同 key 案：纯文件案卷，机构策略不适用
        if binding != "bound":
            raise _err(
                "ai_disabled_by_org",
                f"机构外发授权未决（{binding}），按 fail-closed 拒绝——请确认案卷绑定与身份",
                detail=str(binding),
            )
        if (b.get("organization") or {}).get("status") != "active":
            raise _err("ai_disabled_by_org", "本机构不可用（非 active），AI 外发已停用", detail="org_status")
        pol = b.get("egress_policy") or {}
        if pol.get("ai_egress") is False:
            raise _err(
                "ai_disabled_by_org",
                f"本机构已关闭 AI 外发（策略 v{pol.get('version') or '?'}）",
                detail="org_policy",
            )

    async def _editor(pid, tool, args):
        try:
            await _allow(actor(), pid, "editor")
        except ToolError:
            audit.record(store.get(pid).dir, actor().name, tool, args, "error:forbidden")
            raise
        return store.get(pid)

    def _actor_dict():
        return events.actor_of(actor()) if actor().user_id else None

    # ---------------------------------------------------------------- 读 ----

    @server.tool()
    async def get_settings(pid: str) -> dict[str, Any]:
        """案卷设置（归一化后形态：排版/附图/AI 开关等）。"""
        p = await open_project(pid)
        return await run(pid, "get_settings", {}, lambda: _settings(store, p))

    @server.tool()
    async def case_summary(pid: str) -> dict[str, Any]:
        """案件台账摘要：状态/申请人/申请号/期限聚合（仪表盘口径）。"""
        p = await open_project(pid)
        return await run(pid, "case_summary", {}, lambda: cases.summary(cases.load_case(p.dir)))

    @server.tool()
    async def get_deadlines(pid: str) -> dict[str, Any]:
        """期限台账全量（done/override_reason/done_at）+ 下一期限 + 摘要。"""
        p = await open_project(pid)

        def body():
            case = cases.load_case(p.dir)
            return {
                "deadlines": [d.model_dump(mode="json") for d in case.deadlines],
                "next": cases.next_deadline(case),
                "summary": cases.summary(case),
            }

        return await run(pid, "get_deadlines", {}, body)

    @server.tool()
    async def get_timeline(pid: str, limit: int = 50) -> list[dict[str, Any]]:
        """案卷时间线合并流（期限/批注/版本/笔记，新→旧）。"""
        p = await open_project(pid)
        return await run(pid, "get_timeline", {"limit": limit}, lambda: timeline.merged(p.dir)[:limit])

    @server.tool()
    async def list_oa_rounds(pid: str) -> list[dict[str, Any]]:
        """OA 轮次列表（同 GET /oa/rounds）。"""
        p = await open_project(pid)
        return await run(
            pid, "list_oa_rounds", {}, lambda: [oa_rounds_mod.to_api(r) for r in oa_rounds_mod.list_rounds(p.dir)]
        )

    @server.tool()
    async def get_oa_round(pid: str, rid: str) -> dict[str, Any]:
        """单轮 OA 完整记录（items 全文、reply_refs、filed_on）。"""
        p = await open_project(pid)

        def body():
            try:
                return oa_rounds_mod.to_api(oa_rounds_mod.load_round(p.dir, rid))
            except oa_rounds_mod.RoundError as e:
                raise _err("not_found", str(e))

        return await run(pid, "get_oa_round", {"rid": rid}, body)

    @server.tool()
    async def list_comments(pid: str, status: str | None = None) -> list[dict[str, Any]]:
        """批注台账（status: open/resolved 过滤）；锚点含 block_id/line 供 reply/resolve。"""
        p = await open_project(pid)
        return await run(
            pid,
            "list_comments",
            {"status": status},
            lambda: [c.to_dict() for c in comments.select(comments.load(p.dir), status=status)],
        )

    @server.tool()
    async def list_public_links(pid: str) -> list[dict[str, Any]]:
        """免登录分享链接列表。"""
        await open_project(pid)
        return await run(pid, "list_public_links", {}, lambda: asyncio.run(public_share.list_links(pid)))

    @server.tool()
    async def get_proposals(pid: str, state: str | None = None) -> list[dict[str, Any]]:
        """AI 提案台账（state: pending/applied/dismissed 过滤）。"""
        p = await open_project(pid)
        return await run(
            pid,
            "get_proposals",
            {"state": state},
            lambda: [pr.model_dump(mode="json") for pr in agent_proposals.load(p.dir, pid, state)],
        )

    @server.tool()
    async def list_ai_jobs(pid: str) -> list[dict[str, Any]]:
        """AI/智能体任务台账（读磁盘 .studio/ai-jobs/，跨进程可见）。"""
        p = await open_project(pid)

        def body():
            out = []
            for f in sorted(glob.glob(os.path.join(p.dir, JOBS_DIR, "job_*.json")), key=os.path.getmtime, reverse=True):
                try:
                    with open(f, encoding="utf-8") as fh:
                        out.append(json.load(fh))
                except (OSError, ValueError):
                    continue
            return out

        return await run(pid, "list_ai_jobs", {}, body)

    @server.tool()
    async def list_audit(pid: str, limit: int = 50) -> list[dict[str, Any]]:
        """本案审计日志（.studio/audit.jsonl 尾部，最新在前）——逐件工具调用 + chat_run 对话任务记录。"""
        p = await open_project(pid)
        return await run(pid, "list_audit", {"limit": limit}, lambda: audit.tail(p.dir, min(max(limit, 1), 200)))

    @server.tool()
    async def get_deliver_errors(pid: str) -> list[dict[str, Any]]:
        """交付校验错误（必填项/格式/附图齐备性）。"""
        await open_project(pid)

        def body():
            from app.routes import deliver

            return [e.model_dump(mode="json") for e in deliver.request_errors(store, pid)]

        return await run(pid, "get_deliver_errors", {}, body)

    @server.tool()
    async def prior_art_search(pid: str, queries: list[str], limit: int = 5) -> dict[str, Any]:
        """先行技术检索（s8 同款 provider 链：PatSnap/EPO OPS/OpenAlex）。
        返回每条检索式的命中表（公开号/标题/日期/链接）与 source 标记。
        检索完成后应把检索式与命中经 record_novelty 归档进查新记录卡（相关度默认 A，X/Y 判定留给人）。"""
        # P03：外发检索属真实上游调用——案级 ai_enabled + 机构闸门双校验（此前裸跑是真漏洞）
        await _require_egress(pid)
        await open_project(pid)

        def body():
            report = prior_art.search_all(queries, limit=limit)
            return report.model_dump(mode="json") if hasattr(report, "model_dump") else report

        return await run(pid, "prior_art_search", {"queries": queries, "limit": limit}, body)

    @server.tool()
    async def list_tags() -> list[dict[str, Any]]:
        """机构标签库（同 GET /api/tags）。"""
        return await _run_org(store, "list_tags", {}, lambda: [t.model_dump(mode="json") for t in cases.load_tags()])

    @server.tool()
    async def list_templates() -> list[dict[str, Any]]:
        """机构模板库列表。"""
        return await _run_org(
            store, "list_templates", {}, lambda: [t.model_dump(mode="json") for t in templates.list_templates()]
        )

    @server.tool()
    async def get_template(name: str) -> dict[str, Any]:
        """单份模板全文。"""

        def body():
            for t in templates.list_templates():
                if t.name == name:
                    return t.model_dump(mode="json")
            raise _err("not_found", f"模板不存在：{name}")

        return await _run_org(store, "get_template", {"name": name}, body)

    @server.tool()
    async def oa_parse(text: str) -> dict[str, Any]:
        """OA 通知正文 → 要点拆条（不落台账；配合 create_oa_round 登记）。"""
        return await _run_org(
            store,
            "oa_parse",
            {"text_len": len(text)},
            lambda: {"items": oa_parse_mod.parse(text)[0], "warnings": oa_parse_mod.parse(text)[1]},
        )

    # ---------------------------------------------------------------- 写 ----

    @server.tool()
    async def create_project(title: str, pid: str | None = None) -> dict[str, Any]:
        """新建空案卷（三书骨架）。AUTH=on 时调用者（PAT 用户）自动成为 owner。"""
        who = actor()

        def body():
            import secrets

            new_pid = pid or "p" + secrets.token_hex(6)
            store.create(new_pid, title)
            p = store.get(new_pid)
            cases.ensure_case(p.dir)
            if who.user_id:
                cases.claim_owner(p.dir, who.user_id)
            return {"pid": p.id, "title": p.title}

        r = await _run_org(store, "create_project", {"title": title, "pid": pid}, body)
        if config.AUTH_ON and who.user_id:
            try:
                from app import auth as _auth

                await _auth.grant_owner(r["pid"], who.user_id)
            except Exception:
                pass
        return r

    @server.tool()
    async def import_docx_path(
        path: str, pid: str | None = None, title: str | None = None, apply_styles: bool = True
    ) -> dict[str, Any]:
        """从服务端可读路径导入 docx 建案（upload 二进制不适合 MCP 通道）。"""
        who = actor()
        if not os.path.isfile(path) or not path.lower().endswith(".docx"):
            raise _err("bad_request", f"须为服务端可读的 .docx 路径：{path}")

        def body():
            with open(path, "rb") as f:
                data = f.read()
            pid2, report = import_project(store, data, os.path.basename(path), pid, title, apply_styles, None)
            p = store.get(pid2)
            if who.user_id:
                cases.claim_owner(p.dir, who.user_id)
            return {
                "project": {"id": p.id, "title": p.title},
                "report": report.model_dump() if hasattr(report, "model_dump") else report,
            }

        r = await _run_org(store, "import_docx_path", {"path": path, "pid": pid, "title": title}, body)
        if config.AUTH_ON and who.user_id:
            try:
                from app import auth as _auth

                await _auth.grant_owner(r["project"]["id"], who.user_id)
            except Exception:
                pass
        return r

    @server.tool()
    async def update_case(pid: str, fields: dict) -> dict[str, Any]:
        """案件台账字段补丁（CasePatch 子集：case_no/kind/client/applicants/inventors/tags/dates/
        priority/attorney/fee_status/deadlines 等；未携带键保留——同 PUT /case merge 语义；
        未知键 422；dates/priority 变更自动重算 auto 期限）。"""
        p = await _editor(pid, "update_case", {"fields": sorted(fields)})

        def body():
            with atomic.studio_lock(p.dir, "case"):
                case = cases.ensure_case(p.dir)
                patch = CasePatch(**fields)
                case2 = cases.apply_patch(case, patch)
                if cases.DEADLINE_INPUT_FIELDS.intersection(patch.model_fields_set):
                    from app import deadlines as deadlines_mod

                    case2, _ = deadlines_mod.recompute(case2)
                cases.save_case(p.dir, case2)
                history.commit_case(p.dir, "case: update " + ",".join(cases.patched_fields(patch)), actor().name)
                return case2.model_dump(mode="json")

        out = await run(pid, "update_case", {"fields": sorted(fields)}, body)
        return out

    @server.tool()
    async def put_settings(pid: str, settings: dict) -> dict[str, Any]:
        """案卷设置 merge 写（同 PUT /settings：未携带键保留，dict 深合并）。"""
        p = await _editor(pid, "put_settings", {"keys": sorted(settings)})

        def body():
            merged = {**(p.settings or {}), **settings}
            return store.save_settings(pid, merged)

        return await run(pid, "put_settings", {"keys": sorted(settings)}, body)

    @server.tool()
    async def deadline_done(pid: str, deadline_id: str, done: bool = True) -> dict[str, Any]:
        """期限完成/撤销完成（同 POST /deadlines/{id}/done）。"""
        p = await _editor(pid, "deadline_done", {"deadline_id": deadline_id, "done": done})

        def body():
            from app.routes.cases import case_or_404
            from app.routes.deadlines import _find, _save

            with atomic.studio_lock(p.dir, "case"):
                case = case_or_404(p.dir)
                d = _find(case, deadline_id).model_copy(update={"done": done, "done_at": time.time() if done else None})
                case = _save(
                    p.dir,
                    cases.replace_deadline(case, d),
                    f"case: deadline {'done' if done else 'undone'} {d.id}",
                    None,
                )
                return {"deadline_id": d.id, "done": done, "due": d.due}

        out = await run(pid, "deadline_done", {"deadline_id": deadline_id, "done": done}, body)
        events.emit(
            "deadline.done" if done else "deadline.undone", pid=pid, actor=_actor_dict(), data={"id": deadline_id}
        )
        return out

    @server.tool()
    async def update_deadline(
        pid: str, deadline_id: str, due: str | None = None, override_reason: str | None = None
    ) -> dict[str, Any]:
        """期限改期（due YYYY-MM-DD + 理由；改期事实+理由入审计与期限行透出）。"""
        p = await _editor(pid, "update_deadline", {"deadline_id": deadline_id, "due": due})

        def body():
            from app.routes.cases import case_or_404
            from app.routes.deadlines import _find, _save

            with atomic.studio_lock(p.dir, "case"):
                case = case_or_404(p.dir)
                d = _find(case, deadline_id)
                old = d.due
                d2 = d.model_copy(update={"due": due or d.due, "source": "manual", "override_reason": override_reason})
                _save(p.dir, cases.replace_deadline(case, d2), f"case: deadline override {d2.id} → {d2.due}", None)
                return {"deadline_id": d2.id, "from": old, "to": d2.due}

        out = await run(pid, "update_deadline", {"deadline_id": deadline_id, "due": due}, body)
        events.emit(
            "deadline.override",
            pid=pid,
            actor=_actor_dict(),
            data={"id": deadline_id, "from": out["from"], "to": out["to"], "reason": override_reason},
        )
        return out

    @server.tool()
    async def create_oa_round(pid: str, kind: str, issued_on: str, delivery: str = "electronic") -> dict[str, Any]:
        """登记 OA 轮次（自动登记答复期限；kind: first/second/third/... ）。"""
        p = await _editor(pid, "create_oa_round", {"kind": kind, "issued_on": issued_on})

        def body():
            with atomic.studio_lock(p.dir, "case"):
                rnd = oa_rounds_mod.create_round(p.dir, kind=kind, issued_on=issued_on, delivery=delivery)
                dl = oa_rounds_mod.register_deadline(p.dir, rnd)
                case = cases.load_case(p.dir)
                case.deadlines.append(dl)
                cases.save_case(p.dir, case)
                history.commit_case(p.dir, f"oa: round {rnd['id']} {kind}", actor().name)
                return oa_rounds_mod.to_api(rnd)

        out = await run(pid, "create_oa_round", {"kind": kind, "issued_on": issued_on}, body)
        events.emit("oa.round", pid=pid, actor=_actor_dict(), data={"id": out["id"]})
        return out

    @server.tool()
    async def update_oa_round(pid: str, rid: str, fields: dict) -> dict[str, Any]:
        """OA 轮次字段补丁（kind/issued_on/delivery/extension_months/filed_on/reply_refs）。"""
        p = await _editor(pid, "update_oa_round", {"rid": rid, "fields": sorted(fields)})

        def body():
            try:
                return oa_rounds_mod.to_api(oa_rounds_mod.update_round(p.dir, rid, **fields))
            except oa_rounds_mod.RoundError as e:
                raise _err("not_found", str(e))

        return await run(pid, "update_oa_round", {"rid": rid}, body)

    @server.tool()
    async def extend_oa_round(pid: str, rid: str, months: int) -> dict[str, Any]:
        """OA 答复期延期（1 或 2 个月；累计超 2 拒）。"""
        p = await _editor(pid, "extend_oa_round", {"rid": rid, "months": months})

        def body():
            try:
                return oa_rounds_mod.to_api(oa_rounds_mod.extend_round(p.dir, rid, months))
            except oa_rounds_mod.RoundError as e:
                raise _err("conflict", str(e))

        return await run(pid, "extend_oa_round", {"rid": rid, "months": months}, body)

    @server.tool()
    async def delete_oa_round(pid: str, rid: str) -> dict[str, Any]:
        """删除 OA 轮次（连带对应期限）。"""
        p = await _editor(pid, "delete_oa_round", {"rid": rid})

        def body():
            try:
                oa_rounds_mod.delete_round(p.dir, rid)
            except oa_rounds_mod.RoundError as e:
                raise _err("not_found", str(e))
            return {"ok": True}

        return await run(pid, "delete_oa_round", {"rid": rid}, body)

    @server.tool()
    async def add_note(pid: str, body: str) -> dict[str, Any]:
        """时间线工作笔记（同 POST /notes）。"""
        p = await _editor(pid, "add_note", {"body_len": len(body)})
        who = actor()
        return await run(
            pid,
            "add_note",
            {"body_len": len(body)},
            lambda: timeline.add_note(
                p.dir, body, _author_of(who) and {"id": who.user_id or "local", "name": who.name}
            ),
        )

    @server.tool()
    async def reply_comment(pid: str, cid: str, body: str) -> dict[str, Any]:
        """答复批注线程。"""
        p = await _editor(pid, "reply_comment", {"cid": cid})
        who = actor()

        def do():
            with comments.file_lock(p.dir):
                items = comments.load(p.dir)
                c = comments.find(items, cid)
                if c is None:
                    raise _err("not_found", f"批注不存在：{cid}")
                c2 = comments.reply(c, body, _author_of(who))
                comments.save(p.dir, items)
                return c2.to_dict()

        return await run(pid, "reply_comment", {"cid": cid, "body_len": len(body)}, do)

    @server.tool()
    async def resolve_comment(pid: str, cid: str, resolved: bool = True) -> dict[str, Any]:
        """批注解决/重开。"""
        p = await _editor(pid, "resolve_comment", {"cid": cid, "resolved": resolved})
        who = actor()

        def do():
            with comments.file_lock(p.dir):
                items = comments.load(p.dir)
                c = comments.find(items, cid)
                if c is None:
                    raise _err("not_found", f"批注不存在：{cid}")
                c2 = comments.resolve(c, resolved, _author_of(who))
                comments.save(p.dir, items)
                return c2.to_dict()

        return await run(pid, "resolve_comment", {"cid": cid, "resolved": resolved}, do)

    @server.tool()
    async def delete_comment(pid: str, cid: str) -> dict[str, Any]:
        """删除批注线程（含全部答复）。"""
        p = await _editor(pid, "delete_comment", {"cid": cid})

        def do():
            with comments.file_lock(p.dir):
                items = comments.load(p.dir)
                if comments.find(items, cid) is None:
                    raise _err("not_found", f"批注不存在：{cid}")
                comments.save(p.dir, [c for c in items if c.id != cid])
                return {"ok": True}

        return await run(pid, "delete_comment", {"cid": cid}, do)

    @server.tool()
    async def create_public_link(
        pid: str, scope: str = "read", ttl_days: int | None = None, allow_download: bool = False
    ) -> dict[str, Any]:
        """创建免登录分享链（scope: read/comment）。"""
        await _editor(pid, "create_public_link", {"scope": scope})
        who = actor()

        def body():
            return asyncio.run(
                public_share.create_link(
                    pid, _ActorUser(who), scope=scope, ttl_days=ttl_days, allow_download=allow_download
                )
            )

        return await run(pid, "create_public_link", {"scope": scope, "ttl_days": ttl_days}, body)

    @server.tool()
    async def revoke_public_link(pid: str, token: str) -> dict[str, Any]:
        """吊销分享链。"""
        await _editor(pid, "revoke_public_link", {})
        who = actor()
        return await run(
            pid,
            "revoke_public_link",
            {"token": token[:8]},
            lambda: {"ok": asyncio.run(public_share.revoke_link(pid, token, _ActorUser(who)))},
        )

    @server.tool()
    async def apply_proposal(pid: str, proposal_id: str) -> dict[str, Any]:
        """应用 AI 提案（非 pending 409；写正文走提案契约——与 web 同款闸）。"""
        await _editor(pid, "apply_proposal", {"proposal_id": proposal_id})
        who = actor()
        return await run(
            pid,
            "apply_proposal",
            {"proposal_id": proposal_id},
            lambda: asyncio.run(agent_proposals.apply(store, pid, proposal_id, user=None, who=who.name)).model_dump(
                mode="json"
            ),
        )

    @server.tool()
    async def dismiss_proposal(pid: str, proposal_id: str) -> dict[str, Any]:
        """忽略 AI 提案。"""
        await _editor(pid, "dismiss_proposal", {"proposal_id": proposal_id})
        who = actor()
        return await run(
            pid,
            "dismiss_proposal",
            {"proposal_id": proposal_id},
            lambda: agent_proposals.dismiss(store, pid, proposal_id, who=who.name).model_dump(mode="json"),
        )

    @server.tool()
    async def apply_template(pid: str, name: str) -> dict[str, Any]:
        """套机构模板到案卷。"""
        await _editor(pid, "apply_template", {"name": name})
        return await run(
            pid, "apply_template", {"name": name}, lambda: asyncio.run(templates.apply_template(store, pid, name))
        )

    @server.tool()
    async def create_tag(name: str, color: str | None = None) -> dict[str, Any]:
        """建机构标签（AUTH=on 仅超管）。"""
        who = actor()
        if config.AUTH_ON and not who.superuser:
            raise _err("forbidden", "标签管理仅机构管理员可用", detail="superuser")

        def body():
            tags = cases.load_tags()
            if any(t.name == name for t in tags):
                raise _err("conflict", f"标签已存在：{name}")
            t = cases.Tag(name=name, **({"color": color} if color else {}))
            tags.append(t)
            cases.save_tags(tags)
            return t.model_dump(mode="json")

        return await _run_org(store, "create_tag", {"name": name}, body)

    @server.tool()
    async def run_scenario(pid: str, scenario: str, params: dict | None = None) -> dict[str, Any]:
        """发起 s1–s10 场景任务（同 POST /agent/run）。
        注意：本进程内执行并阻塞到完成；任务与提案落盘（.studio/ai-jobs/、proposals.jsonl），
        web 面板可见产出。步骤流仅本进程上下文可见。"""
        # P03：与 POST /agent/run 同一门禁——案级 ai_enabled + 机构闸门 + scenario.min_role
        await _require_egress(pid)
        try:
            scenario = agent_registry.validate_scenario(scenario)
            info = SCENARIO_BY_ID[scenario]
        except (ValueError, KeyError) as e:
            raise _err("validation", str(e), detail=scenario)
        await open_project(pid, info.min_role)
        who = actor()

        async def work():
            jobs = JobStore(config.PROJECTS_DIR)
            ai = ai_client.from_env()
            job = jobs.create(agent_loop.job_kind(scenario), pid)
            await agent_loop.run_scenario(
                pid, scenario, params or {}, job, store=store, jobs=jobs, ai=ai, who=who.name, actor=_actor_dict()
            )
            return jobs.get(job.id).to_dict()

        try:
            return await run(pid, "run_scenario", {"scenario": scenario}, work)
        except Exception as e:
            raise _err("internal", f"场景执行失败：{e}")


class _ActorUser:
    """public_share.create_link/revoke_link 需要带 .id 的 user 形——MCP Actor 轻量适配。"""

    def __init__(self, who):
        self.id = who.user_id
        self.email = who.name
