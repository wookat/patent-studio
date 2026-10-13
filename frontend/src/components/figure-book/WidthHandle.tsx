import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { FIG_WIDTH_MAX, FIG_WIDTH_MIN, clampFigWidth } from '@/store/figuresBook'
import { cn } from '@/lib/utils'

export interface WidthHandleProps {
  /** 当前宽度 cm（figures.md 的 width） */
  value: number
  /** 卡片缩略图容器代表的 cm → px 比例；拖 Δpx / pxPerCm = Δcm */
  pxPerCm: number
  /** 拖拽 / 键盘过程中实时回调（只改本地预览），松手 / 键盘每步提交 */
  onPreview?(width: number): void
  onCommit(width: number): void
  disabled?: boolean
  /** aria-label 前缀，如「图3 宽度」 */
  label: string
  className?: string
}

/**
 * 图片右缘宽度手柄（15 §4.2；借鉴 Word 图片八点手柄中的右中点：横向拖改宽、等比高随之变）。
 * - 指针：pointerdown 捕获 → move 换算 cm（0.5 步进、夹 2–17）→ up 提交一次 PUT
 * - 键盘：role=slider，←/→ ±0.5，Shift ±2，Home/End 到边界；每步即提交（读屏立刻听到新值）
 * - 375：手柄命中区 44px（触摸目标），视觉条 8px
 */
export function WidthHandle({ value, pxPerCm, onPreview, onCommit, disabled, label, className }: WidthHandleProps) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: value }
    setDragging(value)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || pxPerCm <= 0) return
    const w = clampFigWidth(start.current.w + (e.clientX - start.current.x) / pxPerCm)
    if (w !== dragging) {
      setDragging(w)
      onPreview?.(w)
    }
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const w = dragging ?? value
    start.current = null
    setDragging(null)
    if (w !== value) onCommit(w)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = e.shiftKey ? 2 : 0.5
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'Home') next = FIG_WIDTH_MIN
    else if (e.key === 'End') next = FIG_WIDTH_MAX
    if (next == null) return
    e.preventDefault()
    const w = clampFigWidth(next)
    if (w !== value) onCommit(w)
  }

  const shown = dragging ?? value
  return (
    <div
      data-slot="WidthHandle"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${label}（厘米）`}
      aria-valuemin={FIG_WIDTH_MIN}
      aria-valuemax={FIG_WIDTH_MAX}
      aria-valuenow={shown}
      aria-valuetext={`${shown} 厘米`}
      aria-disabled={disabled || undefined}
      aria-orientation="horizontal"
      className={cn(
        'absolute top-1/2 -translate-y-1/2 flex h-11 w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none',
        'focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring/60',
        disabled && 'cursor-default opacity-40',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      data-dragging={dragging != null || undefined}
    >
      <span className={cn('block h-8 w-2 rounded-full border bg-panel shadow-sm', dragging != null && 'bg-primary')} aria-hidden />
    </div>
  )
}
