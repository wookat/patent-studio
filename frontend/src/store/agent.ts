import { api, isAiDisabledByOrg, isBudgetExceeded, isNotImplemented } from '@/lib/api'
import type { AgentJob, AgentRunIn, Proposal, ProposalState, Scenario, StepEvent, StepEventKind, Usage } from '@/types/agent'
import type { AiJob } from '@/types/ai'
import { JOB_POLL_MS, isJobDone } from './ai'
import type { Slice } from './types'

/**
 * W5 智能体面板状态（docs/plan/21 §6；ai-panel-frontend 单元消费，agent-core-backend 单元填实后端）。
 * 现有 ai slice（对话 / 改写 / review job）不动；本 slice 只管 场景运行 / Proposal / StepEvent 流 / 用量预算。
 * 写入规则：Proposal 永不直接改 content.md；`applyProposal` 由后端把 critic 写成修订 / 把 patch 插块，前端拿 content 刷新 doc。
 *
 * 事件流：`watchAgentJob(id)` 先用 job.steps 回放，再订阅 SSE `GET /api/ai/jobs/{id}/events`；每帧可能是 StepEvent
 * （agent:* 任务 `watch_steps`）或整份 job（旧 `watch`，含 steps）——两种都吃；无 EventSource（jsdom）退回轮询 aiJob。
 */
export type AgentTab = 'chat' | 'scenarios' | 'proposals' | 'jobs'
export const AGENT_TABS: readonly AgentTab[] = ['chat', 'scenarios', 'proposals', 'jobs']

export interface AgentBudget {
  today_tokens: number
  budget: number
}

export interface AgentSlice {
  agentTab: AgentTab
  /** 用户本轮案域内显式点过 AI 页签——置位后 loadAgent 不再自动跳「建议」（C1/P07） */
  agentTabTouched: boolean
  /** 待定位高亮的提案 id（批注转提案 / 批注卡「查看建议」）；AiProposals 消费后置 null */
  pendingProposalId: string | null
  agentJobs: AgentJob[]
  /** 任务 tab 当前选中（时间线展示）的 job */
  agentActiveJobId: string | null
  /** StepEvent 按 job 累积（gen_delta 相邻合并；seq 判重） */
  agentEvents: Record<string, StepEvent[]>
  proposals: Proposal[]
  proposalFilter: ProposalState | 'all'
  agentLoading: boolean
  /** 后端 501 ⇒ 面板显示 EmptyState「功能开发中」 */
  agentUnavailable: boolean
  /** 403 ai_disabled_by_org ⇒ 场景卡全部 disabled + 提示「机构已禁用 AI」 */
  agentDisabledByOrg: boolean
  /** 429 budget ⇒ heavy 场景 disabled + 提示 */
  agentBudgetExceeded: boolean
  agentError: string | null
  /** GET …/ai/budget：今日 token 与日预算；501 / 失败为 null（不显示进度条） */
  agentBudget: AgentBudget | null

  setAgentTab(tab: AgentTab): void
  /** 标记一条提案待定位：建议 tab 滚动到它并短暂高亮 */
  focusProposal(id: string): void
  /** 定位消费完成（已高亮或提案不存在）后清掉标记 */
  consumePendingProposal(): void
  loadAgent(pid: string): Promise<void>
  loadAgentBudget(pid: string): Promise<void>
  runScenario(pid: string, scenario: Scenario, params?: AgentRunIn['params']): Promise<AgentJob | null>
  cancelAgentJob(jobId: string): Promise<void>
  /** Z14 续跑：interrupted / error 任务按 payload 重进队列 */
  resumeAgentJob(jobId: string): Promise<void>
  upsertAgentJob(job: AgentJob): void
  /** 选中并订阅（回放 steps + SSE）；null 只取消选中 */
  watchAgentJob(jobId: string | null): void
  /** 订阅但不选中——reload 后非首行的 live job 也要继续收 SSE/轮询，否则停在快照 */
  trackAgentJob(jobId: string): void
  pushAgentEvent(jobId: string, ev: StepEvent): void
  setProposalFilter(f: ProposalState | 'all'): void
  applyProposal(pid: string, proposalId: string): Promise<boolean>
  applyAllProposals(pid: string): Promise<boolean>
  dismissProposal(pid: string, proposalId: string): Promise<boolean>
  resetAgent(): void
}

const INITIAL = {
  agentTab: 'chat' as AgentTab,
  agentTabTouched: false,
  pendingProposalId: null as string | null,
  agentJobs: [] as AgentJob[],
  agentActiveJobId: null as string | null,
  agentEvents: {} as Record<string, StepEvent[]>,
  proposals: [] as Proposal[],
  proposalFilter: 'pending' as ProposalState | 'all',
  agentLoading: false,
  agentUnavailable: false,
  agentDisabledByOrg: false,
  agentBudgetExceeded: false,
  agentError: null as string | null,
  agentBudget: null as AgentBudget | null,
}

const STEP_KINDS: readonly StepEventKind[] = ['plan', 'tool_call', 'tool_result', 'gen_delta', 'check', 'proposal', 'done']

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const usageOf = (v: unknown): Usage => {
  const u = rec(v)
  return { prompt: num(u.prompt ?? u.prompt_tokens), completion: num(u.completion ?? u.completion_tokens) }
}

/**
 * 后端帧 → 类型化 StepEvent（types/agent.ts）。容忍 prep 夹具的旧字段名（`tool` → `name`、`*_tokens`），
 * 未知 kind 返回 null。
 */
export function normalizeStepEvent(raw: unknown): StepEvent | null {
  const r = rec(raw)
  const kind = r.kind
  if (typeof kind !== 'string' || !STEP_KINDS.includes(kind as StepEventKind) || typeof r.seq !== 'number') return null
  const base = { seq: r.seq, ts: num(r.ts) }
  const d = rec(r.data)
  switch (kind as StepEventKind) {
    case 'plan':
      return { ...base, kind: 'plan', data: { steps: strs(d.steps) } }
    case 'tool_call':
      return { ...base, kind: 'tool_call', data: { name: str(d.name ?? d.tool, '?'), args: rec(d.args) } }
    case 'tool_result':
      return { ...base, kind: 'tool_result', data: { name: str(d.name ?? d.tool, '?'), chars: num(d.chars), ms: num(d.ms) } }
    case 'gen_delta':
      return { ...base, kind: 'gen_delta', data: { text: str(d.text) } }
    case 'check':
      return { ...base, kind: 'check', data: { name: str(d.name, '?'), ok: d.ok === true, why: str(d.why ?? d.message) } }
    case 'proposal': {
      const anchor = rec(d.anchor)
      const kindP = str(d.kind, 'comment')
      return {
        ...base,
        kind: 'proposal',
        data: {
          id: str(d.id),
          kind: kindP === 'critic' || kindP === 'patch' ? kindP : 'comment',
          anchor:
            typeof anchor.file === 'string'
              ? { file: anchor.file }
              : {
                  book: (str(anchor.book, 'description') as 'abstract' | 'claims' | 'description'),
                  block_id: str(anchor.block_id),
                  line_start: num(anchor.line_start),
                  line_end: num(anchor.line_end),
                },
          preview: str(d.preview ?? d.summary),
        },
      }
    }
    case 'done':
      return {
        ...base,
        kind: 'done',
        data: {
          proposals: strs(d.proposals),
          usage: usageOf(d.usage),
          truncated: d.truncated === true,
          ...(typeof d.error === 'string' ? { error: d.error } : {}),
        },
      }
  }
  return null
}

/** 合并进已有事件列表：seq 判重，相邻 gen_delta 合并（合并后的 seq 取最新） */
export function mergeStepEvents(list: readonly StepEvent[], ev: StepEvent): StepEvent[] {
  const last = list[list.length - 1]
  if (last && ev.seq <= last.seq && ev.kind !== 'gen_delta') return list.slice()
  if (ev.kind === 'gen_delta' && last?.kind === 'gen_delta') {
    if (ev.seq <= last.seq) return list.slice()
    return [...list.slice(0, -1), { ...last, seq: ev.seq, ts: ev.ts, data: { text: last.data.text + ev.data.text } }]
  }
  return [...list, ev]
}

const replay = (steps: unknown): StepEvent[] => {
  let out: StepEvent[] = []
  if (!Array.isArray(steps)) return out
  for (const s of steps) {
    const ev = normalizeStepEvent(s)
    if (ev) out = mergeStepEvents(out, ev)
  }
  return out
}

/** 任务是否带「上下文已裁剪」（done 帧 truncated） */
export const jobTruncated = (events: readonly StepEvent[] | undefined): boolean =>
  !!events?.some((e) => e.kind === 'done' && e.data.truncated)

const isJobFrame = (r: Rec): boolean => typeof r.id === 'string' && typeof r.status === 'string' && !('seq' in r)

export const agentSlice: Slice<AgentSlice> = (set, get) => {
  const watchers = new Map<string, () => void>()

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (isNotImplemented(e)) set({ agentUnavailable: true, agentError: msg })
    else if (isAiDisabledByOrg(e)) set({ agentDisabledByOrg: true, agentError: msg })
    else if (isBudgetExceeded(e)) set({ agentBudgetExceeded: true, agentError: msg })
    else {
      set({ agentError: msg })
      get().toast(msg, 'error')
    }
    return false
  }

  const upsert = (job: AgentJob) => {
    if (get().pid && job.pid !== get().pid) return
    set((s) => {
      const exists = s.agentJobs.some((j) => j.id === job.id)
      const agentJobs = exists ? s.agentJobs.map((j) => (j.id === job.id ? job : j)) : [job, ...s.agentJobs]
      const replayed = Array.isArray(job.steps) && job.steps.length ? replay(job.steps) : null
      const cur = s.agentEvents[job.id] ?? []
      const agentEvents = replayed && replayed.length >= cur.length ? { ...s.agentEvents, [job.id]: replayed } : s.agentEvents
      return { agentJobs, agentEvents }
    })
  }

  const finish = (jobId: string) => {
    watchers.get(jobId)?.()
    watchers.delete(jobId)
  }

  const onFrame = (jobId: string, raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const r = rec(parsed)
    if (isJobFrame(r)) {
      const job = parsed as AgentJob
      upsert(job)
      if (isJobDone(job as AiJob)) finish(jobId)
      return
    }
    const ev = normalizeStepEvent(parsed)
    if (!ev) return
    get().pushAgentEvent(jobId, ev)
    if (ev.kind === 'done') {
      set((s) => ({
        agentJobs: s.agentJobs.map((j) =>
          j.id === jobId && !isJobDone(j as AiJob)
            ? { ...j, status: ev.data.error ? 'error' : 'done', progress: 1, error: ev.data.error ? { kind: 'agent', message: ev.data.error } : j.error }
            : j,
        ),
      }))
      finish(jobId)
      if (get().pid) void get().loadAgent(get().pid!)
    }
  }

  const subscribe = (jobId: string) => {
    if (watchers.has(jobId)) return
    if (typeof EventSource !== 'undefined') {
      const es = new EventSource(api.aiJobEventsUrl(jobId))
      es.onmessage = (e) => onFrame(jobId, String(e.data))
      es.onerror = () => {
        // 终态后服务端主动关闭也会触发 error；非终态则退到轮询
        es.close()
        const job = get().agentJobs.find((j) => j.id === jobId)
        if (job && isJobDone(job as AiJob)) {
          finish(jobId)
          return
        }
        watchers.delete(jobId)
        poll(jobId)
      }
      watchers.set(jobId, () => es.close())
      return
    }
    poll(jobId)
  }

  const poll = (jobId: string) => {
    if (watchers.has(jobId)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (stopped) return
      try {
        const job = (await api.aiJob(jobId)) as AgentJob
        if (stopped) return
        upsert(job)
        if (isJobDone(job as AiJob)) {
          finish(jobId)
          if (get().pid) void get().loadAgent(get().pid!)
          return
        }
      } catch (e) {
        if (isNotImplemented(e) || (e instanceof Error && e.message.includes('404'))) {
          finish(jobId)
          return
        }
      }
      timer = setTimeout(() => void tick(), JOB_POLL_MS)
    }
    watchers.set(jobId, () => {
      stopped = true
      if (timer) clearTimeout(timer)
    })
    void tick()
  }

  return {
    ...INITIAL,

    setAgentTab: (agentTab) => set({ agentTab, agentTabTouched: true }),

    focusProposal: (id) => set({ pendingProposalId: id }),
    consumePendingProposal: () => set({ pendingProposalId: null }),

    loadAgent: async (pid) => {
      set({ agentLoading: true, agentError: null })
      try {
        const [{ jobs }, { proposals }] = await Promise.all([api.agentJobs(pid), api.proposals(pid)])
        if (get().pid && get().pid !== pid) return
        set((s) => {
          const agentEvents = { ...s.agentEvents }
          for (const j of jobs) {
            const replayed = replay(j.steps)
            if (replayed.length >= (agentEvents[j.id]?.length ?? 0)) agentEvents[j.id] = replayed
          }
          /* agentDisabledByOrg 的权威源是 /ai/status.org_ai_enabled（loadAiStatus）；agent GETs 不挂
             require_org_ai，本行若回写 false 会把已读到的机构关态抹掉 */
          const next: Partial<AgentSlice> = { agentJobs: jobs, proposals, agentEvents, agentUnavailable: false }
          /* C1/P07：有待决建议且用户尚未显式选过页签 → 首屏落「建议」（任务与待决定可达） */
          if (!s.agentTabTouched && s.agentTab === 'chat' && proposals.some((p) => p.state === 'pending')) next.agentTab = 'proposals'
          return next
        })
      } catch (e) {
        fail(e)
      } finally {
        set({ agentLoading: false })
      }
    },

    loadAgentBudget: async (pid) => {
      try {
        const b = await api.aiBudget(pid)
        if (!get().pid || get().pid === pid) set({ agentBudget: { today_tokens: num(b.today_tokens), budget: num(b.budget) } })
      } catch {
        set({ agentBudget: null })
      }
    },

    runScenario: async (pid, scenario, params) => {
      try {
        const job = await api.agentRun(pid, { scenario, params })
        if (get().pid && get().pid !== pid) return job
        set({ agentBudgetExceeded: false, agentError: null })
        upsert(job)
        get().watchAgentJob(job.id)
        return job
      } catch (e) {
        fail(e)
        return null
      }
    },

    cancelAgentJob: async (jobId) => {
      try {
        const job = await api.agentCancel(jobId)
        upsert(job)
        finish(jobId)
      } catch (e) {
        fail(e)
      }
    },

    resumeAgentJob: async (jobId) => {
      try {
        const job = await api.agentResume(jobId)
        upsert(job)
        subscribe(jobId)  // 续跑后重回队列：继续收 SSE / 轮询到终态
      } catch (e) {
        fail(e)
      }
    },

    upsertAgentJob: upsert,

    watchAgentJob: (jobId) => {
      set({ agentActiveJobId: jobId })
      if (!jobId) return
      const job = get().agentJobs.find((j) => j.id === jobId)
      if (job && Array.isArray(job.steps) && job.steps.length && !(get().agentEvents[jobId]?.length)) {
        set((s) => ({ agentEvents: { ...s.agentEvents, [jobId]: replay(job.steps) } }))
      }
      if (job && isJobDone(job as AiJob)) return
      subscribe(jobId)
    },

    trackAgentJob: (jobId) => {
      const job = get().agentJobs.find((j) => j.id === jobId)
      if (!job || isJobDone(job as AiJob)) return
      if (Array.isArray(job.steps) && job.steps.length && !(get().agentEvents[jobId]?.length)) {
        set((s) => ({ agentEvents: { ...s.agentEvents, [jobId]: replay(job.steps) } }))
      }
      subscribe(jobId)
    },


    pushAgentEvent: (jobId, ev) =>
      set((s) => ({ agentEvents: { ...s.agentEvents, [jobId]: mergeStepEvents(s.agentEvents[jobId] ?? [], ev) } })),

    setProposalFilter: (proposalFilter) => set({ proposalFilter }),

    applyProposal: async (pid, proposalId) => {
      try {
        const { proposal, content } = await api.applyProposal(pid, proposalId)
        set((s) => ({ proposals: s.proposals.map((p) => (p.id === proposal.id ? proposal : p)) }))
        if (content != null && get().pid === pid) {
          get().applyServerContent(content)
          // patch 类提案会改行数/结构：不调度 AST 就永久陈旧（同 history.restoreVersion 先例）
          get().scheduleAst()
        }
        get().toast(proposal.kind === 'critic' ? '已以 CriticMarkup 建议写入，请在审阅面板接受或拒绝' : proposal.kind === 'comment' ? '已写入为批注' : '已应用', 'success')
        return true
      } catch (e) {
        return fail(e)
      }
    },

    applyAllProposals: async (pid) => {
      try {
        const r = await api.applyAllProposals(pid)
        const okIds = new Set(r.applied)
        set((s) => ({ proposals: s.proposals.map((p) => (okIds.has(p.id) ? { ...p, state: 'applied' } : p)) }))
        if (r.content != null && get().pid === pid) {
          get().applyServerContent(r.content)
          get().scheduleAst()
        }
        if (r.failed.length > 0) {
          get().toast(`已应用 ${r.applied.length} 条，${r.failed.length} 条失败`, 'warning')
        } else {
          get().toast(`已应用全部 ${r.applied.length} 条提案`, 'success')
        }
        return r.failed.length === 0
      } catch (e) {
        return fail(e)
      }
    },

    dismissProposal: async (pid, proposalId) => {
      try {
        const proposal = await api.dismissProposal(pid, proposalId)
        set((s) => ({ proposals: s.proposals.map((p) => (p.id === proposal.id ? proposal : p)) }))
        return true
      } catch (e) {
        return fail(e)
      }
    },

    resetAgent: () => {
      for (const stop of watchers.values()) stop()
      watchers.clear()
      set({ ...INITIAL, agentTab: get().agentTab, agentTabTouched: false })
    },
  }
}

/** 待处理建议数（rail / tab 角标） */
export const selectProposalsPending = (s: AgentSlice): number => s.proposals.filter((p) => p.state === 'pending').length
/** 有 queued / running 的 agent job */
export const selectAgentRunning = (s: AgentSlice): boolean =>
  s.agentJobs.some((j) => j.status === 'queued' || j.status === 'running')
