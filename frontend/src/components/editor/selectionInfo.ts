import type { EditorView } from '@codemirror/view'
import type { EditorSelectionInfo } from '@/components/ai/SelectionActionBar'

/** 主选区非空且有焦点时的选区描述；坐标相对编辑器容器（view.dom）。行号为该视图自身的行（单书卡片由调用方换算全文行） */
export function selectionInfo(view: EditorView): EditorSelectionInfo | null {
  const r = view.state.selection.main
  if (r.empty || !view.hasFocus) return null
  const doc = view.state.doc
  const a = view.coordsAtPos(r.from)
  const b = view.coordsAtPos(r.to)
  const box = view.dom.getBoundingClientRect()
  return {
    from: r.from,
    to: r.to,
    lineStart: doc.lineAt(r.from).number,
    lineEnd: doc.lineAt(r.to).number,
    text: doc.sliceString(r.from, r.to),
    rect: a && b ? { top: a.top - box.top, left: a.left - box.left, bottom: b.bottom - box.top } : null,
  }
}
