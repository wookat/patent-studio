import * as React from 'react'
import { FOCUS_RING, cn } from '@/lib/utils'

/** RadioGroup（role=radiogroup + role=radio 按钮；方向键循环、受控 value / onValueChange） */
interface RadioContextValue {
  value: string | undefined
  setValue: (v: string) => void
  name: string
  disabled?: boolean
}
const RadioContext = React.createContext<RadioContextValue | null>(null)

export interface RadioGroupProps extends Omit<React.ComponentProps<'div'>, 'onChange' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  disabled?: boolean
  orientation?: 'vertical' | 'horizontal'
}

function RadioGroup({ className, value: valueProp, defaultValue, onValueChange, name, disabled, orientation = 'vertical', children, ...props }: RadioGroupProps) {
  const [inner, setInner] = React.useState(defaultValue)
  const value = valueProp ?? inner
  const autoName = React.useId()
  const setValue = React.useCallback(
    (v: string) => {
      setInner(v)
      onValueChange?.(v)
    },
    [onValueChange],
  )
  const ctx = React.useMemo(() => ({ value, setValue, name: name ?? autoName, disabled }), [value, setValue, name, autoName, disabled])
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']
    if (!keys.includes(e.key)) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)'))
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const next = items[(i + dir + items.length) % items.length]
    next.focus()
    next.click()
  }
  return (
    <RadioContext.Provider value={ctx}>
      <div
        role="radiogroup"
        data-slot="radio-group"
        aria-orientation={orientation}
        className={cn('grid gap-2', orientation === 'horizontal' && 'grid-flow-col auto-cols-max', className)}
        onKeyDown={onKeyDown}
        {...props}
      >
        {children}
      </div>
    </RadioContext.Provider>
  )
}

export interface RadioGroupItemProps extends Omit<React.ComponentProps<'button'>, 'value'> {
  value: string
}

function RadioGroupItem({ className, value, disabled, ...props }: RadioGroupItemProps) {
  const ctx = React.useContext(RadioContext)
  if (!ctx) throw new Error('RadioGroupItem 须放在 <RadioGroup> 内')
  const checked = ctx.value === value
  const isDisabled = disabled || ctx.disabled
  return (
    <button
      type="button"
      role="radio"
      data-slot="radio-group-item"
      data-state={checked ? 'checked' : 'unchecked'}
      aria-checked={checked}
      disabled={isDisabled}
      tabIndex={checked || ctx.value === undefined ? 0 : -1}
      className={cn(
        FOCUS_RING,
        'aspect-square size-4 rounded-full border border-input bg-background shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary',
        className,
      )}
      onClick={() => ctx.setValue(value)}
      {...props}
    >
      {checked && <span className="block size-full scale-50 rounded-full bg-primary" aria-hidden />}
    </button>
  )
}

export { RadioGroup, RadioGroupItem }
