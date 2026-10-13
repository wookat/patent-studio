import * as React from 'react'
import { BadgeCheck, FileCheck2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, type CaseStatus } from '@/types/case'

/**
 * StatusDot（05 §2.5）：案件状态 = 8px 圆点 + 文字，任何位置都不允许只有点（不依赖色觉）；
 * 同族两态（final / granted 同 ok 绿；intake / filed 同 info 蓝）靠文字 + 图标区分：granted 带 BadgeCheck，filed 带 FileCheck2 且点色更深。
 * variant plain（默认：行内、表格、看板列头，文字 --st-*-fg）/ badge（20 高 pill 浅底，用于卡片 / 详情头）。
 * 颜色由 index.css `[data-status]` 十档 token 注入（--status-fg / --status-dot / --status-bg）。
 */
export interface StatusDotProps extends React.ComponentProps<'span'> {
  status: CaseStatus
  variant?: 'plain' | 'badge'
  size?: 'sm' | 'md'
  /** 覆盖文字（默认 STATUS_LABEL[status]） */
  label?: React.ReactNode
}

const ICON: Partial<Record<CaseStatus, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>>> = {
  granted: BadgeCheck,
  filed: FileCheck2,
}

function StatusDot({ className, status, variant = 'plain', size = 'md', label, ...props }: StatusDotProps) {
  const Icon = ICON[status]
  return (
    <span
      data-slot="status-dot"
      data-status={status}
      data-variant={variant}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium',
        size === 'sm' ? 'text-2xs' : 'text-xs',
        variant === 'badge' && 'h-5 rounded-full pl-2 pr-2.5',
        className,
      )}
      {...props}
    >
      <span data-slot="status-dot-mark" className={cn('shrink-0 rounded-full', size === 'sm' ? 'size-1.5' : 'size-2')} aria-hidden />
      <span data-slot="status-dot-label">{label ?? STATUS_LABEL[status]}</span>
      {Icon && <Icon className={cn('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5')} aria-hidden />}
    </span>
  )
}

export { StatusDot }
