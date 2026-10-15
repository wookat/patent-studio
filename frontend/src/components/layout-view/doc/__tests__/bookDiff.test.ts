import { describe, expect, it } from 'vitest'
import { splitBooks } from '@/lib/docset'
import { findBlockLines } from '@/store/blocks'
import type { Ast, BookName } from '@/types/ast'
import fixture from '../../../../../../backend/tests/fixtures/ast_rich.json'
import METHOD from '../../../../../../backend/tests/fixtures/rich/content.md?raw'
import { bookDiff } from '../bookDiff'

const ast = fixture as unknown as Ast
const bookMd = (book: BookName) => splitBooks(METHOD).books[book]!.text
const lines = (book: BookName) => bookMd(book).split('\n')
const loc = (id: string) => findBlockLines(ast, id)!

/** 把书内 0-based 行区间 [s, e) 替换为 repl，返回新书 Markdown */
const splice = (book: BookName, s: number, e: number, repl: string[]) => {
  const a = lines(book)
  return [...a.slice(0, s), ...repl, ...a.slice(e)].join('\n')
}

describe('bookDiff：单块 → block；分并段 / 跨块 / 增删块 → multi', () => {
  it('无变化 → none', () => {
    expect(bookDiff(bookMd('claims'), bookMd('claims'), ast, 'claims')).toEqual({ kind: 'none' })
  })

  it('单块内行内格式改动（权项 / 说明书段落 / 摘要段）→ block，markdown 为该块新源码', () => {
    for (const [book, id] of [
      ['claims', ast.claims[1].id],
      ['description', ast.description.find((b) => b.kind === 'paragraph')!.id],
      ['abstract', ast.abstract.paragraphs[0].id],
    ] as [BookName, string][]) {
      const l = loc(id)
      const a = lines(book)
      const newFirst = a[l.start - 1].replace(/^(\d+\.)?/, '$1**') + '**'
      const next = splice(book, l.start - 1, l.start, [newFirst])
      const d = bookDiff(bookMd(book), next, ast, book)
      expect(d.kind, `${book}/${id}`).toBe('block')
      if (d.kind === 'block') {
        expect(d.id).toBe(id)
        expect(d.markdown).toBe([newFirst, ...a.slice(l.start, l.end)].join('\n'))
        expect(d.markdown.startsWith('\n') || d.markdown.endsWith('\n')).toBe(false)
      }
    }
  })

  it('多行权项：在块尾追加一行 / 删掉一行 仍是 block（块内增删行）', () => {
    const id = ast.claims.find((c) => loc(c.id).end > loc(c.id).start)!.id
    const l = loc(id)
    const added = splice('claims', l.end, l.end, ['步骤五，新增。'])
    expect(bookDiff(bookMd('claims'), added, ast, 'claims')).toMatchObject({ kind: 'block', id })
    const removed = splice('claims', l.end - 1, l.end, [])
    expect(bookDiff(bookMd('claims'), removed, ast, 'claims')).toMatchObject({ kind: 'block', id })
  })

  it('块内插入空行（拆段）→ multi；删掉块间空行（并段）→ multi', () => {
    const id = ast.description.find((b) => b.kind === 'paragraph')!.id
    const l = loc(id)
    const line = lines('description')[l.start - 1]
    const half = Math.floor(line.length / 2)
    const split = splice('description', l.start - 1, l.start, [line.slice(0, half), '', line.slice(half)])
    expect(bookDiff(bookMd('description'), split, ast, 'description')).toEqual({ kind: 'multi' })

    const merged = splice('description', l.end, l.end + 1, [])
    expect(lines('description')[l.end]).toBe('')
    expect(bookDiff(bookMd('description'), merged, ast, 'description')).toEqual({ kind: 'multi' })
  })

  it('跨两块的改动 → multi；新增块 / 删除块 → multi', () => {
    const [c1, c2] = [ast.claims[0], ast.claims[1]]
    const l1 = loc(c1.id)
    const l2 = loc(c2.id)
    const cross = splice('claims', l1.end - 1, l2.start, ['X', '', 'Y'])
    expect(bookDiff(bookMd('claims'), cross, ast, 'claims')).toEqual({ kind: 'multi' })

    const added = splice('claims', l1.end, l1.end, ['', '99.新权项。'])
    expect(bookDiff(bookMd('claims'), added, ast, 'claims')).toEqual({ kind: 'multi' })

    const deleted = splice('claims', l1.start - 1, l2.start - 1, [])
    expect(bookDiff(bookMd('claims'), deleted, ast, 'claims')).toEqual({ kind: 'multi' })
  })

  it('两处相隔的单块改动 → multi（公共前后缀跨越块间空行）', () => {
    const a = lines('claims')
    const l1 = loc(ast.claims[0].id)
    const l3 = loc(ast.claims[2].id)
    const b = [...a]
    b[l1.start - 1] += ' 甲'
    b[l3.start - 1] += ' 乙'
    expect(bookDiff(bookMd('claims'), b.join('\n'), ast, 'claims')).toEqual({ kind: 'multi' })
  })
})
