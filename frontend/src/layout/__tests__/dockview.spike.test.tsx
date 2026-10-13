// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { LAYOUT_PRESETS } from '../presets'
import { studioTheme } from '../theme'

/**
 * dockview-react 8.2.0 行为固化（docs/plan/08-r4-dockview-design.md §0 证据 E1/E3/E4）：
 * React 19 + jsdom 可挂载；tab 有 ARIA role；预置 JSON 能 fromJSON/toJSON 往返；主题对象可构造。
 * 这里是 D1 的地基断言，不是 UI 走查。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // dockview 用 ResizeObserver 量容器；jsdom 没有
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

const Body = (p: IDockviewPanelProps<{ book: string | null }>) => <div data-testid={`body-${p.api.id}`}>{p.params.book ?? '-'}</div>
const components = Object.fromEntries(
  ['source', 'layout', 'pdf', 'console', 'outline', 'history', 'checks', 'search', 'figures', 'review', 'terms', 'oa'].map((k) => [k, Body]),
)

async function mountDock(onReady: (e: DockviewReadyEvent) => void) {
  host = document.createElement('div')
  host.style.width = '1000px'
  host.style.height = '700px'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<DockviewReact components={components} onReady={onReady} theme={studioTheme(false)} />))
  return host
}

describe('dockview-react 8.2.0 spike', () => {
  it('挂载 + addPanel：tab 暴露 role=tab / aria-selected，内容渲染 params', async () => {
    let api!: DockviewApi
    const el = await mountDock((e) => {
      api = e.api
      api.addPanel({ id: 'source:claims', component: 'source', params: { book: 'claims' }, title: '权利要求书' })
      api.addPanel({ id: 'pdf', component: 'pdf', params: { book: null }, title: 'PDF', position: { referencePanel: 'source:claims', direction: 'right' } })
    })
    await act(async () => {})
    const tabs = el.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(2)
    expect(Array.from(tabs).some((t) => t.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(el.querySelector('[data-testid="body-source:claims"]')?.textContent).toBe('claims')
    expect(api.panels.map((p) => p.id).sort()).toEqual(['pdf', 'source:claims'])
    expect(api.groups.length).toBe(2)
    expect(el.querySelector('.dockview-theme-studio')).not.toBeNull()
  })

  it('全部预置 fromJSON → toJSON 往返：panels 与 activeGroup 一致', async () => {
    let api!: DockviewApi
    await mountDock((e) => {
      api = e.api
    })
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      await act(async () => api.fromJSON(preset.layout))
      const out = api.toJSON()
      expect(Object.keys(out.panels).sort()).toEqual(Object.keys(preset.layout.panels).sort())
      expect(out.activeGroup).toBe(preset.layout.activeGroup)
      for (const [id, p] of Object.entries(out.panels)) expect(p.params).toEqual(preset.layout.panels[id].params)
    }
  })

  it('maximize / 关闭 / 事件', async () => {
    let api!: DockviewApi
    const events: string[] = []
    await mountDock((e) => {
      api = e.api
      api.onDidLayoutChange(() => events.push('layout'))
      api.onDidActivePanelChange((e) => events.push(`active:${e.panel?.id ?? ''}`))
      api.fromJSON(LAYOUT_PRESETS['layout-pdf'].layout)
    })
    await act(async () => {})
    const pdf = api.getPanel('pdf')!
    await act(async () => pdf.api.maximize())
    expect(pdf.api.isMaximized()).toBe(true)
    await act(async () => pdf.api.exitMaximized())
    expect(pdf.api.isMaximized()).toBe(false)
    await act(async () => api.removePanel(pdf))
    expect(api.panels.map((p) => p.id)).toEqual(['layout:all'])
    expect(events.some((e) => e === 'layout')).toBe(true)
    expect(events.some((e) => e.startsWith('active:'))).toBe(true)
  })
})
