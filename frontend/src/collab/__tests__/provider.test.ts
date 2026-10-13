// @vitest-environment jsdom
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import {
  REJECT_CODE,
  collabUserFor,
  colorFor,
  connectCollab,
  cursorLine,
  guestName,
  localDoc,
  peersFrom,
  type CollabSession,
  type CollabSessionHandlers,
} from '@/collab'
import { FakeServer, flush } from './fakeServer'

type Log = { status: string[]; errors: (string | null | undefined)[]; peers: string[][]; toasts: string[]; synced: number }

function recorder(): { log: Log; handlers: CollabSessionHandlers } {
  const log: Log = { status: [], errors: [], peers: [], toasts: [], synced: 0 }
  return {
    log,
    handlers: {
      onStatus: (s, e) => {
        log.status.push(s)
        log.errors.push(e)
      },
      onPeers: (p) => log.peers.push(p.map((x) => x.name)),
      onSynced: () => log.synced++,
      onToast: (t) => log.toasts.push(t),
    },
  }
}

const sessions: CollabSession[] = []
function open(server: FakeServer, name: string, readonly = false, handlers = recorder()) {
  const s = connectCollab('p1', 'content', { name, color: colorFor(name), readonly }, handlers.handlers, {
    WebSocketPolyfill: server.WebSocket,
  })
  if (!s) throw new Error('connectCollab returned null')
  sessions.push(s)
  return { s, ...handlers }
}

afterEach(() => {
  for (const s of sessions.splice(0)) if (s.status !== 'off') s.destroy()
  vi.useRealTimers()
})

describe('connectCollab 状态机（docs/plan/11 §5.5）', () => {
  it('connecting → 首个 sync → connected；房间正文（服务端权威）落到本地 Y.Text；扩展挂载前 synced=false', async () => {
    const server = new FakeServer({ content: '# 说明书\n\n第一段' })
    const { s, log } = open(server, '张三')
    expect(s.status).toBe('connecting')
    expect(s.synced).toBe(false)
    expect(log.status).toEqual(['connecting'])
    await flush()
    expect(s.synced).toBe(true)
    expect(s.status).toBe('connected')
    expect(log.synced).toBe(1)
    expect(s.text.toString()).toBe('# 说明书\n\n第一段')
    expect(log.status.at(-1)).toBe('connected')
    // 握手 URL：同源 /api/projects/{pid}/collab/{book}
    expect(s.provider.url).toBe(`ws://${location.host}/api/projects/p1/collab/content`)
    expect(server.accepts).toBe(1)
  })

  it('两端同编一书：并发插入互相可见、字不丢；awareness 互见且过滤自身', async () => {
    const server = new FakeServer({ content: 'abc' })
    const a = open(server, '作者')
    const b = open(server, '代理人')
    await flush()
    expect(a.s.text.toString()).toBe('abc')
    expect(b.s.text.toString()).toBe('abc')

    a.s.text.insert(0, 'A')
    b.s.text.insert(3, 'B')
    await flush()
    expect(a.s.text.toString()).toBe('AabcB')
    expect(b.s.text.toString()).toBe('AabcB')
    expect(server.text('content')).toBe('AabcB')

    const peersA = peersFrom(a.s.awareness, a.s.doc)
    expect(peersA.map((p) => p.name)).toEqual(['代理人'])
    expect(peersA[0].color).toBe(colorFor('代理人'))
    expect(peersA[0].readonly).toBe(false)
    expect(peersFrom(b.s.awareness, b.s.doc).map((p) => p.name)).toEqual(['作者'])
    expect(a.log.peers.at(-1)).toEqual(['代理人'])

    // 对端光标 → 行号（y-codemirror.next 写 cursor:{anchor,head} 为 RelativePosition JSON）
    const at = (i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(b.s.text, i))
    b.s.awareness.setLocalStateField('cursor', { anchor: at(3), head: at(3) })
    await flush()
    expect(peersFrom(a.s.awareness, a.s.doc)[0].line).toBe(1)
    // 对端光标不动，本端在光标前插入两行 → RelativePosition 跟随文本，行号变 3
    a.s.text.insert(0, '首行\n次行\n')
    await flush()
    expect(peersFrom(a.s.awareness, a.s.doc)[0].line).toBe(3)

    // 对端离开 → peers 清空
    b.s.destroy()
    await flush()
    expect(peersFrom(a.s.awareness, a.s.doc)).toEqual([])
    expect(a.log.peers.at(-1)).toEqual([])
  })

  it('离线重连合并：断线期间两端各自编辑，重连后 sync 收敛且状态 reconnecting → connected', async () => {
    const server = new FakeServer({ content: '第一行\n第二行\n' })
    const a = open(server, '作者')
    const b = open(server, '代理人')
    await flush()

    server.dropAll(1006)
    await flush()
    expect(a.s.status).toBe('reconnecting')
    expect(a.log.status.at(-1)).toBe('reconnecting')
    expect(a.log.errors.at(-1)).toBe('close 1006')
    expect(a.log.toasts).toEqual(['已断线，继续编辑，重连后自动合并'])

    a.s.text.insert(0, '【作者离线加】')
    b.s.text.insert(b.s.text.length, '【代理人离线加】')
    expect(server.text('content')).toBe('第一行\n第二行\n')

    // y-websocket 退避：首次 200 ms 后重连
    await flush(350)
    expect(a.s.status).toBe('connected')
    expect(b.s.status).toBe('connected')
    const want = '【作者离线加】第一行\n第二行\n【代理人离线加】'
    expect(a.s.text.toString()).toBe(want)
    expect(b.s.text.toString()).toBe(want)
    expect(server.text('content')).toBe(want)
    expect(a.log.toasts).toEqual(['已断线，继续编辑，重连后自动合并', '已重新连接'])
    expect(a.log.synced).toBe(1)
  })

  it('R24-03 死窗口：断线瞬间已敲未送达的编辑 + 服务端外部全量改写，重连后本地编辑仍存活', async () => {
    const server = new FakeServer({ content: '第一行\n第二行\n' })
    const a = open(server, '作者')
    await flush()

    server.dropAll(1006)
    // 半死窗口内键入（ws 已断、退避计时中）：ops 只进本地 doc
    a.s.text.insert(0, '【断线瞬间敲下】')
    expect(server.text('content')).toBe('第一行\n第二行\n')
    // 断线期间另一路 REST 保存触发服务端整篇替换（apply_external）
    const t = server.room('content').doc.getText('content')
    t.delete(0, t.length)
    t.insert(0, '外部整篇改写\n')

    await flush(400) // 退避 200ms 后重连 + sync 收敛
    expect(a.s.status).toBe('connected')
    expect(a.s.text.toString()).toContain('【断线瞬间敲下】')
    expect(server.text('content')).toContain('【断线瞬间敲下】')
    expect(server.text('content')).toContain('外部整篇改写')
  })

  it('1008 拒绝（collab off / bad_book / forbidden）→ off + 错误 + 不再重连，回本地 PUT 模式', async () => {
    const server = new FakeServer()
    server.reject = { code: REJECT_CODE, reason: 'forbidden' }
    const { s, log } = open(server, '访客-AB12')
    await flush()
    expect(s.status).toBe('off')
    expect(log.status).toEqual(['connecting', 'off'])
    expect(log.errors.at(-1)).toBe('close 1008 forbidden')
    expect(log.toasts).toEqual(['协同不可用：无权限，已回到本地模式'])
    expect(log.peers.at(-1)).toEqual([])
    expect(s.provider.shouldConnect).toBe(false)
    await flush(400)
    expect(server.accepts).toBe(1)
  })

  it('只读端：awareness 带 readonly=true，对端 PresenceBar 可标只读；服务端丢弃其写入不影响他端', async () => {
    const server = new FakeServer({ content: 'x' })
    const a = open(server, '作者')
    const v = open(server, '审阅者', true)
    await flush()
    expect(peersFrom(a.s.awareness, a.s.doc)).toMatchObject([{ name: '审阅者', readonly: true }])
    expect(peersFrom(v.s.awareness, v.s.doc)).toMatchObject([{ name: '作者', readonly: false }])
    server.readonlyNames.add('审阅者')
    v.s.text.insert(0, 'V')
    a.s.text.insert(1, 'A')
    await flush()
    expect(server.text('content')).toBe('xA')
    expect(a.s.text.toString()).toBe('xA')
  })

  it('无 WebSocket 实现 → null；默认 handlers 写 store', async () => {
    expect(connectCollab('p', 'content', { name: 'n', color: colorFor('n'), readonly: false }, undefined, { WebSocketPolyfill: undefined, connect: false })).not.toBeNull()
    const ws = globalThis.WebSocket
    // @ts-expect-error 模拟无 WebSocket 环境
    delete globalThis.WebSocket
    try {
      expect(connectCollab('p', 'content', { name: 'n', color: colorFor('n'), readonly: false })).toBeNull()
    } finally {
      globalThis.WebSocket = ws
    }

    useStudio.getState().resetCollab()
    const server = new FakeServer({ content: '' })
    const s = connectCollab('p1', 'content', collabUserFor({ display_name: '张三', email: 'z@x' }), undefined, {
      WebSocketPolyfill: server.WebSocket,
    })!
    sessions.push(s)
    expect(useStudio.getState().collabStatus).toBe('connecting')
    await flush()
    expect(useStudio.getState().collabStatus).toBe('connected')
    const other = open(server, '李四')
    await flush()
    expect(useStudio.getState().peers.map((p) => p.name)).toEqual(['李四'])
    other.s.destroy()
    s.destroy()
    await flush()
    expect(useStudio.getState().peers).toEqual([])
    useStudio.getState().resetCollab()
  })
})

describe('身份与颜色（§5.4）', () => {
  it('collabUserFor：display_name || email；AUTH=off 访客名跨会话稳定', () => {
    expect(collabUserFor({ id: 'u9', display_name: ' 张三 ', email: 'z@x.com' })).toEqual({ name: '张三', uid: 'u9', color: colorFor('张三'), readonly: false })
    expect(collabUserFor({ display_name: '', email: 'z@x.com' }, true)).toEqual({ name: 'z@x.com', uid: null, color: colorFor('z@x.com'), readonly: true })
    const store = new Map<string, string>()
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const g1 = guestName(st)
    expect(g1).toMatch(/^访客-[0-9A-Z]{4}$/)
    expect(guestName(st)).toBe(g1)
    expect(guestName(null)).toMatch(/^访客-[0-9A-Z]{4}$/)
    const guest = collabUserFor(null)
    expect(guest.name.startsWith('访客-')).toBe(true)
    expect(guest.color).toBe(colorFor(guest.name))
  })

  it('cursorLine：无光标 / 不属于本 Text ⇒ null；行号 1 起', () => {
    const { doc, text } = localDoc('a\nb\nc')
    expect(cursorLine(null, text)).toBeNull()
    expect(cursorLine(undefined, text)).toBeNull()
    const at = (i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, i))
    expect(cursorLine({ anchor: at(0), head: at(0) }, text)).toBe(1)
    expect(cursorLine({ anchor: at(2), head: at(2) }, text)).toBe(2)
    expect(cursorLine({ anchor: at(5), head: at(5) }, text)).toBe(3)
    const other = doc.getText('other')
    other.insert(0, 'zz')
    const foreign = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(other, 1))
    expect(cursorLine({ anchor: foreign, head: foreign }, text)).toBeNull()
  })
})
