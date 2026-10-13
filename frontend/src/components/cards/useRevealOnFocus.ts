import { useEffect, useRef } from 'react'
import { useStudio, type EditorView } from '@/store'
import type { PanelId } from '@/store/layout'
import type { BookView } from '@/store/layout'

/**
 * PDF / 大纲发来的 Focus 落在本书、而本卡片被同组其它 tab 盖住 → 让 dock 把它切到前面，随后卡片内的 focus consumer 才能滚动 + 闪烁。
 * 只由用户当前编辑视图（store.editorView）对应的那种卡片露出，源码卡与版面卡同书并存时不抢。
 */
export function useRevealOnFocus(panelId: PanelId, book: BookView, view: EditorView): void {
  const focus = useStudio((s) => s.focus)
  const seen = useRef(useStudio.getState().focus?.seq ?? 0)
  useEffect(() => {
    if (!focus || focus.seq <= seen.current) return
    seen.current = focus.seq
    const s = useStudio.getState()
    if (focus.source === view || s.editorView !== view || (book !== 'all' && focus.book !== book)) return
    if (s.dockHandle && !s.dockHandle.isPanelVisible(panelId)) s.dockHandle.openPanel(panelId)
  }, [focus, book, panelId, view])
}
