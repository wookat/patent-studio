import { useEffect, type ReactNode } from 'react'
import { UserMenu } from '@/components/auth/UserMenu'
import { TopBarNotifyBell } from '@/components/notify/TopBarNotifyBell'
import { Toasts } from '@/components/shell/Toasts'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'
import { SkipLink } from '@/components/ui/skip-link'
import { DashNav, type DashNavKey } from './DashNav'

export interface OrgShellProps {
  /** data-testid：`page-<name>` / `<name>-header` */
  name: string
  /** document.title */
  title: string
  current: DashNavKey
  mobile: boolean
  /** 顶栏右侧（搜索框等）；铃铛 + 用户菜单固定 */
  topbar?: ReactNode
  /** 375 顶栏 44：整行自定义（标题 / 图标按钮）；缺省 = UserMenu + 标题 */
  mobileTopbar?: ReactNode
  /** 375 顶栏标题（缺省 title） */
  mobileTitle?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * 机构页共用壳（05 §3.2 / §4 S1）：案卷 · 期限 · 通知三页同一顶栏，与工作台壳互不挂载。
 * 1440：`--h-topbar` 40 顶栏（logo · DashNav · 右侧槽 · 铃铛 · 用户）+ 主区。
 * 375：`--h-mobile-topbar` 44 顶栏 + 主区 + 底 Tab 56（DashNav mobile）。
 */
export function OrgShell({ name, title, current, mobile, topbar, mobileTopbar, mobileTitle, className, children }: OrgShellProps) {
  useEffect(() => {
    document.title = `${title} · 知撰`
  }, [title])

  if (mobile) {
    return (
      <div data-slot="OrgShell" data-testid={`page-${name}`} className={cn('flex h-dvh flex-col bg-app text-fg', className)}>
        <SkipLink />
        <header className="flex h-mobile-topbar shrink-0 items-center gap-1 border-b border-border bg-panel px-2" data-testid={`${name}-header`}>
          {mobileTopbar ?? (
            <>
              <UserMenu />
              <h1 className="min-w-0 flex-1 truncate px-1 text-base font-semibold text-fg-strong" title={typeof mobileTitle === 'string' ? mobileTitle : title}>{mobileTitle ?? title}</h1>
            </>
          )}
        </header>
        <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={title}>
          {children}
        </main>
        <DashNav current={current} mobile />
        <Toasts />
      </div>
    )
  }

  return (
    <div data-slot="OrgShell" data-testid={`page-${name}`} className={cn('flex h-dvh flex-col bg-app text-fg', className)}>
      <SkipLink />
      <header className="flex h-topbar shrink-0 items-stretch gap-4 border-b border-border bg-app px-3" data-testid={`${name}-header`}>
        {/* logo 链接：视觉不变，整高占满顶栏 40 + `after:` 伪元素外扩 → 命中区 ≥ 44 */}
        <a
          href="#/"
          className={cn("relative inline-flex items-center gap-2 self-stretch text-primary after:absolute after:-inset-x-1 after:-inset-y-0.5 after:content-['']", FOCUS_RING_INSET)}
          aria-label="知撰首页"
          data-testid="org-home-link"
        >
          <img src="/logo-mark.svg" alt="" aria-hidden className="size-6 rounded-sm" />
          <span className="text-sm font-bold tracking-tight text-fg-strong">知撰</span>
        </a>
        <DashNav current={current} />
        <div className="ml-auto flex items-center gap-1">
          {topbar}
          <TopBarNotifyBell />
          <UserMenu />
        </div>
      </header>
      <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 outline-none">{children}</div>
      <Toasts />
    </div>
  )
}
