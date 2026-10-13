import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { FOCUS_RING, cn } from '@/lib/utils'

/**
 * Toast（纯样式；状态源沿用 store/ui.ts `toasts` + shell/Toasts.tsx 渲染）：
 * 四类 info / success / warning / error；error 用 aria-live=assertive，其余 polite；≤1 个 action。
 */
export type ToastKind = 'info' | 'success' | 'warning' | 'error'

const toastVariants = cva(
  'pointer-events-auto flex min-h-lg-control max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 sm:max-w-form',
  {
    variants: {
      kind: {
        info: 'border-transparent bg-foreground text-background',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-warning-foreground/30 bg-warning-soft text-warning-foreground',
        error: 'border-transparent bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { kind: 'info' },
  },
)

const ICON: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
}

export interface ToastProps extends React.ComponentProps<'div'>, VariantProps<typeof toastVariants> {
  kind?: ToastKind
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
}

function Toast({ className, kind = 'info', action, onDismiss, children, ...props }: ToastProps) {
  const Icon = ICON[kind]
  return (
    <div
      data-slot="toast"
      data-kind={kind}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={cn(toastVariants({ kind }), className)}
      {...props}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action && (
        <button type="button" className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium underline-offset-2 hover:underline', FOCUS_RING)} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className={cn('shrink-0 rounded-sm p-0.5 opacity-70 hover:opacity-100', FOCUS_RING)} onClick={onDismiss} aria-label="关闭" title="关闭">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** 固定底部居中的 toast 容器 */
function ToastViewport({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="toast-viewport"
      className={cn('pointer-events-none fixed inset-x-0 bottom-10 z-toast flex flex-col items-center gap-1.5 px-4 max-lg:bottom-[calc(var(--h-mobile-tabs)+0.5rem)]', className)}
      {...props}
    />
  )
}

export { Toast, ToastViewport, toastVariants }
