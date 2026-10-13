export const LONG_PRESS_MS = 500
/** 指针位移超过此值视为拖动（取消长按 / 单击） */
const MOVE_TOL = 8

export interface PointerLike {
  clientX: number
  clientY: number
  pointerType?: string
  target: EventTarget | null
}

export interface GestureCallbacks {
  /** 单击（未拖动、非长按、无选区） */
  click(target: HTMLElement, x: number, y: number): void
  /** 拖选结束且选区非空 */
  select(sel: Selection, anchor: HTMLElement, x: number, y: number): void
  /** 触控长按 500ms（不移动） */
  longPress(target: HTMLElement, x: number, y: number): void
}

export interface PdfGestures {
  down(e: PointerLike): void
  move(e: PointerLike): void
  up(e: PointerLike): void
  cancel(): void
  /** 本次按下是否已被长按 / 拖动消费（click 事件据此忽略） */
  consumed(): boolean
  dispose(): void
}

/**
 * PDF 文字层四手势（21 §5.3 / R-MOB-05）：单击 / 拖选 / 双击（由 dblclick 事件另行处理）/ 触控长按。
 * 单击与拖选都在 pointerup 判定：有非空 Selection 即拖选，否则未移动即单击；长按只对 touch/pen，定时 500ms，移动即取消。
 * 纯函数对象便于 vitest 直接驱动，不依赖 React 事件系统。
 */
export function createPdfGestures(cb: GestureCallbacks, opts: { longPressMs?: number; getSelection?: () => Selection | null } = {}): PdfGestures {
  const longPressMs = opts.longPressMs ?? LONG_PRESS_MS
  const getSelection = opts.getSelection ?? (() => (typeof window === 'undefined' ? null : window.getSelection()))
  let start: { x: number; y: number; target: HTMLElement } | null = null
  let moved = false
  let pressed = false
  let timer = 0

  const clear = () => {
    if (timer) window.clearTimeout(timer)
    timer = 0
  }

  return {
    down(e) {
      clear()
      const target = e.target instanceof HTMLElement ? e.target : null
      if (!target) return
      start = { x: e.clientX, y: e.clientY, target }
      moved = false
      pressed = false
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        timer = window.setTimeout(() => {
          timer = 0
          if (!start || moved) return
          pressed = true
          cb.longPress(start.target, start.x, start.y)
        }, longPressMs)
      }
    },
    move(e) {
      if (!start || moved) return
      if (Math.abs(e.clientX - start.x) > MOVE_TOL || Math.abs(e.clientY - start.y) > MOVE_TOL) {
        moved = true
        clear()
      }
    },
    up(e) {
      clear()
      const s = start
      start = null
      if (!s || pressed) return
      const sel = getSelection()
      const text = sel?.toString().trim() ?? ''
      if (sel && text && !sel.isCollapsed) {
        moved = true
        const anchorNode = sel.anchorNode
        const anchor = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement ?? s.target
        cb.select(sel, anchor, e.clientX, e.clientY)
        return
      }
      if (!moved) cb.click(s.target, e.clientX, e.clientY)
    },
    cancel() {
      clear()
      start = null
    },
    consumed() {
      return pressed || moved
    },
    dispose: clear,
  }
}
