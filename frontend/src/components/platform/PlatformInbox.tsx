import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import { proposalStatusText, proposalStatusTone } from '@/workbench/labels'
import type { ProposalInboxItem } from '@/workbench/types'
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

const INBOX_PAGE = 20

/**
 * M2 / 阶段6收口：`#/inbox?tab=proposals` —— 跨案提案收件箱，单个服务端分页查询
 * GET /api/v1/proposals（items 随附 case 元数据，前端零逐案回拉）。按「本页」案件分组；
 * status/q 服务端先于分页过滤；total 缩小后越界页自动回退最后有效页。
 */
export function ProposalsInbox() {
  const client = useQueryClient()
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const decide = useMutation({
    mutationFn: ({ item, decision }: { item: ProposalInboxItem; decision: 'submit' | 'accept' | 'reject' }) =>
      workbenchApi.decideProposal(item.id, decision),
    onSuccess: (_d, v) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.proposals(v.item.case.id) })
      void client.invalidateQueries({ queryKey: workbenchKeys.proposalsInbox() })
      void client.invalidateQueries({ queryKey: workbenchKeys.documents(v.item.case.id) })
    },
  })

  const q = search.trim()
  const filterKey = `${status}|${q}`
  const lastFilter = useRef(filterKey)
  const rows = useQuery({
    queryKey: workbenchKeys.proposalsPage({ limit: INBOX_PAGE, offset: page * INBOX_PAGE, status, q }),
    queryFn: ({ signal }) =>
      workbenchApi.proposalsPage(
        { limit: INBOX_PAGE, offset: page * INBOX_PAGE, status: status || undefined, q: q || undefined },
        signal,
      ),
    retry: false,
    placeholderData: lastFilter.current === filterKey ? (prev) => prev : undefined,
  })
  const d = rows.data
  const total = d?.total ?? 0
  const lastPage = Math.max(0, Math.ceil(total / INBOX_PAGE) - 1)
  useEffect(() => {
    lastFilter.current = filterKey
    // mutation/权限变化缩小 total 后自动回退有效页，避免空页漏看记录
    if (d && page > lastPage) setPage(lastPage)
  }, [d, filterKey, lastPage, page])
  const pages = Math.max(1, Math.ceil(total / INBOX_PAGE))

  // 仅按本页案件分组——分页不代表全部案件，组头标明「本页」
  const grouped = useMemo(() => {
    const out = new Map<string, { caseItem: ProposalInboxItem['case']; items: ProposalInboxItem[] }>()
    for (const item of d?.items ?? []) {
      const g = out.get(item.case.id) ?? { caseItem: item.case, items: [] }
      g.items.push(item)
      out.set(item.case.id, g)
    }
    return [...out.values()]
  }, [d])

  if (rows.isError) return <div className="p-4"><ErrorPanel error={rows.error} onRetry={() => void rows.refetch()} /></div>
  return (
    <div data-testid="inbox-proposals">
      <div className="flex flex-wrap items-center gap-2 px-page-x pt-3">
        <label className="sr-only" htmlFor="inbox-proposals-search">搜索提案</label>
        <Input
          id="inbox-proposals-search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          placeholder="搜索案件号或案件标题"
          className="max-w-sm"
          data-testid="inbox-proposals-search"
        />
        <select
          aria-label="提案状态"
          className="h-md-control rounded-md border border-border-strong bg-panel px-2 text-sm"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0) }}
        >
          <option value="">全部状态</option><option value="draft">草稿</option><option value="submitted">待决</option>
          <option value="accepted">已采纳</option><option value="rejected">已拒绝</option><option value="superseded">已取代</option>
        </select>
        <span className="text-sm text-fg-muted" data-testid="inbox-proposals-total">共 {total} 条</span>
      </div>
      {rows.isPlaceholderData && (
        <div className="px-page-x pt-2 inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status" data-testid="inbox-updating">
          <LoaderCircle className="size-3.5 animate-spin" />正在更新…
        </div>
      )}
      {rows.isLoading ? (
        <LoadingPanel />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={filterKey === '|' ? '暂无提案' : '没有匹配的提案'}
          reason={filterKey === '|' ? 'Agent 或协作者对文稿、附图的修改提案会按案件汇总在这里。' : '调整筛选条件后重试。'}
          data-testid="inbox-proposals-empty"
        />
      ) : (
        <div className="divide-y divide-border">
          {grouped.map(({ caseItem, items }) => (
            <section key={caseItem.id} className="px-page-x py-3" data-testid={`inbox-proposals-${caseItem.id}`}>
              <h3 className="mb-1 text-sm font-medium text-fg-muted">
                {caseItem.case_key} · {caseItem.title}<span className="ml-1 text-xs">（本页）</span>
              </h3>
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`inbox-proposal-${item.id}`}>
                    <div>
                      <div className="font-medium text-fg-strong">{item.target_kind === 'document' ? '文稿提案' : item.target_kind === 'figure' ? '附图提案' : '未知类型'}</div>
                      <div className="text-xs text-fg-muted">{item.id.slice(0, 8)} · {proposalStatusText(item.status)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge tone={proposalStatusTone(item.status)}>{proposalStatusText(item.status)}</Badge>
                      {item.status === 'draft' && (
                        <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ item, decision: 'submit' })}>提交</Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={item.status !== 'submitted' || decide.isPending} onClick={() => decide.mutate({ item, decision: 'accept' })}>采纳</Button>
                      <Button size="sm" variant="ghost" disabled={item.status !== 'submitted' || decide.isPending} onClick={() => decide.mutate({ item, decision: 'reject' })}>拒绝</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-page-x py-2" data-testid="inbox-pager">
        <Button variant="secondary" size="sm" disabled={page === 0 || rows.isFetching} onClick={() => setPage((p) => p - 1)}>上一页</Button>
        <span className="text-sm text-fg-muted">第 {Math.min(page + 1, pages)} / {pages} 页</span>
        <Button variant="secondary" size="sm" disabled={page + 1 >= pages || rows.isFetching} onClick={() => setPage((p) => p + 1)}>下一页</Button>
      </div>
    </div>
  )
}
