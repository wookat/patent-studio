import { History } from 'lucide-react'
import { useStudio } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsDesktop } from '@/hooks/useMisc'
import { CaseTimelinePanel } from './CaseTimelinePanel'

/**
 * 「案件」入口（Rail 槽位按钮）+ 时间线 Drawer：桌面右侧 320 非模态（TopBar 与 StatusBar 之间，编辑器保持可见）；375 全屏 Sheet。
 * prep 未提供侧栏「案件」页签 slot，故经 registerRailItem 注入 Rail。
 * R57-03：开关上提 store.ui.timelineOpen——移动端无 Rail，由 MoreSheet「时间线」行开启；MobileShell 挂载本组件时只渲 Sheet 不渲按钮。
 */
export function CaseTimelineDrawer({ compact = false }: { compact?: boolean }) {
  const desktop = useIsDesktop()
  const pid = useStudio((s) => s.pid)
  const title = useStudio((s) => s.project?.title ?? '')
  const open = useStudio((s) => s.timelineOpen)
  const setOpen = useStudio((s) => s.toggleTimeline)
  if (!pid) return null

  const button = (
    <Button
      variant="ghost"
      size={compact ? 'icon-xl' : 'icon'}
      className={desktop ? 'size-8 [&_svg]:size-5' : undefined}
      aria-label="案件时间线"
      aria-pressed={open}
      onClick={() => setOpen()}
      data-testid="rail-timeline"
    >
      <History aria-hidden />
    </Button>
  )

  return (
    <>
      {desktop && (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">案件时间线</TooltipContent>
        </Tooltip>
      )}
      <Sheet open={open} onOpenChange={setOpen} modal={!desktop}>
        <SheetContent
          side={desktop ? 'right' : 'full'}
          data-density={desktop ? undefined : 'touch'}
          className={desktop ? 'top-topbar bottom-statusbar h-auto w-drawer border-l shadow-md' : 'pt-[env(safe-area-inset-top)]'}
          onInteractOutside={desktop ? (e) => e.preventDefault() : undefined}
          data-testid="timeline-drawer"
        >
          <SheetHeader className="py-2 pr-12">
            <SheetTitle className="text-sm">案件</SheetTitle>
            <SheetDescription className="truncate text-xs">{title || pid}</SheetDescription>
          </SheetHeader>
          <CaseTimelinePanel key={pid} pid={pid} className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>
    </>
  )
}
