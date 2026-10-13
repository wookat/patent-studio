import * as React from 'react'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'

/** Textarea（05 §2.2 / 06 §2.3）：与 Input 同边框 / 焦点 / 错误态；size md 14px（默认）/ lg 单行 44 档（移动表单）/ xl 16px；最小 3 行 */
export interface TextareaProps extends React.ComponentProps<'textarea'> {
  size?: 'md' | 'lg' | 'xl'
}

function Textarea({ className, size = 'md', ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      data-size={size}
      className={cn(
        'flex min-h-16 w-full rounded-md border border-border-strong bg-panel px-3 py-2 text-fg placeholder:text-placeholder hover:border-fg-subtle',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken disabled:text-fg-disabled',
        'aria-invalid:border-danger-fg aria-invalid:focus-visible:outline-danger-fg',
        size === 'xl' ? 'rounded-lg text-lg' : size === 'lg' ? 'min-h-lg-control text-base' : 'text-base',
        FOCUS_RING,
        TRANSITION_COLOR,
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
