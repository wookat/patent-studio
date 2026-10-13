import { fmtRelative } from '@/lib/format'
import { clientHash } from '@/lib/hash'
import type { Role, ShareLink } from '@/lib/types'
import type { PublicShareBaseline, PublicShareLink, PublicShareScope } from '@/types/public-share'
/** 协作者中心各段共用的角色集合 / 有效期 / 时间格式 / 文案（docs/plan/14 §6.2、D11）。 */

/** 最后一个 owner 不能降级 / 移除的提示（RoleSelect 禁用项 + MembersSection 移除钮共用） */
export const LAST_OWNER_HINT = '至少保留一名所有者'
/** clipboard 写失败的统一 toast（LinksSection / PublicLinksSection） */
export const COPY_FAIL_MSG = '复制失败，请手动选择链接文本'

export type ShareRole = Exclude<Role, 'owner'>
/** 成员下拉（D11）：含 owner；只有 owner（canManage）能看到下拉 */
export const MEMBER_ROLES: readonly Role[] = ['owner', 'agent', 'editor', 'reviewer', 'viewer']
/** 分享链接 / 邀请下拉（D11）：无 owner */
export const SHARE_ROLES: readonly ShareRole[] = ['agent', 'editor', 'reviewer', 'viewer']

export type Expiry = '7' | '30' | 'never'
export const EXPIRY_LABEL: Record<Expiry, string> = { '7': '7 天', '30': '30 天', never: '永久' }
export const expiryDays = (v: Expiry): number | null => (v === 'never' ? null : Number(v))

/** ISO → 「3 分钟前 / 14:02 / 昨天 14:02 / 08-21」；无法解析回退原串 */
export function fmtSeen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? iso : fmtRelative(ts, now)
}

export function fmtExpiry(l: Pick<ShareLink, 'expires_at'>, now = Date.now()): string {
  if (!l.expires_at) return '永久有效'
  const d = new Date(l.expires_at)
  if (Number.isNaN(d.getTime())) return l.expires_at
  if (d.getTime() < now) return '已过期'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 到期`
}

/* ---------- 客户审阅链接（W5 §4.5） ---------- */

export const PUBLIC_SCOPE_LABEL: Record<PublicShareScope, string> = { read: '仅阅读', comment: '可批注', confirm: '可确认定稿' }
/** W9 domain-02：正文含未决修订时链接基线的可读名 */
export const PUBLIC_BASELINE_LABEL: Record<PublicShareBaseline, string> = { original: '我已定的正文（不含待定建议）', final: '含未决修订（建议全部视为接受）' }

export type PublicTtl = '1' | '7' | '30' | 'never'
export const PUBLIC_TTL_LABEL: Record<PublicTtl, string> = { '1': '1 天', '7': '7 天', '30': '30 天', never: '永久' }
export const publicTtlDays = (v: PublicTtl): number | null => (v === 'never' ? null : Number(v))

/** 分享用完整 URL：当前站点 + `#/c/<token>` */
export const publicReviewUrl = (token: string) => `${location.origin}${location.pathname}#${clientHash(token)}`

/** Unix 秒 → 「已撤销 / 永久有效 / 已过期 / YYYY-MM-DD 到期」 */
export function fmtPublicExpiry(l: Pick<PublicShareLink, 'expires_at' | 'revoked'>, now = Date.now()): string {
  if (l.revoked) return '已撤销'
  if (!l.expires_at) return '永久有效'
  const ms = l.expires_at * 1000
  if (ms < now) return '已过期'
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 到期`
}

/** 到期毫秒时间 → 剩余整天数（Heat / 倒计时用；null = 永久）；ISO 字串或 Unix 秒都接受 */
export function daysLeftOf(expires: string | number | null | undefined, now = Date.now()): number | null {
  if (expires == null || expires === '') return null
  const ms = typeof expires === 'number' ? expires * 1000 : Date.parse(expires)
  if (Number.isNaN(ms)) return null
  return Math.ceil((ms - now) / 86_400_000)
}
