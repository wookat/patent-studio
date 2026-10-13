import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useIsDesktop } from '@/hooks/useMisc'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { useFocusReturn } from './focus-return'

/**
 * Dialog（Radix）：size sm 400 / md 560（默认）/ lg 800；视口 < 640（max-sm）自动变全屏 Sheet（从底部滑入）。
 * 遮罩 z-overlay(40)，内容 z-popover(50)，圆角 --radius-lg，阴影 --shadow-lg。
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

const SIZE = { sm: 'sm:max-w-dialog-sm', md: 'sm:max-w-dialog-md', lg: 'sm:max-w-dialog-lg' } as const

interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  size?: keyof typeof SIZE
  hideClose?: boolean
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-overlay bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({ className, children, size = 'md', hideClose = false, ...props }: DialogContentProps) {
  const focusReturn = useFocusReturn(props)
  const touch = !useIsDesktop()
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        aria-modal="true"
        data-density={touch ? 'touch' : undefined}
        className={cn(
          'fixed z-popover grid gap-4 border bg-card p-5 text-card-foreground shadow-lg duration-(--dur-panel) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          // 移动端（<640）：全屏 Sheet，从底部滑入
          'max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:flex max-sm:flex-col max-sm:overflow-y-auto max-sm:rounded-none max-sm:pt-[calc(1.25rem+env(safe-area-inset-top))] max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom',
          // 桌面：居中卡片
          'sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
          SIZE[size],
          className,
        )}
        {...props}
        {...focusReturn}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn('absolute right-3 top-3 inline-flex size-sm-control items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 max-sm:top-[calc(0.75rem+env(safe-area-inset-top))]', FOCUS_RING, touchHit)}
            aria-label="关闭"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end max-sm:mt-auto max-sm:[&>button]:h-touch', className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
