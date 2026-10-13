import * as React from 'react'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'

/**
 * Segmented（05 §2.3）：只保留 md 32 / xl 44 两档（旧 sm 28 / 36 下线；传入 'sm'/'lg' 映射为 md）；
 * 容器 --bg-sunken r6 内衬 2px，选中项 --bg-panel + sh-sm；role=radiogroup，←/→ 切换；用于视图切换 / 筛选，面板头请用 Tabs。
 */
export interface SegmentedOption<T extends string> {
  /** 文案含条件显隐元素（hidden @container）时，用它给 radio 稳定可访问名——不依赖 sr-only 复读文本 */
  ariaLabel?: string
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  'data-testid'?: string
}

export type SegmentedSize = 'md' | 'xl'

export interface SegmentedProps<T extends string> extends Omit<React.ComponentProps<'div'>, 'onChange' | 'defaultValue'> {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (v: T) => void
  /** md 32（默认）/ xl 44；'sm' | 'lg' 为 W5 兼容输入，均按 md 渲染 */
  size?: SegmentedSize | 'sm' | 'lg'
  'aria-label': string
}

function Segmented<T extends string>({ className, options, value, onValueChange, size: sizeProp = 'md', ...props }: SegmentedProps<T>) {
  const size: SegmentedSize = sizeProp === 'xl' ? 'xl' : 'md'
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    if (i < 0) return
    e.preventDefault()
    const next =
      e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1] : enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    onValueChange(next.value)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
  }
  return (
    <div
      role="radiogroup"
      data-slot="segmented"
      data-size={size}
      className={cn('inline-flex items-center rounded-md bg-sunken p-0.5 text-fg-muted', size === 'xl' ? 'h-touch box-content' : 'h-md-control', className)}
      onKeyDown={onKeyDown}
      {...props}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            data-slot="segmented-item"
            data-value={o.value}
            data-state={active ? 'on' : 'off'}
            data-testid={o['data-testid']}
            className={cn(
              'inline-flex h-full min-w-16 flex-1 items-center justify-center gap-1.5 whitespace-nowrap font-medium disabled:pointer-events-none disabled:text-fg-disabled [&_svg]:shrink-0',
              touchHit,
              size === 'xl' ? 'rounded-md px-4 text-lg [&_svg]:size-4.5' : 'rounded-sm px-3 text-base [&_svg]:size-4',
              active ? 'bg-panel text-fg-strong shadow-sm' : 'hover:text-fg',
              FOCUS_RING,
              TRANSITION_COLOR,
            )}
            aria-label={o.ariaLabel}
            onClick={() => onValueChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
