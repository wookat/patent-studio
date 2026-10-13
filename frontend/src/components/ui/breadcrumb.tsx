import * as React from 'react'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { FOCUS_RING, cn } from '@/lib/utils'

function Breadcrumb({ ...props }: React.ComponentProps<'nav'>) {
  return <nav aria-label="面包屑" data-slot="breadcrumb" {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return <ol data-slot="breadcrumb-list" className={cn('flex flex-wrap items-center gap-1 break-words text-xs text-muted-foreground', className)} {...props} />
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="breadcrumb-item" className={cn('inline-flex items-center gap-1', className)} {...props} />
}

function BreadcrumbLink({ className, ...props }: React.ComponentProps<'a'>) {
  return <a data-slot="breadcrumb-link" className={cn('rounded-sm transition-colors hover:text-foreground', FOCUS_RING, className)} {...props} />
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="breadcrumb-page" role="link" aria-disabled="true" aria-current="page" className={cn('font-medium text-foreground', className)} {...props} />
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn('[&>svg]:size-3.5', className)} {...props}>
      {children ?? <ChevronRight />}
    </li>
  )
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot="breadcrumb-ellipsis" role="presentation" aria-hidden="true" className={cn('flex size-5 items-center justify-center', className)} {...props}>
      <MoreHorizontal className="size-4" />
      <span className="sr-only">更多</span>
    </span>
  )
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis }
