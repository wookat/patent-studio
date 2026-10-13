import { useCallback, type KeyboardEvent } from 'react'
import { PopupList, usePopupNav, type PopupAnchor } from '../slash/PopupList'
import type { NumberCandidate } from './numberCompletion'

export const NUMBER_MENU_ID = 'ps-number-menu'

/** 「图 / 表 / 式」编号补全弹层（16 §4.4）：候选 = numberCandidates(ast, kind)，选中插入纯文本；无候选时父层不渲染。 */
export function useNumberMenu(items: NumberCandidate[], onSelect: (c: NumberCandidate) => void, onClose: () => void) {
  const select = useCallback((i: number) => items[i] && onSelect(items[i]), [items, onSelect])
  return usePopupNav(items.length, select, onClose)
}

export function NumberMenu({
  open, items, anchor, nav, onSelect, onClose,
}: { open: boolean; items: NumberCandidate[]; anchor: PopupAnchor | null; nav: ReturnType<typeof useNumberMenu>; onSelect(c: NumberCandidate): void; onClose(): void }) {
  if (!open || items.length === 0) return null
  return (
    <PopupList
      id={NUMBER_MENU_ID}
      label={`${items[0].kind}编号补全`}
      testId="number-menu"
      items={items.map((c) => ({ id: c.blockId, label: c.label }))}
      active={nav.active}
      anchor={anchor}
      onHover={nav.setActive}
      onSelect={(i) => items[i] && onSelect(items[i])}
      onClose={onClose}
      onKeyDown={(e: KeyboardEvent) => nav.handleKey(e)}
    />
  )
}
