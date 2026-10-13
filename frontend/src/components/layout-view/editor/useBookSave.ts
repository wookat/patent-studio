import { useEffect, useLayoutEffect, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { fromBookDoc } from '../doc/fromBookDoc'

/**
 * 整书保存调度（22 §2 决策 1 / §4）：停止输入 `SAVE_IDLE_MS` 或失焦 / 切视图（组件卸载）→ `fromBookDoc(doc)` → `save(md)`
 * （store.saveBook 内部 bookDiff → 单块补丁 / 整书 PUT{base_sha} / Y.Text）。
 * - 保存进行中不阻塞输入：期间再有改动只置 dirty，本次返回后立刻合并下一次（coalesce）。
 * - IME 组字中（`composing()`）到期不保存，等 compositionend 再排。
 * - 与上次落盘文本相同则跳过（doc 变化但序列化不变，如 mark 改写等价形式）。
 * - `holding()` 为真（远端文本已到但 AST 还没跟上，尚不能按块合并进本地 doc）时到期不保存，重排一个 idle，
 *   最多 `SAVE_MAX_HOLDS` 次；否则本地整书序列化会把对端刚写的块抓回旧文本（协同双端同书互盖）。flush() 不受此限。
 */
export const SAVE_IDLE_MS = 600
export const SAVE_MAX_HOLDS = 3

export interface SaveScheduler {
  /** 内容变了：重排 idle 定时器 */
  touch(): void
  /** 立刻保存（失焦 / 卸载 / 切视图）；返回保存 Promise（没有变化时 resolve(true)） */
  flush(): Promise<boolean>
  /** 服务端 / 远端文本已成为当前基线（不需要再保存它） */
  markSaved(md: string): void
  /** 取消未到期的 idle 定时器（卸载时；已在途的保存照常完成） */
  dispose(): void
  readonly pending: boolean
}

export interface SaveSchedulerOptions {
  read: () => string | null
  save: (md: string) => Promise<boolean>
  composing?: () => boolean
  holding?: () => boolean
  idleMs?: number
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => number
  clearTimeout?: (id: number) => void
}

export function createSaveScheduler(o: SaveSchedulerOptions): SaveScheduler {
  const idle = o.idleMs ?? SAVE_IDLE_MS
  const st = o.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number)
  const ct = o.clearTimeout ?? ((id) => globalThis.clearTimeout(id))
  let timer = 0
  let saved: string | null = null
  let inflight: Promise<boolean> | null = null
  let dirty = false
  let holds = 0

  const run = async (): Promise<boolean> => {
    if (inflight) {
      dirty = true
      return inflight
    }
    const md = o.read()
    if (md === null || md === saved) return true
    dirty = false
    const p = (async () => {
      let ok = false
      try {
        ok = await o.save(md)
      } finally {
        inflight = null
      }
      if (ok) saved = md
      if (dirty) return run()
      return ok
    })()
    inflight = p
    return p
  }

  const touch = () => {
    ct(timer)
    timer = st(() => {
      timer = 0
      if (o.composing?.()) {
        touch()
        return
      }
      if (o.holding?.() && holds < SAVE_MAX_HOLDS) {
        holds++
        touch()
        return
      }
      holds = 0
      void run()
    }, idle)
  }

  return {
    touch,
    flush() {
      ct(timer)
      timer = 0
      if (o.composing?.()) return Promise.resolve(true)
      return run()
    },
    markSaved(md) {
      saved = md
    },
    dispose() {
      ct(timer)
      timer = 0
    },
    get pending() {
      return inflight !== null || timer !== 0
    },
  }
}

type SaveOpts = {
  view: () => EditorView | null
  save: (md: string) => Promise<boolean>
  composing: () => boolean
  holding: () => boolean
  enabled: boolean
}

/** 调度器总读最新一次 render 的 opts（由 useBookSave 在 commit 后用 update() 注入） */
function latestScheduler(init: SaveOpts): SaveScheduler & { update(o: SaveOpts): void } {
  let cur = init
  const sched = createSaveScheduler({
    read: () => {
      const v = cur.view()
      if (!v || !cur.enabled) return null
      try {
        return fromBookDoc(v.state.doc)
      } catch {
        return null
      }
    },
    save: (md) => cur.save(md),
    composing: () => cur.composing(),
    holding: () => cur.holding(),
  })
  return {
    ...sched,
    get pending() {
      return sched.pending
    },
    update(o) {
      cur = o
    },
  }
}

/**
 * 版面编辑器保存 hook：view 由 ref 提供（挂载后才有）。
 * 调度器不带「已销毁」状态：StrictMode 开发态会 mount → cleanup → mount 复用同一 memo 实例，
 * 若 cleanup 把它永久关掉，之后 touch() 全部失效（idle 保存静默不发生）；卸载后 read() 因 view 为 null 返回 null 自然停止。
 */
export function useBookSave(opts: SaveOpts): SaveScheduler {
  const [sched] = useState(() => latestScheduler(opts))
  useLayoutEffect(() => {
    sched.update(opts)
  })
  useEffect(
    () => () => {
      void sched.flush()
      sched.dispose()
    },
    [sched],
  )
  return sched
}
