/** 时间线 / 备注 / 审阅指派 API 契约（docs/plan/21-w5-spec.md §4；与 backend/app/schemas.py 逐字段对应） */
/* ---------- 时间线 / 备注 / 审阅指派（share-confirm-backend） ---------- */

export type TimelineEventKind =
  | 'case.created' | 'case.status' | 'note' | 'share.created' | 'share.confirmed' | 'deliver.filed'
  | 'oa.round' | 'deadline.done' | 'deadline.undone' | 'deadline.override' | 'review.assigned' | 'export.downloaded' | 'ai.proposal'

export interface TimelineEvent {
  id: string
  kind: TimelineEventKind
  ts: number
  actor: { id: string; display_name: string } | null
  /** 一句话（含 @ 提及原文） */
  text: string
  mentions: string[]
  data: Record<string, unknown>
}

export interface TimelineResponse {
  items: TimelineEvent[]
}

export interface NoteIn {
  body: string
}

/** 与后端 schemas.NoteIn.body max_length=4000 一致（双写须同步） */
export const NOTE_BODY_MAX = 4000

export interface ReviewAssignIn {
  user_id: string
  /** YYYY-MM-DD */
  due: string | null
}

export interface ReviewAssignResult {
  deadline_id: string | null
}

