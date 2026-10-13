import { describe, expect, it } from 'vitest'
import { bookOfHeader, buildPdfBlockIndex, pdfLocateCandidates, type PdfDocLike, type PdfPageLike, type PdfStructNodeLike, type PdfTextItemLike } from '../pdfIndex'
import { SYNTH_AST } from './astFixture'

/**
 * 假 pdf.js 文档：形状照内核 tagged PDF 实测（unoserver UseTaggedPDF）——
 *  Root → Document → P/Table/Figure/Artifact，叶子 {type:'content', id:'p600R_mc8'}；
 *  文字流里 beginMarkedContentProps{id} … endMarkedContent 包住各 MCID 的项；页眉「说 明 书」+ 页脚「2023.03 | 3」是未标记文字。
 */
const PAGE_H = 842

interface Line {
  mcid: string | null
  str: string
  y: number
}

function pageOf(lines: Line[], struct: PdfStructNodeLike | null): PdfPageLike {
  const items: PdfTextItemLike[] = []
  for (const l of lines) {
    if (l.mcid) items.push({ type: 'beginMarkedContentProps', id: l.mcid })
    items.push({ str: l.str, transform: [1, 0, 0, 1, 70, PAGE_H - l.y], width: l.str.length * 10, height: 12 })
    if (l.mcid) items.push({ type: 'endMarkedContent' })
  }
  return {
    getViewport: () => ({ width: 595, height: PAGE_H }),
    getTextContent: async () => ({ items }),
    getStructTree: async () => struct,
  }
}

const content = (id: string): PdfStructNodeLike => ({ type: 'content', id })
const P = (...ids: string[]): PdfStructNodeLike => ({ role: 'P', children: ids.map(content) })
const doc = (...children: PdfStructNodeLike[]): PdfStructNodeLike => ({ role: 'Root', children: [{ role: 'Document', children }] })

const header = (text: string): Line => ({ mcid: null, str: text, y: 40 })
const footer = (n: number): Line[] => [
  { mcid: null, str: '2023.03', y: 810 },
  { mcid: null, str: String(n), y: 810 },
]

/** 权利要求书页（第 1 页）、说明书页（第 2、3 页）、附图页（第 4 页） */
function fakeDoc(tagged: boolean): PdfDocLike {
  const claims = pageOf(
    [
      header('权 利 要 求 书'),
      { mcid: 'c1', str: '1.一种控制方法，其特征在于，包括以下步骤：采集运行期指标；', y: 100 },
      { mcid: 'c1b', str: '计算漂移分数。', y: 120 },
      { mcid: 'c2', str: '2.根据权利要求1所述的方法，其特征在于，所述漂移分数按滑窗计算。', y: 140 },
      { mcid: 'c3', str: '3.根据权利要求1或2所述的方法，其特征在于，还包括告警步骤。', y: 160 },
      ...footer(1),
    ],
    tagged ? doc(P('c1', 'c1b'), P('c2'), P('c3')) : null,
  )
  const desc1 = pageOf(
    [
      header('说 明 书'),
      { mcid: 'h1', str: '技术领域', y: 100 },
      { mcid: 'p1', str: '[0001]本发明涉及时间序列预测领域。', y: 120 },
      { mcid: 'h2', str: '背景技术', y: 140 },
      { mcid: 'p2', str: '[0002]现有技术存在漂移问题。', y: 160 },
      { mcid: 'p3', str: '[0003]漂移分数按式(1)计算：', y: 180 },
      { mcid: 'eq', str: 'd_t = |x_t - x̂_t|  (1)', y: 200 },
      { mcid: 'p3b', str: '（续段无编号）', y: 220 },
      ...footer(2),
    ],
    tagged
      ? doc(
          P('h1'),
          P('p1'),
          P('h2'),
          P('p2'),
          P('p3'),
          { role: 'Table', children: [{ role: 'TR', children: [{ role: 'TD', children: [{ role: 'P', children: [{ role: 'Formula', children: [content('eq')] }] }] }] }] },
          P('p3b'),
        )
      : null,
  )
  const desc2 = pageOf(
    [
      header('说 明 书'),
      { mcid: 't0', str: '[0007]表1 阈值表', y: 100 },
      { mcid: 't1', str: '指标', y: 120 },
      { mcid: 't2', str: '阈值', y: 120 },
      { mcid: 't3', str: '[0008]', y: 140 },
      { mcid: 'tn', str: '[0009]注：阈值可配置。', y: 160 },
      { mcid: 'p10', str: '[0010]以上实施例仅用于说明。', y: 180 },
      { mcid: 'art', str: '草稿水印', y: 400 },
      ...footer(3),
    ],
    tagged
      ? doc(
          P('t0'),
          { role: 'Table', children: [{ role: 'TR', children: [{ role: 'TD', children: [P('t1')] }, { role: 'TD', children: [P('t2')] }] }, { role: 'TR', children: [{ role: 'TD', children: [P('t3')] }] }] },
          P('tn'),
          P('p10'),
          { role: 'Artifact', children: [content('art')] },
        )
      : null,
  )
  const figs = pageOf([header('说 明 书 附 图'), { mcid: 'f1', str: '图1', y: 500 }, ...footer(4)], tagged ? doc({ role: 'Figure', children: [content('f1')] }) : null)
  const pages = [claims, desc1, desc2, figs]
  return { numPages: pages.length, getPage: async (n) => pages[n - 1] }
}

describe('bookOfHeader', () => {
  it('内核五种页眉（含摘要 vs 说明书 的前缀歧义）', () => {
    expect(bookOfHeader('说 明 书 摘 要')).toBe('abstract')
    expect(bookOfHeader('摘 要 附 图')).toBe('figures')
    expect(bookOfHeader('权 利 要 求 书')).toBe('claims')
    expect(bookOfHeader('说 明 书 附 图')).toBe('figures')
    expect(bookOfHeader('说 明 书2023.033')).toBe('description')
    expect(bookOfHeader('')).toBeNull()
  })
})

describe('struct 模式（tagged PDF）', () => {
  it('MCID 首文本段号 / 权项号 → block_id；续段归上一块；表题 / 表注 / 表体归表块；Formula 归公式块；Artifact 排除', async () => {
    const ix = await buildPdfBlockIndex(fakeDoc(true), SYNTH_AST, { tagged: true })
    expect(ix.kind).toBe('struct')
    expect(ix.byMcid.get('c1')).toBe('claims/1')
    expect(ix.byMcid.get('c1b')).toBe('claims/1')
    expect(ix.byMcid.get('c3')).toBe('claims/3')
    expect(ix.byMcid.get('h1')).toBe('description/技术领域')
    expect(ix.byMcid.get('p1')).toBe('description/技术领域/p0001')
    expect(ix.byMcid.get('eq')).toBe('description/发明内容/技术方案/eq1')
    expect(ix.byMcid.get('p3b')).toBe('description/发明内容/技术方案/p0003')
    for (const m of ['t0']) expect(ix.byMcid.get(m)).toBe('description/具体实施方式/p0007')
    for (const m of ['t1', 't2', 't3', 'tn']) expect(ix.byMcid.get(m)).toBe('description/具体实施方式/p0008')
    expect(ix.byMcid.has('art')).toBe(false)
    expect(ix.byBlock.get('claims/1')).toMatchObject({ page: 1, mcids: ['c1', 'c1b'] })
    expect(ix.byBlock.get('claims/1')!.rects).toHaveLength(2)
    expect(ix.byBlock.get('description/具体实施方式/p0008')!.page).toBe(3)
    expect(ix.bookOfPage(1)).toBe('claims')
    expect(ix.bookOfPage(4)).toBe('figures')
  })

  it('locate：MCID 直查 / 页脚日期 generated / 附图页 figure / 水印 generated', async () => {
    const ix = await buildPdfBlockIndex(fakeDoc(true), SYNTH_AST, { tagged: true })
    expect(ix.locate({ page: 2, text: '[0002]现有技术存在漂移问题。', mcid: 'p2' })).toEqual({ blockId: 'description/背景技术/p0002', line: 26 })
    expect(ix.locate({ page: 1, text: '3.根据权利要求1或2所述的方法', itemIndex: 4 })).toEqual({ blockId: 'claims/3', line: 13 })
    // 说明书第 3 页页脚「2023.03」「3」：未标记文字，不得配到 claims/3
    expect(ix.locate({ page: 3, text: '2023.03' })).toEqual({ fail: 'generated' })
    expect(ix.locate({ page: 3, text: '3', itemIndex: 8 })).toEqual({ fail: 'generated' })
    expect(ix.locate({ page: 3, text: '3.' })).not.toHaveProperty('blockId')
    expect(ix.locate({ page: 4, text: '图1', mcid: 'f1' })).toEqual({ fail: 'figure' })
    expect(ix.locate({ page: 3, text: '草稿水印', mcid: 'art' })).toEqual({ fail: 'generated' })
  })
})

describe('heuristic 模式（普通 PDF）', () => {
  it('段号 / 权项号页级配对；权项只认权利要求书页；页脚「3」「2023.03」不配权项 3', async () => {
    const ix = await buildPdfBlockIndex(fakeDoc(false), SYNTH_AST, { tagged: false })
    expect(ix.kind).toBe('heuristic')
    expect(ix.byMcid.size).toBe(0)
    expect(ix.byBlock.get('claims/3')).toMatchObject({ page: 1 })
    expect(ix.byBlock.get('description/背景技术/p0002')).toMatchObject({ page: 2 })
    expect(ix.byBlock.get('description/具体实施方式/p0008')).toMatchObject({ page: 3 })
    expect(ix.byBlock.get('description/技术领域')).toMatchObject({ page: 2 })
    expect(ix.byBlock.has('claims/4')).toBe(false)
    expect(ix.locate({ page: 3, text: '3.' })).not.toHaveProperty('blockId')
    expect(ix.locate({ page: 3, text: '2023.03' })).toEqual({ fail: 'generated' })
    expect(ix.locate({ page: 2, text: '[0002]现有技术存在漂移问题。' })).toEqual({ blockId: 'description/背景技术/p0002', line: 26 })
    expect(ix.locate({ page: 1, text: '3.根据权利要求1或2所述的方法，其特征在于，还包括告警步骤。' })).toEqual({ blockId: 'claims/3', line: 13 })
  })

  it('tagged=true 但 PDF 无结构树（CLI 回退）→ 退到 heuristic', async () => {
    const ix = await buildPdfBlockIndex(fakeDoc(false), SYNTH_AST, { tagged: true })
    expect(ix.kind).toBe('heuristic')
  })

  it('六种失败码：short / ambiguous（含候选页）/ nomatch / figure / generated', async () => {
    const ix = await buildPdfBlockIndex(fakeDoc(false), SYNTH_AST, { tagged: false })
    expect(ix.locate({ page: 2, text: '漂移' })).toEqual({ fail: 'short' })
    expect(ix.locate({ page: 2, text: '' })).toEqual({ fail: 'short' })
    // 「漂移分数」出现在 p0003 与 p0002 之外的多块（claims 不在说明书页比对范围）→ 说明书内多块命中
    expect(ix.locate({ page: 2, text: '本发明可' })).toEqual({ fail: 'ambiguous' })
    expect(pdfLocateCandidates(ix, '本发明').length).toBeGreaterThan(0)
    expect(ix.locate({ page: 2, text: '这段文字不在文档里出现过' })).toEqual({ fail: 'nomatch' })
    expect(ix.locate({ page: 4, text: '图1' })).toEqual({ fail: 'figure' })
    expect(ix.locate({ page: 9, text: '不存在的页' })).toEqual({ fail: 'nomatch' })
  })
})
