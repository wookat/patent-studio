import type { Ast, AstClaim, BookName, DescriptionBlock } from '@/types/ast'
import type { PublicCommentIn } from '@/types/public-share'
export type PublicAnchor = PublicCommentIn['anchor']

/** 批注引文上限（与审阅面板一致：太长的拖选只取前 120 字，服务端重锚按前缀找） */
export const QUOTE_MAX = 120

/** 服务端 reanchor 逐源码行找 quote，引文必须落在单行内：只取首行，折叠空白 */
const clip = (s: string) => {
  const t = s.split('\n')[0].replace(/\s+/g, ' ').trim()
  return t.length > QUOTE_MAX ? t.slice(0, QUOTE_MAX) : t
}

const fullLine = (ast: Ast, book: BookName, relStart: number) => ast.books[book].offset + relStart

function descriptionText(b: DescriptionBlock): string {
  switch (b.kind) {
    case 'paragraph':
      return b.text
    case 'section':
    case 'subsection':
      return b.title
    case 'equation':
      return b.source
    case 'table':
      return [...b.rows.flat(), b.caption_after?.text ?? '', b.note?.text ?? ''].join('\n')
    case 'code':
      return b.code_lines.join('\n')
    case 'figure':
      return b.alt || b.file
  }
}

/** 每段一行源码，以换行拼接：clip 取首段，anchorForQuote 整体搜 */
const claimText = (c: AstClaim) => c.segments.map((s) => s.text).join('\n')

/**
 * 块 → 批注锚点（版面视图里点某块「有意见」）：block_id + 全文起始行 + 块首 120 字作引文。
 */
export function anchorForBlock(ast: Ast, blockId: string): PublicAnchor | null {
  if (blockId === 'title') return { block_id: 'title', line: ast.title.line, quote: clip(ast.title.text), book: 'abstract' }
  const p = ast.abstract.paragraphs.find((x) => x.id === blockId)
  if (p) return { block_id: p.id, line: fullLine(ast, 'abstract', p.lines.start), quote: clip(p.text), book: 'abstract' }
  if (ast.abstract.id === blockId) {
    return { block_id: ast.abstract.id, line: fullLine(ast, 'abstract', ast.abstract.lines.start), quote: clip(ast.abstract.paragraphs[0]?.text ?? ''), book: 'abstract' }
  }
  const c = ast.claims.find((x) => x.id === blockId)
  if (c) return { block_id: c.id, line: fullLine(ast, 'claims', c.lines.start), quote: clip(claimText(c)), book: 'claims' }
  const d = ast.description.find((x) => x.id === blockId)
  if (d) return { block_id: d.id, line: fullLine(ast, 'description', d.lines.start), quote: clip(descriptionText(d)), book: 'description' }
  return null
}

/**
 * 拖选文字 → 批注锚点（PDF 文字层 / 版面选区）：在 AST 三书里找包含该引文的块（摘要 → 权项 → 说明书），
 * 找不到（页眉页脚、段号等排版生成物）时锚到标题块，引文照录，服务端 GET /comments 重锚会标 stale。
 */
export function anchorForQuote(ast: Ast, rawQuote: string): PublicAnchor {
  // PDF 文字层 / 版面的折行不是源码换行：去掉换行后再截首 120 字
  const quote = clip(rawQuote.replace(/\s*\n\s*/g, ''))
  const probe = quote.replace(/\s+/g, '')
  const hit = (text: string) => probe.length > 0 && text.replace(/\s+/g, '').includes(probe)

  for (const p of ast.abstract.paragraphs) {
    if (hit(p.text)) return { block_id: p.id, line: fullLine(ast, 'abstract', p.lines.start), quote, book: 'abstract' }
  }
  for (const c of ast.claims) {
    if (hit(claimText(c))) return { block_id: c.id, line: fullLine(ast, 'claims', c.lines.start), quote, book: 'claims' }
  }
  for (const d of ast.description) {
    if (hit(descriptionText(d))) return { block_id: d.id, line: fullLine(ast, 'description', d.lines.start), quote, book: 'description' }
  }
  return { block_id: 'title', line: ast.title.line, quote, book: 'abstract' }
}
