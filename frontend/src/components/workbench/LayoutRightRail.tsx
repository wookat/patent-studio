import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { MessageSquareText, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/useMisc'
import { useStudio } from '@/store'
import { RIGHT_RAIL_QUERY, selectRailAsColumn } from '@/store/reviewHost'
import { rightRailSlot, useSlotItems } from './slots'
import type { PanelId } from '@/store/layout'

export { RIGHT_RAIL_QUERY, selectRailAsColumn }
/** 320 = --w-companion-min（05 §3.3 伴随栏下限；不写散落 px） */
export const RIGHT_RAIL_WIDTH_CLASS = 'w-companion-min'
/** 版面卡身（含栏）至少这么宽才摆 320 列：320 + A4 纸最小可读宽（~ --w-companion-min 再加一栏），否则退到 Sheet；写进 store.rightRailColumnFits 供开关同步 */
export const RIGHT_RAIL_HOST_MIN_PX = 640

export interface LayoutRightRailProps {
  /** review-rail 单元的正文（优先于注册表 rightRailSlot） */
  children?: ReactNode
  className?: string
  /**
   * 所在版面卡的 panelId。多张版面卡并存时每张都挂本组件：`rightRailColumnFits`
   * 是全局字段，必须由**活动卡**写（窄卡的 ResizeObserver 不能把宽卡的列挤成
   * Sheet），Sheet/列也只由活动卡渲染（W12 R13-01）。未传 = 独立宿主（测试直挂）。
   */
  panelId?: PanelId
}

function RailBody({ children }: { children?: ReactNode }) {
  const items = useSlotItems(rightRailSlot)
  if (children) return <>{children}</>
  if (items.length) {
    return (
      <>
        {items.map((it) => (
          <Fragment key={it.id}>{it.render()}</Fragment>
        ))}
      </>
    )
  }
  return (
    <EmptyState
      size="sm"
      icon={MessageSquareText}
      title="审阅栏"
      reason="修订 / 批注 / 已修改 由 review-rail 单元接入（rightRailSlot）"
      data-testid="right-rail-empty"
    />
  )
}

/**
 * 版面卡右侧 320 审阅栏容器（W9 决策 4 / U4 挂点）：
 *  - ≥1280（RIGHT_RAIL_QUERY）：常驻列，`rightRailOpen` 折叠 / 展开；LayoutView 在 flex-1 min-w-0 里按容器宽缩放纸面（ResizeObserver），
 *    因此窗口收窄先缩纸不挤栏；
 *  - <1280（含 375）或版面卡身 < RIGHT_RAIL_HOST_MIN_PX（三栏 dock 窄卡，store.rightRailColumnFits=false）：不占列，`rightRailSheetOpen` 驱动 Sheet(right)（默认关）。
 * 正文来自 children 或 rightRailSlot 注册表；review-rail 单元集成后并入 LayoutViewSlots.rightRail。
 */
export function LayoutRightRail({ children, className, panelId }: LayoutRightRailProps) {
  const open = useStudio((s) => s.rightRailOpen)
  const setOpen = useStudio((s) => s.setRightRailOpen)
  const sheetOpen = useStudio((s) => s.rightRailSheetOpen)
  const setSheetOpen = useStudio((s) => s.setRightRailSheetOpen)
  const wide = useMediaQuery(RIGHT_RAIL_QUERY)
  const fits = useStudio((s) => s.rightRailColumnFits)
  const setFits = useStudio((s) => s.setRightRailColumnFits)
  /** 多版面卡并存时只有活动卡承载审阅栏并写全局 fits（R13-01）；panelId 缺省 = 独立宿主 */
  const isHost = useStudio((s) => !panelId || s.activePanelId === panelId)
  const probe = useRef<HTMLElement>(null)
  // dockview 非活动 Tab 的卡片仍在 React 树里但脱离 document；其 Sheet 走 portal 会照样挂到 body，
  // 因此只有宿主在文档中的那份才渲染 Sheet（否则同一 store 开关会叠出多份审阅栏、互相遮挡点击）
  const [hostShown, setHostShown] = useState(true)

  // 量版面卡身（父容器 = StructureCard layout-card-body）的宽：三栏 dock 下窄卡 < 640 时不摆列，让纸面优先。
  // 仅活动卡写全局 fits；活动权切换时 effect 重跑 → 新活动卡立刻按自己卡身重测
  useEffect(() => {
    const host = probe.current?.parentElement
    if (!host || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      setHostShown(host.isConnected)
      if (!wide || !isHost) return
      const w = host.getBoundingClientRect().width
      if (w > 0) setFits(w >= RIGHT_RAIL_HOST_MIN_PX)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => {
      ro.disconnect()
      if (wide && isHost) setFits(true)
    }
  }, [wide, isHost, setFits])

  const asColumn = selectRailAsColumn(wide, { rightRailColumnFits: fits })
  const sentinel = <span ref={probe} hidden data-testid="right-rail-probe" />

  if (!asColumn) {
    if (!hostShown || !isHost) return sentinel
    return (
      <Sheet open={sheetOpen} onOpenChange={(v) => setSheetOpen(v)}>
        <SheetContent side="right" className="max-w-companion-min" data-testid="right-rail-sheet">
          <SheetHeader>
            <SheetTitle>审阅</SheetTitle>
            <SheetDescription className="sr-only">修订、批注与已修改列表</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto" data-slot="LayoutRightRail" data-testid="right-rail" data-presentation="sheet">
            <RailBody>{children}</RailBody>
          </div>
        </SheetContent>
        {sentinel}
      </Sheet>
    )
  }

  if (!open || !isHost) return sentinel
  return (
    <>
      {sentinel}
      <aside
        data-slot="LayoutRightRail"
        data-testid="right-rail"
        data-presentation="column"
        aria-label="审阅栏"
        className={cn('flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-panel', RIGHT_RAIL_WIDTH_CLASS, className)}
      >
        <div className="flex h-panel-header shrink-0 items-center gap-1 border-b border-border px-2 text-sm font-medium text-fg-strong">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">审阅栏</h2>
          <Button variant="ghost" size="icon-sm" aria-label="收起审阅栏" title="收起审阅栏" onClick={() => setOpen(false)} data-testid="right-rail-collapse">
            <PanelRightClose aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RailBody>{children}</RailBody>
        </div>
      </aside>
    </>
  )
}
