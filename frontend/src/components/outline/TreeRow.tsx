import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { FOCUS_RING, FOCUS_RING_INSET, cn, touchHit } from '@/lib/utils'

export interface TreeRowProps {
  id: string
  /** 0 = 顶层（padding-left 8）；1 = 子级（22）；2 = 孙级（36）；3 = 小节下的图/表/公式叶子（50） */
  level?: 0 | 1 | 2 | 3
  /** 当前项（光标所在节点 / 当前打开文件）：`--bg-selected` 底 + `--fg-strong` medium，图标 `--link` */
  current?: boolean
  /** 焦点可达（roving tabindex：当前项 0，其余 -1） */
  tabStop?: boolean
  /** 有子树：显示 chevron，← / → 与 chevron 点击折叠展开 */
  collapsed?: boolean
  onToggle?: () => void
  onActivate?: () => void
  /** 左侧圆点（前向/越界引用等），值为提示文案 */
  mark?: string | null
  /** 圆点色：error 红（默认）/ warning 橙 */
  markTone?: 'error' | 'warning'
  icon?: ReactNode
  children: ReactNode
  /** 右侧 11px mono 标签（字数 / 引用 / 段号） */
  tag?: ReactNode
  tagBad?: boolean
  /** 右侧 12px 计数 */
  count?: ReactNode
  /** 右侧额外内容（hover 显示的 ⋯ 等） */
  trailing?: ReactNode
  title?: string
  /** 读屏文案（如 `权利要求 3，从属，引用 1`）；缺省朗读行内文字 */
  ariaLabel?: string
  muted?: boolean
  disabled?: boolean
  className?: string
  testId?: string
}

/**
 * 05 §3.4 树行（原型 .tree-row）：`--row-h-tree` 28px、13px、gap 6、缩进 14px/级、r-xs、hover `--bg-hover`、选中 `--bg-selected`。
 * 整行是 treeitem（Enter/Space 激活、←/→ 折叠展开）；chevron 单独可点。
 * 宽度不够时：有 count 的行（目录 / 分区）名字优先完整显示、右侧计数截断；无 count 的叶子行名字截断。
 * 左侧圆点的说明并入整行 title（6px 圆点本身难以悬停到）。
 */
export function TreeRow({
  id, level = 0, current = false, tabStop, collapsed, onToggle, onActivate, mark, markTone = 'error', icon, children, tag, tagBad, count, trailing, title, ariaLabel, muted, disabled, className, testId,
}: TreeRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) onActivate?.()
    } else if (onToggle && ((e.key === 'ArrowRight' && collapsed) || (e.key === 'ArrowLeft' && !collapsed))) {
      e.preventDefault()
      onToggle()
    }
  }
  const onChevron = (e: MouseEvent) => {
    e.stopPropagation()
    onToggle?.()
  }

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-selected={current}
      aria-expanded={onToggle ? !collapsed : undefined}
      aria-disabled={disabled || undefined}
      aria-level={level + 1}
      aria-label={ariaLabel}
      tabIndex={tabStop ?? current ? 0 : -1}
      data-node={id}
      data-current={current || undefined}
      data-testid={testId}
      title={mark ? (title ? `${title}\n${mark}` : mark) : title}
      onClick={disabled ? undefined : onActivate}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-tree-row cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-xs pr-2 text-sm text-fg outline-none transition-colors duration-fast',
        level === 0 ? 'pl-2' : level === 1 ? 'pl-5.5' : level === 2 ? 'pl-9' : 'pl-12.5',
        current ? 'bg-selected font-medium text-fg-strong' : 'hover:bg-hover focus-visible:bg-hover',
        muted && !current && 'text-fg-muted',
        disabled && 'cursor-default text-fg-disabled',
        className,
      )}
    >
      {mark ? (
        <span
          className={cn('absolute left-0.5 size-1.5 rounded-full', markTone === 'warning' ? 'bg-warn-dot' : 'bg-danger-dot')}
          title={mark}
          aria-label={mark}
          data-testid="row-mark"
          data-tone={markTone}
        />
      ) : null}
      {onToggle ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={collapsed ? '展开' : '折叠'} title={collapsed ? '展开' : '折叠'}
          className={cn('flex size-4 shrink-0 items-center justify-center text-fg-subtle', touchHit)}
          onClick={onChevron}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      ) : null}
      {icon ? <span className={cn('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:stroke-[1.8]', current ? 'text-link' : 'text-fg-muted')}>{icon}</span> : null}
      <span className={cn('min-w-0 truncate', count !== undefined && count !== null ? 'shrink-0' : 'flex-1')}>{children}</span>
      {tag !== undefined && tag !== null ? (
        <span className={cn('shrink-0 font-mono text-2xs leading-none tabular-nums', tagBad ? 'font-medium text-danger-fg' : current ? 'text-fg-muted' : 'text-fg-subtle')}>{tag}</span>
      ) : null}
      {count !== undefined && count !== null ? <span className={cn('ml-auto min-w-0 truncate text-2xs tabular-nums', current ? 'text-fg-muted' : 'text-fg-subtle')}>{count}</span> : null}
      {trailing}
    </div>
  )
}

/** 分区标题行右侧 24×24 图标按钮（05 §3.4 面板头 icon xs） */
export function IconButton30({ label, onClick, disabled, children, testId, pressed }: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
  testId?: string
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex size-xs-control shrink-0 items-center justify-center rounded-sm text-fg-muted outline-none transition-colors duration-fast',
        'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled',
        FOCUS_RING,
        pressed && 'bg-active text-fg-strong',
        '[&_svg]:size-4 [&_svg]:stroke-[1.8]',
      )}
    >
      {children}
    </button>
  )
}

/**
 * 32px 分区标题行（05 §3.4 面板头 `--h-panel-header`；原型 .panel-h）：chevron + 12px 大写间距标题 `--fg-muted`；右侧 icon xs 组；下 1px 边。
 * chevron/标题可点 → 折叠该分区。
 */
export function SectionHeader({ title, collapsed, onToggle, actions, controls, testId }: {
  title: string
  collapsed: boolean
  onToggle: () => void
  actions?: ReactNode
  controls?: string
  testId?: string
}) {
  return (
    <div className="flex h-panel-header shrink-0 items-center gap-1 border-b border-border bg-app pl-1.5 pr-1 text-xs font-medium tracking-wide text-fg-muted" data-testid={testId}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={controls}
        aria-label={`${collapsed ? '展开' : '折叠'}${title}`}
        className={cn('flex h-full min-w-0 flex-1 items-center gap-1 rounded-xs text-left hover:text-fg-strong', FOCUS_RING_INSET)}
        onClick={onToggle}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
        <span className="truncate">{title}</span>
      </button>
      {actions ? <span className="ml-auto flex shrink-0 items-center">{actions}</span> : null}
    </div>
  )
}
