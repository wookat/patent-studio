/** 通知 / 催办 API 契约（docs/plan/21-w5-spec.md §4；与 backend/app/schemas.py 逐字段对应） */
/* ---------- 通知 / 催办（notify-audit-backend） ---------- */

export type NotificationKind = 'mention' | 'assign' | 'deadline' | 'confirm' | 'ai' | 'nudge' | 'system'

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  /** 点击跳转的 hash（`#/p/<pid>?c=<cid>` / `#/deadlines` …） */
  href: string | null
  pid: string | null
  actor: { id: string; display_name: string } | null
  read: boolean
  created_at: number
}

export interface NotificationListResponse {
  items: Notification[]
  unread: number
  /** 更早还有 → 用 items.at(-1).id 作 before_id 取下一页 */
  has_more: boolean
}

export interface NudgeIn {
  deadline_id?: string
  user_id?: string
  message?: string
}

export interface NudgeResult {
  notified: number
}

