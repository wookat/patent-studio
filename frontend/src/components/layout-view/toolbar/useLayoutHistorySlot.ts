import { useEffect } from 'react'
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import { layoutHistory } from '@/components/workbench/slots'

/**
 * 把光标所在书的 ProseMirror 历史注册为 375 底栏「撤销 / 重做」的目标（与桌面 FormatBar 同一栈）。
 * 版面视图里键入、接受 / 拒绝修订都只进这条历史；源码 CodeMirror 历史里对应的是整段落盘补丁，回滚它会把已接受文本变回 CriticMarkup。
 */
export function useLayoutHistorySlot(enabled: boolean, view: EditorView | null) {
  useEffect(() => {
    if (!enabled || !view) return
    const run = (cmd: typeof undo) => {
      const ok = cmd(view.state, view.dispatch, view)
      if (ok) view.focus()
      layoutHistory.notify()
      return ok
    }
    const off = layoutHistory.register({
      canUndo: () => undoDepth(view.state) > 0,
      canRedo: () => redoDepth(view.state) > 0,
      undo: () => run(undo),
      redo: () => run(redo),
    })
    const dom = view.dom
    const notify = () => layoutHistory.notify()
    const events = ['keyup', 'input', 'focus', 'blur', 'mouseup']
    for (const ev of events) dom.addEventListener(ev, notify)
    // 接受 / 拒绝 / 工具条命令等非键入事务：DOM 事件不一定触发，用 MutationObserver 兜底
    const mo = new MutationObserver(notify)
    mo.observe(dom, { childList: true, characterData: true, subtree: true })
    return () => {
      mo.disconnect()
      for (const ev of events) dom.removeEventListener(ev, notify)
      off()
    }
  }, [enabled, view])
}
