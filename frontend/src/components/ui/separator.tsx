import { cn } from '@/lib/utils'

interface SeparatorProps {
  className?: string
  orientation?: 'horizontal' | 'vertical'
  /** 纯装饰（默认）：role=none；语义分隔传 false */
  decorative?: boolean
}

function Separator({ className, orientation = 'horizontal', decorative = true }: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  )
}

export { Separator }
