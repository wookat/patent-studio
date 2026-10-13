import { Bell, CalendarClock, FolderKanban, Images } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Count } from '@/components/ui/count'
import { deadlinesHash, figlibHash, inboxHash } from '@/lib/hash'
import { FOCUS_RING_INSET, TRANSITION_COLOR, cn } from '@/lib/utils'
import { selectDueRows, useStudio } from '@/store'

export type DashNavKey = 'cases' | 'deadlines' | 'inbox' | 'figlib'

const ITEMS: { key: DashNavKey; label: string; href: string; icon: typeof Bell }[] = [
  { key: 'cases', label: '案卷', href: '#/', icon: FolderKanban },
  { key: 'deadlines', label: '期限', href: `#${deadlinesHash}`, icon: CalendarClock },
  { key: 'inbox', label: '通知', href: `#${inboxHash}`, icon: Bell },
  { key: 'figlib', label: '图库', href: `#${figlibHash}`, icon: Images },
]

/**
 * 机构页顶栏一级导航「案卷 · 期限 · 通知」（05 §3.2）：ghost 32 文字 tab，当前页 `--fg-strong` + 底部 2px 指示；
 * 期限带 7 天内到期 `Count`（warn 用 neutral 呈现，danger 只给逾期）、通知带未读 `Count info`。
 * 375 = `Segmented xl`（44 高）横排。
 */
export function DashNav({ current, mobile, className }: { current: DashNavKey; mobile?: boolean; className?: string }) {
  const unread = useStudio((s) => s.unreadCount)
  const due = useStudio(useShallow((s) => selectDueRows(s)))
  const overdue = due.some((p) => (p.case?.next_deadline?.days_left ?? 0) < 0)
  const badge = (key: DashNavKey) => {
    if (key === 'inbox' && unread > 0) return <Count value={unread} size="sm" tone="brand" aria-label={`${unread} 条未读`} />
    if (key === 'deadlines' && due.length > 0) return <Count value={due.length} size="sm" tone={overdue ? 'danger' : 'neutral'} aria-label={`${due.length} 项 7 天内到期`} />
    return null
  }

  if (mobile) {
    return (
      <nav aria-label="首页导航" data-slot="DashNav" data-variant="tabs" className={cn('grid h-mobile-tabs shrink-0 grid-cols-4 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]', className)}>
        {ITEMS.map((i) => (
          <a
            key={i.key}
            href={i.href}
            aria-current={i.key === current ? 'page' : undefined}
            data-testid={`nav-${i.key}`}
            className={cn(
              'relative inline-flex min-h-touch flex-col items-center justify-center gap-0.5 text-2xs text-fg-muted aria-[current=page]:font-medium aria-[current=page]:text-link',
              FOCUS_RING_INSET,
              TRANSITION_COLOR,
            )}
          >
            <span className="relative">
              <i.icon className="size-5" aria-hidden />
              {badge(i.key) && <span className="absolute -top-1.5 -right-2.5">{badge(i.key)}</span>}
            </span>
            {i.label}
          </a>
        ))}
      </nav>
    )
  }
  return (
    <nav aria-label="首页导航" data-slot="DashNav" className={cn('flex h-full items-stretch', className)}>
      {ITEMS.map((i) => (
        <a
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          data-testid={`nav-${i.key}`}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-3 text-sm text-fg-muted hover:text-fg-strong',
            'aria-[current=page]:font-medium aria-[current=page]:text-fg-strong aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-fg-strong',
            FOCUS_RING_INSET,
            TRANSITION_COLOR,
          )}
        >
          <i.icon className="size-4" aria-hidden />
          {i.label}
          {badge(i.key)}
        </a>
      ))}
    </nav>
  )
}
