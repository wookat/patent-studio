/**
 * 表格对话框的编辑模型 ↔ 内核表格行语法（与 backend/src/patent_studio/kernel/patch.py serialize_block 的 table 分支逐字节一致）：
 *
 *   <!-- 表格: 三线 重复表头 段号居左 列宽=30,70 表题后置=表1 xx -->   （无任一选项时省略整行）
 *   | 表头1 | 表头2 |
 *   | --- | --- |
 *   | 单元格 | ^^ |        （^^ = 与上一行同列单元格纵向合并，content.py 同款记号）
 *
 *   注：……                 （表注：空一行后紧跟，须以「注：」开头，内核据此归入本表）
 */
export interface TableSpec {
  /** rows[0] 为表头行 */
  rows: string[][]
  threeLine: boolean
  repeatHeader: boolean
  numLeft: boolean
  /** 保留自原块（对话框不编辑列宽） */
  colWidths: number[] | null
  captionAfter: string
  note: string
}

export const MERGE_UP = '^^'

export const emptyTableSpec = (rows = 3, cols = 3): TableSpec => ({
  rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
  threeLine: true,
  repeatHeader: false,
  numLeft: false,
  colWidths: null,
  captionAfter: '',
  note: '',
})

/** 竖线是行语法的分隔符，单元格内一律替换为 U+2223（内核 omml 也用同一字形） */
const cellText = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\u2223').trim()

const fmtWidth = (n: number) => String(Number(n.toPrecision(6)))

import { TABLE_SPEC_OPEN } from '../edit/serialize'

export function tableOptionTokens(spec: TableSpec): string[] {
  const toks: string[] = []
  if (spec.threeLine) toks.push('三线')
  if (spec.repeatHeader) toks.push('重复表头')
  if (spec.numLeft) toks.push('段号居左')
  if (spec.colWidths && spec.colWidths.length) toks.push('列宽=' + spec.colWidths.map(fmtWidth).join(','))
  const cap = spec.captionAfter.trim()
  if (cap) toks.push('表题后置=' + cap)
  return toks
}

export function tableMarkdown(spec: TableSpec): string {
  const cols = spec.rows[0]?.length ?? 0
  const out: string[] = []
  const toks = tableOptionTokens(spec)
  if (toks.length) out.push(TABLE_SPEC_OPEN + toks.join(' ') + ' -->')
  const [head = [], ...body] = spec.rows
  out.push('| ' + head.map(cellText).join(' | ') + ' |')
  out.push('| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |')
  for (const r of body) out.push('| ' + r.map(cellText).join(' | ') + ' |')
  const note = spec.note.trim()
  if (note) out.push('', note.startsWith('注：') ? note : '注：' + note)
  return out.join('\n')
}

/** 表格至少要有表头行 + 一个非空表头单元格才能提交（内核把首行当表头） */
export function tableProblem(spec: TableSpec): string | null {
  const head = spec.rows[0]
  if (!head || head.length === 0) return '表格至少需要一列'
  if (head.every((c) => !c.trim())) return '表头行不能全空'
  if (spec.rows.length < 2) return '表格至少需要一行数据'
  if (head.some((c) => c.trim() === MERGE_UP)) return '表头单元格不能使用 ^^ 合并'
  return null
}

// ---- 网格操作（纯函数，便于测试） ----

export const withCell = (spec: TableSpec, r: number, c: number, value: string): TableSpec => ({
  ...spec,
  rows: spec.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)),
})

export const addRow = (spec: TableSpec, at = spec.rows.length): TableSpec => {
  const cols = spec.rows[0]?.length ?? 1
  const rows = [...spec.rows]
  rows.splice(at, 0, Array.from({ length: cols }, () => ''))
  return { ...spec, rows }
}

export const removeRow = (spec: TableSpec, at: number): TableSpec =>
  spec.rows.length <= 2 ? spec : { ...spec, rows: spec.rows.filter((_, i) => i !== at) }

export const addCol = (spec: TableSpec, at = spec.rows[0]?.length ?? 0): TableSpec => ({
  ...spec,
  colWidths: null,
  rows: spec.rows.map((row) => {
    const r = [...row]
    r.splice(at, 0, '')
    return r
  }),
})

export const removeCol = (spec: TableSpec, at: number): TableSpec =>
  (spec.rows[0]?.length ?? 0) <= 1 ? spec : { ...spec, colWidths: null, rows: spec.rows.map((row) => row.filter((_, j) => j !== at)) }

/** 切换单元格「与上合并」：非首行才允许 */
export const toggleMergeUp = (spec: TableSpec, r: number, c: number): TableSpec =>
  r === 0 ? spec : withCell(spec, r, c, spec.rows[r][c] === MERGE_UP ? '' : MERGE_UP)
