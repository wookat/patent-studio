import { ApiError, api, type ImportDocxOpts } from '@/lib/api'
import type { ImportReport, StyleSuggestion } from '@/lib/types'
import type { Slice } from './types'

export type ImportPhase = 'idle' | 'uploading' | 'done' | 'error'

/**
 * R9 Word 导入（docs/plan/10 §5 / §7.1）：DOCX → 新案卷 + 报告。
 * `importDocx` 成功后走 `requestNavigation({type:'open-project'})` 打开新案；`report` 供 ImportReportPanel 列出
 * 未能映射的元素；`styleSuggestion` 来自 `POST /api/import/docx/styles`（只提样式、不建案）。
 * `opts.style`：用户只勾选了部分样式建议时传入（后端优先于 apply_styles 写进新案 settings.style）。
 */
export interface ImporterSlice {
  importPhase: ImportPhase
  importError: string | null
  importUnavailable: boolean
  importReport: ImportReport | null
  importedPid: string | null
  styleSuggestion: StyleSuggestion | null

  importDocx(file: File, opts?: ImportDocxOpts): Promise<boolean>
  suggestStyles(file: File): Promise<StyleSuggestion | null>
  resetImporter(): void
}

export const importerSlice: Slice<ImporterSlice> = (set, get) => ({
  importPhase: 'idle',
  importError: null,
  importUnavailable: false,
  importReport: null,
  importedPid: null,
  styleSuggestion: null,

  importDocx: async (file, opts = {}) => {
    set({ importPhase: 'uploading', importError: null })
    try {
      const r = await api.importDocx(file, opts)
      set({ importPhase: 'done', importReport: r.report, importedPid: r.project.id, importUnavailable: false })
      await get().loadProjects()
      get().requestNavigation({ type: 'open-project', pid: r.project.id })
      return true
    } catch (e) {
      set({
        importPhase: 'error',
        importError: e instanceof Error ? e.message : 'Word 导入失败',
        importUnavailable: e instanceof ApiError && e.status === 501,
      })
      return false
    }
  },
  suggestStyles: async (file) => {
    try {
      const s = await api.importDocxStyles(file)
      set({ styleSuggestion: s, importUnavailable: false })
      return s
    } catch (e) {
      set({
        styleSuggestion: null,
        importError: e instanceof Error ? e.message : '样式提取失败',
        importUnavailable: e instanceof ApiError && e.status === 501,
      })
      return null
    }
  },
  resetImporter: () =>
    set({ importPhase: 'idle', importError: null, importUnavailable: false, importReport: null, importedPid: null, styleSuggestion: null }),
})
