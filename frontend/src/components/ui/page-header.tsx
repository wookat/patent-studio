import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * PageHeader（05 §2.1 / §3.1 非工作台页面头）：lg = 页级 H1 28/36（600，移动 24/32）；md = 紧凑 H1 24/32 + 可选 12px 面包屑 / 说明 + 右侧动作区。
 * 右侧最多一个 primary（`primary` 插槽），其余 secondary / ghost 放 `actions`；下缘 1px --border；页边 32（--spacing-page）/ 移动 16。
 * `sticky` 时吸顶（z-sticky，--bg-app）。`meta` 用于 StatusDot / Heat / Tag 行（详情页）。
 */
export interface PageHeaderProps extends Omit<React.ComponentProps<'header'>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  breadcrumb?: React.ReactNode
  meta?: React.ReactNode
  /** 唯一 primary 动作（<Button variant="primary"> 或 <SplitButton>） */
  primary?: React.ReactNode
  /** 次级动作（secondary / ghost） */
  actions?: React.ReactNode
  size?: 'md' | 'lg'
  sticky?: boolean
}

function PageHeader({ className, title, description, breadcrumb, meta, primary, actions, size = 'lg', sticky = false, children, ...props }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      data-size={size}
      className={cn(
        'flex flex-col gap-3 border-b border-border bg-app px-4 py-4 md:px-page-x md:py-5',
        sticky && 'sticky top-0 z-sticky',
        className,
      )}
      {...props}
    >
      {breadcrumb && <div data-slot="page-header-breadcrumb" className="text-xs text-fg-muted">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 data-slot="page-header-title" title={typeof title === 'string' ? title : undefined} className={cn('truncate font-semibold text-fg-strong', size === 'lg' ? 'text-2xl md:text-3xl' : 'text-2xl')}>{title}</h1>
          {description && <p data-slot="page-header-description" className="mt-1 text-base text-fg-muted">{description}</p>}
          {meta && <div data-slot="page-header-meta" className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {(primary || actions) && (
          <div data-slot="page-header-actions" className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {primary}
          </div>
        )}
      </div>
      {children}
    </header>
  )
}

export { PageHeader }
