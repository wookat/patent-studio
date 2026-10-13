import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { useIsDesktop } from '@/hooks/useMisc'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { useFocusReturn } from './focus-return'

/**
 * Sheet（05 §2.8；合并原 bottom-drawer）：基于 @radix-ui/react-dialog 的抽屉。
 * side = right（360 = --w-companion，伴随栏 <768 的落点）| left（导航 280 = --w-drawer）| bottom（≤85dvh、r12 顶角、36×4 抓手、项高 48）| full | fullRight。
 * 表面 --bg-elevated + --sh-lg；遮罩 z-overlay(40)、内容 z-popover(50)；200ms panel 动效（reduced-motion → 0）。
 */
const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

/**
 * Esc 只收最内层：目标落在 `[data-esc-local]` 内（输入有草稿 / 局部表单打开）时否决 Radix 的关闭，
 * 由该元素自己的 onKeyDown 完成取消。Radix 在 document 捕获阶段判 defaultPrevented，元素上的 stopPropagation / preventDefault 都来不及，只能在这里拦。
 */
function escapeStaysLocal(event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest('[data-esc-local]')) event.preventDefault()
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-overlay bg-inverse/40 duration-(--dur-panel) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

const sheetVariants = cva(
  'fixed z-popover flex flex-col gap-0 bg-elevated text-fg shadow-lg ease-(--ease-panel) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-(--dur-panel) data-[state=open]:duration-(--dur-panel)',
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 h-full w-[85vw] max-w-drawer border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        right: 'inset-y-0 right-0 h-full w-[90vw] max-w-companion border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        full: 'inset-0 h-full w-full data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        fullRight: 'inset-0 h-full w-full data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
      },
    },
    defaultVariants: { side: 'right' },
  },
)


interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /** 隐藏右上角关闭按钮（full 模式通常用自带顶栏；bottom 默认用抓手） */
  hideClose?: boolean
  /** bottom 时顶部 36×4 抓手（默认开） */
  handle?: boolean
}

function SheetContent({ side = 'right', className, children, hideClose, handle, onEscapeKeyDown, ...props }: SheetContentProps) {
  const showHandle = handle ?? side === 'bottom'
  const showClose = !(hideClose ?? side === 'bottom')
  const focusReturn = useFocusReturn(props)
  // portal 脱出壳的 data-density=touch 祖先链：非桌面断点默认补回，调用方显式传值优先（R82-01）
  const touch = !useIsDesktop()
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-density={touch ? 'touch' : undefined}
        className={cn(sheetVariants({ side }), className)}
        onEscapeKeyDown={(e) => {
          escapeStaysLocal(e)
          onEscapeKeyDown?.(e)
        }}
        {...props}
        {...focusReturn}
      >
        {showHandle && <div data-slot="sheet-handle" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border-strong" aria-hidden />}
        {children}
        {showClose && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            className={cn('absolute right-2 top-2 inline-flex size-sm-control items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg-strong max-md:size-touch', FOCUS_RING, TRANSITION_COLOR)}
            aria-label="关闭"
          >
            <X className="size-4" aria-hidden />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="sheet-header" className={cn('flex min-h-panel-header flex-col justify-center gap-0.5 border-b border-border px-4 py-2 text-left', className)} {...props} />
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-row justify-end gap-2 border-t border-border px-4 py-3', className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn('text-lg font-medium text-fg-strong', className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-fg-muted', className)} {...props} />
}

/**
 * BottomDrawer（移动端底部抽屉 = Sheet side="bottom" 的便捷包装；原 bottom-drawer.tsx 现 re-export 本组件）：
 * snap 'half'（≤50dvh）/ 'full'（85dvh）；项高 48 由内容自带（`h-row-menu` 在 touch 密度下为 44+）。
 */
export interface BottomDrawerProps extends React.ComponentProps<typeof Sheet> {
  title: string
  description?: string
  snap?: 'half' | 'full'
  className?: string
  children: React.ReactNode
  'data-testid'?: string
}

function BottomDrawer({ title, description, snap = 'half', className, children, 'data-testid': testId, ...props }: BottomDrawerProps) {
  return (
    <Sheet {...props}>
      <SheetContent
        side="bottom"
        data-slot="bottom-drawer"
        data-snap={snap}
        data-testid={testId}
        className={cn('flex flex-col', snap === 'half' ? 'max-h-[50dvh]' : 'max-h-[85dvh]', className)}
      >
        <SheetHeader className="border-b-0 py-1">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

export {
  Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, BottomDrawer,
  sheetVariants,
}
