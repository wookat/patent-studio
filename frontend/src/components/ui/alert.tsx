import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Alert：内联提示条（非 toast）；tone default / info / ok / warn / danger；danger 用 role=alert；文字取该族 fg（on bg ≥ 6:1，05 §1.4） */
const alertVariants = cva(
  'relative grid w-full gap-1 rounded-md border px-3 py-2.5 text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 [&>svg]:row-span-2 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'border-border bg-panel text-fg [&>svg]:text-fg-icon',
        info: 'border-info-dot/30 bg-info-bg text-info-fg [&>svg]:text-info-dot',
        ok: 'border-ok-dot/30 bg-ok-bg text-ok-fg [&>svg]:text-ok-dot',
        warn: 'border-warn-dot/40 bg-warn-bg text-warn-fg [&>svg]:text-warn-dot',
        danger: 'border-danger-dot/30 bg-danger-bg text-danger-fg [&>svg]:text-danger-dot',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={variant === 'danger' ? 'alert' : 'status'} className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-medium leading-tight', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-xs [&_p]:leading-relaxed', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
