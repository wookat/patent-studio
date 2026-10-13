import type { Node as PmNode } from 'prosemirror-model'
import { collapseMerges } from '../table/gfm'
import { splitBooks } from '@/lib/docset'
import { findBlockLines } from '@/store/blocks'
import type { Ast, AstClaim, AstFigure, AstParagraph, AstTable, BookName, DescriptionBlock } from '@/types/ast'
import { bookSchema, type BookBlockKind } from './bookSchema'
import { inlineNodes, type InlineOptions } from './inline'

/**
 * `(ast, book, content) → 整书 PM doc`（docs/plan/22 §2）。
 * - 块的身份 / 顺序 / 行范围来自 AST（findBlockLines），文本来自 AST 字段（与 block-model/edit/serialize.toDoc 相同的来源，
 *   golden 已证明这些字段与源码行逐字节一致），行内格式由 inline.parseInline 派生 mark；
 * - doc.attrs：`book`；`lead` / `trail` = 书首块前 / 末块后的空行数（源码事实，fromBookDoc 原样写回；新书默认 1 / 1）；
 *   块间恒为单空行（patch.py 规则），源码里多余的块间空行会在往返时归一；
 * - 段号 / 权项号 / 图号不进 doc；表题（role=table-caption）与图题（figures[].caption_line 命中的段）只在 kind 上区分；
 * - `book='figures'`：doc 由 `ps_figure` atom 组成（docs/figures.md 由 PUT /figures 逐行改写，不经 fromBookDoc）。
 * - 含 CriticMarkup 的单行段落 / 标题：AST 文本是 critic.accept 后的，doc 改取源码原行（标记原样进 doc，由 review/criticDecorations 渲染），
 *   这样 fromBookDoc 与源码逐字节一致，审阅模式下二次编辑不会把已有标记当作改动重新包一层。
 */
export type BookDocName = BookName | 'figures'

const { doc, ps_para, ps_heading, ps_equation, ps_table, ps_row, ps_cell, ps_note, ps_code, ps_claim, ps_figure } = bookSchema.nodes

const para = (text: string, attrs: { blockId: string | null; kind: BookBlockKind | null }, opts: InlineOptions) =>
  ps_para.create(attrs, inlineNodes(text, opts))

export function toBookDoc(ast: Ast, book: BookDocName, content: string, opts: InlineOptions = {}): PmNode {
  if (book === 'figures') return doc.create({ book, lead: 0, trail: 0 }, ast.figures.map(figureNode))

  const raw = rawLines(ast, book, content)
  const blocks: PmNode[] = []
  const captionLines = new Set(ast.figures.map((f) => f.caption_line).filter((l): l is number => l !== null))
  const ids: string[] = []
  if (book === 'abstract') {
    for (const p of ast.abstract.paragraphs) {
      blocks.push(paragraphNode(p, false, opts, raw))
      ids.push(p.id)
    }
  } else if (book === 'claims') {
    for (const c of ast.claims) {
      blocks.push(claimNode(c, opts))
      ids.push(c.id)
    }
  } else {
    for (const b of ast.description) {
      blocks.push(...descriptionNodes(b, captionLines, opts, raw))
      ids.push(b.id)
    }
  }
  const { lead, trail } = margins(ast, book, content, ids)
  return doc.create({ book, lead, trail }, blocks)
}

/** 书首块前 / 末块后的空行数（书正文 = splitBooks(content).books[book].text） */
function margins(ast: Ast, book: BookName, content: string, ids: string[]): { lead: number; trail: number } {
  const text = splitBooks(content).books[book]?.text
  if (text === undefined || ids.length === 0) return { lead: 1, trail: 1 }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const first = findBlockLines(ast, ids[0])
  const last = findBlockLines(ast, ids[ids.length - 1])
  if (!first || !last) return { lead: 1, trail: 1 }
  return { lead: Math.max(0, first.start - 1), trail: Math.max(0, lines.length - last.end) }
}

const CRITIC_OPEN = /\{(\+\+|--|~~|>>|==)/

/** 块 id → 源码原行（仅单行块且该行含 CriticMarkup 时返回；其余 null = 用 AST 文本） */
type RawLine = (id: string, strip?: RegExp) => string | null

function rawLines(ast: Ast, book: BookName, content: string): RawLine {
  const text = splitBooks(content).books[book]?.text
  if (text === undefined || !CRITIC_OPEN.test(text)) return () => null
  const lines = text.split('\n')
  return (id, strip) => {
    const loc = findBlockLines(ast, id)
    if (!loc || loc.start !== loc.end) return null
    const line = lines[loc.start - 1]
    if (line === undefined || !CRITIC_OPEN.test(line)) return null
    return strip ? line.replace(strip, '') : line
  }
}

function paragraphNode(p: AstParagraph, figureCaption: boolean, opts: InlineOptions, raw?: RawLine): PmNode {
  const kind: BookBlockKind = p.role === 'table-caption' ? 'table-caption' : figureCaption ? 'figure-caption' : 'paragraph'
  return para(raw?.(p.id) ?? p.text, { blockId: p.id, kind }, opts)
}

function claimNode(c: AstClaim, opts: InlineOptions): PmNode {
  const segs = c.segments.map((s) =>
    s.kind === 'equation'
      ? ps_equation.create({ source: s.text, label: '', mathml: s.mathml })
      : para(s.text, { blockId: null, kind: null }, opts),
  )
  return ps_claim.create({ blockId: c.id, kind: 'claim' }, segs)
}

function descriptionNodes(b: DescriptionBlock, captionLines: Set<number>, opts: InlineOptions, raw?: RawLine): PmNode[] {
  switch (b.kind) {
    case 'paragraph':
      return [paragraphNode(b, captionLines.has(b.lines.start), opts, raw)]
    case 'section':
    case 'subsection':
      return [
        ps_heading.create(
          { level: b.kind === 'section' ? 3 : 4, blockId: b.id, kind: b.kind },
          inlineNodes(raw?.(b.id, /^#{3,4}\s+/) ?? b.title, opts),
        ),
      ]
    case 'equation':
      return [ps_equation.create({ source: b.source, label: b.label ?? '', mathml: b.mathml, blockId: b.id, kind: 'equation' })]
    case 'code':
      return [ps_code.create({ blockId: b.id, kind: 'code' }, b.code_lines.length ? bookSchema.text(b.code_lines.join('\n')) : null)]
    case 'table':
      return tableNodes(b, opts)
    case 'figure':
      return [ps_figure.create({ blockId: b.id, kind: 'figure', file: b.file, width: b.width, alt: b.alt || null, num: null, caption: null })]
  }
}

function tableNodes(t: AstTable, opts: InlineOptions): PmNode[] {
  const rows = t.rows.map((r) => ps_row.create(null, r.map((c) => ps_cell.create(null, inlineNodes(c, opts)))))
  const raw = ps_table.create({ ...t.options, caption_after: t.caption_after?.text ?? null, blockId: t.id, kind: 'table' }, rows)
  const out = [collapseMerges(raw)]
  if (t.note) out.push(ps_note.create({ blockId: t.id, kind: 'table' }, inlineNodes(t.note.text, opts)))
  return out
}

function figureNode(f: AstFigure): PmNode {
  return ps_figure.create({ blockId: f.id, kind: 'figure', file: f.file, width: f.width, alt: f.alt, num: f.num, caption: f.caption })
}
