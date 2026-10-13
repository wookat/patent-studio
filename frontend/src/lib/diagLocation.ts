import { blockLabel } from '@/components/review/reviewUtils'
import { BOOK_LABELS } from '@/lib/docset'
import type { Ast } from '@/types/ast'
import { blockAtLine } from '@/types/ast'

export interface DiagAnchor {
  /** content.md 全文 1-based 行；无法定位时为 null */
  line: number | null
  /** 后端章节字样，如 '摘要' | '权利要求书' | '说明书/背景技术' */
  section?: string | null
  /** AST 块 id（体检项自带；诊断没有时按行折算） */
  blockId?: string | null
}

/**
 * 诊断 / 体检项的用户可读位置：「权利要求 3」「说明书 · 段落 [0012]」「摘要」——
 * 不出现 content.md、源码行号、块 id 等实现细节；行号只用于点击定位。
 * AST 缺失或行落在块之外时退化为后端章节字样（'/' 改为 ' · '），再退化为「全文」。
 */
export function diagLocationLabel(d: DiagAnchor, ast: Ast | null): string {
  if (ast) {
    if (d.blockId?.startsWith('figures/')) {
      const fig = ast.figures.find((f) => f.id === d.blockId)
      if (fig?.num != null) return `图 ${fig.num}`
    }
    const loc = d.line != null ? blockAtLine(ast, d.line) : null
    const id = d.blockId && !d.blockId.startsWith('figures/') ? d.blockId : (loc?.block.id ?? null)
    const book = loc?.book ?? bookOfId(id)
    if (id && book) {
      const label = blockLabel(ast, id)
      const bookLabel = BOOK_LABELS[book]
      if (label === id) return bookLabel
      if (book === 'abstract' || label === bookLabel || label === '说明书摘要') return bookLabel
      if (book === 'claims') return label
      return `${bookLabel} · ${label}`
    }
  }
  if (d.section) return d.section.split('/').filter(Boolean).join(' · ')
  if (ast && d.line != null) {
    if (d.line === ast.title.line) return '标题'
    const book = bookByOffset(ast, d.line)
    if (book) return BOOK_LABELS[book]
  }
  return '全文'
}

/** 行落在块之外（`## 书名` 标题行、书间空行）时按各书 offset 判断所属书 */
function bookByOffset(ast: Ast, line: number): 'abstract' | 'claims' | 'description' | null {
  const books = (['abstract', 'claims', 'description'] as const)
    .map((b) => ({ b, start: ast.books[b].offset }))
    .filter((x) => x.start > 0 && x.start <= line)
    .sort((x, y) => y.start - x.start)
  return books[0]?.b ?? null
}

/**
 * 紧凑位置芯片（术语表 / 标记表 / 在线成员等一行里要放多个位置的场合）：
 * 「权利要求 3」「[0012]」「摘要」「技术领域」；AST 未就位时退到「全文」——不出现源码行号。
 */
export function lineChipLabel(line: number, ast: Ast | null): string {
  const full = diagLocationLabel({ line }, ast)
  const m = /段落 \[(\d+)\]$/.exec(full)
  if (m) return `[${m[1]}]`
  return full.startsWith('说明书 · ') ? full.slice('说明书 · '.length) : full
}

function bookOfId(id: string | null) {
  if (!id) return null
  if (id === 'abstract' || id.startsWith('abstract/')) return 'abstract' as const
  if (id === 'claims' || id.startsWith('claims/')) return 'claims' as const
  if (id === 'description' || id.startsWith('description/')) return 'description' as const
  return null
}
