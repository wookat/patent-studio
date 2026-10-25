// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileLayoutToolbar } from '../MobileLayoutToolbar'
import { MobileShell } from '../MobileShell'
import { editorCommands } from '@/components/editor/commands'
import { layoutHistory } from '@/components/workbench/slots'
import { switchToView } from '@/components/workbench/ViewSwitch'
import { useStudio } from '@/store'
import type { ProjectDetail } from '@/lib/types'

/** CodeMirror 在 jsdom 里没有布局；MobileShell 用例只验版面视图 / 工具栏的接线，源码编辑器换成占位 */
vi.mock('@/components/editor/Editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/editor/Editor')>()
  return {
    ...mod,
    Editor: ({ className }: { className?: string }) => <div data-testid="editor-area" className={className} />,
    CodeMirrorEditor: ({ className }: { className?: string }) => <div data-testid="editor" className={className} />,
  }
})

/** 预览 Tab 的 react-pdf 在 jsdom 无 DOMMatrix；本文件不碰预览 */
vi.mock('../MobilePreview', () => ({
  MobilePreview: () => <div data-testid="mobile-preview" />,
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.getState().resetLayoutView()
  useStudio.setState({
    editorView: 'source',
    editorMode: 'edit',
    collabReadonly: false,
    project: null,
    activeBook: 'all',
    mobileTab: 'edit',
    mobileSettingsOpen: false,
    rightRailOpen: true,
    rightRailSheetOpen: false,
    rightRailColumnFits: true,
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
  await act(async () => root!.render(el))
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

const click = (el: HTMLElement, sel: string) => act(async () => el.querySelector<HTMLButtonElement>(sel)!.click())
const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLButtonElement>(sel)!

describe('MobileLayoutToolbar（375 版面底部工具栏，16 §8.2）', () => {
  it('role=toolbar；撤销 / 重做 / B / 插入 / 表格 / 公式 / 审阅栏 各有 aria-label 且 ≥44px（min-h-11 min-w-11）；模式开关已上移顶部（W9）', async () => {
    const el = await mount(<MobileLayoutToolbar mode="edit" />)
    const bar = q(el, '[data-testid="mobile-layout-toolbar"]')
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('版面工具')
    expect(bar.getAttribute('data-mode')).toBe('edit')
    expect(bar.className).toContain('min-h-mobile-topbar')
    expect(bar.className).toContain('pb-[env(safe-area-inset-bottom)]')
    for (const id of ['undo', 'redo', 'bold', 'insert', 'table', 'equation', 'rail']) {
      const b = q(el, `[data-testid="mlt-${id}"]`)
      expect(b.getAttribute('aria-label')).toBeTruthy()
      expect(b.className).toContain('min-h-11')
      expect(b.className).toContain('min-w-11')
    }
    expect(el.querySelector('[data-testid="mode-indicator"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('插入 / 表格 / 公式 只写 store.layoutViewToolbar：点亮 → 再点收起 → 换一个直接切换；每次都回调 onAction', async () => {
    const onAction = vi.fn()
    const el = await mount(<MobileLayoutToolbar mode="edit" onAction={onAction} />)
    const bar = q(el, '[data-testid="mobile-layout-toolbar"]')
    expect(useStudio.getState().layoutViewToolbar).toBe('none')
    await click(el, '[data-testid="mlt-table"]')
    expect(useStudio.getState().layoutViewToolbar).toBe('table')
    expect(bar.getAttribute('data-panel')).toBe('table')
    expect(q(el, '[data-testid="mlt-table"]').getAttribute('aria-pressed')).toBe('true')
    await click(el, '[data-testid="mlt-table"]')
    expect(useStudio.getState().layoutViewToolbar).toBe('none')
    await click(el, '[data-testid="mlt-equation"]')
    await click(el, '[data-testid="mlt-insert"]')
    expect(useStudio.getState().layoutViewToolbar).toBe('insert')
    expect(q(el, '[data-testid="mlt-equation"]').getAttribute('aria-pressed')).toBe('false')
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['table', 'table', 'equation', 'insert'])
    // 外部（D3 `/` 菜单关闭 / 切视图）把面板收起时按钮同步
    await act(async () => useStudio.getState().setLayoutViewToolbar('none'))
    expect(q(el, '[data-testid="mlt-insert"]').getAttribute('aria-pressed')).toBe('false')
  })

  it('readonly：插入 / 表格 / 公式 / 撤销 / 重做 全禁用；模式指示为只读徽标', async () => {
    const el = await mount(<MobileLayoutToolbar mode="readonly" />)
    for (const id of ['insert', 'table', 'equation', 'undo', 'redo']) expect(q(el, `[data-testid="mlt-${id}"]`).disabled).toBe(true)
    expect(q(el, '[data-testid="mobile-layout-toolbar"]').getAttribute('data-mode')).toBe('readonly')
    expect(await violations(el)).toEqual([])
  })

  it('撤销 / 重做 跟 editorCommands 状态（无编辑器 → 禁用），点击调 editorCommands.undo/redo', async () => {
    const undo = vi.spyOn(editorCommands, 'undo').mockReturnValue(true)
    const el = await mount(<MobileLayoutToolbar mode="edit" />)
    expect(q(el, '[data-testid="mlt-undo"]').disabled).toBe(true)
    expect(q(el, '[data-testid="mlt-redo"]').disabled).toBe(true)
    q(el, '[data-testid="mlt-undo"]').click()
    expect(undo).not.toHaveBeenCalled()
  })

  it('版面编辑器注册 layoutHistory 后，撤销 / 重做走 ProseMirror 历史而不是 editorCommands（接受修订不会被源码历史回滚）', async () => {
    const cmUndo = vi.spyOn(editorCommands, 'undo').mockReturnValue(true)
    const pm = { canUndo: vi.fn(() => true), canRedo: vi.fn(() => false), undo: vi.fn(() => true), redo: vi.fn(() => false) }
    const off = layoutHistory.register(pm)
    const onAction = vi.fn()
    const el = await mount(<MobileLayoutToolbar mode="edit" onAction={onAction} />)
    try {
      expect(q(el, '[data-testid="mlt-undo"]').disabled).toBe(false)
      expect(q(el, '[data-testid="mlt-redo"]').disabled).toBe(true)
      await click(el, '[data-testid="mlt-undo"]')
      expect(pm.undo).toHaveBeenCalledTimes(1)
      expect(cmUndo).not.toHaveBeenCalled()
      expect(onAction).toHaveBeenCalledWith('undo')
      pm.canRedo.mockReturnValue(true)
      await act(async () => layoutHistory.notify())
      expect(q(el, '[data-testid="mlt-redo"]').disabled).toBe(false)
      await click(el, '[data-testid="mlt-redo"]')
      expect(pm.redo).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => off())
    }
    // 版面编辑器卸载 → 退回 editorCommands（无源码编辑器 → 禁用）
    expect(q(el, '[data-testid="mlt-undo"]').disabled).toBe(true)
  })

  it('审阅栏开关写 store.rightRailSheetOpen（375 走 Sheet，不碰桌面 rightRailOpen 列）并回调 rail', async () => {
    const onAction = vi.fn()
    const el = await mount(<MobileLayoutToolbar mode="edit" onAction={onAction} />)
    expect(q(el, '[data-testid="mlt-rail"]').getAttribute('aria-pressed')).toBe('false')
    await click(el, '[data-testid="mlt-rail"]')
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(q(el, '[data-testid="mlt-rail"]').getAttribute('aria-pressed')).toBe('true')
    expect(onAction).toHaveBeenCalledWith('rail')
  })
})

describe('MobileShell 编辑 Tab：版面视图 + 底部工具栏接线', () => {
  it('editorView=layout → <LayoutView/> 与 MobileLayoutToolbar 出现、快捷键盘隐藏、源码编辑器保留但 display:none；切回源码恢复（R10 后源码/版面切换由编辑页 ViewSwitch 承担）', async () => {
    useStudio.setState({
      pid: 'p1',
      project: {
        id: 'p1',
        name: 'p1',
        role: 'editor',
      } as unknown as ProjectDetail,
    })
    const el = await mount(<MobileShell />)
    expect(el.querySelector('[data-testid="mobile-editor-view-tabs"]')).toBeNull()
    expect(el.querySelector('[data-testid="mobile-editor-toolbar"]')).toBeNull()
    // 快捷键盘只在编辑器聚焦（输入法弹出）时出现，空闲 chrome = 44 + 56
    expect(el.querySelector('[data-testid="mobile-quick-keys"]')).toBeNull()
    expect(el.querySelector('[data-testid="layout-view"]')).toBeNull()
    expect(el.querySelector('[data-testid="mobile-layout-toolbar"]')).toBeNull()

    await act(async () => switchToView('layout'))
    const lv = el.querySelector('[data-testid="layout-view"]')!
    expect(lv).not.toBeNull()
    expect(lv.getAttribute('data-mode')).toBe('edit')
    expect(lv.querySelectorAll('.ps-paper')).toHaveLength(3)
    expect(el.querySelector('[data-testid="mobile-layout-toolbar"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="mobile-quick-keys"]')).toBeNull()
    expect(q(el, '[data-testid="editor-area"]').classList.contains('hidden')).toBe(true)
    expect(await violations(el)).toEqual([])

    await act(async () => useStudio.getState().setActiveBook('claims'))
    expect(el.querySelector('[data-testid="layout-view"]')?.querySelectorAll('.ps-paper')).toHaveLength(1)

    await act(async () => switchToView('source'))
    expect(el.querySelector('[data-testid="layout-view"]')).toBeNull()
    expect(el.querySelector('[data-testid="mobile-layout-toolbar"]')).toBeNull()
    await act(async () => useStudio.getState().setActiveBook('all'))
    expect(q(el, '[data-testid="editor-area"]').classList.contains('hidden')).toBe(false)
  })

  it('NavDrawer「审阅」页签 / ?c= 深链：openReviewDrawer 关掉 NavDrawer（互斥）后，审阅底部 Sheet 仍在——Sheet 由 MobileShell 常驻挂载而非 NavDrawer 内的 ReviewPanel（23-w12 §4 第二步 375 复验）', async () => {
    useStudio.setState({
      pid: 'p1',
      project: { id: 'p1', name: 'p1', role: 'editor' } as unknown as ProjectDetail,
      reviewDrawerOpen: false,
    })
    const el = await mount(<MobileShell />)
    expect(document.body.querySelector('[data-testid="review-sheet"]')).toBeNull()

    await act(async () => useStudio.getState().openMobileNav('review'))
    await act(async () => {})
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(useStudio.getState().mobileNav.open).toBe(false)
    expect(el.querySelector('[data-testid="review-panel"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="review-sheet"]')).not.toBeNull()

    await act(async () => useStudio.getState().closeReviewDrawer())
    expect(document.body.querySelector('[data-testid="review-sheet"]')).toBeNull()
    await act(async () => useStudio.getState().openReviewDrawer({ commentId: 'c-x' }))
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    expect(document.body.querySelector('[data-testid="review-sheet"]')).not.toBeNull()
  })

  it('viewer：版面视图 mode=readonly，工具栏动作禁用', async () => {
    useStudio.setState({
      pid: 'p1',
      project: {
        id: 'p1',
        name: 'p1',
        role: 'viewer',
      } as unknown as ProjectDetail,
      editorView: 'layout',
    })
    const el = await mount(<MobileShell />)
    expect(el.querySelector('[data-testid="layout-view"]')?.getAttribute('data-mode')).toBe('readonly')
    expect(q(el, '[data-testid="mlt-table"]').disabled).toBe(true)
  })
})
