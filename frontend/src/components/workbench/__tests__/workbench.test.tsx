// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import type { ProjectDetail } from '@/lib/types'
import { useStudio, type DockHandle } from '@/store'
import { modeStorageKey } from '@/store/collabCenter'
import { EditModeSwitch } from '../EditModeSwitch'
import { LayoutRightRail, selectRailAsColumn } from '../LayoutRightRail'
import { SideBySideToggle, ViewSwitch, switchToView, toggleSideBySide } from '../ViewSwitch'
import { WorkbenchControls } from '../WorkbenchControls'
import { bottomBarActions, rightRailSlot } from '../slots'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let mqMatches: Record<string, boolean> = {}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({
      matches: mqMatches[q] ?? false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList
})

beforeEach(() => {
  mqMatches = {}
  localStorage.clear()
  bottomBarActions.clear()
  rightRailSlot.clear()
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: 'p1', role: 'editor' } as unknown as ProjectDetail,
    editorView: 'source',
    editorMode: 'edit',
    collabReadonly: false,
    activePanelId: null,
    dockHandle: null,
    activeBook: 'all',
    mobileTab: 'edit',
    mobilePreviewKind: 'layout',
    rightRailOpen: true,
    rightRailSheetOpen: false,
    rightRailColumnFits: true,
    ast: SYNTH_AST,
    content: SYNTH_MD,
    activeBlock: null,
    cursor: { line: 1, col: 1 },
    focus: null,
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

function fakeDock(open: string[] = []) {
  const openPanel = vi.fn((id: string, opts?: { replace?: string }) => {
    if (opts?.replace) open.splice(open.indexOf(opts.replace), 1, id)
    else if (!open.includes(id)) open.push(id)
    useStudio.setState({ activePanelId: id })
  })
  const closePanel = vi.fn((id: string) => {
    const i = open.indexOf(id)
    if (i >= 0) open.splice(i, 1)
  })
  return {
    openPanel,
    closePanel,
    panelIds: () => [...open],
    isPanelVisible: () => true,
    focusPanel: vi.fn(),
    focusNext: vi.fn(),
    toggleMaximize: vi.fn(),
    applyPreset: vi.fn(),
    resetLayout: vi.fn(),
  } as unknown as DockHandle & { openPanel: typeof openPanel; closePanel: typeof closePanel }
}

const click = (el: ParentNode, sel: string) => act(async () => el.querySelector<HTMLButtonElement>(sel)!.click())
const q = (el: ParentNode, sel: string) => el.querySelector<HTMLElement>(sel)!
const key = (o: Partial<KeyboardEventInit>) => act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...o })))

describe('ViewSwitch（源码 | 版面 | PDF）', () => {
  it('radiogroup 三段带 lucide 图标；值 = 活动卡片视图；点击切换 → dock replace 同书卡；axe 无 serious', async () => {
    const dock = fakeDock(['source:claims', 'outline'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:claims', activeBook: 'claims' })
    const el = await mount(<ViewSwitch />)
    const group = q(el, '[data-testid="view-switch"]')
    expect(group.getAttribute('role')).toBe('radiogroup')
    expect(group.getAttribute('data-value')).toBe('source')
    const btns = Array.from(group.querySelectorAll('button'))
    expect(btns.map((b) => b.textContent)).toEqual(['源码', '版面', 'PDF'])
    expect(btns.every((b) => b.querySelector('svg.lucide'))).toBe(true)
    expect(q(el, '[data-testid="view-switch-source"]').getAttribute('aria-checked')).toBe('true')
    await click(el, '[data-testid="view-switch-layout"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('layout:claims', { replace: 'source:claims' })
    expect(useStudio.getState().editorView).toBe('layout')
    expect(q(el, '[data-testid="view-switch"]').getAttribute('data-value')).toBe('layout')
    await click(el, '[data-testid="view-switch-pdf"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { replace: 'layout:claims' })
    expect(useStudio.getState().editorView).toBe('layout')
    expect(await violations(el)).toEqual([])
  })

  it('切换保持块：切换前的 activeBlock / 光标行 → setFocus(block_id, line, source=原视图)，目标视图消费同一 block_id', async () => {
    const dock = fakeDock(['source:claims'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:claims', cursor: { line: 13, col: 1 } })
    switchToView('layout')
    const f = useStudio.getState().focus
    expect(f).toMatchObject({ book: 'claims', blockId: 'claims/3', line: 13, source: 'source' })
    useStudio.setState({ activePanelId: 'layout:claims', activeBlock: { id: 'description/背景技术/p0002', book: 'description' } as never })
    switchToView('pdf')
    expect(useStudio.getState().focus).toMatchObject({ book: 'description', blockId: 'description/背景技术/p0002', line: 26, source: 'layout' })
    expect(useStudio.getState().focus!.seq).toBeGreaterThan(f!.seq)
  })

  it('Ctrl+1/2/3 全局热键（挂载一次）：切视图并 preventDefault；Ctrl+Alt+1 不接管；卸载后不再响应', async () => {
    const dock = fakeDock(['source:all'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:all' })
    await mount(<ViewSwitch />)
    const e = new KeyboardEvent('keydown', { key: '2', ctrlKey: true, cancelable: true })
    await act(async () => window.dispatchEvent(e))
    expect(e.defaultPrevented).toBe(true)
    expect(dock.openPanel).toHaveBeenLastCalledWith('layout:all', { replace: 'source:all' })
    await key({ key: '3', ctrlKey: true })
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { replace: 'layout:all' })
    dock.openPanel.mockClear()
    await key({ key: '1', ctrlKey: true, altKey: true })
    expect(dock.openPanel).not.toHaveBeenCalled()
    await act(async () => root?.unmount())
    root = null
    await key({ key: '1', ctrlKey: true })
    expect(dock.openPanel).not.toHaveBeenCalled()
  })

  it('无 dock（375）：源码 ↔ 版面只改 editorView 留在编辑 Tab；PDF 去预览 Tab', () => {
    switchToView('layout')
    expect(useStudio.getState().editorView).toBe('layout')
    expect(useStudio.getState().mobileTab).toBe('edit')
    switchToView('pdf')
    expect(useStudio.getState().mobileTab).toBe('preview')
    expect(useStudio.getState().mobilePreviewKind).toBe('pdf')
    useStudio.setState({ activeBlock: null, cursor: { line: 9, col: 1 } })
    switchToView('source')
    expect(useStudio.getState().mobileTab).toBe('edit')
    expect(useStudio.getState().focus).toMatchObject({ blockId: 'claims/1', source: 'layout' })
  })

  it('xl 尺寸（375 顶部）：容器 h-touch 44、三段 flex-1 等宽、无 Tooltip 包装', async () => {
    const el = await mount(<ViewSwitch size="xl" tips={false} />)
    const group = q(el, '[data-testid="view-switch"]')
    expect(group.className).toContain('h-touch')
    expect(group.getAttribute('data-size')).toBe('xl')
    for (const b of group.querySelectorAll('button')) expect(b.className).toContain('flex-1')
    expect(el.querySelector('[data-slot="tooltip-trigger"]')).toBeNull()
  })
})

describe('并排（当前视图 + PDF）', () => {
  it('无 dock 不渲染；dock 下开 → PDF 卡开在当前卡右侧，pressed；再点 → 关 PDF 卡', async () => {
    const none = await mount(<SideBySideToggle />)
    expect(none.querySelector('[data-testid="view-side-by-side"]')).toBeNull()
    await act(async () => root?.unmount())
    root = null
    const dock = fakeDock(['layout:claims'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'layout:claims' })
    const el = await mount(<SideBySideToggle />)
    const btn = q(el, '[data-testid="view-side-by-side"]')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    await click(el, '[data-testid="view-side-by-side"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { position: { referencePanel: 'layout:claims', direction: 'right' } })
    // 打开 PDF 卡后 dock 把它设为活动卡；并排状态由「PDF + 源码/版面卡同时打开」判定
    await act(async () => useStudio.setState({ activePanelId: 'layout:claims' }))
    expect(q(el, '[data-testid="view-side-by-side"]').getAttribute('aria-pressed')).toBe('true')
    toggleSideBySide()
    expect(dock.closePanel).toHaveBeenCalledWith('pdf')
  })

  it('源码活动 + PDF 在旁：点开关关掉 PDF（活动卡不变）→ pressed 立即变 false（dockRevision 重取 panelIds）；再点 → 重开 PDF，不会卡死', async () => {
    const dock = fakeDock(['source:all', 'pdf'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:all' })
    const el = await mount(<SideBySideToggle />)
    const btn = () => q(el, '[data-testid="view-side-by-side"]')
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    const rev0 = useStudio.getState().dockRevision
    await click(el, '[data-testid="view-side-by-side"]')
    expect(dock.closePanel).toHaveBeenCalledWith('pdf')
    expect(dock.panelIds()).toEqual(['source:all'])
    expect(useStudio.getState().dockRevision).toBeGreaterThan(rev0)
    expect(btn().getAttribute('aria-pressed')).toBe('false')
    await click(el, '[data-testid="view-side-by-side"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { position: { referencePanel: 'source:all', direction: 'right' } })
    expect(btn().getAttribute('aria-pressed')).toBe('true')
  })

  it('store.openPanel / closePanel / applyPreset / resetLayout 都 bump dockRevision（dock 面板集合不是 store 状态）', () => {
    const dock = fakeDock(['source:all'])
    useStudio.setState({ dockHandle: dock })
    const s = useStudio.getState()
    const r0 = s.dockRevision
    s.openPanel('pdf')
    s.closePanel('pdf')
    s.applyPreset('default')
    s.resetLayout()
    expect(useStudio.getState().dockRevision).toBe(r0 + 4)
  })
})

describe('EditModeSwitch（编辑 | 审阅）', () => {
  it('editor：二段可切，写 collabCenter.editorMode 并按案持久化 ps:mode:<pid>；axe 无 serious', async () => {
    const el = await mount(<EditModeSwitch />)
    const group = q(el, '[data-testid="edit-mode-switch"]')
    expect(group.getAttribute('role')).toBe('radiogroup')
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['编辑', '审阅修订'])
    expect(q(el, '[data-testid="edit-mode-edit"]').getAttribute('aria-checked')).toBe('true')
    await click(el, '[data-testid="edit-mode-review"]')
    expect(useStudio.getState().editorMode).toBe('review')
    expect(localStorage.getItem(modeStorageKey('p1'))).toBe('review')
    expect(q(el, '[data-testid="edit-mode-review"]').getAttribute('aria-checked')).toBe('true')
    await click(el, '[data-testid="edit-mode-edit"]')
    expect(useStudio.getState().editorMode).toBe('edit')
    expect(await violations(el)).toEqual([])
  })

  it('reviewer：固定「审阅」且两段禁用', async () => {
    useStudio.setState({ project: { id: 'p1', name: 'p1', role: 'reviewer' } as unknown as ProjectDetail })
    const el = await mount(<EditModeSwitch />)
    expect(q(el, '[data-testid="edit-mode-review"]').getAttribute('aria-checked')).toBe('true')
    expect(q(el, '[data-testid="edit-mode-edit"]').hasAttribute('disabled')).toBe(true)
    expect(q(el, '[data-testid="edit-mode-review"]').hasAttribute('disabled')).toBe(true)
    await click(el, '[data-testid="edit-mode-edit"]')
    expect(useStudio.getState().editorMode).toBe('edit')
    expect(localStorage.getItem(modeStorageKey('p1'))).toBeNull()
  })

  it('readonly（viewer / 协同只读）：只读徽标，无分段', async () => {
    useStudio.setState({ collabReadonly: true })
    const el = await mount(<EditModeSwitch />)
    expect(el.querySelector('[data-testid="edit-mode-switch"]')).toBeNull()
    expect(q(el, '[data-testid="edit-mode-readonly"]').textContent).toContain('只读')
  })
})

describe('WorkbenchControls（顶栏中央挂点）', () => {
  it('无 pid 不渲染；有 pid：ViewSwitch + 并排 + 编辑|审阅 同一组；审阅栏开关不在中央（23-w12 §4 第二步：顶栏右组唯一「审阅」）', async () => {
    useStudio.setState({ pid: null })
    const none = await mount(<WorkbenchControls />)
    expect(none.querySelector('[data-testid="workbench-controls"]')).toBeNull()
    await act(async () => root?.unmount())
    root = null
    useStudio.setState({ pid: 'p1', dockHandle: fakeDock(['source:all']), activePanelId: 'source:all' })
    const el = await mount(<WorkbenchControls />)
    const g = q(el, '[data-testid="workbench-controls"]')
    expect(g.getAttribute('role')).toBe('group')
    for (const id of ['view-switch', 'view-side-by-side', 'edit-mode-switch']) expect(g.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
    expect(g.querySelector('[data-testid="right-rail-toggle"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('中央容器 <240px（1024 三栏）：并排 / 分隔 / 二段开关带 @max-[240px]/topbar:hidden，ModeIndicator compact 单键（size-8）反向显示；1280（≈264）不触发', async () => {
    useStudio.setState({ pid: 'p1', dockHandle: fakeDock(['source:all']), activePanelId: 'source:all' })
    const el = await mount(<WorkbenchControls />)
    const g = q(el, '[data-testid="workbench-controls"]')
    const narrow = /@max-\[240px\]\/topbar:hidden/
    expect(q(g, '[data-testid="view-switch"]').className).not.toMatch(narrow)
    for (const id of ['view-side-by-side', 'edit-mode-switch']) expect(q(g, `[data-testid="${id}"]`).className).toMatch(narrow)
    expect(g.querySelector('[data-slot="separator"], [data-slot="Separator"], [role="separator"], [data-orientation="vertical"]')?.className).toMatch(narrow)
    const compact = q(g, '[data-testid="edit-mode-compact"]')
    expect(compact.className).toMatch(/\bhidden\b/)
    expect(compact.className).toMatch(/@max-\[240px\]\/topbar:block/)
    const ind = q(compact, '[data-testid="mode-indicator"]')
    expect(ind.className).toContain('size-8')
    expect(ind.className).not.toContain('size-10')
    expect(ind.getAttribute('data-mode')).toBe('edit')
  })
})

describe('LayoutRightRail（版面卡右侧 320 审阅栏）', () => {
  it('≥1280：常驻列 w-companion-min（320 token），折叠按钮写 rightRailOpen=false 后不占列；空态提示 rightRailSlot', async () => {
    mqMatches['(min-width: 1280px)'] = true
    const el = await mount(<LayoutRightRail />)
    const rail = q(el, '[data-testid="right-rail"]')
    expect(rail.tagName).toBe('ASIDE')
    expect(rail.getAttribute('data-presentation')).toBe('column')
    expect(rail.className).toContain('w-companion-min')
    expect(rail.className).toContain('shrink-0')
    expect(rail.querySelector('[data-testid="right-rail-empty"]')).not.toBeNull()
    await click(el, '[data-testid="right-rail-collapse"]')
    expect(useStudio.getState().rightRailOpen).toBe(false)
    expect(el.querySelector('[data-testid="right-rail"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('<1280：不占列；rightRailSheetOpen 驱动 Sheet(right)（开关在顶栏「审阅」，见 review-drawer.test）', async () => {
    const el = await mount(<LayoutRightRail />)
    expect(el.querySelector('[data-testid="right-rail"]')).toBeNull()
    expect(document.querySelector('[data-testid="right-rail-sheet"]')).toBeNull()
    await act(async () => useStudio.getState().setRightRailSheetOpen())
    const s = useStudio.getState()
    expect(s.rightRailSheetOpen).toBe(true)
    expect(s.rightRailOpen).toBe(true)
    expect(document.querySelector('[data-testid="right-rail-sheet"] [data-testid="right-rail"]')?.getAttribute('data-presentation')).toBe('sheet')
  })

  it('≥1280 但版面卡身不够宽（ResizeObserver 量到 < 640）：rightRailColumnFits=false → 不占列、rightRailSheetOpen 改走 Sheet；卸载恢复 true', async () => {
    mqMatches['(min-width: 1280px)'] = true
    let width = 1000
    const observed: Element[] = []
    class RO {
      observe(el: Element) {
        observed.push(el)
      }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO)
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600 }) as DOMRect)
    const el = await mount(
      <div data-testid="host">
        <LayoutRightRail />
      </div>,
    )
    expect(observed[0]).toBe(q(el, '[data-testid="host"]'))
    expect(useStudio.getState().rightRailColumnFits).toBe(true)
    expect(q(el, '[data-testid="right-rail"]').getAttribute('data-presentation')).toBe('column')
    width = 400
    await act(async () => useStudio.getState().setRightRailColumnFits(false))
    expect(el.querySelector('[data-testid="right-rail"]')).toBeNull()
    expect(selectRailAsColumn(true, useStudio.getState())).toBe(false)
    await act(async () => useStudio.getState().setRightRailSheetOpen())
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(document.querySelector('[data-testid="right-rail-sheet"]')).not.toBeNull()
    await act(async () => root?.unmount())
    root = null
    expect(useStudio.getState().rightRailColumnFits).toBe(true)
    spy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('≥1280 深链 / 审阅模式在卡挂载前 revealRightRail（fits 默认 true）：挂载后量到窄卡 → 直接以 Sheet 亮出审阅栏，而不是列消失、Sheet 也没开（W12 R4）', async () => {
    mqMatches['(min-width: 1280px)'] = true
    class RO {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO)
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 400, height: 600 }) as DOMRect)
    useStudio.getState().revealRightRail()
    expect(useStudio.getState()).toMatchObject({ rightRailOpen: true, rightRailSheetOpen: false, rightRailReveal: true })
    const el = await mount(
      <div>
        <LayoutRightRail />
      </div>,
    )
    expect(useStudio.getState()).toMatchObject({ rightRailColumnFits: false, rightRailSheetOpen: true, rightRailReveal: false })
    expect(el.querySelector('[data-testid="right-rail"][data-presentation="column"]')).toBeNull()
    expect(document.querySelector('[data-testid="right-rail-sheet"] [data-testid="right-rail"]')?.getAttribute('data-presentation')).toBe('sheet')
    await act(async () => root?.unmount())
    root = null
    spy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('多版面卡并存：fits 由活动卡写——非活动窄卡的重测挤不掉宽卡的列；切活动权后按新卡重测（W12 R13-01）', async () => {
    mqMatches['(min-width: 1280px)'] = true
    const roCbs: (() => void)[] = []
    class RO {
      constructor(cb: ResizeObserverCallback) {
        roCbs.push(() => cb([] as never, this as never))
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO)
    // hostB 卡身 400（窄），其余元素 1000
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.dataset.testid === 'hostB' ? 400 : 1000, height: 600 } as DOMRect
    })
    await act(async () => useStudio.setState({ activePanelId: 'layout:a' }))
    const el = await mount(
      <>
        <div data-testid="hostA">
          <LayoutRightRail panelId="layout:a" />
        </div>
        <div data-testid="hostB">
          <LayoutRightRail panelId="layout:b" />
        </div>
      </>,
    )
    const hostA = q(el, '[data-testid="hostA"]')
    const hostB = q(el, '[data-testid="hostB"]')
    // 活动卡 A 量到 1000 → fits=true、A 出列；B 非活动不渲染、且其测量不得写全局 fits
    expect(useStudio.getState().rightRailColumnFits).toBe(true)
    expect(hostA.querySelector('[data-testid="right-rail"][data-presentation="column"]')).not.toBeNull()
    expect(hostB.querySelector('[data-testid="right-rail"]')).toBeNull()
    expect(document.querySelector('[data-testid="right-rail-sheet"]')).toBeNull()
    // 模拟 B 的 RO 重测（修前会把全局 fits 写成 false，A 的列被挤掉）
    await act(async () => roCbs.forEach((cb) => cb()))
    expect(useStudio.getState().rightRailColumnFits).toBe(true)
    expect(hostA.querySelector('[data-testid="right-rail"][data-presentation="column"]')).not.toBeNull()
    // 切活动权到 B → B 重测 400 → fits=false → B 走 Sheet（默认关），A 的列让位
    await act(async () => useStudio.setState({ activePanelId: 'layout:b' }))
    expect(useStudio.getState().rightRailColumnFits).toBe(false)
    expect(el.querySelector('[data-testid="right-rail"][data-presentation="column"]')).toBeNull()
    await act(async () => useStudio.getState().setRightRailSheetOpen())
    expect(document.querySelector('[data-testid="right-rail-sheet"] [data-testid="right-rail"]')).not.toBeNull()
    // 切回 A → 重测 1000 → fits=true、A 列恢复；B 的 Sheet 随之卸下（不再非宿主渲染）
    await act(async () => useStudio.setState({ activePanelId: 'layout:a' }))
    expect(useStudio.getState().rightRailColumnFits).toBe(true)
    expect(hostA.querySelector('[data-testid="right-rail"][data-presentation="column"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="right-rail-sheet"] [data-testid="right-rail"]')).toBeNull()
    spy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('children 优先，其次 rightRailSlot 注册项按 order 渲染，注销即消失', async () => {
    mqMatches['(min-width: 1280px)'] = true
    const off = rightRailSlot.register({ id: 'b', order: 2, render: () => <p data-testid="rail-b">b</p> })
    rightRailSlot.register({ id: 'a', order: 1, render: () => <p data-testid="rail-a">a</p> })
    const el = await mount(<LayoutRightRail />)
    expect(Array.from(el.querySelectorAll('[data-testid^="rail-"]')).map((n) => n.textContent)).toEqual(['a', 'b'])
    expect(el.querySelector('[data-testid="right-rail-empty"]')).toBeNull()
    await act(async () => off())
    expect(Array.from(el.querySelectorAll('[data-testid^="rail-"]')).map((n) => n.textContent)).toEqual(['a'])
    await act(async () => root?.unmount())
    root = null
    const el2 = await mount(
      <LayoutRightRail>
        <p data-testid="rail-child">c</p>
      </LayoutRightRail>,
    )
    expect(el2.querySelector('[data-testid="rail-child"]')).not.toBeNull()
    expect(el2.querySelector('[data-testid="rail-a"]')).toBeNull()
  })
})

describe('slots 注册表（bottomBarActions / rightRail）', () => {
  it('register 返回注销函数；同 id 覆盖；list 按 order；subscribe 每次变化通知', () => {
    const seen: number[] = []
    const unsub = bottomBarActions.subscribe(() => seen.push(bottomBarActions.list().length))
    const off1 = bottomBarActions.register({ id: 'bold', order: 10, render: () => null })
    bottomBarActions.register({ id: 'italic', order: 5, render: () => null })
    expect(bottomBarActions.list().map((i) => i.id)).toEqual(['italic', 'bold'])
    const off1b = bottomBarActions.register({ id: 'bold', order: 1, render: () => null })
    expect(bottomBarActions.list().map((i) => i.id)).toEqual(['bold', 'italic'])
    off1() // 旧句柄已被覆盖：不注销新项
    expect(bottomBarActions.list().map((i) => i.id)).toEqual(['bold', 'italic'])
    off1b()
    expect(bottomBarActions.list().map((i) => i.id)).toEqual(['italic'])
    expect(seen).toEqual([1, 2, 2, 1])
    unsub()
  })
})
