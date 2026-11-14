// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '@/components/account/AccountPage'
import { AiPanel } from '@/components/ai/AiPanel'
import { ConsoleEntry } from '@/components/console/ConsoleEntry'
import { ConsolePanel } from '@/components/console/ConsolePanel'
import { DashboardPage } from '@/components/dashboard/DashboardPage'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { CriticHint } from '@/components/review/ReviewBody'
import { ScrollRow } from '@/components/ui/scroll-row'
import { api } from '@/lib/api'
import type { Diagnostic, User } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'

vi.mock('@/components/preview/PdfPreview', () => ({ PdfPreview: () => <div data-testid="pdf-preview" /> }))
vi.mock('@/components/layout-view', () => ({ LayoutView: () => <div data-testid="layout-view" /> }))

/**
 * W8-mobile 走查修复回归（docs/handoff-context.md §7e）：jsdom 无布局，按 class / 结构断言——
 *  qa-01 ScrollRow 是绝对定位后代的包含块（relative），横向溢出只在行内，不撑 document；
 *  ux-01 移动控制台 Tab 条整条（含「递交页」）交给外层横向滚动，末尾 16 出血；桌面 tablist 仍自滚不变；
 *  ux-02 控制台条目动作 / 面板头图标 / 脚部按钮：触控视觉 sm 32 / md 36 + touch-hit 命中 44，不再 h-touch；
 *  ux-03 账户页 Segmented 铺满内容宽（min-w-full，左右 16 对称）且不带图标；
 *  qa-06 / qa-07 / qa-08 桌面（≥md）：CheckPanel 折叠行不 nowrap、AI 快捷 chip flex-1 非胶囊、CriticHint leading-5；
 *  ux-05 首页顶栏 搜索 / 新建 icon-md 36（不再 44 大块），两者间距 8。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = false
const initial = useStudio.getInitialState()
const me: User = { id: 'u1', email: 'me@x', display_name: '王代理', is_superuser: false, title: '代理师', avatar_color: '' }

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
  useStudio.setState({
    pid: 'p1',
    authStatus: 'authed',
    user: me,
    // 复核10：已核验的本地文件模式 ctx——否则 AiPanel 核验中门禁会遮掉 chat/快捷动作
    caseContext: { pid: 'p1', case_no: null, binding: 'unavailable', case_id: null, organization: null, file_role: 'owner', auth: 'off', capabilities: ['content_write'], content_sha: 'a'.repeat(64), revision: null, ai_enabled: true },
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  if (!desktop) host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const q = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)
const all = (sel: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(sel))
const diag = (id: string, line: number | null, detail?: string): Diagnostic =>
  ({ id, severity: 'warning', message: `问题 ${id}`, line, source: 'lint', section: null, fix: null, detail }) as unknown as Diagnostic

describe('qa-01 递交页横向溢出：ScrollRow 作为包含块', () => {
  it('ScrollRow 根带 relative + overflow-x-auto（sr-only 等绝对定位后代随内容裁切，不撑宽 document）', async () => {
    const el = await mount(
      <ScrollRow data-testid="row">
        <span>一</span>
        <span className="sr-only">状态</span>
      </ScrollRow>,
    )
    const row = q('[data-testid="row"]', el)!
    expect(row.className).toMatch(/\brelative\b/)
    expect(row.className).toContain('overflow-x-auto')
    expect(row.className).toContain('min-w-0')
  })
})

describe('ux-01 / ux-02 移动控制台', () => {
  it("variant=mobile：Tab 条 scroll='bar' 整条交给外层横向滚动（w-max min-w-full pr-page-m），tablist 自身不 overflow，「递交页」在同一条里", async () => {
    const el = await mount(<ConsolePanel variant="mobile" />)
    const wrap = q('[data-testid="mobile-console-tabs"]', el)!
    expect(wrap.className).toContain('overflow-x-auto')
    const bar = q('[data-slot="ConsoleTabsBar"]', wrap)!
    expect(bar.getAttribute('data-scroll')).toBe('bar')
    for (const c of ['w-max', 'min-w-full', 'pr-page-m']) expect(bar.className).toContain(c)
    const tablist = q('[role="tablist"]', bar)!
    expect(tablist.className).not.toContain('overflow-x-auto')
    expect(tablist.className).toContain('shrink-0')
    const link = all('a', bar).find((a) => /递交页/.test(a.textContent ?? ''))!
    expect(link).toBeDefined()
    expect(bar.contains(link)).toBe(true)
  })

  it("variant=desktop：Tab 条 scroll='tabs'，tablist 自己 overflow-x-auto（桌面不变）", async () => {
    desktop = true
    const el = await mount(<ConsolePanel variant="desktop" />)
    const bar = q('[data-slot="ConsoleTabsBar"]', el)!
    expect(bar.getAttribute('data-scroll')).toBe('tabs')
    expect(bar.className).not.toContain('w-max')
    expect(q('[role="tablist"]', bar)!.className).toContain('overflow-x-auto')
  })

  it('面板头 复制全部 / 清空 图标：触控 size-sm-control + touch-hit，相邻 gap-3；脚部 清除构建缓存 / 其他输出文件：h-md-control + touch-hit，不再 h-touch', async () => {
    useStudio.setState({ items: [diag('claims.ref', 9)] })
    const el = await mount(<ConsolePanel variant="mobile" />)
    for (const id of ['console-copy-all', 'console-clear-client']) {
      const b = q(`[data-testid="${id}"]`, el)!
      expect(b.className).toContain('size-sm-control')
      expect(b.className).toContain('touch-hit')
      expect(b.className).not.toContain('size-touch')
      expect(b.parentElement!.className).toContain('gap-3')
    }
    for (const id of ['console-clear-cache', 'console-outputs']) {
      const b = q(`[data-testid="${id}"]`, el)!
      expect(b.className).toContain('h-md-control')
      expect(b.className).toContain('touch-hit')
      expect(b.className).not.toContain('h-touch')
    }
  })

  it('条目动作 查看规则说明 / 原始日志 / 定位 / 展开：触控视觉 sm 32 + touch-hit，不再 h-touch / size-touch；动作行 gap-3', async () => {
    const el = await mount(
      <ul data-variant="mobile">
        <ConsoleEntry item={diag('claims.ref', 9, '原始日志内容')} />
      </ul>,
    )
    const actions = q('[data-testid="console-entry-actions"]', el)!
    expect(actions.className).toContain('in-data-[variant=mobile]:gap-3')
    const buttons = all('button', actions)
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    for (const b of buttons) {
      expect(b.className).toContain('touch-hit')
      expect(b.className).toContain('in-data-[variant=mobile]:h-sm-control')
      expect(b.className).toContain('in-data-[density=touch]:h-sm-control')
      expect(b.className).not.toMatch(/h-touch/)
    }
    // 列表主行（标题区定位）保持 44；右侧圆形定位图标 sm 32 + touch-hit
    expect(q('[data-testid="console-entry-locate"]', el)!.className).toContain('in-data-[variant=mobile]:min-h-touch')
    const goto = q('[data-testid="console-entry-goto"]', el)!
    expect(goto.className).toContain('touch-hit')
    expect(goto.className).toContain('in-data-[variant=mobile]:size-sm-control')
    expect(goto.className).not.toMatch(/size-touch/)
  })
})

describe('ux-03 账户页 Segmented 贴边', () => {
  it('375：Segmented 在 ScrollRow 内 w-max min-w-full（铺满内容宽、左右 16 对称）且选项不带图标', async () => {
    window.location.hash = '#/account'
    const el = await mount(<AccountPage />)
    const nav = q('[data-testid="subnav-mobile"]', el)!
    expect(nav.getAttribute('data-slot')).toBe('scroll-row')
    const seg = q('[role="radiogroup"]', nav)!
    expect(seg.className).toContain('min-w-full')
    expect(seg.className).toContain('w-max')
    expect(seg.querySelector('svg')).toBeNull()
    expect(all('[data-slot="segmented-item"]', seg).length).toBeGreaterThanOrEqual(4)
  })
})

describe('桌面（≥md）视觉不变：qa-06 / qa-07 / qa-08', () => {
  it('qa-06 CheckPanel 桌面：check_all 折叠行不 whitespace-nowrap，header 单行 items-center；触控才 nowrap', async () => {
    desktop = true
    let el = await mount(<CheckPanel />)
    expect(q('[data-testid="check-all-toggle"]', el)!.className).not.toContain('whitespace-nowrap')
    expect(q('[data-testid="check-all-header"]', el)!.className).toContain('items-center')
    await act(async () => root?.unmount())
    root = null
    desktop = false
    el = await mount(<CheckPanel />)
    expect(q('[data-testid="check-all-toggle"]', el)!.className).toContain('whitespace-nowrap')
  })

  it('qa-07 AI 快捷动作 桌面：flex-wrap gap-1 容器（非 ScrollRow）+ chip flex-1，无 rounded-full / disabled:bg-transparent；触控才是 ScrollRow 胶囊', async () => {
    desktop = true
    useStudio.setState({ aiRuntime: { enabled: true, provider: 'mock', reachable: true }, aiEnabled: true, selection: null } as never)
    let el = await mount(<AiPanel />)
    let row = q('[data-testid="ai-quick-row"]', el)!
    expect(row.getAttribute('data-slot')).toBeNull()
    expect(row.className).toContain('flex-wrap')
    let chips = all('[data-slot="button"]', row)
    expect(chips.length).toBeGreaterThanOrEqual(2)
    for (const c of chips) {
      expect(c.className).toContain('flex-1')
      expect(c.className).not.toContain('rounded-full')
      expect(c.className).not.toContain('disabled:bg-transparent')
    }
    await act(async () => root?.unmount())
    root = null
    desktop = false
    el = await mount(<AiPanel />)
    row = q('[data-testid="ai-quick-row"]', el)!
    expect(row.getAttribute('data-slot')).toBe('scroll-row')
    chips = all('[data-slot="button"]', row)
    for (const c of chips) {
      expect(c.className).toContain('rounded-full')
      expect(c.className).not.toContain('flex-1')
    }
  })

  it('qa-08 CriticHint 桌面 leading-5 / 触控 leading-7；W9 ux-09 不含 CriticMarkup 语法', async () => {
    desktop = true
    let el = await mount(<CriticHint />)
    let hint = q('[data-testid="critic-hint"]', el)!
    expect(hint.getAttribute('data-density')).toBe('desktop')
    expect(hint.className).toContain('leading-5')
    expect(hint.className).not.toMatch(/leading-\[/)
    // W9 ux-09：面向代理师，不再列 CriticMarkup 语法
    expect(hint.textContent).not.toMatch(/\{\+\+|\{--|~~|studio\.json/)
    await act(async () => root?.unmount())
    root = null
    desktop = false
    el = await mount(<CriticHint />)
    hint = q('[data-testid="critic-hint"]', el)!
    expect(hint.getAttribute('data-density')).toBe('touch')
    expect(hint.className).toContain('leading-7')
  })
})

describe('ux-05 首页顶栏', () => {
  it('375：搜索 / 新建 都是 icon-md（size-md-control 36 + touch-hit），不再 size-touch；同一 gap-2 容器', async () => {
    useStudio.getState().resetDashboard()
    useStudio.setState({ projects: [], tags: [] })
    vi.spyOn(api, 'projects').mockResolvedValue([])
    vi.spyOn(api, 'tags').mockResolvedValue({ tags: [] })
    vi.spyOn(api, 'notifications').mockResolvedValue({ items: [], unread: 0 } as never)
    const el = await mount(<DashboardPage />)
    const create = q('[data-testid="dashboard-create"]', el)!
    const search = q('[data-testid="dashboard-search-toggle"]', el)!
    for (const b of [create, search]) {
      expect(b.className).toContain('size-md-control')
      expect(b.className).toContain('touch-hit')
      expect(b.className).not.toContain('size-touch')
    }
    expect(create.parentElement).toBe(search.parentElement)
    expect(create.parentElement!.className).toContain('gap-2')
  })
})
