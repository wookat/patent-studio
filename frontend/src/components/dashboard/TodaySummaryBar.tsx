import { useMemo } from 'react'
import { AlarmClock, AtSign, CalendarClock, FileCheck2, MessageSquareText, UserRound, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ScrollRow } from '@/components/ui/scroll-row'
import { deadlinesHash } from '@/lib/hash'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { selectDueRows, useStudio } from '@/store'
import { DASH_FOCUS_LABEL, selectTodayCounts } from '@/store/dashboard'
import type { DashFocus } from '@/store/dashboard'

type Tone = 'danger' | 'warn' | 'info' | 'violet' | 'teal'

const TONE: Record<Tone, string> = {
  danger: 'text-danger-fg [&_b]:text-danger-fg',
  warn: 'text-warn-fg [&_b]:text-warn-fg',
  info: 'text-fg-muted [&_b]:text-fg-strong',
  violet: 'text-fg-muted [&_b]:text-fg-strong',
  teal: 'text-fg-muted [&_b]:text-fg-strong',
}

/** 四张筛选 chip 同一套语义：chip 上数字 = 点它之后的列表行数（store.selectTodayCounts） */
export const FOCUS_PILLS: { focus: DashFocus; label: string; icon: LucideIcon; tone: Tone }[] = [
  { focus: 'mine', label: DASH_FOCUS_LABEL.mine, icon: UserRound, tone: 'info' },
  { focus: 'review', label: DASH_FOCUS_LABEL.review, icon: MessageSquareText, tone: 'info' },
  { focus: 'mention', label: '@ 我', icon: AtSign, tone: 'violet' },
  { focus: 'confirm', label: '待客户确认', icon: FileCheck2, tone: 'teal' },
]

interface PillProps {
  icon: LucideIcon
  label: string
  value: number
  tone: Tone
  pressed?: boolean
  onClick?: () => void
  href?: string
  testId: string
  mobile: boolean
}

/** 筛选 chip = aria-pressed 按钮；到期 chip = 去期限中心的链接（两者同一套尺寸 / 焦点环，键盘 Tab 可达） */
function Pill({ icon: Icon, label, value, tone, pressed, onClick, href, testId, mobile }: PillProps) {
  const cls = cn(
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs bg-panel shadow-sm',
    // 375（06 §2.1）：pill 视觉 sm 32，命中区 touchHit ≥ 44
    mobile ? cn('h-sm-control rounded-full px-3 text-sm', touchHit) : 'h-6 px-2 text-xs',
    'hover:bg-hover aria-[pressed=true]:bg-selected aria-[pressed=true]:font-medium aria-[pressed=true]:shadow-none aria-[pressed=true]:ring-1 aria-[pressed=true]:ring-border-strong',
    TONE[tone],
    FOCUS_RING,
    TRANSITION_COLOR,
  )
  const body = (
    <>
      <Icon className={mobile ? 'size-3.5' : 'size-3'} aria-hidden />
      {label}
      <b className="font-semibold tabular-nums" data-testid={testId.replace(/^today-/, 'today-count-')}>
        {value}
      </b>
    </>
  )
  if (href) {
    return (
      <a href={href} className={cls} data-testid={testId}>
        {body}
      </a>
    )
  }
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={cls} data-testid={testId}>
      {body}
    </button>
  )
}

/**
 * 今日摘要条（05 §3.12，替代 4 张 KPI 卡）：h 32 一行 pill 24（移动 32 横滑），**只显示非零**（已选中的筛选 chip 保留以便取消）：
 * `3 天内到期`(danger) · `7 天内到期`(warn) → #/deadlines；`我负责` / `待我审阅` / `@ 我` / `待客户确认` 点击即筛选（store.dashFocus，与列表行数一致，再点取消）。
 * 全零 → 一行 13px --fg-muted「今日无到期事项」，不占卡片空间。
 */
export function TodaySummaryBar({ mobile = false, className }: { mobile?: boolean; className?: string }) {
  const focus = useStudio((s) => s.dashFocus)
  const setFocus = useStudio((s) => s.setDashFocus)
  const counts = useStudio(useShallow(selectTodayCounts))
  const due = useStudio(useShallow((s) => selectDueRows(s)))
  const due3 = useMemo(() => due.filter((p) => (p.case?.next_deadline?.days_left ?? Infinity) <= 3).length, [due])
  const due7 = due.length - due3

  const pills: React.ReactNode[] = []
  if (due3 > 0) pills.push(<Pill key="due3" icon={AlarmClock} label="3 天内到期" value={due3} tone="danger" href={`#${deadlinesHash}`} testId="today-due3" mobile={mobile} />)
  if (due7 > 0) pills.push(<Pill key="due7" icon={CalendarClock} label="7 天内到期" value={due7} tone="warn" href={`#${deadlinesHash}`} testId="today-due7" mobile={mobile} />)
  for (const p of FOCUS_PILLS) {
    const n = counts[p.focus]
    if (n === 0 && focus !== p.focus) continue
    pills.push(<Pill key={p.focus} icon={p.icon} label={p.label} value={n} tone={p.tone} pressed={focus === p.focus} onClick={() => setFocus(p.focus)} testId={`today-${p.focus}`} mobile={mobile} />)
  }

  const content = pills.length ? pills : <span className="text-sm text-fg-muted">{mobile ? '今日无到期事项' : '无到期事项'}</span>
  if (mobile) {
    return (
      <ScrollRow data-slot="TodaySummaryBar" data-testid="today-summary" data-empty={pills.length === 0 || undefined} role="group" aria-label="我的今天" className={className}>
        {content}
      </ScrollRow>
    )
  }
  return (
    <div
      data-slot="TodaySummaryBar"
      data-testid="today-summary"
      data-empty={pills.length === 0 || undefined}
      role="group"
      aria-label="我的今天"
      className={cn('flex h-8 shrink-0 items-center gap-2 overflow-x-auto bg-app px-page-x [scrollbar-width:none]', className)}
    >
      <span className="shrink-0 text-xs text-fg-subtle" aria-hidden>
        今日
      </span>
      {content}
    </div>
  )
}
