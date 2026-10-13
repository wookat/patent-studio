import { useStudio } from '@/store'
import type { Notification } from '@/types/notify'
import { FOCUS_RING_INSET, TRANSITION_COLOR, cn } from '@/lib/utils'
import { NOTIFY_KIND, notificationHash, relativeTime } from './notifyKinds'

interface NotificationRowProps {
  n: Notification
  /** 铃铛 Popover 内的紧凑行（单行正文，36） */
  dense?: boolean
  /** 点击后（导航前）回调：铃铛用它收起 Popover */
  onOpen?(n: Notification): void
}

/**
 * 通知行（05 §4 通知；铃铛 Popover 与 #/inbox 共用）：行 48 = 图标圆 28（语义族底色）· 标题（未读 `--fg-strong` 粗体）· 正文 · 相对时间 · 未读点 `--info-dot`。
 * 点击 = 标已读 + 跳 hash（`#/p/<pid>?c=<cid>` / `?focus=<block_id>` 等契约落点）；触控密度行 ≥ 48。
 */
export function NotificationRow({ n, dense = false, onOpen }: NotificationRowProps) {
  const markRead = useStudio((s) => s.markRead)
  const { Icon, label, className } = NOTIFY_KIND[n.kind] ?? NOTIFY_KIND.system
  const hash = notificationHash(n)
  const open = () => {
    void markRead(n.id)
    onOpen?.(n)
    if (hash) window.location.hash = hash
  }
  return (
    <li data-testid={`row-${n.id}`} data-state={n.read ? 'read' : 'unread'} data-slot="notification-row">
      <a
        href={hash ? `#${hash}` : undefined}
        role={hash ? undefined : 'button'}
        tabIndex={0}
        aria-label={`${label}：${n.title}${n.read ? '' : '（未读）'}`}
        onClick={(e) => {
          e.preventDefault()
          open()
        }}
        onKeyDown={(e) => {
          if (!hash && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            open()
          }
        }}
        className={cn(
          'flex w-full items-center gap-3 text-left hover:bg-hover',
          dense ? 'min-h-row-compact px-3 py-1.5' : 'min-h-row-mobile px-4 py-2 md:px-page-x',
          !n.read && 'bg-selected/40',
          FOCUS_RING_INSET,
          TRANSITION_COLOR,
        )}
      >
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full', dense ? 'size-6' : 'size-7', className)} aria-hidden>
          <Icon className={dense ? 'size-3.5' : 'size-4'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', n.read ? 'text-fg' : 'font-semibold text-fg-strong')} data-slot="notification-title" title={n.title}>
              {n.title}
            </span>
            <time className="shrink-0 text-2xs text-fg-muted tabular-nums" dateTime={new Date(n.created_at * 1000).toISOString()}>
              {relativeTime(n.created_at)}
            </time>
          </span>
          {n.body && (
            <span className={cn('mt-0.5 block text-xs text-fg-muted', dense ? 'truncate' : 'line-clamp-1')} data-slot="notification-body" title={n.body}>
              {n.actor ? `${n.actor.display_name} · ` : ''}
              {n.body}
            </span>
          )}
        </span>
        <span className={cn('size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-info-dot')} aria-hidden data-slot="notification-dot" data-unread={!n.read || undefined} />
      </a>
    </li>
  )
}
