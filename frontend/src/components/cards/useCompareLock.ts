import { useMemo } from 'react'
import { useStudio } from '@/store'
import type { BookView, PanelId } from '@/store/layout'
import type { BlockLocation } from '@/types/ast'
import { locateBlock, pairBlockByIndex, type PairBlock } from './sync'

/**
 * 对照滚动锁（docs/plan/08-r4-dockview-design.md §4.4；D2 所有）。
 * 不新增事件总线：主卡片照常把光标块写进 `ast.activeBlock`；从卡片在 `layout.compareLock` 开着、
 * 自己不是活动面板、且 activeBlock 属于**别的书**时，用 pairBlock 找到本书对应块并对齐（只滚动不动光标，故不会回环）。
 * 同书卡片（源码 ↔ 结构）沿用 activeBlock 高亮，不经此 hook。
 */

/** 本卡片在锁定状态下应对齐到的块；无需对齐时 null */
export function usePairedBlock(book: BookView, panelId: PanelId, pair: PairBlock = pairBlockByIndex): BlockLocation | null {
  const ast = useStudio((s) => s.ast)
  const pairedId = useStudio((s) => {
    if (!s.compareLock || !s.ast || !s.activeBlock || book === 'all' || s.activePanelId === panelId) return null
    const from = locateBlock(s.ast, s.activeBlock.id)
    if (!from || from.book === book) return null
    return pair(s, from.book, s.activeBlock.id, book)
  })
  return useMemo(() => (ast && pairedId ? locateBlock(ast, pairedId) : null), [ast, pairedId])
}

export function useCompareLock(): { locked: boolean; toggle: (on?: boolean) => void } {
  const locked = useStudio((s) => s.compareLock)
  const toggle = useStudio((s) => s.setCompareLock)
  return { locked, toggle }
}
