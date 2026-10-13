import * as React from 'react'
import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn('text-xs font-medium leading-none text-muted-foreground peer-disabled:opacity-70', className)}
      {...props}
    />
  )
}

export { Label }
