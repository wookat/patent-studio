// @vitest-environment jsdom
import axe from 'axe-core'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutMenuItems } from '../LayoutMenuItems'
import { ShortcutsDialog } from '../ShortcutsDialog'
import { hotkeyLabel } from '@/lib/hotkeys'
import { useStudio, type DockHandle } from '@/store'
import { registerBuiltinPanels } from '@/layout/panels'

// PdfCard → PreviewPane → pdfjs 需要 DOMMatrix，jsdom 没有；菜单只读注册表，不渲染面板
vi.mock('@/components/preview/PreviewPane', () => ({ PreviewPane: () => null }))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  registerBuiltinPanels()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  // Radix 菜单 / 对话框在 jsdom 下需要的桩
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
  useStudio.getState().registerDock(null)
  useStudio.setState({ compareLock: false, activePanelId: null, layoutPreset: 'default', dialog: null })
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

function fakeDock(): DockHandle & { calls: string[] } {
  const calls: string[] = []
  const rec = (n: string) => (...a: unknown[]) => void calls.push([n, ...a.filter((x) => x !== undefined).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)))].join(' '))
  return { calls, openPanel: rec('open'), closePanel: rec('close'), focusPanel: rec('focus'), focusNext: rec('next'), toggleMaximize: rec('max'), applyPreset: rec('preset'), resetLayout: rec('reset'), panelIds: () => [], isPanelVisible: () => true }
}

/** 常开的顶层菜单壳，只为把 LayoutMenuItems 的子菜单渲染出来 */
function Harness() {
  return (
    <DropdownMenuPrimitive.Root open modal={false}>
      <DropdownMenuPrimitive.Trigger>视图</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content aria-label="视图" onCloseAutoFocus={(e) => e.preventDefault()}>
          <LayoutMenuItems />
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const openSub = async (testid: string) => {
  const t = q(`[data-testid="${testid}"]`)!
  await act(async () => {
    t.focus()
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  })
}
/** 选中后 Radix 会关整个菜单，所以每次都从“布局”开始重新展开路径 */
const select = async (...path: string[]) => {
  await openSub('view-layout-presets')
  for (const p of path.slice(0, -1)) await openSub(p)
  const it = q(`[data-testid="${path[path.length - 1]}"]`)!
  await act(async () => {
    it.focus()
    it.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}

describe('视图 › 布局（08 §6.3）', () => {
  beforeEach(() => useStudio.setState({ compareLock: false, activePanelId: null, layoutPreset: 'default' }))

  it('dock 未注册：触发器 aria-disabled', async () => {
    await mount(<Harness />)
    expect(q('[data-testid="view-layout-presets"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('dock 就绪：预置 menuitemradio + 对照锁 menuitemcheckbox + 面板命令带快捷键标签 + 重置；无 axe 违规', async () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    useStudio.setState({ activePanelId: 'source:claims' })
    await mount(<Harness />)
    expect(q('[data-testid="view-layout-presets"]')?.getAttribute('aria-disabled')).toBeNull()
    await openSub('view-layout-presets')
    const sub = q('[role="menu"][aria-label="布局"]')!
    expect(sub).not.toBeNull()
    const radios = sub.querySelectorAll('[role="menuitemradio"]')
    expect(radios.length).toBeGreaterThanOrEqual(4)
    expect(sub.querySelector('[data-testid="view-preset-default"]')?.getAttribute('aria-checked')).toBe('true')
    expect(sub.querySelector('[data-testid="view-compare-lock"]')?.getAttribute('role')).toBe('menuitemcheckbox')
    expect(sub.querySelector('[data-testid="view-compare-lock"]')?.textContent).toContain(hotkeyLabel('compareLock'))
    expect(sub.querySelector('[data-testid="view-panel-next"]')?.textContent).toContain(hotkeyLabel('nextPanel'))
    expect(sub.querySelector('[data-testid="view-panel-maximize"]')?.textContent).toContain(hotkeyLabel('maximizePanel'))
    expect(sub.querySelector('[data-testid="view-panel-close"]')?.textContent).toContain(hotkeyLabel('closePanel'))
    expect(await violations(document.body)).toEqual([])

    await select('view-compare-lock')
    expect(useStudio.getState().compareLock).toBe(true)
    await select('view-panel-next')
    await select('view-panel-maximize')
    await select('view-panel-close')
    await select('view-preset-claims-description')
    await select('view-layout-reset')
    expect(dock.calls).toEqual(['next 1', 'max', 'close source:claims', 'preset claims-description', 'reset'])
    expect(useStudio.getState().layoutPreset).toBe('ai-assist')
    expect(useStudio.getState().compareLock).toBe(false)
  })

  it('打开为新面板：listPanels() 全列（terms 可选；ai 已迁伴随栏不在列），带书 kind 再分 书×视图，落在活动面板右侧', async () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    useStudio.setState({ activePanelId: 'source:all' })
    await mount(<Harness />)
    await openSub('view-layout-presets')
    await openSub('view-open-panel')
    const sub = q('[role="menu"][aria-label="打开为新面板"]')!
    expect(sub).not.toBeNull()
    expect(sub.querySelector('[data-testid="view-open-pdf"]')?.getAttribute('aria-disabled')).toBeNull()
    expect(sub.querySelector('[data-testid="view-open-ai"]')).toBeNull()
    expect(sub.querySelector('[data-testid="view-open-terms"]')?.getAttribute('aria-disabled')).toBeNull()
    expect(sub.querySelector('[data-testid="view-open-source"]')?.getAttribute('aria-haspopup')).toBe('menu')
    expect(await violations(document.body)).toEqual([])

    await openSub('view-open-source')
    const books = q('[role="menu"][aria-label="源码"]')!
    expect([...books.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent)).toEqual(['摘要', '权利要求书', '说明书', '全文'])
    await select('view-open-panel', 'view-open-pdf')
    await select('view-open-panel', 'view-open-source', 'view-open-source-claims')
    expect(dock.calls).toEqual([
      `open pdf ${JSON.stringify({ position: { referencePanel: 'source:all', direction: 'right' } })}`,
      `open source:claims ${JSON.stringify({ position: { referencePanel: 'source:all', direction: 'right' } })}`,
    ])
  })
})

describe('ShortcutsDialog 布局段', () => {
  it('列出五个 R4 快捷键；无 axe 违规', async () => {
    useStudio.setState({ dialog: 'shortcuts' })
    await mount(<ShortcutsDialog />)
    const sec = q('[data-testid="shortcuts-layout"]')!
    expect(sec.getAttribute('role')).toBe('group')
    const kbds = [...sec.querySelectorAll('kbd')].map((k) => k.textContent)
    expect(kbds).toEqual(['nextPanel', 'prevPanel', 'maximizePanel', 'closePanel', 'compareLock'].map((a) => hotkeyLabel(a as 'nextPanel')))
    expect(await violations(document.body)).toEqual([])
  })
})
