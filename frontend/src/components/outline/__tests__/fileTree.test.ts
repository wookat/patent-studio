import { describe, expect, it } from 'vitest'
import METHOD from '../../../../../backend/tests/fixtures/rich/content.md?raw'
import type { Settings } from '@/lib/types'
import { countFigureRefs, figureNodeCaption, firstFigureRefLine, listFigFiles, settingsChangedCount, visibleFigFiles } from '../fileTreeUtils'
import { claimRefTag, paraRangeTag, refRange } from '../outlineTags'

const DEFAULTS: Settings = { abstract_figure: null, spec_figures: [], sub_except: ['tsf_guard', 'on_matured'], abstract_limit: 300, style: {} }

describe('listFigFiles', () => {
  it('只收 fig<N>.(svg|emf|png)，按图号再扩展名排序', () => {
    const files = listFigFiles(['fig2.svg', 'fig1.png', 'fig1.emf', 'fig10.svg', 'notes.txt', 'Fig3.SVG', 'figure1.svg'])
    expect(files.map((f) => f.name)).toEqual(['fig1.emf', 'fig1.png', 'fig2.svg', 'Fig3.SVG', 'fig10.svg'])
    expect(files[0]).toMatchObject({ num: 1, ext: 'emf' })
  })
  it('有 GET /figures 时以它为准：图号按 figures.md 行序，未编入排最后（num=null），任意文件名都列', () => {
    const files = listFigFiles(['fig1.svg'], [
      { name: 'flow.png', num: 2, ext: '.png' },
      { name: 'fig1.svg', num: 1, ext: '.svg' },
      { name: 'scan.jpg', num: null, ext: '.jpg' },
    ])
    expect(files).toEqual([
      { name: 'fig1.svg', num: 1, ext: 'svg' },
      { name: 'flow.png', num: 2, ext: 'png' },
      { name: 'scan.jpg', num: null, ext: 'jpg' },
    ])
    expect(listFigFiles(['fig1.svg'], []).map((f) => f.name)).toEqual(['fig1.svg'])
  })
})

describe('visibleFigFiles（文件树 figs/ 资源行：隐藏纯派生 emf / wmf，不隐藏作为主文件的 emf）', () => {
  const METHOD_FIGS = [1, 2, 3, 4, 5, 6].flatMap((n) => [`fig${n}.emf`, `fig${n}.png`, `fig${n}.svg`])
  it('有 GET /figures（示例案：figures.md 引用 fig<N>.emf，png / svg 为伴生）：每图一行，资源数 = 6 而不是 0 / 18', () => {
    const figures = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `fig${n}.emf`, num: n, ext: '.emf', preview: `fig${n}.png` }))
    const rows = visibleFigFiles(METHOD_FIGS, figures)
    expect(rows.map((f) => f.name)).toEqual(['fig1.emf', 'fig2.emf', 'fig3.emf', 'fig4.emf', 'fig5.emf', 'fig6.emf'])
    expect(rows).toHaveLength(6)
  })
  it('有 GET /figures：未编入且无可显示伴生的 emf 才隐藏；未编入但有 preview 的 emf 保留；png / svg 不受影响', () => {
    const rows = visibleFigFiles(['a.emf', 'b.emf', 'c.png', 'd.svg'], [
      { name: 'a.emf', num: null, ext: '.emf', preview: null },
      { name: 'b.emf', num: null, ext: '.emf', preview: 'b.png' },
      { name: 'c.png', num: 1, ext: '.png', preview: 'c.png' },
      { name: 'd.svg', num: null, ext: '.svg', preview: 'd.svg' },
    ])
    expect(rows.map((f) => f.name)).toEqual(['c.png', 'b.emf', 'd.svg'])
  })
  it('无 GET /figures（退回文件名推断）：同 stem 有可直显文件的 emf 隐藏，孤立 emf 保留', () => {
    expect(visibleFigFiles(METHOD_FIGS).map((f) => f.name)).toEqual(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [`fig${n}.png`, `fig${n}.svg`]),
    )
    expect(visibleFigFiles(['fig1.emf', 'fig2.svg']).map((f) => f.name)).toEqual(['fig1.emf', 'fig2.svg'])
    expect(visibleFigFiles(METHOD_FIGS, [])).toHaveLength(12)
  })
})

describe('figureNodeCaption（qa-07 / domain-05：附图 N · 资源 M 两口径）', () => {
  it('N = 说明书附图块数，M = figs/ 文件数，同时可见；title / aria 逐一解释', () => {
    const c = figureNodeCaption(6, 0)
    expect(c.text).toBe('附图 6 · 资源 0')
    expect(c.explain).toContain('附图 6 = 说明书附图块数')
    expect(c.explain).toContain('资源 0 = 已上传的图片文件数')
    expect(c.aria).toContain('附图 6 = 说明书附图块数')
    expect(c.aria).toContain('资源 0 = 已上传')
    expect(`${c.explain} ${c.aria}`).not.toMatch(/figs\/|figures\.md|\/ast/)
    expect(figureNodeCaption(6, 12).text).toBe('附图 6 · 资源 12')
  })
  it('/ast 未返回时 N 显「—」而不是 0（不冒充口径）', () => {
    const c = figureNodeCaption(null, 3)
    expect(c.text).toBe('附图 — · 资源 3')
    expect(c.explain).toContain('正在解析')
    expect(c.explain).not.toMatch(/\/ast/)
  })
})

describe('图N 引用（examples/method）', () => {
  const lines = METHOD.split('\n')
  it('计数不把 图1 匹配进 图10 / 图12', () => {
    expect(countFigureRefs('图1、图10、图 1、图12', 1)).toBe(2)
    expect(countFigureRefs('图1、图10', 10)).toBe(1)
    expect(countFigureRefs('无附图', 3)).toBe(0)
  })
  it('真实案子：图1–6 均有引用，首个引用落在 ### 附图说明 与下一章节之间', () => {
    const from = lines.indexOf('### 附图说明') + 1
    const to = lines.indexOf('### 具体实施方式') + 1
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    for (let n = 1; n <= 6; n++) {
      expect(countFigureRefs(METHOD, n)).toBeGreaterThan(0)
      const line = firstFigureRefLine(lines, n)!
      expect(line).toBeGreaterThan(from)
      expect(line).toBeLessThan(to)
    }
    expect(firstFigureRefLine(lines, 99)).toBeNull()
  })
})

describe('settingsChangedCount', () => {
  it('默认设置 = 0；style 每键 + abstract_limit + sub_except 各计 1', () => {
    expect(settingsChangedCount(null, DEFAULTS)).toBe(0)
    expect(settingsChangedCount({ ...DEFAULTS, spec_figures: [['fig1.svg', 80]] }, DEFAULTS)).toBe(0)
    expect(settingsChangedCount({ ...DEFAULTS, style: { a: 1, b: 2 } as never, abstract_limit: 200, sub_except: ['x'] }, DEFAULTS)).toBe(4)
    expect(settingsChangedCount({ ...DEFAULTS, abstract_limit: 250 }, null)).toBe(1)
  })
})

describe('OutlinePanel 标签', () => {
  it('claimRefTag：独（含引用方法项的独立装置项）/ 从 / →1 / 连续区间 / 离散', () => {
    expect(claimRefTag(false, [])).toBe('独')
    expect(claimRefTag(false, [1, 2, 3])).toBe('独')
    expect(claimRefTag(true, [])).toBe('从')
    expect(claimRefTag(true, [1])).toBe('→1')
    expect(claimRefTag(true, [2, 3, 4, 5, 6])).toBe('→2–6')
    expect(claimRefTag(true, [1, 3])).toBe('→1,3')
    expect(refRange([2, 3, 4])).toBe('2–4')
    expect(refRange([])).toBe('')
  })
  it('paraRangeTag：首段号 – 末段号；单段只显一个；无编号段 null', () => {
    expect(paraRangeTag({ firstPara: 31, lastPara: 88 })).toBe('[0031]–[0088]')
    expect(paraRangeTag({ firstPara: 7, lastPara: 7 })).toBe('[0007]')
    expect(paraRangeTag({ firstPara: null, lastPara: null })).toBeNull()
  })
})
