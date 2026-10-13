import { ApiError, api } from '@/lib/api'
import type { PreflightReport, PreflightView } from '@/types/preflight'
import type { Slice } from './types'

/**
 * R2.5 递交前体检（docs/plan/05-r2-figures-preflight-design.md §6.1）。
 * 触发：打开控制台「体检」tab 且 preflightContent !== content → loadPreflight；保存成功后若 tab 可见再跑一次。
 * 不随键入防抖。诊断并入靠后端 lint()，前端零合并逻辑。
 */
export interface PreflightSlice {
  /** 最近一次成功的报告（请求中/失败时保留旧值） */
  preflight: PreflightReport | null
  /** 报告对应的 content 快照；!== content 即过期 */
  preflightContent: string | null
  preflightLoading: boolean
  preflightError: string | null
  /** 后端 501（A2 未落地）：不自动重试，直到 resetPreflight / 显式 loadPreflight */
  preflightUnavailable: boolean
  preflightPid: string | null
  /** 最近一次成功体检的请求耗时（ms） */
  preflightElapsedMs: number | null
  /** 面板二级 tab：问题 / 权利要求树 / 附图标记 / 支持性 */
  preflightView: PreflightView

  /** POST /preflight（默认编辑区 content + settings；fromDisk 用磁盘内容）；AbortController 最新者胜 */
  loadPreflight(pid: string, opts?: { fromDisk?: boolean }): Promise<PreflightReport | null>
  setPreflightView(view: PreflightView): void
  resetPreflight(): void
}

let pfAbort: AbortController | null = null

export const preflightSlice: Slice<PreflightSlice> = (set, get) => ({
  preflight: null,
  preflightContent: null,
  preflightLoading: false,
  preflightError: null,
  preflightUnavailable: false,
  preflightPid: null,
  preflightElapsedMs: null,
  preflightView: 'items',

  loadPreflight: async (pid, opts) => {
    pfAbort?.abort()
    const ctrl = new AbortController()
    pfAbort = ctrl
    const s = get()
    const body = opts?.fromDisk ? {} : { content: s.content, settings: s.settings ?? undefined }
    set({ preflightLoading: true, preflightPid: pid })
    const t0 = performance.now()
    try {
      const report = await api.getPreflight(pid, body, ctrl.signal)
      if (ctrl.signal.aborted) return null
      set({
        preflight: report,
        // 报告对应的是请求时刻的内容快照；记响应时刻的 content 会把飞行中的编辑误判为新鲜
        preflightContent: opts?.fromDisk ? get().content : s.content,
        preflightLoading: false,
        preflightError: null,
        preflightUnavailable: false,
        preflightElapsedMs: performance.now() - t0,
      })
      return report
    } catch (e) {
      if (ctrl.signal.aborted) return null
      const msg = e instanceof Error ? e.message : String(e)
      set({ preflightLoading: false, preflightError: msg, preflightUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    } finally {
      if (pfAbort === ctrl) pfAbort = null
    }
  },

  setPreflightView: (view) => {
    if (get().preflightView !== view) set({ preflightView: view })
  },

  resetPreflight: () => {
    pfAbort?.abort()
    pfAbort = null
    set({ preflight: null, preflightContent: null, preflightLoading: false, preflightError: null, preflightUnavailable: false, preflightPid: null, preflightElapsedMs: null })
  },
})

/** 报告落后于编辑区；无报告时 false */
export const selectPreflightStale = (s: { preflight: PreflightReport | null; preflightContent: string | null; content: string }) =>
  s.preflight !== null && s.preflightContent !== s.content
