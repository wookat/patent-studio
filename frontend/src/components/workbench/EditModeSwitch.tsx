import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Segmented, type SegmentedOption, type SegmentedSize } from '@/components/ui/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { selectCanSwitchMode, selectEditorMode, useStudio } from '@/store'
import type { EditorMode } from '@/types/collab-center'

const MODE_LABEL: Record<Exclude<EditorMode, 'readonly'>, string> = { edit: '编辑', review: '审阅' }
const MODE_HINT: Record<Exclude<EditorMode, 'readonly'>, string> = {
  edit: '编辑：直接改正文（Markdown 唯一真源）',
  review: '审阅：键入即 CriticMarkup 建议，接受 / 拒绝后落正文',
}

export interface EditModeSwitchProps {
  size?: SegmentedSize
  /** 桌面顶栏：紧凑段（min-w-8 / px-2）；文案始终可见——与左侧三视图图标段形成区分 */
  compactInTopBar?: boolean
  className?: string
}

/**
 * `编辑 | 审阅` 二段开关（W9 决策 5；紧邻 ViewSwitch 右侧，替代桌面下拉式 ModeIndicator）。
 * 纯文字二段（无图标）：与三视图的图标段在顶栏中一眼可区分；审阅态选中项用 brand 色标识“你正在产生修订”。
 * 状态 = collabCenter.editorMode（按案持久化 ps:mode:<pid>；selectEditorMode 把 reviewer 固定为 review）：
 *  - editor / owner：可切；reviewer：固定「审阅」且禁用；readonly（viewer / 协同只读 / 加载中）：只读徽标。
 * 375 仍用 ModeIndicator compact（本组件不在移动端渲染）。
 */
export function EditModeSwitch({ size = 'md', compactInTopBar = false, className }: EditModeSwitchProps) {
  const mode = useStudio(selectEditorMode)
  const canSwitch = useStudio(selectCanSwitchMode)
  const setEditorMode = useStudio((s) => s.setEditorMode)
  const options = useMemo<SegmentedOption<Exclude<EditorMode, 'readonly'>>[]>(
    () =>
      (['edit', 'review'] as const).map((m) => ({
        value: m,
        label: <span className="whitespace-nowrap">{MODE_LABEL[m]}</span>,
        disabled: !canSwitch,
        'data-testid': `edit-mode-${m}`,
      })),
    [canSwitch],
  )
  if (mode === 'readonly') {
    return (
      <Badge tone="neutral" data-testid="edit-mode-readonly" data-slot="EditModeSwitch" className={cn('h-md-control gap-1 px-2.5', className)} title="只读：当前角色 / 协同状态不可编辑">
        <Eye aria-hidden />
        只读
      </Badge>
    )
  }
  const seg = (
    <Segmented
      size={size}
      options={options}
      value={mode}
      onValueChange={(m) => {
        if (canSwitch && m !== mode) setEditorMode(m)
      }}
      aria-label="编辑模式"
      aria-disabled={!canSwitch || undefined}
      data-slot="EditModeSwitch"
      data-testid="edit-mode-switch"
      data-value={mode}
      data-locked={!canSwitch || undefined}
      className={cn(
        'shrink-0',
        mode === 'review' && '[&_[data-slot=segmented-item][data-state=on]]:bg-primary [&_[data-slot=segmented-item][data-state=on]]:text-primary-foreground',
        compactInTopBar && '[&_[data-slot=segmented-item]]:min-w-8 [&_[data-slot=segmented-item]]:px-2',
        className,
      )}
    />
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{seg}</TooltipTrigger>
      <TooltipContent side="bottom" className="flex flex-col gap-1">
        {canSwitch ? (
          (['edit', 'review'] as const).map((m) => <span key={m}>{MODE_HINT[m]}</span>)
        ) : (
          <span>审阅者固定审阅模式：版面视图键入即建议</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
