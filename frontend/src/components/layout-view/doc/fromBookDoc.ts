import type { Node as PmNode } from 'prosemirror-model'
import { equationLine, TABLE_SPEC_OPEN, tableOptionTokens } from '@/components/block-model/edit/serialize'
import { expandMerges } from '../table/gfm'
import { serializeInline } from './inline'

/**
 * `(doc) → 整书 Markdown`（docs/plan/22 §2）。与 backend/patent_docx/patch.py serialize_block 逐字节一致的块序列化 +
 * 书级拼装：`lead` 个空行 + 各块（单空行相隔）+ `trail` 个空行 + 末尾换行。
 * 块 = 顶层节点；紧随 ps_table 的 ps_note 并入该表块（空行 + 注文）。权项 = 各段 / 公式各一行、无空行。
 * 文本块经 serializeInline 写回行内格式；代码块 / 公式 source 原样。`book='figures'` 的 doc 无 Markdown 形态 → 抛错。
 */
export function fromBookDoc(doc: PmNode): string {
  if (doc.attrs.book === 'figures') throw new Error('figures 书不经 Markdown 落盘（PUT /figures 逐图改写）')
  const blocks = bookBlocks(doc)
  const lead = Math.max(0, Number(doc.attrs.lead ?? 1))
  const trail = Math.max(0, Number(doc.attrs.trail ?? 1))
  const lines: string[] = []
  for (let i = 0; i < lead; i++) lines.push('')
  blocks.forEach((b, i) => {
    if (i > 0) lines.push('')
    lines.push(...b.lines)
  })
  for (let i = 0; i < trail; i++) lines.push('')
  return lines.join('\n') + '\n'
}

export interface BookBlockLines {
  /** 顶层节点 attrs.blockId（新建块为 null） */
  blockId: string | null
  lines: string[]
}

/** doc 顶层 → 块序列（ps_note 并入前一个表块）；每块行数组不含首尾空行 */
export function bookBlocks(doc: PmNode): BookBlockLines[] {
  const out: (BookBlockLines & { type: string })[] = []
  doc.forEach((n) => {
    const prev = out[out.length - 1]
    if (n.type.name === 'ps_note' && prev?.type === 'ps_table') {
      prev.lines.push('', inline(n))
      return
    }
    out.push({ blockId: (n.attrs.blockId as string | null) ?? null, lines: nodeLines(n), type: n.type.name })
  })
  return out.map(({ blockId, lines }) => ({ blockId, lines }))
}

const inline = (n: PmNode) => serializeInline(n.content)

function nodeLines(n: PmNode): string[] {
  switch (n.type.name) {
    case 'ps_para':
      return [inline(n)]
    case 'ps_heading':
      return [(n.attrs.level === 4 ? '#### ' : '### ') + inline(n)]
    case 'ps_equation':
      return [equationLine(n.attrs.source, n.attrs.label)]
    case 'ps_note':
      return ['', inline(n)]
    case 'ps_code':
      return ['```', ...n.textContent.split('\n'), '```']
    case 'ps_figure': {
      const w = Number(n.attrs.width) || 15
      return [`![${(n.attrs.alt as string | null) ?? ''}](figs/${n.attrs.file}){width=${w}}`]
    }
    case 'ps_claim': {
      const lines: string[] = []
      n.forEach((seg) => lines.push(...nodeLines(seg)))
      return lines
    }
    case 'ps_table':
      return tableLines(expandMerges(n))
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
    row.forEach((c) => cells.push(inline(c)))
    rows.push(cells)
  })
  const [head, ...body] = rows
  out.push('| ' + head.join(' | ') + ' |')
  out.push('| ' + head.map(() => '---').join(' | ') + ' |')
  for (const r of body) out.push('| ' + r.join(' | ') + ' |')
  return out
}
