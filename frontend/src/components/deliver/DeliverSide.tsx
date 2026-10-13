import type { ReactNode } from 'react'
import { fmtDateTime } from '@/lib/format'
import { CalendarClock, CheckCircle2, Circle, CircleAlert, FileCheck2, History, ListChecks, Users } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Countdown } from '@/components/ui/countdown'
import type { Version } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { versionLabel } from '@/lib/versionLabel'
import type { CaseSummary } from '@/types/case'
import { DEADLINE_KIND_LABEL } from '@/types/deadlines'
/** 递交页右栏卡片壳：14px 600 标题 + 图标，边框 --border、底 --bg-panel、圆角 md */
export function SideCard({ title, icon, children, className, ...rest }: { title: string; icon: ReactNode; children: ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-panel', className)} aria-label={title} {...rest}>
      <h2 className="flex h-panel-header items-center gap-2 border-b border-border px-4 text-sm font-semibold text-fg-strong [&_svg]:size-4 [&_svg]:text-fg-icon">
        {icon}
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** 从 case.deadlines 里取最近未完成的期限（服务端 next_deadline 优先） */
export function nextDeadlineOf(kase: CaseSummary | null): { kind: string; due: string; note: string; daysLeft: number } | null {
  if (!kase) return null
  const nd = kase.next_deadline
  if (nd) return { kind: nd.kind, due: nd.due, note: nd.note, daysLeft: nd.days_left }
  const pending = (kase.deadlines ?? []).filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due))[0]
  if (!pending) return null
  const due = new Date(`${pending.due}T00:00:00`)
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000)
  return { kind: pending.kind, due: pending.due, note: pending.note, daysLeft: days }
}

const DEADLINE_KIND: Record<string, string> = {
  ...DEADLINE_KIND_LABEL,
  client_review: '客户确认',
  filing: '递交',
  oa_reply: '答复 OA',
  custom: '自定',
}

/** 目标递交（机构自定，非法定期限；不进 deadlines[]）：服务端 target_filing_days_left 为准，null → 无 */
export function targetFilingOf(kase: CaseSummary | null): { due: string; daysLeft: number } | null {
  const due = kase?.dates?.target_filing
  const days = kase?.target_filing_days_left
  if (!due || days === null || days === undefined) return null
  return { due, daysLeft: days }
}

const TARGET_FILING_LABEL = '目标递交（机构自定，非法定期限）'

export function DeadlineCard({ kase, loading }: { kase: CaseSummary | null; loading: boolean }) {
  const nd = nextDeadlineOf(kase)
  const tf = targetFilingOf(kase)
  return (
    <SideCard title="期限" icon={<CalendarClock aria-hidden />} data-testid="deliver-deadline">
      {loading && !kase ? (
        <Skeleton className="h-lg-control w-2/3" />
      ) : nd ? (
        <div className="grid gap-1">
          <Countdown daysLeft={nd.daysLeft} size="lg" date={nd.due} />
          <div className="text-xs text-fg-muted">
            {DEADLINE_KIND[nd.kind] ?? nd.kind}
            {nd.note ? ` · ${nd.note}` : ''}
          </div>
          {tf && (
            <div className="mt-2 flex items-baseline gap-2 border-t border-border pt-2 text-xs text-fg-muted" data-testid="deliver-target-filing">
              <Countdown daysLeft={tf.daysLeft} size="md" className="shrink-0 whitespace-nowrap" />
              <span className="min-w-0">
                {TARGET_FILING_LABEL} · {tf.due}
              </span>
            </div>
          )}
        </div>
      ) : tf ? (
        <div className="grid gap-1" data-testid="deliver-target-filing">
          <Countdown daysLeft={tf.daysLeft} size="lg" date={tf.due} />
          <div className="text-xs text-fg-muted">{TARGET_FILING_LABEL}</div>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">没有待办期限；递交后可在案件表单里登记后续期限。</p>
      )}
    </SideCard>
  )
}

const fmtDate = (d: string | null | undefined) => d || '—'

/** 递交就绪卡单项：ok true=齐 / false=缺（计入「还差」）/ null=可选信息行（不计数） */
export interface ReadyItem {
  id: string
  label: string
  ok: boolean | null
  /** 缺失时行内补一句（哪本书缺 / 还有几条错误） */
  hint?: string
  /** 「去补」深链（无写权时不传） */
  onFix?: () => void
  fixLabel?: string
}

/** W19 批2 递交就绪聚合卡：必填要素 + 可选著录项一屏自检，每项直达补录位（右侧栏置顶）。 */
export function FilingReadinessCard({ items, loading }: { items: ReadyItem[]; loading: boolean }) {
  const missing = items.filter((i) => i.ok === false).length
  return (
    <SideCard title="递交就绪" icon={<ListChecks aria-hidden />} data-testid="deliver-readiness">
      {loading ? (
        <Skeleton lines={4} />
      ) : (
        <>
          <ul className="grid gap-1.5" data-testid="readiness-list">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-sm">
                {it.ok === true ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok-fg" aria-hidden />
                ) : it.ok === false ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn-fg" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-hidden />
                )}
                <span className="min-w-0 flex-1 text-fg">
                  {it.label}
                  {it.hint ? <span className="text-fg-muted"> · {it.hint}</span> : null}
                </span>
                {it.onFix && it.ok !== true && (
                  <button
                    type="button"
                    onClick={it.onFix}
                    className={cn('shrink-0 rounded-sm text-xs text-link underline-offset-4 hover:underline', FOCUS_RING)}
                    data-testid={`readiness-fix-${it.id}`}
                  >
                    {it.fixLabel ?? '去补'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-2 text-xs text-fg-muted" data-testid="readiness-summary">
            {missing === 0 ? '要素齐备，可生成递交包（可选著录不挡递交）。' : `还差 ${missing} 项必填要素。`}
          </p>
        </>
      )}
    </SideCard>
  )
}

export function ApplicantCard({ kase, loading, onEdit }: { kase: CaseSummary | null; loading: boolean; onEdit?: () => void }) {
  const rows: [string, string][] = kase
    ? [
        ['案号', kase.case_no || '—'],
        ['客户', kase.client || '—'],
        ['申请人', kase.applicants?.length ? kase.applicants.join('、') : '—'],
        ['发明人', kase.inventors?.length ? kase.inventors.join('、') : '—'],
        ['申请日', fmtDate(kase.dates?.filed)],
        ['申请号', fmtDate(kase.dates?.application_no)],
      ]
    : []
  return (
    <SideCard title="申请信息" icon={<Users aria-hidden />} data-testid="deliver-applicant">
      {loading && !kase ? (
        <Skeleton lines={4} />
      ) : !kase ? (
        <p className="text-sm text-fg-muted">还没有台账信息。</p>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {onEdit && kase && (
        <button type="button" className={cn('mt-2 inline-flex h-md-control items-center rounded-sm text-sm text-link underline-offset-4 hover:underline', FOCUS_RING)} onClick={onEdit} data-testid="deliver-edit-case">
          修改台账信息
        </button>
      )}
    </SideCard>
  )
}

/**
 * 递交记录：已递交（申请日 / 申请号）置顶为 ok 行；其后是最近 5 个版本（sha7 · 作者 · 时间），
 * 让代理师在递交前看清「递交的是哪一版」。
 */
export function RecordCard({ kase, versions, loading, unavailable }: { kase: CaseSummary | null; versions: Version[]; loading: boolean; unavailable: boolean }) {
  const filed = kase?.status === 'filed' || kase?.status === 'granted' || kase?.status === 'rejected'
  const recent = versions.slice(0, 5)
  return (
    <SideCard title="递交记录" icon={<History aria-hidden />} data-testid="deliver-records">
      {filed && kase && (
        <div className="mb-3 flex items-start gap-2 rounded-sm bg-ok-bg px-3 py-2 text-sm text-ok-fg" data-testid="deliver-filed-record">
          <FileCheck2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium">已递交 {fmtDate(kase.dates?.filed)}</div>
            <div className="text-xs">申请号 {fmtDate(kase.dates?.application_no)}</div>
          </div>
        </div>
      )}
      {loading && versions.length === 0 ? (
        <Skeleton lines={3} />
      ) : unavailable ? (
        <p className="text-sm text-fg-muted">版本历史不可用。</p>
      ) : recent.length === 0 ? (
        <p className="text-sm text-fg-muted">还没有版本记录；先在工作台保存一次。</p>
      ) : (
        <ol className="grid gap-2" data-testid="deliver-versions">
          {recent.map((v, i) => (
            <li key={v.sha} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2 text-sm">
              <code className={cn('font-mono text-xs', i === 0 ? 'text-fg-strong' : 'text-fg-muted')}>{v.sha.slice(0, 7)}</code>
              <span className="min-w-0 truncate text-fg" title={v.message ? versionLabel(v.message) : i === 0 ? '当前版本' : '—'}>{v.message ? versionLabel(v.message) : i === 0 ? '当前版本' : '—'}</span>
              <time className="text-xs tabular-nums text-fg-muted" dateTime={new Date(v.at * 1000).toISOString()}>
                {fmtDateTime(v.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </SideCard>
  )
}
