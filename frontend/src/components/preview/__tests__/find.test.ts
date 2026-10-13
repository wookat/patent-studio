import { describe, expect, it } from 'vitest'
import { findMatches, highlightHtml, type PageText } from '../find'

const texts: PageText[] = [
  { items: ['一种控制方法，其特征在于', '漂移分数 <0.3> 漂移分数'], yFrac: [0.1, 0.5] },
  { items: ['Drift Score drift', ''], yFrac: [0.2, 0.9] },
]

describe('findMatches', () => {
  it('逐项、不区分大小写、同项多次命中', () => {
    expect(findMatches(texts, '漂移分数')).toEqual([
      { page: 1, item: 1, start: 0, yFrac: 0.5 },
      { page: 1, item: 1, start: 11, yFrac: 0.5 },
    ])
    expect(findMatches(texts, 'DRIFT').map((m) => [m.page, m.start])).toEqual([
      [2, 0],
      [2, 12],
    ])
  })
  it('空查询 → 无', () => {
    expect(findMatches(texts, '')).toEqual([])
  })
})

describe('highlightHtml', () => {
  it('转义 HTML 并只给当前命中加 class', () => {
    expect(highlightHtml('漂移分数 <0.3> 漂移分数', '漂移分数', 11)).toBe(
      '<mark>漂移分数</mark> &lt;0.3&gt; <mark class="pdf-find-current">漂移分数</mark>',
    )
  })
  it('无查询时仅转义', () => {
    expect(highlightHtml('a<b', '', -1)).toBe('a&lt;b')
  })
})
