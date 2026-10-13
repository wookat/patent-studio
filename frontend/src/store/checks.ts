import { api, ApiError } from '@/lib/api'
import type { CheckResult, Diagnostic, LintReport, Settings, Severity } from '@/lib/types'
import type { Slice } from './types'

export interface LintRun {
  report: LintReport | null
  error: string | null
  ms: number
  at: number
}

export interface CheckAllRun {
  result: CheckResult | null
  error: string | null
  at: number
}

/**
 * 体检条目（R-CHK-03 三处同源）：控制台「问题」列表、递交页体检表、编辑器 gutter 都读 diagnostics.items，
 * 这里只提供统一 selector；条目 = Diagnostic（build / lint / boundary / client 已合并去重），preflight.<rule>#<n> 也在其中。
 */
export interface ChecksState {
  items: Diagnostic[]
}

export const selectCheckItems = (s: ChecksState): Diagnostic[] => s.items
export const selectCheckCounts = (s: ChecksState): Record<Severity, number> => {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const d of s.items) counts[d.severity] += 1
  return counts
}
/** 与 store/index.ts selectErrorCount 同一口径（递交页 vs 控制台 error 数相等由 vitest 保证） */
export const selectCheckErrorCount = (s: ChecksState): number => selectCheckCounts(s).error

/**
 * 案级可关闭的 warning code（21 §4.6 体检开关）：只列 warning 级规则，error 级（结构 / 循环 / 多引多 / 图缺失）不可关。
 * 写入 settings.preflight.disabled[]；后端 normalize_settings 与 lint 读该键属 backend 单元（integration_requests）。
 */
export const PREFLIGHT_WARNING_CODES: readonly { code: string; label: string; hint: string }[] = [
  { code: 'claims.unsupported_term', label: '权项术语无说明书支持', hint: '权利要求中出现的名词在说明书中找不到' },
  { code: 'figures.unreferenced', label: '图未被引用', hint: 'figs/ 有图但说明书正文没有「图 N」引用' },
  { code: 'figures.caption_missing', label: '图缺题注', hint: '附图说明缺少对应条目' },
  { code: 'spec.meta_wording', label: '说明书含存疑措辞', hint: '正文只写技术内容，存疑交回批注' },
  { code: 'figures.caption_dup', label: '同图号重复声明', hint: '附图说明里同一图号有多行图注' },
  { code: 'numerals.inconsistent', label: '附图标记同号不同名', hint: '同一标记号在不同位置对应不同名称' },
  { code: 'numerals.legend_conflict', label: '图例标记定义冲突', hint: '图例中的标记定义与正文不一致' },
  { code: 'equation.no_lead', label: '公式前无正文段', hint: '公式块前面没有引导句' },
  { code: 'abstract.limit', label: '摘要超字数', hint: '摘要超过 300 字（含标点）' },
]

export interface PreflightPrefs {
  disabled: string[]
}
/** studio.json 增量键（类型进 lib/types.ts Settings 前在此收口） */
export type SettingsWithPreflight = Settings & { preflight?: PreflightPrefs }

export const disabledPreflight = (settings: Settings | null): string[] => (settings as SettingsWithPreflight | null)?.preflight?.disabled ?? []

export function togglePreflightCode(settings: Settings, code: string, enabled: boolean): SettingsWithPreflight {
  const cur = new Set(disabledPreflight(settings))
  if (enabled) cur.delete(code)
  else cur.add(code)
  return { ...settings, preflight: { disabled: [...cur].sort() } }
}

/** 「检查」tab：当前案形式检查（POST /lint）与仓库回归（/api/check）两次运行的结果 */
export interface ChecksSlice {
  lintRun: LintRun | null
  lintRunning: boolean
  /** 上次 runLint 用的正文（与 content 不等 ⇒ 结果陈旧，递交页横幅提示） */
  lintContent: string | null
  checkAllRun: CheckAllRun | null
  checkAllRunning: boolean
  /** 运行当前案形式检查（编辑器当前内容 + 当前设置）并把结果写入 diagnostics（lint 源） */
  runLint(): Promise<void>
  /** 运行仓库回归 check_all.py（开发者向，与案无关） */
  runCheckAll(): Promise<void>
  /** 递交页进入时：没有跑过或正文已变则跑一次 lint（同一 diagnostics 源，不另起 preflight 请求） */
  ensureLint(): Promise<void>
  /** 切案时丢弃上一案的 lint 结果（回归结果保留） */
  resetChecks(): void
}

const errText = (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.message}` : String(e))

export const checksSlice: Slice<ChecksSlice> = (set, get) => ({
  lintRun: null,
  lintRunning: false,
  lintContent: null,
  checkAllRun: null,
  checkAllRunning: false,

  runLint: async () => {
    const { pid, content, settings, lintRunning } = get()
    if (!pid || !settings || lintRunning) return
    set({ lintRunning: true })
    const t0 = performance.now()
    try {
      const report = await api.lint(pid, { content, settings })
      if (get().pid !== pid) return
      get().setFromLint(report)
      set({ lintRun: { report, error: null, ms: Math.round(performance.now() - t0), at: Date.now() }, lintContent: content })
    } catch (e) {
      set({ lintRun: { report: null, error: errText(e), ms: Math.round(performance.now() - t0), at: Date.now() } })
    } finally {
      set({ lintRunning: false })
    }
  },

  runCheckAll: async () => {
    if (get().checkAllRunning) return
    set({ checkAllRunning: true })
    try {
      const result = await api.check()
      set({ checkAllRun: { result, error: null, at: Date.now() } })
    } catch (e) {
      set({ checkAllRun: { result: null, error: errText(e), at: Date.now() } })
    } finally {
      set({ checkAllRunning: false })
    }
  },

  ensureLint: async () => {
    const { lintRun, lintContent, content, lintRunning } = get()
    if (lintRunning) return
    if (lintRun?.report && lintContent === content) return
    await get().runLint()
  },

  resetChecks: () => set({ lintRun: null, lintContent: null }),
})
