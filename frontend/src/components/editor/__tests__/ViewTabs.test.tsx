// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HOTKEYS, dispatchHotkey } from '@/lib/hotkeys'
import { useStudio, type DockHandle } from '@/store'
import { ViewTabs, ViewTabsSegmented, revealView, switchView, viewOfPanel } from '../ViewTabs'
import { THREE_VIEWS, VIEW_LABEL } from '@/components/workbench/viewSwitchPlan'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  useStudio.setState({ editorView: 'source', activePanelId: null, dockHandle: null, activeBook: 'all', mobileTab: 'edit', mobilePreviewKind: 'layout' })
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

function fakeDock(open: string[] = []): DockHandle & { openPanel: ReturnType<typeof vi.fn> } {
  return {
    openPanel: vi.fn(),
    panelIds: () => open,
    isPanelVisible: () => true,
    closePanel: vi.fn(),
    focusPanel: vi.fn(),
    focusNext: vi.fn(),
    toggleMaximize: vi.fn(),
    applyPreset: vi.fn(),
    resetLayout: vi.fn(),
  } as unknown as DockHandle & { openPanel: ReturnType<typeof vi.fn> }
}

function click(el: HTMLElement, sel: string) {
  return act(async () => el.querySelector<HTMLButtonElement>(sel)!.click())
}

describe('ViewTabsSegmented（受控三视图分段）', () => {
  it('三段 源码 / 版面 / PDF，aria-pressed 跟 value；点已选段不触发 onChange；axe 无 serious', async () => {
    const onChange = vi.fn()
    const el = await mount(<ViewTabsSegmented value="layout" onChange={onChange} />)
    const group = el.querySelector('[data-testid="view-tabs"]')!
    expect(group.getAttribute('role')).toBe('group')
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['源码', '版面', 'PDF'])
    expect(el.querySelector('[data-testid="view-tabs-layout"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[data-testid="view-tabs-source"]')?.getAttribute('aria-pressed')).toBe('false')
    await click(el, '[data-testid="view-tabs-layout"]')
    expect(onChange).not.toHaveBeenCalled()
    await click(el, '[data-testid="view-tabs-pdf"]')
    expect(onChange).toHaveBeenCalledWith('pdf')
    expect(await violations(el)).toEqual([])
  })

  it('lg 尺寸给 375：容器 h-touch（44）、按钮 h-md-control（32） + 内边距，无 tooltip 包装', async () => {
    const el = await mount(<ViewTabsSegmented value="source" onChange={() => {}} views={['source', 'layout']} size="lg" tips={false} testId="t" />)
    expect(el.querySelector('[data-testid="t"]')?.className).toContain('h-touch')
    expect(el.querySelectorAll('button')).toHaveLength(2)
    expect(el.querySelector('[data-testid="t-source"]')?.className).toContain('h-md-control')
  })
})

describe('viewOfPanel / switchView（store 接线）', () => {
  it('三视图卡片 id 解析出视图与书；其它卡片 / 无 dock 回退 editorView', () => {
    expect(viewOfPanel('source:claims', 'layout')).toEqual({ view: 'source', book: 'claims', panelId: 'source:claims' })
    expect(viewOfPanel('layout:all', 'source')).toEqual({ view: 'layout', book: 'all', panelId: 'layout:all' })
    expect(viewOfPanel('pdf', 'source')).toEqual({ view: 'pdf', book: null, panelId: 'pdf' })
    expect(viewOfPanel('outline', 'layout')).toEqual({ view: 'layout', book: null, panelId: null })
    expect(viewOfPanel(null, 'source')).toEqual({ view: 'source', book: null, panelId: null })
  })

  it('dock 下原地换卡片：source:claims → 版面 = openPanel(layout:claims, replace)；→ PDF = openPanel(pdf, replace)', () => {
    const dock = fakeDock()
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:claims', activeBook: 'claims' })
    switchView('layout')
    expect(dock.openPanel).toHaveBeenLastCalledWith('layout:claims', { replace: 'source:claims' })
    expect(useStudio.getState().editorView).toBe('layout')
    switchView('pdf', 'source:claims')
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { replace: 'source:claims' })
    expect(useStudio.getState().editorView).toBe('layout')
  })

  it('PDF 卡片切回源码：书取 activeBook；当前已是目标视图则不动 dock', () => {
    const dock = fakeDock()
    useStudio.setState({ dockHandle: dock, activePanelId: 'pdf', activeBook: 'description' })
    switchView('source')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:description', { replace: 'pdf' })
    dock.openPanel.mockClear()
    useStudio.setState({ activePanelId: 'source:description' })
    switchView('source')
    expect(dock.openPanel).not.toHaveBeenCalled()
  })

  it('无 dock（窄桌面 / 移动）：源码 ↔ 版面只改 editorView；PDF 走 openPanel 回退到预览 Tab', () => {
    switchView('layout')
    expect(useStudio.getState().editorView).toBe('layout')
    switchView('source')
    expect(useStudio.getState().editorView).toBe('source')
    switchView('pdf')
    const s = useStudio.getState()
    expect(s.editorView).toBe('source')
    expect(s.mobileTab).toBe('preview')
    expect(s.mobilePreviewKind).toBe('pdf')
  })
})

describe('revealView（PDF 选字 / 大纲 → 指定书的源码或版面卡片；W5 走查 domain-02）', () => {
  it('dock 下目标书卡片已开 → 激活它，不 replace 当前卡片；只有 all 卡片 → 激活 all', () => {
    const dock = fakeDock(['source:description', 'pdf'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'pdf', activeBook: 'description' })
    revealView('source', 'description')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:description', undefined)
    expect(useStudio.getState().editorView).toBe('source')

    const dock2 = fakeDock(['source:all', 'pdf'])
    useStudio.setState({ dockHandle: dock2 })
    revealView('source', 'abstract')
    expect(dock2.openPanel).toHaveBeenLastCalledWith('source:all', undefined)
  })

  it('dock 下目标书未开：有同视图卡片 → 在其 tab 组内新开 source:abstract（不再停在 description）；没有 → 默认位置', () => {
    const dock = fakeDock(['source:description', 'pdf'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'pdf', activeBook: 'description' })
    revealView('source', 'abstract')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:abstract', { position: { referencePanel: 'source:description', direction: 'within' } })

    const dock2 = fakeDock(['pdf'])
    useStudio.setState({ dockHandle: dock2 })
    revealView('layout', 'claims')
    expect(dock2.openPanel).toHaveBeenLastCalledWith('layout:claims', undefined)
    expect(useStudio.getState().editorView).toBe('layout')
  })

  it('无 dock（375）：切 activeBook 到目标书 + 编辑 Tab + editorView', () => {
    useStudio.setState({ activeBook: 'claims', mobileTab: 'preview' })
    revealView('source', 'abstract')
    const s = useStudio.getState()
    expect(s.activeBook).toBe('abstract')
    expect(s.mobileTab).toBe('edit')
    expect(s.editorView).toBe('source')
  })
})

describe('<ViewTabs/>（桌面连接版）', () => {
  it('无 dock 只列 源码 / 版面；有 dock 三段且 value 跟活动卡片；panelId 指定本卡片', async () => {
    const el = await mount(<ViewTabs />)
    expect(el.querySelectorAll('button')).toHaveLength(2)
    const dock = fakeDock()
    await act(async () => useStudio.setState({ dockHandle: dock, activePanelId: 'pdf' }))
    expect(el.querySelectorAll('button')).toHaveLength(3)
    expect(el.querySelector('[data-testid="view-tabs"]')?.getAttribute('data-value')).toBe('pdf')
    await click(el, '[data-testid="view-tabs-layout"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('layout:all', { replace: 'pdf' })
    await act(async () => root!.unmount())
    root = null
    host.remove()

    const el2 = await mount(<ViewTabs panelId="source:claims" />)
    expect(el2.querySelector('[data-testid="view-tabs"]')?.getAttribute('data-value')).toBe('source')
    await click(el2, '[data-testid="view-tabs-pdf"]')
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { replace: 'source:claims' })
    expect(await violations(el2)).toEqual([])
  })

  it('快捷键 Mod-Alt-1/2/3 注册于挂载期，作用于活动卡片；卸载后注销', async () => {
    expect(HOTKEYS.viewSource).toBe('Mod-Alt-1')
    expect(HOTKEYS.viewLayout).toBe('Mod-Alt-2')
    expect(HOTKEYS.viewPdf).toBe('Mod-Alt-3')
    const dock = fakeDock()
    useStudio.setState({ dockHandle: dock, activePanelId: 'source:all' })
    const key = (k: string) => new KeyboardEvent('keydown', { key: k, ctrlKey: true, altKey: true, cancelable: true })
    expect(dispatchHotkey(key('2'))).toBe(false)
    await mount(
      <>
        <ViewTabs panelId="source:all" />
        <ViewTabs panelId="pdf" />
      </>,
    )
    expect(dispatchHotkey(key('2'))).toBe(true)
    expect(dock.openPanel).toHaveBeenLastCalledWith('layout:all', { replace: 'source:all' })
    expect(dispatchHotkey(key('3'))).toBe(true)
    expect(dock.openPanel).toHaveBeenLastCalledWith('pdf', { replace: 'source:all' })
    await act(async () => root!.unmount())
    root = null
    expect(dispatchHotkey(key('1'))).toBe(false)
  })

  it('ShortcutsDialog 列出三条视图快捷键', async () => {
    useStudio.setState({ dialog: 'shortcuts' })
    await mount(<ShortcutsDialog />)
    const text = document.body.textContent ?? ''
    for (const v of THREE_VIEWS) expect(text).toContain(`当前卡片切到${VIEW_LABEL[v]}`.replace('切到PDF', '切到 PDF'))
    expect(text).toContain('Ctrl+Alt+1')
    useStudio.getState().closeDialog()
  })
})
