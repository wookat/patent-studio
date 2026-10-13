import { Heat, heatLabel } from '@/components/ui/heat'
import { cn } from '@/lib/utils'
import type { NextDeadline } from '@/types/case'
import { DEADLINE_KIND_LABEL } from '@/types/deadlines'
import type { DeadlineKind } from '@/types/deadlines'
/** case.json 旧内置期限种类（types/case Deadline.kind）在 W5 枚举之外的中文名 */
const LEGACY_KIND_LABEL: Record<string, string> = { client_review: '客户确认', filing: '递交', target_filing: '目标递交' }

export const deadlineKindLabel = (kind: string) => (kind in DEADLINE_KIND_LABEL ? DEADLINE_KIND_LABEL[kind as DeadlineKind] : (LEGACY_KIND_LABEL[kind] ?? kind))

/**
 * 「目标递交 T-N」文案（W7 ux-04）：N = 后端 target_filing_days_left（Asia/Shanghai，与 days_left 同源；前端不算日期）。
 * T-N 距目标日 N 天；T+N 已过目标日 N 天；T-0 今天。null ⇒ ''（无目标递交日不显示）。
 */
export function targetFilingLabel(daysLeft: number | null | undefined): string {
  if (daysLeft == null) return ''
  return daysLeft < 0 ? `目标递交 T+${-daysLeft}` : `目标递交 T-${daysLeft}`
}

/** 目标递交 Heat pill：热度分桶与普通期限一致（≤7 danger / ≤30 warn），逾期用 T+N 表达 */
export function TargetFilingHeat({ daysLeft, size, className, ...props }: { daysLeft: number | null | undefined; size?: 'sm' | 'md'; className?: string } & Omit<React.ComponentProps<'span'>, 'children'>) {
  if (daysLeft == null) return null
  return (
    <Heat daysLeft={daysLeft} size={size} className={className} data-testid="target-filing-heat" {...props}>
      {targetFilingLabel(daysLeft)}
    </Heat>
  )
}

export interface DeadlineCellProps {
  d: NextDeadline | null
  /** 只读「目标递交」倒计时（case.target_filing_days_left）；null / undefined 不显示 */
  targetDaysLeft?: number | null
  /** 只显 Heat pill（看板卡 / 移动卡右上角） */
  compact?: boolean
  className?: string
}

/**
 * 「最近期限」单元（05 §2.6 / §3.12）：`Heat sm`（后端 days_left → heatOf 7/30 分桶）+ `MM-DD 事项` 12px --fg-muted；
 * 有 target_filing 时再跟一枚「目标递交 T-N」Heat（同分桶，ux-04）。
 * 两者都无显示 —；不做任何日期推算（B7），也不再画进度条。
 */
export function DeadlineCell({ d, targetDaysLeft, compact, className }: DeadlineCellProps) {
  if (!d && targetDaysLeft == null) return <span className={cn('text-fg-subtle', className)}>—</span>
  const title = [d && `${deadlineKindLabel(d.kind)} · ${d.due}${d.note ? ` · ${d.note}` : ''}`, targetDaysLeft != null && targetFilingLabel(targetDaysLeft)].filter(Boolean).join(' · ')
  return (
    <span data-slot="DeadlineCell" data-testid="deadline-cell" className={cn('inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap', className)} title={title}>
      {d && <Heat daysLeft={d.days_left}>{heatLabel(d.days_left)}</Heat>}
      {d && !compact && (
        <span className="truncate text-xs text-fg-muted tabular-nums">
          {d.due.slice(5)} {deadlineKindLabel(d.kind)}
        </span>
      )}
      <TargetFilingHeat daysLeft={targetDaysLeft} />
    </span>
  )
}
