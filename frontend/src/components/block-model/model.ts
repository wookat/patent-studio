import { blockAtLine, type Ast, type AstClaim, type BookName, type ClaimSegment } from '@/types/ast'
import type { Diagnostic, Severity } from '@/lib/types'

/** 可聚焦/可跳转的结构块：id → 全文起始行 + 状态栏用的位置标签 */
export interface BlockEntry {
  id: string
  book: BookName
  fullLine: number
  label: string
}

/** 段号显示形式（与 numbering.para_label 一致）：13 → [0013] */
export const paraLabel = (n: number) => `[${String(n).padStart(4, '0')}]`

export const TITLE_ID = 'title'

/** 按版式阅读顺序（标题 → 摘要 → 权项 → 说明书各块 → 附图）列出所有块 */
export function blockEntries(ast: Ast): BlockEntry[] {
  const out: BlockEntry[] = []
  const off = (book: BookName) => ast.books[book].offset
  out.push({ id: TITLE_ID, book: 'abstract', fullLine: ast.title.line, label: '标题' })
  out.push({ id: ast.abstract.id, book: 'abstract', fullLine: off('abstract') + ast.abstract.lines.start, label: '摘要' })
  for (const c of ast.claims) {
    out.push({ id: c.id, book: 'claims', fullLine: off('claims') + c.lines.start, label: `权利要求书 · 权项 ${c.num}` })
  }
  let section = ''
  for (const b of ast.description) {
    if (b.kind === 'section') section = b.title
    out.push({
      id: b.id,
      book: 'description',
      fullLine: off('description') + b.lines.start,
      label: section ? `说明书 / ${section}` : '说明书',
    })
  }
  for (const f of ast.figures) {
    if (f.caption_line == null) continue
    out.push({ id: f.id, book: 'description', fullLine: off('description') + f.caption_line, label: '说明书 / 附图说明' })
  }
  return out
}

/** 权项号 → 块 id（从属权项引用跳转用） */
export const claimId = (ast: Ast, num: number): string | null => ast.claims.find((c) => c.num === num)?.id ?? null

export type SegmentPiece = { kind: 'text'; text: string } | { kind: 'ref'; text: string; targets: number[] }

/** 把权项某段文字按 refs 切成 纯文本 / 引用 片段（引用按 start 排序、忽略越界） */
export function splitSegment(claim: AstClaim, segIndex: number, seg: ClaimSegment): SegmentPiece[] {
  const refs = claim.refs
    .filter((r) => r.seg === segIndex && r.start >= 0 && r.end <= seg.text.length && r.start < r.end)
    .sort((a, b) => a.start - b.start)
  const out: SegmentPiece[] = []
  let pos = 0
  for (const r of refs) {
    if (r.start < pos) continue
    if (r.start > pos) out.push({ kind: 'text', text: seg.text.slice(pos, r.start) })
    out.push({ kind: 'ref', text: seg.text.slice(r.start, r.end), targets: r.targets })
    pos = r.end
  }
  if (pos < seg.text.length) out.push({ kind: 'text', text: seg.text.slice(pos) })
  return out
}

export interface BlockDiagnostic {
  severity: Severity
  messages: string[]
  /** 原始诊断（含 id / fix；boundary.* 的 fix 可直接喂 patchBlock） */
  items: Diagnostic[]
}

/** 诊断（有行号者）→ 所在块；同块多条取最高严重度，原始诊断保留在 items */
export function diagnosticsByBlock(ast: Ast, items: Diagnostic[]): Map<string, BlockDiagnostic> {
  const map = new Map<string, BlockDiagnostic>()
  const rank: Record<Severity, number> = { error: 2, warning: 1, info: 0 }
  for (const d of items) {
    if (d.line == null) continue
    const loc = blockAtLine(ast, d.line)
    if (!loc) continue
    const id = loc.block.id
    const cur = map.get(id)
    if (!cur) map.set(id, { severity: d.severity, messages: [d.message], items: [d] })
    else {
      cur.messages.push(d.message)
      cur.items.push(d)
      if (rank[d.severity] > rank[cur.severity]) cur.severity = d.severity
    }
  }
  return map
}
