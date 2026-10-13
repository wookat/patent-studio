import { useEffect, useMemo, useState } from 'react'
import type { Extension } from '@codemirror/state'
import type { CollabBook } from '@/lib/api'
import { useStudio } from '@/store'
import { collabUserFor } from './provider'
import { acquireRoom, releaseRoom, subscribeRoom, type RoomEntry } from './registry'
import { collabExtension } from './yCodemirror'

/**
 * 编辑器接线（docs/plan/11 §5.3）：当前案子 + 书 ↔ 一个协同会话，返回给 `<CodeMirrorEditor collabExtension>` /
 * `<CardEditor collabExtension>` 的扩展。
 *
 * - 只在 `loadCollabStatus(pid)` 探测完成（collabProbed === pid）且可用、账号状态已知（off / authed）时建连接；
 *   切案 / 切书 / 用户变化 ⇒ 先 release 旧房间再 acquire 新房间。
 * - 会话经 `registry` 按 (pid, book) 共享：同书多卡片绑定同一个 Y.Doc；多房间状态由 registry 聚合写 store。
 * - 首个 sync 前扩展只锁编辑不接 ySync；sync 与状态变化时（registry 通知）重新求值 ⇒ Compartment 热重配。
 * - 服务端 1008 拒绝 ⇒ provider 自毁、entry.status='off' ⇒ 返回 undefined，编辑器回到本地 PUT 路径。
 */
export function useCollabSession(book: CollabBook): Extension | undefined {
  const pid = useStudio((s) => s.pid)
  const probed = useStudio((s) => s.collabProbed)
  const unavailable = useStudio((s) => s.collabUnavailable)
  const readonly = useStudio((s) => s.collabReadonly)
  const authStatus = useStudio((s) => s.authStatus)
  const user = useStudio((s) => s.user)
  const [entry, setEntry] = useState<RoomEntry | null>(null)
  const [tick, setTick] = useState(0)

  const ready = pid !== null && probed === pid && !unavailable && (authStatus === 'off' || authStatus === 'authed')
  useEffect(() => {
    if (!ready || pid === null) return
    const e = acquireRoom(pid, book, collabUserFor(user, readonly))
    if (!e) return
    setEntry(e)
    const unsub = subscribeRoom(e, () => setTick((n) => n + 1))
    return () => {
      unsub()
      releaseRoom(e)
      setEntry(null)
    }
  }, [ready, pid, book, user, readonly])

  return useMemo(
    () => (entry && entry.status !== 'off' ? collabExtension(entry.session, readonly) : undefined),
    // tick：registry 在 sync / 状态变化时通知 ⇒ 重算（entry.synced / status 是可变字段，不能直接做依赖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, tick, readonly],
  )
}
