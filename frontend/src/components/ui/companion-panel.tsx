import * as React from 'react'
import { X } from 'lucide-react'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { HeadingLevelProvider } from './heading'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

/**
 * CompanionPanel（05 §2.9 / S3）：工作台右侧伴随栏 —— DesktopShell 第 4 栅格列（dockview 外侧），同时只开一个 id。
 * 宽 360（--w-companion，320–480 可拖，左缘 4px 把手）；头 32（--h-panel-header：图标 + 标题 + 右侧 actions + 关闭）；
 * 内容区 12px 内边距、自滚。<768（md）转右侧 Sheet 360，<640（sm）转底部 Sheet ≤85dvh —— 由 `presentation` 决定（shell 根据视口传入）。
 * 无 primary 按钮（一屏一个 primary 属于顶栏「构建」）。业务内容由单元通过 children 注入；本组件只管壳。
 */
export const COMPANION_WIDTH_DEFAULT = 360
export const COMPANION_WIDTH_MIN = 320
export const COMPANION_WIDTH_MAX = 480

export function clampCompanionWidth(w: number) {
  return Math.min(COMPANION_WIDTH_MAX, Math.max(COMPANION_WIDTH_MIN, Math.round(w)))
}

export type CompanionPresentation = 'column' | 'sheet-right' | 'sheet-bottom'

export interface CompanionPanelProps extends Omit<React.ComponentProps<'aside'>, 'title' | 'id'> {
  /** 打开的面板 id（null = 关闭，不渲染） */
  id: string | null
  title: React.ReactNode
  icon?: React.ReactNode
  /** 头部右侧动作（ghost icon 按钮，禁 primary） */
  actions?: React.ReactNode
  onClose: () => void
  width?: number
  onWidthChange?: (w: number) => void
  presentation?: CompanionPresentation
  children?: React.ReactNode
  /** 仅 column：是否显示左缘拖拽把手 */
  resizable?: boolean
}

function CompanionHeader({ title, icon, actions, onClose, presentation }: Pick<CompanionPanelProps, 'title' | 'icon' | 'actions' | 'onClose' | 'presentation'>) {
  const touch = presentation !== 'column'
  return (
    <header data-slot="companion-header" className={cn('flex shrink-0 items-center gap-2 border-b border-border pl-3 pr-1', touch ? 'h-touch' : 'h-panel-header')}>
      {icon && <span className="inline-flex shrink-0 text-fg-icon [&_svg]:size-4" aria-hidden>{icon}</span>}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong" data-slot="companion-title" title={typeof title === 'string' ? title : undefined}>{title}</h2>
      {actions && <div className="flex shrink-0 items-center gap-0.5" data-slot="companion-actions">{actions}</div>}
      <button
        type="button"
        aria-label="关闭面板" title="关闭面板"
        onClick={onClose}
        data-slot="companion-close"
        className={cn('inline-flex shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg-strong', touch ? 'size-touch' : 'size-xs-control', FOCUS_RING, TRANSITION_COLOR)}
      >
        <X className="size-4" aria-hidden />
      </button>
    </header>
  )
}

function CompanionPanel({
  id, title, icon, actions, onClose, width = COMPANION_WIDTH_DEFAULT, onWidthChange, presentation = 'column', resizable = true, children, className, ...props
}: CompanionPanelProps) {
  const startX = React.useRef(0)
  const startW = React.useRef(width)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidthChange) return
    startX.current = e.clientX
    startW.current = width
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidthChange || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    onWidthChange(clampCompanionWidth(startW.current - (e.clientX - startX.current)))
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onWidthChange) return
    if (e.key === 'ArrowLeft') onWidthChange(clampCompanionWidth(width + 16))
    else if (e.key === 'ArrowRight') onWidthChange(clampCompanionWidth(width - 16))
    else return
    e.preventDefault()
  }

  if (!id) return null

  if (presentation !== 'column') {
    const side = presentation === 'sheet-bottom' ? 'bottom' : 'right'
    return (
      <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
        <SheetContent side={side} data-slot="companion-panel" data-companion={id} data-presentation={presentation} data-density={side === 'bottom' ? 'touch' : undefined} hideClose className={cn('flex flex-col p-0', side === 'bottom' && 'h-[85dvh]', className)}>
          <SheetTitle className="sr-only">{typeof title === 'string' ? title : '伴随面板'}</SheetTitle>
          <SheetDescription className="sr-only">伴随面板</SheetDescription>
          <CompanionHeader title={title} icon={icon} actions={actions} onClose={onClose} presentation={presentation} />
          <div data-slot="companion-body" className="min-h-0 flex-1 overflow-y-auto p-3"><HeadingLevelProvider level={3}>{children}</HeadingLevelProvider></div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      data-slot="companion-panel"
      data-companion={id}
      data-presentation="column"
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn('relative flex h-full min-h-0 flex-col border-l border-border bg-panel text-fg', className)}
      style={{ width: clampCompanionWidth(width) }}
      {...props}
    >
      {resizable && onWidthChange && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整伴随栏宽度"
          aria-valuemin={COMPANION_WIDTH_MIN}
          aria-valuemax={COMPANION_WIDTH_MAX}
          aria-valuenow={clampCompanionWidth(width)}
          tabIndex={0}
          data-slot="companion-resize"
          className={cn('absolute inset-y-0 -left-0.5 z-panel w-1 cursor-col-resize hover:bg-primary/60 active:bg-primary', FOCUS_RING, TRANSITION_COLOR)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        />
      )}
      <CompanionHeader title={title} icon={icon} actions={actions} onClose={onClose} presentation="column" />
      <div data-slot="companion-body" className="min-h-0 flex-1 overflow-y-auto p-3"><HeadingLevelProvider level={3}>{children}</HeadingLevelProvider></div>
    </aside>
  )
}

export { CompanionPanel }
