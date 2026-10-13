import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Count（05 §2.4 拆三之三）：计数 pill —— 16 高（sm）/ 18 高（md），11px tabular-nums，min-w = 高；
 * tone neutral（默认，sunken）/ brand（选中 Tab、未读）/ danger（错误数）；`max` 溢出显示 `99+`；0 时默认隐藏（`showZero`）。
 */
export interface CountProps extends React.ComponentProps<'span'> {
  value: number
  max?: number
  size?: 'sm' | 'md'
  tone?: 'neutral' | 'brand' | 'danger' | 'inverse'
  showZero?: boolean
}

const TONE = {
  neutral: 'bg-sunken text-fg-muted',
  brand: 'bg-primary text-primary-foreground',
  danger: 'bg-danger-solid text-danger-solid-fg',
  inverse: 'bg-inverse text-fg-inverse',
} as const

function Count({ className, value, max = 99, size = 'sm', tone = 'neutral', showZero = false, ...props }: CountProps) {
  if (value === 0 && !showZero) return null
  const text = value > max ? `${max}+` : String(value)
  return (
    <span
      data-slot="count"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full px-1.5 text-2xs font-medium leading-none tabular-nums',
        size === 'md' ? 'h-4.5 min-w-4.5' : 'h-4 min-w-4',
        TONE[tone],
        className,
      )}
      {...props}
    >
      {text}
    </span>
  )
}

export { Count }
