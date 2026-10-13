import { describe, expect, it } from 'vitest'
import { BOOK_NAMES, type Ast } from '@/types/ast'
import { assembleBooks, bookAtLine, bookLineToFull, fullLineToBook, replaceBook, splitBooks } from '../docset'
import goldenMethod from '../../../../backend/tests/golden/ast_method.json'
import goldenSystem from '../../../../backend/tests/golden/ast_system.json'
import METHOD from '../../../../examples/method/content.md?raw'
import SYSTEM from '../../../../examples/system/content.md?raw'

/**
 * R4 08 §4：前端 splitBooks 与后端 docset.split / offsets 同法则。golden = parse_ast(examples/…/content.md) 真输出，
 * 其 books[b].offset 来自 docset.offsets；两案逐字节往返 + offset 相等 = 卡片显示的书正文与 /docs/{book} 返回一致。
 */
const cases: [string, string, Ast][] = [
  ['method', METHOD, goldenMethod as unknown as Ast],
  ['system', SYSTEM, goldenSystem as unknown as Ast],
]

describe('lib/docset ⇄ patent_studio.kernel.docset', () => {
  for (const [name, md, ast] of cases) {
    it(`${name}: assemble(split(md)) === md 且 offset 与 AST 一致`, () => {
      const ds = splitBooks(md)
      expect(assembleBooks(ds)).toBe(md)
      expect(ds.order).toEqual([...BOOK_NAMES])
      for (const b of BOOK_NAMES) expect(ds.books[b]!.offset).toBe(ast.books[b].offset)
    })

    it(`${name}: replaceBook 自身 = 恒等；换书后其余书逐字节不变`, () => {
      const ds = splitBooks(md)
      for (const b of BOOK_NAMES) expect(replaceBook(md, b, ds.books[b]!.text)).toBe(md)
      const next = splitBooks(replaceBook(md, 'claims', '1. 一种新的权利要求。'))
      expect(next.books.claims!.text).toBe('1. 一种新的权利要求。\n')
      expect(next.books.abstract!.text).toBe(ds.books.abstract!.text)
      expect(next.books.description!.text).toBe(ds.books.description!.text)
      expect(next.head).toBe(ds.head)
    })

    it(`${name}: 行换算——块的书相对行 + offset = 全文行，且落在该书内`, () => {
      const ds = splitBooks(md)
      for (const c of ast.claims) {
        const full = bookLineToFull(ds, 'claims', c.lines.start)!
        expect(full).toBe(ast.books.claims.offset + c.lines.start)
        expect(bookAtLine(ds, full)).toBe('claims')
        expect(fullLineToBook(ds, 'claims', full)).toBe(c.lines.start)
        expect(fullLineToBook(ds, 'description', full)).toBeNull()
      }
      expect(bookAtLine(ds, 1)).toBeNull()
      expect(bookAtLine(ds, ast.books.description.offset)).toBe('description')
      expect(fullLineToBook(ds, 'description', ast.books.description.offset)).toBe(0)
    })
  }

  it('非规范文件：缺书 / 乱序也逐字节往返，replaceBook 对缺失的书不动原文', () => {
    const md = '# 标题\n\n## 说明书\n正文\n## 摘要\n摘要'
    const ds = splitBooks(md)
    expect(assembleBooks(ds)).toBe(md)
    expect(ds.order).toEqual(['description', 'abstract'])
    expect(ds.books.claims).toBeUndefined()
    expect(replaceBook(md, 'claims', 'x')).toBe(md)
    // 末书正文不补换行；非末书补
    expect(replaceBook(md, 'abstract', '新摘要')).toBe('# 标题\n\n## 说明书\n正文\n## 摘要\n新摘要')
    expect(replaceBook(md, 'description', '新正文')).toBe('# 标题\n\n## 说明书\n新正文\n## 摘要\n摘要')
  })

  it('重复书标题按正文归入当前书（与 docset.split 一致）', () => {
    const md = '# T\n## 摘要\na\n## 摘要\nb\n## 权利要求书\nc\n## 说明书\nd\n'
    const ds = splitBooks(md)
    expect(ds.books.abstract!.text).toBe('a\n## 摘要\nb\n')
    expect(ds.books.claims!.offset).toBe(6)
    expect(assembleBooks(ds)).toBe(md)
  })
})
