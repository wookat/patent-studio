import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { usePlatformCases } from '@/lib/platform'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { PlatformCase, Proposal } from '@/workbench/types'
import { ApprovalsView, ErrorPanel } from '@/components/workbench/WorkbenchPage'

function LoadingPanel() {
  return <div className="flex min-h-48 items-center justify-center text-fg-muted" role="status"><LoaderCircle className="mr-2 size-5 animate-spin" />正在加载平台数据…</div>
}

/** M2：`#/inbox?tab=approvals` —— 审批收件箱（/api/v1/approvals），复用 workbench 的 ApprovalsView。 */
export function ApprovalsInbox() {
  const approvals = useQuery({ queryKey: workbenchKeys.approvals(), queryFn: ({ signal }) => workbenchApi.approvals(signal) })
  if (approvals.isError) return <div className="p-4"><ErrorPanel error={approvals.error} onRetry={() => void approvals.refetch()} /></div>
  return <ApprovalsView approvals={approvals} />
}

interface ProposalRow {
  proposal: Proposal
  caseItem: PlatformCase
}

/** 跨案提案聚合：一案一个 GET /api/v1/cases/{id}/proposals（后端暂无跨案端点，前端聚合）。 */
function useAllProposals(cases: PlatformCase[] | undefined) {
  return useQuery({
    queryKey: [...workbenchKeys.all, 'proposals-inbox'] as const,
    enabled: !!cases,
    queryFn: async ({ signal }) => {
      const perCase = await Promise.all((cases ?? []).map((c) => workbenchApi.proposals(c.id, signal)))
      return perCase.flatMap((ps, i) => ps.map((p): ProposalRow => ({ proposal: p, caseItem: cases![i] })))
    },
  })
}

/** M2：`#/inbox?tab=proposals` —— 全部可见案件的提案汇总，行内提交/采纳/拒绝。 */
export function ProposalsInbox() {
  const client = useQueryClient()
  const cases = usePlatformCases()
  const rows = useAllProposals(cases.data)
  const decide = useMutation({
    mutationFn: ({ row, decision }: { row: ProposalRow; decision: 'submit' | 'accept' | 'reject' }) =>
      workbenchApi.decideProposal(row.proposal.id, decision),
    onSuccess: (_d, v) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.proposals(v.row.caseItem.id) })
      void client.invalidateQueries({ queryKey: [...workbenchKeys.all, 'proposals-inbox'] })
      void client.invalidateQueries({ queryKey: workbenchKeys.documents(v.row.caseItem.id) })
    },
  })

  const grouped = useMemo(() => {
    const out = new Map<string, { caseItem: PlatformCase; rows: ProposalRow[] }>()
    for (const r of rows.data ?? []) {
      const g = out.get(r.caseItem.id) ?? { caseItem: r.caseItem, rows: [] }
      g.rows.push(r)
      out.set(r.caseItem.id, g)
    }
    return [...out.values()]
  }, [rows.data])

  if (cases.isError) return <div className="p-4"><ErrorPanel error={cases.error} onRetry={() => void cases.refetch()} /></div>
  if (cases.isLoading || rows.isLoading) return <LoadingPanel />
  if (rows.isError) return <div className="p-4"><ErrorPanel error={rows.error} onRetry={() => void rows.refetch()} /></div>
  if (grouped.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="暂无提案"
        reason="Agent 或协作者对文稿、附图的修改提案会按案件汇总在这里。"
        data-testid="inbox-proposals-empty"
      />
    )
  }
  return (
    <div className="divide-y divide-border" data-testid="inbox-proposals">
      {grouped.map(({ caseItem, rows: rs }) => (
        <section key={caseItem.id} className="px-page-x py-3" data-testid={`inbox-proposals-${caseItem.id}`}>
          <h3 className="mb-1 text-sm font-medium text-fg-muted">
            {caseItem.case_key} · {caseItem.title}
          </h3>
          <ul className="divide-y divide-border">
            {rs.map((r) => (
              <li key={r.proposal.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`inbox-proposal-${r.proposal.id}`}>
                <div>
                  <div className="font-medium text-fg-strong">{r.proposal.target_kind === 'document' ? '文稿提案' : '附图提案'}</div>
                  <div className="text-xs text-fg-muted">{r.proposal.id.slice(0, 8)} · {r.proposal.status}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge tone={r.proposal.status === 'accepted' ? 'ok' : r.proposal.status === 'rejected' ? 'neutral' : 'info'}>{r.proposal.status}</Badge>
                  {r.proposal.status === 'draft' && (
                    <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ row: r, decision: 'submit' })}>提交</Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={r.proposal.status !== 'submitted' || decide.isPending} onClick={() => decide.mutate({ row: r, decision: 'accept' })}>采纳</Button>
                  <Button size="sm" variant="ghost" disabled={r.proposal.status !== 'submitted' || decide.isPending} onClick={() => decide.mutate({ row: r, decision: 'reject' })}>拒绝</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
