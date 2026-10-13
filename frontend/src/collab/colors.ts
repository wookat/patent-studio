/**
 * 用户颜色（docs/plan/11 §5.4）：按用户名稳定哈希到 8 色盘，同名跨端一致、同房间内色差可辨（Overleaf 同做法）。
 * 色盘取自 Tailwind 500 档，深浅主题下与白字/黑字对比度均 ≥3:1（光标标签用 `labelText`）。
 */
export const PEER_COLORS = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#22c55e', // green
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ef4444', // red
] as const

export type PeerColor = (typeof PEER_COLORS)[number]

/** 账户「头像色」预设名（与后端 schemas.AVATAR_COLORS 一致），与 PEER_COLORS 同序同色盘 */
export const AVATAR_COLOR_NAMES = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow', 'red'] as const
export type AvatarColorName = (typeof AVATAR_COLOR_NAMES)[number]
export const PEER_COLOR_BY_NAME: Record<AvatarColorName, PeerColor> = {
  blue: PEER_COLORS[0],
  orange: PEER_COLORS[1],
  green: PEER_COLORS[2],
  purple: PEER_COLORS[3],
  pink: PEER_COLORS[4],
  teal: PEER_COLORS[5],
  yellow: PEER_COLORS[6],
  red: PEER_COLORS[7],
}
export function isAvatarColorName(v: unknown): v is AvatarColorName {
  return typeof v === 'string' && (AVATAR_COLOR_NAMES as readonly string[]).includes(v)
}

/**
 * 一个用户在全站唯一的头像色：账户里选了预设色就用它，否则按显示名（无则邮箱）稳定哈希。
 * 顶栏 / 台账责任人 / 协作者 / 成员表 / 期限中心 / 账户页 / 协同光标全部经此取色，保证同一人同色。
 */
export function userColor(u: { display_name?: string | null; email?: string | null; avatar_color?: string | null } | null | undefined): PeerColor {
  if (!u) return PEER_COLORS[0]
  if (isAvatarColorName(u.avatar_color)) return PEER_COLOR_BY_NAME[u.avatar_color]
  return colorFor(u.display_name?.trim() || u.email || '')
}

/** 与 Java `String.hashCode` 同式的 31 进制哈希，取模选色；空名回退首色 */
export function colorFor(name: string): PeerColor {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length]
}

/** 头像首字前景：黄/青底用深字，其余白字（≥ 3:1，字号 ≥ 12px 且多为装饰） */
export function labelText(color: string): '#0b1220' | '#ffffff' {
  return color === '#eab308' || color === '#14b8a6' ? '#0b1220' : '#ffffff'
}

/** 远端光标名字条前景：11px 小字需 ≥ 4.5:1，8 色底上深字最低 4.73（紫）、白字最高仅 3.96，故统一深字 */
export const CURSOR_LABEL_TEXT = '#0b1220'

/** 头像 / 光标标签首字：显示名首字符（中文一字、英文首字母大写） */
export function initialOf(name: string): string {
  const s = name.trim()
  return s ? Array.from(s)[0].toUpperCase() : '?'
}
