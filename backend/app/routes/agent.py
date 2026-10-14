# -*- coding: utf-8 -*-
"""智能体路由（docs/plan/21 §6.5、§7.4.8 agent-core-backend）。

- POST /api/projects/{pid}/agent/run {scenario, params} → 202 job（含 job_id）：案级 ai_enabled →
  ScenarioInfo.min_role → heavy 先过日预算（超出 429 budget）→
  JobStore.create(kind=agent:<s>, queue_key=<pid>:heavy | None) → run(loop.run_scenario)。
  机构级 org.require_org_ai 挂在 run / apply / dismiss 上（关闭 ⇒ 403 kind=ai_disabled_by_org）。
- GET  /api/projects/{pid}/agent/jobs：本案 agent:* 任务（含 steps 摘要）。
- GET  /api/projects/{pid}/agent/proposals?state=：.studio/ai-proposals/<pid>.jsonl。
- POST …/proposals/{id}/apply | dismiss：reviewer 起（ROUTE_ROLE）；apply 里 reviewer 的源文档写入再过
  check_source_write。
- GET  /api/projects/{pid}/ai/budget：{today_tokens, budget}。
- GET  /api/admin/ai-usage：机构汇总（superuser）。
SSE 步骤流在 routes_ai `GET /api/ai/jobs/{id}/events`（agent:* 任务走 watch_steps）。
"""

from fastapi import APIRouter, Depends, HTTPException, Request

from app.agent import budget, loop, proposals, registry
from app.agent.types import (
    SCENARIO_BY_ID,
    AgentJobOut,
    AgentJobsResponse,
    AgentRunIn,
    ProposalApplyResult,
    ProposalsResponse,
    ProposalState,
    heavy_queue_key,
    job_kind,
)
from app.ai import require_enabled
from app.ai.client import read_usage
from app.auth import CurrentUser, forbidden, my_role, require_superuser, role_at_least
from app.domain import events
from app.domain.org import require_org_ai
from app.errors import error_detail, kind_error

UNIT = "agent-core-backend"
router = APIRouter(tags=["agent"])


def _who(user) -> str:
    return "本机" if user is None else str(user.email)


def _job_out(job) -> AgentJobOut:
    return AgentJobOut.model_validate(job.to_dict())


@router.post("/api/projects/{pid}/agent/run", status_code=202, dependencies=[Depends(require_org_ai)])
async def agent_run(pid: str, body: AgentRunIn, request: Request, user: CurrentUser):
    store = request.app.state.store
    settings = require_enabled(store, pid, UNIT)
    try:
        scenario = registry.validate_scenario(body.scenario)
    except ValueError as e:
        raise kind_error("validation", str(e), detail=body.scenario)
    info = SCENARIO_BY_ID[scenario]
    role = await my_role(pid, user)
    if role is not None and not role_at_least(role, info.min_role):
        raise forbidden(info.min_role)
    p = store.get(pid)
    heavy = info.weight == "heavy"
    if heavy:
        budget.check_heavy(p.dir, settings)
    jobs = request.app.state.jobs
    # 同场景重复投递（客户端超时重试 / 双击）→ 409，避免并行双写提案与双倍 AI 消耗（与 convert 同口径）
    job = jobs.create_unless_busy(job_kind(scenario), pid, queue_key=heavy_queue_key(pid) if heavy else None)
    if job is None:
        raise HTTPException(409, error_detail("job_busy", "本案已有同一场景任务在进行中", detail=UNIT))
    ai = request.app.state.ai
    who, actor = _who(user), events.actor_of(user)
    jobs.run(
        job,
        lambda: loop.run_scenario(pid, scenario, body.params, job, store=store, jobs=jobs, ai=ai, who=who, actor=actor),
    )
    out = _job_out(jobs.get(job.id) or job).model_dump()
    return {**out, "job_id": job.id}


@router.get("/api/projects/{pid}/agent/jobs", response_model=AgentJobsResponse)
async def agent_jobs(pid: str, request: Request):
    request.app.state.store.get(pid)
    jobs = request.app.state.jobs.list(pid)
    return AgentJobsResponse(jobs=[_job_out(j) for j in jobs if j.kind.startswith("agent:")])


@router.get("/api/projects/{pid}/agent/proposals", response_model=ProposalsResponse)
async def agent_proposals(pid: str, request: Request, state: ProposalState | None = None):
    p = request.app.state.store.get(pid)
    return ProposalsResponse(proposals=proposals.load(p.dir, pid, state))


@router.post(
    "/api/projects/{pid}/agent/proposals/{proposal_id}/apply",
    response_model=ProposalApplyResult,
    dependencies=[Depends(require_org_ai)],
)
async def apply_proposal(pid: str, proposal_id: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    return await proposals.apply(store, pid, proposal_id, user=user, who=_who(user), actor=events.actor_of(user))


@router.post("/api/projects/{pid}/agent/proposals/apply-all", dependencies=[Depends(require_org_ai)])
async def apply_all_proposals(pid: str, request: Request, user: CurrentUser):
    """s1 成稿一批多份提案逐条点应用是重复摩擦——按入档序批量应用，单条失败不中止。"""
    store = request.app.state.store
    return await proposals.apply_all(store, pid, user=user, who=_who(user), actor=events.actor_of(user))


@router.post("/api/projects/{pid}/agent/proposals/{proposal_id}/dismiss", dependencies=[Depends(require_org_ai)])
async def dismiss_proposal(pid: str, proposal_id: str, request: Request, user: CurrentUser):
    store = request.app.state.store
    return proposals.dismiss(store, pid, proposal_id, who=_who(user), actor=events.actor_of(user)).model_dump()


@router.get("/api/projects/{pid}/ai/budget")
async def ai_budget(pid: str, request: Request):
    p = request.app.state.store.get(pid)
    return budget.status(p.dir, p.settings)


@router.get("/api/admin/ai-usage", dependencies=[Depends(require_superuser)])
async def org_ai_usage(request: Request):
    """机构今日用量：按案 / 按模型汇总（frontend AiUsageSummary）。budget = 各案日预算之和的上限口径太散，
    取机构缺省（config.AI_DAILY_TOKENS）。"""
    store = request.app.state.store
    by_project, by_model = [], {}
    for pid in store.list_ids():
        p = store.get(pid)
        rows = budget.today_rows(p.dir)
        by_project.append(
            {"pid": pid, "title": p.title, "today_tokens": sum(int(r.get("total_tokens") or 0) for r in rows)}
        )
        for r in read_usage(p.dir):
            m = by_model.setdefault(r.get("model") or "?", {"model": r.get("model") or "?", "tokens": 0, "calls": 0})
            m["tokens"] += int(r.get("total_tokens") or 0)
            m["calls"] += 1
    return {
        "today_tokens": sum(x["today_tokens"] for x in by_project),
        "budget": budget.daily_budget(None),
        "by_project": by_project,
        "by_model": sorted(by_model.values(), key=lambda x: -x["tokens"]),
    }
