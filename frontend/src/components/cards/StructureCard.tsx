import { useEffect, useRef } from 'react'
import { BOOK_NAMES, type BookName } from '@/types/ast'
import { LayoutView } from '@/components/layout-view'
import { LayoutRightRail } from '@/components/workbench/LayoutRightRail'
import { ReviewRail } from '@/components/layout-view/review/ReviewRail'
import { bookViewLabel } from '@/layout/registry'
import { selectEditorMode, useStudio } from '@/store'
import { useIsDesktop } from '@/hooks/useMisc'
import { CardHeader, CompareLockButton } from './CardHeader'
import { usePairedBlock } from './useCompareLock'
import { useRevealOnFocus } from './useRevealOnFocus'
import type { CardProps } from './types'

/**
 * 版面卡片（§4.1 / docs/plan/16 §7）：包 <LayoutView/>，单书时传 books=[book] 只渲染该书纸面（键盘漫游 / a11y 树同步只含该书）。
 * 模式来自 store（selectEditorMode：viewer 固定只读、reviewer 固定审阅、editor 可切编辑 ↔ 审阅），
 * 由顶栏 WorkbenchControls 的 `编辑 | 审阅` 切换（W9 决策 6，卡头不再放三视图 Tab / 模式下拉）；窄屏（<1024）恒只读。
 * 右侧 320 审阅栏（LayoutRightRail，决策 4）：≥1280 常驻可折叠，纸面在 flex-1 min-w-0 内按容器宽缩放，收窄先缩纸不挤栏。卡片 id / 类型仍为 layout:*（旧 structure:* 布局兼容见 store/layout）。
 */
const SINGLE_BOOK: Record<BookName, readonly BookName[]> = { abstract: ['abstract'], claims: ['claims'], description: ['description'] }

export function StructureCard({ panelId, book, onSwitchBook }: CardProps) {
  const isDesktop = useIsDesktop()
  const editorMode = useStudio(selectEditorMode)
  const pid = useStudio((s) => s.pid)
  const root = useRef<HTMLDivElement>(null)
  useRevealOnFocus(panelId, book, 'layout')

  // 对照锁：另一书的活动块 → 本书同序块滚到可见（LayoutView 自己只跟随 activeBlock）
  const paired = usePairedBlock(book, panelId)
  useEffect(() => {
    if (!paired) return
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []) {
      if (el.dataset.blockId === paired.block.id) {
        el.scrollIntoView({ block: 'center' })
        break
      }
    }
  }, [paired])

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-paper-canvas" data-testid={`card-structure-${book}`} data-book={book}>
      <CardHeader
        title={`版面 · ${bookViewLabel(book)}`}
        book={book}
        panelId={panelId}
        switchable={[...BOOK_NAMES, 'all']}
        onSwitchBook={onSwitchBook}
        actions={<CompareLockButton />}
      />
      <div className="flex min-h-0 flex-1" data-testid="layout-card-body">
        <LayoutView
          className="min-h-0 min-w-0 flex-1 overflow-auto"
          mode={isDesktop ? editorMode : 'readonly'}
          books={book === 'all' ? undefined : SINGLE_BOOK[book]}
          slots={isDesktop && pid ? { rightRail: <LayoutRightRail panelId={panelId}><ReviewRail pid={pid} /></LayoutRightRail> } : undefined}
        />
      </div>
    </div>
  )
}
