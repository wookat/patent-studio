import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, Style } from '@/lib/types'
import { useStudio } from '@/store'
import {
  DEFAULT_HEADINGS,
  applyHeadings,
  applyParagraphStyle,
  headingVars,
  paragraphStyleValue,
  readHeadings,
  resolveHeading,
  useStyleEdit,
} from '@/store/styleEdit'

const STYLE: Style = {
  fonts: { body_cjk: '宋体', heading_cjk: '黑体', ascii: 'Times New Roman', label_ascii: 'Times New Roman', mono: 'Consolas' },
  sizes: { body: 10.5, title: 16, section_heading: 12, subsection_heading: 10.5, header: 9, footer: 9, page_number: 9, para_number: 10.5, table: 9, equation: 10.5, code: 9 },
  paragraph: { line_spacing: 1.5, first_indent_pt: 21, space_after: { body: 0 } },
  page: { width_cm: 21, height_cm: 29.7, margin_top_mm: 25, margin_bottom_mm: 20, margin_left_mm: 25, margin_right_mm: 20, header_distance_cm: 1.5, footer_distance_cm: 1.5, line_pitch: 15.6, default_tab_stop: 420 },
  header: { labels: { abstract: '说明书摘要', abstract_figure: '摘要附图', claims: '权利要求书', description: '说明书', figures: '说明书附图' }, spacing_short: 0, spacing_long: 0, rule_sz: 4, rule_space: 1 },
  footer: { codes: { abstract: '1', abstract_figure: '2', claims: '3', description: '4', figures: '5' }, year_text: '', rule_sz: 4, rule_space: 1 },
  table: { defaults: {}, cell_space_after: 0, rule_outer_sz: 8, rule_head_sz: 4 },
  equation: { side_cm: 1 },
}

describe('readHeadings / resolveHeading', () => {
  it('缺失 / 部分 / 非法值 → 默认（font/size null 继承，align 只认 center，numbering 只认 cn|arabic）', () => {
    expect(readHeadings(undefined)).toEqual(DEFAULT_HEADINGS)
    const h = readHeadings({ headings: { section: { font: '楷体', size: 'x', bold: 1, align: 'right', numbering: 'roman' }, subsection: { align: 'center', numbering: 'arabic', bold: true } } })
    expect(h.section).toEqual({ font: '楷体', size: null, bold: false, align: 'left', numbering: 'none' })
    expect(h.subsection).toEqual({ font: null, size: null, bold: true, align: 'center', numbering: 'arabic' })
  })
  it('继承：font null → fonts.heading_cjk；size null → sizes.section_heading / subsection_heading', () => {
    expect(resolveHeading('section', DEFAULT_HEADINGS.section, STYLE)).toMatchObject({ font: '黑体', size: 12 })
    expect(resolveHeading('subsection', { ...DEFAULT_HEADINGS.subsection, size: 14 }, STYLE)).toMatchObject({ font: '黑体', size: 14 })
  })
  it('headingVars 与后端 render_vars 同名十项', () => {
    const v = headingVars({ ...DEFAULT_HEADINGS, section: { font: '楷体', size: 14, bold: true, align: 'center', numbering: 'cn' } }, STYLE)
    expect(v).toEqual({
      '--ps-h3-font': '楷体', '--ps-h3-size': '14pt', '--ps-h3-weight': 'bold', '--ps-h3-align': 'center', '--ps-h3-numbering': 'cn',
      '--ps-h4-font': '黑体', '--ps-h4-size': '10.5pt', '--ps-h4-weight': 'normal', '--ps-h4-align': 'left', '--ps-h4-numbering': 'none',
    })
  })
})

describe('applyParagraphStyle / paragraphStyleValue', () => {
  it('正文字号 → sizes.body；不改入参；表题 → sizes.table；公式无字体叶子', () => {
    const base = { fonts: { ascii: 'Arial' } }
    const out = applyParagraphStyle(base, 'paragraph', { size: 12, font: '仿宋' })
    expect(out).toEqual({ fonts: { ascii: 'Arial', body_cjk: '仿宋' }, sizes: { body: 12 } })
    expect(base).toEqual({ fonts: { ascii: 'Arial' } })
    expect(applyParagraphStyle(undefined, 'table-caption', { size: 9 })).toEqual({ sizes: { table: 9 } })
    expect(applyParagraphStyle(undefined, 'equation', { font: 'X', size: 11 })).toEqual({ sizes: { equation: 11 } })
  })
  it('章节 / 小节标题字体字号 → style.headings.<level>.font/size', () => {
    expect(applyParagraphStyle(undefined, 'section', { font: '楷体' })).toEqual({ headings: { section: { font: '楷体' } } })
    expect(applyParagraphStyle({ headings: { subsection: { bold: true } } }, 'subsection', { size: 14 })).toEqual({ headings: { subsection: { bold: true, size: 14 } } })
  })
  it('paragraphStyleValue 读有效值（override 叠默认；标题走 headings 继承）', () => {
    expect(paragraphStyleValue('paragraph', undefined, STYLE)).toEqual({ font: '宋体', size: 10.5 })
    expect(paragraphStyleValue('section', { headings: { section: { font: '楷体' } } }, STYLE)).toEqual({ font: '楷体', size: 12 })
    expect(paragraphStyleValue('equation', undefined, STYLE)).toEqual({ font: null, size: 10.5 })
  })
  it('applyHeadings：全默认 → 删 headings 键；否则写完整两级', () => {
    expect(applyHeadings({ headings: { section: { font: 'x' } }, sizes: { body: 12 } }, DEFAULT_HEADINGS)).toEqual({ sizes: { body: 12 } })
    const h = { ...DEFAULT_HEADINGS, section: { ...DEFAULT_HEADINGS.section, bold: true } }
    expect(applyHeadings(undefined, h)).toEqual({ headings: h })
  })
})

describe('useStyleEdit.commitParagraphStyle / commitHeadings', () => {
  const settings = (style?: Settings['style']): Settings => ({ abstract_figure: null, spec_figures: [], style } as unknown as Settings)
  let bumped = 0
  beforeEach(() => {
    bumped = 0
    useStudio.setState({
      pid: 'p1',
      settings: settings(),
      saveSettings: (s: Settings) => useStudio.setState({ settings: s }),
      flushSettings: async () => {},
      bumpStyleCss: () => {
        bumped++
      },
    })
    useStyleEdit.setState({ panelOpen: false, panelLevel: 'section', preview: null })
  })

  it('成功：saveSettings → flush → bumpStyleCss，返回 true，settings.style 落新叶子', async () => {
    expect(await useStyleEdit.getState().commitParagraphStyle('paragraph', { size: 12 })).toBe(true)
    expect(useStudio.getState().settings?.style).toEqual({ sizes: { body: 12 } })
    expect(bumped).toBe(1)
  })
  it('失败回滚（saveSettings 未改 settings 引用）→ false，不 bump', async () => {
    useStudio.setState({ saveSettings: vi.fn() })
    expect(await useStyleEdit.getState().commitHeadings({ ...DEFAULT_HEADINGS, section: { ...DEFAULT_HEADINGS.section, bold: true } })).toBe(false)
    expect(bumped).toBe(0)
  })
  it('无案子 → false；openPanel/closePanel 切换 panelOpen 与 level', async () => {
    useStudio.setState({ pid: null })
    expect(await useStyleEdit.getState().commitParagraphStyle('paragraph', { size: 12 })).toBe(false)
    useStyleEdit.getState().openPanel('subsection')
    expect(useStyleEdit.getState()).toMatchObject({ panelOpen: true, panelLevel: 'subsection' })
    useStyleEdit.getState().closePanel()
    expect(useStyleEdit.getState().panelOpen).toBe(false)
  })
})
