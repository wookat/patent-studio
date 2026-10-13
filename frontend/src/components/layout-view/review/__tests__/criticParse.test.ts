import { describe, expect, it } from 'vitest'
import { acceptCritic, hiddenRanges, parseCriticLine, rejectCritic, resolveCriticLine } from '../criticParse'

const L = '甲{++乙++}丙{--丁--}戊{~~己~>庚~~}辛{>>批<<}壬{==亮==}'

describe('parseCriticLine：五种 CriticMarkup、偏移与 a/b/final/original', () => {
  it('偏移为 UTF-16 行内偏移（与 CriticMark.from/to 同口径）；innerFrom/innerTo 去掉三字符标记符', () => {
    const s = parseCriticLine(L)
    expect(s.map((x) => x.kind)).toEqual(['ins', 'del', 'sub', 'comment', 'mark'])
    const ins = s[0]!
    expect([ins.from, ins.to, ins.innerFrom, ins.innerTo]).toEqual([1, 8, 4, 5])
    expect(L.slice(ins.from, ins.to)).toBe('{++乙++}')
    expect(L.slice(ins.innerFrom, ins.innerTo)).toBe('乙')
    const sub = s[2]!
    expect(L.slice(sub.from, sub.to)).toBe('{~~己~>庚~~}')
    expect(L.slice(sub.arrowAt, sub.arrowAt + 2)).toBe('~>')
    expect([sub.a, sub.b, sub.final, sub.original]).toEqual(['己', '庚', '庚', '己'])
    expect(s[1]).toMatchObject({ a: '丁', b: '', final: '', original: '丁', arrowAt: -1 })
    expect(s[3]).toMatchObject({ a: '批', final: '', original: '' })
    expect(s[4]).toMatchObject({ a: '亮', final: '亮', original: '亮' })
  })

  it('无标记 / 未闭合 / 跨行不匹配', () => {
    expect(parseCriticLine('普通文本')).toEqual([])
    expect(parseCriticLine('{++未闭合')).toEqual([])
    expect(parseCriticLine('{++a\nb++}')).toEqual([])
    expect(parseCriticLine('{~~缺箭头~~}')).toEqual([])
  })

  it('非贪婪：两处相邻插入各成一段', () => {
    const s = parseCriticLine('{++a++}{++b++}')
    expect(s.map((x) => x.b)).toEqual(['a', 'b'])
    expect(s[1]!.from).toBe(7)
  })
})

describe('accept / reject：与 backend critic.py 同法则', () => {
  it('final 与 original', () => {
    expect(resolveCriticLine(L, 'final')).toBe('甲乙丙戊庚辛壬亮')
    expect(resolveCriticLine(L, 'original')).toBe('甲丙丁戊己辛壬亮')
  })
  it('无标记恒等、幂等、不改变行数', () => {
    const t = '第一行\n{++第二行++}\n{--第三行--}'
    expect(acceptCritic('x\ny')).toBe('x\ny')
    expect(acceptCritic(acceptCritic(t))).toBe(acceptCritic(t))
    expect(acceptCritic(t).split('\n').length).toBe(3)
    expect(rejectCritic(t)).toBe('第一行\n\n第三行')
  })
})

describe('hiddenRanges：四档决定隐藏哪些区间（标记符恒隐藏）', () => {
  const vis = (level: 'all' | 'simple' | 'none' | 'original') => {
    const spans = parseCriticLine(L)
    const hidden = hiddenRanges(spans, level)
    let out = ''
    for (let i = 0; i < L.length; i++) if (!hidden.some(([a, b]) => i >= a && i < b)) out += L[i]
    return out
  }
  it('all：只隐藏标记符，内文全部可见（包含删除侧与批注）', () => {
    expect(vis('all')).toBe('甲乙丙丁戊己庚辛批壬亮')
  })
  it('simple / none：= final（隐藏删除侧、替换旧侧、批注）', () => {
    expect(vis('simple')).toBe('甲乙丙戊庚辛壬亮')
    expect(vis('none')).toBe(resolveCriticLine(L, 'final'))
  })
  it('original：= 拒绝（隐藏插入侧、替换新侧、批注）', () => {
    expect(vis('original')).toBe(resolveCriticLine(L, 'original'))
  })
  it('结果按起点排序且不含空区间', () => {
    const r = hiddenRanges(parseCriticLine(L), 'none')
    for (let i = 1; i < r.length; i++) expect(r[i]![0]).toBeGreaterThanOrEqual(r[i - 1]![0])
    for (const [a, b] of r) expect(b).toBeGreaterThan(a)
  })
})
