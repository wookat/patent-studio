import { createPortal } from 'react-dom'
import { Link2, Link2Off } from 'lucide-react'
import { FOCUS_RING, FOCUS_RING_INSET, cn } from '@/lib/utils'
import { useHeaderSlot } from '@/layout/headerSlot'
import { bookViewLabel } from '@/layout/registry'
import { OpenAsMenu } from './OpenAsMenu'
import { useCompareLock } from './useCompareLock'
import type { CardHeaderProps } from './types'

/**
 * 卡片标题栏（docs/plan/08-r4-dockview-design.md §4.2；05-w6-spec §1.7 / §4 S3 面板头 32 单行）。
 * dock 内（layout/headerSlot 为本卡片登记了插槽 = 所在 group 标题栏右侧）：脏标 + actions + 「打开为…」portal 进 dockview tab 行，
 * 与文件 Tab 同一行 32，卡片正文上方**不再**多一行（02-w6-page-audit #10 消除双 Tab；书切换走文件 Tab / 案卷文件树）。
 * 无 dock（窄桌面回退 / 单测）：退回卡片内单行头 —— 左 = 书切换（下划线 tab，radiogroup 语义）+ 脏标；右 = actions + 「打开为…」。
 */
export function CardHeader({ title, book, dirty, panelId, switchable, onSwitchBook, actions }: CardHeaderProps) {
  const slot = useHeaderSlot(panelId)
  if (slot) {
    return createPortal(
      <div data-slot="CardHeader" data-testid="card-header" data-docked="true" className="flex h-full min-w-0 items-center gap-1 text-sm">
        {dirty && <span role="img" aria-label="未保存" title="未保存" className="mx-1 size-1.5 shrink-0 rounded-full bg-warn-dot" data-testid="card-dirty" />}
        {actions}
        {panelId && <OpenAsMenu panelId={panelId} book={book} />}
      </div>,
      slot,
    )
  }
  return (
    <div data-slot="CardHeader" className="flex h-panel-header shrink-0 items-stretch gap-2 overflow-hidden border-b border-border bg-app pl-1 pr-2 text-sm" data-testid="card-header">
      {switchable && switchable.length > 1 ? (
        <div role="radiogroup" aria-label="书" className="inline-flex min-w-0 shrink items-stretch overflow-x-auto [scrollbar-width:none]">
          {switchable.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={b === book}
              onClick={() => onSwitchBook?.(b)}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-2 text-sm transition-colors duration-fast', FOCUS_RING_INSET,
                b === book ? 'border-primary font-medium text-fg-strong' : 'border-transparent text-fg-muted hover:text-fg-strong',
              )}
              data-testid={`card-book-${b}`}
            >
              {bookViewLabel(b)}
            </button>
          ))}
        </div>
      ) : (
        <span className="self-center px-1 text-sm font-medium text-fg-strong">{title}</span>
      )}
      {dirty && <span role="img" aria-label="未保存" title="未保存" className="size-1.5 self-center rounded-full bg-warn-dot" data-testid="card-dirty" />}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        {panelId && <OpenAsMenu panelId={panelId} book={book} />}
      </div>
    </div>
  )
}

export const HEADER_BUTTON =
  cn('inline-flex h-xs-control items-center justify-center gap-1 rounded-sm px-1.5 text-xs text-fg-muted outline-none hover:bg-hover hover:text-fg-strong disabled:opacity-50 [&_svg]:size-4', FOCUS_RING)

/** 「对照滚动锁」开关（§4.4）：全局一把锁，放在源码 / 结构卡片标题栏 */
export function CompareLockButton() {
  const { locked, toggle } = useCompareLock()
  return (
    <button
      type="button"
      aria-pressed={locked}
      aria-label="对照滚动锁"
      title={locked ? '对照滚动锁：开（两卡片按块对齐滚动）' : '对照滚动锁：关'}
      onClick={() => toggle()}
      className={cn(HEADER_BUTTON, 'card-win-ctrl', locked && 'bg-selected text-fg-strong')}
      data-testid="card-compare-lock"
    >
      {locked ? <Link2 aria-hidden="true" /> : <Link2Off aria-hidden="true" />}
    </button>
  )
}
