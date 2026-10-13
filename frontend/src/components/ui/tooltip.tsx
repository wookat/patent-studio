import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { Kbd } from './kbd'

/** Tooltip（05 §2.10）：--bg-inverse / --fg-inverse，12/18，r4，sh-md，延迟 400ms；`shortcut` 追加 Kbd */
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

interface TooltipContentProps extends React.ComponentProps<typeof TooltipPrimitive.Content> {
  shortcut?: string[]
}

function TooltipContent({ className, sideOffset = 4, shortcut, children, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-popover inline-flex max-w-72 items-center gap-2 overflow-hidden rounded-sm bg-inverse px-2 py-1 text-xs text-fg-inverse shadow-md animate-in fade-in-0 zoom-in-95 duration-(--dur-fast)',
          className,
        )}
        {...props}
      >
        {children}
        {shortcut && <Kbd keys={shortcut} className="border-fg-inverse/30 bg-transparent text-fg-inverse/80" />}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
