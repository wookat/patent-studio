import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { BookA, CircleHelp, Files, Images, Milestone, Search, Settings2, Stethoscope } from 'lucide-react'
import { Count } from '@/components/ui/count'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hotkeyLabel } from '@/lib/hotkeys'
import { useRailItems } from '@/lib/slots'
import { useStudio, selectErrorCount, selectTermIssueCount, type CompanionId } from '@/store'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'

/** rail tab 32×32 r6 图标 20；激活 `--bg-selected` + 图标 `--link` + 左缘 2×20 `--primary` 条（05 §3.3）；不用绿实底 */
export const RAIL_BTN = cn(
  'relative inline-flex w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md py-1 text-fg-muted outline-none hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-disabled [&_svg]:size-5',
  FOCUS_RING,
  TRANSITION_COLOR,
)
/** 图标下常显双字标签——可发现性（纯 icon 要 hover 才知是什） */
const RAIL_LABEL = 'select-none text-[9px] leading-none text-current'
const RailText = ({ children }: { children: string }) => <span className={RAIL_LABEL} aria-hidden>{children}</span>
export const RAIL_ACTIVE =
  'bg-selected text-link hover:bg-selected hover:text-link before:absolute before:-left-1 before:top-1.5 before:h-5 before:w-0.5 before:rounded-full before:bg-primary before:content-[""]'

function RailTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 角标：Count 16 右上（danger = 错误数；brand = 待处理数） */
function Badge({ n, tone }: { n: number; tone: 'danger' | 'brand' }) {
  return <Count value={n} tone={tone} className="absolute -right-1 -top-1" aria-hidden data-testid="rail-error-badge" />
}

/**
 * Rail 40px（05 §3.3；原型 s3 .rail）：`--bg-app` 右 1px。
 *   role=tablist（垂直，↑↓ / Home / End 漫游焦点）：案卷（文件树 + 大纲）· 搜索 · 附图 · 术语
 *   ─ 底部：体检（Count danger 当有 error → 伴随栏 console）· 帮助 · 排版设置
 * 审阅 / AI / 历史 的入口在顶栏伴随栏图标组（05 §3.1），Rail 不重复。
 * 附图 / 术语 / 体检 → toggleCompanion(id)（正文由 shell/companionBodies 注册）。
 * 「搜索」→ railTab='search'：侧栏下块换为 SearchPanel（编辑器内查找仍是 Mod-F）。
 */
export function Rail() {
  const railTab = useStudio((s) => s.railTab)
  const outlineOpen = useStudio((s) => s.outlineOpen)
  const setRailTab = useStudio((s) => s.setRailTab)
  const toggleSide = useStudio((s) => s.toggleSide)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  const toggleSettings = useStudio((s) => s.toggleSettings)
  const openDialog = useStudio((s) => s.openDialog)
  const companion = useStudio((s) => s.companion)
  const toggleCompanion = useStudio((s) => s.toggleCompanion)
  const errors = useStudio(selectErrorCount)
  const termIssues = useStudio(selectTermIssueCount)
  const pid = useStudio((s) => s.pid)
  const listRef = useRef<HTMLDivElement>(null)

  const filesActive = outlineOpen && railTab !== 'search'
  const searchActive = outlineOpen && railTab === 'search'

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [])
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0 || tabs.length === 0) return
    let next = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    tabs[next].focus()
  }

  const openFiles = () => {
    if (filesActive) toggleSide(false)
    else {
      if (railTab === 'search') setRailTab('outline')
      toggleSide(true)
    }
  }
  const openSearch = () => {
    const s = useStudio.getState()
    if (searchActive) {
      setRailTab('outline')
      return
    }
    if (s.sideOutlineCollapsed) s.setSideOutlineCollapsed(false)
    setRailTab('search')
  }

  const companionTab = (id: CompanionId, label: string, icon: ReactNode, testId: string, badge?: ReactNode, ariaLabel?: string, inList = true) => {
    const active = companion === id
    return (
      <RailTip label={label}>
        <button
          type="button"
          role={inList ? 'tab' : undefined}
          id={`rail-tab-${id}`}
          aria-selected={inList ? active : undefined}
          aria-pressed={inList ? undefined : active}
          aria-label={ariaLabel ?? label}
          tabIndex={inList && !active ? -1 : 0}
          className={cn(RAIL_BTN, active && RAIL_ACTIVE)}
          onClick={() => toggleCompanion(id)}
          disabled={!pid}
          data-testid={testId}
          data-companion={id}
        >
          {icon}
          <RailText>{label.split(/[：·(（]/)[0].trim().slice(0, 2)}</RailText>
          {badge}
        </button>
      </RailTip>
    )
  }

  return (
    <nav data-slot="Rail" className="flex h-full w-rail flex-col items-center gap-0.5 border-r border-border bg-app py-1" aria-label="侧栏切换" data-testid="rail">
      <div ref={listRef} role="tablist" aria-orientation="vertical" aria-label="侧栏面板" className="flex flex-col items-center gap-0.5" onKeyDown={onKeyDown}>
        <RailTip label={`案卷：文件与大纲（${hotkeyLabel('toggleOutline')}）`}>
          <button
            type="button"
            role="tab"
            id="rail-tab-outline"
            aria-selected={filesActive}
            aria-label="案卷：文件与大纲"
            tabIndex={filesActive || !outlineOpen ? 0 : -1}
            className={cn(RAIL_BTN, filesActive && RAIL_ACTIVE)}
            onClick={openFiles}
            data-testid="rail-outline"
          >
            <Files aria-hidden />
            <RailText>案卷</RailText>
          </button>
        </RailTip>
        <RailTip label={`全文搜索（编辑器内查找 ${hotkeyLabel('find')}）`}>
          <button
            type="button"
            role="tab"
            id="rail-tab-search"
            aria-selected={searchActive}
            aria-label="全文搜索"
            tabIndex={searchActive ? 0 : -1}
            className={cn(RAIL_BTN, searchActive && RAIL_ACTIVE)}
            onClick={openSearch}
            disabled={!pid}
            data-testid="rail-search"
          >
            <Search aria-hidden />
            <RailText>搜索</RailText>
          </button>
        </RailTip>
        {companionTab('lifecycle', '流程：十档阶段指引', <Milestone aria-hidden />, 'rail-lifecycle')}
        {companionTab('figures', '附图：顺序 / 宽度 / 摘要图', <Images aria-hidden />, 'rail-figures')}
        {companionTab(
          'terms',
          termIssues > 0 ? `术语 · ${termIssues} 处别名待统一` : '术语：主名 / 别名 / 英文 / 定义',
          <BookA aria-hidden />,
          'rail-terms',
          termIssues > 0 ? <Badge n={termIssues} tone="brand" /> : undefined,
          termIssues > 0 ? `术语，${termIssues} 处别名待统一` : '术语',
        )}
      </div>
      <div className="flex-1" />
      <RailSlot />
      {companionTab(
        'console',
        errors > 0 ? `体检 · ${errors} 个错误（在伴随栏打开控制台）` : '体检：在伴随栏打开控制台',
        <Stethoscope aria-hidden />,
        'rail-checks',
        errors > 0 ? <Badge n={errors} tone="danger" /> : undefined,
        errors > 0 ? `体检，${errors} 个错误，打开控制台` : '体检，打开控制台',
        false,
      )}
      <RailTip label="帮助 / 快捷键（?）">
        <button type="button" className={RAIL_BTN} aria-label="帮助与快捷键" onClick={() => openDialog('shortcuts')} data-testid="rail-help">
          <CircleHelp aria-hidden />
          <RailText>帮助</RailText>
        </button>
      </RailTip>
      <RailTip label={`排版设置（${hotkeyLabel('toggleSettings')}）`}>
        <button
          type="button"
          className={cn(RAIL_BTN, settingsOpen && RAIL_ACTIVE)}
          aria-label="排版设置"
          aria-pressed={settingsOpen}
          onClick={() => toggleSettings()}
          disabled={!pid}
          data-testid="settings-toggle"
        >
          <Settings2 aria-hidden />
          <RailText>设置</RailText>
        </button>
      </RailTip>
    </nav>
  )
}

/** lib/slots.ts 注入点：功能单元 registerRailItem（期限 / 收件箱入口等）渲染在 Rail 底部工具组之上；无注册不渲染 */
function RailSlot() {
  const items = useRailItems()
  if (!items.length) return null
  return (
    <div className="flex flex-col items-center gap-0.5" data-slot="rail-slot" data-testid="rail-slot">
      {items.map((it) => (
        <Fragment key={it.id}>{it.render({ compact: false })}</Fragment>
      ))}
    </div>
  )
}
