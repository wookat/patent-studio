import { DeleteDialog } from './DeleteDialog'
import { FigureDialog } from './FigureDialog'
import { FormulaDialog } from './FormulaDialog'
import { TableDialog } from './TableDialog'
import { closeStructureDialog, focusBlock, openFormulaDialog, useDialogStore } from './state'

/**
 * 结构视图对话框宿主（StructureView 尾部挂一次，全局单例；06 §5.4）。
 * 一次只渲染当前载荷对应的对话框（受控 open，关闭动画期间载荷保留），key=seq 使每次打开都从 initial 重置；
 * 关闭后焦点回到 returnTo 块，未指定则交给 Radix 默认（回到打开前的焦点元素，如把手 / 工具条按钮）。
 */
export function StructureDialogs() {
  const open = useDialogStore((s) => s.open)
  const seq = useDialogStore((s) => s.seq)
  const p = useDialogStore((s) => s.payload)
  if (!p) return null

  const returnFocus = (e: Event) => {
    if (focusBlock(p.returnTo)) e.preventDefault()
  }

  switch (p.kind) {
    case 'formula':
      return (
        <FormulaDialog key={seq} open={open} initial={p.initial} onSubmit={p.onSubmit} onClose={closeStructureDialog} onCloseAutoFocus={returnFocus} />
      )
    case 'table':
      return (
        <TableDialog key={seq} open={open} initial={p.initial} onSubmit={p.onSubmit} onClose={closeStructureDialog} onCloseAutoFocus={returnFocus} />
      )
    case 'figure':
      return <FigureDialog key={seq} open={open} onSubmit={p.onSubmit} onClose={closeStructureDialog} onCloseAutoFocus={returnFocus} />
    case 'delete':
      return <DeleteDialog key={seq} open={open} blockId={p.blockId} onClose={closeStructureDialog} onCloseAutoFocus={returnFocus} />
  }
}

/**
 * B2 公式节点 / 工具条共用入口（slots.ts 契约）：open(initial, onSubmit) 打开公式对话框，
 * onSubmit 收到 $$…$$ 内文（不含 $$ 与标号）。
 */
export function useFormulaDialog(): { open(initial: string, onSubmit: (source: string) => void): void } {
  return FORMULA_DIALOG
}

const FORMULA_DIALOG = {
  open: (initial: string, onSubmit: (source: string) => void) => openFormulaDialog(initial, onSubmit),
}
