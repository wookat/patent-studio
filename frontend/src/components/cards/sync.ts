import { fullLineToBook, splitBooks } from '@/lib/docset'
import type { CriticMark, Diagnostic } from '@/lib/types'
import type { BookView, OpenPanelOptions, PanelId } from '@/store/layout'
import type { Studio } from '@/store/types'
import { BOOK_NAMES, type Ast, type AstBlock, type BlockLocation, type BookName } from '@/types/ast'
import type { OpenPlacement } from './types'

/** 书正文行数（与 docset.lines 同律：保留行尾，尾部无换行的残行算一行） */
function lineCount(text: string): number {
  if (!text) return 0
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

/**
 * 跨卡片同步契约（docs/plan/08-r4-dockview-design.md §4.3；D2 所有）。
 * 不新增事件总线：所有卡片订阅同一 store 的既有字段——
 *   - `doc.cursor`（全文行）→ 结构 / 大纲 / PDF 定位：源码卡片 setCursor 时报**全文行**；
 *   - `ast.activeBlock`（{id, source}）→ 各卡片高亮所在块；
 *   - `doc.scrollRequest`（全文行）→ 源码卡片只在该行落在自己书内时滚动（`fullLineToBook` 非 null）；
 *   - `ui.pdfLocate` → PDF 卡片定位。
 * 这里只放纯换算，供 D2 的 hooks 使用。
 */

/** 卡片内书相对行 → 全文行（'all' 视图即全文行本身） */
export function toFullLine(content: string, book: BookView, cardLine: number): number | null {
  if (book === 'all') return cardLine
  const s = splitBooks(content).books[book]
  return s ? s.offset + cardLine : null
}

/** 全文行 → 卡片内书相对行；不在本书范围内返回 null（卡片忽略该请求） */
export function toCardLine(content: string, book: BookView, fullLine: number): number | null {
  if (book === 'all') return fullLine
  return fullLineToBook(splitBooks(content), book, fullLine)
}

/** 全文行落在哪一书的正文里（头部 / 书标题行 → null）；全文卡片「在单书卡片中编辑」用 */
export function bookAtFullLine(content: string, fullLine: number): BookName | null {
  const split = splitBooks(content)
  for (const b of BOOK_NAMES) {
    const s = split.books[b]
    if (!s) continue
    const rel = fullLine - s.offset
    if (rel >= 1 && rel <= lineCount(s.text)) return b
  }
  return null
}

/** 外部 value 变化时只替换首尾公共部分之间的区间：全文镜像 / 装配补行尾时光标与滚动位置不跳 */
export function minimalChange(cur: string, next: string): { from: number; to: number; insert: string } {
  let start = 0
  const min = Math.min(cur.length, next.length)
  while (start < min && cur.charCodeAt(start) === next.charCodeAt(start)) start++
  let endCur = cur.length
  let endNext = next.length
  while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
    endCur--
    endNext--
  }
  return { from: start, to: endCur, insert: next.slice(start, endNext) }
}

/** 「打开为…」的放置 → store.openPanel 选项（相对本面板拆分 / 浮动） */
export function openOptions(referencePanel: PanelId, placement: OpenPlacement): OpenPanelOptions {
  if (placement === 'floating') return { floating: true }
  return { position: { referencePanel, direction: placement } }
}

/** 块是否属于某卡片视图（结构卡片过滤块列表 / 源码卡片决定是否响应 activeBlock） */
export function blockInView(loc: BlockLocation, book: BookView): boolean {
  return book === 'all' || loc.book === book
}

/** 带全文行号的条目 → 卡片相对行（只保留落在本书内的；'all' 原样返回） */
function toCardLines<T extends { line: number | null }>(items: readonly T[], content: string, book: BookView): T[] {
  if (book === 'all') return [...items]
  const split = splitBooks(content)
  const out: T[] = []
  for (const it of items) {
    if (it.line == null) continue
    const line = fullLineToBook(split, book, it.line)
    if (line != null) out.push({ ...it, line })
  }
  return out
}

/** store diagnostics.items（全文行）→ 本书卡片的诊断（书相对行）；无法定位的条目不进卡片 gutter */
export function toCardDiagnostics(items: readonly Diagnostic[], content: string, book: BookView): Diagnostic[] {
  return toCardLines(items, content, book)
}

/** store review.marks（全文行）→ 本书卡片的 CriticMarkup 标记（书相对行） */
export function toCardMarks(marks: readonly CriticMark[], content: string, book: BookView): CriticMark[] {
  return toCardLines(marks, content, book)
}

/** 块 id → 所在书 + 块（顶层块与摘要段；title / figures 不属于任何书卡片） */
export function locateBlock(ast: Ast, id: string): BlockLocation | null {
  if (ast.abstract.id === id) return { book: 'abstract', block: ast.abstract }
  const ap = ast.abstract.paragraphs.find((p) => p.id === id)
  if (ap) return { book: 'abstract', block: ap }
  const c = ast.claims.find((b) => b.id === id)
  if (c) return { book: 'claims', block: c }
  const d = ast.description.find((b) => b.id === id)
  return d ? { book: 'description', block: d } : null
}

/**
 * 对照滚动锁（§4.4）：主卡片当前块 → 从卡片应对齐到的块。
 * 权利要求书 ↔ 说明书：权项 n 对应说明书里**首个引用该权项主题词的段落**需要术语索引（轨道 E）；
 * prep 只定义接口，D2 首版用「相同序号的顶层块」对齐（claims 第 n 块 ↔ description 第 n 个正文段），
 * 术语索引到位后替换 `pairBlock` 实现即可，调用方不变。
 */
export type PairBlock = (s: Studio, fromBook: BookView, blockId: string, toBook: BookView) => string | null

export function bookBlocks(ast: Ast, book: BookName): AstBlock[] {
  if (book === 'abstract') return [ast.abstract]
  if (book === 'claims') return ast.claims
  return ast.description.filter((b) => b.kind === 'paragraph')
}

export const pairBlockByIndex: PairBlock = (s, fromBook, blockId, toBook) => {
  const ast = s.ast
  if (!ast || fromBook === 'all' || toBook === 'all') return null
  const from = bookBlocks(ast, fromBook)
  const to = bookBlocks(ast, toBook)
  const i = from.findIndex((b) => b.id === blockId)
  return i >= 0 && i < to.length ? to[i].id : null
}
