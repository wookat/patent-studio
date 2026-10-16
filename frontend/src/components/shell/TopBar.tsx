import { Fragment } from 'react'
import { ArrowLeft, Download, Images, Sparkles } from 'lucide-react'
import { StatusPicker } from '@/components/dashboard/StatusPicker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { MenuContent } from '@/components/ui/menu-bits'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectDirty, type CompanionId } from '@/store'
import { figlibHash } from '@/lib/hash'
import { ExportMenuItems } from './ExportMenu'
import { MenuBar } from './MenuBar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCaseStatus } from '@/hooks/useCaseStatus'
import { ProjectMenu } from './ProjectMenu'
import { UserMenu } from '@/components/auth/UserMenu'
import { useTopBarItems } from '@/lib/slots'
import { ShareButton } from '@/components/share/ShareButton'
import { ReviewDrawerButton } from '@/components/review/ReviewDrawer'
import { WorkbenchControls } from '@/components/workbench/WorkbenchControls'
import './companionBodies'

/**
 * 顶栏 40px（05 §3.1；原型 s3-workbench .topbar）：`--bg-app` 下 1px 边。
 *   左：home 32（字标 ≥ 2xl）→ ← 案卷 → 菜单 5 项（ghost 32 / 13px）
 *   中：案名 ▾（ProjectMenu）· 状态徽章 · 保存态（点 + 文字）· W9 决策 6：`源码 | 版面 | PDF` · 并排 ｜ `编辑 | 审阅`（WorkbenchControls）
 *   右：分享 · N 在线（ghost，AvatarGroup）→ 审阅（唯一入口，icon + 字 + Count，开 ReviewRail 当前宿主；review/ReviewDrawerButton）→ 伴随栏入口 AI（带字，激活 = `--bg-active`）
 *       顶栏右侧全部 ghost；构建错误数不在顶栏重复（已在状态栏体检段 / 左 rail 体检角标 / PDF 卡）
 *       → 导出（ghost）→ 插槽 → 账户
 * 构建入口只在 PDF 卡工具条（`preview/BuildButton`）与 菜单栏 构建 / 快捷键，顶栏不再放第二个「构建」按钮。
 * 23-w12 §4：每个功能只留「1 常驻 + 1 菜单」——版本历史 = 左栏面板 + 文件菜单，控制台 = rail 体检 + 视图菜单 / Mod-J，
 * 布局 = 视图菜单 + Mod-\ 循环；顶栏不再各放第三个图标。审阅 = 右组一个「审阅」按钮（中央审阅栏开关与伴随栏 review 入口已并入）。
 * 伴随栏入口只 toggleCompanion(id)；hash ?panel= 与 store 同步由 CompanionHost 负责。
 */
export function TopBar() {
  const requestNavigation = useStudio((s) => s.requestNavigation)
  return (
    <header
      data-slot="TopBar"
      data-testid="header"
      className="flex h-topbar min-w-0 items-center gap-2 overflow-hidden border-b border-border bg-app pl-1.5 pr-2 whitespace-nowrap text-fg"
    >
      <a
        href="/"
        className={cn('inline-flex h-md-control shrink-0 items-center gap-2 rounded-md px-1', FOCUS_RING)}
        aria-label="知撰"
        data-testid="logo"
        onClick={(e) => e.preventDefault()}
      >
        <img src="/logo-mark.svg" alt="" aria-hidden className="size-6 rounded-sm" />
        <span className="hidden text-base font-semibold tracking-tight text-fg-strong 2xl:inline">知撰</span>
      </a>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="md"
            className="shrink-0 text-fg-muted"
            onClick={() => requestNavigation({ type: 'dashboard' })}
            aria-label="返回案卷面板"
            data-slot="BackToDashboard"
            data-testid="back-to-dashboard"
          >
            <ArrowLeft aria-hidden />
            <span className="hidden xl:inline">案卷</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>返回案卷面板</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="md"
            className="shrink-0 text-fg-muted"
            onClick={() => requestNavigation({ type: 'custom', label: '附图图库', run: () => { window.location.hash = figlibHash } })}
            aria-label="附图图库"
            data-testid="goto-figlib"
          >
            <Images aria-hidden />
            <span className="hidden xl:inline">图库</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>附图图库——真实专利附图分类参考（可搜索/看全貌）</TooltipContent>
      </Tooltip>
      <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />

      <MenuBar className="shrink-0" />

      {/* 中央 = 容器查询根（@container/topbar）：WorkbenchControls 按剩余宽度决定三视图是否显示文案（≥520）；<400（1024 三栏）只留 源码|版面|PDF + 编辑|审阅，案名 / 并排 隐藏 */}
      <div className="@container/topbar flex min-w-0 flex-1 items-center justify-center gap-2" data-testid="topbar-center">
        <div className="contents @max-[400px]/topbar:hidden">
          <ProjectMenu />
        </div>
        <CaseStatus />
        <SaveState />
        <WorkbenchControls className="@[400px]/topbar:ml-2" />
      </div>

      <div className="flex shrink-0 items-center gap-1.5" data-testid="topbar-right">
        <ShareButton />
        <ReviewDrawerButton />
        <CompanionEntries />
        <ExportButton />
        <TopBarSlot />
        <UserMenu />
      </div>
    </header>
  )
}

/** 案名右侧状态徽章（13 §5.3）：agent+ 可点开改；viewer/editor 只展示；无 case 摘要（后端旧版）不渲染 */
function CaseStatus() {
  const { pid, status, canEdit } = useCaseStatus()
  if (!pid || !status) return null
  return <StatusPicker pid={pid} status={status} readonly={!canEdit} size="md" className="hidden 2xl:inline-flex" />
}

/** 保存态：点 + 文字（05 §3.1 `StatusDot tone=ok "已保存"`），协同中由服务端落盘 */
function SaveState() {
  const pid = useStudio((s) => s.pid)
  const dirty = useStudio(selectDirty)
  const saving = useStudio((s) => s.saving)
  const collab = useStudio((s) => s.collabStatus)
  if (!pid) return null
  const tone = saving ? 'busy' : collab === 'reconnecting' ? 'warn' : dirty && collab !== 'connected' ? 'warn' : 'ok'
  const text = saving ? '保存中…' : collab === 'reconnecting' ? '重连中' : collab === 'connected' ? '协同自动保存' : dirty ? '未保存' : '已保存'
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-xs text-fg-muted 2xl:inline-flex" data-testid="topbar-save-state" data-tone={tone} aria-live="polite">
      <span className={cn('size-1.5 rounded-full', tone === 'ok' && 'bg-ok-dot', tone === 'warn' && 'bg-warn-dot', tone === 'busy' && 'bg-info-dot motion-safe:animate-pulse-dot')} aria-hidden />
      {text}
    </span>
  )
}

const ENTRIES: { id: CompanionId; label: string; text?: string; Icon: typeof Sparkles; testId: string }[] = [
  { id: 'ai', label: 'AI 智能体（建议式，不改源码）', text: 'AI', Icon: Sparkles, testId: 'topbar-ai' },
]

/**
 * 伴随栏入口：AI（icon + 文字，文字 ≥ xl 显示，与 分享 / 导出 同规则）；激活 = --bg-active。
 * 伴随栏 `review`（ReviewBody 单列）不再有顶栏入口：桌面审阅统一走 ReviewDrawerButton → ReviewRail；该 companion 仍可由 `?panel=review` / 375 「更多」打开。
 */
function CompanionEntries() {
  const pid = useStudio((s) => s.pid)
  const companion = useStudio((s) => s.companion)
  const toggleCompanion = useStudio((s) => s.toggleCompanion)
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="伴随栏" data-testid="topbar-companions">
      {ENTRIES.map(({ id, label, text, Icon, testId }) => {
        const active = companion === id
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={text ? 'md' : 'icon'}
                className={cn('relative shrink-0 text-fg-muted', active && 'bg-active text-fg-strong hover:bg-active')}
                aria-pressed={active}
                aria-label={label}
                disabled={!pid}
                onClick={() => toggleCompanion(id)}
                data-testid={testId}
                data-companion={id}
              >
                <Icon aria-hidden />
                {text && <span className="hidden xl:inline">{text}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** 导出 ▾（ghost，不再是绿实底；DOCX / PDF / 递交页） */
function ExportButton() {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="md" className="shrink-0 text-fg-muted" aria-label="导出" data-slot="ExportMenu" data-testid="export-menu">
          <Download aria-hidden />
          <span className="hidden xl:inline">导出</span>
        </Button>
      </DropdownMenuTrigger>
      <MenuContent align="end" className="min-w-64">
        <ExportMenuItems />
      </MenuContent>
    </DropdownMenu>
  )
}

/** lib/slots.ts 注入点：功能单元 registerTopBarItem（通知铃铛等）渲染在导出与用户菜单之间；无注册不渲染 */
function TopBarSlot() {
  const items = useTopBarItems()
  if (!items.length) return null
  return (
    <div className="flex shrink-0 items-center gap-1" data-slot="topbar-slot" data-testid="topbar-slot">
      {items.map((it) => (
        <Fragment key={it.id}>{it.render({ compact: false })}</Fragment>
      ))}
    </div>
  )
}
