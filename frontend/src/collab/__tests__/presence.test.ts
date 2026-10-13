// @vitest-environment jsdom
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio, selectOnlineCount } from '@/store'
import { splitBooks, bookLineToFull } from '@/lib/docset'
import { colorFor } from '../colors'
import { connectCollab, peersFrom, type CollabSession } from '../provider'
import { acquireRoom, destroyAllRooms } from '../registry'
import { FakeServer, flush } from './fakeServer'

/**
 * R65 presence 聚合：
 * - R65-01 案卷级在线：'content' 镜像房携带真实身份 ⇒ 没开书房间（版面视图 / 移动单书）的用户也在场；
 * - R65-03 去重键 uid：同名成员不塌缩；同一人在书房间 + 镜像房只算一次，且带光标行的书房间条目优先。
 */
const U = (name: string, uid: string | null, readonly = false) => ({ name, uid, color: colorFor(name), readonly })

const DOC = '# 题\n\n## 权利要求书\n1. C1\n\n## 说明书\nD1\n'

/** 远端客户端会话（裸 connectCollab，不进注册表——aggregate 只读本端条目） */
const remote: CollabSession[] = []
const remoteOpen = (server: FakeServer, book: 'claims' | 'content', u: ReturnType<typeof U>) => {
  const s = connectCollab('p1', book, u, { onStatus: () => {}, onPeers: () => {} }, { WebSocketPolyfill: server.WebSocket })
  if (s) remote.push(s)
  return s
}

afterEach(() => {
  for (const s of remote.splice(0)) if (s.status !== 'off') s.destroy()
  destroyAllRooms()
  useStudio.getState().resetCollab()
  useStudio.setState({ user: null, content: DOC })
  vi.unstubAllGlobals()
})

describe('presence 聚合（R65）', () => {
  it('R65-01/03：镜像房在场者计入在线；uid 去重优先书房间条目；同名异 uid 不塌缩', async () => {
    const server = new FakeServer({ claims: '1. C1\n', content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    useStudio.setState({ user: { id: 'me', email: 'me@x', display_name: '我', is_superuser: false }, content: DOC })

    // 本端：claims 书房间 + content 镜像（真实工作台壳同款，走注册表聚合）
    const meBook = acquireRoom('p1', 'claims', U('我', 'me'))
    const meMirror = acquireRoom('p1', 'content', U('我', 'me'), '#mirror')
    // 远端 A/B 用裸 connectCollab（注册表只聚合本端条目）：A 有 claims 卡 + 镜像；B 只有镜像（版面视图）
    const aBook = remoteOpen(server, 'claims', U('张三', 'u1'))
    remoteOpen(server, 'content', U('张三', 'u1'))
    remoteOpen(server, 'content', U('张三', 'u2'))
    expect(meBook && meMirror && aBook).toBeTruthy()
    await flush()

    // A 在 claims 的光标行：书房间条目带行，镜像条目不带——聚合须留下带行的那条
    const at = (i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(aBook!.text, i))
    aBook!.awareness.setLocalStateField('cursor', { anchor: at(0), head: at(0) })
    await flush()

    const peers = useStudio.getState().peers
    expect(peers.map((p) => p.uid).sort()).toEqual(['u1', 'u2'])
    const a = peers.find((p) => p.uid === 'u1')!
    expect(a.name).toBe('张三')
    expect(a.line).toBe(bookLineToFull(splitBooks(DOC), 'claims', 1)) // 书房间行号换算，不是 null
    const b = peers.find((p) => p.uid === 'u2')!
    expect(b.line).toBeNull() // 镜像房 presence 无光标

    // 本端 awareness 也带 uid 上行（对端去重用）
    expect(peersFrom(meMirror!.session.awareness, meMirror!.session.doc).map((p) => p.uid).sort()).toEqual(['u1', 'u2'])
    // 在线数：{me.uid} ∪ {u1,u2} = 3（同名不塌缩）
    expect(selectOnlineCount(useStudio.getState())).toBe(3)
  })

  it('pagehide：主动广播 awareness 移除 + 断连，对端即时看到离开（不等服务端 ping 超时）', async () => {
    const server = new FakeServer({ content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    const me = acquireRoom('p1', 'content', U('我', 'me'))
    const other = remoteOpen(server, 'content', U('张三', 'u1'))
    await flush()
    expect(useStudio.getState().peers).toHaveLength(1)

    window.dispatchEvent(new Event('pagehide'))
    await flush()
    // 服务端视角：me 的连接已关、awareness 已清——对端即时看到离开
    expect(server.room('content').conns.size).toBe(0)
    expect(server.room('content').awareness.getStates().has(me!.session.doc.clientID)).toBe(false)
    // 本端进 reconnecting（BFCache pageshow persisted 可回连）；me 与远端都挂同一 window 监听
    expect(me!.status).toBe('reconnecting')
    expect(other!.status).toBe('reconnecting')
    expect(useStudio.getState().peers).toHaveLength(0)
  })

  it('同名访客（无 uid）按 name 兜底去重——同名远端不重复计数', async () => {
    const server = new FakeServer({ content: DOC })
    vi.stubGlobal('WebSocket', server.WebSocket)
    const me = acquireRoom('p1', 'content', U('访客', null), '#m1')
    const other = remoteOpen(server, 'content', U('访客', null))
    await flush()
    // 两端互见对方，本端聚合按 name 去重为 1
    expect(useStudio.getState().peers).toHaveLength(1)
    expect(peersFrom(me!.session.awareness, me!.session.doc).map((p) => p.name)).toEqual(['访客'])
    expect(other!.status).toBe('connected')
  })
})
