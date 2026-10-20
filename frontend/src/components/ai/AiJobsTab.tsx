import { useEffect, useState } from 'react'
import { fmtTokens } from '@/lib/format'
import { api, ApiError } from '@/lib/api'
import type { AgentMetrics } from '@/lib/api/ai'
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, FileText, ListTodo, RotateCcw, Scissors, Wrench, XCircle, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectAiEnabled } from '@/store'
import { jobTruncated } from '@/store/agent'
import { ROLE_RANK } from '@/lib/types'
import { SCENARIOS, type AgentJob, type StepEvent, type StepEventKind } from '@/types/agent'
import { anchorLabel, focusAnchor } from './aiModel'

const KIND_META: Record<StepEventKind, { label: string; Icon: LucideIcon; tone: string }> = {
  plan: { label: '规划', Icon: ListTodo, tone: 'text-info-fg' },
  tool_call: { label: '调用工具', Icon: Wrench, tone: 'text-fg-muted' },
  tool_result: { label: '工具返回', Icon: Wrench, tone: 'text-fg-muted' },
  gen_delta: { label: '生成', Icon: FileText, tone: 'text-fg' },
  check: { label: '自检', Icon: CheckCircle2, tone: 'text-ok-fg' },
  proposal: { label: '建议', Icon: ClipboardList, tone: 'text-link' },
  done: { label: '完成', Icon: CheckCircle2, tone: 'text-ok-fg' },
}

const STATUS_LABEL: Record<AgentJob['status'], string> = { queued: '排队中', running: '进行中', done: '完成', error: '失败', interrupted: '已取消' }
const STATUS_TONE: Record<AgentJob['status'], 'neutral' | 'info' | 'ok' | 'danger' | 'outline'> = {
  queued: 'neutral', running: 'info', done: 'ok', error: 'danger', interrupted: 'outline',
}
/** 运行态圆点（05 §S6：任务卡 = 圆点 + 名 + 时间；running 脉冲） */
const STATUS_DOT: Record<AgentJob['status'], string> = {
  queued: 'bg-fg-disabled', running: 'bg-info-dot motion-safe:animate-pulse', done: 'bg-ok-dot', error: 'bg-danger-dot', interrupted: 'bg-fg-disabled',
}

const scenarioOf = (job: AgentJob) => SCENARIOS.find((s) => `agent:${s.id}` === job.kind)?.label ?? job.kind.replace(/^agent:/, '')
const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * 任务与历史 tab（W5 §6.6 A4 / R-AI-09 / R-AI-11）：今日用量 / 预算进度条 + 智能体任务列表（选中 → SSE 订阅）
 * + 选中任务的 StepEvent 时间线（plan / tool_call / tool_result / gen_delta / check / proposal / done）
 * + truncated → 「上下文已裁剪」+ 排队/进行中可取消。
 */
export function AiJobsTab({ pid, compact }: { pid: string | null; compact: boolean }) {
  const jobs = useStudio((s) => s.agentJobs)
  const activeId = useStudio((s) => s.agentActiveJobId)
  const unavailable = useStudio((s) => s.agentUnavailable)
  const loading = useStudio((s) => s.agentLoading)
  const watch = useStudio((s) => s.watchAgentJob)
  const track = useStudio((s) => s.trackAgentJob)
  const cancel = useStudio((s) => s.cancelAgentJob)
  const canCancel = useStudio((s) => ROLE_RANK[s.project?.role ?? 'editor'] >= ROLE_RANK.editor)
  const events = useStudio((s) => (s.agentActiveJobId ? s.agentEvents[s.agentActiveJobId] : undefined))
  const active = jobs.find((j) => j.id === activeId) ?? null
  const enabled = useStudio(selectAiEnabled)
  const loadAgent = useStudio((s) => s.loadAgent)

  /* 页签重挂即重拉：面板常挂期间他端/他会话新建的任务不会自动回流（本 tab 随 TabsContent 卸载） */
  useEffect(() => {
    if (pid && enabled && !unavailable) void loadAgent(pid)
  }, [pid, enabled, unavailable, loadAgent])

  useEffect(() => {
    /* 非选中 live job 也要订（只订阅不选中）——否则 reload 后只有首行活，其余停在 loadAgent 快照 */
    for (const j of jobs) if (j.status === 'queued' || j.status === 'running') track(j.id)
    if (!activeId && jobs.length) watch(jobs[0].id)
  }, [activeId, jobs, watch, track])

  return (
    <div className="flex flex-col gap-3" data-testid="ai-jobs-tab">
      <BudgetBar pid={pid} />
      <MetricsCard pid={pid} refreshKey={jobs.length + ':' + jobs.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'interrupted').length} />
      {unavailable ? (
        <EmptyState size="sm" icon={ListTodo} title={NOT_IMPLEMENTED_TITLE} reason="智能体任务接口尚未落地。" data-testid="ai-jobs-unavailable" />
      ) : jobs.length === 0 && !loading ? (
        <EmptyState size="sm" icon={ListTodo} title="还没有任务" reason="在「场景」运行任务后，进度、步骤与产出会在这里实时显示。" data-testid="ai-jobs-empty" />
      ) : (
        <>
          <ul className="flex flex-col gap-1" aria-label="智能体任务" data-testid="ai-jobs-list">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} selected={j.id === activeId} compact={compact} canCancel={canCancel} onSelect={() => watch(j.id)} onCancel={() => void cancel(j.id)} />
            ))}
          </ul>
          {active && <Timeline job={active} events={events ?? []} />}
        </>
      )}
    </div>
  )
}

/** Z32 成果度量卡：已产出/待审/采纳/拒绝/失败/中断/恢复计数 + 可回溯明细 + 样本量与局限。
 *  耗时/费用/人工改动仅在有证据时展示，否则「未采集」；计数不作质量排名。 */
function MetricsCard({ pid, refreshKey }: { pid: string | null; refreshKey: string }) {
  const [m, setM] = useState<AgentMetrics | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const watch = useStudio((s) => s.watchAgentJob)
  const setAgentTab = useStudio((s) => s.setAgentTab)

  useEffect(() => {
    if (!pid) return
    const ac = new AbortController()
    api
      .agentMetrics(pid, ac.signal)
      .then(setM)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setErr(e instanceof ApiError ? e.message : '度量加载失败')
      })
    return () => ac.abort()
  }, [pid, refreshKey])

  if (err) return <p className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-danger-fg" role="alert">{err}</p>
  if (!m || m.sample.jobs === 0 && m.sample.proposals === 0) return null

  const timed = m.jobs.items.filter((i) => i.duration_s != null)
  const attention = m.jobs.items.filter((i) => i.status === 'error' || i.status === 'interrupted' || i.resumed)
  const pendingProps = m.proposals.items.filter((p) => p.state === 'pending')

  return (
    <section className="rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-sm" data-testid="ai-metrics" aria-label="Agent 成果度量">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg-strong">成果度量</span>
        <span className="font-mono text-2xs text-fg-muted" title={`样本：任务 ${m.sample.jobs} · 提案 ${m.sample.proposals} · 用量行 ${m.sample.usage_rows}`}>
          n={m.sample.jobs}/{m.sample.proposals}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="ai-metrics-counts">
        <Badge tone="violet">产出 {m.proposals.produced}</Badge>
        <Badge tone="info">待审 {m.proposals.pending}</Badge>
        <Badge tone="ok">采纳 {m.proposals.applied}</Badge>
        <Badge tone="neutral">拒绝 {m.proposals.dismissed}</Badge>
        <Badge tone={m.jobs.error ? 'danger' : 'neutral'}>失败 {m.jobs.error}</Badge>
        <Badge tone={m.jobs.interrupted ? 'warn' : 'neutral'}>中断 {m.jobs.interrupted}</Badge>
        <Badge tone={m.jobs.resumed ? 'brand' : 'neutral'}>恢复 {m.jobs.resumed}</Badge>
      </div>
      <dl className="mt-1.5 grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-2xs text-fg-muted">
        <dt>耗时</dt>
        <dd>{timed.length ? `${timed.length} 个终态任务可计量（含排队/中断间隔，非推理时长）` : '未采集'}</dd>
        <dt>token</dt>
        <dd>{m.usage.total_tokens == null ? '未采集' : `${fmtTokens(m.usage.total_tokens)}（${m.usage.rows} 行，非费用）`}</dd>
        <dt>费用</dt>
        <dd title={m.cost.reason}>未采集</dd>
        <dt>人工改动</dt>
        <dd title={m.human_edits.reason}>未采集</dd>
      </dl>
      <button
        type="button"
        className={cn('mt-1 text-2xs text-link hover:underline', FOCUS_RING)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="ai-metrics-toggle"
      >
        {open ? '收起明细与局限' : '明细与局限'}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5" data-testid="ai-metrics-detail">
          {attention.length > 0 && (
            <p className="text-2xs text-fg-muted">
              失败/中断/恢复：
              {attention.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className={cn('ml-1 rounded-xs border border-border bg-sunken px-1 hover:bg-hover', FOCUS_RING)}
                  title={`${j.kind} · ${STATUS_LABEL[j.status]}${j.error?.message ? ` · ${j.error.message}` : ''}`}
                  onClick={() => watch(j.id)}
                  data-testid={`ai-metrics-job-${j.id}`}
                >
                  {j.id.slice(-6)}
                </button>
              ))}
            </p>
          )}
          {pendingProps.length > 0 && (
            <p className="text-2xs text-fg-muted">
              待审提案：
              {pendingProps.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn('ml-1 rounded-xs border border-border bg-sunken px-1 hover:bg-hover', FOCUS_RING)}
                  title={`${p.scenario ?? ''} · ${p.job_id ?? ''}`}
                  onClick={() => setAgentTab('proposals')}
                  data-testid={`ai-metrics-prop-${p.id}`}
                >
                  {p.id.slice(-6)}
                </button>
              ))}
            </p>
          )}
          <ul className="list-disc space-y-0.5 pl-4 text-2xs text-fg-muted" data-testid="ai-metrics-limits">
            {m.limits.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function BudgetBar({ pid }: { pid: string | null }) {
  const budget = useStudio((s) => s.agentBudget)
  const load = useStudio((s) => s.loadAgentBudget)
  useEffect(() => {
    if (pid) void load(pid)
  }, [pid, load])
  if (!budget) return null
  const pct = budget.budget > 0 ? Math.min(100, Math.round((budget.today_tokens / budget.budget) * 100)) : 0
  const over = budget.budget > 0 && budget.today_tokens >= budget.budget
  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-sm" data-testid="ai-budget" data-over={over || undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg-strong">今日用量</span>
        <span className={cn('font-mono text-2xs text-fg-muted', over && 'text-danger-fg')}>
          {fmtTokens(budget.today_tokens)} / {fmtTokens(budget.budget)} tokens
        </span>
      </div>
      <Progress
        value={pct}
        label={`今日 AI 用量 ${pct}%`}
        className={cn('mt-1.5', over ? '[&>[data-slot=progress-indicator]]:bg-danger-dot' : pct >= 80 && '[&>[data-slot=progress-indicator]]:bg-warn-dot')}
      />
    </div>
  )
}

function JobRow({ job, selected, compact, canCancel, onSelect, onCancel }: { job: AgentJob; selected: boolean; compact: boolean; canCancel: boolean; onSelect: () => void; onCancel: () => void }) {
  const live = job.status === 'queued' || job.status === 'running'
  const evs = useStudio((s) => s.agentEvents[job.id])
  const truncated = jobTruncated(evs)
  const resume = useStudio((s) => s.resumeAgentJob)
  const setAgentTab = useStudio((s) => s.setAgentTab)
  const proposalCount = job.proposal_ids?.length ?? 0
  // Z14/Z25：interrupted / error 且记录了续跑入参 ⇒ 「续跑 / 重试」；已产出提案数可跳到建议 tab（Z27）
  const resumable = (job.status === 'interrupted' || job.status === 'error') && job.payload != null
  return (
    <li className={cn('flex flex-col rounded-lg border border-border bg-panel shadow-sm', selected && 'border-brand-300 bg-selected/40')} data-testid={`ai-job-${job.id}`} data-status={job.status}>
      <div className="flex items-center gap-1">
      <button
        type="button"
        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-xs', compact ? 'min-h-touch' : 'h-md-control', FOCUS_RING)}
        aria-pressed={selected}
        aria-label={`${scenarioOf(job)} · ${STATUS_LABEL[job.status]}`}
        onClick={onSelect}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-fg-muted transition-transform duration-(--dur-fast)', selected && 'rotate-90')} aria-hidden />
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[job.status])} />
        <span className="truncate font-medium text-fg-strong" title={scenarioOf(job)}>{scenarioOf(job)}</span>
        <Badge tone={STATUS_TONE[job.status]} className="shrink-0">{STATUS_LABEL[job.status]}</Badge>
        {job.status === 'queued' && job.message && <span className="shrink-0 truncate text-fg-muted" title={job.message}>{job.message}</span>}
        {truncated && (
          <Badge tone="warn" className="shrink-0" title="上下文超过上限，已按锚点裁剪" data-testid={`ai-job-clipped-${job.id}`}>
            <Scissors /> 已裁剪
          </Badge>
        )}
        <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted">{fmtTime(job.created_at)}</span>
      </button>
      {proposalCount > 0 && (
        <Badge tone="violet" className="mr-1 shrink-0" title={`产出 ${proposalCount} 条建议，点击到「建议」tab 查看`} data-testid={`ai-job-proposals-${job.id}`}>
          <button type="button" className={FOCUS_RING} onClick={(e) => { e.stopPropagation(); setAgentTab('proposals') }}>
            建议 ×{proposalCount}
          </button>
        </Badge>
      )}
      {live && (
        <Button size={compact ? 'md' : 'xs'} variant="ghost" className="mr-1 shrink-0" disabled={!canCancel} title={canCancel ? undefined : '取消任务需要编辑者及以上角色'} onClick={onCancel} aria-label={`取消任务 ${scenarioOf(job)}`} data-testid={`ai-job-cancel-${job.id}`}>
          <XCircle /> 取消
        </Button>
      )}
      {resumable && (
        <Button size={compact ? 'md' : 'xs'} variant="ghost" className="mr-1 shrink-0" disabled={!canCancel} title={canCancel ? '按原参数续跑，已产出建议不重复生成' : '续跑任务需要编辑者及以上角色'} onClick={() => void resume(job.id)} aria-label={`续跑任务 ${scenarioOf(job)}`} data-testid={`ai-job-resume-${job.id}`}>
          <RotateCcw /> {job.status === 'error' ? '重试' : '续跑'}
        </Button>
      )}
      </div>
      {job.status === 'running' && (
        <div className="px-2.5 pb-2">
          <Progress value={Math.round(job.progress * 100)} className="h-1" label={`${scenarioOf(job)} 进度 ${Math.round(job.progress * 100)}%`} />
          {job.message && <p className="mt-1 truncate text-2xs text-fg-muted" title={job.message}>{job.message}</p>}
        </div>
      )}
    </li>
  )
}

function Timeline({ job, events }: { job: AgentJob; events: StepEvent[] }) {
  const live = job.status === 'queued' || job.status === 'running'
  const truncated = jobTruncated(events)
  return (
    <section aria-label={`任务步骤：${scenarioOf(job)}`} className="rounded-lg border border-border bg-panel p-3 shadow-sm" data-testid="ai-timeline" aria-busy={live || undefined}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg-strong">步骤时间线</span>
        {live && <Progress value={Math.round(job.progress * 100)} className="max-w-32 flex-1" label={`任务进度 ${Math.round(job.progress * 100)}%`} />}
        {truncated && (
          <Badge tone="warn" data-testid="ai-clipped">
            <Scissors /> 上下文已裁剪
          </Badge>
        )}
      </div>
      {job.error && (
        <Alert variant="danger" className="mt-2">
          <AlertTriangle aria-hidden />
          <AlertDescription>{job.error.message}</AlertDescription>
        </Alert>
      )}
      {events.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted" role="status">{live ? '等待智能体开始…' : '此任务没有可回放的步骤。'}</p>
      ) : (
        <div role="log" aria-live={live ? 'polite' : 'off'} aria-relevant="additions">
          <ol className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3" aria-label="步骤时间线">
            {events.map((ev) => <EventRow key={`${ev.kind}-${ev.seq}`} ev={ev} />)}
          </ol>
        </div>
      )}
    </section>
  )
}

function EventRow({ ev }: { ev: StepEvent }) {
  const meta = KIND_META[ev.kind]
  const Icon = ev.kind === 'check' && !ev.data.ok ? XCircle : ev.kind === 'done' && ev.data.error ? XCircle : meta.Icon
  const bad = (ev.kind === 'check' && !ev.data.ok) || (ev.kind === 'done' && ev.data.error)
  const tone = bad ? 'text-danger-fg' : meta.tone
  return (
    <li className="relative text-xs" data-testid={`ai-event-${ev.kind}`} data-seq={ev.seq}>
      <span className={cn('absolute -left-4 top-1.5 size-2 rounded-full', bad ? 'bg-danger-dot' : ev.kind === 'done' || ev.kind === 'check' ? 'bg-ok-dot' : ev.kind === 'proposal' ? 'bg-violet-dot' : 'bg-border-strong')} aria-hidden />
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-3.5 shrink-0', tone)} aria-hidden />
        <span className="font-medium text-fg-strong">{meta.label}</span>
        <span className="ml-auto font-mono text-2xs text-fg-subtle">{fmtTime(ev.ts)}</span>
      </div>
      <EventBody ev={ev} />
    </li>
  )
}

function EventBody({ ev }: { ev: StepEvent }) {
  const ast = useStudio((s) => s.ast)
  switch (ev.kind) {
    case 'plan':
      return (
        <ol className="mt-0.5 list-decimal pl-5 text-fg-muted">
          {ev.data.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )
    case 'tool_call':
      return (
        <p className="mt-0.5 truncate font-mono text-2xs text-fg-muted" title={JSON.stringify(ev.data.args)}>
          {ev.data.name}({Object.keys(ev.data.args).join(', ')})
        </p>
      )
    case 'tool_result':
      return <p className="mt-0.5 text-2xs text-fg-muted">{ev.data.name} · {ev.data.chars.toLocaleString('zh-CN')} 字 · {ev.data.ms} ms</p>
    case 'gen_delta':
      return <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-fg-muted">{ev.data.text}</p>
    case 'check':
      return <p className={cn('mt-0.5', ev.data.ok ? 'text-fg-muted' : 'text-danger-fg')}>{ev.data.name}{ev.data.why ? `：${ev.data.why}` : ev.data.ok ? '：通过' : '：未通过'}</p>
    case 'proposal':
      return (
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-fg-muted">
          <span>{ev.data.kind === 'critic' ? '修订' : ev.data.kind === 'comment' ? '批注' : '新增'} → </span>
          <button
            type="button"
            className={cn('text-link underline decoration-dotted underline-offset-2 hover:decoration-solid', FOCUS_RING)}
            onClick={() => focusAnchor(ev.data.anchor)}
            disabled={!('block_id' in ev.data.anchor)}
            data-testid={`ai-event-proposal-locate-${ev.data.id}`}
          >
            {anchorLabel(ev.data.anchor, ast)}
          </button>
          {ev.data.preview && <span className="line-clamp-2 basis-full">{ev.data.preview}</span>}
        </p>
      )
    case 'done':
      return (
        <p className="mt-0.5 text-fg-muted">
          {ev.data.error ? `失败：${ev.data.error}` : `${ev.data.proposals.length} 条建议`}
          {ev.data.usage ? ` · ${fmtTokens(ev.data.usage.prompt + ev.data.usage.completion)} tokens` : ''}
        </p>
      )
  }
}
