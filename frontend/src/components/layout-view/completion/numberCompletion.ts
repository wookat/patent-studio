import type { Ast } from '@/types/ast'

/** 编号补全候选（16 §4.4）：图 / 表 / 式，数据只来自 AST */
export type NumberKind = '图' | '表' | '式'

export interface NumberCandidate {
  kind: NumberKind
  /** 插入的纯文本，如 `图3` `表2` `式（1）` */
  label: string
  /** 来源块 id（附图为 `figure:<num>`），供选中后滚动定位 */
  blockId: string
}

/** 输入「图」「表」「式」后的候选；无候选 → []（不弹） */
export function numberCandidates(ast: Ast | null, kind: NumberKind): NumberCandidate[] {
  if (!ast) return []
  if (kind === '图') return ast.figures.map((f) => ({ kind, label: `图${f.num}`, blockId: `figure:${f.num}` }))
  const out: NumberCandidate[] = []
  for (const b of ast.description) {
    if (kind === '表' && b.kind === 'paragraph' && b.role === 'table-caption') {
      const m = /^表(\d+)/.exec(b.text)
      if (m) out.push({ kind, label: `表${m[1]}`, blockId: b.id })
    } else if (kind === '式' && b.kind === 'equation' && b.label) {
      out.push({ kind, label: `式${b.label}`, blockId: b.id })
    }
  }
  return out
}
