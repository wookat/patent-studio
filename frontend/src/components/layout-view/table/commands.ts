import type { Node as PmNode } from 'prosemirror-model'
import { type Command, type EditorState, type Plugin, TextSelection, type Transaction } from 'prosemirror-state'
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  findTable,
  goToNextCell,
  isInTable,
  mergeCells,
  selectedRect,
  splitCell,
  tableEditing,
  tableNodeTypes,
} from 'prosemirror-tables'
import { keymap } from 'prosemirror-keymap'
import type { TableCommand } from './TableToolbar'

/** 内核约束：表头 + 至少一行数据（content.py / TableDialog removeRow 同规则） */
export const MIN_ROWS = 2

export interface TableOptionState {
  three_line: boolean
  repeat_header: boolean
  num_left: boolean
  col_widths: number[] | null
  caption_after: string | null
  width: number
  height: number
}

/** 光标所在表格的选项与尺寸；不在表格中 → null */
export function tableOptionState(state: EditorState): TableOptionState | null {
  if (!isInTable(state)) return null
  const found = findTable(state.selection.$from)
  if (!found) return null
  const { three_line, repeat_header, num_left, col_widths, caption_after } = found.node.attrs
  const map = TableMap.get(found.node)
  return { three_line, repeat_header, num_left, col_widths, caption_after, width: map.width, height: map.height }
}

/** 光标所在表格紧随其后若挂 ps_note 表注则返回其位置与节点；无则 null（批69：表注是表的兄弟 textblock） */
export function tableNote(state: EditorState): { pos: number; node: PmNode } | null {
  if (!isInTable(state)) return null
  const found = findTable(state.selection.$from)
  if (!found) return null
  const $end = state.doc.resolve(found.pos + found.node.nodeSize)
  const next = $end.nodeAfter
  return $end.depth === 0 && next && next.type.name === 'ps_note' ? { pos: $end.pos, node: next } : null
}

/**
 * 表题后置 + 表注一笔写入（批69）：caption null/空白=清除；表注文本经「注：」前缀归一
 * （与 tableMarkdown / 内核归表语法同口径）——无表注写文本=插兄弟 ps_note，空文本=删节点，其余=整节点重写。
 */
export const applyCaptionNote =
  (caption: string | null, noteText: string): Command =>
  (state, dispatch) => {
    const found = findTable(state.selection.$from)
    if (!found) return false
    const trimmed = noteText.trim()
    const prefixed = trimmed ? (trimmed.startsWith('注：') ? trimmed : '注：' + trimmed) : ''
    const tr = state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      caption_after: caption?.trim() || null,
    })
    const end = tr.mapping.map(found.pos + found.node.nodeSize)
    const $end = tr.doc.resolve(end)
    const next = $end.nodeAfter
    const hasNote = $end.depth === 0 && next && next.type.name === 'ps_note'
    if (hasNote) {
      const noteType = state.schema.nodes.ps_note
      if (prefixed) tr.replaceWith($end.pos, $end.pos + next.nodeSize, noteType.create(null, state.schema.text(prefixed)))
      else tr.delete($end.pos, $end.pos + next.nodeSize)
    } else if (prefixed) {
      tr.insert(end, state.schema.nodes.ps_note.create(null, state.schema.text(prefixed)))
    }
    if (!dispatch) return true
    dispatch(tr)
    return true
  }

/** 首行 = 表头（ps_header_cell），其余行 = ps_cell；每个命令后修正（加行到表头上方 / 拆分表头单元都会打破） */
function fixHeaderRow(tr: Transaction, tablePos: number): void {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return
  const types = tableNodeTypes(table.type.schema)
  const fixes: { pos: number; type: PmNode['type'] }[] = []
  table.forEach((row, rowOffset, r) => {
    const want = r === 0 ? types.header_cell : types.cell
    row.forEach((cell, cellOffset) => {
      if (cell.type !== want) fixes.push({ pos: tablePos + 1 + rowOffset + 1 + cellOffset, type: want })
    })
  })
  for (const f of fixes) {
    const cell = tr.doc.nodeAt(f.pos)
    if (cell) tr.setNodeMarkup(f.pos, f.type, cell.attrs, cell.marks)
  }
}

const withHeaderFix =
  (inner: Command, resetColWidths = false): Command =>
  (state, dispatch) => {
    const found = findTable(state.selection.$from)
    if (!found) return false
    return inner(
      state,
      dispatch &&
        ((tr) => {
          const pos = tr.mapping.map(found.pos)
          fixHeaderRow(tr, pos)
          if (resetColWidths) {
            const t = tr.doc.nodeAt(pos)
            if (t && t.attrs.col_widths) tr.setNodeMarkup(pos, undefined, { ...t.attrs, col_widths: null })
          }
          dispatch(tr)
        }),
    )
  }

const guardRows: Command = (state) => (tableOptionState(state)?.height ?? 0) > MIN_ROWS
const guardCols: Command = (state) => (tableOptionState(state)?.width ?? 0) > 1

const both =
  (guard: Command, cmd: Command): Command =>
  (state, dispatch, view) =>
    guard(state) && cmd(state, dispatch, view)

/** 竖向合并：光标单元与其正下方单元（同列、均无横向跨列）合成一个 rowspan 单元 → 落源码时下方为 `^^` */
const mergeDown: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  const { map, table, tableStart } = rect
  if (rect.right - rect.left !== 1 || rect.bottom >= map.height) return false
  const anchor = map.map[rect.top * map.width + rect.left]
  const below = map.map[rect.bottom * map.width + rect.left]
  if (!below || below === anchor) return false
  const belowNode = table.nodeAt(below)
  if (!belowNode || belowNode.attrs.colspan !== 1) return false
  if (rect.left > 0 && map.map[rect.bottom * map.width + rect.left - 1] === below) return false
  if (!dispatch) return true
  const sel = CellSelection.create(state.doc, tableStart + anchor, tableStart + below)
  const withSel = state.apply(state.tr.setSelection(sel))
  return mergeCells(withSel, (tr) => {
    const cellPos = tr.mapping.map(tableStart + anchor)
    const cell = tr.doc.nodeAt(cellPos)
    if (cell) tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + cell.nodeSize - 1), -1))
    dispatch(tr)
  })
}

const toggleOption =
  (key: 'three_line' | 'repeat_header' | 'num_left'): Command =>
  (state, dispatch) => {
    const found = findTable(state.selection.$from)
    if (!found) return false
    dispatch?.(state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, [key]: !found.node.attrs[key] }))
    return true
  }

/** 列宽输入 → 权重数组；空 = null（清除），非正数 → null */
export const parseColWidths = (text: string): number[] | null => {
  const t = text.trim()
  if (!t) return null
  const nums = t.split(/[,，\s]+/).map(Number)
  return nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null
}

/** 列宽（相对权重，与 `<!-- 表格: 列宽=1,2.5 -->` 同义）；null = 清除 */
export const setColWidths =
  (widths: number[] | null): Command =>
  (state, dispatch) => {
    const found = findTable(state.selection.$from)
    if (!found) return false
    if (widths && widths.length !== TableMap.get(found.node).width) return false
    dispatch?.(state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, col_widths: widths }))
    return true
  }

const COMMANDS: Record<Exclude<TableCommand, 'col-widths' | 'caption-note'>, Command> = {
  'row-before': withHeaderFix(addRowBefore),
  'row-after': withHeaderFix(addRowAfter),
  'col-before': withHeaderFix(addColumnBefore, true),
  'col-after': withHeaderFix(addColumnAfter, true),
  'delete-row': both(guardRows, withHeaderFix(deleteRow)),
  'delete-col': both(guardCols, withHeaderFix(deleteColumn, true)),
  'merge-down': withHeaderFix(mergeDown),
  split: withHeaderFix(splitCell),
  'three-line': toggleOption('three_line'),
  'repeat-header': toggleOption('repeat_header'),
  'num-left': toggleOption('num_left'),
}

/** TableCommand → ProseMirror Command（col-widths / caption-note 需要参数或走专属写口） */
export const tableCommand = (cmd: Exclude<TableCommand, 'col-widths' | 'caption-note'>): Command => COMMANDS[cmd]

/** 工具条禁用态：命令在当前 state 下是否可执行（不 dispatch） */
export const canRunTableCommand = (state: EditorState, cmd: TableCommand): boolean =>
  cmd === 'col-widths' || cmd === 'caption-note' ? isInTable(state) : COMMANDS[cmd](state)

/** 表格快捷键（Word / Typora 惯例）：Mod-Alt-↑↓ 加行、Mod-Alt-←→ 加列、Mod-Alt-Backspace 删行、Tab / Shift-Tab 换格 */
export function tableKeymap(): Plugin {
  return keymap({
    'Mod-Alt-ArrowDown': COMMANDS['row-after'],
    'Mod-Alt-ArrowUp': COMMANDS['row-before'],
    'Mod-Alt-ArrowRight': COMMANDS['col-after'],
    'Mod-Alt-ArrowLeft': COMMANDS['col-before'],
    'Mod-Alt-Backspace': COMMANDS['delete-row'],
    Tab: goToNextCell(1),
    'Shift-Tab': goToNextCell(-1),
  })
}

/** D3 把这些追加到版面视图 EditorState.plugins 末尾（tableEditing 要在其它键盘 / 鼠标插件之后） */
export const tablePlugins = (): Plugin[] => [tableKeymap(), tableEditing()]
