import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Awareness } from 'y-protocols/awareness'
import { colorFor } from '@/collab/colors'

/**
 * 工作副本协同会话：一个 working copy ↔ 一个 Y.Doc（`doc.getText('content')`，与服务端
 * PGRoom 同名键）+ 一个 y-websocket provider。同源 cookie 随握手；服务端鉴权失败以
 * close(1008) 拒绝 ⇒ 状态落到 'off'，编辑器回退到 REST 保存路径。
 *
 * 状态机（与 src/collab/provider.ts 同约定）：
 *   connecting ──首个 sync──▶ connected ──断开──▶ reconnecting ──sync──▶ connected
 *   任意状态 ──close 1008──▶ off（provider 销毁）
 *
 * `unflushed` 统计已进入服务端更新日志但尚未 POST /collab/flush 的本地写入；
 * 提交 revision 前必须先 flush（提交屏障否则以 409 submission_barrier 拒绝）。
 */
export const YTEXT_KEY = 'content'
export const REJECT_CODE = 1008
export const LOCAL_ORIGIN = 'workbench-local'
export const SEED_ORIGIN = 'workbench-seed'

export type WorkbenchCollabStatus = 'connecting' | 'connected' | 'reconnecting' | 'off'

export interface CollabUserLite {
  name: string
  uid?: string | null
}

export interface WorkbenchCollabHandlers {
  onStatus(status: WorkbenchCollabStatus): void
  onPeers(peers: number): void
  onSynced?(): void
  /** 文档内容变化（远端或本地落进 Y.Text 后） */
  onContent?(value: string): void
  /** 未 flush 更新计数变化 */
  onUnflushed?(count: number): void
}

export interface WorkbenchCollabSession {
  copyId: string
  doc: Y.Doc
  text: Y.Text
  provider: WebsocketProvider
  awareness: Awareness
  readonly synced: boolean
  status: WorkbenchCollabStatus
  /** 本地写入产生、尚未 flush 的更新批次数（远端更新不计——服务端只记录进入日志的写入） */
  unflushed: number
  /** POST /collab/flush 成功后归零本地未 flush 计数 */
  ackFlush(): void
  destroy(): void
}

/** y-websocket 的 (serverUrl, roomname)：ws(s)://host/api/v1/working-copies/{id}/collab */
export function collabWsTarget(copyId: string, loc: Pick<Location, 'protocol' | 'host'> = window.location) {
  return {
    serverUrl: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/v1/working-copies`,
    roomname: `${copyId}/collab`,
  }
}

/** 前后缀对齐的最小替换（与 collab/useCollabMirror 的 applyMinimal 同法，避免拉入 store 耦合） */
export function applyTextDiff(text: Y.Text, next: string, origin: unknown): boolean {
  const cur = text.toString()
  if (cur === next) return false
  let a = 0
  const max = Math.min(cur.length, next.length)
  while (a < max && cur.charCodeAt(a) === next.charCodeAt(a)) a++
  let b = 0
  while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++
  const run = () => {
    if (cur.length - a - b > 0) text.delete(a, cur.length - a - b)
    if (next.length - a - b > 0) text.insert(a, next.slice(a, next.length - b))
  }
  if (text.doc) text.doc.transact(run, origin)
  else run()
  return true
}

export function connectWorkingCopy(
  copyId: string,
  user: CollabUserLite,
  handlers: WorkbenchCollabHandlers,
  opts: { WebSocketPolyfill?: typeof WebSocket; serverUrl?: string; connect?: boolean } = {},
): WorkbenchCollabSession | null {
  const WS = opts.WebSocketPolyfill ?? (typeof WebSocket === 'undefined' ? null : WebSocket)
  if (!WS) return null
  const doc = new Y.Doc()
  const text = doc.getText(YTEXT_KEY)
  const { serverUrl, roomname } = collabWsTarget(copyId)
  const provider = new WebsocketProvider(opts.serverUrl ?? serverUrl, roomname, doc, {
    connect: false,
    WebSocketPolyfill: WS,
    disableBc: true,
    shouldReconnect: (ev) => ev.code !== REJECT_CODE,
  })
  const awareness = provider.awareness
  const color = colorFor(user.name)
  awareness.setLocalState({
    user: { name: user.name, color, colorLight: `${color}33` },
    uid: user.uid ?? null,
    cursor: null,
  })

  let synced = false
  const session: WorkbenchCollabSession = {
    copyId,
    doc,
    text,
    provider,
    awareness,
    get synced() {
      return synced
    },
    status: 'connecting',
    unflushed: 0,
    ackFlush() {
      session.unflushed = 0
      handlers.onUnflushed?.(0)
    },
    destroy,
  }
  const setStatus = (st: WorkbenchCollabStatus) => {
    session.status = st
    handlers.onStatus(st)
  }
  const emitPeers = () => {
    let others = 0
    awareness.getStates().forEach((_raw, clientId) => {
      if (clientId !== doc.clientID) others++
    })
    handlers.onPeers(others)
  }

  const onSync = (state: boolean) => {
    if (!state) return
    const first = !synced
    synced = true
    setStatus('connected')
    if (first) handlers.onSynced?.()
    emitPeers()
  }
  const onStatusEv = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (status === 'connected') {
      if (synced) setStatus('connected')
      return
    }
    if (status === 'disconnected' && synced) setStatus('reconnecting')
  }
  const onClose = (ev: CloseEvent | null) => {
    if (ev == null || ev.code === REJECT_CODE) return
    setStatus(synced ? 'reconnecting' : 'connecting')
  }
  const onClosed = () => {
    destroy()
    handlers.onStatus('off')
  }
  const onAwareness = () => emitPeers()
  /** 本地 origin 的写入才会被 provider 上行（服务端据此记更新日志）；远端应用不算未 flush 债务 */
  const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider || !synced) return
    session.unflushed += 1
    handlers.onUnflushed?.(session.unflushed)
  }
  const onText = () => handlers.onContent?.(text.toString())

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
  doc.on('update', onDocUpdate)
  text.observe(onText)
  setStatus('connecting')
  if (opts.connect ?? true) queueMicrotask(() => session.status !== 'off' && provider.connect())

  function destroy() {
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    provider.off('sync', onSync)
    provider.off('status', onStatusEv)
    provider.off('connection-close', onClose)
    provider.off('closed', onClosed)
    awareness.off('change', onAwareness)
    doc.off('update', onDocUpdate)
    text.unobserve(onText)
    provider.destroy()
    doc.destroy()
    session.status = 'off'
    handlers.onPeers(0)
  }
  return session
}

export interface WorkingCopyCollabState {
  session: WorkbenchCollabSession | null
  status: WorkbenchCollabStatus | 'idle'
  peers: number
  synced: boolean
  /** 协同文本的最新快照（同步后才有意义） */
  content: string | null
  unflushed: number
}

/**
 * 编辑器接线：工作副本打开期间维持协同会话；卸载/换副本即销毁。
 * `seedContent`：房间首次 sync 后若 Y.Text 为空且 REST 端内容非空，把 REST 内容作为
 * 首个本地更新种入房间（协作房间不自举工作副本内容；无其他在线端才种，避免双端同种）。
 */
export function useWorkingCopyCollab(
  copyId: string | null,
  opts: { enabled?: boolean; user?: CollabUserLite; seedContent?: string | null; WebSocketPolyfill?: typeof WebSocket; serverUrl?: string } = {},
): WorkingCopyCollabState {
  const [state, setState] = useState<WorkingCopyCollabState>({
    session: null,
    status: 'idle',
    peers: 0,
    synced: false,
    content: null,
    unflushed: 0,
  })
  const seededRef = useRef(false)
  const sessionRef = useRef<WorkbenchCollabSession | null>(null)
  const seedRef = useRef(opts.seedContent)
  seedRef.current = opts.seedContent

  useEffect(() => {
    if (!copyId || opts.enabled === false) return
    seededRef.current = false
    const user = opts.user ?? { name: '协作者' }
    let session: WorkbenchCollabSession | null = null
    session = connectWorkingCopy(copyId, user, {
      onStatus: (status) => setState((s) => ({ ...s, status })),
      onPeers: (peers) => setState((s) => ({ ...s, peers })),
      onSynced: () => {
        if (!session) return
        if (!seededRef.current && session.text.length === 0 && session.awareness.getStates().size <= 1 && seedRef.current) {
          applyTextDiff(session.text, seedRef.current, SEED_ORIGIN)
          seededRef.current = true
        }
        setState((s) => ({ ...s, synced: true, content: session!.text.toString() }))
      },
      onContent: (content) => setState((s) => ({ ...s, content })),
      onUnflushed: (unflushed) => setState((s) => ({ ...s, unflushed })),
    }, { WebSocketPolyfill: opts.WebSocketPolyfill, serverUrl: opts.serverUrl })
    if (!session) return
    sessionRef.current = session
    setState({ session, status: session.status, peers: 0, synced: false, content: null, unflushed: 0 })
    return () => {
      session.destroy()
      sessionRef.current = null
    }
    // user 低频变化，会话按挂载快照（与书房间 hook 同惯例）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyId, opts.enabled])

  // REST 内容晚于首个 sync 到达时的补种分支（onSynced 内部在 sync 瞬间读 seedRef）
  useEffect(() => {
    const session = sessionRef.current
    const seed = opts.seedContent
    if (
      session && state.synced && !seededRef.current && seed
      && session.text.length === 0 && session.awareness.getStates().size <= 1
    ) {
      applyTextDiff(session.text, seed, SEED_ORIGIN)
      seededRef.current = true
    }
  }, [opts.seedContent, state.synced])

  return state
}
