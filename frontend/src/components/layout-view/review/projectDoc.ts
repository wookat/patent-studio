import { Fragment, type Node as PmNode, type Mark } from 'prosemirror-model'
import type { MarkupLevel } from './markupLevel'
import { hiddenRanges, parseCriticLine } from './criticParse'

interface Cell {
  ch: string
  marks: readonly Mark[]
  /** 非文本叶子（原样保留） */
  leaf?: PmNode
}

/**
 * 只读投影：按档位去掉标记符与不该显示的一侧，marks 逐字符保留（`{++**a**++}` 投影后 a 仍加粗）。
 * all 返回原 doc（装饰层负责渲染）；投影结果只用于展示，绝不回写 / 绝不经 fromBookDoc 落盘。
 * 依赖 prosemirror-model 实体——与 markupLevel.ts（纯映射，store 也用）分开，避免把 PM 拉进首屏分包。
 */
export function projectDoc(doc: PmNode, level: MarkupLevel): PmNode {
  if (level === 'all') return doc
  const walk = (node: PmNode): PmNode => {
    if (node.isTextblock) return projectTextblock(node, level)
    if (node.isLeaf) return node
    const kids: PmNode[] = []
    node.forEach((c) => kids.push(walk(c)))
    return node.copy(Fragment.from(kids))
  }
  return walk(doc)
}

function projectTextblock(node: PmNode, level: MarkupLevel): PmNode {
  const cells: Cell[] = []
  let text = ''
  node.forEach((c) => {
    if (c.isText) {
      const t = c.text ?? ''
      // 逐 UTF-16 单元，与 parseCriticLine / CriticMark.from 的偏移同口径
      for (let i = 0; i < t.length; i++) {
        cells.push({ ch: t[i]!, marks: c.marks })
        text += t[i]
      }
    } else {
      cells.push({ ch: '\uFFFC', marks: c.marks, leaf: c })
      text += '\uFFFC'
    }
  })
  const spans = parseCriticLine(text)
  if (spans.length === 0) return node
  const hidden = hiddenRanges(spans, level)
  const keep = cells.filter((_, i) => !hidden.some(([a, b]) => i >= a && i < b))
  const schema = node.type.schema
  const out: PmNode[] = []
  let buf = ''
  let bufMarks: readonly Mark[] | null = null
  const flush = () => {
    if (buf && bufMarks) out.push(schema.text(buf, bufMarks))
    buf = ''
    bufMarks = null
  }
  for (const c of keep) {
    if (c.leaf) {
      flush()
      out.push(c.leaf)
      continue
    }
    if (bufMarks && !sameMarks(bufMarks, c.marks)) flush()
    bufMarks = c.marks
    buf += c.ch
  }
  flush()
  return node.copy(Fragment.from(out))
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) => a.length === b.length && a.every((m, i) => m.eq(b[i]!))
