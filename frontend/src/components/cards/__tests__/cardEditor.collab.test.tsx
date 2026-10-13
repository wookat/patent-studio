// @vitest-environment jsdom
import { useEffect, useState, type ReactElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CardEditor } from '../CardEditor'
import { collabExtension, colorFor, connectCollab, type CollabSession } from '@/collab'
import { FakeServer, flush } from '@/collab/__tests__/fakeServer'

/**
 * 协同下受控 value 的“旧快照”判定（wave3 R3 P1 回归）：
 * 远端推进来 CriticMarkup 后，本端拒绝修订 → store 恢复到推送前的正文；这个正文曾被编辑器 onChange 上报过，
 * 不能被当作 React 落后的陈旧回声丢掉，必须写进 Y.Text 并到服务端；而真正的陈旧回声（value 马上又变回最新）仍不回滚。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const sessions: CollabSession[] = []

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
  for (const s of sessions.splice(0)) if (s.status !== 'off') s.destroy()
})

function session(server: FakeServer, name: string) {
  const s = connectCollab('p1', 'claims', { name, color: colorFor(name), readonly: false }, { onStatus() {}, onPeers() {} }, {
    WebSocketPolyfill: server.WebSocket,
  })!
  sessions.push(s)
  return s
}

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const viewOf = () => {
  const content = host.querySelector('[data-testid="card-editor"] .cm-content')
  const v = content && EditorView.findFromDOM(content as HTMLElement)
  if (!v) throw new Error('no EditorView')
  return v
}

let setValue: (v: string) => void = () => {}
let seen: string[] = []

function Harness({ ext }: { ext: ReturnType<typeof collabExtension> }) {
  const [value, set] = useState('权利要求 1\n权利要求 2')
  useEffect(() => {
    setValue = set
  }, [])
  return (
    <CardEditor
      value={value}
      onChange={(v) => {
        seen.push(v)
        set(v)
      }}
      dark={false}
      ariaLabel="claims"
      collabExtension={ext}
    />
  )
}

const settle = async () => {
  await act(async () => {
    await flush()
    await new Promise((r) => setTimeout(r, 5))
    await flush()
  })
}

describe('CardEditor × collab：受控 value 恢复到曾上报过的旧正文', () => {
  it('远端插入 CriticMarkup → 本端拒绝（value 回到推送前）→ 编辑器 / Y.Text / 服务端三方一致', async () => {
    seen = []
    const server = new FakeServer({ claims: '权利要求 1\n权利要求 2' })
    const me = session(server, '作者')
    const agent = session(server, 'MCP')
    await flush()
    await mount(<Harness ext={collabExtension(me, false)} />)
    await settle()
    expect(viewOf().state.doc.toString()).toBe('权利要求 1\n权利要求 2')
    // 作者先键入一字 ⇒ 该正文进入 onChange 历史
    await act(async () => viewOf().dispatch({ changes: { from: 6, insert: 'X' }, userEvent: 'input.type' }))
    await settle()
    const base = '权利要求 1X\n权利要求 2'
    expect(seen.at(-1)).toBe(base)
    expect(server.text('claims')).toBe(base)

    // 远端（MCP patch_block 经服务端广播）插入建议
    agent.text.insert(7, '{++MCPR3++}')
    await settle()
    const marked = '权利要求 1X{++MCPR3++}\n权利要求 2'
    expect(viewOf().state.doc.toString()).toBe(marked)
    expect(seen.at(-1)).toBe(marked)

    // 本端拒绝：store 恢复到推送前正文（该正文曾被 onChange 上报过）
    await act(async () => setValue(base))
    await settle()
    expect(viewOf().state.doc.toString()).toBe(base)
    expect(me.text.toString()).toBe(base)
    expect(agent.text.toString()).toBe(base)
    expect(server.text('claims')).toBe(base)
  })

  it('真正的陈旧回声（value 落后一步随即追上）不回滚编辑器', async () => {
    seen = []
    const server = new FakeServer({ claims: '权利要求 1\n权利要求 2' })
    const me = session(server, '作者')
    await flush()
    await mount(<Harness ext={collabExtension(me, false)} />)
    await settle()
    const v = viewOf()
    await act(async () => {
      v.dispatch({ changes: { from: 0, insert: 'A' } })
      v.dispatch({ changes: { from: 0, insert: 'B' } })
    })
    // React 用落后一步的快照重渲染，随即又拿到最新值
    await act(async () => setValue('A权利要求 1\n权利要求 2'))
    await act(async () => setValue('BA权利要求 1\n权利要求 2'))
    await settle()
    expect(viewOf().state.doc.toString()).toBe('BA权利要求 1\n权利要求 2')
    expect(me.text.toString()).toBe('BA权利要求 1\n权利要求 2')
    expect(server.text('claims')).toBe('BA权利要求 1\n权利要求 2')
  })
})
