/** 机构审计 / 设置 / AI 用量 API 契约（docs/plan/21-w5-spec.md §4；与 backend/app/schemas.py 逐字段对应） */
/* ---------- 机构审计 / 设置 / AI 用量（notify-audit-backend / agent-core-backend） ---------- */

export type OrgAuditKind =
  | 'auth.login' | 'case.created' | 'case.deleted' | 'case.status' | 'member.changed' | 'admin.user' | 'share.created' | 'share.revoked' | 'share.confirmed'
  | 'export.downloaded' | 'ai.sent' | 'deliver.filed'
  | 'oa.round' | 'deadline.done' | 'deadline.undone' | 'deadline.override' | 'deadline.nudge' | 'comment.assign'

export interface OrgAuditEvent {
  id: string
  ts: number
  kind: OrgAuditKind
  actor: { id: string; display_name: string } | null
  pid: string | null
  data: Record<string, unknown>
}

export interface OrgAuditQuery {
  actor?: string
  pid?: string
  /** ISO 日期 */
  from?: string
  to?: string
  kind?: OrgAuditKind
  limit?: number
}

export interface OrgAuditResponse {
  items: OrgAuditEvent[]
  total: number
}

/** 机构级设置（org.json 扩展）；`ai_enabled=false` → 所有 /ai /agent 403 ai_disabled_by_org */
export interface OrgSettings {
  ai_enabled: boolean
  /** 新建案卷默认协作设置（projects.py 创建钩子读取） */
  default_collab: { editor_mode: 'edit' | 'review'; allow_viewer_comment: boolean }
  smtp: { host: string; port: number; user: string; from: string; enabled: boolean } | null
  /** 每案日预算（tokens，默认 200k） */
  ai_daily_tokens: number
}

export interface AiUsageSummary {
  today_tokens: number
  budget: number
  /** 按案 */
  by_project: { pid: string; title: string; today_tokens: number }[]
  /** 按模型 */
  by_model: { model: string; tokens: number; calls: number }[]
}

