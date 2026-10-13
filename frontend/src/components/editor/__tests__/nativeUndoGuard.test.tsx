// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CardEditor } from '@/components/cards/CardEditor'

/**
 * nativeUndoGuard 回归钉（走查 OBS-B81-1）：
 * 焦点在 .cm-content 之外（查找面板 input）按 Ctrl+Z，浏览器原生 undo 直改 contenteditable
 * 文档、绕过 CM history（实测静默删 34 字）。原生 undo 必经 beforeinput inputType=historyUndo——
 * 守卫拦之；CM 自身 Mod-Z 走事务不受影响；普通输入 beforeinput 放行。
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= rects
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

const mount = async () => {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<CardEditor value={'第一行\n第二行'} dark={false} ariaLabel="test" testId="card-editor" />))
  const content = host.querySelector('.cm-content') as HTMLElement
  const view = content && EditorView.findFromDOM(content)
  if (!view) throw new Error('no EditorView')
  return view
}

const beforeinput = (view: EditorView, inputType: string) => {
  const ev = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
  view.contentDOM.dispatchEvent(ev)
  return ev
}

describe('nativeUndoGuard', () => {
  it('historyUndo / historyRedo beforeinput 被拦截，文档不变', async () => {
    const view = await mount()
    const before = view.state.doc.toString()
    expect(beforeinput(view, 'historyUndo').defaultPrevented).toBe(true)
    expect(beforeinput(view, 'historyRedo').defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe(before)
  })

  it('普通 insertText beforeinput 放行', async () => {
    const view = await mount()
    expect(beforeinput(view, 'insertText').defaultPrevented).toBe(false)
  })

  it('焦点在 .cm-content 内时 Mod-Z 放行 CM undo', async () => {
    const view = await mount()
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'X' } })
    expect(view.state.doc.toString().endsWith('X')).toBe(true)
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true) // CM undo 消费
    expect(view.state.doc.toString()).toBe('第一行\n第二行')
  })
})
