import { useEffect, useMemo } from 'react'
import { Code, Columns2, FileText, FileType } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { Segmented, type SegmentedOption, type SegmentedSize } from '@/components/ui/segmented'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IS_MAC } from '@/lib/hotkeys'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import {
  THREE_VIEWS,
  VIEW_LABEL,
  currentView,
  isSideBySide,
  planSideBySide,
  planViewSwitch,
  viewForHotkey,
  type PanelOp,
  type ThreeView,
  type ViewSwitchState,
} from './viewSwitchPlan'

const VIEW_ICON = { source: Code, layout: FileText, pdf: FileType } as const

const VIEW_TIP: Record<ThreeView, string> = {
  source: '源码编辑（CodeMirror）',
  layout: '版面视图（Word 对齐；连续页，页码以 PDF 为准）',
  pdf: 'PDF 预览（LibreOffice 真实分页）',
}

/** 顶栏中央容器（TopBar @container/topbar）至少这么宽才显示三段文案（Tailwind 需字面类名，见 ViewSwitch 内 `@[520px]/topbar:`）；再窄只留图标 */
export const VIEW_LABEL_MIN_PX = 520

const MOD = IS_MAC ? '⌘' : 'Ctrl+'
export const VIEW_HOTKEY_LABEL: Record<ThreeView, string> = { source: `${MOD}1`, layout: `${MOD}2`, pdf: `${MOD}3` }

function snapshot(): ViewSwitchState {
  const s = useStudio.getState()
  return {
    activePanelId: s.activePanelId,
    editorView: s.editorView,
    activeBook: s.activeBook,
    openPanels: s.dockHandle ? s.dockHandle.panelIds() : null,
    ast: s.ast,
    activeBlockId: s.activeBlock?.id ?? null,
    cursorLine: s.cursor.line,
  }
}

function runOps(ops: PanelOp[]) {
  const s = useStudio.getState()
  for (const op of ops) {
    if (op.type === 'open') s.openPanel(op.id, op.opts)
    else s.closePanel(op.id)
  }
}

/**
 * 切到 view 并保持案子 / 书 / 当前块（W9 决策 6）：先算出当前块 Focus，再换卡片 / editorView，最后广播 Focus——
 * 目标视图挂载（或已挂载）后由 useFocusConsumer 重放 / 消费，滚到同一 block_id。桌面 dock 与 375 回退同一入口。
 */
export function switchToView(view: ThreeView) {
  const st = snapshot()
  const plan = planViewSwitch(view, st)
  const s = useStudio.getState()
  const from = currentView(s).view
  if (plan.editorView && plan.editorView !== s.editorView) s.setEditorView(plan.editorView)
  if (st.openPanels === null) {
    // 375 无 dock：源码 / 版面留在编辑 Tab（可编辑版面），PDF 去预览 Tab
    if (view === 'pdf') {
      s.setMobileTab('preview')
      s.setMobilePreviewKind('pdf')
    } else if (s.mobileTab !== 'edit') s.setMobileTab('edit')
  } else runOps(plan.ops)
  if (plan.focus) s.setFocus({ ...plan.focus, source: from })
}

export function toggleSideBySide(on?: boolean) {
  const st = snapshot()
  runOps(planSideBySide(on ?? !isSideBySide(st.openPanels), st))
}

/** 打开面板集合的可订阅快照（dockHandle.panelIds() 不是 store 状态：activePanelId / dockHandle / dockRevision 变化时重取） */
function useOpenPanels(): readonly string[] | null {
  const dock = useStudio((s) => s.dockHandle)
  const active = useStudio((s) => s.activePanelId)
  const rev = useStudio((s) => s.dockRevision)
  return useMemo(() => (dock ? dock.panelIds() : null), [dock, active, rev])
}

let hotkeyRefs = 0
let detach: (() => void) | null = null

/** Ctrl+1/2/3 注册一次（顶栏 / 375 顶部各自渲染时共享）；输入框内也生效（切视图不是文本编辑） */
export function useViewSwitchHotkeys() {
  useEffect(() => {
    if (hotkeyRefs++ === 0) {
      const onKey = (e: KeyboardEvent) => {
        const v = viewForHotkey(e, IS_MAC)
        if (!v) return
        e.preventDefault()
        switchToView(v)
      }
      window.addEventListener('keydown', onKey)
      detach = () => window.removeEventListener('keydown', onKey)
    }
    return () => {
      if (--hotkeyRefs === 0) {
        detach?.()
        detach = null
      }
    }
  }, [])
}

export interface ViewSwitchProps {
  /** md 32（桌面顶栏）/ xl 44（375 编辑页顶部，三段等宽） */
  size?: SegmentedSize
  views?: readonly ThreeView[]
  /** 375 无 hover：不渲染 Tooltip */
  tips?: boolean
  /** 桌面顶栏：文案随顶栏中央容器（@container/topbar）宽度显隐——窄于 VIEW_LABEL_MIN 只留图标（文案 sr-only） */
  compactInTopBar?: boolean
  className?: string
}

/** 三视图分段 `源码 | 版面 | PDF`（lucide Code / FileText / FileType；Segmented 原语，role=radiogroup） */
export function ViewSwitch({ size = 'md', views = THREE_VIEWS, tips = true, compactInTopBar = false, className }: ViewSwitchProps) {
  const activePanelId = useStudio((s) => s.activePanelId)
  const editorView = useStudio((s) => s.editorView)
  useViewSwitchHotkeys()
  const value = currentView({ activePanelId, editorView }).view
  const options = useMemo<SegmentedOption<ThreeView>[]>(
    () =>
      views.map((v) => {
        const Icon = VIEW_ICON[v]
        return {
          value: v,
          icon: <Icon aria-hidden />,
          // 图标档下只留 sr-only 文案（radio 仍有可访问名称）；可见文案单独一个 span 显隐，避免 not-sr-only 的 white-space:normal 让「源码」折行
          label: compactInTopBar ? (
            <span className="hidden whitespace-nowrap @[520px]/topbar:inline" aria-hidden>
              {VIEW_LABEL[v]}
            </span>
          ) : (
            <span className="whitespace-nowrap">{VIEW_LABEL[v]}</span>
          ),
          ...(compactInTopBar ? { ariaLabel: VIEW_LABEL[v] } : {}),
          'data-testid': `view-switch-${v}`,
        }
      }),
    [views, compactInTopBar],
  )
  const seg = (
    <Segmented
      size={size}
      options={options}
      value={views.includes(value) ? value : views[0]}
      onValueChange={switchToView}
      aria-label="视图"
      data-slot="ViewSwitch"
      data-testid="view-switch"
      data-value={value}
      className={cn('shrink-0', compactInTopBar &&
          '[&_[data-slot=segmented-item]]:min-w-8 [&_[data-slot=segmented-item]]:px-2 @[520px]/topbar:[&_[data-slot=segmented-item]]:min-w-16 @[520px]/topbar:[&_[data-slot=segmented-item]]:px-3', className)}
    />
  )
  if (!tips) return seg
  return (
    <Tooltip>
      <TooltipTrigger asChild>{seg}</TooltipTrigger>
      <TooltipContent side="bottom" className="flex flex-col gap-1">
        {views.map((v) => (
          <span key={v} className="inline-flex items-center justify-between gap-3">
            {VIEW_TIP[v]}
            <Kbd>{VIEW_HOTKEY_LABEL[v]}</Kbd>
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

/** 「并排」：当前视图 + PDF 双栏（dockview split）；无 dock 时不渲染 */
export function SideBySideToggle({ className }: { className?: string }) {
  const open = useOpenPanels()
  const on = isSideBySide(open)
  if (open === null) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="md"
          pressed={on}
          onPressedChange={() => toggleSideBySide()}
          aria-label={on ? '取消并排' : '并排：当前视图 + PDF'}
          data-testid="view-side-by-side"
          className={cn('gap-1.5 px-2', className)}
        >
          <Columns2 aria-hidden />
          <span className="hidden 2xl:inline">并排</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom">{on ? '取消并排（关闭 PDF 卡）' : '并排：当前视图 + PDF 双栏'}</TooltipContent>
    </Tooltip>
  )
}
