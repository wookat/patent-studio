import { AtSign, Bell, BellRing, CalendarClock, CheckCircle2, Sparkles, UserCheck, type LucideIcon } from 'lucide-react'
import type { Notification, NotificationKind } from '@/types/notify'
/**
 * 通知类型 → 图标 / 文案 / 语义色族（05 §4 通知：≥ 4 类图标色，不全绿）：
 * 提及 info · 指派 violet · 期限 warn · 催办 danger · 确认 ok · AI teal · 系统 neutral。
 * 图标底 = `--<族>-bg`，图标 = `--<族>-fg`（对比 ≥ 4.5:1，由 check-contrast 回归保证）。
 */
export const NOTIFY_KIND: Record<NotificationKind, { Icon: LucideIcon; label: string; className: string }> = {
  mention: { Icon: AtSign, label: '提及', className: 'bg-info-bg text-info-fg' },
  assign: { Icon: UserCheck, label: '指派', className: 'bg-violet-bg text-violet-fg' },
  deadline: { Icon: CalendarClock, label: '期限', className: 'bg-warn-bg text-warn-fg' },
  confirm: { Icon: CheckCircle2, label: '确认', className: 'bg-ok-bg text-ok-fg' },
  ai: { Icon: Sparkles, label: 'AI', className: 'bg-teal-bg text-teal-fg' },
  nudge: { Icon: BellRing, label: '催办', className: 'bg-danger-bg text-danger-fg' },
  system: { Icon: Bell, label: '系统', className: 'bg-sunken text-fg-muted' },
}

/**
 * 通知落点 → hash（不含 `#`）。后端 `href` 可能是 `#/p/x?c=y` / `/p/x?c=y`；无 href 但有 pid 时进该案。
 * 返回 null = 无落点（只标已读）。
 */
export function notificationHash(n: Pick<Notification, 'href' | 'pid'>): string | null {
  if (n.href) return n.href.startsWith('#') ? n.href.slice(1) : n.href
  if (n.pid) return `/p/${encodeURIComponent(n.pid)}`
  return null
}

/** 相对时间（zh-CN；超过 7 天显示日期） */
export function relativeTime(sec: number, now: number = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000 - sec))
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return new Date(sec * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
