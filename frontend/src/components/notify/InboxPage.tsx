import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bell, CheckCheck, Construction, Inbox, RefreshCw } from 'lucide-react'
import { OrgShell } from '@/components/dashboard/OrgShell'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { MobilePage } from '@/components/ui/mobile-page'
import { PageHeader } from '@/components/ui/page-header'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMisc'
import { usePageScroll } from '@/hooks/usePageScroll'
import { useStudio } from '@/store'
import { cn } from '@/lib/utils'
import { ApprovalsInbox, ProposalsInbox } from '@/components/platform/PlatformInbox'
import { NotificationRow } from './NotificationRow'

type InboxFilter = 'all' | 'unread'
/** M2：收件箱页签——通知（旧 /api/notify 双源在此页内仍走原 store）｜审批｜提案（/api/v1） */
type InboxTab = 'notify' | 'approvals' | 'proposals'

const TABS = [
  { value: 'notify', label: '通知', 'data-testid': 'inbox-tab-notify' },
  { value: 'approvals', label: '审批', 'data-testid': 'inbox-tab-approvals' },
  { value: 'proposals', label: '提案', 'data-testid': 'inbox-tab-proposals' },
] as const

const FILTERS = [
  { value: 'all', label: '全部', 'data-testid': 'inbox-filter-all' },
  { value: 'unread', label: '未读', 'data-testid': 'inbox-filter-unread' },
] as const

/** `#/inbox?tab=`：解析页签（未知值回落 notify） */
const readInboxTab = (): InboxTab => {
  const t = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab')
  return t === 'approvals' || t === 'proposals' ? t : 'notify'
}
const writeInboxTab = (tab: InboxTab) => {
  const target = tab === 'notify' ? '#/inbox' : `#/inbox?tab=${tab}`
  if (window.location.hash !== target) window.location.hash = target.replace(/^#/, '')
}

/** 375 空态（06 §3.2）：图标 / 标题 / 文案间 8（gap-group-m），纵向 24（py-section-m），页边 16 */
const MOBILE_EMPTY = 'gap-group-m px-page-m py-section-m'

/**
 * `#/inbox` 通知（05 §4）：机构壳 + `PageHeader` H1「通知」（无 primary：「全部已读」是 ghost）→ 全部 / 未读 Segmented → 行 48 列表。
 * 行 = 类型图标（7 类 · 6 语义色族）· 标题（未读粗体）· 正文 · 相对时间 · 未读点 `--info-dot`；点击跳 hash 契约落点并标已读。
 * 四态：501 → EmptyState「功能开发中」；错误 → 重试；加载 → Skeleton；空 → 说明。
 * 375（06 §4 通知）：顶栏 44 → MobilePage：`Segmented md 全部|未读` + 右侧全部已读 icon-md 36（命中 touchHit ≥ 44）→ 列表出血到页边，行 ≥ 48；空态 gap 8 / 纵向 24。
 */
export function InboxPage() {
  const items = useStudio((s) => s.notifications)
  const unreadItems = useStudio((s) => s.unreadNotifications)
  const unread = useStudio((s) => s.unreadCount)
  const loading = useStudio((s) => s.notifyLoading)
  const unavailable = useStudio((s) => s.notifyUnavailable)
  const error = useStudio((s) => s.notifyError)
  const hasMore = useStudio((s) => s.notifyHasMore)
  const moreLoading = useStudio((s) => s.notifyMoreLoading)
  const unreadHasMore = useStudio((s) => s.unreadHasMore)
  const unreadMoreLoading = useStudio((s) => s.unreadMoreLoading)
  const unreadLoading = useStudio((s) => s.unreadLoading)
  const load = useStudio((s) => s.loadNotifications)
  const loadMore = useStudio((s) => s.loadMoreNotifications)
  const loadUnread = useStudio((s) => s.loadUnreadNotifications)
  const loadMoreUnread = useStudio((s) => s.loadMoreUnread)
  const authed = useStudio((s) => s.authStatus === 'authed')
  const markAllRead = useStudio((s) => s.markAllRead)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [tab, setTabState] = useState<InboxTab>(readInboxTab)
  const isDesktop = useIsDesktop()
  const mobile = !isDesktop

  // `#/inbox?tab=` ↔ state：hashchange 为真源（深链/后退），切页签回写 hash
  useEffect(() => {
    const onHash = () => setTabState(readInboxTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const setTab = (t: InboxTab) => writeInboxTab(t)

  /** 未登录（off / anon / unknown）时后端没有收件人，GET /api/notify 永远为空，不发；页面直接落空态 */
  useEffect(() => {
    if (authed && tab === 'notify') void load({ limit: 100 })
  }, [authed, tab, load])

  /** 「未读」页签走专属流仓（unreadNotifications）——每次切入都重拉首页，保证与轮询刷新的 all 流同新鲜度 */
  useEffect(() => {
    if (authed && tab === 'notify' && filter === 'unread') void loadUnread()
  }, [authed, tab, filter, loadUnread])

  const shown = filter === 'unread' ? unreadItems : items
  const shownHasMore = filter === 'unread' ? unreadHasMore : hasMore
  const shownMoreLoading = filter === 'unread' ? unreadMoreLoading : moreLoading
  const shownLoading = filter === 'unread' ? unreadLoading : loading

  /* 通知点进案卷再回来把列表位置写回（会话内存）；mobile 走页面级滚动，ref 不存在时空操作 */
  const bodyWrap = useRef<HTMLDivElement>(null)
  const resolveScroller = useCallback(() => bodyWrap.current, [])
  usePageScroll('inbox', !(loading && items.length === 0), resolveScroller)

  let body: ReactNode
  if (unavailable) {
    body = <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="站内通知（@ 提及 / 指派 / 期限 / 客户确认 / AI 完成）的后端接口尚未上线，稍后再来看看。" data-testid="inbox-empty" />
  } else if (error && items.length === 0) {
    body = (
      <EmptyState
        icon={Bell}
        title="通知加载失败"
        reason={error}
        action={
          <Button variant="secondary" onClick={() => void load({ limit: 100 })} data-testid="inbox-retry">
            <RefreshCw aria-hidden />
            重试
          </Button>
        }
        data-testid="inbox-error"
      />
    )
  } else if (shownLoading && shown.length === 0) {
    body = (
      <ul className="flex flex-col" aria-busy="true" aria-label="加载中" data-testid="inbox-loading">
        {Array.from({ length: mobile ? 5 : 8 }).map((_, i) => (
          <li key={i} className={cn('flex h-row-mobile items-center gap-3 border-b border-border px-4', !mobile && 'px-page-x')}>
            <Skeleton className="size-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    )
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        illustration={filter === 'all' && !mobile ? '/empty-inbox.webp' : undefined}
        title={filter === 'unread' ? '没有未读通知' : '暂无通知'}
        reason={filter === 'unread' ? '所有通知都已处理。' : '被 @ 提及、审阅指派、期限提醒与客户确认都会出现在这里。'}
        className={mobile ? MOBILE_EMPTY : undefined}
        data-testid="inbox-empty"
      />
    )
  } else {
    body = (
      <>
        <ul className="divide-y divide-border" aria-label="通知列表" data-testid="inbox-list">
          {shown.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
        {shownHasMore && (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              variant="secondary"
              size="sm"
              loading={shownMoreLoading}
              loadingLabel="正在加载"
              onClick={() => void (filter === 'unread' ? loadMoreUnread() : loadMore())}
              data-testid="inbox-load-more"
            >
              加载更早通知
            </Button>
          </div>
        )}
      </>
    )
  }

  const markAll = (
    <Button variant="ghost" size={mobile ? 'icon-md' : 'sm'} disabled={unread === 0 || unavailable} onClick={() => void markAllRead()} data-testid="inbox-mark-all">
      <CheckCheck aria-hidden />
      <span className={mobile ? 'sr-only' : undefined}>全部已读</span>
    </Button>
  )
  const unreadText = (
    <span data-testid="inbox-unread-count">{unread > 0 ? `${unread} 条未读` : '全部已读'}</span>
  )

  const tabBody = tab === 'approvals' ? <ApprovalsInbox /> : tab === 'proposals' ? <ProposalsInbox /> : body

  if (mobile) {
    return (
      <OrgShell name="inbox" title="通知" current="inbox" mobile mobileTitle={<>通知 <span className="font-normal text-fg-muted">{unreadText}</span></>}>
        <MobilePage data-testid="inbox-page" className="gap-group-m">
          <div className="flex shrink-0 items-center gap-group-m" data-testid="inbox-toolbar">
            <Segmented aria-label="收件箱页签" size="md" options={TABS} value={tab} onValueChange={setTab} className="flex-1" />
            {tab === 'notify' && markAll}
          </div>
          {tab === 'notify' && (
            <div className="flex shrink-0 items-center gap-group-m">
              <Segmented aria-label="通知筛选" size="md" options={FILTERS} value={filter} onValueChange={setFilter} className="flex-1" />
            </div>
          )}
          <div className="-mx-page-m flex min-w-0 flex-col bg-panel" data-testid="inbox-body">
            {tabBody}
          </div>
        </MobilePage>
      </OrgShell>
    )
  }

  return (
    <OrgShell name="inbox" title="通知" current="inbox" mobile={false}>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-panel" aria-label="通知">
        <PageHeader
          size="lg"
          title="通知"
          description={tab === 'notify' ? unreadText : undefined}
          className="bg-panel py-4 md:py-4"
          actions={
            <>
              <Segmented aria-label="收件箱页签" size="sm" options={TABS} value={tab} onValueChange={setTab} />
              {tab === 'notify' && (
                <>
                  <Segmented aria-label="通知筛选" size="sm" options={FILTERS} value={filter} onValueChange={setFilter} />
                  {markAll}
                </>
              )}
            </>
          }
        />
        <div ref={bodyWrap} className="min-h-0 flex-1 overflow-y-auto border-t border-border">{tabBody}</div>
      </main>
    </OrgShell>
  )
}
