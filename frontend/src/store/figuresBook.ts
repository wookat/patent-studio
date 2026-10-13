import { api } from '@/lib/api'
import type { Slice } from './types'

/**
 * W4-C 附图书（docs/plan/15-w4c-figures-files-design.md §4.1）：book=figures 可视化编辑的 UI 状态与批量动作。
 * 数据本体仍是 figures slice 的 `figures: FigureItem[]`（= GET /figures，含 alt / num / width / is_abstract），
 * 本 slice 只加附图书独有的：figs/ 预览目标、卡片测得的宽高比、统一宽度 / 统一高度两种批量写。
 * 每次写仍走既有单图 PUT /figures/{name}（后端逐行改 docs/figures.md），最后一次响应覆盖 figures+settings 并 scheduleAst()。
 */
export interface FiguresBookSlice {
  /** 文件树 figs/ 点开预览的文件名（svg/png 直显；emf 用伴生 png/svg）；null = 关闭 */
  previewFig: string | null
  /** FigureCard 缩略图 onLoad 报上来的 naturalWidth/naturalHeight；统一高度换算宽度要用 */
  figureAspects: Record<string, number>

  setPreviewFig(name: string | null): void
  setFigureAspect(name: string, ratio: number): void
  /** 所有已编入说明书附图统一为 width cm（2–17）；已相等的跳过 */
  unifyFigureWidth(width: number): Promise<void>
  /** 统一高度 height cm → 每图 width = height × 宽高比（缺宽高比的图跳过并 toast 提示） */
  unifyFigureHeight(height: number): Promise<void>
  /** 键盘 / 菜单上移下移：等价 reorderFigures(交换后的顺序) */
  moveFigure(name: string, dir: -1 | 1): Promise<void>
  resetFiguresBook(): void
}

export const FIG_WIDTH_MIN = 2
export const FIG_WIDTH_MAX = 17
export const clampFigWidth = (w: number) => Math.min(FIG_WIDTH_MAX, Math.max(FIG_WIDTH_MIN, Math.round(w * 2) / 2))

export const figuresBookSlice: Slice<FiguresBookSlice> = (set, get) => {
  const writeWidths = async (entries: [string, number][]) => {
    const pid = get().pid
    if (!pid || entries.length === 0) return
    try {
      let last = null
      for (const [name, width] of entries) last = await api.updateFigure(pid, name, { width })
      if (last && (!get().pid || get().pid === pid)) {
        set({ figures: last.figures, settings: last.settings })
        get().scheduleAst()
      }
    } catch (e) {
      get().toast(e instanceof Error ? e.message : String(e), 'error')
      const p = get().pid
      if (p) await get().loadFigures(p)
    }
  }

  return {
    previewFig: null,
    figureAspects: {},

    setPreviewFig: (name) => {
      if (get().previewFig !== name) set({ previewFig: name })
    },
    setFigureAspect: (name, ratio) => {
      if (!Number.isFinite(ratio) || ratio <= 0 || get().figureAspects[name] === ratio) return
      set({ figureAspects: { ...get().figureAspects, [name]: ratio } })
    },

    unifyFigureWidth: async (width) => {
      const w = clampFigWidth(width)
      const entries = get().figures.filter((f) => f.num !== null && f.width !== w).map((f): [string, number] => [f.name, w])
      await writeWidths(entries)
    },

    unifyFigureHeight: async (height) => {
      const aspects = get().figureAspects
      const entries: [string, number][] = []
      const skipped: string[] = []
      for (const f of get().figures) {
        if (f.num === null) continue
        const r = aspects[f.name]
        if (!r) {
          skipped.push(f.name)
          continue
        }
        const w = clampFigWidth(height * r)
        if (f.width !== w) entries.push([f.name, w])
      }
      if (skipped.length) get().toast(`未知宽高比，跳过：${skipped.join('、')}`, 'info')
      await writeWidths(entries)
    },

    moveFigure: async (name, dir) => {
      const order = get().figures.filter((f) => f.num !== null).map((f) => f.name)
      const i = order.indexOf(name)
      const j = i + dir
      if (i < 0 || j < 0 || j >= order.length) return
      ;[order[i], order[j]] = [order[j], order[i]]
      await get().reorderFigures(order)
    },

    resetFiguresBook: () => set({ previewFig: null, figureAspects: {} }),
  }
}
