import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Heat（05 §2.6）：期限热度 3 档 —— 0 >30 天中性 / 1 7<d≤30 warn / 2 ≤7 天或逾期 danger。
 * 阈值 = store/deadlines.ts 7d / 30d 分桶（不改）；`heatOf(daysLeft)` 是唯一换算入口，单元不要自算颜色。
 * 渲染：18 高 pill（--heat-N-bg / fg）+ 文字（默认 `N 天` / `逾期 N 天` / `今天`）；heat-0 无底只文字。颜色不单独承载信息，永远带文字。
 */
export type HeatLevel = 0 | 1 | 2

export function heatOf(daysLeft: number | null | undefined): HeatLevel {
  if (daysLeft == null) return 0
  if (daysLeft <= 7) return 2
  if (daysLeft <= 30) return 1
  return 0
}

export function heatLabel(daysLeft: number | null | undefined): string {
  if (daysLeft == null) return '无期限'
  if (daysLeft < 0) return `逾期 ${-daysLeft} 天`
  if (daysLeft === 0) return '今天'
  return `剩 ${daysLeft} 天`
}

export interface HeatProps extends React.ComponentProps<'span'> {
  /** 剩余天数（负数 = 逾期）；与 level 二选一 */
  daysLeft?: number | null
  level?: HeatLevel
  size?: 'sm' | 'md'
  children?: React.ReactNode
}

function Heat({ className, daysLeft, level, size = 'sm', children, ...props }: HeatProps) {
  const lv = level ?? heatOf(daysLeft)
  return (
    <span
      data-slot="heat"
      data-heat={lv}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium tabular-nums',
        size === 'md' ? 'h-5 px-2 text-xs' : 'h-4.5 px-1.5 text-2xs',
        lv === 0 && 'px-0',
        className,
      )}
      {...props}
    >
      {children ?? heatLabel(daysLeft)}
    </span>
  )
}

export { Heat }
