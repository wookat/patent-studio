import { baseKeymap, chainCommands, newlineInCode, splitBlock } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { keydownHandler } from 'prosemirror-keymap'
import type { Node as PmNode } from 'prosemirror-model'
import { NodeSelection, Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { schema } from './schema'

/** 编辑器对外动作（由 BlockEditor 注入；命令本身不碰 React） */
export interface EditorActions {
  submit(): void
  cancel(): void
  /** 打开公式对话框编辑 pos 处的 ps_equation */
  editEquation(pos: number): void
}

const { ps_heading, ps_equation, ps_cell } = schema.nodes

/** 按节点名判定：版面视图扩展 schema（layout-view/table/schema.ts）的同名节点也适用；ps_header_cell 是扩展 schema 的表头格 */
const isCell = (n: PmNode) => n.type.name === ps_cell.name || n.type.name === 'ps_header_cell'

/** 光标所在单元格深度；不在表格内返回 -1 */
function cellDepth(state: EditorState): number {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if (isCell($from.node(d))) return d
  return -1
}

/** Tab / Shift-Tab：按文档顺序移到下一 / 上一单元格并全选其文本；到头返回 false（让焦点自然离开 → 失焦提交） */
const cellNav =
  (dir: 1 | -1): Command =>
  (state, dispatch) => {
    const d = cellDepth(state)
    if (d < 0) return false
    const { $from } = state.selection
    const table = $from.node(d - 2)
    const tableStart = $from.start(d - 2)
    const cells: { pos: number; size: number }[] = []
    table.descendants((n, pos) => {
      if (isCell(n)) cells.push({ pos: tableStart + pos, size: n.content.size })
      return !isCell(n)
    })
    const i = cells.findIndex((c) => c.pos === $from.before(d))
    const next = cells[i + dir]
    if (!next) return false
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, next.pos + 1, next.pos + 1 + next.size)).scrollIntoView())
    return true
  }

const enterInCell: Command = (state) => cellDepth(state) >= 0

const withActions = (actions: EditorActions) => {
  const enterEquation: Command = (state) => {
    const sel = state.selection
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== ps_equation.name) return false
    actions.editEquation(sel.from)
    return true
  }
  const enterHeading: Command = (state) => {
    if (state.selection.$from.parent.type.name !== ps_heading.name) return false
    actions.submit()
    return true
  }
  const run = (f: () => void): Command => () => {
    f()
    return true
  }
  return {
    'Mod-Enter': run(actions.submit),
    Escape: run(actions.cancel),
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    Enter: chainCommands(enterEquation, enterInCell, enterHeading, newlineInCode, splitBlock),
    Tab: cellNav(1),
    'Shift-Tab': cellNav(-1),
  }
}

/**
 * 块编辑器键位（06 §5.2）。IME 组合中（event.isComposing / view.composing）不处理任何快捷键——
 * prosemirror-view 只在 compositionstart 之后短路 keydown，isComposing 仍需自己判。
 */
export function editorKeymap(actions: EditorActions): Plugin {
  const own = keydownHandler(withActions(actions))
  const base = keydownHandler(baseKeymap)
  return new Plugin({
    props: {
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false
        return own(view, event) || base(view, event)
      },
    },
  })
}
