import { useContext, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { BlockActionsContext } from './context'
import { FOCUS_RING, cn } from '@/lib/utils'
import type { BlockDiagnostic } from './model'

export const GENERATED_CLASS = 'sv-gen select-none text-sheet-muted-foreground'

/**
 * 内核生成物（段号 / 权项性质 / 图号）：灰、不可选中（复制正文时不带入源码）、悬停提示。
 * 读屏文本用 sr-only 前缀（"生成段号 [0013]"），不用 aria-label（span 无角色时 axe 判为 prohibited）。
 */
export function Gen({ prefix, children, className }: { prefix: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn(GENERATED_CLASS, className)} title="由内核生成" data-generated="true">
      <span className="sr-only">{prefix} </span>
      {children}
    </span>
  )
}

const modified = (e: MouseEvent) => e.ctrlKey || e.metaKey

export interface BlockProps {
  id: string
  active: boolean
  tabStop: boolean
  diag?: BlockDiagnostic
  as?: 'div' | 'li'
  ariaLabel?: string
  className?: string
  children: ReactNode
}

/** 可聚焦块外壳：data-block-id 供键盘漫游/滚动定位；aria-current 标出当前光标块。 */
export function Block({ id, active, tabStop, diag, as = 'div', ariaLabel, className, children }: BlockProps) {
  const actions = useContext(BlockActionsContext)
  const Tag = as
  const diagId = diag ? `sv-diag-${cssId(id)}` : undefined
  return (
    <Tag
      data-block-id={id}
      data-active={active || undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
      aria-describedby={diagId}
      onClick={(e) => {
        if (modified(e)) return
        actions.select(id)
      }}
      onDoubleClick={(e) => {
        if (modified(e)) return
        actions.open(id)
      }}
      className={cn(
        'sv-block relative -mx-2 rounded-sm px-2 py-0.5 outline-none transition-colors',
        'hover:bg-hover/60',
        FOCUS_RING,
        active && 'bg-selected hover:bg-selected',
        diag && 'border-l-2 pl-1.5',
        diag?.severity === 'error' && 'border-danger-fg',
        diag?.severity === 'warning' && 'border-warning',
        diag?.severity === 'info' && 'border-info',
        className,
      )}
    >
      {children}
      {diag && (
        <span id={diagId} className="sr-only">
          {diag.messages.join('；')}
        </span>
      )}
    </Tag>
  )
}

const cssId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.codePointAt(0)?.toString(16) ?? ''}`)

/** 后端 MathML 字串原生渲染；无 MathML 时退回 $$ 内文 */
export function MathML({ mathml, source, className }: { mathml: string | null; source: string; className?: string }) {
  if (!mathml) {
    return (
      <code className={cn('sv-math-src whitespace-pre-wrap break-all font-mono text-[0.9em]', className)} data-testid="math-source">
        {source}
      </code>
    )
  }
  return <div className={cn('sv-math', className)} role="math" aria-label={source} dangerouslySetInnerHTML={{ __html: mathml }} />
}

/** 横向滚动容器（宽公式 / 表格 / 代码）：只在真的溢出时才成为 Tab 停靠点，键盘可 ←→ 滚动。 */
export function Scroller({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className={cn('sv-scroll min-w-0 overflow-x-auto overflow-y-hidden rounded-xs', FOCUS_RING, className)}
      tabIndex={overflowing ? 0 : undefined}
      role={overflowing ? 'group' : undefined}
      aria-label={overflowing ? `${label}（可横向滚动）` : undefined}
    >
      {children}
    </div>
  )
}
