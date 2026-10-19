import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Check, FileStack, FileText, GitPullRequest, LoaderCircle, ShieldAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { queryClient } from '@/lib/query'
import { AmbiguousCaseError, getPlatformCase } from '@/lib/platform'
import { useStudio } from '@/store'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys, useWorkbenchMutations } from '@/workbench/queries'
import type { PlatformCase } from '@/workbench/types'
import { ProposalsPanel } from '@/components/workbench/WorkbenchPage'

/**
 * B17 M4：工作台伴随栏平台面板（`?panel=proposals|materials`）。
 * 作用域解析：store.pid（目录名）→ getPlatformCase → PG case_id；
 * 身份冲突或读取失败时阻断本面板读写，不伪装成未关联。
 * 正文自带 QueryClientProvider——伴随栏单元测试裸挂载也能工作。
 */
export function PlatformCompanionScope({ children }: { children: (caseItem: PlatformCase) => ReactNode }) {
  const pid = useStudio((s) => s.pid)
  const [resolved, setResolved] = useState<{ pid: string; caseItem: PlatformCase | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!pid) return
    let on = true
    void getPlatformCase(pid)
      .then((c) => {
        if (on) setResolved({ pid, caseItem: c, error: null })
      })
      .catch((error: unknown) => {
        if (on) setResolved({ pid, caseItem: null, error: error instanceof AmbiguousCaseError ? error.message : '读取案件失败，请检查登录状态或稍后重试。' })
      })
    return () => {
      on = false
    }
  }, [pid])
  if (!pid) return <EmptyState size="sm" icon={FileText} title="未打开案卷" reason="先在工作台打开一个案件。" data-testid="platform-no-case" />
  const fresh = resolved && resolved.pid === pid ? resolved : null // pid 切换后旧解析作废，渲染回 loading
  if (!fresh) return <div className="flex min-h-24 items-center justify-center text-fg-muted" role="status"><LoaderCircle className="mr-2 size-5 animate-spin" />正在解析平台案件…</div>
  if (fresh.error) return <EmptyState size="sm" icon={ShieldAlert} title="案件数据不可用" reason={fresh.error} data-testid="platform-error" />
  if (!fresh.caseItem) return <EmptyState size="sm" icon={GitPullRequest} title="未关联协作案件" reason="此案卷尚未关联可访问的机构案件，请联系案件管理者。" data-testid="platform-not-migrated" />
  return <QueryClientProvider client={queryClient}>{children(fresh.caseItem)}</QueryClientProvider>
}

/** 提案伴随栏：本案的文稿/附图提案，行内提交/采纳/拒绝（复用 workbench ProposalsPanel）。 */
export function ProposalsCompanionBody() {
  return (
    <PlatformCompanionScope>
      {(c) => <ProposalsScoped caseItem={c} />}
    </PlatformCompanionScope>
  )
}

function ProposalsScoped({ caseItem }: { caseItem: PlatformCase }) {
  const proposals = useQuery({ queryKey: workbenchKeys.proposals(caseItem.id), queryFn: ({ signal }) => workbenchApi.proposals(caseItem.id, signal) })
  return <div className="h-full min-h-0 overflow-auto" data-testid="companion-proposals-body"><ProposalsPanel caseId={caseItem.id} proposals={proposals} /></div>
}

const FACT_STATUS: Record<string, string> = { pending: '待确认', confirmed: '已确认', rejected: '已驳回' }
const FACT_TONE = { pending: 'warn', confirmed: 'ok', rejected: 'danger' } as const

/** 资料事实伴随栏：材料列表（查看原文链接）+ 事实确认/驳回（/api/v1 facts）。 */
export function MaterialsCompanionBody() {
  return (
    <PlatformCompanionScope>
      {(c) => <MaterialsFacts caseItem={c} />}
    </PlatformCompanionScope>
  )
}

function MaterialsFacts({ caseItem }: { caseItem: PlatformCase }) {
  const materials = useQuery({ queryKey: workbenchKeys.materials(caseItem.id), queryFn: ({ signal }) => workbenchApi.materials(caseItem.id, signal) })
  const facts = useQuery({ queryKey: workbenchKeys.facts(caseItem.id), queryFn: ({ signal }) => workbenchApi.facts(caseItem.id, signal) })
  const { confirmFact, rejectFact } = useWorkbenchMutations()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const factsByMaterial = new Map<string, string>()
  for (const m of materials.data ?? []) factsByMaterial.set(m.id, m.title)

  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="companion-materials-body">
      <section className="p-3">
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">案件资料</h3>
        {materials.isLoading ? (
          <p className="text-sm text-fg-muted">加载资料…</p>
        ) : materials.isError ? (
          <p className="text-sm text-danger-fg" role="alert">资料加载失败</p>
        ) : materials.data?.length ? (
          <ul className="grid gap-2">
            {materials.data.map((m) => (
              <li key={m.id} className="rounded-md border border-border bg-panel p-2 text-sm" data-testid={`material-${m.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-fg-strong" title={m.title}>{m.title}</span>
                  <Badge tone={m.status === 'active' ? 'info' : 'neutral'}>{m.status}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                  <Badge tone="neutral">{m.kind}</Badge>
                  {m.content_ref && (
                    <a href={workbenchApi.materialContentUrl(m.id)} className="text-link hover:underline" data-testid={`material-content-${m.id}`}>查看原文</a>
                  )}
                  {m.source_url && <span className="truncate" title={m.source_url}>{m.source_url}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="materials-empty">暂无资料</p>
        )}
      </section>
      <section className="border-t border-border p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg-strong"><FileStack className="size-4 text-fg-icon" aria-hidden />案件事实</h3>
        {facts.isLoading ? (
          <p className="text-sm text-fg-muted">加载事实…</p>
        ) : facts.isError ? (
          <p className="text-sm text-danger-fg" role="alert">事实加载失败</p>
        ) : facts.data?.length ? (
          <ul className="grid gap-2">
            {facts.data.map((f) => (
              <li key={f.id} className="rounded-md border border-border bg-panel p-2 text-sm" data-testid={`fact-${f.id}`}>
                <p className="text-fg">{f.statement}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone={FACT_TONE[f.status as keyof typeof FACT_TONE] ?? 'neutral'}>{FACT_STATUS[f.status] ?? f.status}</Badge>
                  {f.material_id && factsByMaterial.get(f.material_id) && <span className="text-xs text-fg-muted">出自《{factsByMaterial.get(f.material_id)}》</span>}
                  {f.status === 'pending' && rejecting !== f.id && (
                    <span className="ml-auto flex gap-1">
                      <Button size="xs" variant="secondary" disabled={confirmFact.isPending} onClick={() => confirmFact.mutate({ factId: f.id, caseId: caseItem.id })} data-testid={`fact-confirm-${f.id}`}><Check aria-hidden />确认</Button>
                      <Button size="xs" variant="ghost" onClick={() => { setRejecting(f.id); setReason('') }} data-testid={`fact-reject-${f.id}`}><X aria-hidden />驳回</Button>
                    </span>
                  )}
                </div>
                {f.status === 'rejected' && f.rejection_reason && <p className="mt-1 text-xs text-fg-muted">驳回理由：{f.rejection_reason}</p>}
                {rejecting === f.id && (
                  <div className="mt-2 flex items-center gap-1" data-testid={`fact-rejecting-${f.id}`}>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回理由（可选）" aria-label="驳回理由" className="h-7 text-xs" />
                    <Button size="xs" variant="secondary" loading={rejectFact.isPending} onClick={() => rejectFact.mutate({ factId: f.id, caseId: caseItem.id, reason: reason.trim() || null }, { onSuccess: () => setRejecting(null) })}>确认驳回</Button>
                    <Button size="xs" variant="ghost" onClick={() => setRejecting(null)}>取消</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="facts-empty">暂无待确认事实</p>
        )}
      </section>
    </div>
  )
}

/** 运行伴随栏：本案 Agent/协作运行列表（B17 后端补口 GET /cases/{id}/runs），点行展开事件流。 */
export function RunsCompanionBody() {
  return (
    <PlatformCompanionScope>
      {(c) => <RunsList caseItem={c} />}
    </PlatformCompanionScope>
  )
}

const RUN_TONE = { running: 'info', pending: 'warn', succeeded: 'ok', failed: 'danger', canceled: 'neutral' } as const

function RunsList({ caseItem }: { caseItem: PlatformCase }) {
  const runs = useQuery({ queryKey: workbenchKeys.runs(caseItem.id), queryFn: ({ signal }) => workbenchApi.runs(caseItem.id, signal) })
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="h-full min-h-0 overflow-auto p-3" data-testid="companion-runs-body">
      {runs.isLoading ? (
        <p className="text-sm text-fg-muted">加载运行…</p>
      ) : runs.isError ? (
        <p className="text-sm text-danger-fg" role="alert">运行列表加载失败</p>
      ) : runs.data?.length ? (
        <ul className="grid gap-2">
          {runs.data.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-panel" data-testid={`run-${r.id}`}>
              <button type="button" className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="min-w-0">
                  <span className="font-medium text-fg-strong">{r.run_type}</span>
                  <span className="ml-2 font-mono text-xs text-fg-muted">{r.run_id}</span>
                </span>
                <Badge tone={RUN_TONE[r.status as keyof typeof RUN_TONE] ?? 'neutral'}>{r.status}</Badge>
              </button>
              {open === r.id && <RunEvents runId={r.run_id} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted" data-testid="runs-empty">本案暂无运行记录</p>
      )}
    </div>
  )
}

function RunEvents({ runId }: { runId: string }) {
  const events = useQuery({ queryKey: workbenchKeys.runEvents(runId), queryFn: ({ signal }) => workbenchApi.runEvents(runId, signal) })
  if (events.isLoading) return <p className="px-2 pb-2 text-xs text-fg-muted">加载事件…</p>
  if (events.isError) return <p className="px-2 pb-2 text-xs text-danger-fg" role="alert">事件加载失败</p>
  const list = events.data ?? []
  if (!list.length) return <p className="px-2 pb-2 text-xs text-fg-muted">无事件</p>
  return (
    <ul className="grid gap-1 border-t border-border px-2 py-2" data-testid={`run-events-${runId}`}>
      {list.map((e) => (
        <li key={e.id} className="text-xs text-fg-muted">
          <span className="font-mono">#{e.seq}</span> <span className="text-fg">{e.event_type}</span>
        </li>
      ))}
    </ul>
  )
}
