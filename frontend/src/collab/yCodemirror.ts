import { EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { yCollab, ySyncAnnotation, ySyncFacet } from 'y-codemirror.next'
import type { CollabSession } from './provider'
import { remoteCursorTheme } from './RemoteCursor'

/**
 * 协同 CodeMirror 扩展（docs/plan/11 §5.3；G2 所有）。挂进 `CodeMirrorEditor` 的 `collabExtension` 插槽
 * （Editor.tsx 把它放在 baseKeymap 之前的 Compartment 里，可热重配）。
 *
 * - 首个 sync 之前（`session.synced === false`）只返回只读扩展：编辑器锁住但不接 ySync，避免把本地旧文档同步上去；
 *   sync 后调用方重新求值（status 变化 → useMemo 重算 → Compartment reconfigure）即接上 yCollab。
 * - 接上时若编辑器文档 ≠ Y.Text（本地打开的快照落后于房间），以房间为准整体替换一次；该事务带 ySyncAnnotation，
 *   ySync 不会把它回写进 Y.Text，onChange 照常触发 → setContent → 构建。
 * - readonly（viewer）：`EditorState.readOnly` + `editable=false`，光标可移、可选中、不能键入。
 * - 撤销只有一套栈：沿用编辑器既有的 CodeMirror history（Mod-z / 工具栏 / 菜单 / canUndo 都走 commands.ts 的 undo/redo），
 *   远端事务（ySync 回放）标 addToHistory=false + remote，history 只映射不记录 ⇒ 撤销永远只撤本端改动。
 *   不启用 y-codemirror.next 的 Y.UndoManager（`undoManager: false`）：它只接 Mod-z，与工具栏的 history 栈并存会各撤各的。
 * - 受控 value 回源：CodeMirrorEditor 的 `value` effect 在编辑器已被远端推进后可能拿陈旧 value 整篇替换（React 渲染与 ws 消息交错）；
 *   协同中 Y.Text 才是真相，这种无 userEvent、非 ySync 的整篇替换直接丢弃（用户全选粘贴/删除带 userEvent，不受影响）。
 * - remoteCursorTheme 排在 yCollab 前：CodeMirror 按扩展优先级后挂 baseTheme，前面的覆盖 y-codemirror.next 自带的 yRemoteSelectionsTheme。
 */
export function collabExtension(session: CollabSession, readonly: boolean): Extension {
  const lock: Extension = readonly || !session.synced ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
  if (!session.synced) return lock
  return [
    remoteCursorTheme(),
    yCollab(session.text, session.awareness, { undoManager: false }),
    remoteOutsideHistory,
    dropStaleFullReplace,
    alignOnAttach,
    lock,
  ]
}

const remoteOutsideHistory = EditorState.transactionExtender.of((tr) =>
  tr.docChanged && tr.annotation(ySyncAnnotation) === tr.startState.facet(ySyncFacet)
    ? { annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] }
    : null,
)

const dropStaleFullReplace = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) || tr.annotation(ySyncAnnotation)) return tr
  let whole = false
  let spans = 0
  tr.changes.iterChangedRanges((fromA, toA) => {
    spans++
    whole = fromA === 0 && toA === tr.startState.doc.length
  })
  return spans === 1 && whole ? [] : tr
})

/** 附着时把编辑器文档对齐到 Y.Text（服务端权威）；ViewPlugin 构造期不能 dispatch，推到微任务 */
const alignOnAttach = ViewPlugin.define((view) => {
  const conf = view.state.facet(ySyncFacet)
  queueMicrotask(() => {
    const want = conf.ytext.toString()
    const cur = view.state.doc.toString()
    if (cur === want || view.state.facet(ySyncFacet) !== conf) return
    view.dispatch({ changes: { from: 0, to: cur.length, insert: want }, annotations: [ySyncAnnotation.of(conf)] })
  })
  return {}
})
