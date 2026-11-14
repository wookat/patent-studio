import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { Image, Link2, Redo2, Search, Sigma, Subscript, Table, Undo2, type LucideProps } from 'lucide-react'
import { useIsDesktop } from '@/hooks/useMisc'
import { hotkeyLabel } from '@/lib/hotkeys'
import { FOCUS_RING, cn } from '@/lib/utils'
import { selectCanSwitchMode, selectEditorMode, selectReadonly, useStudio } from '@/store'
import { ModeIndicator } from '@/components/collab-center/ModeIndicator'
import { INSERT_LABELS, editorCommands, type InsertKind } from './commands'
import { ViewTabs } from './ViewTabs'

/**
 * 编辑器工具栏（07 §2.1 / prototype-c `.etb`，32px）：
 * 撤销 / 重做 ｜ ## / ### ｜ 公式 $$ / 下标 _{} / 表格 / 附图 / 权项引用（opt 组，视口 ≤1279 隐藏）｜ 右：三视图 <ViewTabs/>（源码 / 版面 / PDF）· 查找 · 模式。
 * 所有动作经 ./commands 的模块级 registry 落到当前 CodeMirror 视图；三视图切换由 editor/ViewTabs 统一（docs/plan/16 §7）：
 * 版面态隐藏 ## / ### / 插入组，撤销/重做/查找因 CodeMirror 未挂载（ready=false）禁用。移动端（<1024）编辑页的 源码 / 版面 切换在 MobileEditChrome 的 ViewSwitch，这里不显示。
 */

const ICON_SIZE = 16
/** 撤销/重做不在 lib/hotkeys 注册表（CodeMirror historyKeymap 内建），提示文案沿用 hotkeyLabel 的 Mod 写法 */
const MOD = hotkeyLabel('find').slice(0, -1)

interface ToolButtonProps {
  label: string
  /** 图标；缺省时渲染 text（原型标题按钮为字面 ## / ###） */
  icon?: ComponentType<LucideProps>
  text?: string
  onClick: () => void
  disabled?: boolean
  testId: string
  shortcut?: string
}

function ToolButton({ label, icon: Icon, text, onClick, disabled, testId, shortcut }: ToolButtonProps) {
  const title = shortcut ? `${label} ${shortcut}` : label
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-xs-control shrink-0 items-center justify-center rounded-xs text-fg-muted outline-none transition-colors duration-(--dur-color)',
        Icon ? 'w-xs-control' : 'min-w-xs-control px-1.5 font-mono text-xs font-semibold',
        'hover:bg-hover hover:text-fg-strong active:bg-active',
        FOCUS_RING,
        'disabled:pointer-events-none disabled:text-fg-disabled',
      )}
    >
      {Icon ? <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden="true" /> : <span aria-hidden="true">{text}</span>}
    </button>
  )
}

function Group({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div role="group" data-testid={testId} className={cn('flex items-center gap-px', className)}>
      {children}
    </div>
  )
}

function Sep() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
}

const INSERT_ICONS: Partial<Record<InsertKind, ComponentType<LucideProps>>> = {
  formula: Sigma,
  subscript: Subscript,
  table: Table,
  figure: Image,
  claimRef: Link2,
}

function InsertButton({ kind, disabled }: { kind: InsertKind; disabled: boolean }) {
  return (
    <ToolButton
      label={INSERT_LABELS[kind]}
      icon={INSERT_ICONS[kind]}
      text={kind === 'h2' ? '##' : kind === 'h3' ? '###' : undefined}
      disabled={disabled}
      testId={`etb-insert-${kind}`}
      onClick={() => editorCommands.insert(kind)}
    />
  )
}

export function EditorToolbar() {
  const state = useSyncExternalStore(editorCommands.subscribe, editorCommands.getState, editorCommands.getState)
  const desktop = useIsDesktop()
  const editorView = useStudio((s) => s.editorView)
  const readonly = useStudio(selectReadonly)
  const collabMode = useStudio(selectEditorMode)
  const canSwitchMode = useStudio(selectCanSwitchMode)
  const setCollabMode = useStudio((s) => s.setEditorMode)
  const off = !state.ready
  const structure = desktop && editorView === 'layout'

  return (
    <div
      data-slot="EditorToolbar"
      data-testid="editor-toolbar"
      role="toolbar"
      aria-label="编辑器工具栏"
      className="flex h-panel-header shrink-0 items-center gap-0 overflow-hidden whitespace-nowrap border-b border-border bg-app px-1"
    >
      <Group testId="etb-history">
        <ToolButton label="撤销" shortcut={`${MOD}Z`} icon={Undo2} disabled={off || !state.canUndo} testId="etb-undo" onClick={() => editorCommands.undo()} />
        <ToolButton label="重做" shortcut={`${MOD}Y`} icon={Redo2} disabled={off || !state.canRedo} testId="etb-redo" onClick={() => editorCommands.redo()} />
      </Group>
      {!structure && (
        <>
          <Sep />
          <Group testId="etb-headings">
            <InsertButton kind="h2" disabled={off || readonly} />
            <InsertButton kind="h3" disabled={off || readonly} />
          </Group>
          <Group testId="etb-insert-opt" className="hidden xl:flex">
            <Sep />
            <InsertButton kind="formula" disabled={off || readonly} />
            <InsertButton kind="subscript" disabled={off || readonly} />
            <InsertButton kind="table" disabled={off || readonly} />
            <InsertButton kind="figure" disabled={off || readonly} />
            <InsertButton kind="claimRef" disabled={off || readonly} />
          </Group>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        {desktop && (
          <>
            <ViewTabs />
            <Sep />
          </>
        )}
        <ToolButton label="查找替换" shortcut={hotkeyLabel('find')} icon={Search} disabled={off} testId="etb-search" onClick={() => editorCommands.openSearch()} />
        <Sep />
        <ModeIndicator mode={collabMode} canSwitch={canSwitchMode} onChange={setCollabMode} compact={!desktop} />
      </div>
    </div>
  )
}
