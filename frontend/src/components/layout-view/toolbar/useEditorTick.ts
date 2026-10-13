import { useEffect, useState } from 'react'
import type { EditorView } from 'prosemirror-view'

/**
 * 订阅 EditorView 的选区 / 文档变化并触发重渲染（同 table/TableToolbar：不接管 dispatchTransaction，BookEditor 拥有它）。
 * 返回 bump，供工具条自己 dispatch 后立即刷新按钮状态。
 */
export function useEditorTick(view: EditorView | null): () => void {
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  useEffect(() => {
    if (!view) return
    const dom = view.dom
    const events = ['keyup', 'mouseup', 'input', 'focus', 'blur']
    for (const ev of events) dom.addEventListener(ev, bump)
    dom.ownerDocument.addEventListener('selectionchange', bump)
    return () => {
      for (const ev of events) dom.removeEventListener(ev, bump)
      dom.ownerDocument.removeEventListener('selectionchange', bump)
    }
  }, [view])
  return bump
}

/** 在 view 上执行命令并刷新工具条；命令被拒（false）不动焦点 */
export function runOnView(view: EditorView | null, cmd: (state: EditorView['state'], dispatch: EditorView['dispatch'], view: EditorView) => boolean, bump: () => void): boolean {
  if (!view) return false
  const ok = cmd(view.state, view.dispatch, view)
  if (ok) {
    view.focus()
    bump()
  }
  return ok
}
