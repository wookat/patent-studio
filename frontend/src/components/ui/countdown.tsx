import * as React from 'react'
import { cn } from '@/lib/utils'
import { heatLabel, heatOf, type HeatLevel } from './heat'

/**
 * Countdown（05 §2.6）：`剩 N 天` / `逾期 N 天` / `今天`，tabular-nums；md 14/22（列表）/ lg 20/28（客户审阅头、期限中心组头）。
 * 颜色随 Heat（--heat-N-fg），不单独用色：始终含文字；可选 `date` 副行（12px --fg-muted）。
 */
export interface CountdownProps extends React.ComponentProps<'span'> {
  daysLeft: number | null | undefined
  size?: 'md' | 'lg'
  /** 副行：到期日文本（如 2026-09-30） */
  date?: string
  level?: HeatLevel
}

function Countdown({ className, daysLeft, size = 'md', date, level, ...props }: CountdownProps) {
  const lv = level ?? heatOf(daysLeft)
  return (
    <span
      data-slot="countdown"
      data-heat={lv}
      className={cn('inline-flex flex-col items-start leading-none', className)}
      {...props}
    >
      <span data-slot="countdown-value" className={cn('font-medium tabular-nums', size === 'lg' ? 'text-xl' : 'text-base')}>
        {heatLabel(daysLeft)}
      </span>
      {date && <span data-slot="countdown-date" className="mt-0.5 text-xs text-fg-muted tabular-nums">{date}</span>}
    </span>
  )
}

export { Countdown }
