import * as React from 'react'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'

/**
 * ScrollRow（06 §3.2 ③）：横向可滑不裁切的 chip / Tab / 步骤条容器。
 * - overflow-x auto + 隐藏滚动条（scrollbar-none）；首末内边距 16（--pad-page-m）；元素间 8（--gap-group-m）。
 * - `bleed`（默认 true）：-mx-page-m 出血到页边，内容与页边对齐、滑动区到屏边。
 * - 上下 py-2 / -my-2：给 touchHit 伪元素热区（sm 32 → 44）留位，不改变纵向节奏。
 * - 键盘：容器 tabIndex=0，← → 滚动一屏的 60%；子控件 Tab 序不变。
 * - relative：作为绝对定位后代（sr-only 状态文字等）的包含块，让它们随内容一起被裁切，不撑宽 document。
 */
export interface ScrollRowProps extends React.ComponentProps<'div'> {
  bleed?: boolean
}

function ScrollRow({ className, bleed = true, onKeyDown, children, ...props }: ScrollRowProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.target !== e.currentTarget) return
    const el = ref.current
    if (!el) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      el.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * el.clientWidth * 0.6, behavior: 'smooth' })
    }
  }
  return (
    <div
      ref={ref}
      data-slot="scroll-row"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex min-w-0 shrink-0 items-center gap-group-m overflow-x-auto scrollbar-none -my-2 py-2 px-page-m whitespace-nowrap [&>*]:shrink-0',
        bleed && '-mx-page-m',
        FOCUS_RING_INSET,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollRow }
