import { useEffect } from 'react'
import { MessagesSquare, PanelRightOpen } from 'lucide-react'
import { useStudio, selectOpenCommentCount } from '@/store'
import { Button } from '@/components/ui/button'
import { useIsDesktop } from '@/hooks/useMisc'
import './slots'
import '@/components/notify/slots'
import '@/components/timeline/slots'

/**
 * 旧「审阅」dock 卡 / Rail 页签 / 375 NavDrawer「审阅」的落点（docs/plan/22 决策 5：审阅不再是第 4 张 dock 卡）。
 * 现只作 ReviewRail 的入口：持久化布局里仍带 review 面板的用户加载不报错，面板内是一颗「打开审阅栏」按钮 + 计数；
 * 375：挂载即打开底部 Sheet（NavDrawer 85vw 放不下 44px 逐条卡），关掉后可再点；Sheet 本体（ReviewDrawer）由 MobileShell 常驻挂载——
 * openReviewDrawer 会关掉 NavDrawer（互斥），本面板随之卸载，Sheet 不能挂在这里。
 * 本文件同时是 TopBar 槽位（审阅按钮 + 铃铛）与 `?c=<cid>` 监听的静态引入锚点（见 ./slots、notify/slots）。
 */
export function ReviewPanel() {
  const pid = useStudio((s) => s.pid)
  return <ReviewRailLauncher key={pid ?? ''} pid={pid} />
}

function ReviewRailLauncher({ pid }: { pid: string | null }) {
  const desktop = useIsDesktop()
  const openDrawer = useStudio((s) => s.openReviewDrawer)
  const toggle = useStudio((s) => s.toggleReviewDrawer)
  const open = useStudio((s) => s.reviewDrawerOpen)
  const openCount = useStudio(selectOpenCommentCount)
  const markCount = useStudio((s) => s.marks.length)
  const loadComments = useStudio((s) => s.loadComments)

  useEffect(() => {
    if (!pid || desktop) return
    void loadComments(pid)
    openDrawer()
  }, [pid, desktop, loadComments, openDrawer])

  return (
    <div data-slot="ReviewPanel" data-testid="review-panel" className="flex flex-col gap-2 p-3 text-sm">
      <p className="text-xs text-fg-muted">
        修订 <span className="font-mono tabular-nums text-fg">{markCount}</span> 处 · 未解决批注 <span className="font-mono tabular-nums text-fg">{openCount}</span> 条
      </p>
      <p className="text-xs text-fg-muted">审阅已移到版面右侧伴随栏（修订 / 批注 / 已修改），顶栏 <MessagesSquare className="inline size-3.5 align-text-bottom" aria-hidden /> 同样可开合。</p>
      <Button size={desktop ? 'sm' : 'lg'} variant="secondary" className="justify-start" onClick={desktop ? toggle : () => openDrawer()} aria-pressed={desktop ? open : undefined} disabled={!pid} data-testid="review-open-sheet">
        <PanelRightOpen aria-hidden />
        {desktop ? (open ? '收起审阅栏' : '打开审阅栏') : '打开审阅'}
      </Button>
    </div>
  )
}
