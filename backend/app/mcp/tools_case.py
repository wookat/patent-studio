# -*- coding: utf-8 -*-
"""W4-E E3 台账工具（docs/plan/17 §4.2）：get_case / set_case_status，复用 app.domain.cases（同 REST /case 路由）。

- get_case(pid) → cases.summary(case)：与 GET /api/projects/{pid}/case 同形（status / status_label / dates / deadlines /
  deadline_level / tags / owner…）。viewer+。
- set_case_status(pid, status, note="") → 同 POST /case/status：status ∈ cases.STATUSES，未变化 ⇒ conflict；
  写 case.json + history.commit_case（author = PAT 用户显示名；本机身份 ⇒ history.DEFAULT_AUTHOR）。
  AUTH=on 需 agent+（与 REST 的 AGENT 门槛一致），被拒也进审计。
  不提供 MCP 改申请日 / 申请号：递交回写是人在递交页做的事（17 §2.4），AI 只改状态并留 note。
"""

from __future__ import annotations

from typing import Any

from app import atomic
from app.domain import cases, history
from app.mcp import schemas
from app.mcp.tools import _err, actor, open_project_for, run_audited
from app.mcp.tools_figures import open_for_write


def _case(project_dir: str) -> cases.Case:
    try:
        return cases.ensure_case(project_dir)
    except cases.CaseError as e:
        raise _err("case", str(e)) from e


def _author() -> str | None:
    who = actor()
    return who.name if who.user_id is not None else None


def case_summary(store, pid: str) -> dict[str, Any]:
    return cases.summary(_case(store.get(pid).dir))


def change_status(store, pid: str, status: str, note: str = "") -> dict[str, Any]:
    d = store.get(pid).dir
    with atomic.studio_lock(d, "case"):
        case = _case(d)
        old = case.status
        if old == status:
            raise _err("conflict", "状态未变化", detail=status)
        try:
            case = cases.save_case(d, case.model_copy(update={"status": status}))
        except cases.CaseError as e:
            raise _err("case", str(e)) from e
        history.commit_case(d, cases.status_message(old, status, note), author=_author())
    return cases.summary(case)


def register(server, store):
    @server.tool(name="get_case")
    async def get_case_tool(pid: str) -> dict[str, Any]:
        """案卷台账（同 GET /api/projects/{pid}/case）：状态、申请日 / 申请号、期限与等级、标签、责任人。"""
        await open_project_for(store, pid)
        return await run_audited(store, pid, "get_case", {}, lambda: case_summary(store, pid))

    @server.tool(name="set_case_status")
    async def set_case_status_tool(pid: str, status: schemas.CaseStatus, note: str = "") -> dict[str, Any]:
        """改案卷状态（同 POST /case/status，记一条 git 事件）；AUTH=on 需 agent+。申请日 / 申请号请在递交页填。"""
        args = {"status": status, "note": note}
        await open_for_write(store, pid, "agent", "set_case_status", args)
        return await run_audited(store, pid, "set_case_status", args, lambda: change_status(store, pid, status, note))
