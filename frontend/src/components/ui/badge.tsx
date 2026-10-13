import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge（05 §2.4 拆三之一）：语义 tone 徽章 —— 20 高 / 12px 500 / pill / 7 族 -bg + -fg（neutral = sunken + fg-muted）。
 * 案件状态请用 StatusDot（点 + 文字，禁 dotOnly）；案卷标签用 Tag；计数用 Count。
 */
const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-fg-muted',
        info: 'bg-info-bg text-info-fg',
        ok: 'bg-ok-bg text-ok-fg',
        warn: 'bg-warn-bg text-warn-fg',
        danger: 'bg-danger-bg text-danger-fg',
        violet: 'bg-violet-bg text-violet-fg',
        teal: 'bg-teal-bg text-teal-fg',
        orange: 'bg-orange-bg text-orange-fg',
        brand: 'bg-primary-soft text-link',
        outline: 'border border-border-strong bg-transparent text-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" data-tone={tone ?? 'neutral'} className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
