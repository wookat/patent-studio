// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorCommands, registerEditorView } from '@/components/editor/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isFigureReferenced } from '@/lib/api'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import type { ProjectDetail } from '@/lib/types'
import type { FiguresResponse } from '@/types/figures'
import type { PreflightReport } from '@/types/preflight'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FiguresPanel } from '../FiguresPanel'
import { captionOf, figureAnnouncements, refsOf } from '../figureModel'

/**
 * R2 A3：FiguresPanel 卡片面板。空态 / 501 / 3 卡渲染（预览·占位·题注·引用数）/ 宽度·摘要图 PUT / 上传（选择器 + 拖放）/
 * 键盘排序（dnd-kit KeyboardSensor）与上移下移 → reorderFigures / 删除守卫 409 对话框 → gotoLine / 插入引用 / axe。
 * jsdom 无布局：color-contrast / scrollable-region-focusable 禁用；dnd-kit 键盘排序靠打桩 getBoundingClientRect 给卡片纵向坐标。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const testQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notImplemented = () => json({ detail: { kind: 'not-implemented', message: 'R2 A1-figures-api 未实现', line: null, detail: null } }, 501)
const settings = initial.settings ?? ({} as FiguresResponse['settings'])

const two: FiguresResponse = {
  figures: [
    { name: 'fig1.png', ext: '.png', size: 10, num: 1, width: 12, alt: '图1 总体流程图', is_abstract: true, abstract_width: 6, preview: '/api/projects/method/figs/fig1.png', companions: [] },
    { name: 'fig2.emf', ext: '.emf', size: 20, num: 2, width: 12, alt: '', is_abstract: false, abstract_width: null, preview: null, companions: ['fig2.png'] },
  ],
  settings,
}
const three: FiguresResponse = {
  figures: [
    { name: 'fig1.emf', ext: '.emf', size: 10, num: 1, width: 15, alt: '图1 总体流程图', is_abstract: true, abstract_width: 14.5, preview: 'fig1.png', companions: ['fig1.png', 'fig1.svg'] },
    { name: 'fig2.emf', ext: '.emf', size: 20, num: 2, width: 15, alt: '', is_abstract: false, abstract_width: null, preview: null, companions: [] },
    { name: 'fig3.png', ext: '.png', size: 30, num: 3, width: 12, alt: '', is_abstract: false, abstract_width: null, preview: 'fig3.png', companions: [] },
  ],
  settings,
}
const ast = {
  version: 1,
  title: { text: '一种系统', line: 1 },
  books: { abstract: { offset: 0 }, claims: { offset: 10 }, description: { offset: 20 } },
  abstract: { id: 'abstract', lines: { start: 1, end: 3 } },
  claims: [],
  description: [],
  figures: [
    { id: 'f1', kind: 'figure', num: 1, file: 'fig1.emf', width: 15, caption: '本发明的系统框图', caption_line: 41 },
    { id: 'f2', kind: 'figure', num: 2, file: 'fig2.emf', width: 15, caption: null, caption_line: null },
    { id: 'f3', kind: 'figure', num: 3, file: 'fig3.png', width: 12, caption: '流程示意图', caption_line: 43 },
  ],
} as unknown as Ast
const report = {
  version: 1,
  items: [],
  figures: [
    { num: 1, file: 'fig1.emf', caption_line: 41, refs: [{ book: 'description', line: 88, text: '如图1所示' }, { book: 'description', line: 90, text: '参见图1' }] },
    { num: 2, file: 'fig2.emf', caption_line: null, refs: [] },
  ],
} as unknown as PreflightReport

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  // jsdom 无布局：CodeMirror 的 rAF measure 用到 Range 几何
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
})

const projectOf = (id: string) => ({ id, title: id, figs: [], settings, has_settings_file: true, content: '', backups: [] }) as unknown as ProjectDetail

beforeEach(() => {
  useStudio.setState({ ...initial, pid: 'method', project: projectOf('method') }, false)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  registerEditorView(null)
  vi.restoreAllMocks()
})

async function mount(variant: 'desktop' | 'mobile' = 'desktop') {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<QueryClientProvider client={testQC}><FiguresPanel variant={variant} /></QueryClientProvider>))
  return host
}

/** 挂载并让首个 GET /figures 返回 resp；之后的请求交给 next（默认回同一份） */
async function mountWith(resp: FiguresResponse, variant: 'desktop' | 'mobile' = 'desktop', next?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (!init?.method || init.method === 'GET') return json(resp)
    return next ? next(url, init) : json(resp)
  })
  const el = await mount(variant)
  return { el, fetchMock }
}

const cards = (el: Element) => Array.from(el.querySelectorAll<HTMLElement>('[data-slot="FigureCard"]'))
const q = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)!
const click = (el: Element | null) => act(async () => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const key = (el: Element, key: string, code = key) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })))
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body))

async function axeViolations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('FiguresPanel：空态 / 501', () => {
  it('挂载即 GET /figures；501 → figuresUnavailable，空态显示未实现文案，上传禁用，axe 零违规', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(notImplemented())
    const el = await mount()
    const figCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/figures'))
    expect(figCalls).toHaveLength(1)
    expect(useStudio.getState().figuresUnavailable).toBe(true)
    expect(useStudio.getState().figuresPid).toBe('method')
    expect(el.querySelector('[data-slot="FiguresPanel"]')?.getAttribute('data-variant')).toBe('desktop')
    expect(el.querySelector('[data-testid="figures-empty"]')?.textContent).toContain('尚未实现')
    expect(el.querySelector<HTMLButtonElement>('[data-testid="figures-upload"]')?.disabled).toBe(true)
    expect(el.querySelector('[data-testid="figures-empty-upload"]')).toBeNull()
    expect(await axeViolations(el)).toEqual([])
  })

  it('无附图 → 空态带「选择图片」按钮，点击打开文件选择器', async () => {
    const { el } = await mountWith({ figures: [], settings })
    expect(el.querySelector('[data-testid="figures-empty"]')?.textContent).toContain('暂无附图')
    const input = q<HTMLInputElement>('[data-testid="figures-file-input"]', el)
    const open = vi.spyOn(input, 'click')
    await click(el.querySelector('[data-testid="figures-empty-upload"]'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="figures-export"]')?.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('FiguresPanel：卡片渲染', () => {
  it('成功响应 → 卡片（图号 + 文件名）、计数、导出 zip 链接；mobile 变体带 data-variant 与上移/下移按钮', async () => {
    const { el } = await mountWith(two, 'mobile')
    expect(el.querySelector('[data-slot="FiguresPanel"]')?.getAttribute('data-variant')).toBe('mobile')
    expect(el.querySelector('[data-testid="figures-count"]')?.textContent).toBe('2 幅')
    expect(cards(el).map((c) => c.dataset.testid)).toEqual(['figure-card-fig1.png', 'figure-card-fig2.emf'])
    expect(cards(el).map((c) => q('[data-testid="figure-num"]', c).textContent)).toEqual(['图1', '图2'])
    expect(cards(el).map((c) => q('[data-testid="figure-name"]', c).textContent)).toEqual(['fig1.png', 'fig2.emf +1'])
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="figures-export"]')?.getAttribute('href')).toBe('/api/projects/method/figures/export.zip')
    expect(el.querySelectorAll('[data-testid="figure-move-up"]').length).toBe(2)
    expect(el.querySelector('[data-testid="figure-drag-handle"]')).toBeNull()
    expect(await axeViolations(el)).toEqual([])
  })

  it('3 卡：预览图 / 占位图标、AST 题注（无则「未写题注」）、摘要徽标、体检引用数；axe 零违规', async () => {
    useStudio.setState({ ast, preflight: report, preflightPid: 'method' })
    const { el } = await mountWith(three)
    const [c1, c2, c3] = cards(el)
    expect(q<HTMLImageElement>('[data-testid="figure-thumb"]', c1).getAttribute('src')).toBe('/api/projects/method/figs/fig1.png')
    expect(c2.querySelector('[data-testid="figure-thumb"]')).toBeNull()
    expect(q('[data-testid="figure-thumb-placeholder"]', c2).textContent).toContain('emf')
    expect(q('[data-testid="figure-caption"]', c1).textContent).toBe('本发明的系统框图')
    expect(q('[data-testid="figure-caption"]', c2).textContent).toBe('未写题注')
    expect(q('[data-testid="figure-caption"]', c3).textContent).toBe('流程示意图')
    expect(q('[data-testid="figure-abstract-badge"]', c1).textContent).toContain('摘要')
    // W12 R8-02：徽章走 §1.4 七色相 ok 族（浅 6.5:1 / 深 8:1），不用品牌原始层 brand-100（浅 4.49 / 深 2.07 不达 AA）
    expect(q('[data-testid="figure-abstract-badge"]', c1).className).toMatch(/\bbg-ok-bg\b.*\btext-ok-fg\b/)
    expect(q('[data-testid="figure-abstract-badge"]', c1).className).not.toMatch(/brand-100|text-primary\b/)
    // 伴生文件计数 +N 不再叠 opacity（fg-muted 叠 70% 深色只剩 3.64:1）
    expect(q('[data-testid="figure-name"]', c1).textContent).toBe('fig1.emf +2')
    expect(q('[data-testid="figure-name"] span', c1).className).not.toMatch(/opacity/)
    expect(c2.querySelector('[data-testid="figure-abstract-badge"]')).toBeNull()
    expect(q('[data-testid="figure-ref-count"]', c1).textContent).toBe('引用 2')
    expect(q('[data-testid="figure-ref-count"]', c2).textContent).toBe('引用 0')
    expect(c3.querySelector('[data-testid="figure-ref-count"]')?.textContent).toBe('引用 0')
    expect(el.querySelectorAll('[data-testid="figure-drag-handle"]').length).toBe(3)
    expect(await axeViolations(el)).toEqual([])
  })

  it('题注按钮 → gotoLine(说明书 offset + caption_line)；体检报告属于别的案子时不显示引用数；mobile 题注按钮 min-h-touch（W12 R9-03）', async () => {
    useStudio.setState({ ast, preflight: report, preflightPid: 'system' })
    const { el } = await mountWith(three, 'mobile')
    const goto = vi.fn()
    await act(async () => useStudio.setState({ gotoLine: goto }))
    const cap = q('[data-testid="figure-caption"]', cards(el)[0])
    expect(cap.tagName).toBe('BUTTON')
    expect(cap.className).toContain('min-h-touch')
    await click(cap)
    expect(goto).toHaveBeenCalledWith(61)
    expect(el.querySelector('[data-testid="figure-ref-count"]')).toBeNull()
    expect(captionOf(ast, 2)).toEqual({ text: null, line: null })
    expect(refsOf(null, 1)).toBeNull()
  })

  it('桌面 dock 下题注按钮 → 露出 / 新开说明书源码卡片（openPanel）+ focus{book, line}，不发无人消费的 scrollRequest', async () => {
    useStudio.setState({ ast })
    const { el } = await mountWith(three)
    const goto = vi.fn()
    const openPanel = vi.fn()
    await act(async () =>
      useStudio.setState({
        gotoLine: goto,
        dockHandle: { openPanel, panelIds: () => ['source:claims', 'pdf'], isPanelVisible: () => true } as never,
        activePanelId: 'pdf',
      }),
    )
    await click(q('[data-testid="figure-caption"]', cards(el)[0]))
    expect(openPanel).toHaveBeenLastCalledWith('source:description', { position: { referencePanel: 'source:claims', direction: 'within' } })
    expect(useStudio.getState().focus).toMatchObject({ book: 'description', line: 61, source: 'outline' })
    expect(goto).not.toHaveBeenCalled()
    useStudio.setState({ dockHandle: null })
  })

  it('切案：pid 先变、project 未就位时不拉列表也不用旧卡片拼新 pid 的缩略图；project 就位后才 GET 新案', async () => {
    const { el, fetchMock } = await mountWith(three)
    expect(cards(el)).toHaveLength(3)
    await act(async () => useStudio.setState({ pid: 'system' }))
    expect(cards(el)).toHaveLength(0)
    expect(el.querySelector('[data-testid="figures-empty"]')?.textContent).toContain('正在读取')
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/figures'))).toHaveLength(1)
    await act(async () => {
      useStudio.getState().resetFigures()
      useStudio.setState({ project: projectOf('system') })
    })
    const figCalls2 = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/figures'))
    expect(figCalls2).toHaveLength(2)
    expect(String(figCalls2[1][0])).toBe('/api/projects/system/figures')
    expect(cards(el)).toHaveLength(3)
    expect(q<HTMLImageElement>('[data-testid="figure-thumb"]', el).getAttribute('src')).toBe('/api/projects/system/figs/fig1.png')
  })

  it('点卡片 → selectedFigure；卡片带 data-selected', async () => {
    const { el } = await mountWith(three)
    await click(cards(el)[1])
    expect(useStudio.getState().selectedFigure).toBe('fig2.emf')
    expect(cards(el)[1].dataset.selected).toBe('true')
  })
})

describe('FiguresPanel：宽度 / 摘要图 / 上传', () => {
  it('宽度输入 Enter → PUT /figures/{name} {width}；非法值不请求；Esc 放弃', async () => {
    const put = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(three, 'desktop', put)
    const input = q<HTMLInputElement>('input[aria-label="图2 说明书宽度（厘米）"]', el)
    expect(input.value).toBe('15')
    const type = (v: string) => act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await type('12.5')
    await key(input, 'Enter')
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/api/projects/method/figures/fig2.emf')
    expect(put.mock.calls[0][1]?.method).toBe('PUT')
    expect(bodyOf(put.mock.calls[0][1])).toEqual({ width: 12.5 })

    await type('-3')
    await key(input, 'Enter')
    expect(put).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('15')

    // R37-01：超过 17cm（A4 版心）钳到 17，不再原样提交 1512
    await type('1512')
    await key(input, 'Enter')
    expect(put).toHaveBeenCalledTimes(2)
    expect(bodyOf(put.mock.calls[1][1])).toEqual({ width: 17 })

    await type('9')
    expect(input.hasAttribute('data-esc-local')).toBe(true)
    await key(input, 'Escape')
    expect(input.value).toBe('15')
    expect(input.hasAttribute('data-esc-local')).toBe(false)
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('移动端摘要宽度输入存在；菜单「设为摘要附图」→ PUT {abstract:true}', async () => {
    const put = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(three, 'mobile', put)
    expect(el.querySelector('input[aria-label="图1 摘要附图宽度（厘米）"]')).not.toBeNull()
    expect(el.querySelector('input[aria-label="图2 摘要附图宽度（厘米）"]')).toBeNull()
    await act(async () => useStudio.getState().updateFigure('fig3.png', { abstract: true }))
    expect(put.mock.calls[0][0]).toBe('/api/projects/method/figures/fig3.png')
    expect(bodyOf(put.mock.calls[0][1])).toEqual({ abstract: true })
  })

  it('文件选择器 → POST /figures multipart（多文件）；上传中按钮禁用并显示进度；完成后恢复', async () => {
    let release!: () => void
    const post = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el, fetchMock } = await mountWith(two)
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST') return new Promise<Response>((r) => (release = () => r(post(String(input), init))))
      return Promise.resolve(json(three))
    })
    const input = q<HTMLInputElement>('[data-testid="figures-file-input"]', el)
    const files = [new File([new Uint8Array([1, 2, 3])], 'fig9.png', { type: 'image/png' }), new File(['x'], 'fig10.emf')]
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    const btn = q<HTMLButtonElement>('[data-testid="figures-upload"]', el)
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('上传中')
    await act(async () => release())
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe('/api/projects/method/figures')
    const fd = post.mock.calls[0][1]?.body as FormData
    expect(fd.getAll('files').map((f) => (f as File).name)).toEqual(['fig9.png', 'fig10.emf'])
    expect(btn.disabled).toBe(false)
    expect(useStudio.getState().figures.length).toBe(3)
  })

  it('整个面板是 drop zone：dragover 高亮，drop 文件 → uploadFigures', async () => {
    const post = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(two, 'desktop', post)
    const panel = q('[data-testid="figures-panel"]', el)
    const file = new File(['x'], 'drop.png', { type: 'image/png' })
    const dt = { types: ['Files'], files: [file] }
    const drag = (type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      return act(async () => panel.dispatchEvent(ev))
    }
    await drag('dragover')
    expect(panel.dataset.dragover).toBe('true')
    expect(el.querySelector('[data-testid="figures-dropzone"]')).not.toBeNull()
    await drag('drop')
    expect(panel.dataset.dragover).toBeUndefined()
    expect(post).toHaveBeenCalledTimes(1)
    expect((post.mock.calls[0][1]!.body as FormData).getAll('files').length).toBe(1)
  })
})

describe('FiguresPanel：排序', () => {
  it('移动端「下移」→ PUT /figures/order（arrayMove）；首张「上移」禁用', async () => {
    const put = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(three, 'mobile', put)
    expect(q<HTMLButtonElement>('[data-testid="figure-move-up"]', cards(el)[0]).disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="figure-move-down"]', cards(el)[2]).disabled).toBe(true)
    await click(q('[data-testid="figure-move-down"]', cards(el)[0]))
    expect(put.mock.calls[0][0]).toBe('/api/projects/method/figures/order')
    expect(bodyOf(put.mock.calls[0][1])).toEqual({ order: ['fig2.emf', 'fig1.emf', 'fig3.png'] })
  })

  it('桌面键盘排序：手柄 空格 抓起 → ↓ → 空格 放下 → reorderFigures([2,1,3])；播报为中文', async () => {
    // jsdom 无布局：给每张卡一个纵向坐标，dnd-kit 的 sortableKeyboardCoordinates / closestCenter 才能算出目标
    const proto = HTMLElement.prototype
    vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const card = this.closest<HTMLElement>('[data-slot="FigureCard"]')
      const i = card ? Array.from(card.parentElement!.children).indexOf(card) : 0
      const top = i * 100
      const h = card === this ? 90 : 20
      return { x: 0, y: top, top, left: 0, width: 200, height: h, right: 200, bottom: top + h, toJSON() {} } as DOMRect
    })
    const put = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(three, 'desktop', put)
    const handle = q('[data-testid="figure-drag-handle"]', cards(el)[0])
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable')
    handle.focus()
    await key(handle, ' ', 'Space')
    expect(document.body.textContent).toContain('已抓起 图1')
    await key(handle, 'ArrowDown')
    expect(document.body.textContent).toContain('图1 移到第 2 位')
    await key(handle, ' ', 'Space')
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/api/projects/method/figures/order')
    expect(bodyOf(put.mock.calls[0][1])).toEqual({ order: ['fig2.emf', 'fig1.emf', 'fig3.png'] })
  })

  it('figureAnnouncements：无 over 时的文案', () => {
    const a = figureAnnouncements((n) => (n === 'fig1.emf' ? '图1' : n))
    const active = { id: 'fig1.emf' } as never
    expect(a.onDragStart({ active } as never)).toBe('已抓起 图1')
    expect(a.onDragOver({ active, over: null } as never)).toBe('图1 已移出列表')
    expect(a.onDragOver({ active, over: { id: 'fig1.emf', data: { current: undefined } } } as never)).toBeUndefined()
    expect(a.onDragEnd({ active, over: { id: 'fig2.emf', data: { current: { sortable: { index: 1 } } } } } as never)).toBe('图1 放在第 2 位')
    expect(a.onDragCancel({ active } as never)).toBe('已取消，图1 回到原位')
  })

  it('reorderFigures 乐观更新，失败回滚并 toast', async () => {
    useStudio.setState({ figures: two.figures, figuresPid: 'method' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'boom' }, 500))
    await useStudio.getState().reorderFigures(['fig2.emf', 'fig1.png'])
    expect(useStudio.getState().figures.map((f) => f.name)).toEqual(['fig1.png', 'fig2.emf'])
    expect(useStudio.getState().toasts.length).toBe(1)
  })
})

describe('FiguresPanel：更换图片', () => {
  it('菜单「更换图片」→ 所选文件改回本组 stem → PUT /{name}/image；figsVersion 递增使预览 URL 带 ?v= 缓存破', async () => {
    const put = vi.fn((_url: string, _init?: RequestInit) => json(three))
    const { el } = await mountWith(three, 'desktop', put)
    const v0 = useStudio.getState().figsVersion

    const trigger = q('[data-testid="figure-menu"]', cards(el)[0])
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })))
    await click(q('[data-testid="figure-menu-replace"]'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) // rAF 开文件框

    const input = q<HTMLInputElement>('[data-testid="figures-replace-input"]', el)
    const picked = [new File(['x'], '客户给的新图.jpg', { type: 'image/jpeg' }), new File(['y'], '预览.png', { type: 'image/png' })]
    Object.defineProperty(input, 'files', { value: picked, configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))

    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/api/projects/method/figures/fig1.emf/image')
    const fd = put.mock.calls[0][1]?.body as FormData
    // 所选文件改回本组 stem（fig1.*），后缀沿用所选——后端据后缀定主文件
    expect(fd.getAll('files').map((f) => (f as File).name)).toEqual(['fig1.jpg', 'fig1.png'])
    expect(useStudio.getState().figsVersion).toBe(v0 + 1)
    expect(q<HTMLImageElement>('[data-testid="figure-thumb"]', cards(el)[0]).getAttribute('src')).toContain(`?v=${v0 + 1}`)
  })

  it('只读角色禁用「更换图片」项', async () => {
    await mountWith(three, 'desktop')
    await act(async () => useStudio.setState({ project: { ...projectOf('method'), role: 'viewer' } as ProjectDetail }))
    const trigger = q('[data-testid="figure-menu"]', cards(document.body)[0])
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })))
    expect(q('[data-testid="figure-menu-replace"]').hasAttribute('data-disabled')).toBe(true)
  })
})

describe('FiguresPanel：删除守卫', () => {
  const refs = [
    { book: 'description', line: 161, text: '如图1所示，系统包括…' },
    { book: 'claims', line: 12, text: '根据图1的方法' },
  ]

  it('deleteFigure 409 figure-referenced → {ok:false, refs}，不 toast；isFigureReferenced 识别形状', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ detail: { kind: 'figure-referenced', message: '图1 被引用 1 处', line: 161, detail: null, refs: [refs[0]] } }, 409),
    )
    const r = await useStudio.getState().deleteFigure('fig1.png')
    expect(r).toEqual({ ok: false, refs: [refs[0]] })
    expect(useStudio.getState().toasts).toEqual([])
    expect(isFigureReferenced(new Error('x'))).toBe(false)
  })

  it('菜单「删除」→ alertdialog 确认 → 409 → 列出引用行（书/行/原文）→ 点击 gotoLine 并关闭；axe 零违规', async () => {
    const del = vi.fn((_url: string, _init?: RequestInit) =>
      json({ detail: { kind: 'figure-referenced', message: '图1 被引用 2 处', line: 161, detail: null, refs } }, 409),
    )
    const { el } = await mountWith(three, 'desktop', del)
    const goto = vi.fn()
    await act(async () => useStudio.setState({ gotoLine: goto }))

    const trigger = q('[data-testid="figure-menu"]', cards(el)[0])
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })))
    await key(q('[role="menu"]'), 'ArrowDown')
    const item = q('[data-testid="figure-menu-delete"]')
    await click(item)
    const dlg = q('[data-testid="figure-delete-dialog"]')
    expect(dlg.getAttribute('role')).toBe('alertdialog')
    expect(dlg.dataset.stateRefs).toBe('confirm')
    expect(dlg.textContent).toContain('删除 图1？')
    expect(dlg.textContent).toContain('fig1.emf')
    expect(document.activeElement?.getAttribute('data-testid')).toBe('figure-delete-confirm')

    await click(q('[data-testid="figure-delete-confirm"]'))
    // fetch mock 的 next 回调吃全部非 GET——只数 DELETE（同下例口径；整文件跑时其它面板可能有在飞非 GET）
    const deletes = del.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0][0]).toBe('/api/projects/method/figures/fig1.emf')
    expect(dlg.dataset.stateRefs).toBe('blocked')
    expect(dlg.textContent).toContain('仍被正文引用')
    const rows = Array.from(dlg.querySelectorAll('[data-testid="figure-ref"]'))
    expect(rows.map((r) => r.textContent)).toEqual(['说明书如图1所示，系统包括…', '权利要求书根据图1的方法'])
    expect(dlg.textContent).not.toMatch(/L\d+/)
    expect(dlg.querySelector('[data-testid="figure-delete-confirm"]')).toBeNull()
    expect(await axeViolations(dlg)).toEqual([])

    await click(rows[1])
    expect(goto).toHaveBeenCalledWith(12)
    expect(document.querySelector('[data-testid="figure-delete-dialog"]')).toBeNull()
    expect(useStudio.getState().figures.length).toBe(3)
  })

  it('确认删除成功 → 对话框关闭，列表更新', async () => {
    const rest = { ...three, figures: three.figures.slice(1) }
    const del = vi.fn((_url: string, _init?: RequestInit) => json(rest))
    const { el } = await mountWith(three, 'mobile', del)
    const trigger = q('[data-testid="figure-menu"]', cards(el)[0])
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
    await click(q('[data-testid="figure-menu-delete"]'))
    await click(q('[data-testid="figure-delete-confirm"]'))
    const deletes = del.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes.map(([url]) => url)).toEqual(['/api/projects/method/figures/fig1.emf'])
    expect(document.querySelector('[data-testid="figure-delete-dialog"]')).toBeNull()
    expect(cards(el).map((c) => c.dataset.name)).toEqual(['fig2.emf', 'fig3.png'])
  })
})

describe('FiguresPanel：插入引用', () => {
  it('编辑器已挂载 → 光标处插入「图2」；移动端切回 edit tab、关抽屉与伴随 Sheet（W12 R9-03）', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state: EditorState.create({ doc: '如所示' }), parent })
    view.dispatch({ selection: { anchor: 1 } })
    registerEditorView(view)
    useStudio.setState({
      mobileTab: 'figures' as never,
      mobileNav: { ...initial.mobileNav, open: true },
      companion: 'figures',
      rightRailOpen: true,
      reviewDrawerOpen: true,
      reviewHiddenByCompanion: 'rail-column',
    })
    const { el } = await mountWith(three, 'mobile')
    await click(q('[data-testid="figure-insert-ref"]', cards(el)[1]))
    expect(view.state.doc.toString()).toBe('如图2所示')
    expect(useStudio.getState().mobileTab).toBe('edit')
    expect(useStudio.getState().mobileNav.open).toBe(false)
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().reviewDrawerOpen, '先开的审阅 Sheet 也收走，编辑器可见').toBe(false)
    view.destroy()
    parent.remove()
  })

  it('编辑器未挂载 → info toast，不抛错；未编入的文件禁用插入', async () => {
    const unlisted = { ...three, figures: [...three.figures, { ...three.figures[2], name: 'extra.png', num: null, width: null }] }
    const { el } = await mountWith(unlisted)
    expect(editorCommands.getState().ready).toBe(false)
    await click(q('[data-testid="figure-insert-ref"]', cards(el)[0]))
    const t = useStudio.getState().toasts
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('info')
    expect(t[0].text).toContain('图1')
    expect(q<HTMLButtonElement>('[data-testid="figure-insert-ref"]', cards(el)[3]).disabled).toBe(true)
    expect(q('[data-testid="figure-num"]', cards(el)[3]).textContent).toBe('未编入')
  })
})
