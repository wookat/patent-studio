import * as React from 'react'
import { cn } from '@/lib/utils'

/** Progress（role=progressbar）：value 0–100；value 省略 = 不确定态（条纹动画） */
export interface ProgressProps extends React.ComponentProps<'div'> {
  value?: number
  max?: number
  label?: string
}

function Progress({ className, value, max = 100, label, ...props }: ProgressProps) {
  const pct = value == null ? undefined : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      role="progressbar"
      data-slot="progress"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn('h-full rounded-full bg-primary transition-[width] duration-(--dur-panel)', pct == null && 'w-1/3 animate-pulse')}
        style={pct == null ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress }
