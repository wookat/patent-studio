import type { Node as PmNode } from 'prosemirror-model'
import type { EditableBlock } from '../slots'
import type { AstTable, TableOptions } from '@/types/ast'
import { schema } from './schema'

/**
 * AST 块 ⇄ ProseMirror doc ⇄ 内核 Markdown 行。
 * fromDoc 与 backend/patent_docx/patch.py serialize_block 逐字节一致（golden：两案每个块 fromDoc(toDoc(b)) === blockSource）。
 * 不含块间空行；不含段号 / 权项号 / 图号等内核生成物（生成物由 BlockEditor 用只读装饰呈现）。
 */

const { ps_para, ps_heading, ps_equation, ps_table, ps_row, ps_cell, ps_note, ps_code } = schema.nodes

const textOf = (s: string) => (s ? [schema.text(s)] : [])

const para = (s: string) => ps_para.create(null, textOf(s))
const equation = (source: string, label: string | null, mathml: string | null) =>
  ps_equation.create({ source, label: label ?? '', mathml })

export function toDoc(block: EditableBlock): PmNode {
  switch (block.kind) {
    case 'paragraph':
      return schema.node('doc', null, [para(block.text)])
    case 'section':
    case 'subsection':
      return schema.node('doc', null, [ps_heading.create({ level: block.kind === 'section' ? 3 : 4 }, textOf(block.title))])
    case 'equation':
      return schema.node('doc', null, [equation(block.source, block.label, block.mathml)])
    case 'claim':
      return schema.node(
        'doc',
        null,
        block.segments.map((s) => (s.kind === 'equation' ? equation(s.text, null, s.mathml) : para(s.text))),
      )
    case 'code':
      return schema.node('doc', null, [ps_code.create(null, textOf(block.code_lines.join('\n')))])
    case 'figure':
      return schema.node('doc', null, [para(figureLine(block))])
    case 'table':
      return tableDoc(block)
  }
}

/** 内嵌图块以源码行形态进编辑器（编辑器是文本面）；与 backend serialize_block 同输出 */
const figureLine = (b: { file: string; width: number; alt: string }) =>
  `![${b.alt}](figs/${b.file}){width=${Number.isInteger(b.width) ? b.width : b.width.toFixed(2).replace(/\.?0+$/, '')}}`

function tableDoc(t: AstTable): PmNode {
  const rows = t.rows.map((r) => ps_row.create(null, r.map((c) => ps_cell.create(null, textOf(c)))))
  const table = ps_table.create({ ...t.options, caption_after: t.caption_after?.text ?? null }, rows)
  const nodes = [table]
  if (t.note) nodes.push(ps_note.create(null, textOf(t.note.text)))
  return schema.node('doc', null, nodes)
}

/** 与 patch.py `_table_option_tokens` 一致 */
/** 表格选项注释标记（与 backend/patent_docx/content.py TABLE_SPEC_OPEN 同义；写点统一引用，防全角冒号类漂移） */
export const TABLE_SPEC_OPEN = '<!-- 表格: '

export function tableOptionTokens(options: TableOptions, captionAfter: string | null): string[] {
  const toks: string[] = []
  if (options.three_line) toks.push('三线')
  if (options.repeat_header) toks.push('重复表头')
  if (options.num_left) toks.push('段号居左')
  if (options.col_widths?.length) toks.push('列宽=' + options.col_widths.map(fmtNum).join(','))
  if (captionAfter) toks.push('表题后置=' + captionAfter)
  return toks
}

/** Python `%g`：最多 6 位有效数字，去掉多余的 0 */
function fmtNum(x: number): string {
  return String(Number(x.toPrecision(6)))
}

export const equationLine = (source: string, label: string) => `$$${source}$$ ${label}`.trimEnd()

/** PM doc → Markdown 行；首尾空行剔除（§4.3 法则：块不含前后空行） */
export function fromDoc(doc: PmNode): string[] {
  const out: string[] = []
  doc.forEach((n) => out.push(...nodeLines(n)))
  while (out.length && out[0] === '') out.shift()
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** 按节点名而非 NodeType 实例分派：版面视图扩展 schema（layout-view/table/schema.ts）同名节点也走这一条序列化路 */
function nodeLines(n: PmNode): string[] {
  switch (n.type.name) {
    case ps_para.name:
      return [n.textContent]
    case ps_heading.name:
      return [(n.attrs.level === 4 ? '#### ' : '### ') + n.textContent]
    case ps_equation.name:
      return [equationLine(n.attrs.source, n.attrs.label)]
    case ps_note.name:
      return ['', n.textContent]
    case ps_code.name:
      return ['```', ...n.textContent.split('\n'), '```']
    case ps_table.name:
      return tableLines(n)
    default:
      return []
  }
}

function tableLines(t: PmNode): string[] {
  const out: string[] = []
  const { three_line, repeat_header, num_left, col_widths, caption_after } = t.attrs
  const toks = tableOptionTokens({ three_line, repeat_header, num_left, col_widths }, caption_after)
  if (toks.length) out.push(TABLE_SPEC_OPEN + toks.join(' ') + ' -->')
  const rows: string[][] = []
  t.forEach((row) => {
    const cells: string[] = []
    row.forEach((c) => cells.push(c.textContent))
    rows.push(cells)
  })
  const [head, ...body] = rows
  out.push('| ' + head.join(' | ') + ' |')
  out.push('| ' + head.map(() => '---').join(' | ') + ' |')
  for (const r of body) out.push('| ' + r.join(' | ') + ' |')
  return out
}

export const serialize = (doc: PmNode) => fromDoc(doc).join('\n')
