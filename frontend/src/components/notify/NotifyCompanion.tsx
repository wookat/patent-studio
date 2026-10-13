import { useEffect } from 'react'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useStudio } from '@/store'
import { NotificationRow } from './NotificationRow'

/** 伴随栏头部动作：全部已读（ghost，无 primary） */
export function NotifyCompanionActions() {
  const unread = useStudio((s) => s.unreadCount)
  const unavailable = useStudio((s) => s.notifyUnavailable)
  const markAllRead = useStudio((s) => s.markAllRead)
  return (
    <Button variant="ghost" size="icon-sm" aria-label="全部已读" title="全部已读" disabled={unread === 0 || unavailable} onClick={() => void markAllRead()} data-testid="companion-notify-mark-all">
      <CheckCheck aria-hidden />
    </Button>
  )
}

/**
 * 伴随栏「通知」正文（prep 契约 registerCompanionBody('notify')）：`?panel=notify` 时列出最近通知（紧凑行 36），
 * 与 #/inbox / 铃铛共用 NotificationRow，点击标已读并跳落点。
 */
export function NotifyCompanionBody() {
  const items = useStudio((s) => s.notifications)
  const loading = useStudio((s) => s.notifyLoading)
  const unavailable = useStudio((s) => s.notifyUnavailable)
  const error = useStudio((s) => s.notifyError)
  const load = useStudio((s) => s.loadNotifications)
  useEffect(() => {
    if (items.length === 0) void load({ limit: 50 })
  }, [items.length, load])

  if (unavailable) return <EmptyState size="sm" icon={Bell} title={NOT_IMPLEMENTED_TITLE} reason="站内通知后端接口尚未上线。" />
  if (error && items.length === 0)
    return <EmptyState size="sm" icon={Bell} title="通知加载失败" reason={error} action={<Button variant="secondary" size="sm" onClick={() => void load({ limit: 50 })}>重试</Button>} />
  if (loading && items.length === 0)
    return (
      <ul className="flex flex-col gap-1 p-2" aria-busy="true" aria-label="加载中">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex h-row-compact items-center gap-2 px-1">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
          </li>
        ))}
      </ul>
    )
  if (items.length === 0) return <EmptyState size="sm" icon={Inbox} title="暂无通知" reason="被 @ 提及、审阅指派、期限提醒与客户确认都会出现在这里。" />
  return (
    <ul className="divide-y divide-border" aria-label="通知列表" data-testid="companion-notify">
      {items.map((n) => (
        <NotificationRow key={n.id} n={n} dense />
      ))}
    </ul>
  )
}
