import type { Role } from '@/lib/types'

/**
 * 期限 API 契约（docs/plan/21-w5-spec.md §4；与 backend/app/schemas.py 逐字段对应）。
 * due/base_date 一律 YYYY-MM-DD（Asia/Shanghai；后端唯一权威，前端只格式化）。
 */
/* ---------- 期限（deadlines-backend） ---------- */

export type DeadlineKind = 'oa_reply' | 'exam_request' | 'priority' | 'annual_fee' | 'review_due' | 'divisional' | 'reexam' | 'publication' | 'custom'
export type DeadlineRange = 'today' | '7d' | '30d' | 'overdue' | 'all'
export type DeadlineStatus = 'upcoming' | 'due_soon' | 'overdue' | 'done'

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  oa_reply: 'OA 答复', exam_request: '实审请求', priority: '优先权', annual_fee: '年费', review_due: '审阅期限', divisional: '分案', reexam: '复审', publication: '公布', custom: '自定义',
}

export interface DeadlineItem {
  id: string
  pid: string
  case_no: string | null
  title: string
  kind: DeadlineKind
  /** YYYY-MM-DD（Asia/Shanghai；后端唯一权威，前端只格式化） */
  due: string
  base_date: string | null
  /** 规则 id（backend/app/deadlines/rules.json）；custom 为 null */
  rule: string | null
  legal_basis: { text: string; url: string } | null
  /** auto = 规则推算；manual = 人工录入 / 改写 */
  source: 'auto' | 'manual'
  override_reason: string | null
  status: DeadlineStatus
  days_left: number
  owner: { id: string; display_name: string; avatar_color?: string } | null
  client: string | null
  done: boolean
  done_at: number | null
  /** OA 延期记录 */
  extensions: { months: number; requested_at: string }[]
  /** 当前用户在 pid 案的角色（行级写门槛门控用）；AUTH=off ⇒ null/缺省（视为可写） */
  my_role?: Role | null
}

/**
 * 只读「目标递交」倒计时（W7 ux-04：GET /api/deadlines.target_filings，后端 routes_deadlines.TargetFilingItem）。
 * 不是期限条目：不进 items / counts / 分组；target_filing_days_left 与 days_left 同源 Asia/Shanghai。
 */
export interface TargetFilingItem {
  pid: string
  case_no: string | null
  title: string
  target_filing: string
  target_filing_days_left: number
  owner: DeadlineItem['owner']
  client: string | null
}

export interface DeadlineListResponse {
  items: DeadlineItem[]
  counts: Record<Exclude<DeadlineRange, 'all'>, number>
  /** 无节假日表时 true → 页面显示「只按周末顺延」warning */
  holidays_missing: boolean
  target_filings?: TargetFilingItem[]
}

export interface DeadlineOverrideIn {
  due?: string
  override_reason: string
}

/** 与后端 schemas.DeadlineOverrideIn.override_reason max_length=500 一致（双写须同步） */
export const OVERRIDE_REASON_MAX = 500

