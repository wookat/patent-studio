import { api, ApiError } from '@/lib/api'
import type { Version, XmlExportResult } from '@/lib/types'
import type { Case } from '@/types/case'
import { EXPORT_KINDS, EXPORT_LABEL, type DeliverManifest, type ExportEntry, type FilingIn } from '@/types/deliver'
import type { Confirmation } from '@/types/public-share'
import type { DeliverError } from '@/types/deliver'
import type { Slice } from './types'

/**
 * 产物清单的唯一 selector（R-CHK-07）：六种产物固定顺序，清单缺项补空壳（未生成）。
 * ExportGrid / 递交页计数 / 移动端 Tab 都从这里取，vitest 断言三处一致。
 */
export function gridEntries(manifest: DeliverManifest | null): ExportEntry[] {
  return EXPORT_KINDS.map(
    (kind) =>
      manifest?.items.find((e) => e.kind === kind) ?? { kind, label: EXPORT_LABEL[kind], at: null, size: null, url: null },
  )
}
export const selectExportEntries = (s: { manifest: DeliverManifest | null }) => gridEntries(s.manifest)

/** case.json.confirmations[]（share-confirm-backend 写入；类型进 types/case.ts 前在此收口） */
export type CaseWithConfirmations = Case & { confirmations?: Confirmation[] }

export type ConfirmationState =
  | { kind: 'none' }
  | { kind: 'current'; confirmation: Confirmation }
  | { kind: 'stale'; confirmation: Confirmation }

/**
 * 客户确认徽章（21 §1.2 A5）：最新一条确认的 sha 与当前版本 sha 相同 ⇒ 「客户确认 vN」；
 * 不同（确认后源文档又改过）⇒ warning「确认版本已过期」；无确认 / 当前 sha 未知 ⇒ 不显示。
 */
export function confirmationState(confirmations: Confirmation[] | undefined, currentSha: string | null): ConfirmationState {
  if (!confirmations || confirmations.length === 0) return { kind: 'none' }
  const latest = confirmations.reduce((a, b) => (b.confirmed_at >= a.confirmed_at ? b : a))
  if (currentSha === null) return { kind: 'none' }
  return latest.sha === currentSha ? { kind: 'current', confirmation: latest } : { kind: 'stale', confirmation: latest }
}

export const selectConfirmationState = (s: { project: { case?: Case | null } | null; versions: Version[] }) =>
  confirmationState((s.project?.case as CaseWithConfirmations | null | undefined)?.confirmations, s.versions[0]?.sha ?? null)

/**
 * 交付：R7 五书 XML 导出（runXmlExport，结果由递交页 XML 卡片内的 XmlReport 展示）
 * + W4-E E1 递交页（docs/plan/17 §2）：导出包清单 / 全部打包 / 标记已递交。
 * 后端 501（通用不可用态）→ manifestUnavailable=true，ExportGrid 显示「递交包清单不可用」、不弹 toast（与 attachments slice 同策略）。
 */
export interface DeliverSlice {
  xmlRunning: boolean
  xmlResult: XmlExportResult | null
  xmlError: string | null
  /** 导出完成时间戳 */
  xmlAt: number | null
  /** 用编辑器当前内容 + 当前设置导出；失败时返回 null 并写 xmlError */
  runXmlExport(): Promise<XmlExportResult | null>
  /** 切案时清空上一案的交付报告与递交页状态 */
  resetDeliver(): void

  manifest: DeliverManifest | null
  manifestLoading: boolean
  manifestError: string | null
  manifestUnavailable: boolean
  bundleRunning: boolean
  /** FilingDialog 开关（ui.dialog 不放这里：递交页不在工作台壳内） */
  filingOpen: boolean
  /** 批74：递交表单草稿——递交页随 hash 路由卸载时 FilingForm 不丢；单槽 {key=pid}，显式关闭/提交清 */
  filingDraft: { key: string; filed: string; application_no: string } | null

  loadManifest(pid: string): Promise<DeliverManifest | null>
  /** 「生成递交包」：POST /deliver/bundle（用编辑器当前内容 + 设置），成功后以响应覆盖清单 */
  runBundle(): Promise<DeliverManifest | null>
  setFilingOpen(open: boolean): void
  /** 批74：写递交草稿；null 清除 */
  setFilingDraft(d: { key: string; filed: string; application_no: string } | null): void
  /** 先 PUT /case {dates}，再 POST /case/status filed；两步任一失败 toast 并返回 false */
  fileCase(input: FilingIn): Promise<boolean>

  /** 字段级错误（GET /deliver/errors；申请人 / 发明人 / 案号等台账字段缺失）；501 → deliverErrorsUnavailable */
  deliverErrors: DeliverError[]
  deliverErrorsLoading: boolean
  deliverErrorsUnavailable: boolean
  loadDeliverErrors(pid: string): Promise<void>
}

export const deliverSlice: Slice<DeliverSlice> = (set, get) => ({
  xmlRunning: false,
  xmlResult: null,
  xmlError: null,
  xmlAt: null,

  manifest: null,
  manifestLoading: false,
  manifestError: null,
  manifestUnavailable: false,
  bundleRunning: false,
  filingOpen: false,
  filingDraft: null as { key: string; filed: string; application_no: string } | null,

  deliverErrors: [],
  deliverErrorsLoading: false,
  deliverErrorsUnavailable: false,

  loadDeliverErrors: async (pid) => {
    set({ deliverErrorsLoading: true })
    try {
      const r = await api.deliverErrors(pid)
      if (get().pid === pid) set({ deliverErrors: r.errors, deliverErrorsUnavailable: false })
    } catch (e) {
      set({ deliverErrorsUnavailable: e instanceof ApiError && e.status === 501 })
    } finally {
      set({ deliverErrorsLoading: false })
    }
  },

  runXmlExport: async () => {
    const { pid, content, settings, xmlRunning } = get()
    if (!pid || !settings || xmlRunning) return null
    set({ xmlRunning: true, xmlError: null })
    try {
      const result = await api.exportXml(pid, { content, settings })
      if (get().pid === pid) set({ xmlResult: result, xmlAt: Date.now() })
      return result
    } catch (e) {
      set({ xmlError: e instanceof ApiError ? `${e.status} ${e.message}` : String(e) })
      return null
    } finally {
      set({ xmlRunning: false })
    }
  },

  resetDeliver: () =>
    set({
      xmlResult: null,
      xmlError: null,
      xmlAt: null,
      manifest: null,
      manifestError: null,
      manifestUnavailable: false,
      bundleRunning: false,
      filingOpen: false,
      filingDraft: null,
      deliverErrors: [],
      deliverErrorsLoading: false,
      deliverErrorsUnavailable: false,
    }),

  loadManifest: async (pid) => {
    set({ manifestLoading: true })
    try {
      const m = await api.deliverManifest(pid)
      if (get().pid !== pid) return null
      set({ manifest: m, manifestLoading: false, manifestError: null, manifestUnavailable: false })
      return m
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ manifestLoading: false, manifestError: msg, manifestUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    }
  },

  runBundle: async () => {
    const { pid, content, settings, bundleRunning } = get()
    if (!pid || bundleRunning) return null
    set({ bundleRunning: true })
    try {
      const m = await api.deliverBundle(pid, { content, settings: settings ?? undefined })
      if (get().pid === pid) set({ manifest: m, manifestError: null, manifestUnavailable: false })
      return m
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiError && e.status === 501) set({ manifestUnavailable: true, manifestError: msg })
      else get().toast(msg, 'error')
      return null
    } finally {
      set({ bundleRunning: false })
    }
  },

  setFilingOpen: (open) => set({ filingOpen: open }),
  setFilingDraft: (d) => set({ filingDraft: d }),

  fileCase: async ({ filed, application_no }) => {
    const { pid, patchCase, setCaseStatus } = get()
    if (!pid) return false
    if (!(await patchCase(pid, { dates: { filed, application_no } }))) return false
    if (!(await setCaseStatus(pid, 'filed', `申请号 ${application_no}`))) return false
    if (get().pid === pid) set({ filingOpen: false })
    get().toast('已标记为已递交', 'success')
    return true
  },
})
