// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, Style } from '@/lib/types'
import type { BlockTemplate } from '@/lib/api'
import { useStudio } from '@/store'
import type { Studio } from '@/store/types'
import { useStyleEdit } from '@/store/styleEdit'
import { bookSchema } from '../../doc/bookSchema'
import { fromBookDoc } from '../../doc/fromBookDoc'
import { inlineNodes } from '../../doc/inline'
import { FORMAT_KEYS } from '../commands'
import { popoverPosition, styleNameOf } from '../geometry'
import { FormatBar } from '../FormatBar'
import { SelectionPopover } from '../SelectionPopover'
import { HeadingStylePanel } from '../../style-panel/HeadingStylePanel'
import { applyPreview } from '../../style-panel/preview'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

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
const TEMPLATES: BlockTemplate[] = [
  { kind: 'paragraph', label: '正文段落', book: ['abstract', 'claims', 'description'], markdown: '……', cursor: { line: 1, col: 1 } },
  { kind: 'subsection', label: '小节标题', book: ['description'], markdown: '#### 小节标题', cursor: { line: 1, col: 6 } },
  { kind: 'claim', label: '权项', book: ['claims'], markdown: '%d.一种……，其特征在于，', cursor: { line: 1, col: 3 } },
]

const { ps_para } = bookSchema.nodes
const para = (text: string, blockId = 'description/1') => ps_para.create({ blockId, kind: 'paragraph' }, inlineNodes(text))
function stateOf(text: string, from: number, to = from, book = 'description') {
  const doc = bookSchema.node('doc', { book, lead: 1, trail: 1 }, [para(text)])
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins: [history(), keymap(FORMAT_KEYS)] })
}

let desktop = true
let root: Root | null = null
let host: HTMLElement
let view: EditorView | null = null

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  window.matchMedia = (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  desktop = true
  useStudio.setState({
    pid: 'p1',
    project: null,
    defaults: STYLE,
    settings: { abstract_figure: null, spec_figures: [], style: undefined } as unknown as Settings,
    blockTemplates: TEMPLATES,
    loadBlockTemplates: async () => TEMPLATES,
    saveSettings: (s: Settings) => useStudio.setState({ settings: s }),
    flushSettings: async () => {},
    bumpStyleCss: () => {},
    toast: () => {},
  })
  useStyleEdit.setState({ panelOpen: false, panelLevel: 'section', preview: null })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  view?.destroy()
  view = null
  host?.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
function makeView(state: EditorState) {
  const mountEl = document.createElement('div')
  mountEl.style.position = 'relative'
  document.body.appendChild(mountEl)
  view = new EditorView(mountEl, { state })
  return view
}
const q = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)!
const click = (b: HTMLElement) => act(async () => b.click())
async function violations(el: Element) {
  const res = await axe.run(el, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

describe('FormatBar', () => {
  it('view=null：控件禁用；role=toolbar；axe 0 serious/critical', async () => {
    const el = await mount(<FormatBar view={null} />)
    expect(q('[data-testid="format-bar"]', el).getAttribute('role')).toBe('toolbar')
    expect(q<HTMLButtonElement>('[data-testid="format-mark-strong"]', el).disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="format-undo"]', el).disabled).toBe(true)
    expect(await violations(el)).toEqual([])
  })

  it('批40：块模板加载失败 → 插入钮可用 + 菜单错误行带重试（不静默假空禁用）', async () => {
    const reload = vi.fn(async () => TEMPLATES)
    useStudio.setState({ blockTemplates: null, blockTemplatesError: '连接失败', loadBlockTemplates: reload })
    const v = makeView(stateOf('正文', 1))
    const el = await mount(<FormatBar view={v} />)
    const btn = q<HTMLButtonElement>('[data-testid="format-insert"]', el)!
    expect(btn.disabled).toBe(false)
    await act(async () => btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false, pointerType: 'mouse' } as PointerEventInit)))
    const retry = q('[data-testid="format-insert-retry"]', document)
    expect(retry).toBeTruthy()
    expect(retry.textContent).toContain('块模板加载失败')
    await act(async () => {
      retry.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' } as PointerEventInit))
      retry.click()
    })
    expect(reload).toHaveBeenCalled()
  })

  it('B 按钮 toggle strong 走 toggleMark：源码出现 **…**，aria-pressed 随选区；撤销可用', async () => {
    const v = makeView(stateOf('选中两个字', 3, 5))
    const el = await mount(<FormatBar view={v} />)
    const b = q<HTMLButtonElement>('[data-testid="format-mark-strong"]', el)
    expect(b.getAttribute('aria-pressed')).toBe('false')
    await click(b)
    expect(fromBookDoc(v.state.doc)).toBe('\n选中**两个**字\n\n')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(q<HTMLButtonElement>('[data-testid="format-undo"]', el).disabled).toBe(false)
    await click(q('[data-testid="format-undo"]', el))
    expect(fromBookDoc(v.state.doc)).toBe('\n选中两个字\n\n')
  })

  it('Ctrl+B 键盘（FORMAT_KEYS keymap）与按钮同一命令路径', () => {
    const v = makeView(stateOf('选中两个字', 3, 5))
    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true }))
    expect(fromBookDoc(v.state.doc)).toBe('\n选中**两个**字\n\n')
  })

  it('段落样式下拉显示当前样式名；字号选择弹确认，确认后写 style.sizes.body 并 bumpStyleCss', async () => {
    const bump = vi.fn()
    useStudio.setState({ bumpStyleCss: bump })
    const v = makeView(stateOf('正文', 2))
    const el = await mount(<FormatBar view={v} />)
    expect(q('[data-testid="format-style"]', el).textContent).toContain('正文')
    expect(q('[data-testid="format-size"]', el).textContent).toContain('10.5')
    const size = q<HTMLButtonElement>('[data-testid="format-size"]', el)
    await act(async () => size.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false, pointerType: 'mouse' } as PointerEventInit)))
    const hint = document.body.textContent ?? ''
    expect(hint).toContain('应用于全文所有正文段落')
    const opt = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes('12 pt'))!
    await act(async () => {
      opt.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' } as PointerEventInit))
      opt.click()
    })
    expect(q('[data-testid="format-confirm"]').textContent).toContain('应用于全文所有正文段落')
    await click(q('[data-testid="format-confirm-apply"]'))
    expect(useStudio.getState().settings?.style).toEqual({ sizes: { body: 12 } })
    expect(bump).toHaveBeenCalledTimes(1)
  })

  it('W9 domain-04/qa-03/ux-03：reviewer 字体 / 字号 / 「样式…」禁用并 title 说明，不弹确认框；owner 可用；保存失败不再报「请先打开案子」', async () => {
    const toast = vi.fn()
    useStudio.setState({ toast, project: { id: 'p1', role: 'reviewer' } as unknown as Studio['project'] })
    const v = makeView(stateOf('正文', 2))
    let el = await mount(<FormatBar view={v} />)
    const font = q<HTMLButtonElement>('[data-testid="format-font"]', el)
    const size = q<HTMLButtonElement>('[data-testid="format-size"]', el)
    const styles = q<HTMLButtonElement>('[data-testid="format-styles"]', el)
    expect(font.disabled && size.disabled && styles.disabled).toBe(true)
    expect(font.title).toContain('审阅者不可改样式')
    expect(font.dataset.denied).toBe('')
    // 加粗等选区级格式不受角色限制（reviewer 走 toCritic）
    expect(q<HTMLButtonElement>('[data-testid="format-mark-strong"]', el).disabled).toBe(false)
    await act(async () => size.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' } as PointerEventInit)))
    expect(document.querySelector('[role="option"]')).toBeNull()
    expect(document.querySelector('[data-testid="format-confirm"]')).toBeNull()
    expect(await violations(el)).toEqual([])
    await act(async () => root?.unmount())
    host?.remove()

    useStudio.setState({ project: { id: 'p1', role: 'owner' } as unknown as Studio['project'] })
    el = await mount(<FormatBar view={v} />)
    expect(q<HTMLButtonElement>('[data-testid="format-font"]', el).disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="format-styles"]', el).disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="format-font"]', el).dataset.denied).toBeUndefined()
    expect(q('[data-testid="format-bar"]', el).textContent).not.toContain('studio.json')

    // 服务端 403：saveSettings 回滚（settings 引用不变）并自己 toast；FormatBar 不再叠加「请先打开案子」
    useStudio.setState({ saveSettings: () => toast('设置保存失败：权限不足', 'error') })
    expect(await useStyleEdit.getState().commitParagraphStyle('paragraph', { size: 12 })).toBe(false)
    const s = q<HTMLButtonElement>('[data-testid="format-size"]', el)
    await act(async () => s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' } as PointerEventInit)))
    const opt = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes('12 pt'))!
    await act(async () => {
      opt.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' } as PointerEventInit))
      opt.click()
    })
    expect(q('[data-testid="format-confirm"]').textContent).not.toContain('studio.json')
    await click(q('[data-testid="format-confirm-apply"]'))
    expect(toast.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining('请先打开案子'))
    expect(q('[data-testid="format-size"]', el).textContent).toContain('10.5')
  })

  it('「样式…」打开标题样式面板（光标在小节标题 → subsection）', async () => {
    const v = makeView(stateOf('正文', 2))
    const el = await mount(<FormatBar view={v} />)
    await click(q('[data-testid="format-styles"]', el))
    expect(useStyleEdit.getState()).toMatchObject({ panelOpen: true, panelLevel: 'section' })
    expect(styleNameOf('table')).toBeNull()
    expect(styleNameOf('claim')).toBe('claim')
  })
})

describe('SelectionPopover', () => {
  it('空选区不渲染；非空选区渲染在 view 父容器内，B 加粗后 aria-pressed=true', async () => {
    const v = makeView(stateOf('选中两个字', 3))
    await mount(<SelectionPopover view={v} />)
    expect(document.querySelector('[data-testid="selection-popover"]')).toBeNull()
    await act(async () => {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 3, 5)))
      v.dom.dispatchEvent(new Event('mouseup'))
    })
    const pop = q('[data-testid="selection-popover"]')
    expect(pop.parentElement).toBe(v.dom.parentElement)
    expect(pop.className).not.toContain('--mobile')
    await click(q('[data-testid="selection-mark-strong"]', pop))
    expect(fromBookDoc(v.state.doc)).toBe('\n选中**两个**字\n\n')
    expect(q('[data-testid="selection-mark-strong"]').getAttribute('aria-pressed')).toBe('true')
    expect(await violations(pop)).toEqual([])
  })

  it('批注：输入内容提交 → addComment(pid, {block_id, quote}, body)', async () => {
    const addComment = vi.fn(async () => ({ id: 'c1' }))
    useStudio.setState({ addComment: addComment as never, ast: null })
    const v = makeView(stateOf('选中两个字', 3, 5))
    await mount(<SelectionPopover view={v} />)
    await act(async () => v.dom.dispatchEvent(new Event('mouseup')))
    await click(q('[data-testid="selection-comment"]'))
    const input = q<HTMLInputElement>('[data-testid="selection-comment-input"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '术语不一致')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="selection-comment-submit"]'))
    expect(addComment).toHaveBeenCalledWith('p1', { block_id: 'description/1', line: 0, quote: '两个' }, '术语不一致')
  })

  it('建议修改 → setEditorMode("review")；375：底部条类 + 按钮 44 触控档', async () => {
    desktop = false
    const setEditorMode = vi.fn()
    useStudio.setState({ setEditorMode })
    const v = makeView(stateOf('选中两个字', 3, 5))
    await mount(<SelectionPopover view={v} />)
    await act(async () => v.dom.dispatchEvent(new Event('mouseup')))
    const pop = q('[data-testid="selection-popover"]')
    expect(pop.className).toContain('ps-selection-popover--mobile')
    await click(q('[data-testid="selection-suggest"]', pop))
    expect(setEditorMode).toHaveBeenCalledWith('review')
  })

  it('popoverPosition：选区上方居中，顶部放不下则下方，左右夹进容器', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 400 })
    container.getBoundingClientRect = () => new DOMRect(100, 100, 400, 600)
    const fake = (top: number, left: number) => ({ state: { selection: { from: 1, to: 2 } }, coordsAtPos: () => ({ top, bottom: top + 20, left, right: left }) }) as unknown as EditorView
    expect(popoverPosition(fake(200, 300), container, 100)).toEqual({ left: 200, top: 100 - 6 - 36 })
    expect(popoverPosition(fake(110, 105), container, 100)).toEqual({ left: 54, top: 30 + 6 })
  })
})

describe('HeadingStylePanel', () => {
  it('打开：起草自已保存值；改字体实时内联 --ps-h3-font 到 .ps-layout；保存写 style.headings；axe 0', async () => {
    const layout = document.createElement('div')
    layout.className = 'ps-layout'
    const paper = document.createElement('div')
    paper.className = 'ps-paper'
    layout.appendChild(paper)
    document.body.appendChild(layout)
    useStyleEdit.setState({ panelOpen: true, panelLevel: 'section' })
    await mount(<HeadingStylePanel />)
    const panel = q('[data-testid="heading-style-panel"]')
    expect(layout.style.getPropertyValue('--ps-h3-font')).toBe('黑体')
    expect(paper.dataset.h3Numbering).toBe('none')
    await click(q<HTMLButtonElement>('[data-testid="heading-bold"]', panel))
    expect(layout.style.getPropertyValue('--ps-h3-weight')).toBe('bold')
    const center = [...panel.querySelectorAll<HTMLButtonElement>('[data-testid="heading-align"] button')].find((b) => b.textContent?.includes('居中'))!
    await click(center)
    const cn = [...panel.querySelectorAll<HTMLButtonElement>('[data-testid="heading-numbering"] button')].find((b) => b.textContent?.includes('一、'))!
    await click(cn)
    expect(layout.style.getPropertyValue('--ps-h3-align')).toBe('center')
    expect(paper.dataset.h3Numbering).toBe('cn')
    expect(q('[data-testid="heading-preview"]', panel).textContent).toContain('一、具体实施方式')
    expect(await violations(panel)).toEqual([])
    await click(q('[data-testid="heading-save"]', panel))
    expect(useStudio.getState().settings?.style).toEqual({
      headings: { section: { font: null, size: null, bold: true, align: 'center', numbering: 'cn' }, subsection: { font: null, size: null, bold: false, align: 'left', numbering: 'none' } },
    })
    expect(useStyleEdit.getState().panelOpen).toBe(false)
    expect(layout.style.getPropertyValue('--ps-h3-weight')).toBe('')
  })

  it('重置为默认 → 草稿回默认并可保存（删 headings 键）；applyPreview(null) 清除内联', async () => {
    useStudio.setState({ settings: { abstract_figure: null, spec_figures: [], style: { headings: { section: { bold: true } } } } as unknown as Settings })
    useStyleEdit.setState({ panelOpen: true, panelLevel: 'section' })
    await mount(<HeadingStylePanel />)
    const panel = q('[data-testid="heading-style-panel"]')
    expect(q<HTMLButtonElement>('[data-testid="heading-bold"]', panel).getAttribute('aria-checked')).toBe('true')
    await click(q('[data-testid="heading-reset"]', panel))
    expect(q<HTMLButtonElement>('[data-testid="heading-bold"]', panel).getAttribute('aria-checked')).toBe('false')
    await click(q('[data-testid="heading-save"]', panel))
    expect(useStudio.getState().settings?.style).toEqual({})
    const el = document.createElement('div')
    applyPreview([el], { section: { font: 'x', size: 1, bold: true, align: 'left', numbering: 'none' }, subsection: { font: null, size: null, bold: false, align: 'left', numbering: 'none' } }, STYLE)
    expect(el.style.getPropertyValue('--ps-h3-size')).toBe('1pt')
    applyPreview([el], null, null)
    expect(el.style.getPropertyValue('--ps-h3-size')).toBe('')
  })
})
