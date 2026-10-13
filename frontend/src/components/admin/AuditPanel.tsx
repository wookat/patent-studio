import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fmtDateTime } from '@/lib/format'

/** 后端 `ts` 为 epoch 秒（org_audit._out → datetime.timestamp()） */
const tsDate = (ts: number) => new Date(ts * 1000)
import type { ColumnDef } from '@tanstack/react-table'
import { Construction, Download, ScrollText, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMisc'
import { api, isNotImplemented } from '@/lib/api'
import { ROLE_LABEL, type Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { auditCsvUrl, ORG_AUDIT_PAGE } from '@/store/admin'
import { useStudio } from '@/store'
import type { OrgAuditEvent, OrgAuditKind, OrgAuditQuery } from '@/types/org'
export const AUDIT_KIND_LABEL: Record<OrgAuditKind, string> = {
  'auth.login': '登录',
  'case.created': '新建案卷',
  'case.deleted': '删除案卷',
  'case.status': '状态变更',
  'member.changed': '成员变更',
  'admin.user': '成员管理',
  'share.created': '创建分享',
  'share.revoked': '撤销分享',
  'share.confirmed': '客户确认',
  'export.downloaded': '下载产物',
  'ai.sent': 'AI 外发',
  'deliver.filed': '标记已递交',
  'oa.round': 'OA 轮次',
  'deadline.done': '期限完成',
  'deadline.undone': '撤销期限完成',
  'deadline.override': '期限改期',
  'deadline.nudge': '催办期限',
  'comment.assign': '指派批注',
}
const KINDS = Object.keys(AUDIT_KIND_LABEL) as OrgAuditKind[]
const ANY = '__any'


const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const SHARE_SCOPE_LABEL: Record<string, string> = {
  read: '只读',
  comment: '可批注',
}
const FMT_LABEL: Record<string, string> = {
  docx: 'Word',
  pdf: 'PDF',
  xml: 'CNIPA XML',
  'bundle.zip': '递交包',
}

/** 各事件 data → 一句人话（生产者字段见 backend/app/domain/org_audit.py 头注）；token / job_id / sha / user_id 等内部标识不展示 */
export function describeAudit(e: OrgAuditEvent): string {
  const d = e.data
  switch (e.kind) {
    case 'auth.login':
      return str(d.email)
    case 'case.created':
    case 'case.deleted':
      return str(d.title)
    case 'member.changed': {
      const role = str(d.role)
      const who = str(d.email)
      const label = role in ROLE_LABEL ? ROLE_LABEL[role as Role] : role
      if (!role) return who ? `移除 ${who}` : '移除成员'
      return who ? `${who} → ${label}` : label
    }
    case 'admin.user': {
      const who = str(d.email)
      const ch = (d.changes ?? {}) as Record<string, unknown>
      const bits = [
        ch.is_superuser === true && '授予超管',
        ch.is_superuser === false && '撤销超管',
        ch.is_active === false && '禁用账号',
        ch.is_active === true && '启用账号',
        ch.title != null && `头衔「${str(ch.title)}」`,
      ].filter(Boolean)
      return [who, bits.join('、')].filter(Boolean).join(' → ')
    }
    case 'share.created': {
      const scope = str(d.scope)
      const bits = [SHARE_SCOPE_LABEL[scope] ?? scope, d.expires_at ? `${fmtDateTime(Number(d.expires_at))} 到期` : '长期有效']
      return bits.filter(Boolean).join(' · ')
    }
    case 'share.revoked':
      return ''
    case 'share.confirmed': {
      const bits = [str(d.name) && `确认人 ${str(d.name)}`, str(d.version) && `第 ${str(d.version)} 版`, str(d.note)]
      return bits.filter(Boolean).join(' · ')
    }
    case 'export.downloaded': {
      const fmt = str(d.fmt)
      return FMT_LABEL[fmt] ?? fmt
    }
    case 'ai.sent': {
      const bits = [str(d.scenario), str(d.model), str(d.chars) && `${str(d.chars)} 字`, d.truncated === true && '已截断']
      return bits.filter(Boolean).join(' · ')
    }
    case 'deliver.filed': {
      const bits = [str(d.application_no) && `申请号 ${str(d.application_no)}`, str(d.filed) && `递交日 ${str(d.filed)}`]
      return bits.filter(Boolean).join(' · ')
    }
    default:
      return ''
  }
}

/** 表单值 → OrgAuditQuery（空串不传；R-ADM-03 同一 query 同时用于列表与 CSV） */
export function auditQueryFrom(f: { actor: string; pid: string; from: string; to: string; kind: string }): OrgAuditQuery {
  return {
    actor: f.actor.trim() || undefined,
    pid: f.pid.trim() || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    kind: f.kind && f.kind !== ANY ? (f.kind as OrgAuditKind) : undefined,
  }
}

/**
 * 审计 tab（21 §4.6 / R-ADM-03）：筛选 actor / 案 / 时间 / 类型 → api.orgAudit(q)；「导出 CSV」用同一 q 打开 /api/admin/audit.csv。
 * 1440 DataTable；375 卡片列表。501 → EmptyState。
 */
export function AuditPanel() {
  const desktop = useIsDesktop()
  const projects = useStudio((s) => s.projects)
  const titleOf = (e: OrgAuditEvent): string => projects.find((p) => p.id === e.pid)?.title || str(e.data.title) || e.pid || ''

  /* 机构审计走 TanStack Query：key=query 对象天然「最后发起者落地」替代 orgAuditReqSeq；扩窗/改筛 keepPreviousData 保旧列不闪空 */
  const [query, setQuery] = useState<OrgAuditQuery>({ limit: ORG_AUDIT_PAGE })
  const auditQ = useQuery({
    queryKey: ['orgAudit', query],
    queryFn: () => api.orgAudit(query),
    placeholderData: keepPreviousData,
  })
  const items = auditQ.data?.items ?? []
  const total = auditQ.data?.total ?? 0
  const loading = auditQ.isFetching
  const unavailable = auditQ.error != null && isNotImplemented(auditQ.error)
  useEffect(() => {
    if (auditQ.error && !isNotImplemented(auditQ.error)) useStudio.getState().toast(auditQ.error instanceof Error ? auditQ.error.message : String(auditQ.error), 'error')
  }, [auditQ.error])

  const [form, setForm] = useState({ actor: '', pid: '', from: '', to: '', kind: ANY })

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setQuery({ ...auditQueryFrom(form), limit: ORG_AUDIT_PAGE })
  }
  const reset = () => {
    setForm({ actor: '', pid: '', from: '', to: '', kind: ANY })
    setQuery({ limit: ORG_AUDIT_PAGE })
  }
  const csvHref = auditCsvUrl(query)

  const columns = useMemo<ColumnDef<OrgAuditEvent, unknown>[]>(
    () => [
      { id: 'ts', accessorKey: 'ts', header: '时间', size: 150, cell: ({ row }) => <time dateTime={tsDate(row.original.ts).toISOString()} className="tabular-nums text-fg-muted">{fmtDateTime(row.original.ts)}</time> },
      {
        id: 'kind',
        accessorKey: 'kind',
        header: '类型',
        size: 120,
        cell: ({ row }) => <Badge tone="outline">{AUDIT_KIND_LABEL[row.original.kind] ?? row.original.kind}</Badge>,
      },
      { id: 'actor', header: '操作者', size: 140, accessorFn: (r) => r.actor?.display_name ?? '', cell: ({ row }) => row.original.actor ? <span className="truncate" title={row.original.actor.display_name}>{row.original.actor.display_name}</span> : <span className="text-fg-muted">系统</span> },
      { id: 'pid', header: '案卷', size: 200, accessorFn: (r) => titleOf(r), cell: ({ row }) => row.original.pid ? <a href={`#/p/${row.original.pid}`} className="block truncate text-primary underline-offset-2 hover:underline" title={titleOf(row.original)}>{titleOf(row.original)}</a> : <span className="text-fg-muted">—</span> },
      { id: 'data', header: '详情', enableSorting: false, cell: ({ row }) => <span className="block truncate text-xs text-fg-muted" title={describeAudit(row.original)}>{describeAudit(row.original) || '—'}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- titleOf 只依赖 projects
    [projects],
  )

  if (unavailable) {
    return <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="机构审计接口（GET /api/admin/audit）尚未提供（501）。" data-testid="admin-audit-unavailable" />
  }

  const empty = <EmptyState icon={ScrollText} title="没有匹配的审计事件" reason="放宽筛选或清除条件后再试。" size="sm" data-testid="admin-audit-empty" />

  return (
    <div className="grid gap-4" data-testid="admin-audit-panel">
      <form className={cn('grid gap-3 rounded-md border border-border bg-panel p-4', desktop ? 'grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] items-end' : 'grid-cols-1')} onSubmit={apply} aria-label="审计筛选" data-testid="audit-filter-form">
        <Field>
          <FieldLabel>操作者</FieldLabel>
          <FieldControl>
            <Input value={form.actor} placeholder="姓名" onChange={(e) => setForm({ ...form, actor: e.target.value })} data-testid="audit-actor" />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>案卷</FieldLabel>
          <FieldControl>
            <Input value={form.pid} placeholder="案卷标识（可从列表选）" list="audit-pid-options" onChange={(e) => setForm({ ...form, pid: e.target.value })} data-testid="audit-pid" />
          </FieldControl>
          <datalist id="audit-pid-options">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.id}
              </option>
            ))}
          </datalist>
        </Field>
        <Field>
          <FieldLabel>起始日期</FieldLabel>
          <FieldControl>
            <Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} data-testid="audit-from" />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>截止日期</FieldLabel>
          <FieldControl>
            <Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} data-testid="audit-to" />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>类型</FieldLabel>
          <FieldControl>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger size={desktop ? 'md' : 'lg'} data-testid="audit-kind" aria-label="事件类型">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>全部类型</SelectItem>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{AUDIT_KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldControl>
        </Field>
        <div className={cn('flex items-center gap-2', !desktop && '[&>button]:flex-1')}>
          <Button type="submit" variant="secondary" size="md" disabled={loading} data-testid="audit-apply">
            <Search aria-hidden /> 筛选
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={reset} disabled={loading}>
            清除
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-fg-muted" data-testid="audit-total">共 {total} 条{items.length < total ? `，显示最近 ${items.length} 条` : ''}</span>
        <Button asChild variant="secondary" size={desktop ? 'sm' : 'md'} className="ml-auto">
          <a href={csvHref} download data-testid="audit-export-csv">
            <Download aria-hidden /> 导出 CSV
          </a>
        </Button>
        {items.length < total && (
          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            loadingLabel="正在加载"
            onClick={() => setQuery((q) => ({ ...q, limit: (q.limit ?? ORG_AUDIT_PAGE) + ORG_AUDIT_PAGE }))}
            data-testid="audit-load-more"
          >
            加载更多
          </Button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="grid gap-2" aria-busy data-testid="admin-audit-loading">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : desktop ? (
        <DataTable columns={columns} data={items} getRowId={(r) => r.id} empty={empty} className="rounded-md border border-border bg-panel" data-testid="audit-table" />
      ) : items.length === 0 ? (
        empty
      ) : (
        <ul className="grid min-w-0 gap-2" data-testid="audit-cards">
          {items.map((e) => (
            <li key={e.id} className="grid min-w-0 gap-2 rounded-md border border-border bg-panel p-4 text-sm" data-testid={`row-${e.id}`}>
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="neutral">{AUDIT_KIND_LABEL[e.kind] ?? e.kind}</Badge>
                <span className="min-w-0 truncate font-medium text-fg-strong" title={e.actor?.display_name ?? '系统'}>{e.actor?.display_name ?? '系统'}</span>
                <time dateTime={tsDate(e.ts).toISOString()} className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">{fmtDateTime(e.ts)}</time>
              </div>
              {(e.pid || describeAudit(e)) && (
                <div className="grid min-w-0 gap-1 text-xs text-fg-muted">
                  {e.pid && (
                    <a href={`#/p/${e.pid}`} className="inline-flex min-h-touch items-center text-link underline-offset-2 hover:underline">
                      <span className="line-clamp-1">{titleOf(e)}</span>
                    </a>
                  )}
                  {describeAudit(e) && <span className="line-clamp-2">{describeAudit(e)}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
