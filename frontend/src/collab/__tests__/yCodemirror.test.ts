// @vitest-environment jsdom
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ySyncFacet } from 'y-codemirror.next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { collabExtension, colorFor, connectCollab, type CollabSession } from '@/collab'
import { FakeServer, flush } from './fakeServer'

/** jsdom 无 Range 几何；CodeMirror 的 rAF measure 在 destroy 前触发时会抛 getClientRects is not a function（同 cardsCollab.test 补空实现） */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= rects
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
})

/** 模拟 Editor.tsx 的用法：Compartment 槽 + 首个 sync 后 reconfigure */
const slot = new Compartment()
let view: EditorView | null = null
const sessions: CollabSession[] = []

function mountView(doc: string, ext = slot.of([])) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({ state: EditorState.create({ doc, extensions: [ext] }), parent })
  return view
}

function session(server: FakeServer, name: string, readonly = false) {
  const s = connectCollab('p1', 'content', { name, color: colorFor(name), readonly }, { onStatus() {}, onPeers() {} }, {
    WebSocketPolyfill: server.WebSocket,
  })!
  sessions.push(s)
  return s
}

afterEach(() => {
  view?.destroy()
  view = null
  for (const s of sessions.splice(0)) if (s.status !== 'off') s.destroy()
  document.body.innerHTML = ''
})

describe('collabExtension（docs/plan/11 §5.3）', () => {
  it('首个 sync 前只锁编辑（readOnly + 不可编辑），不接 ySync；sync 后热换接上，编辑器对齐到房间正文', async () => {
    const server = new FakeServer({ content: '房间正文\n第二行' })
    const s = session(server, '张三')
    const v = mountView('本地旧快照', slot.of(collabExtension(s, false)))
    expect(s.synced).toBe(false)
    expect(v.state.readOnly).toBe(true)
    expect(v.state.facet(EditorView.editable)).toBe(false)
    expect(v.state.facet(ySyncFacet)).toBeUndefined()

    await flush()
    expect(s.synced).toBe(true)
    v.dispatch({ effects: slot.reconfigure(collabExtension(s, false)) })
    expect(v.state.readOnly).toBe(false)
    expect(v.state.facet(EditorView.editable)).toBe(true)
    expect(v.state.facet(ySyncFacet)?.ytext).toBe(s.text)
    await flush()
    expect(v.state.doc.toString()).toBe('房间正文\n第二行')
    expect(s.text.toString()).toBe('房间正文\n第二行')
    expect(server.text('content')).toBe('房间正文\n第二行')
  })

  it('本地键入 → Y.Text → 服务端；远端更新 → 编辑器；两端 EditorView 同编不丢字', async () => {
    const server = new FakeServer({ content: 'abc' })
    const a = session(server, '作者')
    const b = session(server, '代理人')
    await flush()
    const va = mountView('abc', slot.of(collabExtension(a, false)))
    const slotB = new Compartment()
    const parentB = document.createElement('div')
    document.body.appendChild(parentB)
    const vb = new EditorView({ state: EditorState.create({ doc: 'abc', extensions: [slotB.of(collabExtension(b, false))] }), parent: parentB })
    try {
      va.dispatch({ changes: { from: 0, insert: 'A' } })
      vb.dispatch({ changes: { from: 3, insert: 'B' } })
      await flush()
      expect(a.text.toString()).toBe('AabcB')
      expect(va.state.doc.toString()).toBe('AabcB')
      expect(vb.state.doc.toString()).toBe('AabcB')
      expect(server.text('content')).toBe('AabcB')
      // 本端光标进 awareness（y-codemirror.next 只在编辑器聚焦时写 state.cursor；jsdom 无真实焦点，桩掉）
      Object.defineProperty(va, 'hasFocus', { get: () => true })
      const hadFocus = document.hasFocus
      document.hasFocus = () => true
      try {
        va.dispatch({ selection: { anchor: 5 } })
        await flush()
      } finally {
        document.hasFocus = hadFocus
      }
      const st = b.awareness.getStates().get(a.doc.clientID) as { cursor?: { head: unknown }; user?: { name: string } }
      expect(st.user?.name).toBe('作者')
      expect(st.cursor?.head).toBeTruthy()
      // 对端画出远端光标 + 名字标签
      expect(vb.dom.querySelector('.cm-ySelectionCaret')).not.toBeNull()
      expect(vb.dom.querySelector('.cm-ySelectionInfo')?.textContent).toBe('作者')
    } finally {
      vb.destroy()
    }
  })

  it('只读端：readOnly + 不可编辑，但仍接 ySync（远端变更照常进来）', async () => {
    const server = new FakeServer({ content: 'x' })
    const v = session(server, '审阅者', true)
    const w = session(server, '作者')
    await flush()
    const view = mountView('x', slot.of(collabExtension(v, true)))
    expect(view.state.readOnly).toBe(true)
    expect(view.state.facet(EditorView.editable)).toBe(false)
    expect(view.state.facet(ySyncFacet)?.ytext).toBe(v.text)
    w.text.insert(1, 'Y')
    await flush()
    expect(view.state.doc.toString()).toBe('xY')
    expect((v.awareness.getLocalState() as { readonly: boolean }).readonly).toBe(true)
  })

  it('撤销只撤本端：远端事务不进 history（addToHistory=false），undo/redo 走编辑器既有 history 栈', async () => {
    const server = new FakeServer({ content: 'base\n' })
    const a = session(server, '作者')
    const b = session(server, '代理人')
    await flush()
    const v = mountView('base\n', [history(), slot.of(collabExtension(a, false))])
    v.dispatch({ changes: { from: 5, insert: 'A' }, userEvent: 'input.type' })
    await flush()
    b.text.insert(0, 'B')
    await flush()
    expect(v.state.doc.toString()).toBe('Bbase\nA')
    expect(undoDepth(v.state)).toBe(1)
    undo(v)
    await flush()
    expect(v.state.doc.toString()).toBe('Bbase\n')
    expect(b.text.toString()).toBe('Bbase\n')
    redo(v)
    await flush()
    expect(b.text.toString()).toBe('Bbase\nA')
  })

  it('陈旧的受控 value 整篇替换（无 userEvent）被丢弃，不会回滚远端改动；带 userEvent 的全选替换照常', async () => {
    const server = new FakeServer({ content: 'v1' })
    const a = session(server, '作者')
    const b = session(server, '代理人')
    await flush()
    const v = mountView('v1', slot.of(collabExtension(a, false)))
    b.text.insert(2, '+remote')
    await flush()
    expect(v.state.doc.toString()).toBe('v1+remote')
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'v1' } })
    expect(v.state.doc.toString()).toBe('v1+remote')
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'pasted' }, userEvent: 'input.paste' })
    await flush()
    expect(server.text('content')).toBe('pasted')
  })

  it('热换回空扩展（协同 off）后编辑器恢复可编辑，且不再写 Y.Text', async () => {
    const server = new FakeServer({ content: 'q' })
    const s = session(server, '张三')
    await flush()
    const v = mountView('q', slot.of(collabExtension(s, false)))
    v.dispatch({ effects: slot.reconfigure([]) })
    expect(v.state.readOnly).toBe(false)
    expect(v.state.facet(ySyncFacet)).toBeUndefined()
    v.dispatch({ changes: { from: 1, insert: 'Z' } })
    await flush()
    expect(s.text.toString()).toBe('q')
    expect(v.state.doc.toString()).toBe('qZ')
  })
})
