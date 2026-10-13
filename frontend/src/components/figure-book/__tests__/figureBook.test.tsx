// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import type { FigureItem, FiguresResponse } from '@/types/figures'
import type { ProjectDetail } from '@/lib/types'
import type { Ast } from '@/types/ast'
import type { PreflightItem, PreflightReport } from '@/types/preflight'
import { FigureBookView, FigureCard, FigureToolbar, UploadDrop, WidthHandle } from '..'
import { badLinesOf, figureIssues, figureReject, gridCols, splitFiles } from '../figureFiles'
import { FilePreviewPanel } from '@/components/attachments/FilePreviewPanel'
import { AttachmentPreview } from '@/components/attachments/AttachmentPreview'
import { figPreviewName } from '@/components/outline/fileTreeUtils'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.getState().resetFigures()
  useStudio.getState().resetFiguresBook()
  useStudio.getState().resetAttachments()
  useStudio.setState({ pid: 'p1', toasts: [] })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: React.ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const key = (el: Element, key: string, shiftKey = false) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })))

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const fig = (name: string, num: number | null, width: number | null, ext = '.svg'): FigureItem => ({
  name, ext, size: 1, num, alt: num ? `图${num} 示意图` : null, width, is_abstract: num === 1, abstract_width: num === 1 ? 14.5 : null,
  preview: ext === '.emf' ? null : name, companions: [],
})

describe('WidthHandle（15 §4.2：role=slider，2–17 cm，←/→ 0.5，Shift 2，Home/End）', () => {
  it('键盘每步提交并夹到边界；disabled 不响应；axe 零 serious/critical', async () => {
    const commits: number[] = []
    const el = await mount(<WidthHandle value={15} pxPerCm={20} label="图1 宽度" onCommit={(w) => commits.push(w)} />)
    const h = el.querySelector<HTMLElement>('[role="slider"]')!
    expect(h.getAttribute('aria-valuenow')).toBe('15')
    expect(h.getAttribute('aria-valuemin')).toBe('2')
    expect(h.getAttribute('aria-valuemax')).toBe('17')
    await key(h, 'ArrowRight')
    await key(h, 'ArrowRight', true)
    await key(h, 'ArrowLeft')
    await key(h, 'Home')
    await key(h, 'End')
    expect(commits).toEqual([15.5, 17, 14.5, 2, 17])
    expect(await violations(el)).toEqual([])

    const el2 = await mount(<WidthHandle value={15} pxPerCm={20} label="图1 宽度" disabled onCommit={(w) => commits.push(w)} />)
    const h2 = el2.querySelector<HTMLElement>('[role="slider"]')!
    expect(h2.tabIndex).toBe(-1)
    await key(h2, 'ArrowRight')
    expect(commits).toHaveLength(5)
  })
})

describe('FigureCard / FigureToolbar / UploadDrop 壳', () => {
  it('卡片：图号按顺序、alt、题注、摘要星标、宽度手柄；宽度占比 = width/17', async () => {
    const onWidth = vi.fn()
    const el = await mount(
      <ul>
        <FigureCard figure={fig('fig1.svg', 1, 8.5)} caption="图1为总体流程图" refCount={2} selected pxPerCm={20} variant="desktop" onSelect={() => {}} onWidth={onWidth} onAspect={() => {}} />
      </ul>,
    )
    const card = el.querySelector<HTMLElement>('[data-slot="FigureCard"]')!
    expect(card.textContent).toContain('图1')
    expect(card.textContent).toContain('示意图')
    expect(card.textContent).toContain('总体流程图')
    expect(card.dataset.selected).toBe('true')
    expect(card.textContent).toContain('摘要图')
    // W12 R9-03：摘要图徽章与附图伴随栏 FigureCard 同走 ok 色相族，不再与同卡内预检 warning 徽章同色
    const abstract = el.querySelector<HTMLElement>('[data-testid="fb-card-abstract"]')!
    expect(abstract.className).toContain('bg-ok-bg')
    expect(abstract.className).toContain('text-ok-fg')
    expect(abstract.className).not.toContain('warn')
    const stage = el.querySelector<HTMLElement>('[data-testid="fb-card-stage"] > [style]')
    expect(stage?.style.width).toBe('50%')
    await key(el.querySelector('[role="slider"]')!, 'ArrowRight')
    expect(onWidth).toHaveBeenCalledWith(9)
    expect(await violations(el)).toEqual([])
  })

  it('工具条：统一宽度预设 / 统一高度输入；0 幅时禁用', async () => {
    const el = await mount(<FigureToolbar count={0} variant="desktop" />)
    expect(el.querySelector<HTMLButtonElement>('[data-testid="fb-unify-width"]')?.disabled).toBe(true)
    expect(el.querySelector<HTMLButtonElement>('[data-testid="fb-unify-height"]')?.disabled).toBe(true)
    expect(el.querySelector('[data-testid="fb-count"]')?.textContent).toBe('0 幅')
    expect(el.querySelector('[role="toolbar"]')).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('工具条：预设统一宽度两阶确认——首击只 arm，取消不写，确认才全量覆写（R115-批24）', async () => {
    useStudio.setState({ figures: [fig('a.svg', 1, 5), fig('b.svg', 2, 8)] })
    const puts: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method && init.method !== 'GET') puts.push(`${init.method} ${String(input)}`)
      return json({ figures: [], settings: {} })
    })
    const el = await mount(<FigureToolbar count={2} variant="desktop" />)
    const openWidthMenu = () =>
      act(async () => el.querySelector('[data-testid="fb-unify-width"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
    const preset = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.includes('15 cm'))!

    await openWidthMenu()
    await click(preset())
    expect(puts).toHaveLength(0)
    expect(el.textContent).toContain('统一 2 幅宽度为 15cm')
    await click(el.querySelector('[data-testid="fb-unify-cancel"]'))
    expect(puts).toHaveLength(0)
    expect(el.querySelector('[data-testid="fb-unify-confirm"]')).toBeNull()

    await openWidthMenu()
    await click(preset())
    await click(el.querySelector('[data-testid="fb-unify-confirm"]'))
    expect(puts.filter((p) => p.includes('/figures/'))).toHaveLength(2)
  })

  it('工具条：自定义统一高度同走两阶确认（R115-批24）', async () => {
    useStudio.setState({ figures: [fig('a.svg', 1, 5)], figureAspects: { 'a.svg': 1.5 } })
    const puts: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method && init.method !== 'GET') puts.push(`${init.method} ${String(input)}`)
      return json({ figures: [], settings: {} })
    })
    const el = await mount(<FigureToolbar count={1} variant="desktop" />)
    await click(el.querySelector('[data-testid="fb-unify-height"]'))
    const input = el.querySelector<HTMLInputElement>('[data-testid="fb-unify-input"]')!
    await type(input, '10')
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(puts).toHaveLength(0)
    expect(el.textContent).toContain('统一 1 幅高度为 10cm')
    await click(el.querySelector('[data-testid="fb-unify-confirm"]'))
    expect(puts.filter((p) => p.includes('/figures/'))).toHaveLength(1)
  })

  it('工具条 mobile：图标按钮仍有可访问名称（W12 R3-01）', async () => {
    const el = await mount(<FigureToolbar count={3} variant="mobile" />)
    const width = el.querySelector<HTMLButtonElement>('[data-testid="fb-unify-width"]')!
    const height = el.querySelector<HTMLButtonElement>('[data-testid="fb-unify-height"]')!
    expect(width.textContent?.trim()).toBe('')
    expect(width.getAttribute('aria-label')).toBe('统一宽度')
    expect(height.getAttribute('aria-label')).toBe('统一高度')
    expect(el.querySelector('[data-testid="fb-upload"]')?.getAttribute('aria-label') ?? el.querySelector('[data-testid="fb-upload"]')?.textContent).toBeTruthy()
    expect(await violations(el)).toEqual([])
  })

  it('工具条 mobile：图标按钮 / 导出链接视觉即 44×44，不靠 touchHit 伪元素；desktop 不变（W12 R10-03）', async () => {
    const el = await mount(<FigureToolbar count={3} variant="mobile" />)
    for (const id of ['fb-upload', 'fb-unify-width', 'fb-unify-height', 'fb-export']) {
      const node = el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
      expect(node, id).not.toBeNull()
      expect(node.className, id).toContain('min-w-touch')
      expect(node.className, id).toContain('min-h-touch')
    }
    await click(el.querySelector('[data-testid="fb-unify-height"]'))
    expect(el.querySelector<HTMLElement>('[data-testid="fb-unify-input"]')!.className).toContain('h-touch')

    const desk = await mount(<FigureToolbar count={3} variant="desktop" />)
    for (const id of ['fb-upload', 'fb-unify-width', 'fb-unify-height', 'fb-export']) {
      expect(desk.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.className, id).not.toContain('min-w-touch')
    }
  })

  it('卡片 mobile：摘要图宽输入 44 高（与伴随栏附图 mobile 变体一致）；desktop 仍 h-6（W12 R10-03）', async () => {
    const mobile = await mount(
      <ul>
        <FigureCard figure={fig('fig1.svg', 1, 8.5)} caption="图1" refCount={0} selected={false} pxPerCm={20} variant="mobile" onSelect={() => {}} onWidth={() => {}} onAbstractWidth={() => {}} onAspect={() => {}} />
      </ul>,
    )
    expect(mobile.querySelector<HTMLElement>('[data-testid="fb-card-abstract-width"]')!.className).toContain('h-touch')
    const desk = await mount(
      <ul>
        <FigureCard figure={fig('fig1.svg', 1, 8.5)} caption="图1" refCount={0} selected={false} pxPerCm={20} variant="desktop" onSelect={() => {}} onWidth={() => {}} onAbstractWidth={() => {}} onAspect={() => {}} />
      </ul>,
    )
    expect(desk.querySelector<HTMLElement>('[data-testid="fb-card-abstract-width"]')!.className).toContain('h-6')
  })

  it('工具条：自定义输入声明 data-esc-local；Esc 收表单并把焦点还给打开它的按钮（W12 R10-06）', async () => {
    const el = await mount(<FigureToolbar count={3} variant="mobile" />)
    const height = el.querySelector<HTMLButtonElement>('[data-testid="fb-unify-height"]')!
    await click(height)
    const input = el.querySelector<HTMLInputElement>('[data-testid="fb-unify-input"]')!
    expect(input.hasAttribute('data-esc-local')).toBe(true)
    input.focus()
    await key(input, 'Escape')
    expect(el.querySelector('[data-testid="fb-unify-input"]')).toBeNull()
    expect(document.activeElement).toBe(height)
  })

  it('卡片：摘要图宽输入只在值改动后带 data-esc-local；Esc 回退到当前值、属性消失；未改动时 Esc 不拦（W12 R10-06）', async () => {
    const onAbstractWidth = vi.fn()
    const el = await mount(
      <ul>
        <FigureCard figure={fig('fig1.svg', 1, 8.5)} caption="图1" refCount={0} selected={false} pxPerCm={20} variant="mobile" onSelect={() => {}} onWidth={() => {}} onAbstractWidth={onAbstractWidth} onAspect={() => {}} />
      </ul>,
    )
    const input = el.querySelector<HTMLInputElement>('[data-testid="fb-card-abstract-width"]')!
    expect(input.value).toBe('14.5')
    expect(input.hasAttribute('data-esc-local')).toBe(false)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '9')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.hasAttribute('data-esc-local')).toBe(true)
    await key(input, 'Escape')
    expect(input.value).toBe('14.5')
    expect(input.hasAttribute('data-esc-local')).toBe(false)
    await act(async () => input.dispatchEvent(new FocusEvent('blur')))
    expect(onAbstractWidth).not.toHaveBeenCalled()
  })

  it('卡片：缩略图容器在图片加载前就占 ≥ 96px 高——WidthHandle 不再上探盖住标题行的更多操作；无预览占位仍满宽（W12 R10-07）', async () => {
    for (const previewUrl of ['/api/projects/p/figs/fig1.png', null]) {
      const el = await mount(
        <ul>
          <FigureCard figure={fig('fig1.svg', 1, 8.5)} previewUrl={previewUrl} caption="图1" refCount={0} selected={false} pxPerCm={20} variant="mobile" onSelect={() => {}} onWidth={() => {}} onAspect={() => {}} />
        </ul>,
      )
      const wrap = el.querySelector<HTMLElement>('[data-testid="fb-card-stage"] > [style]')!
      expect(wrap.className, String(previewUrl)).toContain('min-h-24')
      expect(wrap.className, String(previewUrl)).toContain('items-center')
      expect(wrap.querySelector('[role="slider"]'), String(previewUrl)).not.toBeNull()
      if (previewUrl) expect(wrap.querySelector('img')?.getAttribute('src')).toBe(previewUrl)
      else expect(wrap.querySelector<HTMLElement>('[role="img"]')!.className).toContain('w-full')
    }
  })

  it('UploadDrop：drop Files → onFiles；无 Files 的拖入忽略', async () => {
    const onFiles = vi.fn()
    const el = await mount(<UploadDrop accept=".svg,.png" onFiles={onFiles} label="上传附图" testId="ud" />)
    const zone = el.querySelector<HTMLElement>('[data-testid="ud"]')!
    const file = new File(['<svg/>'], 'fig9.svg', { type: 'image/svg+xml' })
    const dt = { types: ['Files'], files: [file] }
    await act(async () => {
      const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      zone.dispatchEvent(ev)
    })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['fig9.svg'])
    expect(el.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.svg,.png')
    expect(await violations(el)).toEqual([])
  })
})

describe('figureFiles 辅助：上传白名单 / 体检归类 / bad_lines / 列数', () => {
  it('figureReject：FIGURE_ACCEPT 内放行（大小写不敏感），其它拒绝；splitFiles 分组', () => {
    expect(figureReject({ name: 'a.EMF', size: 1 })).toBeNull()
    expect(figureReject({ name: 'b.jpeg', size: 1 })).toBeNull()
    expect(figureReject({ name: 'c.svg', size: 1 })).toMatch(/不支持/)
    expect(figureReject({ name: 'd.pdf', size: 1 })).toMatch(/\.pdf/)
    expect(figureReject({ name: 'noext', size: 1 })).toMatch(/无扩展名/)
    expect(figureReject({ name: 'big.png', size: 51 * 1024 * 1024 })).toMatch(/超过 50 MB/)
    const files = [new File(['x'], 'ok.png'), new File(['x'], 'bad.pdf')]
    const { ok, bad } = splitFiles(files, figureReject)
    expect(ok.map((f) => f.name)).toEqual(['ok.png'])
    expect(bad.map((b) => b.file.name)).toEqual(['bad.pdf'])
  })

  it('figureIssues：block_id=figures/N → byNum；无定位的 figures.* → loose；其它忽略', () => {
    const item = (over: Partial<PreflightItem>): PreflightItem => ({ rule: 'x', severity: 'warning', message: 'm', book: null, line: null, block_id: null, detail: null, ...over })
    const { byNum, loose } = figureIssues([
      item({ rule: 'figures.alt_mismatch', block_id: 'figures/2' }),
      item({ rule: 'figures.file_missing', severity: 'error', block_id: 'figures/2' }),
      item({ rule: 'figures.md_syntax' }),
      item({ rule: 'figures.unreferenced', book: 'description', line: 3 }),
      item({ rule: 'claims.cycle', block_id: 'claims/1' }),
    ])
    expect(byNum.get(2)?.map((i) => i.rule)).toEqual(['figures.alt_mismatch', 'figures.file_missing'])
    expect(byNum.size).toBe(1)
    expect(loose.map((i) => i.rule)).toEqual(['figures.md_syntax'])
    expect(figureIssues(null).byNum.size).toBe(0)
  })

  it('badLinesOf：读 ast.figures_bad_lines（{line,text}），缺失 → []；gridCols：移动 1，桌面 ≥420 两列', () => {
    expect(badLinesOf(null)).toEqual([])
    expect(badLinesOf({} as Ast)).toEqual([])
    expect(badLinesOf({ figures_bad_lines: [{ line: 3, text: 'oops' }] } as unknown as Ast)).toEqual([{ line: 3, text: 'oops' }])
    expect(gridCols(0, false)).toBe(1)
    expect(gridCols(419, false)).toBe(1)
    expect(gridCols(420, false)).toBe(2)
    expect(gridCols(1000, true)).toBe(1)
  })
})

const three: FiguresResponse['figures'] = [
  { ...fig('fig1.emf', 1, 15, '.emf'), preview: 'fig1.png', companions: ['fig1.png'] },
  fig('fig2.emf', 2, 15, '.emf'),
  fig('fig3.png', 3, 12, '.png'),
]
const bookAst = {
  version: 1,
  books: { abstract: { offset: 0 }, claims: { offset: 10 }, description: { offset: 20 } },
  abstract: { id: 'abstract', kind: 'abstract', lines: { start: 2, end: 2 } },
  claims: [],
  description: [{ id: 'description/附图说明', kind: 'section', lines: { start: 40, end: 44 }, title: '附图说明', part: 'figures' }],
  figures: [
    { id: 'f1', kind: 'figure', num: 1, file: 'fig1.emf', width: 15, caption: '系统框图', caption_line: 41 },
    { id: 'f2', kind: 'figure', num: 2, file: 'fig2.emf', width: 15, caption: null, caption_line: null },
    { id: 'f3', kind: 'figure', num: 3, file: 'fig3.png', width: 12, caption: '流程图', caption_line: 43 },
  ],
  figures_bad_lines: [{ line: 7, text: '![图9 乱写]( figs/x.emf' }, { line: 9, text: '???' }],
} as unknown as Ast
const bookReport = {
  version: 1,
  items: [
    { rule: 'figures.alt_mismatch', severity: 'warning', message: 'alt 与题注不一致', book: null, line: null, block_id: 'figures/1', detail: 'docs/figures.md' },
    { rule: 'figures.file_missing', severity: 'error', message: '文件不存在', book: null, line: null, block_id: 'figures/3', detail: null },
    { rule: 'figures.md_syntax', severity: 'warning', message: 'figures.md 有 2 行无法解析', book: null, line: null, block_id: null, detail: null },
  ],
  counts: { error: 1, warning: 2, info: 0 },
  claim_tree: [],
  numerals: [],
  support_map: [],
  figures: [{ num: 1, file: 'fig1.emf', caption_line: 41, refs: [{ book: 'description', line: 88, text: '如图1所示' }] }],
} as unknown as PreflightReport

const click = (el: Element | null) => act(async () => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const type = async (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const keyCode = (el: Element, key: string, code = key) =>
  act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })))
const cards = (el: Element) => Array.from(el.querySelectorAll<HTMLElement>('[data-slot="FigureCard"]'))
/** Radix DropdownMenu 触发器在 pointerdown 打开 */
const openMenu = (card: Element) =>
  act(async () => card.querySelector('[data-testid="fb-card-menu"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body))

/** 挂载附图书：GET /figures 回 three，写请求交给 next */
async function mountBook(variant: 'desktop' | 'mobile', next: (url: string, init?: RequestInit) => Response = () => json({ figures: three, settings: {} })) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!init?.method || init.method === 'GET') return json({ figures: three, settings: {} })
    // 写操作成功后 apply() → scheduleAst()（200 ms 去抖）会 POST /ast；不能算进被测的写请求
    if (String(input).endsWith('/ast')) return json(bookAst)
    return next(String(input), init)
  })
  useStudio.setState({ project: { id: 'p1', title: 'p1', figs: [] } as unknown as ProjectDetail, ast: bookAst, preflight: bookReport, preflightPid: 'p1' })
  const el = await mount(<FigureBookView variant={variant} />)
  return { el, fetchMock }
}

describe('FigureBookView（C3）：卡片列表 / 角标 / bad_lines / 菜单 / 排序 / 拖文件上传', () => {
  it('按 figures.md 顺序渲染 <ul>/<li>，题注、引用数、体检角标、bad_lines 提示条；axe 零 serious/critical', async () => {
    const { el } = await mountBook('desktop')
    const list = el.querySelector<HTMLElement>('[data-testid="fb-list"]')!
    expect(list.tagName).toBe('UL')
    const cs = cards(el)
    expect(cs.map((c) => c.dataset.name)).toEqual(['fig1.emf', 'fig2.emf', 'fig3.png'])
    expect(cs.every((c) => c.tagName === 'LI')).toBe(true)
    expect(cs[0].getAttribute('aria-label')).toBe('图1：系统框图')
    expect(cs[0].textContent).toContain('系统框图')
    expect(cs[0].querySelector('img')?.getAttribute('src')).toBe('/api/projects/p1/figs/fig1.png')
    expect(cs[1].querySelector('img')).toBeNull()
    expect(cs[0].querySelector('[data-testid="fb-card-issues"]')?.textContent).toContain('1')
    expect(cs[0].querySelector<HTMLElement>('[data-testid="fb-card-issues"]')?.dataset.severity).toBe('warning')
    expect(cs[1].querySelector('[data-testid="fb-card-issues"]')).toBeNull()
    expect(cs[2].querySelector<HTMLElement>('[data-testid="fb-card-issues"]')?.dataset.severity).toBe('error')
    const strip = el.querySelector<HTMLElement>('[data-testid="fb-bad-lines"]')!
    expect(strip.getAttribute('role')).toBe('alert')
    expect(strip.textContent).toContain('2 行无法解析')
    expect(strip.textContent).toContain('第 7 行')
    expect(strip.textContent).toContain('figures.md 有 2 行无法解析')
    expect(el.querySelector('[data-testid="fb-count"]')?.textContent).toBe('3 幅')
    expect(el.querySelectorAll('[data-testid="fb-drag-handle"]').length).toBe(3)
    expect(await violations(el)).toEqual([])
  })

  it('桌面键盘排序：手柄 空格 → ↓ → 空格 → PUT /figures/order [2,1,3]', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const card = this.closest<HTMLElement>('[data-slot="FigureCard"]')
      const i = card ? Array.from(card.parentElement!.children).indexOf(card) : 0
      const top = i * 100
      const h = card === this ? 90 : 20
      return { x: 0, y: top, top, left: 0, width: 200, height: h, right: 200, bottom: top + h, toJSON() {} } as DOMRect
    })
    const put = vi.fn((_url: string, _init?: RequestInit) => json({ figures: three, settings: {} }))
    const { el } = await mountBook('desktop', put)
    const handle = cards(el)[0].querySelector<HTMLElement>('[data-testid="fb-drag-handle"]')!
    handle.focus()
    await keyCode(handle, ' ', 'Space')
    expect(document.body.textContent).toContain('已抓起 图1')
    await keyCode(handle, 'ArrowDown')
    await keyCode(handle, ' ', 'Space')
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/api/projects/p1/figures/order')
    expect(bodyOf(put.mock.calls[0][1])).toEqual({ order: ['fig2.emf', 'fig1.emf', 'fig3.png'] })
  })

  it('移动端：无拖拽手柄，菜单「下移」→ PUT /figures/order；「设为摘要图」→ PATCH abstract', async () => {
    const calls: { url: string; body: unknown }[] = []
    const { el } = await mountBook('mobile', (url, init) => {
      calls.push({ url, body: bodyOf(init) })
      return json({ figures: three, settings: {} })
    })
    expect(el.querySelector('[data-testid="figure-book"]')?.getAttribute('data-cols')).toBe('1')
    expect(el.querySelector('[data-testid="fb-drag-handle"]')).toBeNull()
    await openMenu(cards(el)[0])
    expect(document.querySelector<HTMLElement>('[data-testid="fb-menu-up"]')?.getAttribute('aria-disabled')).toBe('true')
    await click(document.querySelector('[data-testid="fb-menu-down"]'))
    expect(calls[0].url).toBe('/api/projects/p1/figures/order')
    expect(calls[0].body).toEqual({ order: ['fig2.emf', 'fig1.emf', 'fig3.png'] })

    await openMenu(cards(el)[1])
    await click(document.querySelector('[data-testid="fb-menu-abstract"]'))
    expect(calls[1].url).toBe('/api/projects/p1/figures/fig2.emf')
    expect(calls[1].body).toEqual({ abstract: true })
  })

  it('拖文件到附图书：白名单外 toast 且不上传；白名单内 POST /figures', async () => {
    const post = vi.fn((_url: string, _init?: RequestInit) => json({ figures: three, settings: {} }))
    const { el } = await mountBook('desktop', post)
    const book = el.querySelector<HTMLElement>('[data-testid="figure-book"]')!
    const drag = (type: string, files: File[]) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files } })
      return act(async () => book.dispatchEvent(ev))
    }
    await drag('dragover', [])
    expect(book.dataset.dragover).toBe('true')
    expect(el.querySelector('[data-testid="fb-dropzone"]')).not.toBeNull()
    await drag('drop', [new File(['x'], 'brief.pdf')])
    expect(post).not.toHaveBeenCalled()
    expect(useStudio.getState().toasts.some((t) => t.text.includes('brief.pdf'))).toBe(true)
    await drag('drop', [new File(['x'], 'fig4.png'), new File(['x'], 'skip.docx')])
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe('/api/projects/p1/figures')
    expect((post.mock.calls[0][1]!.body as FormData).getAll('files').length).toBe(1)
  })

  it('删除：菜单 → 确认对话框 → DELETE；定位题注 → gotoLine', async () => {
    const del = vi.fn((_url: string, _init?: RequestInit) => json({ figures: three.slice(1), settings: {} }))
    const gotoLine = vi.fn()
    useStudio.setState({ gotoLine })
    const { el } = await mountBook('desktop', del)
    await openMenu(cards(el)[0])
    await click(document.querySelector('[data-testid="fb-menu-caption"]'))
    expect(gotoLine).toHaveBeenCalledWith(61) // description.offset 20 + caption_line 41（captionOf 沿用 R2）
    // 桌面 dock 只开了权利要求书卡片 → 定位题注要新开 / 露出说明书源码卡片，而不是发无人消费的 scrollRequest（W11 走查 T5）
    const openPanel = vi.fn()
    useStudio.setState({ dockHandle: { openPanel, panelIds: () => ['source:claims'], isPanelVisible: () => true } as never })
    await openMenu(cards(el)[0])
    await click(document.querySelector('[data-testid="fb-menu-caption"]'))
    expect(openPanel).toHaveBeenLastCalledWith('source:description', { position: { referencePanel: 'source:claims', direction: 'within' } })
    expect(useStudio.getState().focus).toMatchObject({ book: 'description', line: 61, source: 'outline' })
    expect(gotoLine).toHaveBeenCalledTimes(1)
    useStudio.setState({ dockHandle: null })
    await openMenu(cards(el)[0])
    await click(document.querySelector('[data-testid="fb-menu-delete"]'))
    expect(document.querySelector('[data-testid="figure-delete-dialog"]')).not.toBeNull()
    await click(document.querySelector('[data-testid="figure-delete-confirm"]'))
    expect(del).toHaveBeenCalledTimes(1)
    expect(del.mock.calls[0][1]?.method).toBe('DELETE')
    expect(del.mock.calls[0][0]).toBe('/api/projects/p1/figures/fig1.emf')
  })
})

describe('FigureBookView：挂载即 GET /figures；501 → 空态', () => {
  it('501 → figuresUnavailable，工具条仍渲染；axe 零 serious/critical', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { code: 'not_implemented', message: 'x', detail: null } }, 501))
    useStudio.setState({ project: { id: 'p1', title: 'p1', figs: [] } as unknown as ProjectDetail })
    const el = await mount(<FigureBookView />)
    expect(useStudio.getState().figuresUnavailable).toBe(true)
    expect(el.querySelector('[data-testid="figure-book"]')).not.toBeNull()
    expect(el.querySelector('[role="toolbar"]')).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })
})

describe('FilePreviewPanel / AttachmentPreview（15 §4.3）', () => {
  it('figPreviewName：svg/png 直显；emf 用伴生 preview；无伴生 → null', () => {
    const figs = [fig('a.emf', 1, 15, '.emf'), { ...fig('b.emf', 2, 15, '.emf'), preview: 'b.png' }]
    expect(figPreviewName('x.svg', figs)).toBe('x.svg')
    expect(figPreviewName('b.emf', figs)).toBe('b.png')
    expect(figPreviewName('a.emf', figs)).toBeNull()
  })

  it('无目标 → 空态；previewFig emf 无伴生 → binary 只下载；previewAttachment md → text 正文', async () => {
    const el = await mount(<FilePreviewPanel />)
    expect(el.querySelector('[data-testid="file-preview-empty"]')).not.toBeNull()

    useStudio.setState({ figures: [fig('a.emf', 1, 15, '.emf')], figuresPid: 'p1' })
    await act(async () => useStudio.getState().setPreviewFig('a.emf'))
    const pv = el.querySelector<HTMLElement>('[data-testid="attachment-preview"]')!
    expect(pv.dataset.kind).toBe('binary')
    expect(el.querySelector('[data-testid="attachment-download-only"]')).not.toBeNull()
    // 批44：figUrl 按 figsVersion 带 ?v= 缓存破签名（v=0 时省略）——断言容两种形态
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')?.getAttribute('href')).toMatch(/^\/api\/projects\/p1\/figs\/a\.emf(\?v=\d+)?$/)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('# 说明', { status: 200 }))
    useStudio.setState({
      attachments: [{ name: 'note.md', ext: '.md', size: 5, mtime: '2026-01-01T00:00:00Z', kind: 'text', url: '/api/projects/p1/attachments/note.md' }],
      attachmentsPid: 'p1',
    })
    await act(async () => {
      useStudio.getState().setPreviewFig(null)
      useStudio.getState().setPreviewAttachment('note.md')
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(el.querySelector<HTMLElement>('[data-testid="attachment-preview"]')?.dataset.kind).toBe('text')
    expect(el.querySelector('[data-testid="attachment-text"]')?.textContent).toBe('# 说明')
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')?.getAttribute('href')).toBe('/api/projects/p1/attachments/note.md?download=1')
    expect(await violations(el)).toEqual([])
  })

  it('image → <img alt=文件名>；onError 显「图片加载失败」兜底，换 url 后复位', async () => {
    const el = await mount(<AttachmentPreview name="p.png" kind="image" url="/x/p.png" />)
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('p.png')
    act(() => { el.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect(el.querySelector('[data-testid="attachment-image-broken"]')).not.toBeNull()
    expect(el.querySelector('img')).toBeNull()
    // 换目标 url 后 broken 复位回 <img>
    await act(async () => root!.render(<AttachmentPreview name="q.png" kind="image" url="/x/q.png" />))
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/x/q.png')
    expect(el.querySelector('[data-testid="attachment-image-broken"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })
})
