import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useStudio } from '@/store'
import { cursorFocusDriver, useFocusConsumer, type CursorFocusDriver } from '@/lib/focusSync'
import { findBlockLines } from '@/store/blocks'
import { flashLine } from './diagnostics'
import { focusDriverExtension, headingFoldExtension, snippetExtension } from './threeView'

export const FOCUS_FLASH_MS = 1200

/**
 * 源码视图接入三视图 Focus（21 §5.2 / §5.5）——CodeMirrorEditor（单书 / 全文）与 cards/CardEditor（桌面 dock 卡片）共用：
 *  - 光标块 → Focus{source:'source'}（全文行 = 视图行 + lineBase）；
 *  - 其他视图发来的 Focus：滚到块起始行并闪烁（--focus-ring），不抢焦点；行不在本视图（别的书的卡片）则忽略；
 *  - 视图挂载（mounted 变 true）时重放最近一次 Focus → switchView 保持位置。
 * 返回值传给 sourceFocusExtensions()。
 */
export function useSourceFocus(viewRef: RefObject<EditorView | null>, lineBase: () => number, mounted: boolean): CursorFocusDriver {
  const driver = useMemo(() => cursorFocusDriver('source'), [])
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      driver.dispose()
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [driver],
  )
  useFocusConsumer('source', mounted, (f) => {
    const view = viewRef.current
    if (!view) return
    const ast = useStudio.getState().ast
    const loc = ast ? findBlockLines(ast, f.blockId) : null
    const full = f.line ?? (loc ? loc.offset + loc.start : null)
    if (full == null) return
    // 书标题行（全文行 == lineBase）不在单书卡片里：落到卡片首行
    const n = full === lineBase() ? 1 : full - lineBase()
    if (n < 1 || n > view.state.doc.lines) return
    const l = view.state.doc.line(n)
    view.dispatch({ selection: { anchor: l.from }, effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), flashLine.of(n)] })
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (viewRef.current === view) view.dispatch({ effects: flashLine.of(null) })
    }, FOCUS_FLASH_MS)
  })
  return driver
}

/** snippets + ## 折叠 gutter + 光标块 Focus 广播 */
export function sourceFocusExtensions(driver: CursorFocusDriver, lineBase: () => number): Extension[] {
  return [snippetExtension(), headingFoldExtension(), focusDriverExtension(driver, () => useStudio.getState().ast, lineBase)]
}
