import * as React from 'react'
import { cn } from '@/lib/utils'

/** ScrollArea：原生 overflow 滚动 + 细滚动条（不引 radix scroll-area）；orientation 控制方向 */
interface ScrollAreaProps extends React.ComponentProps<'div'> {
  orientation?: 'vertical' | 'horizontal' | 'both'
}

function ScrollArea({ className, orientation = 'vertical', children, ...props }: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      data-orientation={orientation}
      className={cn(
        'relative min-h-0 min-w-0 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]',
        orientation === 'vertical' && 'overflow-y-auto overflow-x-hidden',
        orientation === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        orientation === 'both' && 'overflow-auto',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
