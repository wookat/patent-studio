// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ySyncFacet } from 'y-codemirror.next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCollabSession } from '@/collab'
import { useStudio } from '@/store'
import { FakeServer, flush } from './fakeServer'

let root: Root | null = null
let host: HTMLDivElement | null = null
let latest: Extension | undefined
let renders = 0

function Probe({ book }: { book: 'content' | 'claims' }) {
  const ext = useCollabSession(book)
  useEffect(() => {
    latest = ext
    renders++
  })
  return null
}

async function mount(book: 'content' | 'claims' = 'content') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe book={book} />))
}

const state = (ext: Extension | undefined) => EditorState.create({ doc: '', extensions: ext ?? [] })
const st = () => useStudio.getState()

beforeEach(() => {
  latest = undefined
  renders = 0
  useStudio.setState({ pid: 'p1', authStatus: 'off', user: null })
  st().resetCollab()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
  useStudio.setState({ pid: null })
  st().resetCollab()
})

describe('useCollabSession（Editor 接线，docs/plan/11 §5.3）', () => {
  it('探测未完成 / 不可用 / 账号未知时不建连接；probed===pid 后建连并在首个 sync 后接上 ySync', async () => {
    const server = new FakeServer({ content: '房间正文' })
    vi.stubGlobal('WebSocket', server.WebSocket)
    await mount()
    expect(latest).toBeUndefined()
    expect(server.accepts).toBe(0)

    await act(async () => useStudio.setState({ collabProbed: 'p1', collabUnavailable: true }))
    expect(latest).toBeUndefined()
    await act(async () => useStudio.setState({ collabUnavailable: false, authStatus: 'unknown' }))
    expect(latest).toBeUndefined()

    // fakeServer 在同一个 act 内完成首个 sync（sync 前的“只锁不接 ySync”由 yCodemirror.test 覆盖）
    await act(async () => {
      useStudio.setState({ authStatus: 'off' })
      await flush()
    })
    expect(st().collabStatus).toBe('connected')
    const s = state(latest)
    expect(s.readOnly).toBe(false)
    expect(s.facet(ySyncFacet)?.ytext.toString()).toBe('房间正文')
    expect(server.accepts).toBe(1)
  })

  it('viewer：collabReadonly ⇒ 扩展锁 readOnly 且 awareness 标 readonly；切案先 destroy 再新建；卸载回 off', async () => {
    const server = new FakeServer({ content: 'x' })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1', collabReadonly: true })
    await mount()
    await act(async () => {
      await flush()
    })
    let s = state(latest)
    expect(s.facet(ySyncFacet)).toBeDefined()
    expect(s.readOnly).toBe(true)
    expect(s.facet(EditorView.editable)).toBe(false)
    expect([...server.sockets].some((k) => k.url.includes('/p1/'))).toBe(true)

    // 切案：p2 探测未完成 ⇒ 旧会话销毁、扩展撤下；探测完成 ⇒ 新房间
    await act(async () => useStudio.setState({ pid: 'p2', collabProbed: null, collabReadonly: false }))
    expect(latest).toBeUndefined()
    expect(st().collabStatus).toBe('off')
    expect([...server.sockets].filter((k) => k.readyState === WebSocket.OPEN)).toHaveLength(0)

    await act(async () => useStudio.setState({ collabProbed: 'p2' }))
    await act(async () => {
      await flush()
    })
    s = state(latest)
    expect(s.readOnly).toBe(false)
    expect([...server.sockets].some((k) => k.readyState === WebSocket.OPEN && k.url.includes('/p2/'))).toBe(true)
    expect(server.accepts).toBe(2)

    await act(async () => root?.unmount())
    expect(st().collabStatus).toBe('off')
    expect([...server.sockets].filter((k) => k.readyState === WebSocket.OPEN)).toHaveLength(0)
    expect(renders).toBeGreaterThan(0)
  })

  it('服务端 1008 拒绝 ⇒ provider 自毁、状态 off、扩展撤下（编辑器回本地 PUT 路径），不重连', async () => {
    const server = new FakeServer()
    server.reject = { code: 1008, reason: 'forbidden' }
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ collabProbed: 'p1' })
    await mount()
    await act(async () => {
      await flush(50)
    })
    expect(st().collabStatus).toBe('off')
    expect(latest).toBeUndefined()
    expect(server.accepts).toBe(1)
  })
})
