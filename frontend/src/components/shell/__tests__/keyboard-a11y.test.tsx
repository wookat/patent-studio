// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchHotkey, HOTKEYS, matchHotkey } from '@/lib/hotkeys'
import { bindLayoutHotkeys, layoutHotkeyMap } from '@/lib/layoutShortcuts'
import { SectionHeader } from '@/components/outline/TreeRow'
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog'
import { StoreBootstrap } from '@/components/shell/StoreBootstrap'
import { PageChrome } from '@/components/shell/PageChrome'
import { useStudio, type DockHandle } from '@/store'

/**
 * W12 第十八轮（读屏 / 键盘可达性）回归：
 * R18-01/02 编辑器焦点逃逸——Mod-PageUp/Down 在 Chrome/Edge 是浏览器级切标签键、keydown 不派发给页面
 * （测试 agent 真 Chrome 实测「按了没反应」）；修法 = 加 F6 / Shift-F6 面板轮转（可捕获、编辑器内也生效）。
 * R18-03 折叠 chevron 无显式可访问名。
 * R18-04 无「跳到主内容」skip link。
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  useStudio.getState().registerDock(null)
  useStudio.setState({ dialog: null, compareLock: false, activePanelId: null })
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })

function fakeDock(): DockHandle & { calls: string[] } {
  const calls: string[] = []
  const rec = (n: string) => (...a: unknown[]) => void calls.push([n, ...a.filter((x) => x !== undefined).map(String)].join(' '))
  return {
    calls,
    openPanel: rec('open'),
    closePanel: rec('close'),
    focusPanel: rec('focus'),
    focusNext: rec('next'),
    toggleMaximize: rec('max'),
    applyPreset: rec('preset'),
    resetLayout: rec('reset'),
    panelIds: () => [],
    isPanelVisible: () => true,
  }
}

describe('R18-01/02：编辑器焦点逃逸键（F6 / Shift-F6）', () => {
  it('matchHotkey 命中 F6 / Shift-F6，且不与 Mod-PageDown 串键', () => {
    expect(HOTKEYS.nextPanelGroup).toBe('F6')
    expect(HOTKEYS.prevPanelGroup).toBe('Shift-F6')
    expect(matchHotkey(keydown('F6'), 'nextPanelGroup')).toBe(true)
    expect(matchHotkey(keydown('F6', { shiftKey: true }), 'prevPanelGroup')).toBe(true)
    // 反向不命中：F6 不算 Mod-PageDown，Shift-F6 不算 nextPanelGroup
    expect(matchHotkey(keydown('F6'), 'nextPanel')).toBe(false)
    expect(matchHotkey(keydown('F6', { shiftKey: true }), 'nextPanelGroup')).toBe(false)
  })

  it('编辑器内（.cm-content 里的 target）F6 仍派发到 focusNext——编辑区守卫只挡 ?/undo/redo', () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    const unbind = bindLayoutHotkeys()

    const cm = document.createElement('div')
    cm.className = 'cm-content'
    const inner = document.createElement('span')
    cm.appendChild(inner)
    document.body.appendChild(cm)

    const e = keydown('F6')
    // StoreBootstrap 的编辑区守卫只拦 ?/undo/redo：F6 位于 .cm-content 内也不在豁免列表里
    expect(inner.closest('input,textarea,select,[contenteditable="true"],.cm-content')).not.toBeNull()
    expect(dispatchHotkey(e)).toBe(true)
    expect(e.defaultPrevented).toBe(true)
    expect(dock.calls).toEqual(['next 1'])

    const back = keydown('F6', { shiftKey: true })
    expect(dispatchHotkey(back)).toBe(true)
    expect(dock.calls).toEqual(['next 1', 'next -1'])
    unbind()
    cm.remove()
  })

  it('layoutHotkeyMap 的 F6 对与 Mod-PageDown 对同一落点', () => {
    const dock = fakeDock()
    useStudio.getState().registerDock(dock)
    const map = layoutHotkeyMap()
    map.nextPanelGroup!()
    map.prevPanelGroup!()
    expect(dock.calls).toEqual(['next 1', 'next -1'])
  })
})

describe('R18-03：SectionHeader 可访问名', () => {
  it('button 带 aria-label「展开/折叠 + 标题」，方向词先行', async () => {
    const el = await mount(
      <div>
        <SectionHeader title="案卷文件" collapsed={false} onToggle={() => {}} controls="a" testId="h1" />
        <SectionHeader title="文档大纲" collapsed onToggle={() => {}} controls="b" testId="h2" />
      </div>,
    )
    const [open, closed] = el.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')
    expect(open.getAttribute('aria-label')).toBe('折叠案卷文件')
    expect(closed.getAttribute('aria-label')).toBe('展开文档大纲')
  })
})

describe('R18-04：skip link「跳到主内容」', () => {
  it('PageChrome：skip link 指向 #main-content，main 带 id + tabIndex=-1', async () => {
    const el = await mount(
      <PageChrome name="t" title="测试页">
        <p>body</p>
      </PageChrome>,
    )
    const skip = el.querySelector<HTMLAnchorElement>('a[href="#main-content"]')!
    expect(skip).not.toBeNull()
    expect(skip.textContent).toContain('跳到主内容')
    const main = el.querySelector('main#main-content')!
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('R19-01 回归：激活 skip link 不改 hash（hash router 不会被传送到 dashboard），焦点落 main', async () => {
    const el = await mount(
      <PageChrome name="t" title="测试页">
        <p>body</p>
      </PageChrome>,
    )
    const skip = el.querySelector<HTMLAnchorElement>('a[href="#main-content"]')!
    skip.focus()
    const before = window.location.hash
    await act(async () => skip.click())
    expect(window.location.hash).toBe(before)
    expect(document.activeElement).toBe(el.querySelector('main#main-content'))
  })
})

describe('R18：ShortcutsDialog 展示面板焦点导航键位', () => {
  it('含 F6 / Shift+F6 行（real action 渲染，供编辑器内逃逸）', async () => {
    useStudio.setState({ dialog: 'shortcuts' })
    await mount(<ShortcutsDialog />)
    const nav = document.querySelector('[data-testid="shortcuts-dockview-nav"]')!
    const text = nav.textContent!
    expect(text).toContain('焦点移到下一个面板')
    const kbds = Array.from(nav.querySelectorAll('kbd')).map((k) => k.textContent)
    expect(kbds).toEqual(['F6', 'Shift+F6'])
  })
})

describe('R52 快捷键守卫与接线', () => {
  beforeEach(() => {
    // anon hint → StoreBootstrap 不发 me/bootstrap，只装键位监听
    localStorage.setItem('patent-studio:auth-anon', '1')
    useStudio.setState({ outlineOpen: true, settingsOpen: false, bottomOpen: false, editorHandle: null })
  })
  afterEach(() => localStorage.removeItem('patent-studio:auth-anon'))

  it('R52-01 原生输入控件内 Mod-b / Mod-, 不触发全局动作；编辑器与空白区照旧', async () => {
    await mount(
      <div>
        <input data-testid="f" />
        <StoreBootstrap />
      </div>,
    )
    const input = document.querySelector<HTMLInputElement>('[data-testid="f"]')!
    input.dispatchEvent(keydown('b', { ctrlKey: true }))
    expect(useStudio.getState().outlineOpen).toBe(true)
    input.dispatchEvent(keydown(',', { ctrlKey: true }))
    expect(useStudio.getState().settingsOpen).toBe(false)
    // Esc 例外保留：输入框内仍逐层关弹层
    useStudio.setState({ settingsOpen: true })
    input.dispatchEvent(keydown('Escape'))
    expect(useStudio.getState().settingsOpen).toBe(false)
    // 编辑器语境不变：.cm-content 内 Mod-b 仍切侧栏
    const cm = document.createElement('div')
    cm.className = 'cm-content'
    document.body.appendChild(cm)
    cm.dispatchEvent(keydown('b', { ctrlKey: true }))
    expect(useStudio.getState().outlineOpen).toBe(false)
    document.body.dispatchEvent(keydown('b', { ctrlKey: true }))
    expect(useStudio.getState().outlineOpen).toBe(true)
  })

  it('R52-02 Mod-h 替换键接到 openSearch（速查表不再是死键）', async () => {
    const openSearch = vi.fn()
    useStudio.setState({ editorHandle: { openSearch } as never })
    await mount(<StoreBootstrap />)
    document.body.dispatchEvent(keydown('h', { ctrlKey: true }))
    expect(openSearch).toHaveBeenCalled()
  })

  it('R52-03 IME 组合期（isComposing）不触发全局动作', async () => {
    await mount(<StoreBootstrap />)
    document.body.dispatchEvent(keydown('b', { ctrlKey: true, isComposing: true }))
    expect(useStudio.getState().outlineOpen).toBe(true)
  })
})

describe('R56-02 ?focus=<block_id> 深链消费', () => {
  beforeEach(() => {
    localStorage.setItem('patent-studio:auth-anon', '1')
    useStudio.setState({ focusRequest: null, dockHandle: null })
  })
  afterEach(() => {
    localStorage.removeItem('patent-studio:auth-anon')
    window.location.hash = '#/'
    useStudio.setState({ focusRequest: null, pid: null, project: null, ast: null, astPid: null })
  })

  it('到达即挂起 + 清 query；案与 AST 就绪 → preflightLocate 定位（setFocus/scroll 走统一链）', async () => {
    const { SYNTH_AST, SYNTH_MD } = await import('@/lib/__tests__/astFixture')
    window.location.hash = '#/p/method?focus=claims/2'
    // 案未就绪时：先挂起
    useStudio.setState({ pid: 'method', project: { id: 'method' } as never, projectLoading: false, ast: null, astPid: null, astLoading: true, content: SYNTH_MD })
    await mount(<StoreBootstrap />)
    await act(async () => {})
    expect(useStudio.getState().focusRequest).toEqual({ pid: 'method', blockId: 'claims/2' })
    expect(window.location.hash).toBe('#/p/method')
    // AST 就绪 → 消费：setFocus(claims/2) + activeBlock
    await act(async () => useStudio.setState({ ast: SYNTH_AST, astPid: 'method', astLoading: false }))
    await act(async () => {})
    const s = useStudio.getState()
    expect(s.focusRequest).toBeNull()
    expect(s.focus?.blockId).toBe('claims/2')
    expect(s.activeBlock?.id).toBe('claims/2')
  })

  it('?focus=<失效块id>：AST 就绪后 toast 反馈不静默落空（R115 批13）；书根 id 不误报', async () => {
    const { SYNTH_AST, SYNTH_MD } = await import('@/lib/__tests__/astFixture')
    window.location.hash = '#/p/method?focus=description/p9999'
    useStudio.setState({ pid: 'method', project: { id: 'method' } as never, projectLoading: false, ast: null, astPid: null, astLoading: true, content: SYNTH_MD })
    await mount(<StoreBootstrap />)
    await act(async () => {})
    await act(async () => useStudio.setState({ ast: SYNTH_AST, astPid: 'method', astLoading: false }))
    await act(async () => {})
    const s = useStudio.getState()
    expect(s.focusRequest).toBeNull()
    expect(s.focus?.blockId).not.toBe('description/p9999')
    expect(s.toasts.some((t) => t.text.includes('定位目标不存在或已变更'))).toBe(true)
    // 书根 id 是合法目标（大纲节点 + PDF 页眉锚），不再 toast
    await act(async () => useStudio.setState({ focusRequest: { pid: 'method', blockId: 'claims' } }))
    await act(async () => {})
    expect(useStudio.getState().toasts.filter((t) => t.text.includes('定位目标不存在'))).toHaveLength(1)
  })
})
