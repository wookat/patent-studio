import { DOMParser } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { splitBooks } from '@/lib/docset'
import type { BookName } from '@/types/ast'
import { blockAttrsOf, bookSchema } from '../doc/bookSchema'
import { GEN_ATTR } from './decorations'
import { restoreCursor } from './mergeDoc'

/**
 * EditorView 的 domParser：浏览器原生改动 DOM（如 Backspace 并段、拖放）后 ProseMirror 重读该段 DOM 时，
 * 忽略装饰生成物（段号 / 权项性质 widget，`data-generated`），保证它们永不进正文。
 */
export const bookDomParser = new DOMParser(bookSchema, [{ tag: `[${GEN_ATTR}]`, ignore: true }, ...DOMParser.fromSchema(bookSchema).rules])

/** 全文 → 某书正文（不含 `## ` 书名行）；非规范三书文件返回 undefined */
export function bookText(content: string, book: BookName): string | undefined {
  return splitBooks(content).books[book]?.text
}

/** 把光标放到某块开头（PDF 选块 → 版面：revealView('layout') 后由 LayoutView 调用），返回是否找到 */
export function focusBlockStart(view: EditorView, blockId: string): boolean {
  let found = false
  view.state.doc.forEach((n) => {
    if (blockAttrsOf(n).blockId === blockId) found = true
  })
  if (!found) return false
  const sel = restoreCursor(view.state.doc, { blockId, index: 0, offset: 1 })
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
  view.focus()
  return true
}
