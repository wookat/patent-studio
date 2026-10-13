import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { LoginPage } from '@/components/auth/LoginPage'
import { LandingPage } from '@/components/auth/LandingPage'
import { LegalPage } from '@/components/auth/LegalPage'
import { ShareAccept } from '@/components/share/ShareAccept'
import { StoreBootstrap } from '@/components/shell/StoreBootstrap'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog'
import { DashboardPage } from '@/components/dashboard/DashboardPage'
import { DeliverPage } from '@/components/deliver/DeliverPage'
import { AccountPage } from '@/components/account/AccountPage'
import { AdminPage } from '@/components/admin/AdminPage'
import { DeadlinesPage } from '@/components/deadlines/DeadlinesPage'
import { FigLibraryPage } from '@/components/figlib/FigLibraryPage'
import { InboxPage } from '@/components/notify/InboxPage'
import { ClientReviewPage } from '@/components/client/ClientReviewPage'
import { useOutlineModel, useOutlineSync } from '@/components/outline/useOutline'
import { useIsDesktop, useMediaQuery } from '@/hooks/useMisc'
import { watchDupTab } from '@/lib/dupTab'
import { AppErrorBoundary } from '@/components/ui/error-boundary'
import { useStudio } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { parseHash, type HashRoute } from '@/lib/hash'
// 功能单元的槽位注册（lib/slots）已随工作台壳下沉进 lazy 分包——它们全只被 Rail/CompanionHost/编辑器消费
// （只在两个壳里渲染），App 层不再引用，dashboard/登录等轻页不必随包下载 CM/PM/dockview。

/** `#/__ds` 设计系统展示页：开发 / 走查用，lazy 不进主包 */
const DesignSystemPage = lazy(() => import('@/components/design-system/DesignSystemPage'))

/** 工作台壳（桌面 / 移动二选一）：整包 lazy——CM/PM/dockview/AI 扩展 2MB+ 只在 `＃/p/` 路由才下载 */
const DesktopShell = lazy(() => import('@/components/shell/DesktopShell').then((m) => ({ default: m.DesktopShell })))
const MobileShell = lazy(() => import('@/components/mobile/MobileShell').then((m) => ({ default: m.MobileShell })))

/** W17 附图绘制画板页（excalidraw 重资产）：整包 lazy——只在 #/p/<pid>/board 路由才下载 */
const BoardPage = lazy(() => import('@/components/figure-book/BoardPage').then((m) => ({ default: m.BoardPage })))
/** W19 批4 查新记录卡页：lazy——只在 #/p/<pid>/novelty 路由才下载 */
const NoveltyPage = lazy(() => import('@/components/novelty/NoveltyPage').then((m) => ({ default: m.NoveltyPage })))

function WorkbenchFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-app" data-testid="workbench-loading">
      <LoaderCircle className="size-6 animate-spin text-fg-muted" aria-label="加载工作台" />
    </div>
  )
}

/** doc.content → doc.outline 的全局同步（与大纲面板是否挂载无关：StatusBar/Rail 徒标也读 outline） */
function OutlineSync() {
  useOutlineSync(useOutlineModel())
  return null
}

/** ui.density → <html data-density>（index.css 据此缩放列表行高 / 面板内边距；PDF 不受影响）；<md 一律 touch（05 §1.9：移动全部控件 ≥ 44） */
function DensitySync() {
  const density = useStudio((s) => s.density)
  const mobile = useMediaQuery('(max-width: 767px)')
  useEffect(() => {
    document.documentElement.dataset.density = mobile ? 'touch' : density
  }, [density, mobile])
  return null
}

/** 批74：同案多页签观察器（双壳共用）——dupTabOther 驱动 StatusBar 警示段；
   转入 dup 且协同未连时 toast 一次（移动壳无状态栏，这是它的提示通道）。
   心跳按路由闸——`s.pid` 在回台账后仍残留（为快速重开留存），拿它广播会让
   仍在案内的页签永久误警（D-B74-2）；仅工作台路由（'project'）才广播认领。 */
function DupTabWatch({ route }: { route: HashRoute }) {
  const workbenchPid = route.kind === 'project' ? route.pid : null
  const dup = useStudio((s) => s.dupTabOther)
  const collabStatus = useStudio((s) => s.collabStatus)
  const setDupTabOther = useStudio((s) => s.setDupTabOther)
  const toast = useStudio((s) => s.toast)
  const toasted = useRef(false)
  useEffect(() => watchDupTab(workbenchPid, setDupTabOther), [workbenchPid, setDupTabOther])
  useEffect(() => {
    if (!dup) {
      toasted.current = false
      return
    }
    if (!toasted.current && collabStatus !== 'connected') {
      toasted.current = true
      toast('此案卷在另一页签打开——协同未连接时双端保存会互相覆盖', 'error')
    }
  }, [dup, collabStatus, toast])
  return null
}

/** hash → 路由（13 §5；17 §1.3；21 §4.4）：#/ 面板 · #/p/<pid> 工作台（旧 #/<pid> 同）· #/p/<pid>/deliver 递交页 · #/login · #/share/<token> · #/c/<token> · #/account · #/admin · #/deadlines · #/inbox · #/__ds */
function useHashRoute(): HashRoute {
  const [route, setRoute] = useState(() => parseHash())
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

/**
 * 05 §1：<StoreBootstrap/> + 按 hash 二选一：面板（DashboardPage）/ 工作台（断点二选一桌面壳 / 移动壳）；所有状态在 store/。
 * R6（07 §5.2 / §5.3）：`#/login` 或 auth=on 且未登录（authStatus 'anon'）→ 全屏登录页；`#/share/<token>` → 领取页（anon 时由它自己引导登录）。
 * W4-E（17 §1.3）：`#/p/<pid>/deliver` 递交页（与工作台共用 StoreBootstrap 的 openProject，工作台壳不挂载）· `#/account` · `#/admin`（超管）。
 * W5（21 §4.4 / §4.6）：`#/c/<token>` 客户确认页（匿名，不走登录）· `#/deadlines` · `#/inbox`（prep 占位 EmptyState）· `#/__ds` 设计系统。
 * TooltipProvider 在此层，各页共用。
 */
export default function App() {
  const isDesktop = useIsDesktop()
  const route = useHashRoute()
  const authStatus = useStudio((s) => s.authStatus)
  // anon：#/login 直达登录框；其余路由（除 share/client 公链）先落产品落地页，CTA 再导 #/login
  const showLogin = route.kind === 'login'
  const showLanding = authStatus === 'anon' && !showLogin
  return (
    <TooltipProvider delayDuration={300}>
      <AppErrorBoundary>
        <StoreBootstrap />
        <OutlineSync />
        <DensitySync />
        <DupTabWatch route={route} />
        <CommandPalette />
        {/* 「?」快捷键在任何 authed 页面都会置 dialog='shortcuts'——挂根级避免页面路由上死键占位 */}
        <ShortcutsDialog />
        {route.kind === 'share' ? (
          <ShareAccept />
        ) : route.kind === 'client' ? (
          <ClientReviewPage token={route.token} />
        ) : route.kind === 'ds' ? (
          <Suspense fallback={null}>
            <DesignSystemPage />
          </Suspense>
        ) : route.kind === 'legal' ? (
          <LegalPage page={route.page} />
        ) : showLogin ? (
          <LoginPage />
        ) : showLanding ? (
          <LandingPage />
        ) : route.kind === 'dashboard' ? (
          <DashboardPage />
        ) : route.kind === 'deliver' ? (
          <DeliverPage pid={route.pid} />
        ) : route.kind === 'board' ? (
          <Suspense fallback={<WorkbenchFallback />}>
            <BoardPage pid={route.pid} src={route.src} img={route.img} />
          </Suspense>
        ) : route.kind === 'novelty' ? (
          <Suspense fallback={<WorkbenchFallback />}>
            <NoveltyPage pid={route.pid} />
          </Suspense>
        ) : route.kind === 'account' ? (
          <AccountPage />
        ) : route.kind === 'admin' ? (
          <AdminPage />
        ) : route.kind === 'deadlines' ? (
          <DeadlinesPage />
        ) : route.kind === 'inbox' ? (
          <InboxPage />
        ) : route.kind === 'figlib' ? (
          <FigLibraryPage />
        ) : (
          <Suspense fallback={<WorkbenchFallback />}>
            {isDesktop ? <DesktopShell /> : <MobileShell />}
          </Suspense>
        )}
      </AppErrorBoundary>
    </TooltipProvider>
  )
}
