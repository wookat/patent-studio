import { useEffect } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hotkeyLabel, registerHotkeys } from '@/lib/hotkeys'
import { FOCUS_RING, cn } from '@/lib/utils'
import { makePanelId, parsePanelId, useStudio, type BookView, type EditorView } from '@/store'
import type { BookName } from '@/types/ast'
import { THREE_VIEWS, VIEW_LABEL, isThreeView, type ThreeView } from '@/components/workbench/viewSwitchPlan'

/**
 * 三视图分段控件「源码 / 版面 / PDF」（docs/plan/16 §5 D4；替代 EditorToolbar 的 etb-mode「源码 / 结构」）。
 *  - <ViewTabsSegmented/>：纯受控（value / onChange），桌面卡片头与 375 编辑 Tab 共用同一套文案 / aria。
 *  - <ViewTabs/>：接 store 的桌面版。dockview 下一张卡片就是三视图之一（source:* / layout:* / pdf），切换 = 原地换卡片；
 *    目标卡片已存在则聚焦它（不关当前卡片）；无 dock（窄桌面回退）时只切 editorView。
 *  - 快捷键 viewSource / viewLayout / viewPdf 作用于当前活动卡片，由 useViewHotkeys 注册一次。
 */
const VIEW_ARIA: Record<ThreeView, string> = { source: '切换到源码编辑', layout: '切换到版面视图', pdf: '切换到 PDF 预览' }

const VIEW_TIP: Record<ThreeView, string> = {
  source: '源码编辑（CodeMirror）',
  layout: '版面视图（Word 对齐；连续页，页码以 PDF 为准）',
  pdf: 'PDF 预览（LibreOffice 真实分页）',
}

const VIEW_HOTKEY = { source: 'viewSource', layout: 'viewLayout', pdf: 'viewPdf' } as const

export interface ViewTabsSegmentedProps {
  value: ThreeView
  onChange(view: ThreeView): void
  views?: readonly ThreeView[]
  /** sm：面板头 32px 下划线页签（原型 `.ptab`）；lg：375 触控 44 分段胶囊 */
  size?: 'sm' | 'lg'
  /** 有 Tooltip 上下文时显示悬浮提示（375 无 hover，关掉） */
  tips?: boolean
  className?: string
  testId?: string
}

export function ViewTabsSegmented({ value, onChange, views = THREE_VIEWS, size = 'sm', tips = true, className, testId = 'view-tabs' }: ViewTabsSegmentedProps) {
  return (
    <div
      role="group"
      aria-label="视图"
      data-testid={testId}
      data-value={value}
      className={cn(
        'inline-flex items-center',
        size === 'sm' ? 'h-panel-header gap-1 self-stretch' : 'h-touch rounded-md bg-sunken text-fg-muted',
        className,
      )}
    >
      {views.map((v) => {
        const active = v === value
        const btn = (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            aria-label={VIEW_ARIA[v]}
            data-testid={`${testId}-${v}`}
            onClick={() => {
              if (!active) onChange(v)
            }}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-(--dur-color)',
              FOCUS_RING,
              size === 'sm'
                ? cn('h-full -mb-px border-b-2 px-2 text-sm', active ? 'border-fg-strong text-fg-strong' : 'border-transparent text-fg-muted hover:text-fg')
                : cn('h-md-control min-h-touch min-w-16 flex-1 rounded-md px-4 text-base', active ? 'bg-panel text-fg-strong shadow-sm' : 'hover:text-fg'),
            )}
          >
            {VIEW_LABEL[v]}
          </button>
        )
        if (!tips) return btn
        return (
          <Tooltip key={v}>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="bottom">
              {VIEW_TIP[v]}
              <Kbd className="ml-2">{hotkeyLabel(VIEW_HOTKEY[v])}</Kbd>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** 某张卡片（或活动卡片）当前是哪一视图；非三视图卡片（大纲等）/ 无 dock 时回退到 editorView */
export function viewOfPanel(panelId: string | null, editorView: EditorView): { view: ThreeView; book: BookView | null; panelId: string | null } {
  const parsed = panelId ? parsePanelId(panelId) : null
  if (parsed && isThreeView(parsed.kind)) return { view: parsed.kind, book: parsed.book, panelId }
  return { view: editorView, book: null, panelId: null }
}

/** 把 panelId（缺省 = 活动卡片）切到 view：dock 下原地换卡片；否则只改 editorView / 移动端走 openPanel 回退 */
export function switchView(view: ThreeView, panelId?: string | null) {
  const s = useStudio.getState()
  const cur = viewOfPanel(panelId ?? s.activePanelId, s.editorView)
  if (view !== 'pdf') s.setEditorView(view)
  if (cur.view === view && cur.panelId) return
  const target = view === 'pdf' ? 'pdf' : makePanelId(view, cur.book ?? s.activeBook)
  s.openPanel(target, cur.panelId ? { replace: cur.panelId } : undefined)
}

/**
 * 三视图定位（PDF 选字「在源码 / 版面打开」、375 长按）：把 `book` 的目标视图卡片露出来而不关别的卡片——
 * 已开则激活；同视图的全文卡片在则激活它；同视图别的书的卡片在则在其 tab 组内新开；无 dock 走 store.openPanel 回退（375 切书 + Tab）。
 * 随后由 Focus 消费者（sourceFocus / LayoutView）滚到块。
 */
export function revealView(view: EditorView, book: BookName) {
  const s = useStudio.getState()
  s.setEditorView(view)
  const id = makePanelId(view, book)
  if (!s.dockHandle) {
    s.openPanel(id)
    return
  }
  const open = s.dockHandle.panelIds()
  const all = makePanelId(view, 'all')
  if (open.includes(id) || open.includes(all)) {
    s.openPanel(open.includes(id) ? id : all)
    return
  }
  const sibling = open.find((p) => parsePanelId(p)?.kind === view)
  s.openPanel(id, sibling ? { position: { referencePanel: sibling, direction: 'within' } } : undefined)
}

/** 下一个视图（源码 → 版面 → PDF → 源码；无 dock 时不含 PDF） */
export function nextView(cur: ThreeView, views: readonly ThreeView[] = THREE_VIEWS): ThreeView {
  const i = views.indexOf(cur)
  return views[(i + 1) % views.length] ?? views[0]
}

/** Mod-Alt-0：当前活动卡片循环切视图 */
export function cycleView() {
  const s = useStudio.getState()
  const cur = viewOfPanel(s.activePanelId, s.editorView)
  switchView(nextView(cur.view, s.dockHandle ? THREE_VIEWS : ['source', 'layout']), cur.panelId)
}

let hotkeyRefs = 0
let unregister: (() => void) | null = null

/** 四条视图快捷键注册一次（多张卡片各自渲染 <ViewTabs/> 时共享） */
export function useViewHotkeys() {
  useEffect(() => {
    if (hotkeyRefs++ === 0) {
      unregister = registerHotkeys({
        viewSource: () => switchView('source'),
        viewLayout: () => switchView('layout'),
        viewPdf: () => switchView('pdf'),
        cycleView,
      })
    }
    return () => {
      if (--hotkeyRefs === 0) {
        unregister?.()
        unregister = null
      }
    }
  }, [])
}

export interface ViewTabsProps {
  /** 卡片头传本卡片 id；不传 = 跟随活动卡片 */
  panelId?: string | null
  className?: string
}

export function ViewTabs({ panelId, className }: ViewTabsProps) {
  const activePanelId = useStudio((s) => s.activePanelId)
  const editorView = useStudio((s) => s.editorView)
  const dock = useStudio((s) => s.dockHandle)
  useViewHotkeys()
  const id = panelId ?? activePanelId
  const { view } = viewOfPanel(id, editorView)
  return <ViewTabsSegmented value={view} views={dock ? THREE_VIEWS : ['source', 'layout']} onChange={(v) => switchView(v, id)} className={className} />
}
