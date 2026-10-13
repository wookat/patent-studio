import type { BuildOutcome, Diagnostic, LintReport, Severity } from '@/lib/types'
import type { Slice } from './types'

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

function merge(build: Diagnostic[], lint: Diagnostic[], client: Diagnostic[]): Diagnostic[] {
  const byId = new Map<string, Diagnostic>()
  for (const d of [...build, ...lint, ...client]) byId.set(d.id, d)
  return [...byId.values()].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.line ?? 1e9) - (b.line ?? 1e9),
  )
}

/**
 * 构建错误 kind → 同一问题的 lint/client 诊断 id：同 id 合并时后写覆盖，
 * 避免「摘要超长」在 gutter / 问题列表里出现 build.abstract_limit + abstract.limit 两条。
 */
const KIND_TO_ID: Record<string, string> = { abstract_limit: 'abstract.limit' }
const buildId = (kind: string | undefined) => KIND_TO_ID[kind ?? ''] ?? `build.${kind || 'error'}`
const normalizeBuildId = (d: Diagnostic): Diagnostic => {
  const m = /^build\.(.+)$/.exec(d.id)
  const mapped = m ? KIND_TO_ID[m[1]] : undefined
  return mapped ? { ...d, id: mapped } : d
}

/** 构建失败（BuildError）→ 一条 source='build' 的 error 诊断 */
export function buildErrorToDiagnostic(out: BuildOutcome): Diagnostic | null {
  const e = out.error
  if (!e) return null
  return {
    id: buildId(e.kind),
    severity: 'error',
    source: 'build',
    message: e.message,
    line: e.line ?? null,
    detail: e.detail,
  }
}

export interface DiagnosticsSlice {
  /** 合并、去重（按 id，后写覆盖）、按 severity/line 排序后的列表 */
  items: Diagnostic[]
  buildItems: Diagnostic[]
  lintItems: Diagnostic[]
  clientItems: Diagnostic[]

  /** 每次构建结果到达时调用：替换 build 源（含 outcome.diagnostics 与 BuildError） */
  setFromBuild(outcome: BuildOutcome): void
  setFromLint(report: LintReport): void
  /** 前端即时规则（摘要字数等），由 F2/F4 写入 */
  setClient(items: Diagnostic[]): void
  resetDiagnostics(): void
}

export const diagnosticsSlice: Slice<DiagnosticsSlice> = (set, get) => ({
  items: [],
  buildItems: [],
  lintItems: [],
  clientItems: [],

  setFromBuild: (out) => {
    if (out.status === 'superseded') return
    const err = buildErrorToDiagnostic(out)
    const diags = out.diagnostics ?? []
    const buildItems = [...(err ? [err] : []), ...diags.filter((d) => d.source === 'build').map(normalizeBuildId)]
    // 后端每次构建都附带完整 lint 结果（含 boundary.* 边界提示；可为空 = 全部通过），直接替换
    const lintItems = diags.filter((d) => d.source === 'lint' || d.source === 'boundary')
    set({ buildItems, lintItems, items: merge(buildItems, lintItems, get().clientItems) })
  },

  setFromLint: (report) => {
    const lintItems = report.diagnostics
    set({ lintItems, items: merge(get().buildItems, lintItems, get().clientItems) })
  },

  setClient: (clientItems) => {
    set({ clientItems, items: merge(get().buildItems, get().lintItems, clientItems) })
  },

  resetDiagnostics: () => set({ items: [], buildItems: [], lintItems: [], clientItems: [] }),
})
