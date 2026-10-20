import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { BellRing, CalendarClock, Check, ChevronDown, RotateCcw, Target, Undo2 } from 'lucide-react'
import { userColor } from '@/collab/colors'
import { targetFilingLabel } from '@/components/dashboard/DeadlineCell'
import { OrgShell } from '@/components/dashboard/OrgShell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Heat, heatLabel } from '@/components/ui/heat'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MobilePage } from '@/components/ui/mobile-page'
import { PageHeader } from '@/components/ui/page-header'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { usePageScroll } from '@/hooks/usePageScroll'
import { projectHash } from '@/lib/hash'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { ROLE_RANK } from '@/lib/types'
import { useStudio } from '@/store'
import { DEADLINE_GROUPS, DEADLINE_GROUP_LABEL, DEADLINE_GROUP_OPEN_KEY, readDeadlineGroupOpen, selectDeadlineFilterOptions, selectDeadlineGroups, type DeadlineGroup, type TargetFilingItem } from '@/store/deadlines'
import { DEADLINE_KIND_LABEL, OVERRIDE_REASON_MAX } from '@/types/deadlines'
import type { DeadlineItem, DeadlineKind, DeadlineStatus } from '@/types/deadlines'
const ALL = '__all__'

/**
 * 期限状态点 + 文字（后端 status 直出；语义族 danger / warn / info / ok，不是案件 10 状态所以不走 StatusDot）。
 * 颜色永远伴随文字（05 §2.5）。
 */
const DEADLINE_STATUS: Record<DeadlineStatus, { label: string; dot: string; fg: string }> = {
  overdue: { label: '逾期', dot: 'bg-danger-dot', fg: 'text-danger-fg' },
  due_soon: { label: '临期', dot: 'bg-warn-dot', fg: 'text-warn-fg' },
  upcoming: { label: '待办', dot: 'bg-info-dot', fg: 'text-fg' },
  done: { label: '已完成', dot: 'bg-ok-dot', fg: 'text-fg-muted' },
}

function DeadlineStatusDot({ status, className }: { status: DeadlineStatus; className?: string }) {
  const m = DEADLINE_STATUS[status]
  return (
    <span data-slot="deadline-status" data-status={status} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm', m.fg, className)}>
      <span className={cn('size-2 shrink-0 rounded-full', m.dot)} aria-hidden />
      {m.label}
    </span>
  )
}

/** 期限热度：done ⇒ 中性「已完成」；其余走 heatOf（store/deadlines 7d / 30d 分桶，不自算颜色） */
function DeadlineHeat({ d, size }: { d: DeadlineItem; size?: 'sm' | 'md' }) {
  if (d.done)
    return (
      <Heat level={0} size={size} className="text-fg-muted" data-testid={`left-${d.id}`}>
        已完成
      </Heat>
    )
  return (
    <Heat daysLeft={d.days_left} size={size} data-testid={`left-${d.id}`}>
      {heatLabel(d.days_left)}
    </Heat>
  )
}

/** Z22：届满年份节假日表未核对 ⇒ 届满日只按周末顺延过，行内标出不确定性（规则引擎不改，只展示） */
function HolidayUncertain({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-xs text-warn-fg', className)}
      title="该期限届满年份的法定节假日表未核对，届满日仅按周末顺延；请以官方通知书为准。"
      data-testid="deadline-holiday-uncertain"
    >
      ≈ 节假日未核对
    </span>
  )
}

/** 目标递交倒计时（ux-04 只读）：后端 target_filing_days_left 直出，Heat 分桶与普通期限同一套；不是期限条目，无催办 / 完成 */
function TargetHeat({ t, size }: { t: TargetFilingItem; size?: 'sm' | 'md' }) {
  return (
    <Heat daysLeft={t.target_filing_days_left} size={size} data-testid={`target-left-${t.pid}`}>
      {targetFilingLabel(t.target_filing_days_left)}
    </Heat>
  )
}

function Owner({ owner, compact }: { owner: DeadlineItem['owner']; compact?: boolean }) {
  if (!owner) return <span className="text-fg-subtle">—</span>
  return (
    <span className="inline-flex max-w-full items-center gap-1.5" title={compact ? `责任人：${owner.display_name}` : undefined}>
      <Avatar size="sm" name={owner.display_name} color={userColor(owner)} />
      {!compact && <span className="truncate" title={owner.display_name}>{owner.display_name}</span>}
    </span>
  )
}

/** 改期（R101 落地 R77 裁决项）：PUT deadlines/{id} {due, override_reason}——原因必填，改后条目 source=manual、自动重算不再覆盖。每次打开重挂载拿最新 d 作初值 */
function RescheduleDialog({ d, onClose }: { d: DeadlineItem; onClose(): void }) {
  const overrideDeadline = useStudio((s) => s.overrideDeadline)
  const toast = useStudio((s) => s.toast)
  const [due, setDue] = useState(d.due)
  const [reason, setReason] = useState(d.override_reason ?? '')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const uid = useId()
  const dirty = due !== d.due || reason !== (d.override_reason ?? '')
  useBeforeUnload(() => dirty)
  const requestClose = () => {
    if (busy) return
    if (dirty) setAsk(true)
    else onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose() }}>
      <DialogContent size="sm" data-testid={`reschedule-dialog-${d.id}`}>
        <DialogHeader>
          <DialogTitle>期限改期</DialogTitle>
          <DialogDescription>「{d.title}」当前届满 {d.due}；改期后记为人工期限，自动重算不再覆盖它。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy) return
            setBusy(true)
            const ok = await overrideDeadline(d.pid, d.id, due, reason.trim())
            setBusy(false)
            if (ok) {
              toast(`已改期至 ${due}`, 'success')
              onClose()
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${uid}-due`}>新届满日</Label>
            <Input id={`${uid}-due`} type="date" required value={due} onChange={(e) => setDue(e.target.value)} data-testid="reschedule-due" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-reason`}>改期原因</Label>
            <Input id={`${uid}-reason`} required maxLength={OVERRIDE_REASON_MAX} placeholder="例如：官方通知延期 / 客户确认顺延" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reschedule-reason" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>取消</Button>
            <Button type="submit" disabled={busy || !due || !reason.trim()} data-testid="reschedule-submit">确认改期</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); onClose() }} />
    </Dialog>
  )
}

/** 行动作：催办（有责任人才可） / 改期 / 完成 ⇄ 撤销；桌面 ghost sm，375 卡片二级动作 md 36 平分一行（命中区 touchHit ≥ 44，06 §2.1） */
function RowActions({ d, mobile }: { d: DeadlineItem; mobile: boolean }) {
  const nudge = useStudio((s) => s.nudgeDeadline)
  const setDone = useStudio((s) => s.setDeadlineDone)
  const [resched, setResched] = useState(false)
  const [actBusy, setActBusy] = useState(false)
  const size = mobile ? 'md' : 'sm'
  // R77-01：完成/催办/改期服务端门槛 agent——viewer/reviewer 行上禁用（my_role 缺省=AUTH off 视为可写）
  const canManage = !d.my_role || ROLE_RANK[d.my_role] >= ROLE_RANK.agent
  const manageTitle = canManage ? undefined : '需要主管及以上角色'
  // 双击闸：催办会给责任人发通知、完成切换是写请求，连点须单飞
  const fire = (op: () => Promise<boolean>) => {
    if (actBusy) return
    setActBusy(true)
    void op().finally(() => setActBusy(false))
  }
  return (
    <div className={cn('flex items-center justify-end', mobile ? 'w-full gap-group-m [&>*]:flex-1' : 'gap-1')}>
      {!d.done && (
        <Button variant={mobile ? 'secondary' : 'ghost'} size={size} onClick={() => fire(() => nudge(d.pid, d.id))} disabled={!d.owner || !canManage || actBusy} title={!d.owner ? '未指定责任人' : manageTitle} data-testid={`nudge-${d.id}`}>
          <BellRing aria-hidden />
          催办
        </Button>
      )}
      {!d.done && (
        <Button variant={mobile ? 'secondary' : 'ghost'} size={size} onClick={() => setResched(true)} disabled={!canManage} title={manageTitle} data-testid={`reschedule-${d.id}`}>
          <CalendarClock aria-hidden />
          改期
        </Button>
      )}
      <Button variant={mobile ? 'secondary' : 'ghost'} size={size} onClick={() => fire(() => setDone(d.pid, d.id, !d.done))} disabled={!canManage || actBusy} title={manageTitle} data-testid={`done-${d.id}`}>
        {d.done ? <Undo2 aria-hidden /> : <Check aria-hidden />}
        {d.done ? '撤销完成' : '完成'}
      </Button>
      {resched && <RescheduleDialog d={d} onClose={() => setResched(false)} />}
    </div>
  )
}

const CASE_LINK = cn('inline-flex max-w-full items-center truncate text-fg-strong hover:text-link hover:underline rounded-xs', FOCUS_RING, TRANSITION_COLOR)

/** 「目标递交」是期限分组之外的只读组（不进 overdue / today / … 分桶，也不计入待办） */
const TARGET_GROUP = 'target'
type GroupKey = DeadlineGroup | typeof TARGET_GROUP
const GROUP_LABEL: Record<GroupKey, string> = { ...DEADLINE_GROUP_LABEL, [TARGET_GROUP]: '目标递交' }

type OpenMap = Record<GroupKey, boolean>
const DEFAULT_OPEN: OpenMap = { target: true, overdue: true, today: true, '7d': true, '30d': true, later: true, done: false }

function useGroupOpen() {
  const [open, setOpen] = useState<OpenMap>(() => readDeadlineGroupOpen(DEFAULT_OPEN))
  const toggle = (g: GroupKey) =>
    setOpen((o) => {
      const next = { ...o, [g]: !o[g] }
      try {
        localStorage.setItem(DEADLINE_GROUP_OPEN_KEY, JSON.stringify(next))
      } catch {
        /* 隐私模式等 */
      }
      return next
    })
  return { open, toggle }
}

/** 分组头内容：chevron + 标题 + Count（整行可点折叠；已完成组默认折叠） */
function GroupHeading({ group, n, open, onToggle, className }: { group: GroupKey; n: number; open: boolean; onToggle(): void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn('flex w-full items-center gap-2 text-left text-xs font-medium text-fg-muted hover:text-fg-strong', FOCUS_RING, TRANSITION_COLOR, className)}
      data-testid={`group-toggle-${group}`}
    >
      <ChevronDown className={cn('size-3.5 shrink-0 text-fg-icon motion-safe:transition-transform', !open && '-rotate-90')} aria-hidden />
      {group === TARGET_GROUP && <Target className="size-3.5 shrink-0 text-fg-icon" aria-hidden />}
      {GROUP_LABEL[group]}
      <Count value={n} size="sm" showZero data-testid={`group-count-${group}`} />
    </button>
  )
}

/** 分组行：32 高、粘性、`--bg-sunken`；空组不渲染（S1 变体没有空分组占位） */
function GroupRow({ group, n, colSpan, open, onToggle }: { group: GroupKey; n: number; colSpan: number; open: boolean; onToggle(): void }) {
  return (
    <tr data-slot="deadline-group" data-testid={`group-${group}`} data-state={open ? 'open' : 'closed'} className="sticky top-row-compact z-sticky">
      <th colSpan={colSpan} scope="rowgroup" className="h-md-control border-y border-border bg-sunken px-3 text-left">
        <GroupHeading group={group} n={n} open={open} onToggle={onToggle} className="h-full" />
      </th>
    </tr>
  )
}

/**
 * 1440 表格（S1 变体，05 §4）：案号 120 · 事项（案名 + 类型）· 届满日 112 · 期限热度 120 · 状态 96 · 责任人 140 · 操作 160；
 * 分组以粘性组行分隔（逾期 / 今日 / 7 天内 / 30 天内 / 30 天以后 / 已完成），行 --row-h 40，表头 32。
 */
function DesktopTable({ groups, targets }: { groups: Record<DeadlineGroup, DeadlineItem[]>; targets: TargetFilingItem[] }) {
  const COLS = 7
  const { open, toggle } = useGroupOpen()
  return (
    <Table className="table-fixed" data-testid="deadline-groups">
      <colgroup>
        <col className="w-30" />
        <col />
        <col className="w-28" />
        <col className="w-30" />
        <col className="w-24" />
        <col className="w-36" />
        <col className="w-60" />
      </colgroup>
      <TableHeader className="bg-panel">
        <TableRow className="hover:bg-transparent">
          <TableHead>案号</TableHead>
          <TableHead>事项</TableHead>
          <TableHead>届满日</TableHead>
          <TableHead>期限</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>责任人</TableHead>
          <TableHead>
            <span className="sr-only">操作</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {targets.length > 0 && (
          <Fragment key={TARGET_GROUP}>
            <GroupRow group={TARGET_GROUP} n={targets.length} colSpan={COLS} open={open.target} onToggle={() => toggle(TARGET_GROUP)} />
            {open.target && targets.map((t) => (
              <TableRow key={t.pid} data-testid={`target-${t.pid}`} className="group/row hover:bg-hover">
                <TableCell className="text-xs text-fg-muted tabular-nums">{t.case_no || '—'}</TableCell>
                <TableCell className="min-w-0">
                  <div className="flex min-w-0 flex-col leading-tight">
                    <a href={`#${projectHash(t.pid)}`} className={CASE_LINK} title={t.title} data-testid={`target-link-${t.pid}`}>
                      <span className="truncate">{t.title}</span>
                    </a>
                    <span className="truncate text-xs text-fg-muted"
                      title={`目标递交日（代理机构自定，非法定期限）${t.client ? ` · ${t.client}` : ''}`}>
                      目标递交日（代理机构自定，非法定期限）
                      {t.client && ` · ${t.client}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{t.target_filing}</TableCell>
                <TableCell>
                  <TargetHeat t={t} />
                </TableCell>
                <TableCell className="text-sm text-fg-muted">目标</TableCell>
                <TableCell className="text-sm">
                  <Owner owner={t.owner} />
                </TableCell>
                <TableCell className="pr-2 text-right text-xs text-fg-subtle">只读</TableCell>
              </TableRow>
            ))}
          </Fragment>
        )}
        {DEADLINE_GROUPS.filter((g) => groups[g].length > 0).map((g) => (
          <Fragment key={g}>
            <GroupRow group={g} n={groups[g].length} colSpan={COLS} open={open[g]} onToggle={() => toggle(g)} />
            {open[g] && groups[g].map((d) => (
              <TableRow key={`${d.pid}/${d.id}`} data-testid={`deadline-${d.id}`} data-status={d.status} className="group/row hover:bg-hover">
                <TableCell className="text-xs text-fg-muted tabular-nums">{d.case_no || '—'}</TableCell>
                <TableCell className="min-w-0">
                  <div className="flex min-w-0 flex-col leading-tight">
                    <a href={`#${projectHash(d.pid)}`} className={CASE_LINK} title={d.title} data-testid={`deadline-link-${d.id}`}>
                      <span className="truncate" title={d.title}>{d.title}</span>
                    </a>
                    <span className="truncate text-xs text-fg-muted" title={d.source === 'manual' && d.override_reason ? `人工改写：${d.override_reason}` : (d.legal_basis?.text ?? undefined)}>
                      {DEADLINE_KIND_LABEL[d.kind]}
                      {d.source === 'manual' && ` · 人工改写${d.override_reason ? `：${d.override_reason}` : ''}`}
                      {d.client && ` · ${d.client}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  <div className="flex flex-col leading-tight">
                    <span>{d.due}</span>
                    {d.holidays_verified === false && <HolidayUncertain />}
                  </div>
                </TableCell>
                <TableCell>
                  <DeadlineHeat d={d} />
                </TableCell>
                <TableCell>
                  <DeadlineStatusDot status={d.status} />
                </TableCell>
                <TableCell className="text-sm">
                  <Owner owner={d.owner} />
                </TableCell>
                <TableCell className="pr-2 text-right">
                  <RowActions d={d} mobile={false} />
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}

/** 375 组头（06 §3.2 ②）：视觉 sm 32（标题 13/500），整行可点折叠，命中区 touchHit ≥ 44；与卡片间 8（所在 section gap-group-m） */
const MOBILE_GROUP_SECTION = 'flex min-w-0 flex-col gap-group-m'
const MOBILE_GROUP_HEADING = cn('min-h-sm-control', touchHit)
/** 375 卡片（06 §3.1）：内边距 16 / 行间 8 / 卡片间 12 */
const MOBILE_CARD = 'flex flex-col gap-group-m rounded-md border border-border bg-panel p-card-m shadow-sm'
const MOBILE_CARD_LIST = 'flex flex-col gap-cards-m'
const MOBILE_CARD_META = 'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted'

/** 375（06 §4 期限中心）：组 = MobilePage 区块（间 24），组头 32 → 卡片栈（标题行 ≥ 44 命中 · 元信息 · md 36 动作一行） */
function MobileList({ groups, targets }: { groups: Record<DeadlineGroup, DeadlineItem[]>; targets: TargetFilingItem[] }) {
  const { open, toggle } = useGroupOpen()
  return (
    <div className="flex flex-col gap-section-m" data-testid="deadline-groups">
      {targets.length > 0 && (
        <section data-testid={`group-${TARGET_GROUP}`} data-state={open.target ? 'open' : 'closed'} aria-label={GROUP_LABEL.target} className={MOBILE_GROUP_SECTION}>
          <h2 className="flex items-center">
            <GroupHeading group={TARGET_GROUP} n={targets.length} open={open.target} onToggle={() => toggle(TARGET_GROUP)} className={MOBILE_GROUP_HEADING} />
          </h2>
          {open.target && (
            <ul className={MOBILE_CARD_LIST}>
              {targets.map((t) => (
                <li key={t.pid} data-testid={`target-${t.pid}`} className={MOBILE_CARD}>
                  <div className="flex items-start justify-between gap-group-m">
                    <a href={`#${projectHash(t.pid)}`} className={cn('line-clamp-2 min-h-touch min-w-0 flex-1 py-2 text-base font-medium leading-snug text-fg-strong', FOCUS_RING)} data-testid={`target-link-${t.pid}`}>
                      {t.title}
                    </a>
                    <TargetHeat t={t} size="md" />
                  </div>
                  <div className={MOBILE_CARD_META}>
                    <span className="tabular-nums">{t.case_no || '未取号'}</span>
                    <span className="tabular-nums">目标递交 {t.target_filing}</span>
                    {t.client && <span>{t.client}</span>}
                    <Owner owner={t.owner} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {DEADLINE_GROUPS.filter((g) => groups[g].length > 0).map((g) => (
        <section key={g} data-testid={`group-${g}`} data-state={open[g] ? 'open' : 'closed'} aria-label={DEADLINE_GROUP_LABEL[g]} className={MOBILE_GROUP_SECTION}>
          <h2 className="flex items-center">
            <GroupHeading group={g} n={groups[g].length} open={open[g]} onToggle={() => toggle(g)} className={MOBILE_GROUP_HEADING} />
          </h2>
          {open[g] && (
          <ul id={`deadline-group-${g}`} className={MOBILE_CARD_LIST}>
            {groups[g].map((d) => (
              <li key={`${d.pid}/${d.id}`} data-testid={`deadline-${d.id}`} data-status={d.status} className={MOBILE_CARD}>
                <div className="flex items-start justify-between gap-group-m">
                  <a href={`#${projectHash(d.pid)}`} className={cn('line-clamp-2 min-h-touch min-w-0 flex-1 py-2 text-base font-medium leading-snug text-fg-strong', FOCUS_RING)} data-testid={`deadline-link-${d.id}`}>
                    {d.title}
                  </a>
                  <DeadlineHeat d={d} size="md" />
                </div>
                <div className={MOBILE_CARD_META}>
                  <span className="tabular-nums">{d.case_no || '未取号'}</span>
                  <span>{DEADLINE_KIND_LABEL[d.kind]}</span>
                  <span className="tabular-nums">届满 {d.due}</span>
                  {d.holidays_verified === false && <HolidayUncertain />}
                  <DeadlineStatusDot status={d.status} className="text-xs" />
                  <Owner owner={d.owner} compact />
                </div>
                <RowActions d={d} mobile />
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
    </div>
  )
}

/** 375 类型 chip（06 §2.1 / §3.2 ③）：视觉 sm 32，aria-pressed 选中，命中区 touchHit ≥ 44，容器 ScrollRow 不裁切 */
const KIND_CHIP = cn(
  'inline-flex h-sm-control shrink-0 items-center gap-inline-m whitespace-nowrap rounded-full border border-border bg-panel px-3 text-sm text-fg hover:bg-hover aria-[pressed=true]:border-fg-strong aria-[pressed=true]:bg-selected aria-[pressed=true]:font-medium aria-[pressed=true]:text-fg-strong',
  touchHit,
  FOCUS_RING,
  TRANSITION_COLOR,
)

/**
 * 筛选：桌面 = 三个 Select sm 一行（PageHeader 右侧）；
 * 375（06 §4 期限中心）= 类型 chips ScrollRow sm 32 → 责任人 / 客户 Select lg 44 一行两列（gap 8），清除为 chip 行末 ghost sm。
 */
function Filters({ mobile }: { mobile: boolean }) {
  const filter = useStudio((s) => s.deadlinesFilter)
  const load = useStudio((s) => s.loadDeadlines)
  const items = useStudio((s) => s.deadlines)
  const options = useMemo(() => selectDeadlineFilterOptions({ deadlines: items }), [items])
  const active = [filter.owner, filter.client, filter.kind].filter(Boolean).length
  const size = mobile ? 'lg' : 'sm'
  const sel = (v: string) => (v === ALL ? null : v)
  const owners = filter.owner && !options.owners.some((o) => o.id === filter.owner) ? [...options.owners, { id: filter.owner, name: filter.owner }] : options.owners
  const clients = filter.client && !options.clients.includes(filter.client) ? [...options.clients, filter.client] : options.clients
  const kinds = filter.kind && !options.kinds.includes(filter.kind as DeadlineKind) ? [...options.kinds, filter.kind as DeadlineKind] : options.kinds
  const kindChips = mobile && (
    <ScrollRow role="group" aria-label="期限类型" data-testid="filter-kind-chips">
      <button type="button" aria-pressed={!filter.kind} onClick={() => void load({ kind: null })} className={KIND_CHIP} data-testid="filter-kind-all">
        全部类型
      </button>
      {kinds.map((k) => (
        <button key={k} type="button" aria-pressed={filter.kind === k} onClick={() => void load({ kind: filter.kind === k ? null : k })} className={KIND_CHIP} data-testid={`filter-kind-${k}`}>
          {DEADLINE_KIND_LABEL[k]}
        </button>
      ))}
      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={() => void load({ owner: null, client: null, kind: null })} data-testid="deadline-filter-clear">
          <RotateCcw aria-hidden />
          清除筛选（{active}）
        </Button>
      )}
    </ScrollRow>
  )
  return (
    <div className={cn(mobile ? 'flex min-w-0 flex-col gap-group-m' : 'flex flex-wrap items-center gap-2')} data-testid="deadline-filters">
      {kindChips}
      <div className={mobile ? 'grid grid-cols-2 items-center gap-group-m' : 'contents'} data-testid="deadline-filter-selects">
      <Select value={filter.owner ?? ALL} onValueChange={(v) => void load({ owner: sel(v) })}>
        <SelectTrigger size={size} className={mobile ? '' : 'w-32'} aria-label="责任人" data-testid="filter-owner">
          <SelectValue placeholder="责任人" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部责任人</SelectItem>
          {owners.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filter.client ?? ALL} onValueChange={(v) => void load({ client: sel(v) })}>
        <SelectTrigger size={size} className={mobile ? '' : 'w-32'} aria-label="客户" data-testid="filter-client">
          <SelectValue placeholder="客户" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部客户</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>
      {!mobile && (
        <Select value={filter.kind ?? ALL} onValueChange={(v) => void load({ kind: sel(v) })}>
          <SelectTrigger size={size} className="w-32" aria-label="期限类型" data-testid="filter-kind">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部类型</SelectItem>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {DEADLINE_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {!mobile && active > 0 && (
        <Button variant="ghost" size={size} onClick={() => void load({ owner: null, client: null, kind: null })} data-testid="deadline-filter-clear">
          <RotateCcw aria-hidden />
          清除筛选（{active}）
        </Button>
      )}
    </div>
  )
}

/**
 * `#/deadlines` 期限中心（05 §4「S1 表格变体」）：机构壳 + `PageHeader` H1「期限中心」（无 primary，筛选 3 个 Select sm 放右侧）
 * → 分组表：案号 / 事项 / 届满日 / 期限 `Heat` / 状态点 / 责任人 / 催办·完成；375 = 粘性组头 + 卡片，控件 44。
 * 后端唯一权威（B7）：due / days_left / status 直出，热度阈值 = store/deadlines 7d / 30d 分桶（不改）；页脚免责。
 * 四态：501 → EmptyState「功能开发中」；错误 → 重试；加载 → Skeleton 8 行；空 → 说明如何录入。
 */
export function DeadlinesPage() {
  const isDesktop = useIsDesktop()
  const mobile = !isDesktop
  const items = useStudio((s) => s.deadlines)
  const targets = useStudio((s) => s.deadlineTargets)
  const loading = useStudio((s) => s.deadlinesLoading)
  const unavailable = useStudio((s) => s.deadlinesUnavailable)
  const error = useStudio((s) => s.deadlinesError)
  const holidaysMissing = useStudio((s) => s.deadlinesHolidaysMissing)
  const load = useStudio((s) => s.loadDeadlines)
  const groups = useMemo(() => selectDeadlineGroups({ deadlines: items }), [items])
  const pending = items.filter((d) => !d.done).length
  const overdue = groups.overdue.length

  useEffect(() => {
    void load()
  }, [load])

  /* 进案卷再回来把列表滚动位置写回（会话内存）；mobile 走页面级滚动，ref 不存在时空操作 */
  const bodyWrap = useRef<HTMLDivElement>(null)
  const resolveScroller = useCallback(() => bodyWrap.current, [])
  usePageScroll('deadlines', !(loading && items.length === 0 && targets.length === 0), resolveScroller)

  let body: ReactNode
  if (unavailable) {
    body = <EmptyState icon={CalendarClock} title={NOT_IMPLEMENTED_TITLE} reason="期限中心的后端接口尚未上线。上线后，这里会汇总所有案卷的 OA 答复、实审请求、优先权与年费期限。" data-testid="deadlines-empty" />
  } else if (error && items.length === 0) {
    body = (
      <EmptyState
        icon={CalendarClock}
        title="期限加载失败"
        reason={error}
        action={
          <Button variant="secondary" onClick={() => void load()} data-testid="deadlines-retry">
            重试
          </Button>
        }
        data-testid="deadlines-error"
      />
    )
  } else if (loading && items.length === 0 && targets.length === 0) {
    body = (
      <div className={cn('flex flex-col', mobile ? 'gap-cards-m' : 'gap-2 px-page-x py-3')} aria-busy="true" role="status" aria-label="加载中" data-testid="deadlines-loading">
        {Array.from({ length: mobile ? 4 : 8 }).map((_, i) => (
          <Skeleton key={i} className={mobile ? 'h-28 rounded-md' : 'h-row rounded-sm'} />
        ))}
      </div>
    )
  } else if (items.length === 0 && targets.length === 0) {
    body = <EmptyState icon={CalendarClock} illustration="/empty-deadline.webp" title="暂无期限" reason="所有案卷都没有待办期限。在案卷「期限」面板录入官方通知书日期后，系统会在这里汇总推算结果。" action={<Button variant="secondary" onClick={() => { window.location.hash = '/' }} data-testid="deadlines-go-cases">去案卷录入</Button>} data-testid="deadlines-empty" />
  } else {
    body = mobile ? <MobileList groups={groups} targets={targets} /> : <DesktopTable groups={groups} targets={targets} />
  }

  const summary = (
    <>
      <span data-testid="deadline-pending">{loading && items.length === 0 ? '正在刷新…' : `${pending} 项待办`}</span>
      {overdue > 0 && <span className="text-danger-fg">，其中 {overdue} 项逾期</span>}
      {!(loading && items.length === 0) && targets.length > 0 && (
        <span className="text-fg-muted" data-testid="deadline-target-count">
          ；另 {targets.length} 项目标递交不计入待办
        </span>
      )}
    </>
  )
  // 375：免责为 MobilePage 最后一个区块，由 MobilePage 底部 padding 为 Tab bar + safe-area 让位（不与 Tab bar 重叠）
  const disclaimer = (
    <p className={cn('text-center text-xs text-fg-muted', mobile ? 'shrink-0' : 'shrink-0 border-t border-border px-4 py-2')} data-testid="deadline-disclaimer">
      系统推算，以官方通知书为准
    </p>
  )
  const holidays = holidaysMissing && (
    <Alert variant="warn" data-testid="deadlines-holidays-missing" className={mobile ? undefined : 'mx-page-x mt-3'}>
      <AlertDescription>未加载法定节假日表，届满日只按周末顺延；请以官方通知书为准。</AlertDescription>
    </Alert>
  )

  if (mobile) {
    return (
      <OrgShell
        name="deadlines"
        title="期限"
        current="deadlines"
        mobile
        mobileTitle={
          <>
            期限中心 <span className="font-normal text-fg-muted tabular-nums" data-testid="deadline-pending">{pending}</span>
          </>
        }
      >
        <MobilePage data-testid="deadlines-page">
          <Filters mobile />
          {holidays}
          <div className="flex min-w-0 flex-col">{body}</div>
          {disclaimer}
        </MobilePage>
      </OrgShell>
    )
  }

  return (
    <OrgShell name="deadlines" title="期限" current="deadlines" mobile={false}>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-panel" aria-label="期限中心">
        <PageHeader
          size="lg"
          title="期限中心"
          description={summary}
          className="bg-panel py-4 md:py-4"
          actions={<Filters mobile={false} />}
        />
        {holidays}
        <div ref={bodyWrap} className="min-h-0 flex-1 overflow-auto px-page-x py-3">{body}</div>
        {disclaimer}
      </main>
    </OrgShell>
  )
}
