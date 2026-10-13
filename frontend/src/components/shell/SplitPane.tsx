import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  left: ReactNode
  right: ReactNode
  storageKey?: string
  min?: number
  className?: string
}

/** 桌面端可拖拽左右分栏（比例持久化到 localStorage）。 */
export function SplitPane({ left, right, storageKey = 'split', min = 0.2, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`patent-studio:${storageKey}`))
      return v > 0 && v < 1 ? v : 0.5
    } catch {
      /* 禁用 cookie / 存储被拦时 localStorage 抛 SecurityError——回默认比照常渲染 */
      return 0.5
    }
  })
  const dragging = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(`patent-studio:${storageKey}`, String(ratio))
    } catch {
      /* 隐私模式等：本会话内拖出的比例照样生效，只是不持久化 */
    }
  }, [ratio, storageKey])

  const onMove = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const r = (clientX - rect.left) / rect.width
      setRatio(Math.min(1 - min, Math.max(min, r)))
    },
    [min],
  )

  useEffect(() => {
    const mm = (e: MouseEvent) => dragging.current && onMove(e.clientX)
    const tm = (e: TouchEvent) => dragging.current && onMove(e.touches[0].clientX)
    const up = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('touchmove', tm)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('touchmove', tm)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchend', up)
      // 拖拽中组件被卸载（切视图等）：body 样式不能永远留在 col-resize/禁选状态
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [onMove])

  const start = () => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div ref={ref} className={cn('flex h-full min-h-0 w-full', className)}>
      <div style={{ width: `${ratio * 100}%` }} className="min-w-0 h-full">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整分栏"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round((1 - min) * 100)}
        aria-valuetext={`左栏 ${Math.round(ratio * 100)}%`}
        tabIndex={0}
        onMouseDown={start}
        onTouchStart={start}
        onDoubleClick={() => setRatio(0.5)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            setRatio((r) => (e.key === 'ArrowLeft' ? Math.max(min, r - 0.02) : Math.min(1 - min, r + 0.02)))
          }
        }}
        className="group relative z-sticky w-split-handle shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 focus-visible:bg-primary/60 focus-visible:outline-none"
        data-testid="split-handle"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      <div className="min-w-0 flex-1 h-full">{right}</div>
    </div>
  )
}
