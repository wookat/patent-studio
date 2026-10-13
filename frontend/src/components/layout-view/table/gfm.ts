import type { Node as PmNode, NodeType } from 'prosemirror-model'
import { TableMap } from 'prosemirror-tables'
import { schema } from '@/components/block-model/edit/schema'
import { serialize, toDoc } from '@/components/block-model/edit/serialize'
import type { EditableBlock } from '@/components/block-model/slots'
import { withTableRoles } from './schema'

/**
 * 版面视图表格 ↔ GFM 源码（16 §5「落源码」）。
 * 唯一的语义转换是 `^^`（content.py 竖向合并标记）↔ rowspan：进编辑器时把 `^^` 单元折叠进上方单元的 rowspan，
 * 出编辑器时按 TableMap 展开回 `^^` 行；其余全部交给 block-model/edit/serialize.ts（GFM 文本拼装，不解析 Markdown）。
 */
export const layoutSchema = withTableRoles(schema)
export const MERGE_UP = '^^'

const { ps_table } = layoutSchema.nodes

/** 按表格自身 schema 取节点类型：W9 整书 bookSchema 与 layoutSchema 同名节点共用这两条折叠 / 展开路 */
const tableTypes = (table: PmNode) => {
  const { ps_table, ps_cell, ps_header_cell } = table.type.schema.nodes
  return { ps_table, ps_cell, ps_header_cell }
}

const cellWithSpan = (type: NodeType, cell: PmNode, rowspan: number) =>
  type.create({ ...cell.attrs, colspan: 1, rowspan, colwidth: null }, cell.content, cell.marks)

/** 进编辑器：`^^` 单元并入同列最近的非 `^^` 单元（rowspan+1）；首行为表头（ps_header_cell）。表头行上的 `^^` 无上方单元，保留原文。 */
export function collapseMerges(table: PmNode): PmNode {
  const { ps_table, ps_cell, ps_header_cell } = tableTypes(table)
  const rows = table.children.map((r) => r.children)
  const span: number[][] = rows.map((cells) => cells.map(() => 1))
  const owner: (readonly [number, number] | undefined)[] = []
  rows.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      const up = owner[c]
      if (cell.textContent === MERGE_UP && up) {
        span[up[0]][up[1]] += 1
        span[r][c] = 0
      } else {
        owner[c] = [r, c]
      }
    })
  })
  const newRows = table.children.map((row, r) =>
    row.type.create(
      row.attrs,
      row.children.flatMap((cell, c) => (span[r][c] === 0 ? [] : [cellWithSpan(r === 0 ? ps_header_cell : ps_cell, cell, span[r][c])])),
    ),
  )
  return ps_table.create(table.attrs, newRows)
}

/** 出编辑器：rowspan>1 的单元在下方各行落 `^^`；colspan>1（内核不支持，仅粘贴可能带入）落空单元占位保持矩形。 */
export function expandMerges(table: PmNode): PmNode {
  const { ps_table, ps_cell } = tableTypes(table)
  const map = TableMap.get(table)
  const { width, height } = map
  const empty = (text: string) => ps_cell.create(null, text ? table.type.schema.text(text) : null)
  const rows: PmNode[] = []
  for (let r = 0; r < height; r++) {
    const cells: PmNode[] = []
    for (let c = 0; c < width; c++) {
      const pos = map.map[r * width + c]
      if (!pos) continue
      if (r > 0 && map.map[(r - 1) * width + c] === pos) cells.push(empty(MERGE_UP))
      else if (c > 0 && map.map[r * width + c - 1] === pos) cells.push(empty(''))
      else {
        const cell = table.nodeAt(pos)
        if (cell) cells.push(cellWithSpan(cell.type, cell, 1))
      }
    }
    rows.push(table.child(r).type.create(table.child(r).attrs, cells))
  }
  return ps_table.create(table.attrs, rows)
}

const mapTables = (doc: PmNode, f: (t: PmNode) => PmNode): PmNode =>
  doc.type.create(
    doc.attrs,
    doc.children.map((n) => (n.type.name === ps_table.name ? f(n) : n)),
  )

/** AST 块 → 版面 schema 文档（toDoc 后换到带 tableRole 的 schema 并折叠 `^^`） */
export function toLayoutDoc(block: EditableBlock): PmNode {
  return mapTables(layoutSchema.nodeFromJSON(toDoc(block).toJSON()), collapseMerges)
}

/** 版面 schema 文档 → 块 Markdown（展开 `^^` 后走现有 serialize，与后端 serialize_block 逐字节一致） */
export function serializeLayout(doc: PmNode): string {
  return serialize(mapTables(doc, expandMerges))
}

/** 仅表格文本：toLayoutDoc → serializeLayout 的表格部分（供工具条 / 测试直接拼装） */
export function tableSource(table: PmNode): string[] {
  return serializeLayout(layoutSchema.node('doc', null, [table])).split('\n')
}
