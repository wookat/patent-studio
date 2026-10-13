import { Schema, type NodeSpec } from 'prosemirror-model'
import type { PsSchema } from '@/components/block-model/edit/schema'

/**
 * 给现 ps_table / ps_row / ps_cell 加 prosemirror-tables 需要的 tableRole 与 cell attrs（16 §4.2），不改 block-model/edit/schema.ts。
 * serialize.ts 不读 colspan/rowspan/colwidth，序列化不变；竖向合并（rowspan>1）由 D2 的 toGfmRows 展开为下方 `^^`。
 * 首行单元格用 header_cell 角色（GFM 首行即表头）。
 */
export function withTableRoles(base: PsSchema): Schema {
  const nodes = base.spec.nodes
  const cell = nodes.get('ps_cell') as NodeSpec
  const cellAttrs = {
    ...cell.attrs,
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null as number[] | null },
  }
  const patched = nodes
    .update('ps_table', { ...(nodes.get('ps_table') as NodeSpec), tableRole: 'table' })
    .update('ps_row', { ...(nodes.get('ps_row') as NodeSpec), content: '(ps_cell | ps_header_cell)+', tableRole: 'row' })
    .update('ps_cell', { ...cell, attrs: cellAttrs, tableRole: 'cell' })
    .addToEnd('ps_header_cell', {
      ...cell,
      attrs: cellAttrs,
      tableRole: 'header_cell',
      toDOM: () => ['th', { class: 'ps-cell' }, 0],
      parseDOM: [{ tag: 'th' }],
    })
  return new Schema({ nodes: patched, marks: base.spec.marks })
}
