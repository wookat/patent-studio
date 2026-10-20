import { MessageSquareText } from 'lucide-react'
import { useStudio, selectOpenCommentCount, DESKTOP_QUERY } from '@/store'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsDesktop, useMediaQuery } from '@/hooks/useMisc'
import { cn } from '@/lib/utils'
import { ReviewRail } from '@/components/layout-view/review/ReviewRail'
import { RIGHT_RAIL_QUERY, selectRailEmbedded, selectReviewHost, selectReviewHostOpen, type ReviewHost } from '@/store/reviewHost'

/** ≥1280：右侧 320 常驻伴随栏；<1280（含 375）：底部 Sheet（docs/plan/22 决策 5） */
export const RAIL_SIDE_QUERY = '(min-width: 1280px)'

/**
 * 审阅伴随栏宿主（docs/plan/22 决策 5，取代 21 §4.3 的审阅 Drawer 与第 4 张 dock 卡）。
 * ≥1280：右侧 320（--w-drawer）非模态 Sheet，位于 TopBar 与 StatusBar 之间，不加遮罩、点编辑器不关——编辑器保持可见可编辑；
 * <1280 与 375：底部 Sheet（≤85dvh，抓手），卡片控件 44px。
 * 开关状态在 store/review.ts（reviewDrawerOpen）；`#/p/<pid>?c=<cid>` 与通知点击经 openReviewHost({commentId}) 打开并滚到批注；
 * 审阅模式进入时由 ./slots 自动展开。W9 集成：桌面且当前视图 = 版面时版面卡已内嵌 LayoutRightRail（LayoutViewSlots.rightRail），
 * 本组件不再另开 Sheet，顶栏按钮改为开合该栏（见 store/reviewHost.selectReviewHost，伴随栏让位同源）。
 */
export { selectRailEmbedded, selectReviewHost, type ReviewHost }

/** 按当前宿主打开审阅栏（可选定位到某条批注）；供 ./slots 的模式同步与 `?c=` 深链复用 */
export function openReviewHost(opts?: { commentId?: string }) {
  const s = useStudio.getState()
  const host = selectReviewHost(s, window.matchMedia(DESKTOP_QUERY).matches, window.matchMedia(RIGHT_RAIL_QUERY).matches)
  if (host === 'drawer') {
    s.openReviewDrawer(opts)
    return
  }
  // 版面卡可能还没量过宽（深链 / 模式同步在案卷加载完的微任务里就到这）：登记意图，实测窄卡时由 store 移交给 Sheet
  if (host === 'rail-column') s.revealRightRail()
  else s.setRightRailSheetOpen(true)
  if (opts?.commentId) {
    s.setReviewRailTab('comments')
    s.focusComment(opts.commentId)
  }
}

export function ReviewDrawer() {
  const side = useMediaQuery(RAIL_SIDE_QUERY)
  const desktop = useIsDesktop()
  const embedded = useStudio(selectRailEmbedded)
  const open = useStudio((s) => s.reviewDrawerOpen)
  const setOpen = useStudio((s) => s.setReviewDrawerOpen)
  const pid = useStudio((s) => s.pid)
  const openCount = useStudio(selectOpenCommentCount)
  const markCount = useStudio((s) => s.marks.length)

  if (!pid) return null

  // 计数只在 ReviewRail 页签上显示一次；标题区不再重复「修订 N 处」，残障技术走 aria-label
  const summary = `审阅修订：修订 ${markCount} 处，未解决批注 ${openCount} 条`

  // 桌面版面视图：栏已内嵌在版面卡（列 / 其 Sheet），本组件不再另开一份
  if (desktop && embedded) return null
  if (side) {
    return (
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          className="top-topbar bottom-statusbar h-auto w-drawer border-l shadow-md"
          onInteractOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
          data-testid="review-drawer"
        >
          <SheetHeader className="py-2 pr-12">
            <SheetTitle className="text-sm" aria-label={summary}>审阅修订</SheetTitle>
          </SheetHeader>
          <ReviewRail pid={pid} className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="h-[85dvh]" data-testid="review-sheet" aria-describedby={undefined}>
        <SheetHeader className="min-h-touch flex-row items-center gap-2 py-1 pr-12">
          <SheetTitle className="min-w-0 flex-1 text-base" aria-label={summary}>审阅修订</SheetTitle>
        </SheetHeader>
        <ReviewRail pid={pid} className="min-h-0 flex-1" />
      </SheetContent>
    </Sheet>
  )
}

/**
 * 顶栏唯一的「审阅」入口（23-w12 §4 第二步）：icon + 文字（≥ xl，与 AI / 导出同规则）+ 修订与未解决批注合计 Count；
 * 开 / 关 selectReviewHost 选出的那一个宿主，aria-pressed 反映该宿主的开合。无案子不渲染。
 */
export function ReviewDrawerButton({ className }: { className?: string }) {
  const pid = useStudio((s) => s.pid)
  const desktop = useIsDesktop()
  const wide = useMediaQuery(RIGHT_RAIL_QUERY)
  const host = useStudio((s) => selectReviewHost(s, desktop, wide))
  const open = useStudio((s) => selectReviewHostOpen(s, host))
  const toggleDrawer = useStudio((s) => s.toggleReviewDrawer)
  const setRailOpen = useStudio((s) => s.setRightRailOpen)
  const setRailSheetOpen = useStudio((s) => s.setRightRailSheetOpen)
  const openCount = useStudio(selectOpenCommentCount)
  const markCount = useStudio((s) => s.marks.length)
  if (!pid) return null
  const toggle = host === 'rail-column' ? () => setRailOpen() : host === 'rail-sheet' ? () => setRailSheetOpen() : toggleDrawer
  const n = openCount + markCount
  const label = `审阅修订${n > 0 ? `，${markCount} 处修订、${openCount} 条未解决批注` : '：修订与批注'}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="md"
          className={cn('relative shrink-0 text-fg-muted', open && 'bg-active text-fg-strong hover:bg-active', className)}
          aria-label={label}
          aria-pressed={open}
          onClick={toggle}
          data-testid="topbar-review"
          data-review-host={host}
        >
          <MessageSquareText aria-hidden />
          <span className="hidden xl:inline">审阅修订</span>
          {n > 0 && <Count value={n} tone="brand" className="absolute right-0 top-0" data-testid="topbar-review-badge" aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
