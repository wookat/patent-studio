import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Awareness } from 'y-protocols/awareness'
import { api, type CollabBook } from '@/lib/api'
import type { User } from '@/lib/types'
import { useStudio, type CollabPeer, type CollabStatus } from '@/store'
import { colorFor, userColor } from './colors'

/**
 * R8 协同连接（docs/plan/11 §5.1；单元 G2-collab-client 所有）。
 *
 * 一房间一连接：`(pid, book)` ↔ 一个 Y.Doc（`doc.getText('content')`）+ 一个 y-websocket provider（同源 cookie 随握手）。
 * awareness 本地状态形状固定为 y-codemirror.next 读取的 `{ user: { name, color, colorLight }, cursor }`
 * （`yRemoteSelections` 从 `state.user` 取名与色、`state.cursor` 取光标/选区），再加 `readonly` 供在线头像 / 协作者中心标记只读端。
 *
 * 状态机（§5.5）：
 *   connecting ──首个 sync──▶ connected ──close/disconnected──▶ reconnecting ──sync──▶ connected
 *   任意状态 ──close 1008（服务端拒绝：off / bad_book / forbidden）──▶ off（provider 销毁，回本地 PUT 路径）
 * 首个 sync 之前 `session.synced === false`，`collabExtension` 此时只给只读扩展、不接 ySync（避免把空/旧文档同步上去）。
 */
export interface CollabUser {
  name: string
  /** AUTH=on 的用户 id：跨房间 / 跨视图的去重键（同名成员不能按 name 塌缩）；off / 访客缺省 */
  uid?: string | null
  /** `colorFor(name)` */
  color: string
  readonly: boolean
}

export interface CollabSessionHandlers {
  onStatus(status: CollabStatus, error?: string | null): void
  onPeers(peers: CollabPeer[]): void
  /** 首个 sync 完成（此后 `session.synced` 为 true，可挂 ySync 扩展） */
  onSynced?(): void
  /** 用户可见提示（断线 / 重连 / 被拒） */
  onToast?(text: string, kind?: 'info' | 'error'): void
}

export interface CollabSession {
  pid: string
  book: CollabBook
  doc: Y.Doc
  /** 房间正文；服务端权威，首连由 docs/{book}.md 初始化 */
  text: Y.Text
  provider: WebsocketProvider
  awareness: Awareness
  user: CollabUser
  /** 首个 sync 是否已完成 */
  readonly synced: boolean
  status: CollabStatus
  /** 断线 + 释放 doc；之后本地编辑回到 PUT /content 路径 */
  destroy(): void
}

export interface ConnectOptions {
  /** 测试注入（默认全局 WebSocket） */
  WebSocketPolyfill?: typeof WebSocket
  /** 默认 true；false 时只建对象不联网（测试/离线合并用例） */
  connect?: boolean
  /** 覆写房间服务地址（默认 `api.collabWs` 同源；开发时指向本地 y-websocket / pycrdt-websocket） */
  serverUrl?: string
}

/** Y.Doc 内固定的 Text 键名（服务端 `YRoom.ydoc["content"]` 同名） */
export const YTEXT_KEY = 'content'

/** 服务端「拒绝，勿重连」的 close code（rooms/routes.py `close(1008, reason)`） */
export const REJECT_CODE = 1008

/** awareness 里每个客户端的状态形状（y-codemirror.next 读 user/cursor；readonly 为本项目扩展） */
export interface AwarenessState {
  user?: { name?: string; color?: string; colorLight?: string }
  /** 本项目扩展：AUTH=on 的 user.id；多个房间 / 同名成员按它去重，name 只作显示与访客兜底 */
  uid?: string | null
  cursor?: { anchor: unknown; head: unknown } | null
  readonly?: boolean
}

/** 默认 handlers：直接写 store（integrate 若无特殊需要可不传 handlers） */
export function storeHandlers(): CollabSessionHandlers {
  const s = () => useStudio.getState()
  return {
    onStatus: (status, error) => s().setCollabStatus(status, error),
    onPeers: (peers) => s().setPeers(peers),
    onToast: (text, kind) => s().toast(text, kind),
  }
}

export function connectCollab(
  pid: string,
  book: CollabBook,
  user: CollabUser,
  handlers: CollabSessionHandlers = storeHandlers(),
  opts: ConnectOptions = {},
): CollabSession | null {
  const WS = opts.WebSocketPolyfill ?? (typeof WebSocket === 'undefined' ? null : WebSocket)
  if (!WS) return null
  const doc = new Y.Doc()
  const text = doc.getText(YTEXT_KEY)
  const { serverUrl, roomname } = api.collabWs(pid, book)
  const provider = new WebsocketProvider(opts.serverUrl ?? serverUrl, roomname, doc, {
    connect: false,
    WebSocketPolyfill: WS,
    disableBc: true,
    shouldReconnect: (ev) => ev.code !== REJECT_CODE,
  })
  const awareness = provider.awareness
  awareness.setLocalState({
    user: { name: user.name, color: user.color, colorLight: `${user.color}33` },
    uid: user.uid ?? null,
    cursor: null,
    readonly: user.readonly,
  } satisfies AwarenessState)

  let synced = false
  let disconnectToasted = false
  let lastClose: string | null = null
  const session: CollabSession = {
    pid,
    book,
    doc,
    text,
    provider,
    awareness,
    user,
    get synced() {
      return synced
    },
    status: 'connecting',
    destroy,
  }
  const setStatus = (st: CollabStatus, error: string | null = null) => {
    session.status = st
    handlers.onStatus(st, error)
  }
  const emitPeers = () => handlers.onPeers(peersFrom(awareness, doc))

  const onSync = (state: boolean) => {
    if (!state) return
    const first = !synced
    synced = true
    lastClose = null
    setStatus('connected')
    if (first) handlers.onSynced?.()
    else if (disconnectToasted) {
      disconnectToasted = false
      handlers.onToast?.('已重新连接')
    }
    emitPeers()
  }
  const onStatusEv = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (status === 'connected') {
      if (synced) setStatus('connected')
      return
    }
    if (status === 'disconnected' && synced) {
      setStatus('reconnecting', lastClose)
      if (!disconnectToasted) {
        disconnectToasted = true
        handlers.onToast?.('已断线，继续编辑，重连后自动合并')
      }
    }
  }
  /** 服务端断开（非 1008）：y-websocket 自行指数退避重连，这里只更新状态与 close code */
  const onClose = (ev: CloseEvent | null) => {
    if (ev == null || ev.code === REJECT_CODE) return
    lastClose = `close ${ev.code}`
    setStatus(synced ? 'reconnecting' : 'connecting', lastClose)
  }
  /** 1008 ⇒ shouldReconnect=false ⇒ provider 停止重连并发 'closed'：销毁会话回本地模式 */
  const onClosed = ({ code, reason }: { code: number; reason: string }) => {
    destroy()
    handlers.onStatus('off', `close ${code} ${reason || 'rejected'}`)
    handlers.onToast?.(reason === 'forbidden' ? '协同不可用：无权限，已回到本地模式' : '协同不可用，已回到本地模式', 'error')
  }
  const onAwareness = () => emitPeers()

  // 标签页关闭/导航：先广播 awareness 移除再断连——浏览器在 pagehide 里仍派发 close 帧，
  // 对端即时看到离开（不必等服务端 ping 超时）；BFCache 恢复时 pageshow(persisted) 回连。
  const onPageHide = () => {
    awareness.setLocalState(null)
    provider.disconnect()
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted && session.status !== 'off') provider.connect()
  }
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)

  provider.on('sync', onSync)
  provider.on('status', onStatusEv)
  provider.on('connection-close', onClose)
  provider.on('closed', onClosed)
  awareness.on('change', onAwareness)
  setStatus('connecting')
  // 延到微任务再开握手：React StrictMode / 快速切书会在同一同步周期里 mount→destroy，避免建了又立即关的空 socket
  if (opts.connect ?? true) queueMicrotask(() => session.status !== 'off' && provider.connect())

  function destroy() {
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    provider.off('sync', onSync)
    provider.off('status', onStatusEv)
    provider.off('connection-close', onClose)
    provider.off('closed', onClosed)
    awareness.off('change', onAwareness)
    provider.destroy()
    doc.destroy()
    session.status = 'off'
    handlers.onPeers([])
  }
  return session
}

/** awareness → 在线协作者（过滤自身 clientID；无 user.name 的连接不显示——旧版匿名镜像即此形态） */
export function peersFrom(awareness: Awareness, doc: Y.Doc): CollabPeer[] {
  const text = doc.getText(YTEXT_KEY)
  const peers: CollabPeer[] = []
  awareness.getStates().forEach((raw, clientId) => {
    if (clientId === doc.clientID) return
    const st = raw as AwarenessState
    const name = st.user?.name?.trim()
    if (!name) return
    peers.push({
      id: clientId,
      uid: st.uid ?? null,
      name,
      color: st.user?.color || colorFor(name),
      line: cursorLine(st.cursor, text),
      readonly: st.readonly === true,
    })
  })
  return peers.sort((a, b) => a.id - b.id)
}

/** 远端光标 head（Y.RelativePosition JSON）→ 1 起行号；无光标或不属于本 Text ⇒ null */
export function cursorLine(cursor: AwarenessState['cursor'], text: Y.Text): number | null {
  if (!cursor?.head || !text.doc) return null
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.head), text.doc)
  if (!abs || abs.type !== text) return null
  const s = text.toString()
  let line = 1
  const end = Math.min(abs.index, s.length)
  for (let i = 0; i < end; i++) if (s.charCodeAt(i) === 10) line++
  return line
}

const GUEST_KEY = 'patent-studio:collab:guest'

/** AUTH=off 的访客名：首次生成「访客-XXXX」存 localStorage，同浏览器跨会话稳定 */
export function guestName(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string {
  const saved = storage?.getItem(GUEST_KEY)
  if (saved) return saved
  const name = `访客-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  storage?.setItem(GUEST_KEY, name)
  return name
}

/** 当前用户 → 协同身份（§5.4：AUTH=on 取 display_name || email + uid 去重键；off 用访客名）；readonly 由调用方按角色给 */
export function collabUserFor(me: (Pick<User, 'display_name' | 'email' | 'avatar_color'> & { id?: string | null }) | null, readonly = false): CollabUser {
  const name = me ? me.display_name?.trim() || me.email : guestName()
  return { name, uid: me?.id ?? null, color: me ? userColor(me) : colorFor(name), readonly }
}

/** 供测试/占位使用：不联网的本地 Y.Doc + Text */
export function localDoc(initial = ''): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc()
  const text = doc.getText(YTEXT_KEY)
  if (initial) text.insert(0, initial)
  return { doc, text }
}
