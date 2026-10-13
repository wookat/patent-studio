import type { EditorView } from 'prosemirror-view'
import { PARAGRAPH_STYLES, type ParagraphStyleName } from '@/store/styleEdit'
import type { BookBlockKind } from '../doc/bookSchema'

export const POPOVER_GAP = 6
export const POPOVER_H = 36

/** 选区浮条在容器内的定位（选区上方居中；顶部放不下 → 下方；左右夹进容器）；坐标基于 view.coordsAtPos */
export function popoverPosition(view: EditorView, container: HTMLElement, barW: number): { left: number; top: number } {
  const { from, to } = view.state.selection
  const a = view.coordsAtPos(from)
  const b = view.coordsAtPos(to)
  const box = container.getBoundingClientRect()
  const top0 = Math.min(a.top, b.top) - box.top + container.scrollTop
  const bottom0 = Math.max(a.bottom, b.bottom) - box.top + container.scrollTop
  const cx = (a.left + b.left) / 2 - box.left + container.scrollLeft
  const half = barW / 2
  const left = Math.max(half + 4, Math.min(cx, container.clientWidth - half - 4))
  const top = top0 - POPOVER_GAP - POPOVER_H >= container.scrollTop ? top0 - POPOVER_GAP - POPOVER_H : bottom0 + POPOVER_GAP
  return { left, top }
}

/** 光标块 kind → 段落样式名（结构块 table / code / figure 无对应样式 → null，下拉显示「—」） */
export function styleNameOf(kind: BookBlockKind | null): ParagraphStyleName | null {
  if (!kind) return null
  return kind in PARAGRAPH_STYLES ? (kind as ParagraphStyleName) : null
}
