import { useEffect, useRef } from 'react'
import { useStudio } from '@/store'
import { blockAtLine, type Ast, type BookName } from '@/types/ast'
import type { Focus, FocusSource } from '@/types/focus'

/**
 * Focus 三向定位（docs/plan/21-w5-spec.md §5.2 / §5.3）的消费端与驾驭端工具。
 *
 * - `useFocusConsumer(self, ready, handler)`：订阅 store.focus；忽略自己发出的 Focus；按 seq 判重；
 *   视图挂载或 `ready` 由 false → true（PDF 索引建好）时**重放**最近一次 Focus，因此 switchView 后目标视图
 *   重新挂载即回到同块（R-LAY-04），写入方永不直接调对方组件。
 * - `cursorFocusDriver(source)`：源码 / 版面光标 → Focus。显式动作（鼠标点击）立刻广播；键盘移动只在
 *   对照锁（layout.compareLock）开着时广播，且去抖 150ms、跨块才触发（§5.3「对照锁」）。
 * - `flash(el)`：一次性 `--focus-ring` 闪烁（时长 --dur-slow）。
 */

export const COMPARE_LOCK_DEBOUNCE_MS = 150
export const FOCUS_FLASH_MS = 1200
/** 闪烁类名；样式在各视图自己的 CSS 里（layout-view.css `.ps-focus-flash`、Editor baseTheme `.cm-focus-flash`） */
export const FOCUS_FLASH_CLASS = 'ps-focus-flash'

export function useFocusConsumer(self: FocusSource, ready: boolean, handler: (f: Focus) => void): void {
  const focus = useStudio((s) => s.focus)
  const seen = useRef<number>(0)
  const readyWas = useRef(false)
  const fn = useRef(handler)
  useEffect(() => {
    fn.current = handler
  })
  useEffect(() => {
    if (!ready) {
      readyWas.current = false
      return
    }
    const replay = !readyWas.current
    readyWas.current = true
    if (!focus) return
    if (focus.seq === seen.current && !replay) return
    seen.current = focus.seq
    if (focus.source === self && !replay) return
    fn.current(focus)
  }, [focus, ready, self])
}

/** 一次性闪烁：加类 → --dur-slow 后移除（reduced-motion 下 --dur-slow = 0，等价于无动画） */
export function flash(el: Element | null, cls = FOCUS_FLASH_CLASS, ms = FOCUS_FLASH_MS): void {
  if (!el) return
  el.classList.remove(cls)
  // 强制重启动画
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
  window.setTimeout(() => el.classList.remove(cls), ms)
}

export interface CursorFocusDriver {
  /**
   * 光标落到全文行 `line`。`explicit` = 用户点击 / 明确动作；否则按对照锁规则。
   * 返回是否广播了 Focus。
   */
  cursor(ast: Ast | null, line: number, explicit: boolean): boolean
  /** 已知块（版面点击） */
  block(book: BookName, blockId: string, line: number | undefined, explicit: boolean): boolean
  dispose(): void
}

export function cursorFocusDriver(source: FocusSource): CursorFocusDriver {
  let lastBlock: string | null = null
  let timer = 0
  const emit = (book: BookName, blockId: string, line: number | undefined) => {
    lastBlock = blockId
    useStudio.getState().setFocus({ book, blockId, line, source })
  }
  const schedule = (book: BookName, blockId: string, line: number | undefined) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => emit(book, blockId, line), COMPARE_LOCK_DEBOUNCE_MS)
  }
  const drive = (book: BookName, blockId: string, line: number | undefined, explicit: boolean): boolean => {
    if (explicit) {
      window.clearTimeout(timer)
      emit(book, blockId, line)
      return true
    }
    const s = useStudio.getState()
    if (!s.compareLock) return false
    // 同块不重发：自己上次发的块，或刚被别的视图定位过来的块（消费 Focus 时光标落在其上）
    if (blockId === lastBlock || s.focus?.blockId === blockId) return false
    schedule(book, blockId, line)
    return true
  }
  return {
    cursor(ast, line, explicit) {
      if (!ast) return false
      const loc = blockAtLine(ast, line)
      if (!loc) return false
      return drive(loc.book, loc.block.id, line, explicit)
    },
    block: drive,
    dispose() {
      window.clearTimeout(timer)
    },
  }
}

/** 版面 / PDF 命中的 DOM（`data-block-id`），blockId 含 `/` 与中文，用属性选择器需转义 */
export function blockElement(root: ParentNode | null, blockId: string): HTMLElement | null {
  if (!root) return null
  const esc = typeof CSS !== 'undefined' && 'escape' in CSS ? CSS.escape(blockId) : blockId.replace(/["\\]/g, '\\$&')
  return root.querySelector<HTMLElement>(`[data-block-id="${esc}"]`)
}
