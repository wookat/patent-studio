import { useState } from 'react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BookMarked, BriefcaseBusiness, FolderPlus, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { queryClient } from '@/lib/query'
import { projectHash } from '@/lib/hash'
import { KIND_LABEL } from '@/types/case'
import { workbenchApi } from '@/workbench/api'
import { workbenchKeys } from '@/workbench/queries'
import type { PlatformCase } from '@/workbench/types'
import { ErrorPanel, QueueView } from '@/components/workbench/WorkbenchPage'
import { CaseIntakeDialog } from './CaseIntakeDialog'

/**
 * B17 M6：dashboard「工作项」分段——平台工作队列并入案卷面板。
 * Z06/Z10：QueueView 按「我的待办 / 未分配 / 全部」聚合；Z11/Z12：机构管理者可登记新案并分派承办人。
 * 打开工作项 = 随附 case → case_key → `#/p/<case_key>`（case_key=目录名时直达旧工作台）；
 * Z29 收口：GET /work-items 逐项随附 case 元数据，案件列与 UUID→case_key 导航均由其派生，不再回拉全量 /cases。
 * 自带 QueryClientProvider——dashboard 测试裸挂载也能工作。
 */
export function PlatformQueue() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlatformQueueInner />
    </QueryClientProvider>
  )
}

function PlatformQueueInner() {
  const [intake, setIntake] = useState(false)
  const me = useQuery({ queryKey: workbenchKeys.me(), queryFn: ({ signal }) => workbenchApi.me(signal), retry: false })
  const items = useQuery({ queryKey: workbenchKeys.workItems(), queryFn: ({ signal }) => workbenchApi.workItems(signal), retry: false })
  const err = me.error ?? items.error
  if (err) return <div className="p-4"><ErrorPanel error={err} onRetry={() => { void me.refetch(); void items.refetch() }} /></div>
  if (me.isLoading || items.isLoading) {
    return <div className="flex min-h-48 items-center justify-center text-fg-muted" role="status"><LoaderCircle className="mr-2 size-5 animate-spin" />正在加载平台工作项…</div>
  }
  // 队列项随附 case：案件列展示与 UUID→case_key 打开均由此派生（同案多项去重）；case_key=目录名时直达旧工作台
  const caseById = new Map<string, PlatformCase>()
  for (const it of items.data ?? []) caseById.set(it.case.id, it.case)
  const open = (caseId: string, caseKey?: string) => {
    const pid = caseById.get(caseId)?.case_key ?? caseKey
    if (pid) window.location.hash = projectHash(pid)
  }
  return (
    <div className="p-4" data-testid="dashboard-platform-queue">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">聚合你可见的机构案件工作项；管理者可登记新案并分派承办人。</p>
        <Button size="sm" variant="secondary" onClick={() => setIntake(true)} data-testid="intake-open"><FolderPlus aria-hidden />登记新案</Button>
        <OrgMethodsLink />
      </div>
      <QueueView cases={[...caseById.values()]} items={items.data ?? []} onOpenCase={open} meId={me.data?.id ?? null} />
      <CaseLedger onOpenCase={open} />
      <CaseIntakeDialog open={intake} onClose={() => setIntake(false)} meId={me.data?.id ?? null} />
    </div>
  )
}

/** Z30：跳机构方法库（#/org/<id>/methods）；无机构成员身份时不渲染 */
function OrgMethodsLink() {
  const orgs = useQuery({ queryKey: workbenchKeys.organizations(), queryFn: ({ signal }) => workbenchApi.organizations(signal), retry: false })
  const first = orgs.data?.[0]
  if (!first) return null
  return (
    <Button size="sm" variant="ghost" onClick={() => { window.location.hash = `/org/${first.id}/methods` }} data-testid="methods-open">
      <BookMarked aria-hidden />方法库
    </Button>
  )
}

const LEDGER_PAGE = 20
// 台账行 kind/status 以中文标签展示（与筛选下拉同一口径）；未知枚举不外露原值，显「未知类型/状态」
const LEDGER_KIND_TEXT: Partial<Record<string, string>> = KIND_LABEL
const LEDGER_STATUS: { value: string; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'intake', label: '登记' },
  { value: 'drafting', label: '撰写中' },
  { value: 'review', label: '内部审' },
  { value: 'client_review', label: '客户审' },
  { value: 'final', label: '定稿' },
  { value: 'filed', label: '已递交' },
  { value: 'oa', label: 'OA 答复' },
  { value: 'granted', label: '授权' },
  { value: 'rejected', label: '驳回' },
  { value: 'closed', label: '已结案' },
]
const LEDGER_STATUS_TEXT: ReadonlyMap<string, string> = new Map(
  LEDGER_STATUS.filter((o) => o.value).map((o) => [o.value, o.label]),
)

/** Z29 规模化台账：/api/v1/cases/page 服务端分页 + 稳定排序 + 筛选；不再本地拉全库翻页。 */
function CaseLedger({ onOpenCase }: { onOpenCase: (id: string, caseKey?: string) => void }) {
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const query = useQuery({
    queryKey: workbenchKeys.casesPage({ limit: LEDGER_PAGE, offset: page * LEDGER_PAGE, q, status }),
    queryFn: ({ signal }) =>
      workbenchApi.casesPage({ limit: LEDGER_PAGE, offset: page * LEDGER_PAGE, q, status: status || undefined }, signal),
    retry: false,
    placeholderData: (prev) => prev,
  })
  if (query.isError) return <div className="mt-4"><ErrorPanel error={query.error} onRetry={() => void query.refetch()} /></div>
  const d = query.data
  const total = d?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / LEDGER_PAGE))
  return (
    <section className="mt-6" aria-labelledby="ledger-title" data-testid="case-ledger">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 id="ledger-title" className="text-sm font-medium text-fg-strong">案件台账</h3>
        <label className="sr-only" htmlFor="ledger-q">检索案件号或标题</label>
        <Input id="ledger-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="案件号前缀 / 标题" className="max-w-xs" />
        <select aria-label="案件状态" className="h-md-control rounded-md border border-border-strong bg-panel px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          {LEDGER_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-sm text-fg-muted" data-testid="ledger-total">共 {total} 案</span>
      </div>
      {query.isLoading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-fg-muted" role="status"><LoaderCircle className="mr-2 size-4 animate-spin" />正在加载案件台账…</div>
      ) : (d?.items.length ?? 0) === 0 ? (
        <EmptyState size="sm" icon={BriefcaseBusiness} title="没有匹配的案件" reason="调整案件号/标题或状态筛选。" data-testid="ledger-empty" />
      ) : (
        <>
          {/* 窄屏：表宽保底 min-w-2xl → 容器内横向滑动，页面本身不横向溢出；标题列为唯一可折行列 */}
          <p className="mb-1 text-xs text-fg-muted lg:hidden" data-testid="ledger-scroll-hint">横向滑动查看完整表格</p>
          <Table className="min-w-2xl">
            <TableHeader><TableRow><TableHead className="whitespace-nowrap">案件号</TableHead><TableHead>标题</TableHead><TableHead className="whitespace-nowrap">类型</TableHead><TableHead className="whitespace-nowrap">状态</TableHead><TableHead className="w-24 whitespace-nowrap">操作</TableHead></TableRow></TableHeader>
            <TableBody>{d!.items.map((c) => (
              <TableRow key={c.id} data-testid={`ledger-case-${c.id}`}>
                <TableCell className="whitespace-nowrap font-medium text-fg-strong">{c.case_key}</TableCell>
                <TableCell className="text-fg-muted">{c.title}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-muted">{LEDGER_KIND_TEXT[c.kind] ?? '未知类型'}</TableCell>
                <TableCell className="whitespace-nowrap"><Badge tone="info">{LEDGER_STATUS_TEXT.get(c.status) ?? '未知状态'}</Badge></TableCell>
                <TableCell className="whitespace-nowrap"><Button variant="ghost" size="sm" onClick={() => onOpenCase(c.id, c.case_key)} data-testid={`ledger-open-${c.id}`}>打开</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </>
      )}
      <div className="mt-2 flex items-center gap-2" data-testid="ledger-pager">
        <Button variant="secondary" size="sm" disabled={page === 0 || query.isFetching} onClick={() => setPage((p) => p - 1)}>上一页</Button>
        <span className="text-sm text-fg-muted">第 {Math.min(page + 1, pages)} / {pages} 页</span>
        <Button variant="secondary" size="sm" disabled={page + 1 >= pages || query.isFetching} onClick={() => setPage((p) => p + 1)}>下一页</Button>
      </div>
    </section>
  )
}
