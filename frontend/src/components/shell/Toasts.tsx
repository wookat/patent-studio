import { useStudio } from '@/store'
import { cn } from '@/lib/utils'

/** ui.toasts 渲染（桌面/移动共用） */
export function Toasts() {
  const toasts = useStudio((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center gap-1.5" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto rounded-sm px-3 py-1.5 text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2',
            t.kind === 'error' ? 'bg-danger-solid text-danger-solid-fg' : t.kind === 'success' ? 'bg-ok-fg text-fg-on-brand' : 'bg-fg text-panel',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
