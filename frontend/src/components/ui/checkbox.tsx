import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import { FOCUS_RING, cn } from '@/lib/utils'

/** Checkbox（button role=checkbox；受控 checked / onCheckedChange；支持 'indeterminate'） */
export interface CheckboxProps extends Omit<React.ComponentProps<'button'>, 'onChange' | 'value'> {
  checked?: boolean | 'indeterminate'
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  name?: string
  value?: string
}

function Checkbox({ className, checked: checkedProp, defaultChecked = false, onCheckedChange, disabled, name, value, ...props }: CheckboxProps) {
  const [inner, setInner] = React.useState<boolean>(defaultChecked)
  const checked = checkedProp ?? inner
  const state = checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked'
  return (
    <button
      type="button"
      role="checkbox"
      data-slot="checkbox"
      data-state={state}
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      disabled={disabled}
      className={cn(
        // 触控密度：视觉 16 不变；after 以 padding box（14，border 1）为基准外扩 16 → 46×46 热区
        "in-data-[density=touch]:after:absolute in-data-[density=touch]:after:-inset-4 in-data-[density=touch]:after:content-['']",
        FOCUS_RING,
        'peer relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground aria-invalid:border-destructive',
        className,
      )}
      onClick={() => {
        const next = checked === 'indeterminate' ? true : !checked
        setInner(next)
        onCheckedChange?.(next)
      }}
      {...props}
    >
      {state === 'checked' && <Check className="size-3.5" aria-hidden />}
      {state === 'indeterminate' && <Minus className="size-3.5" aria-hidden />}
      {name && <input type="hidden" name={name} value={checked === true ? (value ?? 'on') : ''} />}
    </button>
  )
}

export { Checkbox }
