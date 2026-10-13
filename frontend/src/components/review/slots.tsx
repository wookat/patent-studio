import { registerTopBarItem } from '@/lib/slots'
import { useStudio, isDesktopViewport, selectEditorMode } from '@/store'
import { clearProjectQuery, parseHash } from '@/lib/hash'
import { ReviewDrawer, openReviewHost } from './ReviewDrawer'
import './companion'

/**
 * 审阅 Drawer 装配（不改 shell/**）：
 * 1. TopBar 槽位：Drawer 宿体（registerTopBarItem，只是 Sheet 的挂点，不占顶栏控件）；「审阅」按钮本体由 shell/TopBar 在右组固定位置渲染（ReviewDrawerButton）；
 * 2. `#/p/<pid>?c=<cid>` 到达（含通知点击）→ store.requestReviewComment；该案打开后 openReviewHost({commentId}) 在当前宿主打开并滚到批注；
 *    375 宿主是 MobileShell 常驻的 ReviewDrawer 底部 Sheet（openReviewDrawer 会关 NavDrawer，所以不再顺带开导航抽屉）。消费后清掉 query。
 * 由 ReviewPanel.tsx 副作用引入，启动即生效；重复引入幂等。
 */
let installed = false

export function readReviewRequestFromHash() {
  const r = parseHash()
  if (r.kind !== 'project' || !r.query.c) return
  useStudio.getState().requestReviewComment(r.pid, r.query.c)
  clearProjectQuery()
}

export function resolveReviewRequest() {
  const s = useStudio.getState()
  const req = s.reviewRequest
  if (!req || s.pid !== req.pid || s.projectLoading) return
  s.clearReviewRequest()
  openReviewHost({ commentId: req.cid })
}

export function installReviewSlots() {
  if (installed) return
  installed = true
  registerTopBarItem(
    {
      id: 'review-drawer',
      render: () => <ReviewDrawer />,
    },
    20,
  )
  window.addEventListener('hashchange', readReviewRequestFromHash)
  // openProject 在 projectLoading=false 的同一同步段里还会 resetReview/resetComments，故推到微任务后再开 Drawer
  useStudio.subscribe((s, prev) => {
    if (s.reviewRequest && (s.reviewRequest !== prev.reviewRequest || s.pid !== prev.pid || s.projectLoading !== prev.projectLoading)) queueMicrotask(resolveReviewRequest)
  })
  // 审阅模式（editor 手动切 / reviewer 固定 / 刷新后 ps:mode:<pid> 恢复）→ 自动展开伴随栏 + 四档切到「所有标记」；
  // 回到编辑模式 → 「无标记」（= 最新），栏不自动关（编辑模式可手动开合）
  useStudio.subscribe((s, prev) => {
    if (!s.pid || s.projectLoading) return
    const mode = selectEditorMode(s)
    const prevMode = prev.pid === s.pid && !prev.projectLoading ? selectEditorMode(prev) : null
    if (mode === prevMode) return
    queueMicrotask(() => syncRailWithMode(mode))
  })
  readReviewRequestFromHash()
}

export function syncRailWithMode(mode: ReturnType<typeof selectEditorMode>) {
  const s = useStudio.getState()
  if (!s.pid) return
  if (mode === 'review') {
    s.setMarkupLevel('all')
    // 375 的伴随栏是全屏底部 Sheet，自动弹出会盖住正文，只在桌面自动展开；宿主（版面卡内嵌列 / 其 Sheet / Drawer）与顶栏按钮同一选择
    if (isDesktopViewport()) openReviewHost()
  } else if (mode === 'edit' && s.markupLevel !== 'none') {
    s.setMarkupLevel('none')
  }
}

installReviewSlots()
