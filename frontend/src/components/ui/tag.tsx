import * as React from 'react'
import { X } from 'lucide-react'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'

/**
 * Tag（05 §2.4 拆三之二）：案卷标签 —— 20 高 / 12px / r4（非 pill，与状态区分）/ 1px --border / --bg-panel；
 * `color` 为用户数据色（types/case.ts TAG_COLORS，CSS 变量或颜色串）只做 6px 左侧色点，不染底；`onRemove` 给 16px ×。
 */
export interface TagProps extends React.ComponentProps<'span'> {
  /** 用户自定义标签色（数据值，非样式 token）——渲染为左侧色点 */
  color?: string
  onRemove?: () => void
  removeLabel?: string
}

function Tag({ className, color, onRemove, removeLabel = '移除标签', children, ...props }: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex h-5 max-w-40 items-center gap-1 rounded-sm border border-border bg-panel pl-1.5 text-xs text-fg',
        onRemove ? 'pr-0.5' : 'pr-1.5',
        // 触控（06 §2.3）：可点 / 可删 Tag 视觉 24（h-6），命中区 touchHit ≥ 44；纯展示 Tag 不加热区
        (onRemove || props.onClick) && cn('in-data-[density=touch]:h-6', touchHit),
        className,
      )}
      {...props}
    >
      {color && <span data-slot="tag-dot" className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      <span className="truncate" title={typeof children === 'string' ? children : undefined}>{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel} title={removeLabel}
          onClick={onRemove}
          data-slot="tag-remove"
          className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-fg-muted hover:bg-hover hover:text-fg-strong', touchHit, FOCUS_RING, TRANSITION_COLOR)}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  )
}

export { Tag }
