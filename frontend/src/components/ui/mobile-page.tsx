import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * MobilePage（06 §3.2 ①）：375 页面纵向栈——页边 16（--pad-page-m）、区块间 24（--gap-section-m）、顶部 16，
 * 底部为 Tab bar（--h-mobile-tabs）+ 页边 + safe-area 让位；`tabbar={false}` 用于无底部 Tab bar 的页（客户审阅页 / 登录）。
 * 子元素即「区块」（标题 + 内容为一区块，区块内用 MobilePageSection 的 gap 8）。
 */
export interface MobilePageProps extends React.ComponentProps<'div'> {
  /** 底部是否为 Tab bar 让位（默认 true） */
  tabbar?: boolean
}

function MobilePage({ className, tabbar = true, ...props }: MobilePageProps) {
  return (
    <div
      data-slot="mobile-page"
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-section-m overflow-y-auto px-page-m pt-page-m',
        tabbar
          ? 'pb-[calc(var(--h-mobile-tabs)+var(--pad-page-m)+env(safe-area-inset-bottom))]'
          : 'pb-[calc(var(--pad-page-m)+env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  )
}

export interface MobilePageSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title?: React.ReactNode
  /** 标题右侧动作（sm 32 档） */
  action?: React.ReactNode
}

/** 区块：标题 13/500 与内容间 8（--gap-group-m）；内容为卡片列表时用 gap-cards-m 12 */
function MobilePageSection({ className, title, action, children, ...props }: MobilePageSectionProps) {
  return (
    <section data-slot="mobile-page-section" className={cn('flex min-w-0 flex-col gap-group-m', className)} {...props}>
      {(title || action) && (
        <header className="flex min-h-sm-control items-center justify-between gap-group-m">
          {title && <h2 className="truncate text-sm font-medium text-fg-strong" title={typeof title === 'string' ? title : undefined}>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export { MobilePage, MobilePageSection }
