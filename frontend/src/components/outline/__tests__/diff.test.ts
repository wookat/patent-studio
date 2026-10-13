import { describe, expect, it } from 'vitest'
import { summarizeDiff } from '../diff'

describe('summarizeDiff（HistoryPanel）', () => {
  it('行数差 / 多重集增删 / 首个差异行', () => {
    expect(summarizeDiff('a\nb\nc', 'a\nb\nc')).toEqual({ lineDelta: 0, added: 0, removed: 0, first: null, identical: true })
    const d = summarizeDiff('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(d).toMatchObject({ lineDelta: 1, added: 2, removed: 1, identical: false })
    expect(d.first).toEqual({ line: 2, backup: 'b', current: 'B' })
    expect(summarizeDiff('x\r\ny', 'x\ny').identical).toBe(true)
    expect(summarizeDiff('a\nb', 'a').first).toEqual({ line: 2, backup: 'b', current: '' })
  })
})
