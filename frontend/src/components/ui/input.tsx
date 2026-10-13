import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'

/**
 * Input（05 §2.2）：4 档 sm 28 / md 32（默认）/ lg 36 / xl 44（xl = 16px 字：登录页、移动防缩放）。
 * 1px --border-strong；hover 边加深；焦点 2px --ring；aria-invalid → --danger 边 + 行内错误文字（Field 提供）；禁用 --bg-sunken。
 * 圆角随尺寸：28→4，32–36→6，44→8。
 */
const inputVariants = cva(
  cn(
    'flex w-full min-w-0 border border-border-strong bg-panel px-3 text-fg placeholder:text-placeholder file:border-0 file:bg-transparent file:font-medium hover:border-fg-subtle',
    // 触控：Input 一律 lg 44（06 §2.3；替换元素无 ::after，只能视觉 44）
    'in-data-[density=touch]:h-lg-control',
    'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken disabled:text-fg-disabled',
    'aria-invalid:border-danger-fg aria-invalid:focus-visible:outline-danger-fg',
    FOCUS_RING,
    TRANSITION_COLOR,
  ),
  {
    variants: {
      size: {
        sm: 'h-sm-control rounded-sm text-xs',
        md: 'h-md-control rounded-md text-base',
        lg: 'h-lg-control rounded-md text-base',
        xl: 'h-touch rounded-lg text-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'>, VariantProps<typeof inputVariants> {}

function Input({ className, type, size, ...props }: InputProps) {
  return <input data-slot="input" data-size={size ?? 'md'} type={type} className={cn(inputVariants({ size }), className)} {...props} />
}

export { Input, inputVariants }
