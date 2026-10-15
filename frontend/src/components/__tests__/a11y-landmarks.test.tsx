// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseBoard } from '@/components/dashboard/CaseBoard'
import { ConsolePanel } from '@/components/console/ConsolePanel'
import { OaAnswerCard } from '@/components/oa/OaAnswerCard'
import { HistoryPanel } from '@/components/outline/HistoryPanel'
import { PreflightPanel } from '@/components/preflight/PreflightPanel'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { SETTINGS_TWO_COLUMN_MIN_PX, SettingsPanel } from '@/components/settings/SettingsPanel'
import { CompanionPanel } from '@/components/ui/companion-panel'
import { Heading, HeadingLevelProvider } from '@/components/ui/heading'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NamedLandmarkHost } from '@/components/ui/landmark-host'
import { api } from '@/lib/api'
import type { ProjectSummary, Settings, Style, Version } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import type { OaAnswer, OaItem } from '@/types/oa'

/**
 * W12 第六轮审计 P2 五项（docs/handoff-context §7h R6-01…05）：
 *  - R6-01 标题层级由宿主决定：壳只有 sr-only h1，形式检查 / OA 答复卡在 dock、375 全屏里直出 h3 → h1→h3 跳级；
 *          伴随栏头已是 h2，正文从 h3 起（HeadingLevelProvider 3）
 *  - R6-02 dockview group 已按面板标题给 role=region，面板根 <section aria-label=同名> 成同名嵌套地标 → dock 宿主内省略
 *  - R6-03 看板列 section role=listitem 不是 section 允许的角色 → div
 *  - R6-04 版本历史选中项元信息 text-link/80 在 bg-selected 上 3.96:1（/90 4.81）→ text-link（5.88:1）
 *  - R6-05 排版设置面板窄于 560 时改单列（分组 Select），不再左导航与表单重叠
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
let observed: ((w: number) => void) | null = null
let width = 800
const initial = useStudio.getInitialState()

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
const SETTINGS: Settings = { abstract_figure: null, spec_figures: [], sub_except: [], abstract_limit: 300, style: {}, ai_enabled: true }

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  // jsdom 没有 ResizeObserver / 布局：由测试控制 SettingsPanel 量到的宽
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe() {
      observed = () => this.cb([], this)
    }
    unobserve() {}
    disconnect() {
      observed = null
    }
  } as unknown as typeof ResizeObserver
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.dataset.slot === 'SettingsPanel' ? width : 0
    return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
})

beforeEach(() => {
  desktop = true
  width = 800
  useStudio.setState(initial, true)
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: '一种方法', role: 'owner', case: {} } as never,
    defaults: STYLE,
    defaultSettings: SETTINGS,
    settings: SETTINGS,
    saveSettings: vi.fn(async () => {}) as never,
    resetSettings: vi.fn(async () => {}) as never,
    toast: () => {},
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
const q = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)
const headings = (el: Element) => Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => h.tagName.toLowerCase())

async function rule(el: Element, id: string) {
  const res = await axe.run(el, { runOnly: { type: 'rule', values: [id] } })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const OA_ITEM: OaItem = { id: '1', kind: 'novelty', text: '权利要求 1 不具备新颖性', claims: [1] }
const OA_ANSWER: OaAnswer = { item_id: '1', points: ['要点一'], claim_edits: [{ claim: 1, critic_line: '1. {++一种++}方法' }], amend_summary: '改说明' }
const noop = () => {}
const oaCard = <OaAnswerCard item={OA_ITEM} answer={OA_ANSWER} aiEnabled generating={false} onBack={noop} onGenerate={noop} onSavePoints={noop} onApplyEdits={noop} onGotoClaim={noop} onReview={noop} />

describe('R6-01 标题层级由宿主决定', () => {
  it('Heading 默认 h2；HeadingLevelProvider(3) 下 h3，offset 1 → h4；到 6 封顶', async () => {
    const el = await mount(
      <>
        <Heading>a</Heading>
        <HeadingLevelProvider level={3}>
          <Heading>b</Heading>
          <Heading offset={1}>c</Heading>
        </HeadingLevelProvider>
        <HeadingLevelProvider level={6}>
          <Heading offset={2}>d</Heading>
        </HeadingLevelProvider>
      </>,
    )
    expect(headings(el)).toEqual(['h2', 'h3', 'h4', 'h6'])
  })

  it('形式检查在 dock / 375 全屏控制台（壳只有 h1）里是 h2；伴随栏正文里是 h3——heading-order 0', async () => {
    const dock = await mount(
      <main>
        <h1>案 · 知撰</h1>
        <ConsolePanel variant="desktop" />
      </main>,
    )
    await act(async () => useStudio.getState().setConsoleTab('checks'))
    const lintTitle = Array.from(dock.querySelectorAll('h1,h2,h3,h4')).find((h) => /形式检查/.test(h.textContent ?? ''))
    expect(lintTitle?.tagName.toLowerCase()).toBe('h2')
    expect(await rule(dock, 'heading-order')).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    const companion = await mount(
      <main>
        <h1>案 · 知撰</h1>
        <CompanionPanel id="problems" title="形式检查" onClose={() => {}} presentation="column" width={320}>
          <CheckPanel />
        </CompanionPanel>
      </main>,
    )
    const title = Array.from(companion.querySelectorAll('h1,h2,h3,h4')).find((h) => /形式检查（/.test(h.textContent ?? ''))
    expect(title?.tagName.toLowerCase()).toBe('h3')
    expect(await rule(companion, 'heading-order')).toEqual([])
  })

  it('OA 答复卡：默认宿主 意见 N = h2、四个小节 = h3；伴随栏里顺延为 h3/h4', async () => {
    const el = await mount(
      <main>
        <h1>案 · 知撰</h1>
        {oaCard}
      </main>,
    )
    const hs = headings(el)
    expect(hs[0]).toBe('h1')
    expect(hs[1]).toBe('h2')
    expect(hs.slice(2).every((h) => h === 'h3')).toBe(true)
    expect(hs.length).toBeGreaterThanOrEqual(4)
    expect(await rule(el, 'heading-order')).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    const inCompanion = await mount(
      <HeadingLevelProvider level={3}>{oaCard}</HeadingLevelProvider>,
    )
    const hs2 = headings(inCompanion)
    expect(hs2[0]).toBe('h3')
    expect(hs2.slice(1).every((h) => h === 'h4')).toBe(true)
  })
})

describe('R6-02 dock 宿主已命名地标 → 面板根不再同名', () => {
  it('ConsolePanel desktop：独立时 aria-label=控制台；NamedLandmarkHost 内无 aria-label；companion 仍是 问题与诊断', async () => {
    const alone = await mount(<ConsolePanel variant="desktop" />)
    expect(q('[data-testid="console-panel"]', alone)!.getAttribute('aria-label')).toBe('控制台')
    await act(async () => root?.unmount())
    host.remove()

    const hosted = await mount(
      <div role="region" aria-label="控制台">
        <NamedLandmarkHost>
          <ConsolePanel variant="desktop" />
        </NamedLandmarkHost>
      </div>,
    )
    expect(q('[data-testid="console-panel"]', hosted)!.hasAttribute('aria-label')).toBe(false)
    expect(await rule(hosted, 'landmark-unique')).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    const companion = await mount(<ConsolePanel variant="companion" />)
    expect(q('[data-testid="console-panel"]', companion)!.getAttribute('aria-label')).toBe('问题与诊断')
  })

  it('PreflightPanel / SettingsPanel 同理：宿主内省略根地标名，独立时保留', async () => {
    const hosted = await mount(
      <>
        <div role="region" aria-label="递交前体检">
          <NamedLandmarkHost>
            <PreflightPanel />
          </NamedLandmarkHost>
        </div>
        <div role="region" aria-label="排版设置">
          <NamedLandmarkHost>
            <SettingsPanel />
          </NamedLandmarkHost>
        </div>
      </>,
    )
    expect(q('[data-testid="preflight-panel"]', hosted)!.hasAttribute('aria-label')).toBe(false)
    expect(q('[data-testid="settings-panel"]', hosted)!.hasAttribute('aria-labelledby')).toBe(false)
    expect(q('#settings-panel-title', hosted)!.textContent).toBe('排版设置')
    expect(await rule(hosted, 'landmark-unique')).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    const alone = await mount(
      <>
        <PreflightPanel />
        <SettingsPanel />
      </>,
    )
    expect(q('[data-testid="preflight-panel"]', alone)!.getAttribute('aria-label')).toBe('递交前体检')
    expect(q('[data-testid="settings-panel"]', alone)!.getAttribute('aria-labelledby')).toBe('settings-panel-title')
  })
})

describe('R6-03 看板列不再是 section[role=listitem]', () => {
  const ROWS: ProjectSummary[] = [
    { id: 'a', name: 'A', title: 'A', role: 'owner', case: { status: 'drafting' } } as unknown as ProjectSummary,
    { id: 'b', name: 'B', title: 'B', role: 'owner', case: { status: 'review' } } as unknown as ProjectSummary,
  ]
  it('展开列与折叠列都是 div[role=listitem]，aria-allowed-role 0；列名 / 落点 data-status 不变', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue(ROWS)
    const el = await mount(<CaseBoard rows={ROWS} tags={[]} selected={[]} onToggleSelected={noop} onMove={noop} />)
    const cols = Array.from(el.querySelectorAll('[data-slot="CaseBoard"] > [data-status]'))
    expect(cols.length).toBe(10)
    expect(cols.every((c) => c.tagName === 'DIV' && c.getAttribute('role') === 'listitem')).toBe(true)
    expect(el.querySelectorAll('section[role="listitem"]')).toHaveLength(0)
    expect(cols.some((c) => c.hasAttribute('data-collapsed'))).toBe(true)
    expect(q('[data-status="drafting"]', el)!.getAttribute('aria-label')).toMatch(/（1）$/)
    expect(await rule(el, 'aria-allowed-role')).toEqual([])
  })
})

describe('R6-04 版本历史选中项元信息用不带透明度的 text-link', () => {
  it('选中行 时间·作者 / sha·行数 两列 class 都是 text-link 不带 /NN；未选中仍 text-fg-muted', async () => {
    const versions: Version[] = [
      { sha: 'b'.repeat(40), at: 1_767_258_100, message: 'save', author: 'devin', added: 1, deleted: 0 },
      { sha: 'a'.repeat(40), at: 1_767_258_000, message: 'save', author: 'devin', added: 0, deleted: 0 },
    ]
    vi.spyOn(api, 'history').mockResolvedValue(versions)
    vi.spyOn(api, 'historyVersion').mockResolvedValue({ sha: 'b'.repeat(40), content: 'x' })
    useStudio.setState({ content: 'x', saved: 'x', dirty: false } as never)
    const el = await mount(
      <TooltipProvider>
        <HistoryPanel />
      </TooltipProvider>,
    )
    const items = Array.from(el.querySelectorAll('[role="option"]'))
    expect(items.length).toBe(2)
    await act(async () => (items[0] as HTMLElement).click())
    const active = el.querySelector('[role="option"][aria-selected="true"]')!
    const mono = (opt: Element) => Array.from(opt.querySelectorAll('span.font-mono'))
    expect(mono(active)).toHaveLength(2)
    for (const s of mono(active)) {
      expect(s.className.split(' ')).toContain('text-link')
      expect(s.className).not.toMatch(/text-link\/\d/)
    }
    const other = el.querySelector('[role="option"][aria-selected="false"]')!
    for (const s of mono(other)) expect(s.className.split(' ')).toContain('text-fg-muted')
  })
})

describe('R6-05 排版设置面板按自身宽切双列 / 单列', () => {
  it(`≥ ${SETTINGS_TWO_COLUMN_MIN_PX}：左 SettingsNav + 表单；386 窄卡：分组 Select + 搜索 + 更多，不再渲染导航；变宽后切回`, async () => {
    width = 386
    const el = await mount(<SettingsPanel />)
    const panel = q('[data-testid="settings-panel"]', el)!
    expect(panel.getAttribute('data-columns')).toBe('1')
    expect(q('[data-testid="settings-nav"]', el)).toBeNull()
    expect(q('[data-testid="settings-page-select"]', el)).not.toBeNull()
    expect(q('[data-testid="settings-more"]', el)).not.toBeNull()
    expect(q('[data-testid="settings-search"]', el)).not.toBeNull()
    expect(q('[data-testid="settings-title"]', el)!.textContent).toBe('排版设置')

    width = 800
    await act(async () => observed?.(width))
    expect(panel.getAttribute('data-columns')).toBe('2')
    expect(q('[data-testid="settings-nav"]', el)).not.toBeNull()
    expect(q('[data-testid="settings-page-select"]', el)).toBeNull()
  })
})

describe('R7-01 六列 dock 把排版设置压到 150–193px：单列内不再横向裁切', () => {
  it('标题不竖排、副标题只在双列时显示；分组 Select 行可换行且有最小宽；多项行网格按行宽（容器查询）折成一列', async () => {
    width = 193
    const el = await mount(<SettingsPanel />)
    const title = q('[data-testid="settings-title"]', el)!
    expect(title.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']))
    expect(q('[data-testid="settings-header"]', el)!.textContent).not.toContain('零漂移基准')

    const select = q('[data-testid="settings-page-select"]', el)!
    expect(select.className.split(' ')).toContain('min-w-28')
    expect(select.parentElement!.className.split(' ')).toContain('flex-wrap')

    const grid = q('[data-testid="setting-grid-page.margins"]', el)!
    expect(grid.children).toHaveLength(4)
    expect(grid.className.split(' ')).toEqual(expect.arrayContaining(['grid-cols-2', '@max-[280px]:grid-cols-1']))
    const row = grid.closest('[data-slot="SettingRow"]')!
    expect(row.className.split(' ')).toContain('@container')
    expect(grid.parentElement!.className.split(' ')).toContain('max-w-full')

    // 已改态：↺ 兄弟出现后控件列在 <280 行宽下占满整行并可换行，固定宽 w-30 的数字框受 max-w-full 约束不再顶出行外
    const controls = grid.parentElement!
    expect(controls.className.split(' ')).toEqual(
      expect.arrayContaining(['shrink-0', '@max-[280px]:basis-full', '@max-[280px]:flex-wrap']),
    )
    expect(grid.className.split(' ')).toEqual(expect.arrayContaining(['max-w-full', 'min-w-0']))
    for (const cell of grid.children) {
      expect(cell.className.split(' ')).toContain('min-w-0')
      const input = cell.querySelector('input[type="number"]')!
      // 组合框壳层：w-30/max-w-full 宽度约束在壳的外层 div（input 的祖父级）
      expect(input.parentElement!.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['w-30', 'max-w-full']))
      // 壳内输入 flex-1+min-w-0+px-0 且恒隐 spinner：窄行不裁字
      expect(input.className.split(' ')).toEqual(
        expect.arrayContaining(['min-w-0', 'flex-1', 'px-0', '[appearance:textfield]', '[&::-webkit-inner-spin-button]:appearance-none']),
      )
    }

    width = 800
    await act(async () => observed?.(width))
    expect(q('[data-testid="settings-header"]', el)!.textContent).toContain('零漂移基准')
  })

  it('R59-01：viewer 打开排版设置——写 settings 的控件全 disabled（字段/导入/恢复默认），本机偏好仍可改', async () => {
    useStudio.setState({ project: { id: 'p1', name: '一种方法', role: 'viewer', case: {} } as never, projectLoading: false })
    const el = await mount(<SettingsPanel />)
    const inputs = Array.from(q('[data-testid="setting-grid-page.margins"]', el)!.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((i) => i.disabled)).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="settings-import"]', el)!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="settings-reset-all"]', el)!.disabled).toBe(true)
    // 本机偏好（主题）不 PUT /settings——viewer 仍可改
    await act(async () => q<HTMLButtonElement>('[data-testid="settings-nav-appearance"]', el)!.click())
    expect(q<HTMLButtonElement>('[aria-label="主题"]', el)!.disabled).toBe(false)
  })
})
