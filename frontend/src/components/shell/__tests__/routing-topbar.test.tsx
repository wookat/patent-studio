// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import type { ProjectDetail } from '@/lib/types'
import { parseHash } from '@/lib/hash'
import { useStudio } from '@/store'
import { caseFieldsFromForm } from '@/lib/caseForm'
import { CreateProjectDialog } from '../CreateProjectDialog'
import { ProjectMenu } from '../ProjectMenu'
import { StoreBootstrap } from '../StoreBootstrap'
import { TopBar } from '../TopBar'
import { MobileTopBar } from '@/components/mobile/MobileTopBar'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * A3-routing-topbar（13 §5.3 / §9）：
 *  - 顶栏「← 案卷」经 requestNavigation({type:'dashboard'}) 回 #/（脏时进 DirtyGuard，不直接跳）；
 *  - 案名 + 状态徽章读 project.case.status / project.role；viewer 只读；
 *  - ProjectMenu 无「切换 / 新建」；compact（移动端）下拉含 状态 ▸；
 *  - CreateProjectDialog 案号 / 客户 / 责任人 / 开案日期 → POST /api/projects case；
 *  - StoreBootstrap：深链接 404 ⇒ toast + 回面板；同案旧 #/<pid> ⇒ 改写 #/p/<pid>；
 *  - axe 无 serious/critical。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

vi.mock('@/collab', () => ({ PresenceBar: () => null }))
vi.mock('@/components/preview/PreviewPane', () => ({ PreviewPane: () => null }))

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
  window.location.hash = ''
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function serious(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const click = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
/** Radix 菜单触发器监听 pointerdown（非 click） */
const pointerOpen = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' } as PointerEventInit))
  })
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role=menu] [role^="menuitem"]')].map((n) => n.textContent?.trim() ?? '')

function detail(extra: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'method',
    title: '一种数据处理方法',
    mtime: 1_700_000_000,
    collaborators: [],
    last_modified_by: null,
    my_role: 'agent',
    list_state: 'active',
    role: 'agent',
    case: {
      version: 1,
      case_no: 'P-1',
      kind: 'invention',
      status: 'drafting',
      owner_user_id: 'u1',
      client: '客户甲',
      applicants: [],
      inventors: [],
      tags: [],
      dates: { opened: '2026-01-01', target_filing: null, filed: null, application_no: null },
      deadlines: [],
      archived: false,
      next_deadline: null,
    },
    figs: [],
    settings: {} as ProjectDetail['settings'],
    has_settings_file: false,
    content: '# x',
    backups: [],
    ...extra,
  }
}

beforeEach(() => {
  window.location.hash = '#/p/method'
  useStudio.setState({
    pid: 'method',
    project: detail(),
    projectError: null,
    content: '# x',
    saved: '# x',
    collabStatus: 'off',
    authStatus: 'authed',
    user: { id: 'u1', email: 'a@x.org', display_name: '张代理', is_superuser: false },
    dialog: null,
    dirtyGuard: { pending: null },
    toasts: [],
  })
})

const Desktop = () => (
  <TooltipProvider>
    <TopBar />
  </TooltipProvider>
)

describe('TopBar（1440）', () => {
  it('案名 + 状态徽章；← 案卷 经守卫回 #/；ProjectMenu 无切换 / 新建；axe', async () => {
    const el = await mount(<Desktop />)
    expect(q('[data-testid=project-tab]')?.textContent).toContain('一种数据处理方法')
    const picker = q<HTMLButtonElement>('[data-slot=StatusPicker]')
    expect(picker?.getAttribute('aria-label')).toBe('状态：撰写，点击更改')

    await pointerOpen(q('[data-testid=project-tab]')!)
    const items = menuItems()
    expect(items).toEqual(['重命名…', '复制…', '返回案卷面板'])
    expect(items.join()).not.toMatch(/切换|新建/)
    expect(await serious(document.body)).toEqual([])
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    expect(await serious(el)).toEqual([])
    await click(q('[data-testid=back-to-dashboard]')!)
    expect(parseHash()).toEqual({ kind: 'dashboard' })
    expect(useStudio.getState().dirtyGuard.pending).toBeNull()
  })

  it('顶栏不再放第二个「构建」（老板：与 PDF 卡工具条重复）；菜单栏 构建 与快捷键仍在', async () => {
    await mount(<Desktop />)
    expect(q('[data-testid=topbar-build]')).toBeNull()
    expect(q('[data-testid=topbar-right] [data-slot=split-button-main]')).toBeNull()
    expect([...q<HTMLElement>('[data-testid=topbar-right]')!.querySelectorAll('button')].some((b) => /构建/.test(b.textContent ?? ''))).toBe(false)
    expect(q('[data-testid=menubar] [data-testid=menu-build]')).not.toBeNull()
  })

  it('domain-03/ux-06：顶栏可点控件统一 32 档（h-md-control / size-md-control）——返回案卷、状态、分享、导出、账号；不再混用 24/28', async () => {
    await mount(<Desktop />)
    const ctl = (sel: string) => {
      const el = q<HTMLElement>(sel)
      expect(el, sel).not.toBeNull()
      return el!.className
    }
    for (const sel of ['[data-testid=back-to-dashboard]', '[data-slot=StatusPicker]', '[data-testid=share-button]', '[data-testid=export-menu]']) {
      const cls = ctl(sel)
      expect(cls, sel).toMatch(/\bh-md-control\b/)
      expect(cls, sel).not.toMatch(/\bh-(xs|sm)-control\b/)
    }
    expect(ctl('[data-testid=user-menu]')).toMatch(/\bsize-md-control\b/)
    // qa-02：1024 顶栏右组 ≈ 594px 会把账号按钮推出视口；返回案卷 / 分享 / 导出 的文字标签只在 xl（≥1280）显示，1024 只留图标
    for (const sel of ['[data-testid=back-to-dashboard]', '[data-testid=share-button]', '[data-testid=export-menu]']) {
      const label = [...q<HTMLElement>(sel)!.querySelectorAll('span')].find((n) => /案卷|分享|导出/.test(n.textContent ?? ''))
      expect(label?.className, sel).toMatch(/\bhidden\b/)
      expect(label?.className, sel).toMatch(/\bxl:inline\b/)
    }
    // W7 qa-03：1280 仍溢出 39px（字标 + 标签同时在 xl 出现）、1024 账号只露 13px（布局按钮 lg 出现）——
    // 字标退到 2xl、布局按钮退到 xl（视图 菜单 / 快捷键仍可切布局），账号菜单在 1280 / 1024 都留在视口内
    const wordmark = [...q<HTMLElement>('[data-testid=logo]')!.querySelectorAll('span')].find((n) => n.textContent === '知撰')
    expect(wordmark?.className).toMatch(/\bhidden\b/)
    expect(wordmark?.className).toMatch(/\b2xl:inline\b/)
    expect(wordmark?.className).not.toMatch(/\bxl:inline\b/)
    // 23-w12 §4：布局按钮从顶栏撤走（视图 菜单 / Mod-\ 仍可切），账号菜单不再被挤
    expect(q('[data-testid=layout-menu]')).toBeNull()
  })

  it('23-w12 §4 第一 / 二步：顶栏伴随栏入口只剩 AI（历史 / 控制台 图标撤走）；审阅入口唯一（带字 + Count，不再是伴随栏 review）；AI 带文字（≥ xl）；每功能同屏 ≤ 1 常驻 + 1 菜单', async () => {
    await mount(<Desktop />)
    const right = q<HTMLElement>('[data-testid=topbar-right]')!
    expect([...right.querySelectorAll<HTMLElement>('[data-companion]')].map((n) => n.dataset.companion)).toEqual(['ai'])
    expect(q('[data-testid=topbar-history]')).toBeNull()
    expect(q('[data-testid=topbar-console]')).toBeNull()
    expect(q('[data-testid=right-rail-toggle]')).toBeNull()
    const reviews = document.querySelectorAll<HTMLButtonElement>('[data-testid=topbar-review]')
    expect(reviews.length).toBe(1)
    expect(right.contains(reviews[0])).toBe(true)
    const reviewText = [...reviews[0].querySelectorAll('span')].find((n) => n.textContent === '审阅')
    expect(reviewText?.className).toMatch(/\bhidden\b/)
    expect(reviewText?.className).toMatch(/\bxl:inline\b/)
    const ai = q<HTMLButtonElement>('[data-testid=topbar-ai]')!
    const text = [...ai.querySelectorAll('span')].find((n) => n.textContent === 'AI')
    expect(text?.className).toMatch(/\bhidden\b/)
    expect(text?.className).toMatch(/\bxl:inline\b/)
    expect(ai.className).toMatch(/\bh-md-control\b/)
    // 常驻纯图标（无可见文字）≤ 2：审阅 + 导出以外全部带字或已撤
    const iconOnly = [...right.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.querySelector('span:not([aria-hidden])')?.textContent?.trim())
    expect(iconOnly.length).toBeLessThanOrEqual(2)
    // 视图菜单仍有 布局 三档 + 控制台（Mod-J）
    await pointerOpen(q('[data-testid=menu-view]')!)
    const items = menuItems()
    expect(items.some((t) => /双栏|并排|分屏/.test(t))).toBe(true)
    expect(items.some((t) => /控制台/.test(t))).toBe(true)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  })

  it('视图菜单首项 命令面板 → 打开 palette（批18 点击入口补齐）', async () => {
    await mount(<Desktop />)
    await pointerOpen(q('[data-testid=menu-view]')!)
    expect(q('[data-testid=view-palette]')).not.toBeNull()
    await click(q('[data-testid=view-palette]')!)
    expect(useStudio.getState().dialog).toBe('palette')
  })

  it('有未保存修改时 ← 案卷 进 DirtyGuard，不直接离开', async () => {
    useStudio.setState({ content: '# y' })
    await mount(<Desktop />)
    await click(q('[data-testid=back-to-dashboard]')!)
    expect(useStudio.getState().dirtyGuard.pending).toEqual({ type: 'dashboard' })
    expect(parseHash()).toEqual({ kind: 'project', pid: 'method', legacy: false, query: {} })
  })

  it('viewer 只见徽章不可改；无 case 摘要（旧后端）不渲染', async () => {
    useStudio.setState({ project: detail({ role: 'viewer' }) })
    await mount(<Desktop />)
    expect(q('[data-slot=StatusPicker]')).toBeNull()
    expect(q('[data-slot=status-dot]')?.textContent).toContain('撰写')
    await act(async () => root?.unmount())
    root = null
    host.remove()
    useStudio.setState({ project: detail({ case: undefined }) })
    await mount(<Desktop />)
    expect(q('[data-slot=StatusPicker]')).toBeNull()
    expect(q('[data-slot=status-dot]')).toBeNull()
  })
})

describe('ProjectMenu compact / MobileTopBar（375）', () => {
  it('移动顶栏有 ← 案卷；下拉内联 状态 十档单选（agent 可改，不弹子菜单）；axe', async () => {
    const setCaseStatus = vi.spyOn(api, 'setCaseStatus').mockResolvedValue({ ...detail().case!, status: 'review' })
    const el = await mount(<MobileTopBar />)
    expect(q('[data-testid=back-to-dashboard]')?.getAttribute('aria-label')).toBe('返回案卷面板')
    // W6：「更多」下沉到底部 MobileTabs（more Sheet），顶栏右侧只剩 构建 primary + 协作
    expect(q('[data-testid=more-menu]')).toBeNull()
    expect(q('[data-testid=mobile-build]')).not.toBeNull()
    expect(await serious(el)).toEqual([])

    await pointerOpen(q('[data-testid=project-tab]')!)
    const status = q('[data-testid=project-status]')
    expect(status?.textContent).toContain('状态')
    expect(status?.textContent).toContain('撰写')
    expect(menuItems().join()).not.toMatch(/切换|新建/)
    expect(document.querySelectorAll('[role=menuitemradio]').length).toBe(10)
    expect(q('[role=menuitem][aria-haspopup]')).toBeNull()
    const review = q('[data-testid=status-review]')
    expect(review).not.toBeNull()
    expect(q('[data-testid=status-drafting]')?.getAttribute('aria-checked')).toBe('true')
    expect(await serious(document.body)).toEqual([])
    await click(review!)
    expect(setCaseStatus).toHaveBeenCalledWith('method', 'review', '')
    await act(async () => {})
    expect(useStudio.getState().project?.case?.status).toBe('review')
  })

  it('viewer：状态只展示，无子菜单', async () => {
    useStudio.setState({ project: detail({ role: 'viewer' }) })
    await mount(<ProjectMenu compact />)
    await pointerOpen(q('[data-testid=project-tab]')!)
    expect(q('[data-testid=project-status]')).toBeNull()
    expect(q('[role=menu] [data-slot=status-dot]')?.textContent).toContain('撰写')
  })
})

describe('CreateProjectDialog', () => {
  it('caseFieldsFromForm：空白 ⇒ undefined；trim；opened → dates.opened', () => {
    expect(caseFieldsFromForm({ caseNo: ' ', client: '', opened: '' })).toBeUndefined()
    expect(caseFieldsFromForm({ caseNo: ' P-9 ', client: '', opened: '' })).toEqual({ case_no: 'P-9' })
    expect(caseFieldsFromForm({ caseNo: '', client: '甲', opened: '2026-09-05' })).toEqual({ client: '甲', dates: { opened: '2026-09-05' } })
  })

  it('案号 / 客户 / 责任人（= 创建者，只读）/ 开案日期（默认今天）→ createProject 第三参；axe', async () => {
    const created = vi.spyOn(api, 'createProject').mockResolvedValue(detail({ id: 'dev', title: '新案' }))
    vi.spyOn(api, 'projects').mockResolvedValue([])
    useStudio.setState({ dialog: 'create' })
    await mount(<CreateProjectDialog />)
    const dlg = q('[role=dialog]')!
    const owner = q<HTMLInputElement>('[data-testid=np-owner]')!
    expect(owner.value).toBe('张代理')
    expect(owner.readOnly).toBe(true)
    const opened = q<HTMLInputElement>('[data-testid=np-opened]')!
    expect(opened.type).toBe('date')
    expect(opened.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await serious(dlg)).toEqual([])

    const type = (sel: string, v: string) =>
      act(async () => {
        const input = q<HTMLInputElement>(sel)!
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, v)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    // 案卷标识默认折叠且自动生成：名称 → 案号优先；全程不出现「目录名 / id / content.md」
    expect(dlg.textContent).not.toMatch(/目录名|\bid\b|content\.md|figs|studio\.json/)
    expect(q('#np-id')).toBeNull()
    await type('#np-title', '新案')
    expect(q('[data-testid=np-id-preview]')?.textContent).toBe('新案')
    await type('[data-testid=np-case-no]', 'P2026-0042')
    expect(q('[data-testid=np-id-preview]')?.textContent).toBe('P2026-0042')
    await type('[data-testid=np-client]', '客户乙')
    await type('[data-testid=np-opened]', '2026-09-01')
    await act(async () => dlg.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(created).toHaveBeenCalledWith('P2026-0042', '新案', { case_no: 'P2026-0042', client: '客户乙', dates: { opened: '2026-09-01' } }, undefined)
    expect(useStudio.getState().dialog).toBeNull()
  })

  it('展开「案卷标识」可自定义；非法字符禁用创建并提示；与已有 id 撞名自动加 -2', async () => {
    const created = vi.spyOn(api, 'createProject').mockResolvedValue(detail({ id: 'my-case', title: '新案' }))
    vi.spyOn(api, 'projects').mockResolvedValue([])
    useStudio.setState({ dialog: 'create', projects: [{ id: '新案', title: '新案', mtime: 0 }] })
    await mount(<CreateProjectDialog />)
    const dlg = q('[role=dialog]')!
    const type = (sel: string, v: string) =>
      act(async () => {
        const input = q<HTMLInputElement>(sel)!
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, v)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await type('#np-title', '新案')
    expect(q('[data-testid=np-id-preview]')?.textContent).toBe('新案-2')
    await act(async () => q<HTMLButtonElement>('[data-testid=np-id-field] button')!.click())
    expect(q<HTMLInputElement>('#np-id')?.value).toBe('新案-2')
    await type('#np-id', 'bad id!')
    const submit = dlg.querySelector<HTMLButtonElement>('button[type=submit]')!
    expect(submit.disabled).toBe(true)
    expect(q('#np-id-hint')?.textContent).toContain('只能包含')
    await type('#np-id', 'my-case')
    expect(submit.disabled).toBe(false)
    await act(async () => dlg.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(created).toHaveBeenCalledWith('my-case', '新案', { dates: { opened: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } }, undefined)
  })

  it('auth=off：责任人显示 —，提示不记责任人', async () => {
    useStudio.setState({ authStatus: 'off', user: null, dialog: 'create' })
    await mount(<CreateProjectDialog />)
    expect(q<HTMLInputElement>('[data-testid=np-owner]')?.value).toBe('—')
    expect(q('#np-owner-hint')?.textContent).toContain('未启用账号')
  })
})

describe('StoreBootstrap 路由 ↔ openProject', () => {
  beforeEach(() => {
    useStudio.setState({ pid: null, project: null, projects: [] })
    vi.spyOn(api, 'me').mockResolvedValue(undefined)
    vi.spyOn(api, 'projects').mockResolvedValue([])
    vi.spyOn(api, 'defaults').mockRejectedValue(new Error('skip'))
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, soffice: true, soffice_bin: '', projects_dir: '' })
  })

  it('深链接 #/p/<不存在> ⇒ toast「不存在」并回 #/', async () => {
    window.location.hash = '#/p/ghost'
    vi.spyOn(api, 'project').mockRejectedValue(new ApiError(404, 'Not Found'))
    await mount(<StoreBootstrap />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(useStudio.getState().projectError).toBe('案卷「ghost」不存在')
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('案卷「ghost」不存在')
    expect(parseHash()).toEqual({ kind: 'dashboard' })
  })

  it('旧 #/<pid> 启动 ⇒ 开案并改写为 #/p/<pid>；同案再次进入旧链接只改写不重开', async () => {
    window.location.hash = '#/method'
    const project = vi.spyOn(api, 'project').mockResolvedValue(detail())
    await mount(<StoreBootstrap />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(project).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().project?.id).toBe('method')
    expect(window.location.hash).toBe('#/p/method')

    window.location.hash = '#/method'
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.location.hash).toBe('#/p/method')
    expect(project).toHaveBeenCalledTimes(1)
  })

  it('#/ 启动不开案（面板）', async () => {
    window.location.hash = '#/'
    const project = vi.spyOn(api, 'project').mockResolvedValue(detail())
    await mount(<StoreBootstrap />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(project).not.toHaveBeenCalled()
    expect(useStudio.getState().pid).toBeNull()
  })

  it('批65 document.title 路由感知：页面路由落名，返回工作台恢复案名，PageChrome 页不被覆盖', async () => {
    useStudio.setState({ pid: 'method', project: detail() })
    window.location.hash = '#/p/method'
    await mount(<StoreBootstrap />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.title).toBe('一种数据处理方法 · 知撰')

    /* hash= 赋值的 hashchange 在 jsdom 是宏任务——须 setTimeout(0) 才落地 */
    const nav = async (hash: string) => {
      window.location.hash = hash
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
    }
    await nav('#/deadlines')
    expect(document.title).toBe('期限中心 · 知撰')
    await nav('#/inbox')
    expect(document.title).toBe('通知中心 · 知撰')

    /* PageChrome 页自有设置器（模拟其已落名）——applyTitle 不得覆盖 */
    await nav('#/account')
    document.title = '账户 · 知撰'
    await act(async () => {})
    expect(document.title).toBe('账户 · 知撰')

    await nav('#/p/method')
    expect(document.title).toBe('一种数据处理方法 · 知撰')
  })
})
