import { ModeIndicator } from '@/components/collab-center/ModeIndicator'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { selectCanSwitchMode, selectEditorMode, useStudio } from '@/store'
import { EditModeSwitch } from './EditModeSwitch'
import { SideBySideToggle, ViewSwitch } from './ViewSwitch'

/** 顶栏中央容器窄于此（1024 三栏 ≈157px）：并排隐藏，`编辑 | 审阅` 二段退为 ModeIndicator compact 单键（字面类名 `@max-[240px]/topbar:`） */
export const CONTROLS_MIN_PX = 240
const NARROW = '@max-[240px]/topbar:hidden'

/**
 * 桌面工作台顶栏中央控件簇（W9 决策 5 / 6）：`源码 | 版面 | PDF` · 并排 ｜ `编辑 | 审阅`。
 * 无案子不渲染。两组用竖线分隔：左组“看什么”（图标三段 + 并排），右组“怎么改”（纯文字二段）；
 * 审阅栏的开合不在这里——顶栏右组唯一的「审阅」按钮（review/ReviewDrawerButton，23-w12 §4 第二步）。
 * 三视图文案 ≥520 才显示（VIEW_LABEL_MIN_PX），再窄只留图标（文案 sr-only）；<CONTROLS_MIN_PX 只留三视图 + 模式单键（1280 ≈264px 仍显示并排）。
 */
export function WorkbenchControls({ className }: { className?: string }) {
  const pid = useStudio((s) => s.pid)
  const mode = useStudio(selectEditorMode)
  const canSwitch = useStudio(selectCanSwitchMode)
  const setEditorMode = useStudio((s) => s.setEditorMode)
  if (!pid) return null
  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)} role="group" aria-label="工作台" data-slot="WorkbenchControls" data-testid="workbench-controls">
      <div className="flex items-center gap-1" role="group" aria-label="视图与并排" data-testid="workbench-view-group">
        <ViewSwitch compactInTopBar />
        <SideBySideToggle className={NARROW} />
      </div>
      <Separator orientation="vertical" className={cn('mx-1 h-5', NARROW)} />
      <div className="flex items-center gap-1" role="group" aria-label="编辑模式" data-testid="workbench-mode-group">
        <EditModeSwitch compactInTopBar className={NARROW} />
        <div className="hidden @max-[240px]/topbar:block" data-testid="edit-mode-compact">
          <ModeIndicator mode={mode} canSwitch={canSwitch} onChange={setEditorMode} compact className="size-8" />
        </div>
      </div>
    </div>
  )
}
