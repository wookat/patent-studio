/** W4-A 案件台账契约（docs/plan/13-w4a-case-dashboard-design.md §2/§3；backend/app/domain/cases.py 逐字段对应） */

import type { Role } from '@/lib/types'

export type CaseKind = 'invention' | 'utility' | 'design'
export type CaseStatus =
  | 'intake'
  | 'drafting'
  | 'review'
  | 'client_review'
  | 'final'
  | 'filed'
  | 'oa'
  | 'granted'
  | 'rejected'
  | 'closed'
/** 当前用户视角的列表状态（Overleaf：归档 / 回收站是"我的列表"状态，不是案子状态） */
export type ListState = 'active' | 'archived' | 'trashed'
export type DeadlineLevel = 'overdue' | 'red' | 'yellow' | 'normal'

/** 看板列顺序 = 代理机构办案流程顺序 */
export const CASE_STATUSES: readonly CaseStatus[] = [
  'intake',
  'drafting',
  'review',
  'client_review',
  'final',
  'filed',
  'oa',
  'granted',
  'rejected',
  'closed',
]
export const STATUS_LABEL: Record<CaseStatus, string> = {
  intake: '接案',
  drafting: '撰写',
  review: '内审',
  client_review: '客户确认',
  final: '定稿',
  filed: '已递交',
  oa: '审查意见',
  granted: '授权',
  rejected: '驳回',
  closed: '结案',
}
/** 状态徽章 token（index.css `--status-*`）；语义色 + 文字标签双通道，不只靠颜色 */
export const STATUS_TONE: Record<CaseStatus, 'neutral' | 'info' | 'warning' | 'primary' | 'destructive'> = {
  intake: 'neutral',
  drafting: 'info',
  review: 'warning',
  client_review: 'warning',
  final: 'primary',
  filed: 'primary',
  oa: 'destructive',
  granted: 'primary',
  rejected: 'destructive',
  closed: 'neutral',
}
export const KIND_LABEL: Record<CaseKind, string> = { invention: '发明', utility: '实用新型', design: '外观设计' }

export interface CaseDates {
  /** YYYY-MM-DD；旧案默认 = 目录 mtime 日期 */
  opened: string | null
  target_filing: string | null
  /** 申请日（期限推算起算日） */
  filed: string | null
  application_no: string | null
  publication?: string | null
  exam_request?: string | null
  grant?: string | null
}

export interface Deadline {
  /** client_review / filing / oa_reply / custom … */
  kind: string
  /** YYYY-MM-DD */
  due: string
  note: string
  done: boolean
}

/** W19 批7 案间关联：分案↔母案双向指针 + 一般关联；与 priority（在先申请号）是两回事 */
export type RelatedKind = 'parent' | 'divisional' | 'associated'
export const RELATED_KIND_LABEL: Record<RelatedKind, string> = { parent: '母案', divisional: '分案', associated: '关联案' }

export interface RelatedCase {
  pid: string
  kind: RelatedKind
  note: string
}

/** <project>/case.json 全量（GET/PUT /api/projects/{pid}/case） */
export interface Case {
  version: number
  case_no: string
  kind: CaseKind
  status: CaseStatus
  owner_user_id: string | null
  client: string
  applicants: string[]
  inventors: string[]
  tags: string[]
  dates: CaseDates
  deadlines: Deadline[]
  /** 机构级「案子已归档」；与 ListState 'archived'（我的视图）不同 */
  archived: boolean
  /** 案间关联（W19 批7）；可选兼容批7 前的响应/fixture */
  related?: RelatedCase[]
}

/** 服务端算好的下一期限（红 ≤3 天、黄 ≤14 天、<0 已逾期） */
export interface NextDeadline {
  kind: string
  due: string
  note: string
  days_left: number
  level: DeadlineLevel
}

/** GET /api/projects 每行的 case 字段 = Case + next_deadline */
export interface CaseSummary extends Case {
  next_deadline: NextDeadline | null
  /** 目标递交倒计时（W7 ux-04：与 days_left 同源 Asia/Shanghai；无 target_filing = null） */
  target_filing_days_left?: number | null
}

/** PUT /case 请求体：只带要改的字段；status 不在这里（POST /case/status 记 history 事件） */
export type CasePatch = Partial<Omit<Case, 'version' | 'status' | 'dates'> & { dates: Partial<CaseDates> }>

/** 头像 / 姓名展示所需的最少用户字段（GET /api/projects 每行 owner）；avatar_color '' = 未选 */
export interface UserBrief {
  user_id: string
  email: string
  display_name: string
  avatar_color?: string
}

/** GET /api/projects 行内协作者：ACL 成员 + W4-B 访问 / 在线（online = 协同房间当前连着；last_seen = 访问记录，未打开过 ⇒ null） */
export interface Collaborator extends UserBrief {
  role: Role
  online: boolean
  last_seen: string | null
}

/** 机构级标签（<projects_dir>/.studio/tags.json） */
export interface Tag {
  name: string
  /** #rrggbb */
  color: string
}
export const TAG_COLORS: readonly string[] = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
]

/** POST /api/projects/bulk */
export type BulkAction =
  | { action: 'status'; pids: string[]; status: CaseStatus }
  | { action: 'tags'; pids: string[]; add_tags?: string[]; remove_tags?: string[] }
  | { action: 'owner'; pids: string[]; owner_user_id: string | null }
  | { action: 'list_state'; pids: string[]; state: ListState }

export interface BulkResult {
  results: { pid: string; ok: boolean; error?: string }[]
}
