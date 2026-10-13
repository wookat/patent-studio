import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { Bold, MessageSquareText, Redo2, Sigma, SquareSlash, Table, Undo2, type LucideProps } from 'lucide-react'
import { editorCommands } from '@/components/editor/commands'
import { bottomBarActions, layoutHistory, useLayoutHistory, useSlotItems } from '@/components/workbench/slots'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { EditorMode } from '@/types/collab-center'

export type MobileLayoutAction = 'insert' | 'table' | 'equation' | 'undo' | 'redo' | 'bold' | 'rail'

export interface MobileLayoutToolbarProps {
  mode: EditorMode
  /** 每次点击后通知（insert / table / equation 已先写 store.layoutViewToolbar；undo / redo 已执行；rail 已写 store.rightRailSheetOpen） */
  onAction?(action: MobileLayoutAction): void
  className?: string
}

type PanelAction = Extract<MobileLayoutAction, 'insert' | 'table' | 'equation'>

const PANEL_ACTIONS: {
  id: PanelAction
  label: string
  Icon: (p: LucideProps) => ReactNode
}[] = [
  { id: 'insert', label: '插入', Icon: SquareSlash },
  { id: 'table', label: '表格', Icon: Table },
  { id: 'equation', label: '公式', Icon: Sigma },
]

/**
 * 375 编辑页底部工具栏（W9 决策 5；docs/plan/16 §8.2 演进）：撤销 / 重做 ｜ B ｜ 插入 · 表格 · 公式 ｜ 审阅栏开关 ｜ bottomBarActions 插槽。
 * 高 --h-mobile-topbar（44，按钮 ≥44 命中）+ 安全区；模式切换已上移到 MobileEditChrome（不再内嵌 ModeIndicator）。
 * 插入 / 表格 / 公式 只写 store.layoutView.layoutViewToolbar（再点一次收起），D3 的 `/` 菜单与 D2 的表格工具条 / 公式 sheet 读它自己展开——这里不 import 它们的内部。
 * B（加粗）等格式 command 由 format-toolbar 单元经 `bottomBarActions.register` 接入；接入前 B 为禁用占位。
 * readonly 下编辑动作禁用；撤销 / 重做优先走版面注册的 ProseMirror 历史（layoutHistory），未注册时退回 editorCommands 的 CodeMirror 历史。
 */
export function MobileLayoutToolbar({ mode, onAction, className }: MobileLayoutToolbarProps) {
  const panel = useStudio((s) => s.layoutViewToolbar)
  const setPanel = useStudio((s) => s.setLayoutViewToolbar)
  const railOpen = useStudio((s) => s.rightRailSheetOpen)
  const setRailOpen = useStudio((s) => s.setRightRailSheetOpen)
  const cmd = useSyncExternalStore(editorCommands.subscribe, editorCommands.getState, editorCommands.getState)
  const pm = useLayoutHistory()
  const hist = pm.ready ? pm : cmd
  const extra = useSlotItems(bottomBarActions)
  const readonly = mode === 'readonly'
  const hasBold = extra.some((it) => it.id === 'bold')
  const undo = () => (pm.ready ? layoutHistory.undo() : editorCommands.undo())
  const redo = () => (pm.ready ? layoutHistory.redo() : editorCommands.redo())

  const toggle = (id: PanelAction) => {
    setPanel(panel === id ? 'none' : id)
    onAction?.(id)
  }

  return (
    <div
      role="toolbar"
      aria-label="版面工具"
      data-testid="mobile-layout-toolbar"
      data-slot="MobileBottomBar"
      data-mode={mode}
      data-panel={panel}
      // 按钮不夺编辑器焦点：否则 blur → MobileTabs（输入聚焦时隐藏）复现 → 底栏上移 56 → 首次点击落空
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'ps-mobile-toolbar flex min-h-mobile-topbar shrink-0 items-stretch gap-1 overflow-x-auto border-t bg-panel px-2 pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      <ToolButton
        label="撤销"
        disabled={readonly || !hist.canUndo}
        testId="mlt-undo"
        onClick={() => {
          undo()
          onAction?.('undo')
        }}
      >
        <Undo2 className="size-5" />
      </ToolButton>
      <ToolButton
        label="重做"
        disabled={readonly || !hist.canRedo}
        testId="mlt-redo"
        onClick={() => {
          redo()
          onAction?.('redo')
        }}
      >
        <Redo2 className="size-5" />
      </ToolButton>
      <span className="mx-0.5 my-3 w-px bg-border" aria-hidden />
      {!hasBold && (
        <ToolButton label="加粗" disabled title="加粗：由 format-toolbar 单元接入" testId="mlt-bold" onClick={() => onAction?.('bold')}>
          <Bold className="size-5" />
        </ToolButton>
      )}
      {PANEL_ACTIONS.map(({ id, label, Icon }) => (
        <ToolButton key={id} label={label} pressed={panel === id} disabled={readonly} testId={`mlt-${id}`} onClick={() => toggle(id)}>
          <Icon className="size-5" />
        </ToolButton>
      ))}
      {extra.map((it) => (
        <Fragment key={it.id}>{it.render()}</Fragment>
      ))}
      <ToolButton
        label="审阅栏"
        pressed={railOpen}
        testId="mlt-rail"
        className="ml-auto"
        onClick={() => {
          setRailOpen()
          onAction?.('rail')
        }}
      >
        <MessageSquareText className="size-5" />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  label,
  pressed,
  disabled,
  title,
  testId,
  className,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  title?: string
  testId: string
  className?: string
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm px-1.5 text-2xs leading-none disabled:opacity-40',
        FOCUS_RING_INSET,
        pressed ? 'bg-primary-soft text-primary-text' : 'text-fg-muted hover:text-fg',
        className,
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}
