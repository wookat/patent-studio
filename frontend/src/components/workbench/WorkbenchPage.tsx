import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, Bell, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleX, ClipboardCopy, Download, FileText, Image, Inbox, Info, LoaderCircle, Package, ShieldAlert, Stethoscope, Upload, UserPlus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/net'
import { editorHash } from '@/lib/hash'
import { BOOK_LABELS } from '@/lib/docset'
import type { Severity } from '@/lib/types'
import { RULE_LABEL, groupByRule } from '@/components/preflight/preflightUtils'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { touchHit } from '@/lib/utils'
import { useWorkbenchMutations, useWorkbenchQueries, workbenchKeys } from '@/workbench/queries'
import { workbenchApi } from '@/workbench/api'
import { workItemStatusText, workItemStatusTone, workItemTypeText } from '@/workbench/labels'
import type { Book, Document, Figure, InvitationRole, ParticipantRole, PlatformCase, Release, Revision, WorkItemQueueItem, WorkItemStatus } from '@/workbench/types'
import { WorkingCopyEditor } from './WorkingCopyEditor'

type View = 'queue' | 'case' | 'approvals' | 'notifications'

const readWorkbenchQuery = () => {
  const raw = window.location.hash.split('?')[1]
  const params = new URLSearchParams(raw)
  return { caseId: params.get('case'), view: (params.get('view') as View | null) ?? 'queue' }
}

const BOOK_LABEL: Record<Book, string> = { abstract: '摘要', claims: '权利要求书', description: '说明书' }
const PARTICIPANT_ROLES: ParticipantRole[] = ['client', 'inventor', 'applicant', 'author', 'attorney', 'drafter', 'reviewer', 'case_manager', 'agent', 'observer']
const ORG_ROLES: InvitationRole[] = ['admin', 'member']

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0
  const kind = error instanceof ApiError ? error.detail?.kind : null
  if (status === 401) {
    return <EmptyState icon={ShieldAlert} title="需要登录" reason="需要登录会话；登录后才能读取案件、工作项和审批。" action={<Button asChild variant="secondary"><a href="#/login">去登录</a></Button>} data-testid="workbench-auth-error" />
  }
  if (status === 403) {
    return <EmptyState icon={ShieldAlert} title="没有访问权限" reason={error instanceof Error ? error.message : '当前账号不在该机构或案件的可见范围内。'} action={onRetry && <Button variant="secondary" onClick={onRetry}>重试</Button>} data-testid="workbench-forbidden" />
  }
  if (status === 404) {
    return <EmptyState icon={AlertCircle} title="资源不存在" reason="案件、工作项或记录可能已被移除。" action={onRetry && <Button variant="secondary" onClick={onRetry}>刷新</Button>} data-testid="workbench-not-found" />
  }
  if (status === 409) {
    const reasons = error instanceof ApiError && Array.isArray(error.detail?.detail) ? error.detail.detail as string[] : []
    return <EmptyState icon={AlertCircle} title={kind === 'submission_barrier' ? '提交被阻断' : '操作冲突'} reason={reasons.length ? reasons.join('；') : (error instanceof Error ? error.message : '服务端拒绝了本次写入，请刷新后重试。')} action={onRetry && <Button variant="secondary" onClick={onRetry}>刷新后重试</Button>} data-testid="workbench-conflict" />
  }
  return <EmptyState icon={AlertCircle} title="工作台暂时不可用" reason={error instanceof Error ? error.message : '服务端没有返回可用数据。'} action={onRetry && <Button variant="secondary" onClick={onRetry}>重试</Button>} data-testid="workbench-error" />
}

export function FieldError({ error }: { error: unknown }) {
  if (!error) return null
  const status = error instanceof ApiError ? error.status : 0
  const text = status === 401 ? '需要登录后才能执行此操作'
    : status === 403 ? (error instanceof Error ? error.message : '没有权限执行此操作')
    : status === 404 ? '目标记录不存在或已被移除'
    : status === 409 ? (error instanceof Error ? error.message : '操作冲突，请刷新后重试')
    : error instanceof Error ? error.message : '操作失败，请稍后重试'
  return <p className="mt-2 text-sm text-danger-fg" role="alert">{text}</p>
}

function LoadingPanel() {
  return <div className="flex min-h-48 items-center justify-center text-fg-muted" role="status"><LoaderCircle className="mr-2 size-5 animate-spin" />正在加载平台数据…</div>
}

/** Z06/Z10 待办范围：mine = 分派给我（代理人/作者/承办人）；unassigned = 未分配（机构管理者视角）；all = 全部可见 */
type QueueScope = 'mine' | 'unassigned' | 'all'
const QUEUE_SCOPE_OPTIONS = [
  { value: 'mine' as QueueScope, label: '我的待办', 'data-testid': 'queue-scope-mine' },
  { value: 'unassigned' as QueueScope, label: '未分配', 'data-testid': 'queue-scope-unassigned' },
  { value: 'all' as QueueScope, label: '全部', 'data-testid': 'queue-scope-all' },
]

const SCOPE_EMPTY: Record<QueueScope, { title: string; reason: string }> = {
  mine: { title: '没有分派给你的待办', reason: '机构管理者分派给你的工作项会出现在这里；切换「全部」可看机构内所有工作项。' },
  unassigned: { title: '没有未分配的工作项', reason: '所有工作项都已有承办人。登记新案或创建工作项时可指定承办人。' },
  all: { title: '暂无待办', reason: '你可见的机构案件还没有工作项；机构管理者可在「工作项」页登记新案并分派。' },
}

const QUEUE_PAGE = 20

/** 行/卡共用单元：承办人徽标与期限文本（含逾期态），口径桌面移动一致。 */
function AssigneeCell({ item, meId }: { item: WorkItemQueueItem; meId: string | null }) {
  const mine = item.assignee_principal_id != null && item.assignee_principal_id === meId
  if (item.assignee_principal_id == null) return <Badge tone="warn">未分配</Badge>
  return <span className="text-sm text-fg-muted">{mine ? '我' : `${item.assignee_principal_id?.slice(0, 8)}…`}</span>
}

function DeadlineText({ item, now }: { item: WorkItemQueueItem; now: number }) {
  const overdue = item.deadline ? new Date(item.deadline).getTime() < now && item.status !== 'done' && item.status !== 'canceled' : false
  return (
    <span className={overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'}>
      {item.deadline ? new Date(item.deadline).toLocaleDateString('zh-CN') : '—'}
      {overdue && <span className="ml-1 text-xs">逾期</span>}
    </span>
  )
}

/**
 * Z06/Z10 平台工作队列。阶段6：服务端分页 + 筛选（scope→assignee=me|none、状态、q 先
 * 于分页）；case 元数据随响应而来，不再回拉 /cases。桌面表格 / <lg 卡片，枚举一律走
 * WORK_ITEM_TYPE_TEXT/WORK_ITEM_STATUS_TEXT 中文映射。
 */
export function QueueView({ onOpenCase, meId }: { onOpenCase: (id: string, caseKey?: string) => void; meId: string | null }) {
  const [status, setStatus] = useState<'all' | WorkItemStatus>('all')
  const [scope, setScope] = useState<QueueScope>('mine')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [now] = useState(() => Date.now())
  const { setWorkItemStatus } = useWorkbenchMutations()
  const params = {
    limit: QUEUE_PAGE,
    offset: page * QUEUE_PAGE,
    status: status === 'all' ? '' : status,
    q: search.trim(),
    assignee: scope === 'mine' ? 'me' : scope === 'unassigned' ? 'none' : '',
  }
  /* 阶段6收口：placeholderData 用 previousQuery 的实际 queryKey 判定——比较筛选参数
   * （status/q/assignee，忽略 offset/limit），只有同筛选翻页或失效重取才保留旧页；
   * 跨筛选一律无 placeholder，旧筛选的行不会在新筛选下残留。 */
  const query = useQuery({
    queryKey: workbenchKeys.workItemsPage(params),
    queryFn: ({ signal }) =>
      workbenchApi.workItems(
        {
          limit: params.limit,
          offset: params.offset,
          status: params.status || undefined,
          q: params.q || undefined,
          assignee: (params.assignee || undefined) as 'me' | 'none' | undefined,
        },
        signal,
      ),
    retry: false,
    placeholderData: (prev, prevQuery) => {
      const p = prevQuery?.queryKey.at(-1) as { status: string; q: string; assignee: string } | undefined
      return p && p.status === params.status && p.q === params.q && p.assignee === params.assignee ? prev : undefined
    },
  })
  const d = query.data
  const total = d?.total ?? 0
  const lastPage = Math.max(0, Math.ceil(total / QUEUE_PAGE) - 1)
  useEffect(() => {
    /* mutation/权限变化使 total 缩小后，当前 offset 可能越出末页——自动回退最后有效页，
     * 否则用户看到空页并误以为没有记录。 */
    if (d && page > lastPage) setPage(lastPage)
  }, [d, lastPage, page])
  if (query.isError) return <div className="mt-4"><ErrorPanel error={query.error} onRetry={() => void query.refetch()} /></div>
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE))
  const filtered = Boolean(params.q) || status !== 'all'
  const empty = !filtered ? SCOPE_EMPTY[scope] : { title: '没有匹配的工作项', reason: '调整筛选条件，或从案件空间创建新的工作项。' }
  const openItem = (item: WorkItemQueueItem) => onOpenCase(item.case_id, item.case.case_key)
  return (
    <section aria-labelledby="queue-title" data-testid="workbench-queue">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented aria-label="待办范围" size="sm" options={QUEUE_SCOPE_OPTIONS} value={scope} onValueChange={(v) => { setScope(v); setPage(0) }} />
        <label className="sr-only" htmlFor="queue-search">搜索工作项</label>
        <Input id="queue-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="搜索工作项或案件号" className="max-w-sm" />
        <select aria-label="工作项状态" className="h-md-control rounded-md border border-border-strong bg-panel px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0) }}>
          <option value="all">全部状态</option><option value="open">待处理</option><option value="in_progress">进行中</option><option value="blocked">已阻塞</option><option value="in_review">待复核</option><option value="done">已完成</option><option value="canceled">已取消</option>
        </select>
        <span className="text-sm text-fg-muted" data-testid="queue-total">共 {total} 项</span>
      </div>
      {query.isPlaceholderData && (
        <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status" data-testid="queue-updating">
          <LoaderCircle className="size-3.5 animate-spin" />正在更新…
        </div>
      )}
      {query.isLoading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-fg-muted" role="status"><LoaderCircle className="mr-2 size-4 animate-spin" />正在加载工作项…</div>
      ) : (d?.items.length ?? 0) === 0 ? (
        <EmptyState size="sm" icon={BriefcaseBusiness} title={empty.title} reason={empty.reason} data-testid="queue-empty" />
      ) : (
        <>
          {/* 桌面表：<lg 隐藏；手机卡片列：lg 隐藏。同一页数据两种形态，枚举中文映射一致。 */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader><TableRow><TableHead>工作项</TableHead><TableHead>案件</TableHead><TableHead>承办人</TableHead><TableHead>状态</TableHead><TableHead>期限</TableHead><TableHead className="w-28">操作</TableHead></TableRow></TableHeader>
              <TableBody>{d!.items.map((item) => {
                const mine = item.assignee_principal_id != null && item.assignee_principal_id === meId
                return <TableRow key={item.id} data-testid={`work-item-${item.id}`}>
                  <TableCell><div className="font-medium text-fg-strong">{item.title}</div><div className="text-xs text-fg-muted">{workItemTypeText(item.type)}</div></TableCell>
                  <TableCell><button className="text-left text-link hover:underline" onClick={() => openItem(item)}>{item.case.case_key}<span className="ml-1 text-fg-muted">{item.case.title}</span></button></TableCell>
                  <TableCell><AssigneeCell item={item} meId={meId} /></TableCell>
                  <TableCell><Badge tone={workItemStatusTone(item.status)}>{workItemStatusText(item.status)}</Badge></TableCell>
                  <TableCell><DeadlineText item={item} now={now} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {mine && item.status === 'open' && <Button variant="secondary" size="sm" disabled={setWorkItemStatus.isPending} onClick={() => setWorkItemStatus.mutate({ workItemId: item.id, status: 'in_progress' })} data-testid={`work-item-start-${item.id}`}>开始处理</Button>}
                      <Button variant="ghost" size="sm" onClick={() => openItem(item)} data-testid={`work-item-open-${item.id}`}>打开</Button>
                    </div>
                  </TableCell>
                </TableRow>
              })}</TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 lg:hidden" data-testid="work-item-cards">
            {d!.items.map((item) => {
              const mine = item.assignee_principal_id != null && item.assignee_principal_id === meId
              return (
                <li key={item.id} className="rounded-lg border border-border bg-panel p-3" data-testid={`work-item-card-${item.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-medium text-fg-strong">{item.title}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">{workItemTypeText(item.type)}</div>
                    </div>
                    <Badge tone={workItemStatusTone(item.status)}>{workItemStatusText(item.status)}</Badge>
                  </div>
                  <button type="button" className="mt-1.5 block w-full break-words text-left text-sm text-link hover:underline" onClick={() => openItem(item)}>
                    {item.case.case_key}<span className="ml-1 text-fg-muted">{item.case.title}</span>
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1"><span className="text-fg-muted">承办人</span><AssigneeCell item={item} meId={meId} /></span>
                    <span className="inline-flex items-center gap-1"><span className="text-fg-muted">期限</span><DeadlineText item={item} now={now} /></span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {mine && item.status === 'open' && <Button variant="secondary" size="lg" className={touchHit} disabled={setWorkItemStatus.isPending} onClick={() => setWorkItemStatus.mutate({ workItemId: item.id, status: 'in_progress' })} data-testid={`work-item-card-start-${item.id}`}>开始处理</Button>}
                    <Button variant="secondary" size="lg" className={touchHit} onClick={() => openItem(item)} data-testid={`work-item-card-open-${item.id}`}>打开</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="mt-2 flex items-center gap-2" data-testid="queue-pager">
        <Button variant="secondary" size="sm" disabled={page === 0 || query.isFetching} onClick={() => setPage((p) => p - 1)}>上一页</Button>
        <span className="text-sm text-fg-muted">第 {Math.min(page + 1, pages)} / {pages} 页</span>
        <Button variant="secondary" size="sm" disabled={page + 1 >= pages || query.isFetching} onClick={() => setPage((p) => p + 1)}>下一页</Button>
      </div>
      <FieldError error={setWorkItemStatus.error} />
    </section>
  )
}

export function RevisionsPanel({ documentId }: { documentId: string }) {
  const revisions = useQuery({
    queryKey: workbenchKeys.revisions(documentId),
    queryFn: ({ signal }) => workbenchApi.revisions(documentId, signal),
  })
  if (revisions.isLoading) return <p className="py-3 text-sm text-fg-muted">加载修订历史…</p>
  if (revisions.isError) return <FieldError error={revisions.error} />
  const rows = (revisions.data ?? []).slice().sort((a, b) => b.revision_no - a.revision_no)
  if (!rows.length) return <p className="py-3 text-sm text-fg-muted">尚无修订版本。</p>
  return (
    <ul className="divide-y divide-border" data-testid={`revisions-${documentId}`}>
      {rows.map((rev: Revision) => (
        <li key={rev.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="font-medium text-fg-strong">R{rev.revision_no}</span>
          <span className="text-fg-muted">{rev.source}</span>
          <span className="font-mono text-xs text-fg-muted">{rev.content_ref.sha256.slice(0, 12)}</span>
        </li>
      ))}
    </ul>
  )
}

export function DocumentsPanel({ caseItem, documents }: { caseItem: PlatformCase; documents: Document[] | undefined }) {
  const [editing, setEditing] = useState<string | null>(null)
  const { createDocument } = useWorkbenchMutations()
  const present = new Set((documents ?? []).map((doc) => doc.book))
  const missing = (Object.keys(BOOK_LABEL) as Book[]).filter((book) => !present.has(book))
  return (
    <div className="grid gap-3" data-testid="workbench-documents">
      <div className="flex flex-wrap items-center gap-2">
        {missing.map((book) => (
          <Button key={book} size="xs" variant="secondary" loading={createDocument.isPending} onClick={() => createDocument.mutate({ caseId: caseItem.id, book })}>新建{BOOK_LABEL[book]}</Button>
        ))}
      </div>
      <FieldError error={createDocument.error} />
      {(documents ?? []).map((doc) => (
        <article key={doc.id} className="rounded-lg border border-border bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="font-medium text-fg-strong">{BOOK_LABEL[doc.book] ?? doc.book}</div><div className="text-xs text-fg-muted">当前 revision：{doc.current_revision_id ?? '尚未建立'}</div></div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="secondary"><a href={`#${editorHash(caseItem.id, doc.id)}`} data-testid={`open-doc-${doc.id}`}><FileText aria-hidden />打开文稿</a></Button>
              <Button size="sm" variant={editing === doc.id ? 'secondary' : 'soft'} onClick={() => setEditing(editing === doc.id ? null : doc.id)}>{editing === doc.id ? '收起' : '编辑 / 历史'}</Button>
            </div>
          </div>
          {editing === doc.id && <div className="mt-3 grid gap-3"><WorkingCopyEditor document={doc} /><RevisionsPanel documentId={doc.id} /></div>}
        </article>
      ))}
      {documents && documents.length === 0 && <EmptyState size="sm" icon={FileText} title="尚无文稿" reason="用上方按钮建立摘要 / 权利要求书 / 说明书。" />}
    </div>
  )
}

export function ProposalsPanel({ caseId, proposals }: { caseId: string; proposals: ReturnType<typeof useWorkbenchQueries>['proposals'] }) {
  const { decideProposal } = useWorkbenchMutations()
  return (
    <div data-testid="workbench-proposals">
      {proposals.isLoading ? <LoadingPanel /> : proposals.isError ? <FieldError error={proposals.error} /> : proposals.data?.length ? (
        <ul className="divide-y divide-border">{proposals.data.map((proposal) => (
          <li key={proposal.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`proposal-${proposal.id}`}>
            <div>
              <div className="font-medium text-fg-strong">{proposal.target_kind === 'document' ? '文稿提案' : '附图提案'}</div>
              <div className="text-xs text-fg-muted">{proposal.id.slice(0, 8)} · {proposal.status}{proposal.accepted_document_revision_id ? ` · 已采纳 ${proposal.accepted_document_revision_id.slice(0, 8)}` : ''}</div>
            </div>
            <div className="flex gap-1">
              {proposal.status === 'draft' && <Button size="sm" variant="secondary" disabled={decideProposal.isPending} onClick={() => decideProposal.mutate({ proposalId: proposal.id, decision: 'submit', caseId })}>提交</Button>}
              <Button size="sm" variant="secondary" disabled={proposal.status !== 'submitted' || decideProposal.isPending} onClick={() => decideProposal.mutate({ proposalId: proposal.id, decision: 'accept', caseId })}>采纳</Button>
              <Button size="sm" variant="ghost" disabled={proposal.status !== 'submitted' || decideProposal.isPending} onClick={() => decideProposal.mutate({ proposalId: proposal.id, decision: 'reject', caseId })}>拒绝</Button>
            </div>
          </li>
        ))}</ul>
      ) : <EmptyState size="sm" icon={CheckCircle2} title="暂无提案" reason="Agent 或协作者提交的草稿提案会出现在这里。" />}
      <FieldError error={decideProposal.error} />
    </div>
  )
}

/** B13 附图面板：附图文档建立 + 图片上传（不可变 revision）+ 缩略预览 + 复制文稿引用文本。 */
export function FiguresPanel({ caseId, figures }: { caseId: string; figures: ReturnType<typeof useWorkbenchQueries>['figures'] }) {
  const { createFigure, uploadFigureImage } = useWorkbenchMutations()
  const [figNo, setFigNo] = useState('')
  const [figTitle, setFigTitle] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const submit = () => {
    const no = figNo.trim() ? Number(figNo) : null
    if (no !== null && (!Number.isInteger(no) || no < 1)) return
    createFigure.mutate({ caseId, figureNo: no, title: figTitle.trim() }, { onSuccess: () => { setFigNo(''); setFigTitle('') } })
  }
  const copyRef = (figure: Figure) => {
    if (!figure.figure_no) return
    void navigator.clipboard?.writeText(`图${figure.figure_no}`).then(() => {
      setCopied(figure.id)
      setTimeout(() => setCopied((v) => (v === figure.id ? null : v)), 1500)
    })
  }
  return (
    <div className="grid gap-3" data-testid="workbench-figures">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={figNo} onChange={(e) => setFigNo(e.target.value)} placeholder="图号（留空=摘要附图）" className="w-40" aria-label="附图图号" />
        <Input value={figTitle} onChange={(e) => setFigTitle(e.target.value)} placeholder="附图名称，如：方法流程图" className="min-w-48" aria-label="附图名称" />
        <Button size="sm" variant="secondary" loading={createFigure.isPending} onClick={submit}><Image aria-hidden />新建附图</Button>
      </div>
      <FieldError error={createFigure.error ?? uploadFigureImage.error} />
      {figures.isLoading ? <LoadingPanel /> : figures.isError ? <FieldError error={figures.error} /> : figures.data?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {figures.data.map((figure) => (
            <figure key={figure.id} className="rounded-md border border-border bg-sunken p-3 text-sm" data-testid={`figure-${figure.id}`}>
              {figure.current_revision_id ? (
                <img src={workbenchApi.figureContentUrl(figure)} alt={figure.title || `图 ${figure.figure_no}`} className="mb-2 h-28 w-full rounded-sm border border-border bg-panel object-contain" data-testid={`figure-img-${figure.id}`} />
              ) : (
                <div className="mb-2 flex h-28 items-center justify-center rounded-sm border border-dashed border-border-strong text-xs text-fg-muted">尚未上传图片</div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-fg-strong">{figure.figure_no ? `图 ${figure.figure_no}` : '摘要附图'}</div>
                  <div className="truncate text-xs text-fg-muted">{figure.title || '未命名附图'}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {figure.figure_no !== null && (
                    <Button size="xs" variant="ghost" title="复制文稿引用文本" onClick={() => copyRef(figure)}><ClipboardCopy aria-hidden />{copied === figure.id ? '已复制' : `图${figure.figure_no}`}</Button>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-link hover:underline" data-testid={`figure-upload-${figure.id}`}>
                    <Upload aria-hidden className="size-3" />{figure.current_revision_id ? '换图' : '上传'}
                    <input type="file" accept="image/*" className="sr-only" disabled={uploadFigureImage.isPending} onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadFigureImage.mutate({ figureId: figure.id, file, caseId })
                      e.target.value = ''
                    }} />
                  </label>
                </div>
              </div>
            </figure>
          ))}
        </div>
      ) : <EmptyState size="sm" icon={Image} title="暂无附图" reason="先建立附图再上传图片；图号附图对应说明书附图，空图号为摘要附图。" />}
    </div>
  )
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** B13 期限面板：case 工作项按期限排序 + 改期/清除（work_items.deadline/oa_deadline 承接旧期限台账）。 */
export function DeadlinesPanel({ caseId, items }: { caseId: string; items: ReturnType<typeof useWorkbenchQueries>['caseWorkItems'] }) {
  const { setWorkItemDeadline, setWorkItemStatus } = useWorkbenchMutations()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [now] = useState(() => Date.now())
  const rows = (items.data ?? []).slice().sort((a, b) => (a.deadline ?? '9999') < (b.deadline ?? '9999') ? -1 : 1)
  return (
    <div data-testid="workbench-deadlines">
      {items.isLoading ? <LoadingPanel /> : items.isError ? <FieldError error={items.error} /> : rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((item) => {
            const overdue = item.deadline ? new Date(item.deadline).getTime() < now && item.status !== 'done' && item.status !== 'canceled' : false
            const draft = drafts[item.id] ?? (item.deadline ? toLocalInput(item.deadline) : '')
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`deadline-${item.id}`}>
                <div className="min-w-0">
                  <div className="font-medium text-fg-strong">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                    <Badge tone="neutral">{workItemTypeText(item.type)}</Badge>
                    <Badge tone={workItemStatusTone(item.status)}>{workItemStatusText(item.status)}</Badge>
                    {item.oa_deadline && <span>OA 答复期限 {new Date(item.oa_deadline).toLocaleDateString('zh-CN')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={overdue ? 'text-sm font-medium text-danger-fg' : 'text-sm text-fg-muted'}>
                    {item.deadline ? new Date(item.deadline).toLocaleDateString('zh-CN') : '未设期限'}{overdue && ' · 逾期'}
                  </span>
                  <Input type="datetime-local" value={draft} aria-label={`期限：${item.title}`} className="w-44" onChange={(e) => setDrafts((v) => ({ ...v, [item.id]: e.target.value }))} />
                  <Button size="xs" variant="secondary" disabled={!draft || toLocalInput(item.deadline ?? '') === draft} loading={setWorkItemDeadline.isPending}
                    onClick={() => setWorkItemDeadline.mutate({ workItemId: item.id, deadline: new Date(draft).toISOString(), caseId }, { onSuccess: () => setDrafts((v) => ({ ...v, [item.id]: '' })) })}>改期</Button>
                  {item.deadline && <Button size="xs" variant="ghost" disabled={setWorkItemDeadline.isPending}
                    onClick={() => setWorkItemDeadline.mutate({ workItemId: item.id, deadline: null, caseId })}>清除</Button>}
                  {item.status !== 'done' && <Button size="xs" variant="ghost" disabled={setWorkItemStatus.isPending}
                    onClick={() => setWorkItemStatus.mutate({ workItemId: item.id, status: 'done' })}>完成</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      ) : <EmptyState size="sm" icon={CalendarClock} title="暂无工作项" reason="工作项的期限与 OA 答复期限会汇总到这里。" />}
      <FieldError error={setWorkItemDeadline.error ?? setWorkItemStatus.error} />
    </div>
  )
}

const SEVERITY_ICON: Record<Severity, ReactNode> = {
  error: <CircleX className="text-danger-fg" aria-hidden />,
  warning: <AlertTriangle className="text-warn-fg" aria-hidden />,
  info: <Info className="text-info" aria-hidden />,
}
const SEVERITY_TONE: Record<Severity, BadgeTone> = { error: 'danger', warning: 'warn', info: 'info' }

/** B13 体检面板：GET /cases/{id}/preflight → kernel preflight 报告（按规则分组，复用旧 RULE_LABEL/groupByRule）。 */
export function HealthPanel({ caseId }: { caseId: string }) {
  const report = useQuery({
    queryKey: workbenchKeys.preflight(caseId),
    queryFn: ({ signal }) => workbenchApi.preflight(caseId, signal),
  })
  return (
    <div data-testid="workbench-health">
      {report.isLoading ? <LoadingPanel /> : report.isError ? <FieldError error={report.error} /> : report.data ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="health-counts">
            {(['error', 'warning', 'info'] as const).map((sev) => (
              <Badge key={sev} tone={SEVERITY_TONE[sev]}>{{ error: '错误', warning: '警告', info: '提示' }[sev]} {report.data!.counts[sev] ?? 0}</Badge>
            ))}
            <Button size="xs" variant="ghost" onClick={() => void report.refetch()} disabled={report.isFetching}>重新体检</Button>
          </div>
          {report.data.items.length === 0 ? (
            <EmptyState size="sm" icon={Stethoscope} title="体检通过" reason="三书当前修订未触发任何 kernel 规则。" />
          ) : (
            <div className="grid gap-3">{groupByRule(report.data.items).map((group) => (
              <section key={group.rule} className="rounded-md border border-border bg-panel p-3" data-testid={`health-rule-${group.rule}`}>
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-fg-strong">{SEVERITY_ICON[group.severity]}{RULE_LABEL[group.rule] ?? group.rule}<span className="text-xs text-fg-muted">× {group.items.length}</span></div>
                <ul className="grid gap-1">
                  {group.items.map((item, i) => (
                    <li key={i} className="text-sm text-fg-muted">
                      {item.message}
                      <span className="ml-2 text-xs">{item.book ? BOOK_LABELS[item.book] : '全文'}{item.line ? ` · 第 ${item.line} 行` : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 单个发布行：组包项 + 产物懒加载（items 决定可封存，artifacts 决定可下载）。 */
function ReleaseRow({ release, caseId, documents, figures }: { release: Release; caseId: string; documents: Document[] | undefined; figures: Figure[] | undefined }) {
  const { addReleaseItem, sealRelease, buildRelease } = useWorkbenchMutations()
  const items = useQuery({ queryKey: workbenchKeys.releaseItems(release.id), queryFn: ({ signal }) => workbenchApi.releaseItems(release.id, signal) })
  const artifacts = useQuery({ queryKey: workbenchKeys.releaseArtifacts(release.id), queryFn: ({ signal }) => workbenchApi.releaseArtifacts(release.id, signal) })
  const packable = release.status !== 'sealed'
  const pack = async () => {
    const docItems = (documents ?? []).filter((doc) => doc.current_revision_id)
      .map((doc, i) => ({ item_kind: 'document' as const, revision_id: doc.current_revision_id!, ordinal: i + 1 }))
    const figItems = (figures ?? []).filter((fig) => fig.current_revision_id)
      .map((fig, i) => ({ item_kind: 'figure' as const, revision_id: fig.current_revision_id!, ordinal: docItems.length + i + 1 }))
    // mutateAsync 失败会进 mutation.error（FieldError 展示）——吃掉以免未处理 rejection 上 console。
    for (const item of [...docItems, ...figItems]) {
      try {
        await addReleaseItem.mutateAsync({ releaseId: release.id, item, caseId })
      } catch {
        return
      }
    }
  }
  return (
    <li className="py-3" data-testid={`release-${release.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-strong">发布 {release.id.slice(0, 8)}</span>
          <Badge tone={release.status === 'sealed' ? 'ok' : 'neutral'}>{release.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {packable && <Button size="xs" variant="secondary" loading={addReleaseItem.isPending} onClick={() => void pack()} data-testid={`pack-${release.id}`}>组包三书+附图</Button>}
          {packable && <Button size="xs" variant="secondary" loading={sealRelease.isPending} onClick={() => sealRelease.mutate({ releaseId: release.id, caseId })}>封存</Button>}
          {release.status === 'sealed' && (
            <>
              {release.sealed_at && (
                <span className="text-xs text-fg-muted" data-testid={`sealed-at-${release.id}`}>
                  冻结于 {new Date(release.sealed_at).toLocaleString('zh-CN', { hour12: false })}
                </span>
              )}
              <Button size="xs" variant="secondary" loading={buildRelease.isPending} onClick={() => buildRelease.mutate({ releaseId: release.id, caseId })} data-testid={`build-${release.id}`}>构建 DOCX</Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <span>{items.isLoading ? '组包项加载中…' : `组包项 ${items.data?.length ?? 0} 件`}</span>
        {release.status === 'sealed' &&
          (items.data ?? [])
            .filter((it) => it.content_sha256)
            .map((it) => (
              <span key={it.id} className="inline-flex items-center gap-1 font-mono" title={`内容指纹 sha256:${it.content_sha256}`} data-testid={`snapshot-${it.id}`}>
                {it.item_kind === 'document' ? '文档' : '附图'}·{(it.document_revision_id ?? it.figure_revision_id ?? '').slice(0, 8)}·{(it.content_sha256 ?? '').slice(0, 12)}
              </span>
            ))}
        {(artifacts.data ?? []).map((artifact) => (
          <a key={artifact.id} href={workbenchApi.artifactUrl(artifact.id)} download={artifact.filename} title={`sha256:${artifact.content_ref.sha256}`} className="inline-flex items-center gap-1 text-link hover:underline" data-testid={`artifact-${artifact.id}`}>
            <Download aria-hidden className="size-3" />{artifact.filename}
          </a>
        ))}
      </div>
      <FieldError error={addReleaseItem.error ?? sealRelease.error ?? buildRelease.error ?? items.error ?? artifacts.error} />
    </li>
  )
}

export function ReleasesPanel({ caseId, releases, documents, figures }: { caseId: string; releases: ReturnType<typeof useWorkbenchQueries>['releases']; documents: Document[] | undefined; figures: Figure[] | undefined }) {
  const { createRelease } = useWorkbenchMutations()
  return (
    <div data-testid="workbench-releases">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">流程：新建发布 → 组包三书与附图当前修订 → 封存 → 构建 DOCX 下载递交包。</p>
        <Button size="xs" variant="secondary" loading={createRelease.isPending} onClick={() => createRelease.mutate(caseId)}><Package aria-hidden />新建发布</Button>
      </div>
      {releases.isLoading ? <LoadingPanel /> : releases.isError ? <FieldError error={releases.error} /> : releases.data?.length ? (
        <ul className="divide-y divide-border">{releases.data.map((release) => (
          <ReleaseRow key={release.id} release={release} caseId={caseId} documents={documents} figures={figures} />
        ))}</ul>
      ) : <EmptyState size="sm" icon={Package} title="暂无发布版本" reason="封存前可继续编辑；发布后输入版本固定。" />}
      <FieldError error={createRelease.error} />
    </div>
  )
}

export function MembersPanel({ caseItem, queries }: { caseItem: PlatformCase; queries: ReturnType<typeof useWorkbenchQueries> }) {
  const { addParticipant, invite } = useWorkbenchMutations()
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<ParticipantRole>('reviewer')
  const [inviteId, setInviteId] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitationRole>('reviewer')
  const [inviteScope, setInviteScope] = useState<'case' | 'org'>('case')
  const [expiry, setExpiry] = useState('')
  const participants = queries.participants
  const memberships = queries.memberships
  const submitParticipant = () => {
    if (!principalId.trim()) return
    addParticipant.mutate({ caseId: caseItem.id, principalId: principalId.trim(), role }, { onSuccess: () => setPrincipalId('') })
  }
  const submitInvite = () => {
    if (!inviteId.trim() || !expiry) return
    invite.mutate({
      organizationId: caseItem.organization_id,
      inviteePrincipalId: inviteId.trim(),
      role: inviteRole,
      caseId: inviteScope === 'case' ? caseItem.id : null,
      expiresAt: new Date(expiry).toISOString(),
    }, { onSuccess: () => { setInviteId(''); setExpiry('') } })
  }
  const selectCls = 'h-md-control rounded-md border border-border-strong bg-panel px-2 text-sm'
  return (
    <div className="grid gap-4" data-testid="workbench-members">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">案件参与者</h3>
        {participants.isLoading ? <p className="text-sm text-fg-muted">加载参与者…</p> : participants.isError ? <FieldError error={participants.error} /> : (
          <ul className="divide-y divide-border">{(participants.data ?? []).map((p) => (
            <li key={`${p.principal_id}-${p.role}`} className="flex items-center justify-between py-2 text-sm" data-testid={`participant-${p.principal_id}`}>
              <span className="font-mono text-xs text-fg-muted">{p.principal_id.slice(0, 8)}…</span>
              <span className="flex items-center gap-2"><Badge tone="info">{p.role}</Badge><Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status}</Badge></span>
            </li>
          ))}</ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={principalId} onChange={(e) => setPrincipalId(e.target.value)} placeholder="Principal UUID（须为机构成员）" className="min-w-64" aria-label="参与者 Principal" />
          <select aria-label="参与者角色" className={selectCls} value={role} onChange={(e) => setRole(e.target.value as ParticipantRole)}>{PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <Button size="sm" variant="secondary" loading={addParticipant.isPending} onClick={submitParticipant}><UserPlus aria-hidden />加入参与者</Button>
        </div>
        <FieldError error={addParticipant.error} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">机构成员</h3>
        {memberships.isLoading ? <p className="text-sm text-fg-muted">加载成员…</p> : memberships.isError ? <FieldError error={memberships.error} /> : (
          <ul className="divide-y divide-border">{(memberships.data ?? []).map((m) => (
            <li key={m.principal_id} className="flex items-center justify-between py-2 text-sm" data-testid={`member-${m.principal_id}`}>
              <span className="font-mono text-xs text-fg-muted">{m.principal_id.slice(0, 8)}…</span>
              <span className="flex items-center gap-2"><Badge tone="info">{m.role}</Badge><Badge tone={m.status === 'active' ? 'ok' : 'neutral'}>{m.status}</Badge></span>
            </li>
          ))}</ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="受邀 Principal UUID" className="min-w-64" aria-label="受邀 Principal" />
          <select aria-label="邀请范围" className={selectCls} value={inviteScope} onChange={(e) => { const scope = e.target.value as 'case' | 'org'; setInviteScope(scope); setInviteRole(scope === 'org' ? 'member' : 'reviewer') }}>
            <option value="case">案件角色</option><option value="org">机构角色</option>
          </select>
          <select aria-label="邀请角色" className={selectCls} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InvitationRole)}>
            {(inviteScope === 'org' ? ORG_ROLES : PARTICIPANT_ROLES).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="邀请过期时间" className="min-w-52" />
          <Button size="sm" variant="secondary" loading={invite.isPending} onClick={submitInvite}>发出邀请</Button>
        </div>
        <FieldError error={invite.error} />
        {invite.isSuccess && <p className="mt-2 text-sm text-ok-fg">邀请已创建，等待对方接受。</p>}
      </section>
    </div>
  )
}

export function ApprovalsView({ approvals }: { approvals: ReturnType<typeof useWorkbenchQueries>['approvals'] }) {
  const { decideApproval } = useWorkbenchMutations()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  return <section data-testid="workbench-approvals" aria-labelledby="approvals-title">{approvals.isLoading ? <LoadingPanel /> : approvals.isError ? <FieldError error={approvals.error} /> : approvals.data?.length ? <div className="grid gap-3">{approvals.data.map((item) => <article key={item.id} className="rounded-lg border border-border bg-panel p-4" data-testid={`approval-${item.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-fg-strong">待审批运行</h2><p className="mt-1 text-xs text-fg-muted">案件 {item.case_id.slice(0, 8)} · Run {item.run_id.slice(0, 8)}</p></div><Badge tone="warn">待处理</Badge></div><div className="mt-3 flex flex-wrap items-center gap-2"><Input value={reasons[item.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [item.id]: e.target.value })} placeholder="审批意见（可选）" className="min-w-56" aria-label="审批意见" /><Button size="sm" loading={decideApproval.isPending} onClick={() => decideApproval.mutate({ approvalId: item.id, decision: 'approved', reason: reasons[item.id] })}>批准</Button><Button size="sm" variant="secondary" disabled={decideApproval.isPending} onClick={() => decideApproval.mutate({ approvalId: item.id, decision: 'rejected', reason: reasons[item.id] })}>拒绝</Button></div></article>)}</div> : <EmptyState icon={Inbox} title="审批收件箱为空" reason="需要你处理的 Agent 或协作运行会出现在这里。" />}<FieldError error={decideApproval.error} /></section>
}

export function NotificationsView({ notifications }: { notifications: ReturnType<typeof useWorkbenchQueries>['notifications'] }) {
  const { markNotificationRead } = useWorkbenchMutations()
  return <section data-testid="workbench-notifications" aria-labelledby="notifications-title">{notifications.isLoading ? <LoadingPanel /> : notifications.isError ? <FieldError error={notifications.error} /> : notifications.data?.length ? <div className="grid gap-2">{notifications.data.map((item) => <article key={item.id} className="rounded-lg border border-border bg-panel p-4" data-testid={`notification-${item.id}`}><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><Bell className="mt-0.5 size-4 text-fg-icon" aria-hidden /><div><div className="font-medium text-fg-strong">{item.notification_type ?? '系统通知'}</div><div className="mt-1 text-xs text-fg-muted">{item.read_at ? '已读' : '未读'} · {item.case_id ? `案件 ${item.case_id.slice(0, 8)}` : '全局'}</div></div></div>{!item.read_at && <Button size="xs" variant="secondary" loading={markNotificationRead.isPending} onClick={() => markNotificationRead.mutate(item.id)}>标记已读</Button>}</div></article>)}</div> : <EmptyState icon={Bell} title="暂无通知" reason="分派、期限、审批和系统事件会显示在这里。" />}<FieldError error={markNotificationRead.error} /></section>
}

/**
 * B17 M7：#/workbench 四视图已全部并入旧 IA（queue→#/dashboard 工作项分段、case→#/p/<pid>、
 * approvals/notifications→#/inbox），本页退役为 redirect shim——外部深链/书签按 view 跳目标路由。
 */
export function WorkbenchRedirect() {
  const { caseId, view } = useMemo(readWorkbenchQuery, [])
  useEffect(() => {
    let on = true
    void (async () => {
      let target = '#/'
      if (view === 'approvals') target = '#/inbox?tab=approvals'
      else if (view === 'notifications') target = '#/inbox'
      else if (view === 'case' && caseId) {
        try {
          const c = await workbenchApi.case(caseId)
          target = c.case_key ? `#/p/${encodeURIComponent(c.case_key)}` : '#/'
        } catch {
          target = '#/'
        }
      }
      if (on) window.location.replace(target)
    })()
    return () => {
      on = false
    }
  }, [caseId, view])
  return (
    <div className="flex h-dvh items-center justify-center bg-app" data-testid="workbench-redirect" role="status">
      <LoaderCircle className="size-6 animate-spin text-fg-muted" aria-label="正在跳转" />
    </div>
  )
}
