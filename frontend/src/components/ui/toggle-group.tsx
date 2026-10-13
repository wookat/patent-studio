import * as React from 'react'
import { type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { toggleVariants } from './toggle'

/** ToggleGroup：type single（可空）/ multiple；子项 ToggleGroupItem value */
type Single = { type: 'single'; value?: string; defaultValue?: string; onValueChange?: (v: string) => void }
type Multiple = { type: 'multiple'; value?: string[]; defaultValue?: string[]; onValueChange?: (v: string[]) => void }

interface GroupContextValue extends VariantProps<typeof toggleVariants> {
  isOn: (v: string) => boolean
  toggle: (v: string) => void
  disabled?: boolean
}
const GroupContext = React.createContext<GroupContextValue | null>(null)

export type ToggleGroupProps = (Single | Multiple) &
  Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> &
  VariantProps<typeof toggleVariants> & { disabled?: boolean; 'aria-label'?: string }

function ToggleGroup(props: ToggleGroupProps) {
  const { className, variant, size, disabled, children, type, value, defaultValue, onValueChange, ...rest } = props as ToggleGroupProps & {
    value?: string | string[]
    defaultValue?: string | string[]
    onValueChange?: (v: never) => void
  }
  const [inner, setInner] = React.useState<string | string[] | undefined>(defaultValue ?? (type === 'multiple' ? [] : undefined))
  const current = value ?? inner
  const ctx = React.useMemo<GroupContextValue>(
    () => ({
      variant,
      size,
      disabled,
      isOn: (v) => (type === 'multiple' ? ((current as string[] | undefined) ?? []).includes(v) : current === v),
      toggle: (v) => {
        if (type === 'multiple') {
          const arr = (current as string[] | undefined) ?? []
          const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
          setInner(next)
          ;(onValueChange as ((v: string[]) => void) | undefined)?.(next)
        } else {
          const next = current === v ? '' : v
          setInner(next)
          ;(onValueChange as ((v: string) => void) | undefined)?.(next)
        }
      },
    }),
    [variant, size, disabled, type, current, onValueChange],
  )
  return (
    <GroupContext.Provider value={ctx}>
      <div role="group" data-slot="toggle-group" data-type={type} className={cn('inline-flex items-center gap-0.5 rounded-sm', className)} {...rest}>
        {children}
      </div>
    </GroupContext.Provider>
  )
}

export interface ToggleGroupItemProps extends Omit<React.ComponentProps<'button'>, 'value'> {
  value: string
}

function ToggleGroupItem({ className, value, disabled, ...props }: ToggleGroupItemProps) {
  const ctx = React.useContext(GroupContext)
  if (!ctx) throw new Error('ToggleGroupItem 须放在 <ToggleGroup> 内')
  const on = ctx.isOn(value)
  return (
    <button
      type="button"
      data-slot="toggle-group-item"
      data-state={on ? 'on' : 'off'}
      aria-pressed={on}
      disabled={disabled || ctx.disabled}
      className={cn(toggleVariants({ variant: ctx.variant, size: ctx.size }), className)}
      onClick={() => ctx.toggle(value)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
