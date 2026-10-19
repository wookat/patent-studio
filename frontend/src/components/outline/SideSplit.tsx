import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { FilePlus2, ListTree, Settings2 } from 'lucide-react'
import { useStudio, type RailTab } from '@/store'
import { cn } from '@/lib/utils'
import { hotkeyLabel } from '@/lib/hotkeys'
import { FileTree } from './FileTree'
import { OutlinePanel } from './OutlinePanel'
import { HistoryPanel } from './HistoryPanel'
import { SearchPanel } from './SearchPanel'
import { FigureBookView } from '@/components/figure-book/FigureBookView'
import { ReviewPanel } from '@/components/review/ReviewPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import { IconButton30, SectionHeader } from './TreeRow'
import { LABEL_NEW_PROJECT } from '@/lib/copy'

/** 分栏两块各自的最小高度（px，含 28px 标题） */
export const SIDE_SECTION_MIN = 120
/** 与 index.css --h-side-handle 一致 */
const HANDLE = 6

/** 下块显示什么 = ui.railTab：大纲 / 版本历史 / 检查提示 / 全文搜索 / 附图 / 审阅修订（Rail 图标与「版本历史」按钮共用一个状态） */
const LOWER_TITLE: Record<RailTab, string> = {
  outline: '文档大纲', history: '版本历史', checks: '问题与检查', search: '全文搜索', figures: '附图', review: '审阅修订',
  ai: 'AI 智能体', terms: '术语',
}

/**
 * 209 侧栏上下分栏（07 §2.1 ③，prototype-c 左栏）：
 * 上「案卷文件」FileTree / 下「文档大纲」OutlinePanel，各 28px 标题行可独立折叠；
 * 中间 6px 可拖分隔（默认对半，各块最小 120px；双击复位；焦点时 ↑/↓ 微调）。
 * 「版本历史」按钮 / Rail 历史 → 下块切换为 HistoryPanel（railTab='history'）；Rail 🔍 → SearchPanel（railTab='search'）；再点或「返回大纲」切回。
 * 比例与折叠状态在 ui slice（sideSplitRatio / sideFilesCollapsed / sideOutlineCollapsed，持久化）。
 */
export function SideSplit() {
  const railTab = useStudio((s) => s.railTab)
  const setRailTab = useStudio((s) => s.setRailTab)
  const openCompanion = useStudio((s) => s.openCompanion)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  const toggleSettings = useStudio((s) => s.toggleSettings)
  const ratio = useStudio((s) => s.sideSplitRatio)
  const filesCollapsed = useStudio((s) => s.sideFilesCollapsed)
  const outlineCollapsed = useStudio((s) => s.sideOutlineCollapsed)
  const setRatio = useStudio((s) => s.setSideSplitRatio)
  const setFilesCollapsed = useStudio((s) => s.setSideFilesCollapsed)
  const setOutlineCollapsed = useStudio((s) => s.setSideOutlineCollapsed)
  const ref = useRef<HTMLDivElement>(null)

  // 'ai' 已迁到伴随栏（旧持久化 railTab 兜底回大纲）
  const view: RailTab = railTab === 'ai' ? 'outline' : railTab
  const backToOutline = () => setRailTab('outline')

  const toggleFiles = () => setFilesCollapsed(!filesCollapsed)
  const toggleOutline = () => setOutlineCollapsed(!outlineCollapsed)

  const bothOpen = !filesCollapsed && !outlineCollapsed

  const setRatioFromY = useCallback(
    (clientY: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const avail = rect.height - HANDLE
      if (avail <= 0) return
      const min = Math.min(0.5, SIDE_SECTION_MIN / avail)
      const r = (clientY - rect.top - HANDLE / 2) / avail
      setRatio(Math.min(1 - min, Math.max(min, r)))
    },
    [setRatio],
  )

  const dragging = useRef(false)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!bothOpen) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setRatioFromY(e.clientY)
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!bothOpen) return
    const el = ref.current
    const avail = (el?.getBoundingClientRect().height ?? 0) - HANDLE
    const min = avail > 0 ? Math.min(0.5, SIDE_SECTION_MIN / avail) : 0.1
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const d = e.key === 'ArrowUp' ? -0.02 : 0.02
      setRatio(Math.min(1 - min, Math.max(min, ratio + d)))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setRatio(e.key === 'Home' ? min : 1 - min)
    }
  }

  const topStyle = bothOpen
    ? { flex: `0 0 calc(${(ratio * 100).toFixed(3)}% - ${(HANDLE * ratio).toFixed(2)}px)` }
    : filesCollapsed
      ? { flex: '0 0 auto' }
      : { flex: '1 1 0%' }

  return (
    <div ref={ref} data-slot="SideSplit" className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-panel" data-testid="side-panel">
      <section
        aria-label="案卷文件"
        data-testid="side-files"
        data-collapsed={filesCollapsed || undefined}
        className={cn('flex min-h-0 flex-col', bothOpen && 'min-h-30')}
        style={topStyle}
      >
        <SectionHeader
          title="案卷文件"
          collapsed={filesCollapsed}
          onToggle={toggleFiles}
          controls="side-files-body"
          testId="side-files-header"
          actions={
            <>
              <IconButton30 label={LABEL_NEW_PROJECT} onClick={() => requestNavigation({ type: 'create-project' })} testId="side-new-project">
                <FilePlus2 />
              </IconButton30>
              <IconButton30 label={`排版设置（${hotkeyLabel('toggleSettings')}）`} onClick={() => toggleSettings()} pressed={settingsOpen} testId="side-settings">
                <Settings2 />
              </IconButton30>
            </>
          }
        />
        {!filesCollapsed && (
          <div id="side-files-body" className="min-h-0 flex-1">
            <FileTree />
          </div>
        )}
      </section>

      <div
        role={bothOpen ? 'separator' : undefined}
        aria-orientation={bothOpen ? 'horizontal' : undefined}
        aria-label={bothOpen ? '拖拽调整侧栏分栏' : undefined}
        aria-valuenow={bothOpen ? Math.round(ratio * 100) : undefined}
        aria-valuemin={bothOpen ? 0 : undefined}
        aria-valuemax={bothOpen ? 100 : undefined}
        tabIndex={bothOpen ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => bothOpen && setRatio(0.5)}
        onKeyDown={onHandleKey}
        className={cn(
          'h-side-handle shrink-0 bg-border outline-none transition-colors duration-fast',
          bothOpen && 'cursor-row-resize hover:bg-primary focus-visible:bg-primary',
        )}
        data-testid="side-split-handle"
      />

      <section
        aria-label={LOWER_TITLE[view]}
        data-testid="side-lower"
        data-view={view}
        data-collapsed={outlineCollapsed || undefined}
        className={cn('flex min-h-0 flex-col', outlineCollapsed ? 'flex-none' : 'flex-1', bothOpen && 'min-h-30')}
      >
        <SectionHeader
          title={LOWER_TITLE[view]}
          collapsed={outlineCollapsed}
          onToggle={toggleOutline}
          controls="side-lower-body"
          testId="side-outline-header"
          actions={
            view !== 'outline' ? (
              <IconButton30 label="返回大纲" onClick={backToOutline} testId="side-back-outline">
                <ListTree />
              </IconButton30>
            ) : undefined
          }
        />
        {!outlineCollapsed && (
          <div id="side-lower-body" className="min-h-0 flex-1">
            {view === 'outline' && <OutlinePanel />}
            {view === 'history' && <HistoryPanel />}
            {view === 'search' && <SearchPanel />}
            {view === 'figures' && <FigureBookView className="h-full" />}
            {view === 'review' && <ReviewPanel />}
            {view === 'terms' && <TermsPanel />}
            {view === 'checks' && (
              <div className="space-y-2 px-3 py-2 text-xs text-fg-muted">
                <p>形式检查与回归结果在伴随栏「控制台 → 回归检查」查看。</p>
                <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => { setConsoleTab('checks'); openCompanion('console') }}>
                  打开控制台 · 回归检查
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
