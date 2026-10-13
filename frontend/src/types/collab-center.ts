import type { Member, Role } from '@/lib/types'

/**
 * W4-B 协作者中心（docs/plan/14 §4）：与后端 dict 逐字段对应。prep 已定形，B3 只消费。
 */

/** 访问记录里的人：曾访问 / 经链接领取但之后被移出成员 ⇒ ACL 无行，role=null（后端保留历史访问事实不隐藏） */
export type AccessUser = Omit<Member, 'role'> & { role: Role | null }

/** GET /projects/{pid}/access → viewed[] */
export interface AccessRow {
  user: AccessUser
  first_seen: string
  last_seen: string
  /** 打开次数（同用户 30 分钟内算一次，14 §2.1） */
  count: number
  /** 本案任一 Yjs 房间里有活连接（14 D4） */
  online: boolean
}

/** GET /projects/{pid}/access → not_viewed[]：有资格却没打开过的人 */
export interface NotViewedRow {
  /** pending 邀请（尚未注册）时为 null，只有 email；via='link' 领取人已被移出时 role=null */
  user: AccessUser | null
  email: string
  via: 'member' | 'link' | 'invite'
}

export interface AccessReport {
  viewed: AccessRow[]
  not_viewed: NotViewedRow[]
}

/** pending_invites 行（14 §2） */
export interface Invite {
  email: string
  role: Exclude<Role, 'owner'>
  /** 邀请人 user_id */
  invited_by: string
  created_at: string
}

/** GET/PUT /projects/{pid}/collab-settings（14 D8：只存字段、前端按字段隐藏入口） */
export interface CollabSettings {
  allow_download: boolean
  allow_copy: boolean
  allow_comment: boolean
}

export const DEFAULT_COLLAB_SETTINGS: CollabSettings = { allow_download: true, allow_copy: true, allow_comment: true }

/** 编辑器右上模式指示（Overleaf Editing / Reviewing / Viewing；14 §6.2 ModeIndicator） */
export type EditorMode = 'edit' | 'review' | 'readonly'
export const EDITOR_MODE_LABEL: Record<EditorMode, string> = { edit: '编辑', review: '审阅', readonly: '只读' }

export type CollabCenterTab = 'members' | 'links' | 'access' | 'settings'
export const COLLAB_CENTER_TABS: { id: CollabCenterTab; label: string }[] = [
  { id: 'members', label: '协作者' },
  { id: 'links', label: '链接' },
  { id: 'access', label: '访问记录' },
  { id: 'settings', label: '设置' },
]
