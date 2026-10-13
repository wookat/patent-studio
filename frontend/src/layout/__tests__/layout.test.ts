// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRESET, LAYOUT_PRESETS, listPresets, presetPanelIds } from '../presets'
import { LAYOUT_STORAGE_PREFIX, clearLayout, dropRetiredPanels, layoutKey, loadLayout, saveLayout } from '../persistence'
import { clearPanels, describePanel, getPanel, listPanels, panelComponents, registerPanel } from '../registry'
import { registerBuiltinPanels, BUILTIN_PANELS } from '../panels'
import { LAYOUT_PRESET_IDS, PANEL_KINDS, RETIRED_PANEL_KINDS, makePanelId, parsePanelId, type DockHandle } from '@/store/layout'
import { useStudio } from '@/store'

// PdfCard → PreviewPane → pdfjs 需要 DOMMatrix，jsdom 没有；这里只测注册表，不渲染 PDF
vi.mock('@/components/preview/PreviewPane', () => ({ PreviewPane: () => null }))

describe('panel id（08 §4）', () => {
  it('kind[:book] 往返；非法 kind / book → null', () => {
    expect(parsePanelId('source:claims')).toEqual({ kind: 'source', book: 'claims' })
    expect(parsePanelId('layout:all')).toEqual({ kind: 'layout', book: 'all' })
    expect(parsePanelId('pdf')).toEqual({ kind: 'pdf', book: null })
    expect(parsePanelId('nope')).toBeNull()
    expect(parsePanelId('source:figures')).toBeNull()
    expect(makePanelId('source', 'abstract')).toBe('source:abstract')
    expect(makePanelId('console', null)).toBe('console')
  })

  it('全部 kind 都有内建定义（terms / oa / import 为真实组件；ai / review 已迁至伴随栏，不再是 dock 面板）', () => {
    expect(Object.keys(BUILTIN_PANELS).sort()).toEqual([...PANEL_KINDS].sort())
    expect((PANEL_KINDS as readonly string[]).includes('ai')).toBe(false)
    expect((PANEL_KINDS as readonly string[]).includes('review')).toBe(false)
    expect([...RETIRED_PANEL_KINDS].sort()).toEqual(['ai', 'review'])
    expect(parsePanelId('review')).toBeNull()
    for (const k of ['terms', 'oa', 'import'] as const) expect(BUILTIN_PANELS[k].component).toBeTypeOf('function')
  })
})

describe('registry', () => {
  beforeEach(() => clearPanels())

  it('registerBuiltinPanels 幂等；panelComponents 键 = kind', () => {
    registerBuiltinPanels()
    registerBuiltinPanels()
    expect(listPanels().map(([k]) => k).sort()).toEqual([...PANEL_KINDS].sort())
    expect(Object.keys(panelComponents()).sort()).toEqual([...PANEL_KINDS].sort())
  })

  it('registerPanel 可覆盖已注册 kind', () => {
    registerBuiltinPanels()
    expect(describePanel('terms')?.title).toBe('术语')
    registerPanel('terms', { ...BUILTIN_PANELS.terms, title: () => '术语表' })
    expect(getPanel('terms')).toBeDefined()
    expect(describePanel('terms')?.title).toBe('术语表')
  })

  it('panelComponents 输出的组件包 PanelErrorBoundary——单卡崩溃不炸宿主', async () => {
    registerPanel('terms', {
      component: () => {
        throw new Error('boom')
      },
      icon: (() => null) as never,
      label: '术语',
      title: () => '术语',
    })
    const Panel = panelComponents().terms
    const { createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () =>
      root.render(
        createElement(Panel, {
          params: { book: null },
          api: { id: 'terms', isActive: true, setActive: () => {}, close: () => {}, setTitle: () => {} },
        }),
      ),
    )
    expect(host.querySelector('[data-testid="panel-error-boundary"]')).not.toBeNull()
    await act(async () => root.unmount())
    host.remove()
    errSpy.mockRestore()
  })

  it('describePanel 给出书维度标题', () => {
    registerBuiltinPanels()
    expect(describePanel('source:claims')?.title).toBe('权利要求书')
    expect(describePanel('source:all')?.title).toBe('全文')
    expect(describePanel('layout:description')?.title).toBe('版面 · 说明书')
    expect(describePanel('bogus')).toBeNull()
  })
})

describe('presets（08 §7.1）', () => {
  it('六个预置都能被 dockview fromJSON 消费：panels 与 grid 叶子一致，activeGroup 存在', () => {
    expect(listPresets().map((p) => p.id)).toEqual([...LAYOUT_PRESET_IDS])
    for (const p of listPresets()) {
      const ids = presetPanelIds(p)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        expect(parsePanelId(id)).not.toBeNull()
        expect(p.layout.panels[id].contentComponent).toBe(parsePanelId(id)!.kind)
      }
      const root = p.layout.grid.root
      expect(root.type).toBe('branch')
      const groups = (root.data as Array<{ data: { id: string; views: string[] } }>).map((l) => l.data)
      expect(groups.map((g) => g.id)).toContain(p.layout.activeGroup)
      expect(groups.flatMap((g) => g.views).sort()).toEqual([...ids].sort())
    }
  })

  it('默认 = ai-assist（源码 | PDF | 术语组 320，AI 在伴随栏）；权利要求书 ↔ 说明书 开对照锁', () => {
    expect(DEFAULT_PRESET).toBe('ai-assist')
    expect(presetPanelIds(LAYOUT_PRESETS['ai-assist'])).toContain('pdf')
    expect(presetPanelIds(LAYOUT_PRESETS['default'])).toEqual(['source:abstract', 'source:claims', 'source:description', 'pdf'])
    expect(presetPanelIds(LAYOUT_PRESETS['three-books'])).toEqual(['source:abstract', 'source:claims', 'source:description'])
    expect(LAYOUT_PRESETS['claims-description'].compareLock).toBe(true)
    expect(LAYOUT_PRESETS.default.compareLock).toBe(false)
    expect(presetPanelIds(LAYOUT_PRESETS['layout-pdf'])).toEqual(['layout:all', 'pdf'])
    expect(presetPanelIds(LAYOUT_PRESETS['review'])).toEqual(['source:all', 'pdf'])
    expect(presetPanelIds(LAYOUT_PRESETS['ai-assist'])).toEqual(expect.arrayContaining(['terms', 'oa']))
    for (const p of listPresets()) for (const id of presetPanelIds(p)) expect(RETIRED_PANEL_KINDS.has(parsePanelId(id)!.kind)).toBe(false)
  })
})

describe('persistence（08 §7.2）', () => {
  beforeEach(() => localStorage.clear())

  it('按案卷分键；save/load 往返；版本不符 → null', () => {
    expect(layoutKey('p1')).toBe(`${LAYOUT_STORAGE_PREFIX}p1`)
    expect(loadLayout('p1')).toBeNull()
    saveLayout('p1', { preset: 'review', compareLock: true, dock: LAYOUT_PRESETS.review.layout })
    const got = loadLayout('p1')
    expect(got?.preset).toBe('review')
    expect(got?.compareLock).toBe(true)
    expect(got?.dock.activeGroup).toBe(LAYOUT_PRESETS.review.layout.activeGroup)
    expect(loadLayout('p2')).toBeNull()
    localStorage.setItem(layoutKey('p1'), JSON.stringify({ ...got, v: 0 }))
    expect(loadLayout('p1')).toBeNull()
    localStorage.setItem(layoutKey('p1'), '{bad json')
    expect(loadLayout('p1')).toBeNull()
  })

  /** W6 之前的「审阅」预置：源码 | PDF | review 单面板组（且 activeGroup 就是 review 组） */
  const legacyReview = (): import('dockview-react').SerializedDockview => ({
    grid: {
      root: {
        type: 'branch',
        size: 700,
        data: [
          { type: 'leaf', size: 450, data: { id: 'g-source', views: ['source:all'], activeView: 'source:all' } },
          { type: 'leaf', size: 330, data: { id: 'g-pdf', views: ['pdf'], activeView: 'pdf' } },
          { type: 'leaf', size: 220, data: { id: 'g-review', views: ['review'], activeView: 'review' } },
        ],
      },
      width: 1000,
      height: 700,
      orientation: 'HORIZONTAL' as import('dockview-react').Orientation.HORIZONTAL,
    },
    panels: {
      'source:all': { id: 'source:all', contentComponent: 'source', params: { book: 'all' }, title: 'content.md' },
      pdf: { id: 'pdf', contentComponent: 'pdf', params: { book: null }, title: 'PDF' },
      review: { id: 'review', contentComponent: 'review', params: { book: null }, title: '审阅' },
    },
    activeGroup: 'g-review',
  })

  it('domain-04：旧布局里的 review 面板读入时丢弃：面板、空组一起删，activeGroup 改指存活组，不抛错', () => {
    saveLayout('p1', { preset: 'review', compareLock: false, dock: legacyReview() })
    const got = loadLayout('p1')
    expect(got).not.toBeNull()
    expect(Object.keys(got!.dock.panels).sort()).toEqual(['pdf', 'source:all'])
    const leaves = got!.dock.grid.root.data as Array<{ data: { id: string; views: string[] } }>
    expect(leaves.map((l) => l.data.id)).toEqual(['g-source', 'g-pdf'])
    expect(leaves.every((l) => l.data.views.length > 0)).toBe(true)
    expect(got!.dock.activeGroup).toBe('g-source')
    expect(got!.preset).toBe('review')
  })

  it('domain-04：同组 tab 里的 review / ai 只剔自己，activeView 回到存活 tab；全是已下线面板 → null（回默认预置）', () => {
    const dock = legacyReview()
    dock.grid.root.data = [
      { type: 'leaf', size: 700, data: { id: 'g-ai', views: ['terms', 'ai', 'review'], activeView: 'review' } },
    ]
    dock.panels = {
      terms: { id: 'terms', contentComponent: 'terms', params: { book: null }, title: '术语' },
      ai: { id: 'ai', contentComponent: 'ai', params: { book: null }, title: 'AI' },
      review: dock.panels.review,
    }
    dock.activeGroup = 'g-ai'
    const pruned = dropRetiredPanels(dock)!
    expect(Object.keys(pruned.panels)).toEqual(['terms'])
    const g = (pruned.grid.root.data as Array<{ data: { views: string[]; activeView?: string } }>)[0].data
    expect(g.views).toEqual(['terms'])
    expect(g.activeView).toBe('terms')
    expect(pruned.activeGroup).toBe('g-ai')

    const only = legacyReview()
    only.grid.root.data = [{ type: 'leaf', size: 700, data: { id: 'g-review', views: ['review'], activeView: 'review' } }]
    only.panels = { review: only.panels.review }
    expect(dropRetiredPanels(only)).toBeNull()
    saveLayout('p3', { preset: 'review', compareLock: false, dock: only })
    expect(loadLayout('p3')).toBeNull()
  })

  it('domain-04：没有已下线面板时原样返回（当前六个预置都不变）', () => {
    for (const p of listPresets()) expect(dropRetiredPanels(p.layout)).toBe(p.layout)
  })

  it('clearLayout 只清本案', () => {
    saveLayout('a', { preset: 'default', compareLock: false, dock: LAYOUT_PRESETS.default.layout })
    saveLayout('b', { preset: 'default', compareLock: false, dock: LAYOUT_PRESETS.default.layout })
    clearLayout('a')
    expect(loadLayout('a')).toBeNull()
    expect(loadLayout('b')).not.toBeNull()
  })
})

describe('store.layout slice（08 §5）', () => {
  const calls: string[] = []
  const handle: DockHandle = {
    openPanel: (id, o) => calls.push(`open:${id}:${JSON.stringify(o ?? {})}`),
    closePanel: (id) => calls.push(`close:${id}`),
    focusPanel: (id) => calls.push(`focus:${id}`),
    focusNext: (d) => calls.push(`next:${d}`),
    toggleMaximize: (id) => calls.push(`max:${id ?? ''}`),
    applyPreset: (id) => calls.push(`preset:${id}`),
    resetLayout: () => calls.push('reset'),
    panelIds: () => [],
    isPanelVisible: () => true,
  }
  beforeEach(() => {
    calls.length = 0
    useStudio.getState().registerDock(null)
    useStudio.setState({ activeBook: 'all', compareLock: false, layoutPreset: 'default', mobileTab: 'edit' })
  })

  it('有 dock：动作转交 handle；applyPreset / resetLayout 同步 layoutPreset', () => {
    const s = useStudio.getState()
    s.registerDock(handle)
    s.openPanel('source:claims', { replace: 'source:abstract' })
    s.applyPreset('three-books')
    expect(useStudio.getState().layoutPreset).toBe('three-books')
    s.setCompareLock(true)
    s.resetLayout()
    expect(useStudio.getState().layoutPreset).toBe('ai-assist')
    expect(useStudio.getState().compareLock).toBe(false)
    s.focusNextPanel(-1)
    s.toggleMaximize()
    expect(calls).toEqual(['open:source:claims:{"replace":"source:abstract"}', 'preset:three-books', 'reset', 'next:-1', 'max:'])
  })

  it('无 dock（移动壳）：openPanel 退化为 tab / activeBook / 抽屉', () => {
    const s = useStudio.getState()
    s.openPanel('source:description')
    expect(useStudio.getState().activeBook).toBe('description')
    expect(useStudio.getState().mobileTab).toBe('edit')
    s.openPanel('pdf')
    expect(useStudio.getState().mobileTab).toBe('preview')
    expect(useStudio.getState().mobilePreviewKind).toBe('pdf')
    s.openPanel('layout:claims')
    expect(useStudio.getState().mobilePreviewKind).toBe('layout')
    expect(useStudio.getState().activeBook).toBe('claims')
    s.openPanel('outline')
    expect(useStudio.getState().mobileNav).toEqual({ open: true, tab: 'outline' })
    expect(calls).toEqual([])
  })

  it('setActivePanel 从源码 / 结构卡片 id 推导 activeBook', () => {
    const s = useStudio.getState()
    s.registerDock(handle)
    s.setActivePanel('source:abstract')
    expect(useStudio.getState().activeBook).toBe('abstract')
    s.setActivePanel('pdf')
    expect(useStudio.getState().activeBook).toBe('abstract')
    s.registerDock(null)
    expect(useStudio.getState().activePanelId).toBeNull()
  })

  it('setActivePanel 用活动卡片覆盖残留的 editorView（刷新恢复 dock 版面卡 + 持久化 editorView:source → 只剩一种审阅栏）', () => {
    const s = useStudio.getState()
    s.registerDock(handle)
    useStudio.setState({ editorView: 'source' })
    s.setActivePanel('layout:description')
    expect(useStudio.getState().editorView).toBe('layout')
    expect(useStudio.getState().activeBook).toBe('description')
    s.setActivePanel('source:claims')
    expect(useStudio.getState().editorView).toBe('source')
    s.setActivePanel('pdf')
    expect(useStudio.getState().editorView).toBe('source')
  })
})
