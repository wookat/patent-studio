import { ApiError, api, type BlockChange } from '@/lib/api'
import type { Version } from '@/lib/types'
import type { Slice } from './types'

/** R6 项目内 git 历史（docs/plan/07 §4.3）；501 期间 `historyUnavailable=true`，HistoryPanel 继续显示 .bak 列表 */
export interface HistorySlice {
  versions: Version[]
  historyLoading: boolean
  historyUnavailable: boolean
  selectedSha: string | null
  versionContent: string | null
  historyDiff: { a: string; b: string; diff: string } | null
  /** ReviewRail「已修改」Tab：上一版快照（versions[0]）→ 当前工作区的块级差异（GET /history/diff?format=blocks） */
  historyBlocks: BlockChange[] | null
  /** 块级差异比对的基线版本（谁 / 何时）；null = 尚无历史版本 */
  historyBlocksBase: Version | null
  historyBlocksLoading: boolean
  historyBlocksError: string | null

  loadHistory(pid: string): Promise<void>
  /** 重拉 versions 取最新快照为基线，按 versions[0].sha → work 取块级差异；无版本时 historyBlocks=[] */
  loadBlockChanges(pid: string): Promise<void>
  /** 选中一版并拉取其 content.md（null = 取消选中） */
  selectVersion(pid: string, sha: string | null): Promise<void>
  loadDiff(pid: string, a: string, b?: string): Promise<void>
  /** 走 dirtyGuard（type:'custom'）：恢复 → 后端写回并再提交 → 编辑区载入新内容 */
  restoreVersion(pid: string, sha: string): void
  resetHistory(): void
}

/** loadDiff 在飞去重序号：快速换对比基重叠时只让最后发起者落地（astSeq 同例） */
let historyDiffReqSeq = 0

export const historySlice: Slice<HistorySlice> = (set, get) => ({
  versions: [],
  historyLoading: false,
  historyUnavailable: false,
  selectedSha: null,
  versionContent: null,
  historyDiff: null,
  historyBlocks: null,
  historyBlocksBase: null,
  historyBlocksLoading: false,
  historyBlocksError: null,

  loadBlockChanges: async (pid) => {
    set({ historyBlocksLoading: true, historyBlocksError: null })
    try {
      if (!get().historyUnavailable) await get().loadHistory(pid)
      if (get().pid !== pid) {
        set({ historyBlocksLoading: false })
        return
      }
      const base = get().versions[0] ?? null
      if (!base) {
        set({ historyBlocks: [], historyBlocksBase: null, historyBlocksLoading: false })
        return
      }
      const r = await api.historyDiffBlocks(pid, base.sha, 'work')
      if (get().pid !== pid) {
        set({ historyBlocksLoading: false })
        return
      }
      set({
        historyBlocks: r.blocks ?? [],
        historyBlocksBase: base,
        historyBlocksLoading: false,
        historyBlocksError: r.blocks_error ? r.blocks_error.message : null,
      })
    } catch (e) {
      set({ historyBlocksLoading: false, historyBlocksError: e instanceof Error ? e.message : String(e) })
    }
  },

  loadHistory: async (pid) => {
    set({ historyLoading: true })
    try {
      const versions = await api.history(pid)
      if (get().pid && get().pid !== pid) return
      set({ versions, historyLoading: false, historyUnavailable: false })
    } catch (e) {
      if (!get().pid || get().pid === pid) set({ historyLoading: false, historyUnavailable: e instanceof ApiError && e.status === 501 })
    }
  },
  selectVersion: async (pid, sha) => {
    if (sha === null) {
      set({ selectedSha: null, versionContent: null, historyDiff: null })
      return
    }
    set({ selectedSha: sha })
    const r = await api.historyVersion(pid, sha)
    if (get().selectedSha === sha) set({ versionContent: r.content })
  },
  loadDiff: async (pid, a, b = 'work') => {
    const seq = ++historyDiffReqSeq
    const diff = await api.historyDiff(pid, a, b)
    if (seq !== historyDiffReqSeq) return
    if (!get().pid || get().pid === pid) set({ historyDiff: diff })
  },
  restoreVersion: (pid, sha) => {
    get().requestNavigation({
      type: 'custom',
      label: `恢复版本 ${sha.slice(0, 7)}`,
      run: async () => {
        const r = await api.restoreVersion(pid, sha)
        if (get().pid && get().pid !== pid) return
        if (!r.changed) {
          // R90：恢复到与当前一致的版本是空操作——明说，不报「已恢复」
          get().toast('当前内容已是该版本，无需恢复', 'info')
          return
        }
        // saved 变化 ⇒ HistoryPanel 自行刷新列表
        get().applyServerContent(r.content, { selectedSha: null, versionContent: null, historyDiff: null })
        get().scheduleAst()
        get().toast(`已恢复版本 ${sha.slice(0, 7)}`, 'success')
      },
    })
  },
  resetHistory: () =>
    set({
      versions: [],
      historyLoading: false,
      historyUnavailable: false,
      selectedSha: null,
      versionContent: null,
      historyDiff: null,
      historyBlocks: null,
      historyBlocksBase: null,
      historyBlocksLoading: false,
      historyBlocksError: null,
    }),
})
