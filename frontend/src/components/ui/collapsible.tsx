import * as React from 'react'
import { FOCUS_RING, cn } from '@/lib/utils'

/** Collapsible：受控/非受控 open；Trigger 注入 aria-expanded / aria-controls；Content 关闭时不渲染 */
interface Ctx {
  open: boolean
  setOpen: (v: boolean) => void
  id: string
}
const CollapsibleContext = React.createContext<Ctx | null>(null)
const useCollapsible = () => {
  const ctx = React.useContext(CollapsibleContext)
  if (!ctx) throw new Error('Collapsible* 组件须放在 <Collapsible> 内')
  return ctx
}

export interface CollapsibleProps extends React.ComponentProps<'div'> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function Collapsible({ open: openProp, defaultOpen = false, onOpenChange, className, children, ...props }: CollapsibleProps) {
  const [inner, setInner] = React.useState(defaultOpen)
  const open = openProp ?? inner
  const id = React.useId()
  const setOpen = React.useCallback(
    (v: boolean) => {
      setInner(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )
  const ctx = React.useMemo(() => ({ open, setOpen, id: `collapsible-${id}` }), [open, setOpen, id])
  return (
    <CollapsibleContext.Provider value={ctx}>
      <div data-slot="collapsible" data-state={open ? 'open' : 'closed'} className={className} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  )
}

function CollapsibleTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { open, setOpen, id } = useCollapsible()
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      data-state={open ? 'open' : 'closed'}
      aria-expanded={open}
      aria-controls={id}
      className={cn('rounded-sm', FOCUS_RING, className)}
      onClick={(e) => {
        onClick?.(e)
        setOpen(!open)
      }}
      {...props}
    />
  )
}

function CollapsibleContent({ className, ...props }: React.ComponentProps<'div'>) {
  const { open, id } = useCollapsible()
  if (!open) return null
  return <div id={id} data-slot="collapsible-content" data-state="open" className={cn('animate-in fade-in-0', className)} {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
