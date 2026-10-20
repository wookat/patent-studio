import type { BookName } from './ast'
import type { CaseStatus } from './case'
import type { Comment, CommentAnchor } from '@/lib/types'

/** 客户公开审阅 API 契约（docs/plan/21-w5-spec.md §4；与 backend/app/schemas.py 逐字段对应） */
/* ---------- 客户公开审阅（share-confirm-backend / client-review-frontend） ---------- */

export type PublicShareScope = 'read' | 'comment' | 'confirm'
/** 客户看哪份正文（W9 domain-02）：original = 撰写人已定正文（未决修订不计）；final = 含未决修订（按接受渲染） */
export type PublicShareBaseline = 'original' | 'final'

export interface PublicShareLink {
  token: string
  pid: string
  scope: PublicShareScope
  baseline: PublicShareBaseline
  /** 允许下载 / 复制（缺省 false） */
  allow_download: boolean
  expires_at: number | null
  revoked: boolean
  created_by: { id: string; display_name: string }
  created_at: number
  /** 访问记录条数 */
  visits: number
  last_visit_at: number | null
}

export interface PublicShareLinkIn {
  scope: PublicShareScope
  baseline?: PublicShareBaseline
  ttl_days: number | null
  allow_download?: boolean
}

/** `GET /api/public/{token}/meta` */
export interface PublicShareMeta {
  org_name: string
  title: string
  case_no: string | null
  status: CaseStatus
  /** 当前对外版本号（客户看到的 vN）与对应 sha */
  version: number
  sha: string
  content_sha: string
  scope: PublicShareScope
  baseline: PublicShareBaseline
  /** 当前正文里尚未接受 / 拒绝的修订数；>0 时页首提示本审阅版按 baseline 渲染 */
  pending_revisions: number
  /** studio.json settings.sub_except：版面行内格式渲染时这些子串内的 `_` 不作下标 */
  sub_except: string[]
  allow_download: boolean
  /** 机构协作默认（routes_public PublicMetaOut）：禁复制 ⇒ 客户页拦截 copy；禁批注 ⇒ 无「有意见」入口 */
  allow_copy: boolean
  allow_comment: boolean
  expires_at: number | null
  /** 已有确认（最新一条） */
  confirmation: Confirmation | null
  pdf_ready: boolean
}

export interface Confirmation {
  version: number
  sha: string
  content_sha?: string | null
  name: string
  note: string | null
  confirmed_at: number
}

export interface PublicCommentIn {
  anchor: CommentAnchor & { book?: BookName }
  body: string
  /** 访客姓名（localStorage 记一次） */
  guest_name: string
}

export interface PublicConfirmIn {
  name: string
  note?: string
  expected_version: number
  expected_sha: string
  expected_content_sha: string
}

/** 与后端 schemas 公开端点字段上限一致（双写须同步）：PublicCommentIn.body 4000 /
    PublicConfirmIn.note 2000 / guest_name·name 64 */
export const PUBLIC_COMMENT_BODY_MAX = 4000
export const PUBLIC_CONFIRM_NOTE_MAX = 2000
export const GUEST_NAME_MAX = 64

export type PublicComment = Comment & { guest?: boolean }
