import { describe, expect, it } from 'vitest'
import type { CriticMark } from '@/lib/types'
import { applyMarks, mayHaveMarks } from '../review'
import { ROLE_RANK } from '@/lib/types'

const mk = (line: number, from: number, to: number, final: string, original: string, id = `${line}:${from}`): CriticMark => ({
  id, kind: 'sub', line, from, to, a: original, b: final, final, original,
})

describe('review.applyMarks（docs/plan/07 §3.4：前端只做同一行内的字面替换，行号不变）', () => {
  it('无标记 → 恒等', () => {
    const md = '# 标题\n\n## 摘要\n正文'
    expect(applyMarks(md, [], 'final')).toBe(md)
  })

  it('同一行多处替换从右向左应用，互不影响偏移', () => {
    const md = 'a {~~x~>y~~} b {~~m~>n~~} c'
    const marks = [mk(1, 2, 12, 'y', 'x'), mk(1, 15, 25, 'n', 'm')]
    expect(applyMarks(md, marks, 'final')).toBe('a y b n c')
    expect(applyMarks(md, marks, 'original')).toBe('a x b m c')
  })

  it('跨行文档只改目标行，行数不变', () => {
    const md = 'l1\n| a | {++b++} |\nl3'
    const line = md.split('\n')[1]
    const from = line.indexOf('{++')
    const out = applyMarks(md, [mk(2, from, from + '{++b++}'.length, 'b', '')], 'final')
    expect(out.split('\n')).toHaveLength(3)
    expect(out).toBe('l1\n| a | b |\nl3')
  })

  it('越界行号被忽略', () => {
    expect(applyMarks('one', [mk(9, 0, 1, 'x', 'y')], 'final')).toBe('one')
  })
})

describe('roles', () => {
  it('ROLE_RANK 与后端 app.auth.ROLE_RANK 一致：viewer < editor < agent < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor)
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.agent)
    expect(ROLE_RANK.agent).toBeLessThan(ROLE_RANK.owner)
  })
})

describe('review.mayHaveMarks（廉价门，不请求后端）', () => {
  it('examples 风格纯文本 → false；任一 CriticMarkup 开口 → true', () => {
    expect(mayHaveMarks('# 标题\n\n| a | b |\n$$x^2$$')).toBe(false)
    for (const s of ['{++a++}', '{--a--}', '{~~a~>b~~}', '{>>c<<}', '{==m==}']) expect(mayHaveMarks(`x ${s} y`)).toBe(true)
  })
})
