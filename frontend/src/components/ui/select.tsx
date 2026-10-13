import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useIsDesktop } from '@/hooks/useMisc'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'

/**
 * Select（05 §2.2；Radix，tokenized 自定义菜单 —— 全站禁原生 <select>）：Trigger 4 档 sm 28 / md 32（默认）/ lg 36 / xl 44；
 * 菜单 --bg-elevated + --sh-md + r8；项高 32（touch 密度下 44）；选中项 ✓ + --bg-selected。
 */
const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value
const SelectGroup = SelectPrimitive.Group

const TRIGGER_SIZE = {
  sm: 'h-sm-control rounded-sm text-xs',
  md: 'h-md-control rounded-md text-base',
  lg: 'h-lg-control rounded-md text-base',
  xl: 'h-touch rounded-lg text-lg',
} as const
export type SelectSize = keyof typeof TRIGGER_SIZE

interface SelectTriggerProps extends React.ComponentProps<typeof SelectPrimitive.Trigger> {
  size?: SelectSize
}

function SelectTrigger({ className, children, size = 'md', ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'flex w-full items-center justify-between gap-2 whitespace-nowrap border border-border-strong bg-panel px-3 text-fg hover:border-fg-subtle data-[placeholder]:text-placeholder [&>span]:truncate',
        // 触控：Select 一律 lg 44（06 §2.3），并加 touchHit 兜底
        'in-data-[density=touch]:h-lg-control',
        touchHit,
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken disabled:text-fg-disabled aria-invalid:border-danger-fg',
        TRIGGER_SIZE[size],
        FOCUS_RING,
        TRANSITION_COLOR,
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-fg-icon" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, children, position = 'popper', ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const touch = !useIsDesktop()
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        data-density={touch ? 'touch' : undefined}
        className={cn(
          'relative z-popover max-h-80 min-w-32 overflow-hidden rounded-lg border bg-elevated text-fg shadow-md animate-in fade-in-0 zoom-in-95 duration-(--dur-fast)',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width) data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex h-row-menu w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2.5 pr-8 text-base outline-none',
        'focus:bg-hover data-[state=checked]:bg-selected data-[state=checked]:text-fg-strong data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-link" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn('px-2.5 py-1.5 text-2xs font-medium uppercase tracking-wide text-fg-muted', className)} {...props} />
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export { Select, SelectValue, SelectGroup, SelectTrigger, SelectContent, SelectItem, SelectLabel, SelectSeparator }
