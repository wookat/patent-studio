import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { useStudio } from '@/store'
import { NOTIFY_RECENT } from '@/store/notify'
import { goInbox } from '@/lib/hash'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { NotificationRow } from './NotificationRow'

/**
 * 顶栏铃铛（21 §4.2 / R-HOME-07 UI）：未读数徽章 + Popover 最近 10 条 + 「全部已读」+ 「全部」→ #/inbox。
 * 挂载即启动 store.startNotifyPolling（30s）；通过 lib/slots.registerTopBarItem 注入 TopBar（见 ./slots.tsx），不改 shell/**。
 * TopBar 是 overflow-hidden 的 48px 条，ui/Popover 不走 Portal，故浮层改为 fixed 定位到铃铛右下方（打开时量一次，窗口尺寸变化则收起）。
 */
export function NotifyBell({ compact = false }: { compact?: boolean }) {
  const unread = useStudio((s) => s.unreadCount)
  const items = useStudio((s) => s.notifications)
  const loading = useStudio((s) => s.notifyLoading)
  const unavailable = useStudio((s) => s.notifyUnavailable)
  const error = useStudio((s) => s.notifyError)
  const markAllRead = useStudio((s) => s.markAllRead)
  const startNotifyPolling = useStudio((s) => s.startNotifyPolling)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => startNotifyPolling(), [startNotifyPolling])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [open])

  const onOpenChange = (v: boolean) => {
    if (v && host.current) {
      const r = host.current.getBoundingClientRect()
      setPos({ top: r.bottom, right: Math.max(0, window.innerWidth - r.right) })
    }
    setOpen(v)
  }

  const recent = items.slice(0, NOTIFY_RECENT)

  return (
    <span ref={host} className="inline-flex" data-slot="NotifyBell">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger>
          <Button
            variant="ghost"
            size={compact ? 'icon-xl' : 'icon'}
            className="relative"
            aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'} title={unread > 0 ? `通知，${unread} 条未读` : '通知'}
            data-testid="topbar-notify"
            data-state={unread > 0 ? 'unread' : 'read'}
          >
            <Bell aria-hidden />
            {unread > 0 && (
              <Count value={unread} size="sm" tone="brand" className="absolute -top-0.5 -right-0.5" data-testid="topbar-notify-badge" aria-hidden />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="fixed mt-1 w-96 max-w-[calc(100vw-1rem)] whitespace-normal p-0"
          style={pos ? { top: pos.top, right: pos.right } : undefined}
          aria-label="最近通知"
          data-testid="notify-popover"
        >
          <div className="flex h-lg-control items-center gap-2 border-b border-border px-3">
            <h2 className="text-sm font-semibold text-fg-strong">通知</h2>
            {unread > 0 && <span className="text-xs text-fg-muted">{unread} 条未读</span>}
            <Button variant="ghost" size="sm" className="ml-auto text-xs" disabled={unread === 0 || unavailable} onClick={() => void markAllRead()} data-testid="notify-mark-all">
              <CheckCheck aria-hidden />
              全部已读
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto overflow-x-hidden py-1" tabIndex={0}>
            {unavailable ? (
              <EmptyState size="sm" icon={Bell} title={NOT_IMPLEMENTED_TITLE} reason="站内通知由 notify-audit-backend 单元实现（GET /api/notify 返回 501）。" data-testid="notify-empty" />
            ) : error && recent.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Bell}
                title="通知加载失败"
                reason={error}
                data-testid="notify-error"
                action={<Button variant="secondary" size="sm" onClick={() => void useStudio.getState().loadNotifications({ limit: 50 })}>重试</Button>}
              />
            ) : loading && recent.length === 0 ? (
              <ul className="space-y-1 px-3 py-2" aria-busy aria-label="加载中">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                  </li>
                ))}
              </ul>
            ) : recent.length === 0 ? (
              <EmptyState size="sm" icon={Inbox} title="暂无通知" reason="被 @ 提及、审阅指派、期限提醒与客户确认都会出现在这里。" data-testid="notify-empty" />
            ) : (
              <ul className={cn('px-1')} aria-label="最近通知" data-testid="notify-list">
                {recent.map((n) => (
                  <NotificationRow key={n.id} n={n} dense onOpen={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs"
              onClick={() => {
                setOpen(false)
                goInbox()
              }}
              data-testid="notify-all"
            >
              全部
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  )
}
