import { api, ApiError } from '@/lib/api'
import type { BuildOutcome } from '@/lib/types'
import type { Slice } from './types'

export type BuildPhase = 'idle' | 'queued' | 'building' | 'ok' | 'error' | 'superseded'
export type BuildReason = 'open' | 'edit' | 'settings' | 'restore' | 'manual'

/** 编辑停止 → 触发构建的防抖默认值（docs/ux/03 §7：400ms）；实际值走 build.debounceMs（设置 › 偏好，持久化） */
export const DEBOUNCE_MS = 400
export const DEBOUNCE_MIN = 100
export const DEBOUNCE_MAX = 3000
export const clampDebounceMs = (ms: number) => Math.min(DEBOUNCE_MAX, Math.max(DEBOUNCE_MIN, Math.round(ms)))

export interface BuildSlice {
  phase: BuildPhase
  outcome: BuildOutcome | null
  /** 最近一次成功结果（预览始终挂在它上面，失败时不清空） */
  lastOk: BuildOutcome | null
  /** 预览已落后于编辑（最近构建失败但仍显示上次成功 PDF） */
  stale: boolean
  startedAt: number | null
  /** lastOk 对应的编辑时间戳（selectStale 用） */
  lastOkEditAt: number | null
  /** lastOk 完成的墙钟时间（StaleBanner “上次成功 HH:MM”） */
  lastOkAt: number | null
  elapsedMs: number
  pendingCount: number
  netError: string | null
  /** netError 的 HTTP 状态（401/403 ⇒ 权限问题，不是“连不上后端”）；网络层失败 = null */
  netStatus: number | null
  /** 预览端到端耗时（PdfPreview onSwap 回填） */
  previewMs: number | null
  /** 已计入 previewMs 的 PDF URL：同一 URL 重挂载（移动 Tab 切换）不重算 */
  previewShownUrl: string | null
  autoBuild: boolean
  /** 编辑停止 → 构建的防抖 ms（持久化；默认 DEBOUNCE_MS） */
  debounceMs: number

  /** latest-wins + 防抖入队；immediate 跳过防抖（打开案子/手动重建） */
  enqueue(reason: BuildReason, immediate?: boolean): void
  /** 取消排队 / 在途的 /api/build：不清 lastOk 与上次 outcome，phase 回到上次结果（构建菜单「停止」） */
  cancelBuild(): void
  setDebounceMs(ms: number): void
  applyOutcome(outcome: BuildOutcome, editAt: number): void
  /** PdfPreview 把 url 切到前台后调用；仅首次出现的 URL 计一次 编辑→预览 耗时 */
  markPreviewShown(url: string): void
  setAutoBuild(on: boolean): void
  resetBuild(): void
}

interface Req {
  pid: string
  at: number
}

// 模块级（不进 state）：定时器、在途请求、待发请求、序号
let timer: number | null = null
let ticker: number | null = null
let inflight: AbortController | null = null
let pendingReq: Req | null = null
let seq = 0

export const buildSlice: Slice<BuildSlice> = (set, get) => {
  const stopTicker = () => {
    if (ticker) window.clearInterval(ticker)
    ticker = null
  }

  const fire = async (r: Req) => {
    if (typeof window === 'undefined') return
    if (inflight) {
      pendingReq = r
      set({ pendingCount: 1 })
      return
    }
    const ctrl = new AbortController()
    inflight = ctrl
    const mySeq = ++seq
    const startedAt = Date.now()
    set({ phase: 'building', startedAt, elapsedMs: 0, netError: null })
    stopTicker()
    ticker = window.setInterval(() => set({ elapsedMs: Date.now() - startedAt }), 100)
    try {
      const { content, settings, reviewMode } = get()
      const out = await api.build(r.pid, { content, settings: settings ?? undefined, pdf: true, mode: reviewMode }, ctrl.signal)
      if (mySeq !== seq) return
      get().applyOutcome(out, r.at)
    } catch (e) {
      if (ctrl.signal.aborted) return
      set({ phase: 'error', netError: (e as Error).message, netStatus: e instanceof ApiError ? e.status : null })
    } finally {
      // 被 cancelBuild/resetBuild 取消后（seq 已前进、inflight 可能已是新请求）不得动新一轮的 ticker / inflight
      if (mySeq === seq) {
        stopTicker()
        inflight = null
        if (pendingReq) {
          const n = pendingReq
          pendingReq = null
          set({ pendingCount: 0 })
          if (get().pid === n.pid) void fire(n)
        } else {
          set({ pendingCount: 0 })
        }
      }
    }
  }

  return {
    phase: 'idle',
    outcome: null,
    lastOk: null,
    stale: false,
    startedAt: null,
    lastOkEditAt: null,
    lastOkAt: null,
    elapsedMs: 0,
    pendingCount: 0,
    netError: null,
    netStatus: null,
    previewMs: null,
    previewShownUrl: null,
    autoBuild: true,
    debounceMs: DEBOUNCE_MS,

    enqueue: (reason, immediate = false) => {
      const { pid, autoBuild, contentEditedAt } = get()
      if (!pid) return
      if (!autoBuild && reason !== 'manual' && reason !== 'open') return
      if (timer) window.clearTimeout(timer)
      const r: Req = { pid, at: reason === 'edit' && contentEditedAt ? contentEditedAt : Date.now() }
      const go = () => {
        timer = null
        // 测试环境 jsdom 拆除后迟到的定时器直接丢（window 已不存在；set 调用会冒 unhandled rejection）
        if (typeof window === 'undefined') return
        void fire(r)
      }
      if (immediate) go()
      else {
        set((s) => (s.phase === 'building' ? s : { ...s, phase: 'queued' }))
        timer = window.setTimeout(go, get().debounceMs)
      }
    },

    applyOutcome: (out, editAt) => {
      const s = get()
      if (out.status === 'ok') {
        set({
          phase: 'ok',
          outcome: out,
          lastOk: out,
          lastOkEditAt: editAt,
          lastOkAt: Date.now(),
          stale: false,
          netError: null,
        })
      } else {
        set({
          phase: out.status === 'superseded' ? 'superseded' : 'error',
          outcome: out,
          stale: out.status === 'error' && s.lastOk !== null,
          netError: null,
        })
      }
      get().setFromBuild(out)
    },

    markPreviewShown: (url) => {
      const { previewShownUrl, lastOkEditAt } = get()
      if (url === previewShownUrl || !lastOkEditAt) return
      set({ previewShownUrl: url, previewMs: Date.now() - lastOkEditAt })
    },
    setAutoBuild: (autoBuild) => set({ autoBuild }),
    setDebounceMs: (ms) => set({ debounceMs: clampDebounceMs(ms) }),

    cancelBuild: () => {
      const s = get()
      if (s.phase !== 'building' && s.phase !== 'queued') return
      if (timer) window.clearTimeout(timer)
      timer = null
      stopTicker()
      inflight?.abort()
      inflight = null
      pendingReq = null
      seq++
      const prev = s.outcome
      const phase: BuildPhase = prev ? (prev.status === 'ok' ? 'ok' : prev.status === 'superseded' ? 'superseded' : 'error') : 'idle'
      set({ phase, startedAt: null, elapsedMs: 0, pendingCount: 0 })
    },

    resetBuild: () => {
      if (timer) window.clearTimeout(timer)
      timer = null
      stopTicker()
      inflight?.abort()
      inflight = null
      pendingReq = null
      seq++
      set({
        phase: 'idle',
        outcome: null,
        lastOk: null,
        stale: false,
        startedAt: null,
        lastOkEditAt: null,
        lastOkAt: null,
        elapsedMs: 0,
        pendingCount: 0,
        netError: null,
        netStatus: null,
        previewMs: null,
        previewShownUrl: null,
      })
    },
  }
}
