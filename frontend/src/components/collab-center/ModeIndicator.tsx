import { ChevronDown, Eye, MessageSquareDiff, PencilLine } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { FOCUS_RING, cn } from '@/lib/utils'
import { EDITOR_MODE_LABEL, type EditorMode } from '@/types/collab-center'

/**
 * 编辑器右上模式指示（docs/plan/14 §6.2；Overleaf 右上 Editing / Reviewing / Viewing）：
 * reviewer 固定「审阅」不可切；editor 可切 编辑 ↔ 审阅；viewer「只读」。
 * `canSwitch=false` 时渲染为静态徽标（role=status）；true 时为下拉按钮。
 * `compact`（移动顶栏 40px 图标位）：只显示图标 + aria-label；视觉 40，`after:` 伪元素外扩到 ≥44 热区
 * （伪元素的包含块是 padding box，按钮有 1px 边框 ⇒ 38 + 2×4 = 46）。
 */
export interface ModeIndicatorProps {
  mode: EditorMode
  canSwitch: boolean
  onChange: (mode: EditorMode) => void
  compact?: boolean
  className?: string
}

const ICON = { edit: PencilLine, review: MessageSquareDiff, readonly: Eye } as const
const TONE: Record<EditorMode, string> = {
  edit: 'text-fg',
  review: 'text-warn-fg',
  readonly: 'text-fg-muted',
}

export function ModeIndicator({ mode, canSwitch, onChange, compact = false, className }: ModeIndicatorProps) {
  const Icon = ICON[mode]
  const label = EDITOR_MODE_LABEL[mode]
  const base = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full text-xs font-semibold outline-none',
    compact ? "relative size-10 justify-center after:absolute after:-inset-1 after:content-['']" : 'h-5.5 px-2.5',
    TONE[mode],
    className,
  )
  if (!canSwitch) {
    return (
      <span role="status" aria-label={`${label}模式`} title={`${label}模式`} className={cn(base, 'bg-sunken')} data-slot="ModeIndicator" data-testid="mode-indicator" data-mode={mode}>
        <Icon className="size-3.5" aria-hidden />
        {!compact && label}
      </span>
    )
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`${label}模式，点击切换`}
        title={`${label}模式`}
        className={cn(base, 'border border-border-strong bg-panel hover:bg-hover', FOCUS_RING)}
        data-slot="ModeIndicator"
        data-testid="mode-indicator"
        data-mode={mode}
      >
        <Icon className="size-3.5" aria-hidden />
        {!compact && label}
        {!compact && <ChevronDown className="size-3" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['edit', 'review'] as const).map((m) => (
          <DropdownMenuItem key={m} onSelect={() => onChange(m)} aria-current={m === mode ? 'true' : undefined} data-testid={`mode-option-${m}`}>
            {EDITOR_MODE_LABEL[m]}
            <span className="ml-auto text-xs text-fg-muted">{m === 'edit' ? '直接修改源码' : '改动变为 CriticMarkup 建议'}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
