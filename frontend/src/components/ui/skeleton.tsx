import * as React from 'react'
import { cn } from '@/lib/utils'

/** Skeleton（05 §2.11）：--bg-sunken r4 透明度呼吸（reduced-motion → 静态）；`lines` 快速生成 N 行文本骨架（表格加载态默认 5 行） */
export interface SkeletonProps extends React.ComponentProps<'div'> {
  lines?: number
}

function Skeleton({ className, lines, ...props }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div data-slot="skeleton-lines" aria-hidden className={cn('flex flex-col gap-2', className)} {...props}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} data-slot="skeleton" className={cn('h-4 animate-pulse rounded-sm bg-sunken motion-reduce:animate-none', i === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    )
  }
  return <div data-slot="skeleton" aria-hidden className={cn('animate-pulse rounded-sm bg-sunken motion-reduce:animate-none', className)} {...props} />
}

export { Skeleton }
