import { ApiError, api, isFigureReferenced } from '@/lib/api'
import type { FigureItem, FigurePatch, FigureRef, FiguresResponse } from '@/types/figures'
import type { Slice } from './types'

/**
 * R2 附图（docs/plan/05-r2-figures-preflight-design.md §6.1）。
 * 写动作成功后 set({figures, settings})（settings 属 project slice，同一 flat store）并 scheduleAst()（图号可能变）。
 * 后端 501 → figuresUnavailable=true（与 ast slice 同策略，不弹 toast）。
 */
export interface FiguresSlice {
  figures: FigureItem[]
  figuresLoading: boolean
  /** 最近一次 /figures 请求失败的消息（prep 阶段恒为 501 文案） */
  figuresError: string | null
  figuresUnavailable: boolean
  figuresPid: string | null
  /** 每次写成功（apply）递增——figUrl ?v= 缓存破签名：同名图换字节后预览图强制重取 */
  figsVersion: number
  /** 卡片选中（name）；与结构预览 activeBlock 不联动 */
  selectedFigure: string | null

  loadFigures(pid: string): Promise<FigureItem[] | null>
  /** 返回后端响应（含 skipped 逐件结果）；失败/无 pid 为 undefined，调用方据此判真假成功 */
  uploadFigures(files: File[]): Promise<FiguresResponse | undefined>
  /** 乐观更新；失败回滚并 toast */
  reorderFigures(order: string[]): Promise<void>
  updateFigure(name: string, patch: FigurePatch): Promise<void>
  /** 整组换图（被引用也可换）：files 已按后端约定改名为本组 stem.* */
  replaceFigureImage(name: string, files: File[]): Promise<void>
  /** 409（被引用）→ {ok:false, refs}，由面板列出引用行；其它错误 toast 并 {ok:false, refs:[]} */
  deleteFigure(name: string): Promise<{ ok: true } | { ok: false; refs: FigureRef[] }>
  selectFigure(name: string | null): void
  resetFigures(): void
}

let figAbort: AbortController | null = null

export const figuresSlice: Slice<FiguresSlice> = (set, get) => {
  const apply = (r: FiguresResponse) => {
    set({ figures: r.figures, settings: r.settings, figuresError: null, figuresUnavailable: false, figsVersion: get().figsVersion + 1 })
    get().scheduleAst()
  }
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    get().toast(msg, 'error')
    return msg
  }
  const write = async (run: (pid: string) => Promise<FiguresResponse>) => {
    const pid = get().pid
    if (!pid) return
    try {
      const r = await run(pid)
      // 写动作不可中断：切案后在飞响应不得跨案回灌（figures/settings 都属响应体）
      if (get().pid && get().pid !== pid) return
      apply(r)
    } catch (e) {
      fail(e)
    }
  }

  return {
    figures: [],
    figuresLoading: false,
    figuresError: null,
    figuresUnavailable: false,
    figuresPid: null,
    figsVersion: 0,
    selectedFigure: null,

    loadFigures: async (pid) => {
      figAbort?.abort()
      const ctrl = new AbortController()
      figAbort = ctrl
      set({ figuresLoading: true, figuresPid: pid })
      try {
        const r = await api.getFigures(pid, ctrl.signal)
        if (ctrl.signal.aborted) return null
        set({ figures: r.figures, settings: r.settings, figuresLoading: false, figuresError: null, figuresUnavailable: false })
        return r.figures
      } catch (e) {
        if (ctrl.signal.aborted) return null
        const msg = e instanceof Error ? e.message : String(e)
        set({ figuresLoading: false, figuresError: msg, figuresUnavailable: e instanceof ApiError && e.status === 501 })
        return null
      } finally {
        if (figAbort === ctrl) figAbort = null
      }
    },

    uploadFigures: async (files) => {
      const pid = get().pid
      if (!pid) return
      try {
        const r = await api.uploadFigures(pid, files)
        if (get().pid && get().pid !== pid) return
        apply(r)
        const skipped = r.skipped ?? []
        if (skipped.length) {
          const names = skipped.slice(0, 3).map((s) => s.name).join('、')
          const more = skipped.length > 3 ? ` 等 ${skipped.length} 件` : ''
          get().toast(`已跳过 ${skipped.length} 件：${names}${more}（${skipped[0].reason}）`, 'info')
        }
        return r
      } catch (e) {
        fail(e)
        return undefined
      }
    },

    reorderFigures: async (order) => {
      const pid = get().pid
      if (!pid) return
      const before = get().figures
      const byName = new Map(before.map((f) => [f.name, f]))
      const ordered = order.map((n) => byName.get(n)).filter((f): f is FigureItem => f != null)
      set({ figures: [...ordered, ...before.filter((f) => !order.includes(f.name))] })
      try {
        const r = await api.reorderFigures(pid, order)
        if (get().pid && get().pid !== pid) return
        apply(r)
      } catch (e) {
        if (!get().pid || get().pid === pid) set({ figures: before })
        fail(e)
      }
    },

    updateFigure: (name, patch) => write((pid) => api.updateFigure(pid, name, patch)),

    replaceFigureImage: (name, files) => write((pid) => api.replaceFigureImage(pid, name, files)),

    deleteFigure: async (name) => {
      const pid = get().pid
      if (!pid) return { ok: false, refs: [] }
      try {
        const r = await api.deleteFigure(pid, name)
        if (get().pid && get().pid !== pid) return { ok: true }
        apply(r)
        if (get().selectedFigure === name) set({ selectedFigure: null })
        return { ok: true }
      } catch (e) {
        if (isFigureReferenced(e)) return { ok: false, refs: e.detail.refs }
        fail(e)
        return { ok: false, refs: [] }
      }
    },

    selectFigure: (name) => {
      if (get().selectedFigure !== name) set({ selectedFigure: name })
    },

    resetFigures: () => {
      figAbort?.abort()
      figAbort = null
      set({ figures: [], figuresLoading: false, figuresError: null, figuresUnavailable: false, figuresPid: null, selectedFigure: null })
    },
  }
}
