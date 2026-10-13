/** W4-E E2 账户 / 机构管理契约（docs/plan/17-w4e-deliver-admin-design.md §3；后端 app/auth/users_me.py、routes_admin.py） */
import { AVATAR_COLOR_NAMES, PEER_COLORS, PEER_COLOR_BY_NAME, colorFor, type AvatarColorName, type PeerColor } from '@/collab/colors'

/** 头衔只是展示文案（12 §3.1）；权限仍由 is_superuser + 案卷 ACL 决定 */
export type UserTitle = '' | '代理师' | '发明人' | '管理员' | '助理'
export const USER_TITLES: readonly Exclude<UserTitle, ''>[] = ['代理师', '发明人', '管理员', '助理']

/** 与后端 schemas.AVATAR_COLORS 一致；'' = 未选 → 按 colorFor(name) 派生（色盘 / 哈希与协作头像同源：collab/colors.ts） */
export type AvatarColor = '' | AvatarColorName
export const AVATAR_COLORS: readonly AvatarColorName[] = AVATAR_COLOR_NAMES
export const AVATAR_COLOR_HEX: Record<AvatarColorName, PeerColor> = PEER_COLOR_BY_NAME

/** 未选预设色时按名派生的色名；与 collab/colors userColor 的回退同一哈希（去首尾空格） */
export function avatarColorFor(name: string): AvatarColorName {
  return AVATAR_COLOR_NAMES[PEER_COLORS.indexOf(colorFor(name.trim()))]
}

/** `PUT /api/users/me`：只带要改的字段；改密必须带当前密码 */
export interface MeIn {
  display_name?: string
  title?: UserTitle
  avatar_color?: AvatarColor
  password?: { current: string; new: string }
}

/** `GET /api/admin/users` 每行（超管） */
export interface AdminUser {
  id: string
  email: string
  display_name: string
  title: UserTitle
  avatar_color: AvatarColor
  is_superuser: boolean
  is_active: boolean
  /** ISO 8601；从未登录 ⇒ null */
  last_login_at: string | null
}

/** `PUT /api/admin/users/{id}`：禁用 / 提升为管理员 / 改头衔（不能对自己 is_active=false） */
export interface AdminUserIn {
  is_active?: boolean
  is_superuser?: boolean
  title?: UserTitle
}

/** `GET/PUT /api/admin/org`：机构名称（<projects_dir>/.studio/org.json） */
export interface Org {
  name: string
}
