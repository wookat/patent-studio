import * as React from 'react'
import { useIsDesktop } from '@/hooks/useMisc'
import { cn } from '@/lib/utils'

/**
 * Popover（无额外依赖的受控/非受控浮层）：Trigger 用 aria-expanded/aria-controls；Content 绝对定位在 Trigger 下方（side/align），
 * Esc / 点击外部关闭；焦点进入 Content 首个可聚焦元素（子元素挂载时已自行聚焦则不接管），关闭回到 Trigger。
 * 需要复杂定位（碰撞翻转）的场景请用 DropdownMenu。
 */
interface PopoverContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  id: string
  triggerRef: React.RefObject<HTMLElement | null>
}
const PopoverContext = React.createContext<PopoverContextValue | null>(null)
const usePopover = () => {
  const ctx = React.useContext(PopoverContext)
  if (!ctx) throw new Error('Popover* 组件须放在 <Popover> 内')
  return ctx
}

interface PopoverProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

function Popover({ open: openProp, defaultOpen = false, onOpenChange, children }: PopoverProps) {
  const [inner, setInner] = React.useState(defaultOpen)
  const open = openProp ?? inner
  const setOpen = React.useCallback(
    (v: boolean) => {
      setInner(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )
  const id = React.useId()
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const value = React.useMemo(() => ({ open, setOpen, id: `popover-${id}`, triggerRef }), [open, setOpen, id])
  return (
    <PopoverContext.Provider value={value}>
      <div data-slot="popover" className="relative inline-block">{children}</div>
    </PopoverContext.Provider>
  )
}

interface PopoverTriggerProps {
  /** 子元素须是单个可聚焦元素（如 <Button>）；注入 aria-* 与 onClick */
  children: React.ReactElement<Record<string, unknown>>
}

function PopoverTrigger({ children }: PopoverTriggerProps) {
  const { open, setOpen, id, triggerRef } = usePopover()
  const childOnClick = children.props.onClick as ((e: React.MouseEvent) => void) | undefined
  return React.cloneElement(children, {
    ref: triggerRef,
    'data-slot': 'popover-trigger',
    'data-state': open ? 'open' : 'closed',
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    'aria-controls': open ? id : undefined,
    onClick: (e: React.MouseEvent) => {
      childOnClick?.(e)
      setOpen(!open)
    },
  })
}

const POPOVER_FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

interface PopoverContentProps extends React.ComponentProps<'div'> {
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
}

function PopoverContent({ className, side = 'bottom', align = 'start', children, ...props }: PopoverContentProps) {
  const { open, setOpen, id, triggerRef } = usePopover()
  const ref = React.useRef<HTMLDivElement>(null)
  const touch = !useIsDesktop()

  React.useEffect(() => {
    if (!open) return
    const el = ref.current
    if (el && !el.contains(el.ownerDocument.activeElement)) {
      const focusable = el.querySelector<HTMLElement>(POPOVER_FOCUSABLE)
      ;(focusable ?? el).focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (el && !el.contains(t) && !triggerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, setOpen, triggerRef])

  if (!open) return null
  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      tabIndex={-1}
      data-slot="popover-content"
      data-side={side}
      data-align={align}
      data-density={touch ? 'touch' : undefined}
      className={cn(
        'absolute z-popover min-w-48 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95',
        side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
        align === 'start' && 'left-0',
        align === 'end' && 'right-0',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
