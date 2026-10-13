// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileShell } from '../MobileShell'
import { CaseBoard } from '@/components/dashboard/CaseBoard'
import { CompanionHost } from '@/components/shell/CompanionHost'
import '@/components/shell/companionBodies'
import type { ProjectDetail, ProjectSummary } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'

vi.mock('@/components/editor/Editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/editor/Editor')>()
  return {
    ...mod,
    Editor: ({ className }: { className?: string }) => <div data-testid="editor-area" className={className} />,
    CodeMirrorEditor: ({ className }: { className?: string }) => <div data-testid="editor" className={className} />,
  }
})
vi.mock('../MobilePreview', () => ({ MobilePreview: () => <div data-testid="mobile-preview" /> }))
vi.mock('../MobileConsole', () => ({ MobileConsole: () => <div data-testid="mobile-console" /> }))

/**
 * W12 R9 第九轮审计三项 P2（docs/handoff-context.md §7k）：
 *  R9-02 375 看板：折叠列在移动端也是 snap-start 吸附点——Tab 聚焦展开按钮时 scroll-snap-mandatory 不再把它拽出视口只剩 6px；
 *  R9-07 吸附对齐尊重 scrollport 内边距（scroll-px-4 = px-4）——列对齐到 padding-box 边时按钮左 2px 与焦点环被裁；
 *  R9-03 375 伴随 Sheet 附图面板走 mobile 变体（卡片菜单 / 上传 / 拖柄 ≥44，此前 24×24）；
 *  R9-04 375 控制台 tabpanel 不再 aria-labelledby 悬空 id（底栏没有 mobile-tab-console 按钮，AX 名称为空）。
 * jsdom 无布局：吸附与尺寸按类名契约断言，真实几何由浏览器复验。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = false
const initial = useStudio.getInitialState()
/** #546：FiguresPanel 附图图源读链迁 TanStack Query——挂载需 QueryClient */
const testQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  desktop = false
  useStudio.setState(initial, true)
  useStudio.getState().resetLayoutView()
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: '一种方法', role: 'editor' } as unknown as ProjectDetail,
    mobileTab: 'edit',
    mobileSettingsOpen: false,
    editorView: 'source',
    editorMode: 'edit',
    activeBook: 'all',
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
  location.hash = ''
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  if (!desktop) host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<QueryClientProvider client={testQC}>{el}</QueryClientProvider>))
  return host
}

const q = (sel: string, from: ParentNode = document) => from.querySelector<HTMLElement>(sel)

describe('R9-04 移动控制台 tabpanel 名称', () => {
  it('mobileTab=console：外层 #mobile-tabpanel 用 aria-label「控制台」，不再引用不存在的 mobile-tab-console', async () => {
    useStudio.setState({ mobileTab: 'console' })
    const el = await mount(<MobileShell />)
    const panel = q('#mobile-tabpanel', el)!
    expect(panel.getAttribute('role')).toBe('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBeNull()
    expect(panel.getAttribute('aria-label')).toBe('控制台')
    expect(q('#mobile-tab-console', el)).toBeNull()
  })

  it('edit / preview / ai：aria-labelledby 仍指向底栏真实存在的 tab 按钮（无悬空引用）；设置整屏 aria-label「排版设置」', async () => {
    for (const tab of ['edit', 'preview', 'ai'] as const) {
      useStudio.setState({ mobileTab: tab })
      const el = await mount(<MobileShell />)
      const panel = q('#mobile-tabpanel', el)!
      const ref = panel.getAttribute('aria-labelledby')
      expect(ref).toBe(`mobile-tab-${tab}`)
      expect(el.querySelector(`#${ref}`), `${tab} 的 labelledby 目标存在`).not.toBeNull()
      expect(panel.getAttribute('aria-label')).toBeNull()
      await act(async () => root?.unmount())
      root = null
      host.remove()
    }
    useStudio.setState({ mobileTab: 'console', mobileSettingsOpen: true })
    const el = await mount(<MobileShell />)
    const panel = q('#mobile-tabpanel', el)!
    expect(panel.getAttribute('aria-labelledby')).toBeNull()
    expect(panel.getAttribute('aria-label')).toBe('排版设置')
  })
})

describe('R9-03 伴随栏附图面板变体', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ figures: [], settings: { abstract_figure: null } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  })

  it('<1024（移动壳 Sheet）：FiguresPanel data-variant=mobile，卡片控件走 ≥44 触控档', async () => {
    useStudio.setState({ companion: 'figures' })
    await mount(<CompanionHost presentation="sheet-bottom" />)
    const panel = q('[data-testid="figures-panel"]')
    expect(panel, '伴随 Sheet 挂了附图面板').not.toBeNull()
    expect(panel!.dataset.variant).toBe('mobile')
    expect(q('[data-testid="figures-upload"]', panel!)!.className).toContain('min-h-touch')
  })

  it('≥1024（桌面伴随栏）：仍是 desktop 变体，桌面不变', async () => {
    desktop = true
    useStudio.setState({ companion: 'figures' })
    await mount(<CompanionHost presentation="column" />)
    const panel = q('[data-testid="figures-panel"]')
    expect(panel).not.toBeNull()
    expect(panel!.dataset.variant).toBe('desktop')
  })

  it('批64：无效 ?panel=<id> 按无 panel 处理并清参，其它 query 参数保留', async () => {
    /* 用 dl 作旁观参数：c/focus 有全局消费监听（review slots），dl 只由期限伴随栏消费 */
    window.location.hash = '#/p/p1?panel=bogus&dl=x'
    await mount(<CompanionHost presentation="column" />)
    expect(useStudio.getState().companion).toBeNull()
    expect(window.location.hash).toBe('#/p/p1?dl=x')
  })
})

describe('R9-02 375 看板折叠列吸附', () => {
  const row = (id: string, status: string): ProjectSummary =>
    ({ id, name: id, mtime: 0, case: { status } }) as unknown as ProjectSummary
  const rows = [row('a', 'drafting')]

  it('mobile：折叠列（计数 0）与展开列一样带 snap-start，是 scroll-snap 吸附点；桌面折叠列不带', async () => {
    let el = await mount(<CaseBoard rows={rows} tags={[]} selected={[]} onToggleSelected={() => {}} onMove={() => {}} mobile />)
    const board = q('[data-slot="CaseBoard"]', el)!
    expect(board.className).toContain('snap-x')
    expect(board.className).toContain('snap-mandatory')
    expect(board.className, 'R9-07 吸附对齐尊重内边距').toContain('scroll-px-4')
    const collapsed = Array.from(el.querySelectorAll<HTMLElement>('[role="listitem"][data-collapsed]'))
    expect(collapsed.length).toBeGreaterThan(0)
    for (const col of collapsed) expect(col.className, col.dataset.status).toContain('snap-start')
    expect(q('[role="listitem"][data-status="drafting"]', el)!.className).toContain('snap-start')

    await act(async () => root?.unmount())
    root = null
    host.remove()
    desktop = true
    el = await mount(<CaseBoard rows={rows} tags={[]} selected={[]} onToggleSelected={() => {}} onMove={() => {}} />)
    expect(q('[data-slot="CaseBoard"]', el)!.className).not.toContain('snap-x')
    for (const col of el.querySelectorAll<HTMLElement>('[role="listitem"][data-collapsed]')) expect(col.className).not.toContain('snap-start')
  })
})
