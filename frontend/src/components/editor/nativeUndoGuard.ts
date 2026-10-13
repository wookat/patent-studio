import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * 浏览器原生 undo/redo 直达 contenteditable 的拦截（走查 OBS-B81-1）：
 * 焦点在 .cm-content 之外（查找面板 input、侧栏）按 Ctrl+Z 时，浏览器把 undo 应用到最近的可编辑区——
 * 即本编辑器文档，绕过 CM history 静默改正文（实测删 34 字、零 toast、协同下还会 flush 写盘）。
 * 原生 undo 落到可编辑区必经 `beforeinput` 且 inputType 为 'historyUndo'/'historyRedo'（可取消）；
 * CM 自己的撤销走 history 事务，绝不产生该事件——按 inputType 精确拦截即可，不误伤 CM Mod-Z。
 */
export const nativeUndoGuard: Extension = EditorView.domEventHandlers({
  beforeinput: (event) => {
    const t = (event as InputEvent).inputType
    if (t === 'historyUndo' || t === 'historyRedo') {
      event.preventDefault()
      return true
    }
    return false
  },
})
