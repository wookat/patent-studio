import { ModeIndicator } from '@/components/collab-center/ModeIndicator'
import { ViewSwitch } from '@/components/workbench/ViewSwitch'
import { cn } from '@/lib/utils'
import { selectCanSwitchMode, selectEditorMode, useStudio } from '@/store'

/**
 * 375 编辑页顶部（W9 决策 5）：ViewSwitch 三段等宽（Segmented md 36 + py-0，item touch-hit 命中 44）+ 模式 compact（ModeIndicator，40 视觉 / ≥44 热区）。
 * 行高 44 恰好容下 item 的 44 热区；下一行 BookSwitcher 的 ScrollRow 不得再向上出血（docs/plan/28）。
 * PDF 段 → 预览 Tab（switchToView 375 回退）；源码 / 版面留在编辑 Tab。
 */
export function MobileEditChrome({ className }: { className?: string }) {
  const mode = useStudio(selectEditorMode)
  const canSwitch = useStudio(selectCanSwitchMode)
  const setEditorMode = useStudio((s) => s.setEditorMode)
  return (
    <div
      data-slot="MobileEditChrome"
      data-testid="mobile-edit-chrome"
      className={cn('flex h-mobile-topbar shrink-0 items-center gap-group-m bg-app px-page-m', className)}
    >
      <ViewSwitch size="md" tips={false} className="min-w-0 flex-1 py-0 [&_[data-slot=segmented-item]]:min-w-0 [&_[data-slot=segmented-item]]:flex-1" />
      <ModeIndicator mode={mode} canSwitch={canSwitch} onChange={setEditorMode} compact />
    </div>
  )
}
