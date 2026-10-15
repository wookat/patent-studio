import { useEffect, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { UserMenu } from '@/components/auth/UserMenu'
import { Toasts } from '@/components/shell/Toasts'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { useIsDesktop } from '@/hooks/useMisc'
import { SkipLink } from '@/components/ui/skip-link'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'

/**
 * 非工作台页面容器（05 §3.1 / §4）：顶栏 h-topbar（返回 · 品牌 · 右侧动作 · 用户菜单）+ 居中 --max-page 内容列
 * （PageHeader H1 28 + 页边 px-page-x）+ 可选底部粘性动作条（375 递交页）+ Toasts。
 * 账号 / 机构 / 期限 / 收件箱 / 递交 / 客户确认页共用；工作台壳（DesktopShell / MobileShell）不用它。
 * `anonymous`：公开页（#/c/<token>）不渲染 UserMenu。
 * 375（06 §2.3 / §3.2）：顶栏返回键 sm 32（命中区由 touchHit 补到 44）；有底部动作条时内容底部留 16（pb-4），否则 24。
 */
export interface PageChromeProps {
  /** data-testid 前缀：`page-<name>` / `<name>-topbar` / `<name>-header` / `<name>-back` */
  name: string
  /** H1 文案（案名 / 页面名，永不用目录 id） */
  title: ReactNode
  /** document.title 用的纯文本（title 非字符串时必填） */
  documentTitle?: string
  description?: ReactNode
  breadcrumb?: ReactNode
  /** StatusDot / Badge / Countdown 行 */
  meta?: ReactNode
  /** 唯一 primary（一屏一个） */
  primary?: ReactNode
  /** 次级动作（secondary / ghost），落在 PageHeader 右侧 */
  actions?: ReactNode
  /** 顶栏右侧（UserMenu 左边）的小动作 */
  topbarActions?: ReactNode
  /** 返回目标；null = 不显示返回键 */
  backHref?: string | null
  backLabel?: string
  anonymous?: boolean
  /** 内容列宽：page = --max-page（默认）/ form = --max-form / full = 不限 */
  width?: 'page' | 'form' | 'full'
  /** 底部粘性动作条（移动端 primary） */
  footer?: ReactNode
  /** 主区 class */
  mainClassName?: string
  /** PageHeader 之下的补充内容（步骤条 / Tabs） */
  headerChildren?: ReactNode
  children: ReactNode
}

const WIDTH: Record<NonNullable<PageChromeProps['width']>, string> = {
  page: 'max-w-page',
  form: 'max-w-form',
  full: '',
}

export function PageChrome({
  name,
  title,
  documentTitle,
  description,
  breadcrumb,
  meta,
  primary,
  actions,
  topbarActions,
  backHref = '#/',
  backLabel = '返回案卷',
  anonymous,
  width = 'page',
  footer,
  mainClassName,
  headerChildren,
  children,
}: PageChromeProps) {
  const isDesktop = useIsDesktop()
  const docTitle = documentTitle ?? (typeof title === 'string' ? title : '知撰')
  useEffect(() => {
    document.title = `${docTitle} · 知撰`
  }, [docTitle])
  return (
    <div data-slot="page" data-testid={`page-${name}`} className="flex h-dvh flex-col bg-app text-fg">
      <SkipLink />
      <header className="flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-panel px-2 md:px-4" data-testid={`${name}-topbar`}>
        {backHref && (
          <Button asChild variant="ghost" size={isDesktop ? 'icon-md' : 'icon-sm'} className="shrink-0">
            <a href={backHref} aria-label={backLabel} data-testid={`${name}-back`}>
              <ArrowLeft aria-hidden />
            </a>
          </Button>
        )}
        <a
          href="#/"
          className={cn(
            touchHit,
            FOCUS_RING, 'inline-flex items-center justify-center gap-2 rounded-sm px-2 text-link',
            isDesktop ? 'h-md-control min-w-md-control' : 'h-sm-control min-w-sm-control',
          )}
          aria-label="知撰首页"
          data-testid={`${name}-home`}
        >
          <img src="/logo-mark.svg" alt="" aria-hidden className="size-6 rounded-sm" />
          <span className="hidden text-sm font-semibold text-fg-strong sm:inline">知撰</span>
        </a>
        <div className="ml-auto flex items-center gap-1">
          {topbarActions}
          {!anonymous && <UserMenu />}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={cn('min-h-0 flex-1 overflow-auto outline-none', mainClassName)}>
        <div className={cn('mx-auto w-full', WIDTH[width])}>
          <PageHeader
            title={title}
            description={description}
            breadcrumb={breadcrumb}
            meta={meta}
            primary={primary}
            actions={actions}
            className="border-b-0 pb-0 md:pb-0 md:[&_[data-slot=page-header-title]]:text-3xl"
            data-testid={`${name}-header`}
          >
            {headerChildren}
          </PageHeader>
          <div className={cn('px-4 pt-4 md:px-page-x md:pt-5', footer ? 'pb-4 md:pb-6' : 'pb-6')} data-testid={`${name}-body`}>
            {children}
          </div>
        </div>
      </main>
      {footer && (
        <div
          className="sticky bottom-0 z-sticky flex h-16 shrink-0 items-center gap-2 border-t border-border bg-panel px-4 pb-[env(safe-area-inset-bottom)]"
          data-testid={`${name}-footer`}
        >
          {footer}
        </div>
      )}
      <Toasts />
    </div>
  )
}
