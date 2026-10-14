import { useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, Bell, BriefcaseBusiness, CheckCircle2, FileText, FolderKanban, Image, Inbox, LoaderCircle, Package, ShieldAlert, UserPlus, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/net'
import { PageChrome } from '@/components/shell/PageChrome'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkbenchMutations, useWorkbenchQueries, workbenchKeys } from '@/workbench/queries'
import { workbenchApi } from '@/workbench/api'
import type { Book, Document, InvitationRole, ParticipantRole, PlatformCase, Revision, WorkItem, WorkItemStatus } from '@/workbench/types'
import { WorkingCopyEditor } from './WorkingCopyEditor'

type View = 'queue' | 'case' | 'approvals' | 'notifications'

const readWorkbenchQuery = () => {
  const raw = window.location.hash.split('?')[1]
  const params = new URLSearchParams(raw)
  return { caseId: params.get('case'), view: (params.get('view') as View | null) ?? 'queue' }
}

const setWorkbenchQuery = (view: View, caseId: string | null) => {
  const p = new URLSearchParams({ view })
  if (caseId) p.set('case', caseId)
  window.location.hash = `/workbench?${p.toString()}`
}

const statusTone: Record<string, BadgeTone> = {
  intake: 'info', drafting: 'violet', review: 'orange', client_review: 'teal', final: 'ok', filed: 'info',
  oa: 'warn', granted: 'ok', rejected: 'danger', closed: 'neutral',
}

const BOOK_LABEL: Record<Book, string> = { abstract: '摘要', claims: '权利要求书', description: '说明书' }
const PARTICIPANT_ROLES: ParticipantRole[] = ['client', 'inventor', 'applicant', 'author', 'attorney', 'drafter', 'reviewer', 'case_manager', 'observer']
const ORG_ROLES: InvitationRole[] = ['admin', 'member']

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0
  const kind = error instanceof ApiError ? error.detail?.kind : null
  if (status === 401) {
    return <EmptyState icon={ShieldAlert} title="需要登录" reason="平台工作台需要登录会话；登录后才能读取案件、工作项和审批。" action={<Button asChild variant="secondary"><a href="#/login">去登录</a></Button>} data-testid="workbench-auth-error" />
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

function CasePicker({ cases, selected, onChange }: { cases: PlatformCase[]; selected: string | null; onChange: (id: string) => void }) {
  return (
    <label className="flex min-w-56 items-center gap-2 text-sm text-fg-muted">
      <span className="sr-only">选择案件</span>
      <select className="h-md-control rounded-md border border-border-strong bg-panel px-2 text-fg" value={selected ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">选择案件</option>
        {cases.map((item) => <option key={item.id} value={item.id}>{item.case_key} · {item.title}</option>)}
      </select>
    </label>
  )
}

export function QueueView({ cases, items, onOpenCase }: { cases: PlatformCase[]; items: WorkItem[]; onOpenCase: (id: string) => void }) {
  const [status, setStatus] = useState<'all' | WorkItemStatus>('all')
  const [search, setSearch] = useState('')
  const [now] = useState(() => Date.now())
  const caseMap = useMemo(() => new Map(cases.map((item) => [item.id, item])), [cases])
  const visible = items.filter((item) => {
    const matchStatus = status === 'all' || item.status === status
    const matchText = !search.trim() || `${item.title} ${caseMap.get(item.case_id)?.case_key ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
    return matchStatus && matchText
  })
  return (
    <section aria-labelledby="queue-title" data-testid="workbench-queue">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="queue-search">搜索工作项</label>
        <Input id="queue-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索工作项或案件号" className="max-w-sm" />
        <select aria-label="工作项状态" className="h-md-control rounded-md border border-border-strong bg-panel px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">全部状态</option><option value="open">待处理</option><option value="in_progress">进行中</option><option value="blocked">已阻塞</option><option value="in_review">待复核</option><option value="done">已完成</option>
        </select>
        <span className="text-sm text-fg-muted">{visible.length} 项</span>
      </div>
      {visible.length === 0 ? <EmptyState size="sm" icon={BriefcaseBusiness} title="没有匹配的工作项" reason="调整筛选条件，或从案件空间创建新的工作项。" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>工作项</TableHead><TableHead>案件</TableHead><TableHead>状态</TableHead><TableHead>期限</TableHead><TableHead className="w-24">操作</TableHead></TableRow></TableHeader>
          <TableBody>{visible.map((item) => {
            const overdue = item.deadline ? new Date(item.deadline).getTime() < now && item.status !== 'done' : false
            const currentCase = caseMap.get(item.case_id)
            return <TableRow key={item.id} data-testid={`work-item-${item.id}`}>
              <TableCell><div className="font-medium text-fg-strong">{item.title}</div><div className="text-xs text-fg-muted">{item.type}</div></TableCell>
              <TableCell><button className="text-left text-link hover:underline" onClick={() => onOpenCase(item.case_id)}>{currentCase?.case_key ?? '未知案件'}<span className="ml-1 text-fg-muted">{currentCase?.title}</span></button></TableCell>
              <TableCell><Badge tone={item.status === 'done' ? 'ok' : item.status === 'blocked' ? 'danger' : 'info'}>{item.status}</Badge></TableCell>
              <TableCell className={overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'}>{item.deadline ? new Date(item.deadline).toLocaleDateString('zh-CN') : '—'}{overdue && <span className="ml-1 text-xs">逾期</span>}</TableCell>
              <TableCell><Button variant="ghost" size="sm" onClick={() => onOpenCase(item.case_id)}>打开</Button></TableCell>
            </TableRow>
          })}</TableBody>
        </Table>
      )}
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
            <Button size="sm" variant={editing === doc.id ? 'secondary' : 'soft'} onClick={() => setEditing(editing === doc.id ? null : doc.id)}>{editing === doc.id ? '收起' : '编辑 / 历史'}</Button>
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

export function ReleasesPanel({ caseId, releases }: { caseId: string; releases: ReturnType<typeof useWorkbenchQueries>['releases'] }) {
  const { createRelease, sealRelease } = useWorkbenchMutations()
  return (
    <div data-testid="workbench-releases">
      <div className="mb-2 flex justify-end"><Button size="xs" variant="secondary" loading={createRelease.isPending} onClick={() => createRelease.mutate(caseId)}><Package aria-hidden />新建发布</Button></div>
      {releases.isLoading ? <LoadingPanel /> : releases.isError ? <FieldError error={releases.error} /> : releases.data?.length ? (
        <ul className="divide-y divide-border">{releases.data.map((release) => (
          <li key={release.id} className="flex items-center justify-between gap-2 py-3" data-testid={`release-${release.id}`}>
            <span className="font-medium text-fg-strong">发布 {release.id.slice(0, 8)}</span>
            <div className="flex items-center gap-2">
              <Badge tone={release.status === 'sealed' ? 'ok' : 'neutral'}>{release.status}</Badge>
              {release.status !== 'sealed' && <Button size="xs" variant="secondary" loading={sealRelease.isPending} onClick={() => sealRelease.mutate({ releaseId: release.id, caseId })}>封存</Button>}
            </div>
          </li>
        ))}</ul>
      ) : <EmptyState size="sm" icon={Package} title="暂无发布版本" reason="封存前可继续编辑；发布后输入版本固定。" />}
      <FieldError error={createRelease.error ?? sealRelease.error} />
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

function CaseView({ caseItem, queries }: { caseItem: PlatformCase; queries: ReturnType<typeof useWorkbenchQueries> }) {
  const [tab, setTab] = useState<'docs' | 'proposals' | 'figures' | 'releases' | 'members'>('docs')
  const tabs = ([
    ['docs', FileText, '文稿'], ['proposals', CheckCircle2, '提案'], ['figures', Image, '附图'],
    ['releases', Package, '发布'], ['members', Users, '成员'],
  ] as const)
  return <section aria-labelledby="case-title" data-testid="workbench-case" className="grid gap-4">
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-lg border border-border bg-panel p-4 md:col-span-2"><div className="text-xs text-fg-muted">案件</div><h2 className="mt-1 text-xl font-semibold text-fg-strong">{caseItem.title}</h2><p className="mt-1 text-sm text-fg-muted">{caseItem.case_key} · {caseItem.kind}</p><Badge className="mt-3" tone={statusTone[caseItem.status] ?? 'neutral'}>{workbenchApi.statusLabel(caseItem.status)}</Badge></div>
      <SummaryCard icon={FileText} label="三书文稿" value={queries.documents.data?.length ?? 0} />
      <SummaryCard icon={Image} label="附图" value={queries.figures.data?.length ?? 0} />
    </div>
    <nav className="flex flex-wrap gap-1" aria-label="案件空间区块">{tabs.map(([key, Icon, label]) => <Button key={key} variant={tab === key ? 'soft' : 'ghost'} size="sm" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}><Icon aria-hidden />{label}</Button>)}</nav>
    <Panel>
      {tab === 'docs' && (queries.documents.isLoading ? <LoadingPanel /> : queries.documents.isError ? <FieldError error={queries.documents.error} /> : <DocumentsPanel caseItem={caseItem} documents={queries.documents.data} />)}
      {tab === 'proposals' && <ProposalsPanel caseId={caseItem.id} proposals={queries.proposals} />}
      {tab === 'figures' && (queries.figures.isLoading ? <LoadingPanel /> : queries.figures.data?.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{queries.figures.data.map((figure) => <div key={figure.id} className="rounded-md border border-border bg-sunken p-3 text-sm"><div className="font-medium text-fg-strong">{figure.figure_no ? `图 ${figure.figure_no}` : '未编号'}</div><div className="mt-1 truncate text-xs text-fg-muted">{figure.title || '未命名附图'}</div></div>)}</div> : <EmptyState size="sm" icon={Image} title="暂无附图" reason="附图会在案件空间建立并单独版本化。" />)}
      {tab === 'releases' && <ReleasesPanel caseId={caseItem.id} releases={queries.releases} />}
      {tab === 'members' && <MembersPanel caseItem={caseItem} queries={queries} />}
    </Panel>
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="案件工作项" icon={BriefcaseBusiness}>{queries.caseWorkItems.isLoading ? <LoadingPanel /> : queries.caseWorkItems.data?.length ? <ul className="divide-y divide-border">{queries.caseWorkItems.data.map((item) => <li key={item.id} className="flex items-center justify-between py-2 text-sm"><span className="font-medium text-fg-strong">{item.title}</span><Badge tone={item.status === 'done' ? 'ok' : 'info'}>{item.status}</Badge></li>)}</ul> : <EmptyState size="sm" icon={BriefcaseBusiness} title="本案暂无工作项" />}</Panel>
    </div>
  </section>
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

function SummaryCard({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number }) {
  return <div className="rounded-lg border border-border bg-panel p-4"><Icon className="size-5 text-fg-icon" aria-hidden /><div className="mt-3 text-2xl font-semibold text-fg-strong">{value}</div><div className="text-sm text-fg-muted">{label}</div></div>
}

function Panel({ title, icon: Icon, children }: { title?: string; icon?: typeof FileText; children: ReactNode }) {
  return <section className="rounded-lg border border-border bg-panel p-4">{(title || Icon) && <div className="mb-3 flex items-center gap-2">{Icon && <Icon className="size-4 text-fg-icon" aria-hidden />}{title && <h2 className="font-semibold text-fg-strong">{title}</h2>}</div>}{children}</section>
}

export function WorkbenchPage() {
  const initial = readWorkbenchQuery()
  const [view, setView] = useState<View>(initial.view)
  const [caseId, setCaseId] = useState<string | null>(initial.caseId)
  const queries = useWorkbenchQueries(caseId)
  const cases = queries.cases.data ?? []
  const selectedCase = queries.selectedCase.data ?? cases.find((item) => item.id === caseId) ?? null
  const firstError = [queries.me, queries.cases, queries.workItems, queries.approvals, queries.notifications].find((q) => q.isError)?.error

  const go = (nextView: View, nextCase = caseId) => {
    setView(nextView); setCaseId(nextCase); setWorkbenchQuery(nextView, nextCase)
  }
  const refresh = () => { void queries.cases.refetch(); void queries.workItems.refetch(); void queries.approvals.refetch(); void queries.notifications.refetch() }
  const nav = <nav className="flex flex-wrap gap-1" aria-label="工作台区域">{([['queue', BriefcaseBusiness, '工作队列'], ['case', FolderKanban, '案件空间'], ['approvals', Inbox, '审批收件箱'], ['notifications', Bell, '通知']] as const).map(([key, Icon, label]) => <Button key={key} variant={view === key ? 'soft' : 'ghost'} size="sm" onClick={() => go(key)} aria-current={view === key ? 'page' : undefined}><Icon aria-hidden />{label}{key === 'approvals' && queries.approvals.data?.length ? <Badge tone="warn" className="ml-1">{queries.approvals.data.length}</Badge> : null}</Button>)}</nav>
  return <PageChrome name="workbench" title="工作台" description="统一查看工作项、案件空间、审批和通知" width="full" actions={<><CasePicker cases={cases} selected={caseId} onChange={(id) => go('case', id)} /><Button variant="secondary" size="sm" onClick={refresh}>刷新</Button></>} headerChildren={<div className="mt-3">{nav}</div>}>
    <div className="mx-auto grid w-full max-w-page gap-5" data-testid="workbench-content">
      {firstError ? <ErrorPanel error={firstError} onRetry={refresh} /> : queries.cases.isLoading || queries.workItems.isLoading || queries.approvals.isLoading || queries.notifications.isLoading ? <LoadingPanel /> : view === 'queue' ? <QueueView cases={cases} items={queries.workItems.data ?? []} onOpenCase={(id) => go('case', id)} /> : view === 'case' ? selectedCase ? <CaseView caseItem={selectedCase} queries={queries} /> : <EmptyState icon={FolderKanban} title="请选择案件" reason="从右上角选择案件后查看文稿、提案、附图和交付状态。" /> : view === 'approvals' ? <ApprovalsView approvals={queries.approvals} /> : <NotificationsView notifications={queries.notifications} />}
    </div>
  </PageChrome>
}
