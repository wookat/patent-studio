import type { CollabBook } from '@/lib/api'
import { bookLineToFull, splitBooks } from '@/lib/docset'
import { useStudio, type CollabPeer, type CollabStatus } from '@/store'
import { connectCollab, type CollabSession, type CollabSessionHandlers, type CollabUser } from './provider'

/**
 * 客户端房间注册表：`(pid, book)` ↔ 一个共享的 `CollabSession`，按引用计数持有。
 *
 * dockview 下同一本书可以同时开多张源码卡片、不同书各开一张：同书卡片必须绑定**同一个** Y.Doc（各自的 ySync 插件
 * 通过 Y.Text 观察者即时互通，不经 store 往返 ⇒ 不会把对端插入重复推进房间），不同书各连各的房间。
 * 多个房间的连接状态 / 在线者在这里聚合后再写 store（store 的 collab slice 仍是单一状态）：
 *   status = 任一 reconnecting ⇒ reconnecting；否则任一 connecting ⇒ connecting；否则 connected；无房间 ⇒ off。
 *   peers  = 各房间按 uid 去重（无 uid 退回 name；同一人开两本书 / 书房+镜像只算一次），书相对行换算成全文行
 *     （顶栏 / 协作者中心点头像跳行用）。'content' 镜像房也携带真实身份 ⇒ 案卷级在线：没开书卡的用户也在场。
 * 服务端 1008 拒绝：会话自毁并从表中移除，持有者拿到的 `entry.status === 'off'`（不重连；再挂载会再试一次）。
 */
export interface RoomEntry {
  readonly key: string
  readonly pid: string
  readonly book: CollabBook
  readonly session: CollabSession
  refs: number
  status: CollabStatus
  error: string | null
  peers: CollabPeer[]
  /** 首个 sync 是否已完成（镜像 session.synced，供订阅者判定） */
  synced: boolean
  readonly listeners: Set<() => void>
}

const ENTRIES = new Map<string, RoomEntry>()
const TOAST_DEDUPE_MS = 1000
let lastToast: { text: string; at: number } | null = null
/** awareness 事件高频（光标移动即一次）：splitBooks 按 content 引用单槽缓存，不动 store 就不重切 */
let dsCache: { src: string; ds: ReturnType<typeof splitBooks> } | null = null
const cachedSplit = (src: string) => {
  if (dsCache?.src !== src) dsCache = { src, ds: splitBooks(src) }
  return dsCache.ds
}

export const roomKey = (pid: string, book: CollabBook, tag = '') => `${pid}/${book}${tag}`

/** 当前案子有活跃书房间（非 'content'）的书 */
export function activeBooks(pid: string): Set<CollabBook> {
  const out = new Set<CollabBook>()
  for (const e of ENTRIES.values()) if (e.pid === pid && e.book !== 'content' && e.status !== 'off') out.add(e.book)
  return out
}

/** 供测试 / 调试 */
export function roomEntries(): readonly RoomEntry[] {
  return [...ENTRIES.values()]
}

function notify(e: RoomEntry) {
  for (const fn of [...e.listeners]) fn()
}

function aggregate() {
  const live = [...ENTRIES.values()].filter((e) => e.status !== 'off')
  const s = useStudio.getState()
  let status: CollabStatus = 'off'
  if (live.length) {
    if (live.some((e) => e.status === 'reconnecting')) status = 'reconnecting'
    else if (live.some((e) => e.status === 'connecting')) status = 'connecting'
    else status = 'connected'
  }
  // R24-02：浏览器级 offline（含 ws 仍挂着的半死网络）→ 用户可见的 reconnecting；socket 自身 close 也会走到这里
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline && live.length) status = 'reconnecting'
  const error = live.find((e) => e.error)?.error ?? (offline && live.length ? '网络已离线' : null)
  if (s.collabStatus !== status || s.collabError !== error) s.setCollabStatus(status, error)

  const ds = cachedSplit(s.content)
  const seen = new Set<string>()
  const peers: CollabPeer[] = []
  // 书房间条目（带光标行）先于镜像房（'content'，只有 presence 没有 line）——同一人两房都在时保留带行的条目
  const ordered = [...live].sort((a) => (a.book === 'content' ? 1 : 0))
  for (const e of ordered) {
    for (const p of e.peers) {
      const key = p.uid ?? p.name
      if (seen.has(key)) continue
      seen.add(key)
      const line = p.line != null && e.book !== 'content' ? bookLineToFull(ds, e.book, p.line) : p.line
      peers.push({ ...p, line })
    }
  }
  peers.sort((a, b) => a.id - b.id)
  if (!samePeers(s.peers, peers)) s.setPeers(peers)
}

function samePeers(a: CollabPeer[], b: CollabPeer[]) {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return p.id === q.id && p.uid === q.uid && p.name === q.name && p.color === q.color && p.line === q.line && p.readonly === q.readonly
  })
}

function toast(text: string, kind?: 'info' | 'error') {
  const now = Date.now()
  if (lastToast && lastToast.text === text && now - lastToast.at < TOAST_DEDUPE_MS) return
  lastToast = { text, at: now }
  useStudio.getState().toast(text, kind)
}

function handlersFor(key: string): CollabSessionHandlers {
  const entry = () => ENTRIES.get(key)
  return {
    onStatus: (status, error) => {
      const e = entry()
      if (!e) return
      e.status = status
      e.error = error ?? null
      if (status === 'off') ENTRIES.delete(key)
      aggregate()
      notify(e)
    },
    onPeers: (peers) => {
      const e = entry()
      if (!e) return
      e.peers = peers
      aggregate()
    },
    onSynced: () => {
      const e = entry()
      if (!e) return
      e.synced = true
      notify(e)
    },
    onToast: toast,
  }
}

/**
 * 取得（或新建）房间会话并加一个引用。`user` 只在新建时生效：同房间已存在的会话沿用首个持有者的身份
 * （身份变化时持有者的 effect 依赖会先 release 再 acquire，计数归零即重建）。
 */
export function acquireRoom(pid: string, book: CollabBook, user: CollabUser, tag = ''): RoomEntry | null {
  const key = roomKey(pid, book, tag)
  const existing = ENTRIES.get(key)
  if (existing) {
    existing.refs++
    return existing
  }
  const session = connectCollab(pid, book, user, handlersFor(key))
  if (!session) return null
  const entry: RoomEntry = {
    key,
    pid,
    book,
    session,
    refs: 1,
    status: session.status,
    error: null,
    peers: [],
    synced: session.synced,
    listeners: new Set(),
  }
  ENTRIES.set(key, entry)
  aggregate()
  return entry
}

export function releaseRoom(entry: RoomEntry): void {
  entry.refs--
  if (entry.refs > 0) return
  if (ENTRIES.get(entry.key) === entry) ENTRIES.delete(entry.key)
  entry.session.destroy()
  entry.status = 'off'
  entry.peers = []
  aggregate()
  notify(entry)
}

export function subscribeRoom(entry: RoomEntry, fn: () => void): () => void {
  entry.listeners.add(fn)
  return () => entry.listeners.delete(fn)
}

// R24-02：浏览器 online/offline 事件即时重算聚合状态（ws 在弱网半死时不会立刻 close，navigator 是最早的信号源）
if (typeof window !== 'undefined') {
  window.addEventListener('offline', aggregate)
  window.addEventListener('online', aggregate)
}

// 调试钩子（仅 dev 包）：测试 agent / 排查重连丢字时用 `__collab.roomEntries()` 拿到活房间的 Y.Doc
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __collab?: unknown }).__collab = { roomEntries }
}

/** 全部释放（切案 / 登出 / 测试清理）：与引用计数无关，持有者下次 effect 会重新 acquire */
export function destroyAllRooms(): void {
  for (const e of [...ENTRIES.values()]) {
    ENTRIES.delete(e.key)
    e.session.destroy()
    e.status = 'off'
    e.peers = []
    e.refs = 0
    notify(e)
  }
  aggregate()
}
