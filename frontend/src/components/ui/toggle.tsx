import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'

/** Toggle：aria-pressed 按钮；variant default / outline；size sm 28 / md 32 / lg 36（触控 32 / 36 / 44 + touchHit 命中 ≥ 44，06 §2） */
const toggleVariants = cva(
  cn(
    touchHit,
    FOCUS_RING,
    'inline-flex items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-sm-control min-w-sm-control px-1.5 text-xs',
        md: 'h-md-control min-w-md-control px-2',
        lg: 'h-lg-control min-w-lg-control px-2.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ToggleProps extends Omit<React.ComponentProps<'button'>, 'onChange'>, VariantProps<typeof toggleVariants> {
  pressed?: boolean
  defaultPressed?: boolean
  onPressedChange?: (pressed: boolean) => void
}

function Toggle({ className, variant, size, pressed: pressedProp, defaultPressed = false, onPressedChange, onClick, ...props }: ToggleProps) {
  const [inner, setInner] = React.useState(defaultPressed)
  const pressed = pressedProp ?? inner
  return (
    <button
      type="button"
      data-slot="toggle"
      data-state={pressed ? 'on' : 'off'}
      aria-pressed={pressed}
      className={cn(toggleVariants({ variant, size }), className)}
      onClick={(e) => {
        onClick?.(e)
        setInner(!pressed)
        onPressedChange?.(!pressed)
      }}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
