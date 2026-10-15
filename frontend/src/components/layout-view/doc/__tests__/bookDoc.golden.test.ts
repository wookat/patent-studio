import { describe, expect, it } from 'vitest'
import { splitBooks } from '@/lib/docset'
import type { Ast, BookName } from '@/types/ast'
import { bookSchema } from '../bookSchema'
import { bookBlocks, fromBookDoc } from '../fromBookDoc'
import { toBookDoc } from '../toBookDoc'
import astMethod from '../../../../../../backend/tests/golden/ast_method.json'
import astSystem from '../../../../../../backend/tests/golden/ast_system.json'
import astRich from '../../../../../../backend/tests/fixtures/ast_rich.json'
import mdMethod from '../../../../../../examples/method/content.md?raw'
import mdSystem from '../../../../../../examples/system/content.md?raw'
import mdRich from '../../../../../../backend/tests/fixtures/rich/content.md?raw'
import studioMethod from '../../../../../../examples/method/studio.json'
import studioSystem from '../../../../../../examples/system/studio.json'

/** 22 §4 golden：各案 × 四书 fromBookDoc(toBookDoc(ast, book, content)) === 该书源码（splitBooks 切出的正文）逐字节 */
const cases: [string, Ast, string, string[]][] = [
  ['method', astMethod as unknown as Ast, mdMethod, (studioMethod as { sub_except?: string[] }).sub_except ?? []],
  ['system', astSystem as unknown as Ast, mdSystem, (studioSystem as { sub_except?: string[] }).sub_except ?? []],
  ['rich', astRich as unknown as Ast, mdRich, []],
]
const BOOKS: BookName[] = ['abstract', 'claims', 'description']

describe.each(cases)('golden %s', (_name, ast, md, subExcept) => {
  it.each(BOOKS)('%s 整书往返逐字节一致', (book) => {
    const src = splitBooks(md).books[book]!.text
    const doc = toBookDoc(ast, book, md, { subExcept })
    doc.check()
    expect(doc.type.schema).toBe(bookSchema)
    expect(doc.attrs.book).toBe(book)
    expect(fromBookDoc(doc)).toBe(src)
  })

  it('块身份与 AST 一一对应（顺序 / id / kind），段号权项号不进正文', () => {
    const ids = (b: BookName) => bookBlocks(toBookDoc(ast, b, md)).map((x) => x.blockId)
    expect(ids('abstract')).toEqual(ast.abstract.paragraphs.map((p) => p.id))
    expect(ids('claims')).toEqual(ast.claims.map((c) => c.id))
    expect(ids('description')).toEqual(ast.description.map((b) => b.id))
    const desc = toBookDoc(ast, 'description', md)
    const kinds = new Set<string>()
    desc.forEach((n) => {
      if (n.attrs.kind) kinds.add(n.attrs.kind)
      // 段号是内核按位置编号：块文本本身未写段号时，doc 节点不得出现 [NNNN]
      const blk = ast.description.find((b) => b.id === n.attrs.blockId)
      if (n.type.name === 'ps_para' && n.attrs.kind === 'paragraph' && !(blk && 'text' in blk && /^\[\d{4}\]/.test(blk.text as string))) {
        expect(n.textContent).not.toMatch(/^\[\d{4}\]/)
      }
    })
    if (_name === 'rich') {
      for (const k of ['paragraph', 'section', 'subsection', 'equation', 'table', 'table-caption']) expect(kinds).toContain(k)
    }
    toBookDoc(ast, 'claims', md).forEach((n) => {
      expect(n.type.name).toBe('ps_claim')
      expect(n.attrs.kind).toBe('claim')
    })
  })

  it('第四书 figures：ps_figure atom 与 ast.figures 一一对应；无 Markdown 形态', () => {
    const doc = toBookDoc(ast, 'figures', md)
    doc.check()
    const figs: { id: string | null; file: string; width: number }[] = []
    doc.forEach((n) => figs.push({ id: n.attrs.blockId, file: n.attrs.file, width: n.attrs.width }))
    expect(figs).toEqual(ast.figures.map((f) => ({ id: f.id, file: f.file, width: f.width })))
    expect(() => fromBookDoc(doc)).toThrow()
  })
})
