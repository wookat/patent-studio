import { useEffect } from 'react'
import type * as Y from 'yjs'
import type { CollabBook } from '@/lib/api'
import { replaceBook, splitBooks } from '@/lib/docset'
import { useStudio } from '@/store'
import { registerCollabBookWriter, registerCollabContentWriter } from '@/store/layoutView'
import { collabUserFor } from './provider'
import { acquireRoom, activeBooks, releaseRoom, roomEntries, subscribeRoom, type RoomEntry } from './registry'

/**
 * dockview 桌面壳的全文镜像连接（R8 补线）：主区可能只开了部分书的源码卡片（各接各的书房间），
 * 没开卡片的书、以及 `# 标题` 头部对端的改动就没人接收，PDF / 大纲 / 全文只读卡片会停在旧文本；
 * 反过来本地对无卡片书的改动（接受修订 / 术语统一 / AI 应用 / 恢复备份）也没有房间可推，协同模式又关闭了本地 PUT。
 * 这个 hook 以真实身份接 (pid, 'content') 房间做双向镜像——它是每个工作台壳（桌面 DockviewHost / 移动 MobileShell）
 * 唯一必挂的房间，同时充当案卷级 presence 通道：没开源码卡片的用户（版面视图、移动端单书）在书里房间缺席，
 * 靠镜像房的 awareness 让「在线」按案统计而非按书（R65-01）。镜像端不写 cursor ⇒ presence 无光标行、不可点跳，
 * 同一人在书房间也有条目时聚合层按 uid 去重、带行的书房间条目优先。
 *   - 房间 → store：远端全文里**没有活跃书房间**的部分（头部 + 无卡片的书）合入 store.content；有卡片的书以 store（= 该书 Y.Text）为准；
 *   - store → 房间：store 里无活跃房间部分的变化推进 content Y.Text（有卡片的书保持房间文本），服务端 content 房间去抖写盘、
 *     再经 on_saved 广播到各书房间。
 * 有卡片的书两边都以书房间为准，所以不会把对端的插入经 store 二次推进另一间房。
 */
export const MIRROR_ORIGIN = 'mirror'
export const MIRROR_TAG = '#mirror'

/** 以 base 为底，把 books 中各书的正文换成 from 里的（'content' 不是书，跳过） */
export function takeBooks(base: string, from: string, books: Iterable<CollabBook>): string {
  const src = splitBooks(from).books
  let out = base
  for (const b of books) {
    if (b === 'content') continue
    const slice = src[b]
    if (slice) out = replaceBook(out, b, slice.text)
  }
  return out
}

/** 前后缀对齐的最小替换（Y.Text 索引为 UTF-16 码元，与 JS 字符串一致） */
export function applyMinimal(text: Y.Text, next: string, origin: unknown): boolean {
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

/** W9 版面视图整书保存的 Y.Text 事务 origin（镜像视为远端改动 → fromRoom 合入 store） */
export const LAYOUT_ORIGIN = 'layout-view'

/**
 * W9 saveBook 协同在线分支：与源码视图同一条路——该书已开房间（源码卡片）则对书 Y.Text diff-apply，
 * 否则对 content 房间（镜像）写整篇；服务端去抖落盘后经 on_saved 下发。无已同步房间 → false（调用方退回 setContent）。
 */
export function writeCollabBook(pid: string, book: CollabBook, bookText: string, fullContent: string): boolean {
  const live = roomEntries().filter((e) => e.pid === pid && e.synced && e.status !== 'off')
  const room = live.find((e) => e.book === book)
  if (room) {
    applyMinimal(room.session.text, bookText, LAYOUT_ORIGIN)
    return true
  }
  const mirror = live.find((e) => e.book === 'content')
  if (mirror) {
    applyMinimal(mirror.session.text, fullContent, LAYOUT_ORIGIN)
    return true
  }
  return false
}
registerCollabBookWriter(writeCollabBook)

/** 全文批量写（修订批量接受/拒绝）：变化的书文本写进各自的活书房间（CRDT 安全，不覆盖他人键入），
 * content 镜像房在则整篇写入（一并覆盖头部与无房间的书——其 flush 写完整 md）。返回被覆盖的书名集；无活房间返回 null。 */
export function writeCollabContent(pid: string, prevContent: string, fullContent: string): Set<string> | null {
  const live = roomEntries().filter((e) => e.pid === pid && e.synced && e.status !== 'off')
  if (!live.length) return null
  const prev = splitBooks(prevContent).books
  const next = splitBooks(fullContent).books
  const covered = new Set<string>()
  for (const e of live) {
    if (e.book === 'content') {
      applyMinimal(e.session.text, fullContent, LAYOUT_ORIGIN)
      covered.add('content')
    } else {
      const t = next[e.book]?.text
      if (t !== undefined && t !== prev[e.book]?.text) {
        applyMinimal(e.session.text, t, LAYOUT_ORIGIN)
        covered.add(e.book)
      }
    }
  }
  return covered
}
registerCollabContentWriter(writeCollabContent)

/** 只挂镜像、不渲染：给按书编辑的移动壳用（全文 Editor 自己接 content 房间，不需要） */
export function CollabMirror(): null {
  useCollabMirror()
  return null
}

export function useCollabMirror(): void {
  const pid = useStudio((s) => s.pid)
  const probed = useStudio((s) => s.collabProbed)
  const unavailable = useStudio((s) => s.collabUnavailable)
  const authStatus = useStudio((s) => s.authStatus)
  const ready = pid !== null && probed === pid && !unavailable && (authStatus === 'off' || authStatus === 'authed')

  useEffect(() => {
    if (!ready || pid === null) return
    const s0 = useStudio.getState()
    const entry: RoomEntry | null = acquireRoom(pid, 'content', collabUserFor(s0.user, s0.collabReadonly || s0.project?.role === 'viewer' || s0.project?.role === 'reviewer'), MIRROR_TAG)
    if (!entry) return
    const text = entry.session.text
    let unsubStore: (() => void) | null = null

    const fromRoom = () => {
      if (!entry.synced || entry.status === 'off') return
      const s = useStudio.getState()
      if (s.pid !== pid) return
      const merged = takeBooks(text.toString(), s.content, activeBooks(pid))
      if (merged !== s.content) s.setContent(merged)
    }
    const toRoom = () => {
      if (!entry.synced || entry.status === 'off') return
      const s = useStudio.getState()
      if (s.pid !== pid) return
      const room = text.toString()
      const books = activeBooks(pid)
      const target = takeBooks(s.content, room, books)
      // 镜像部分与服务端已落盘的全文一致：服务端会经 on_saved 下发到本房间，本端再写会与之并发成双份
      if (s.serverContent !== null && target === takeBooks(s.serverContent, room, books)) return
      applyMinimal(text, target, MIRROR_ORIGIN)
    }
    const observer = (ev: Y.YTextEvent) => {
      if (ev.transaction.origin !== MIRROR_ORIGIN) fromRoom()
    }
    const attach = () => {
      if (unsubStore || !entry.synced) return
      fromRoom()
      unsubStore = useStudio.subscribe((s, prev) => {
        if (s.content !== prev.content) toRoom()
      })
    }
    text.observe(observer)
    const unsubRoom = subscribeRoom(entry, attach)
    attach()
    return () => {
      unsubRoom()
      unsubStore?.()
      text.unobserve(observer)
      releaseRoom(entry)
    }
    // uid/readonly 变化属低频；镜像身份按挂载时快照即可（书房间同此惯例）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pid])
}
