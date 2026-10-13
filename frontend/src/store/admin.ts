import { api, isNotImplemented } from '@/lib/api'
import type { AiUsageSummary, OrgAuditQuery, OrgSettings } from '@/types/org'
import type { Slice } from './types'

/** 节假日表状态（只读；来源 GET /api/deadlines 的 holidays_missing，deadlines-backend 权威） */
export type HolidayStatus = 'unknown' | 'ok' | 'missing' | 'unavailable'

/** 机构审计每页窗口（「加载更多」逐次 +PAGE 扩容，CSV 不受限） */
export const ORG_AUDIT_PAGE = 100

/** 审计筛选 → 列表请求与 CSV 下载共用同一 query（R-ADM-03：筛选参数原样传给 api.admin.audit 与 audit.csv） */
export const auditCsvUrl = (q: OrgAuditQuery): string => {
  const { limit: _limit, ...rest } = q
  return api.orgAuditCsvUrl(rest)
}

/** 模型路由只读展示（21 §2 R-AI-01；与 backend/app/ai/client.py MODELS 同口径，不可在 UI 改） */
export const AI_MODEL_ROUTES: readonly { model: string; role: string; note: string }[] = [
  { model: 'swe-2-medium', role: '默认', note: '润色 / 术语 / 权项建议等日常任务' },
  { model: 'swe-2-max', role: '重任务', note: '整书审阅、OA 答复草案等长上下文任务' },
  { model: 'swe-2-high', role: '兜底', note: '主路由不可用时自动切换' },
]

/**
 * W5 机构管理扩展 `#/admin?tab=org|audit|ai`（docs/plan/21 §4.6；deliver-account-admin-frontend 单元消费，notify-audit-backend / agent-core-backend 填实）。
 * 成员 tab 复用 account slice（adminUsers / org）。本 slice：机构设置（AI 开关 / 默认协作 / SMTP / 预算）、机构审计、AI 用量。
 */
export interface AdminSlice {
  orgSettings: OrgSettings | null
  orgSettingsSaving: boolean
  orgSettingsUnavailable: boolean

  orgAiUsage: AiUsageSummary | null
  orgAiUsageUnavailable: boolean

  orgHolidays: HolidayStatus


  loadOrgSettings(): Promise<void>
  loadOrgHolidays(): Promise<void>
  saveOrgSettings(patch: Partial<OrgSettings>): Promise<boolean>
  loadOrgAiUsage(): Promise<void>
  /** 会话边界（logout/expireSession）清机构面数据，防跨账号残留 */
  resetOrg(): void
}

export const adminSlice: Slice<AdminSlice> = (set, get) => {
  const fail = (e: unknown, key: 'orgSettingsUnavailable' | 'orgAiUsageUnavailable') => {
    const msg = e instanceof Error ? e.message : String(e)
    set({ [key]: isNotImplemented(e) } as Partial<AdminSlice>)
    if (!isNotImplemented(e)) get().toast(msg, 'error')
    return false
  }

  return {
    orgSettings: null,
    orgSettingsSaving: false,
    orgSettingsUnavailable: false,
    orgAiUsage: null,
    orgAiUsageUnavailable: false,
    orgHolidays: 'unknown',

    loadOrgHolidays: async () => {
      try {
        const r = await api.deadlines({ range: 'today' })
        set({ orgHolidays: r.holidays_missing ? 'missing' : 'ok' })
      } catch {
        set({ orgHolidays: 'unavailable' })
      }
    },

    loadOrgSettings: async () => {
      try {
        set({ orgSettings: await api.orgSettings(), orgSettingsUnavailable: false })
      } catch (e) {
        fail(e, 'orgSettingsUnavailable')
      }
    },

    saveOrgSettings: async (patch) => {
      set({ orgSettingsSaving: true })
      try {
        set({ orgSettings: await api.putOrgSettings(patch) })
        get().toast('机构设置已保存', 'success')
        return true
      } catch (e) {
        return fail(e, 'orgSettingsUnavailable')
      } finally {
        set({ orgSettingsSaving: false })
      }
    },

    resetOrg: () =>
      set({
        orgSettings: null,
        orgSettingsSaving: false,
        orgSettingsUnavailable: false,
        orgAiUsage: null,
        orgAiUsageUnavailable: false,
        orgHolidays: 'unknown',
      }),

    loadOrgAiUsage: async () => {
      try {
        set({ orgAiUsage: await api.orgAiUsage(), orgAiUsageUnavailable: false })
      } catch (e) {
        fail(e, 'orgAiUsageUnavailable')
      }
    },

  }
}
