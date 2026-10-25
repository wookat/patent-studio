// @vitest-environment jsdom
import axe from 'axe-core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import DockviewHost from '../DockviewHost'
import { withTitles } from '../dockHandle'
import { LAYOUT_PRESETS, presetPanelIds } from '../presets'
import { LAYOUT_SAVE_DEBOUNCE_MS, layoutKey, loadLayout, saveLayout } from '../persistence'
import { getPanel } from '../registry'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio, type DockHandle } from '@/store'

// pdf.js（canvas / DOMMatrix）进不了 jsdom；PDF 卡片只需占位即可
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

/**
 * DockviewHost（08 §2 / §5 / §7）：真 DockviewReact + 真注册表挂载；DockHandle 注册 / 卸载；
 * openPanel position / replace / floating；预置切换；按案卷持久化与损坏回退；活动面板事件；旧 ui.layout 三态；axe 冒烟。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
  useStudio.setState({ pid: 'method', layout: 'split', layoutPreset: 'default', compareLock: false, activePanelId: null, companion: null })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.useRealTimers()
})

async function mount() {
  host = document.createElement('main')
  host.style.width = '1200px'
  host.style.height = '800px'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <TooltipProvider>
        <DockviewHost />
      </TooltipProvider>,
    ),
  )
  return host
}

function dock(): DockHandle {
  const d = useStudio.getState().dockHandle
  if (!d) throw new Error('dock 未注册')
  return d
}

const tabIds = (el: Element) =>
  [...el.querySelectorAll('[role="tab"] [data-testid^="tab-"]')].map((t) => t.getAttribute('data-testid')!.replace(/^tab-/, ''))
const ids = (p: keyof typeof LAYOUT_PRESETS) => presetPanelIds(LAYOUT_PRESETS[p]).sort()
const maximized = (el: Element) => el.querySelector('[data-testid="group-actions"] [aria-label^="还原 "]') !== null

async function flushTimers(ms = LAYOUT_SAVE_DEBOUNCE_MS + 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('DockviewHost', () => {
  it('dock-host 带 isolate——把 sash z-99 收进容器内，portal 弹层/抽屉（z-popover）不被压（R47-01）', async () => {
    const el = await mount()
    const hostEl = el.querySelector('[data-testid="dock-host"]')!
    expect(hostEl.className).toContain('isolate')
  })

  it('挂载即注册内建面板与 DockHandle，装入默认预置；tab 带图标 + 注册表标题；卸载 registerDock(null)', async () => {
    const el = await mount()
    expect(getPanel('source')).toBeDefined()
    expect(getPanel('terms')).toBeDefined()
    expect(dock().panelIds().sort()).toEqual(ids('ai-assist'))
    expect(tabIds(el)).toEqual(['source:abstract', 'source:claims', 'source:description', 'pdf'])
    // R1：无持久化布局时伴随栏默认开 Agent；术语 / OA 经竖栏可达，不常驻 dock
    expect(useStudio.getState().companion).toBe('ai')
    const claims = el.querySelector('[data-testid="tab-source:claims"]')!
    expect(claims.querySelector('svg.studio-tab-icon')).not.toBeNull()
    expect(claims.textContent).toContain('权利要求书')
    expect(claims.querySelector('[data-testid="close-tab"]')?.getAttribute('title')).toBe('关闭 权利要求书')
    expect(el.querySelector('.dockview-theme-studio')).not.toBeNull()
    expect(useStudio.getState().activePanelId).toBe('source:description')

    await act(async () => root!.unmount())
    root = null
    expect(useStudio.getState().dockHandle).toBeNull()
    expect(useStudio.getState().activePanelId).toBeNull()
  })

  it('openPanel：已存在 → 聚焦；position → 相邻分屏；replace → 原位替换；floating → 浮动组；未注册 id 忽略', async () => {
    const el = await mount()
    const api = dock()
    act(() => api.openPanel('source:abstract'))
    expect(useStudio.getState().activePanelId).toBe('source:abstract')

    act(() => api.openPanel('layout:claims', { position: { referencePanel: 'pdf', direction: 'below' } }))
    expect(api.panelIds()).toContain('layout:claims')
    expect(el.querySelector('[data-testid="tab-layout:claims"]')?.textContent).toContain('版面 · 权利要求书')

    act(() => api.openPanel('source:all', { replace: 'source:abstract' }))
    expect(api.panelIds()).not.toContain('source:abstract')
    expect(tabIds(el).indexOf('source:all')).toBe(0)

    act(() => api.openPanel('outline', { floating: true }))
    expect(api.panelIds()).toContain('outline')
    expect(el.querySelector('.dv-resize-container [data-testid="tab-outline"]')).not.toBeNull()

    const before = api.panelIds()
    act(() => api.openPanel('nope:x' as never))
    expect(api.panelIds()).toEqual(before)

    act(() => api.closePanel('outline'))
    expect(api.panelIds()).not.toContain('outline')
  })

  it('focusPanel / focusNext / toggleMaximize 走 dockview api 并回写 activePanelId', async () => {
    await mount()
    const api = dock()
    act(() => api.focusPanel('pdf'))
    expect(useStudio.getState().activePanelId).toBe('pdf')
    act(() => api.focusNext(1))
    expect(useStudio.getState().activePanelId).toBe('source:abstract')
    act(() => api.focusNext(-1))
    expect(useStudio.getState().activePanelId).toBe('pdf')
    act(() => api.toggleMaximize('source:claims'))
    expect(useStudio.getState().activePanelId).toBe('source:claims')
    expect(maximized(host)).toBe(true)
    act(() => api.toggleMaximize())
    expect(maximized(host)).toBe(false)
  })

  it('applyPreset 六个预置往返 + store 元数据；resetLayout 清持久化回默认', async () => {
    vi.useFakeTimers()
    const el = await mount()
    const s = useStudio.getState()
    for (const id of ['three-books', 'claims-description', 'layout-pdf', 'review', 'ai-assist', 'default'] as const) {
      act(() => s.applyPreset(id))
      expect(dock().panelIds().sort()).toEqual(ids(id))
      expect(useStudio.getState().layoutPreset).toBe(id)
      expect(useStudio.getState().compareLock).toBe(LAYOUT_PRESETS[id].compareLock)
    }
    act(() => s.applyPreset('three-books'))
    await flushTimers()
    expect(loadLayout('method')?.preset).toBe('three-books')
    expect(tabIds(el)).toEqual(['source:abstract', 'source:claims', 'source:description'])

    act(() => s.resetLayout())
    expect(localStorage.getItem(layoutKey('method'))).toBeNull()
    expect(dock().panelIds().sort()).toEqual(ids('ai-assist'))
    expect(useStudio.getState().layoutPreset).toBe('ai-assist')
  })

  it('布局变化 300ms 防抖落盘；再次挂载按案卷恢复；切案卷先落盘旧案', async () => {
    vi.useFakeTimers()
    await mount()
    act(() => dock().openPanel('console', { position: { referencePanel: 'pdf', direction: 'below' } }))
    expect(loadLayout('method')).toBeNull()
    await flushTimers()
    const stored = loadLayout('method')
    expect(stored?.v).toBe(1)
    expect(Object.keys(stored!.dock.panels).sort()).toEqual([...ids('ai-assist'), 'console'].sort())

    act(() => useStudio.setState({ pid: 'system' }))
    expect(dock().panelIds().sort()).toEqual(ids('ai-assist'))
    act(() => dock().openPanel('outline', { floating: true }))
    act(() => useStudio.setState({ pid: 'method' }))
    expect(loadLayout('system')?.dock.floatingGroups?.length).toBe(1)
    expect(dock().panelIds()).toContain('console')

    await act(async () => root!.unmount())
    root = null
    host.remove()
    await mount()
    expect(dock().panelIds()).toContain('console')
  })

  it('R1：已有持久化布局 → 不开默认伴随栏（不覆盖用户已存布局）；深链 ?panel= 不被默认 Agent 抢', async () => {
    saveLayout('method', { preset: 'default', compareLock: false, dock: LAYOUT_PRESETS.default.layout })
    await mount()
    expect(dock().panelIds().sort()).toEqual(ids('default'))
    expect(useStudio.getState().companion).toBeNull()
    await act(async () => root!.unmount())
    root = null
    host.remove()

    window.location.hash = '#/p/method?panel=terms'
    await mount()
    // CompanionHost 的 hash 同步负责 openCompanion('terms')；dock 侧不能先写 ai 把它覆盖掉
    expect(useStudio.getState().companion).toBeNull()
    expect(window.location.hash).toContain('panel=terms')
  })

  it('持久化损坏（非 JSON / 版本不对 / 未注册面板）→ 清掉并回默认', async () => {
    localStorage.setItem(layoutKey('method'), '{not json')
    await mount()
    expect(dock().panelIds().sort()).toEqual(ids('ai-assist'))
    expect(localStorage.getItem(layoutKey('method'))).toBeNull()
    await act(async () => root!.unmount())
    root = null
    host.remove()

    const bad = structuredClone(LAYOUT_PRESETS.review.layout)
    bad.panels['ghost'] = { id: 'ghost', contentComponent: 'ghost', title: 'x' }
    ;(bad.grid.root.data as { data: { views: string[] } }[])[0].data.views.push('ghost')
    saveLayout('method', { preset: 'review', compareLock: true, dock: bad })
    await mount()
    expect(dock().panelIds().sort()).toEqual(ids('ai-assist'))
    expect(useStudio.getState().layoutPreset).toBe('ai-assist')
    expect(useStudio.getState().compareLock).toBe(false)
    expect(localStorage.getItem(layoutKey('method'))).toBeNull()
  })

  it('domain-04：旧持久化布局里的 review dock 面板（W6 审阅预置 JSON）启动时迁移：不报错、不回默认、不留空组，其他面板原样保留', async () => {
    // W6 「审阅」预置：全文源码 | PDF | 审阅（review 独占右侧一组）
    const old = structuredClone(LAYOUT_PRESETS.review.layout)
    old.panels['review'] = { id: 'review', contentComponent: 'review', title: '审阅' }
    ;(old.grid.root.data as { type: string; data: { id: string; views: string[]; activeView: string } }[]).push({
      type: 'leaf',
      data: { id: 'g-review', views: ['review'], activeView: 'review' },
    })
    old.activeGroup = 'g-review'
    saveLayout('method', { preset: 'review', compareLock: false, dock: old })
    const el = await mount()
    // 不回默认（fromJSON 没抛）：预置仍是 review、持久化没被清；不留空组：只剩 源码 | PDF 两组
    expect(dock().panelIds().sort()).toEqual(ids('review'))
    expect(dock().panelIds()).not.toContain('review')
    expect(tabIds(el)).toEqual(['source:all', 'pdf'])
    expect(el.querySelectorAll('.dv-groupview').length).toBe(2)
    expect(useStudio.getState().layoutPreset).toBe('review')
    expect(localStorage.getItem(layoutKey('method'))).not.toBeNull()
  })

  it('旧 ui.layout 三态：editor / preview 最大化源码 / PDF，split 还原；空态给预置按钮', async () => {
    const el = await mount()
    act(() => useStudio.getState().setLayout('preview'))
    expect(useStudio.getState().activePanelId).toBe('pdf')
    expect(maximized(el)).toBe(true)
    act(() => useStudio.getState().setLayout('editor'))
    expect(useStudio.getState().activePanelId?.startsWith('source:')).toBe(true)
    expect(maximized(el)).toBe(true)
    act(() => useStudio.getState().setLayout('split'))
    expect(maximized(el)).toBe(false)

    for (const id of dock().panelIds()) act(() => dock().closePanel(id))
    expect(el.querySelector('[data-testid="dock-empty"]')).not.toBeNull()
    await act(async () => (el.querySelector('[data-testid="dock-empty-layout-pdf"]') as HTMLButtonElement).click())
    expect(dock().panelIds().sort()).toEqual(ids('layout-pdf'))
  })

  it('ui.settingsOpen ↔ settings 面板：打开 = 源码组加「排版设置」tab；关 tab → settingsOpen=false；toggleSettings(false) → 移除', async () => {
    const el = await mount()
    const api = dock()
    expect(api.panelIds()).not.toContain('settings')
    act(() => useStudio.getState().toggleSettings(true))
    expect(api.panelIds()).toContain('settings')
    expect(useStudio.getState().activePanelId).toBe('settings')
    const tab = el.querySelector('[data-testid="tab-settings"]')!
    expect(tab.textContent).toContain('排版设置')
    // 与源码 tab 同组（旧双栏里设置替换编辑器区）
    const tablist = tab.closest('.dv-tabs-and-actions-container')!
    expect(tablist.querySelector('[data-testid="tab-source:description"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="settings-panel"]')).not.toBeNull()

    act(() => api.closePanel('settings'))
    expect(useStudio.getState().settingsOpen).toBe(false)

    act(() => useStudio.getState().toggleSettings(true))
    expect(api.panelIds()).toContain('settings')
    act(() => useStudio.getState().toggleSettings(false))
    expect(api.panelIds()).not.toContain('settings')
  })

  it('W12 R7-03：经 openPanel(settings)（视图▾ 打开为新面板）加入的设置面板回写 settingsOpen=true——面板内「关闭设置」→ toggleSettings(false) 才能真的关掉', async () => {
    const el = await mount()
    const api = dock()
    expect(useStudio.getState().settingsOpen).toBe(false)
    act(() => useStudio.getState().openPanel('settings', { position: { referencePanel: 'pdf', direction: 'right' } }))
    expect(api.panelIds()).toContain('settings')
    expect(useStudio.getState().settingsOpen).toBe(true)
    const close = el.querySelector<HTMLButtonElement>('[data-testid="settings-close"]')!
    expect(close).not.toBeNull()
    act(() => close.click())
    expect(useStudio.getState().settingsOpen).toBe(false)
    expect(api.panelIds()).not.toContain('settings')
  })

  it('withTitles 按注册表重算标题', () => {
    const out = withTitles(LAYOUT_PRESETS.review.layout)
    expect(out.panels['source:all'].title).toBe('全文')
    expect(out.panels['review']).toBeUndefined()
    expect(withTitles(LAYOUT_PRESETS['ai-assist'].layout).panels['pdf'].title).toBe('PDF')
  })

  it('axe 冒烟：默认 / 三书对照 / 浮动面板下无违规', async () => {
    const el = await mount()
    const run = async () => {
      const res = await axe.run(el, {
        resultTypes: ['violations'],
        rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
      })
      // dockview 8.2 上游：浮动容器 role=dialog 上写 aria-level（AriaLevelTracker），非本仓库标记
      const upstream = (id: string, target: string) => target === '.dv-resize-container' && id.startsWith('aria-')
      return res.violations
        .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')).filter((t) => !upstream(v.id, t)) }))
        .filter((v) => v.targets.length > 0)
        .map((v) => `${v.id}: ${v.targets.join(', ')}`)
    }
    expect(await run()).toEqual([])
    act(() => useStudio.getState().applyPreset('three-books'))
    expect(await run()).toEqual([])
    act(() => dock().openPanel('outline', { floating: true }))
    expect(await run()).toEqual([])
  })
})
