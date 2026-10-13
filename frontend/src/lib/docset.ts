import { BOOK_NAMES, type BookName } from '@/types/ast'

/**
 * 三书切分的前端镜像（docs/plan/08-r4-dockview-design.md §4）：与 backend/src/patent_studio/kernel/docset.py 同一法则——
 * 只以 "\n" 分行，`## ` 后去首尾空白等于书名的行是书标题行（每书只认第一次出现），其余逐字节归入当前书。
 * 这不是 Markdown 解析（唯一解析器仍是后端 content.py / ast.py），只是把 content.md 拆成卡片要显示的书正文，
 * 以及书相对行 ⇄ 全文行的换算。`offset` 与 `/ast` 的 `books[b].offset` 同值（lib/__tests__/docset.test.ts 对两案断言）。
 */

export const BOOK_HEADINGS: Record<BookName, string> = { abstract: '## 摘要', claims: '## 权利要求书', description: '## 说明书' }
export const BOOK_LABELS: Record<BookName, string> = { abstract: '摘要', claims: '权利要求书', description: '说明书' }
export const BOOK_FILES: Record<BookName, string> = { abstract: 'abstract.md', claims: 'claims.md', description: 'description.md' }

export interface BookSlice {
  /** `## <书名>` 标题行的全文行号（1-based）；书正文第 k 行 = 全文第 offset + k 行 */
  offset: number
  /** 书正文（标题行之后、下一书标题行之前的原文，保留行尾） */
  text: string
  /** 标题行原文（含行尾） */
  heading: string
}

export interface DocSplit {
  /** 第一个书标题行之前的原文（`# 标题` 与空行） */
  head: string
  /** 只含 content.md 中出现的书 */
  books: Partial<Record<BookName, BookSlice>>
  /** 书在原文中的出现顺序 */
  order: BookName[]
}

const NAME_TO_BOOK = new Map<string, BookName>(BOOK_NAMES.map((b) => [BOOK_HEADINGS[b].slice(3), b]))

function lines(text: string): string[] {
  const parts = text.split('\n')
  const out = parts.slice(0, -1).map((p) => p + '\n')
  if (parts[parts.length - 1]) out.push(parts[parts.length - 1])
  return out
}

function headingBook(ln: string): BookName | null {
  if (!ln.startsWith('## ')) return null
  return NAME_TO_BOOK.get(ln.slice(3).trim()) ?? null
}

/** content.md 全文 → 头部 + 各书正文 + 标题行号；`assembleBooks(splitBooks(md)) === md` 对任意输入成立 */
export function splitBooks(md: string): DocSplit {
  const bodies: Record<'head' | BookName, string[]> = { head: [], abstract: [], claims: [], description: [] }
  const headings: Partial<Record<BookName, string>> = {}
  const order: BookName[] = []
  let cur: 'head' | BookName = 'head'
  for (const ln of lines(md)) {
    const book = headingBook(ln)
    if (book !== null && headings[book] === undefined) {
      headings[book] = ln
      order.push(book)
      cur = book
      continue
    }
    bodies[cur].push(ln)
  }
  const books: Partial<Record<BookName, BookSlice>> = {}
  let line = bodies.head.length
  for (const b of order) {
    line += 1
    books[b] = { offset: line, text: bodies[b].join(''), heading: headings[b]! }
    line += bodies[b].length
  }
  return { head: bodies.head.join(''), books, order }
}

/** 反向拼接（split 只切不改，故逐字节还原） */
export function assembleBooks(ds: DocSplit): string {
  let text = ds.head
  for (const b of ds.order) {
    const s = ds.books[b]
    if (s) text += s.heading + s.text
  }
  return text
}

/**
 * 换掉一书正文后的全文（docset.replace 同一法则：非末书正文非空且不以换行结尾则补 "\n"，避免下一书标题粘到行尾）。
 * 书不在 content.md 中（非规范文件）→ 原文不动。
 */
export function replaceBook(md: string, book: BookName, body: string): string {
  const ds = splitBooks(md)
  const s = ds.books[book]
  if (!s) return md
  const last = ds.order[ds.order.length - 1]
  const text = body && !body.endsWith('\n') && last !== book ? body + '\n' : body
  return assembleBooks({ ...ds, books: { ...ds.books, [book]: { ...s, text } } })
}

/** 全文行号所在的书（标题行本身归该书）；头部或非规范文件 → null */
export function bookAtLine(ds: DocSplit, fullLine: number): BookName | null {
  let hit: BookName | null = null
  for (const b of ds.order) {
    const s = ds.books[b]
    if (s && fullLine >= s.offset) hit = b
  }
  return hit
}

/** 书相对行（正文第 k 行，1-based）→ 全文行；书不存在 → null */
export function bookLineToFull(ds: DocSplit, book: BookName, bookLine: number): number | null {
  const s = ds.books[book]
  return s ? s.offset + bookLine : null
}

/** 全文行 → 书相对行（标题行 → 0，正文首行 → 1）；行不在该书内 → null */
export function fullLineToBook(ds: DocSplit, book: BookName, fullLine: number): number | null {
  const s = ds.books[book]
  if (!s) return null
  const rel = fullLine - s.offset
  const len = lines(s.text).length
  return rel >= 0 && rel <= len ? rel : null
}
