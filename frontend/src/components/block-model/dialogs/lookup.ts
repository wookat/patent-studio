import type { Ast, AstBlock, BookName, DescriptionPart } from '@/types/ast'
import { findBlockLines } from '@/store'

/** 可编辑块（摘要段 / 权项 / 说明书块）本体；title / 摘要整块 / figures 不在内（与 findBlockLines 同范围） */
export function findBlock(ast: Ast, id: string): AstBlock | null {
  return (
    ast.abstract.paragraphs.find((p) => p.id === id) ??
    ast.claims.find((c) => c.id === id) ??
    ast.description.find((b) => b.id === id) ??
    null
  )
}

/** 插入 / 公式 / 表格 操作的目标书：可编辑块 → 其书；摘要整块 → abstract；标题 / 附图 → null */
/** 「在此后插入」的锚点：摘要整块选中时锚到最后一段（无段则书首） */
export function insertAnchor(ast: Ast, id: string | null): { after_block_id: string } | { book: BookName } | null {
  if (!id) return null
  if (id === ast.abstract.id) {
    const last = ast.abstract.paragraphs.at(-1)
    return last ? { after_block_id: last.id } : { book: 'abstract' }
  }
  return findBlockLines(ast, id) ? { after_block_id: id } : null
}

export const KIND_LABELS: Record<AstBlock['kind'], string> = {
  abstract: '摘要',
  paragraph: '段落',
  claim: '权项',
  section: '章节',
  subsection: '小节',
  equation: '公式',
  table: '表格',
  code: '代码块',
  figure: '内嵌图',
}

const STATUTORY_PARTS: ReadonlySet<DescriptionPart> = new Set([
  'technical-field',
  'background-art',
  'disclosure',
  'description-of-drawings',
  'mode-for-invention',
])

export const STATUTORY_PART_LABELS: Record<DescriptionPart, string> = {
  'technical-field': '技术领域',
  'background-art': '背景技术',
  disclosure: '发明内容',
  'description-of-drawings': '附图说明',
  'mode-for-invention': '具体实施方式',
  other: '',
}

/** 「删除块」入口的禁用原因（title 展示）；null = 可删。口径同后端 patch.delete_block：
    法定章节硬拒、title / 摘要整块 / figures 不在可编辑块集内（findBlock 同范围） */
export function deleteDisabledReason(ast: Ast | null, id: string | null): string | null {
  if (!id) return '先选中一个块'
  const b = ast ? findBlock(ast, id) : null
  if (!b) return '该块不可删除'
  if (b.kind === 'section' && STATUTORY_PARTS.has(b.part)) return '法定章节不能删除'
  return null
}

/** 删除该块的额外风险提示（法定章节 / 独立权项），无则 null */
export function deleteWarning(ast: Ast, block: AstBlock): string | null {
  if (block.kind === 'section' && STATUTORY_PARTS.has(block.part)) {
    return `「${block.title}」是说明书法定章节（${STATUTORY_PART_LABELS[block.part]}），删除后该章其余块并入上一章，lint 将报缺章。`
  }
  if (block.kind === 'claim') {
    const dependents = ast.claims.filter((c) => c.id !== block.id && c.refs.some((r) => r.targets.includes(block.num)))
    if (dependents.length) return `权项 ${dependents.map((c) => c.num).join('、')} 引用了本权项，删除后其引用将失效。`
    if (block.claim_kind === 'independent') return '这是独立权项。'
  }
  return null
}

/** 块的可读摘要：类型 + 首行（截断） */
export function blockSummary(block: AstBlock, source: string | null, max = 60): { kind: string; excerpt: string } {
  const kind = KIND_LABELS[block.kind]
  let first = ''
  switch (block.kind) {
    case 'section':
    case 'subsection':
      first = block.title
      break
    case 'equation':
      first = block.source
      break
    case 'table':
      first = block.rows[0]?.join(' | ') ?? ''
      break
    default:
      first = source?.split('\n').find((l) => l.trim()) ?? ''
  }
  first = first.trim()
  return { kind, excerpt: first.length > max ? first.slice(0, max) + '…' : first }
}


