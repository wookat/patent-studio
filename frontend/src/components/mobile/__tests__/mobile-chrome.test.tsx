// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import { contentSha } from '@/lib/api/net'
import type { Diagnostic, ProjectDetail } from '@/lib/types'
import { useStudio } from '@/store'
import { GlobalErrorBar } from '../GlobalErrorBar'
import { MobileConsole } from '../MobileConsole'
import { MobileEditChrome } from '../MobileEditChrome'
import { MobileTopBar } from '../MobileTopBar'

/**
 * W11 第三批（375 编辑页降密 + 内部信息清扫）：
 *  - GlobalErrorBar：44 高单行（h-11，R11-03 docs/plan/30：邻行满预算时 36 行装不下 44 命中区），位置用「权利要求 N / 说明书 · 段落」字样，不露「第 N 行」/ content.md；「定位」仍按内部行号 gotoLine
 *  - MobileTopBar 副标题只剩 案号 · 保存态（视图 / 书由紧邻的 ViewSwitch / BookSwitcher 表达，不重复）
 *  - MobileEditChrome 固定 44（h-mobile-topbar），ViewSwitch md 三段等宽
 *  - MobileConsole 单头行 44：Segmented + 问题 tab 动作同一行，不再叠标题行
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState(initial, true)
  useStudio.setState({
    pid: 'p1',
    project: { id: 'p1', name: '一种方法', role: 'owner', case: { case_no: 'ZL-2026-001' } } as unknown as ProjectDetail,
    mobileTab: 'edit',
    activeBook: 'claims',
    content: SYNTH_MD,
    ast: SYNTH_AST,
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}
const q = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)

const diag = (id: string, line: number | null, message: string): Diagnostic =>
  ({ id, severity: 'error', code: 'x', message, line, source: 'lint' }) as Diagnostic

describe('GlobalErrorBar（375 顶部错误条）', () => {
  it('单行 44（h-11），位置字样「权利要求 4」，不露行号 / content.md；整条点开控制台错误 tab', async () => {
    useStudio.setState({ items: [diag('e1', 15, '前向引用'), diag('e2', 44, '标记不一致')] })
    const openConsole = vi.fn()
    useStudio.setState({ openConsole } as never)
    const el = await mount(<GlobalErrorBar />)
    const bar = q('[data-testid="global-error-bar"]', el)!
    expect(bar.className).toContain('h-11')
    expect(bar.className).not.toMatch(/\bh-9\b/)
    expect(bar.className).not.toMatch(/\bmin-h-|\bpy-/)
    const text = bar.textContent ?? ''
    expect(text).toContain('权利要求 4：前向引用')
    expect(text).toContain('等 2 个错误')
    expect(text).not.toMatch(/第 \d+ 行|content\.md|L\d+|claims\/4/)
    // 嵌套控件命中区仍 ≥44（touch-hit）
    for (const id of ['global-error-text', 'global-error-locate']) expect(q(`[data-testid="${id}"]`, el)!.className).toContain('touch-hit')
    await act(async () => q('[data-testid="global-error-text"]', el)!.click())
    expect(openConsole).toHaveBeenCalledWith('error')
  })

  it('「定位」把内部行号交给 gotoLine（用户看不到数字）', async () => {
    useStudio.setState({ items: [diag('e1', 44, '标记不一致')] })
    const gotoLine = vi.fn()
    useStudio.setState({ gotoLine } as never)
    const el = await mount(<GlobalErrorBar />)
    const locate = q('[data-testid="global-error-locate"]', el)!
    expect(locate.textContent).toBe('定位')
    expect(locate.getAttribute('aria-label')).toBe('在源码中定位到说明书 · 段落 [0006]')
    await act(async () => locate.click())
    expect(gotoLine).toHaveBeenCalledWith(44)
  })

  it('无行号的错误（如网络错误）不出「定位」；无错误不渲染', async () => {
    useStudio.setState({ items: [], netError: 'Failed to fetch' } as never)
    const el = await mount(<GlobalErrorBar />)
    expect(q('[data-testid="global-error-bar"]', el)).not.toBeNull()
    expect(q('[data-testid="global-error-locate"]', el)).toBeNull()
    await act(async () => useStudio.setState({ netError: null } as never))
    expect(q('[data-testid="global-error-bar"]', el)).toBeNull()
  })
})

describe('MobileTopBar 副标题', () => {
  it('只显示 案号 · 稿 sha · 保存态，不再重复视图 / 书名', async () => {
    useStudio.setState({ saved: SYNTH_MD, view: 'layout' } as never)
    /* savedSha 由 store 订阅按 saved 异步实测（同 AiChat VersionTag）——期望 sha 独立由
       contentSha(SYNTH_MD) 算得，不硬编码 digest；mount 的 act 冲刷已让订阅落值。 */
    const sha = await contentSha(SYNTH_MD)
    expect(sha).toBeTruthy()
    const el = await mount(<MobileTopBar />)
    await act(async () => {})
    const sub = q('[data-testid="mobile-topbar-sub"]', el)!
    const v = sha!.slice(0, 8)
    expect(sub.textContent).toBe(`ZL-2026-001 · 稿 ${v} · 已保存`)
    expect(useStudio.getState().savedSha).toBe(sha)
    expect(sub.textContent).not.toMatch(/源码|版面|权利要求书/)
    await act(async () => useStudio.setState({ content: SYNTH_MD + '\n改' } as never))
    expect(sub.textContent).toBe(`ZL-2026-001 · 稿 ${v} · 未保存`)
  })
})

describe('MobileEditChrome', () => {
  it('固定 44（h-mobile-topbar，无 min-h / py），ViewSwitch md 三段 flex-1', async () => {
    const el = await mount(<MobileEditChrome />)
    const row = q('[data-testid="mobile-edit-chrome"]', el)!
    expect(row.className).toContain('h-mobile-topbar')
    expect(row.className).not.toMatch(/min-h-mobile-topbar|\bpy-1\b/)
    const seg = q('[data-testid="view-switch"]', el)!
    expect(seg.className).toContain('h-md-control')
    expect(seg.className).not.toContain('h-xl-control')
    expect(seg.className).toContain('[&_[data-slot=segmented-item]]:flex-1')
    expect(el.querySelectorAll('[data-slot="segmented-item"]')).toHaveLength(3)
  })
})

describe('MobileConsole 头部', () => {
  it('Segmented 与问题 tab 动作在同一 44 头行，且不再叠 ConsolePanel 自己的头行', async () => {
    const el = await mount(<MobileConsole />)
    const header = q('[data-testid="mobile-console-header"]', el)!
    expect(header.className).toContain('h-11')
    expect(header.querySelector('[data-testid="mobile-console-kind"]')).not.toBeNull()
    expect(header.querySelectorAll('button').length).toBeGreaterThan(3)
    expect(el.querySelectorAll('[data-testid="console-header"]')).toHaveLength(0)
    expect(el.querySelectorAll('[data-testid="mobile-console-kind"]')).toHaveLength(1)
  })
  it('W12 R4：内层 ConsolePanel 地标不与外层「控制台」同名（axe landmark-unique）', async () => {
    const el = await mount(<MobileConsole />)
    const labels = Array.from(el.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'))
    expect(labels.filter((l) => l === '控制台')).toHaveLength(1)
    expect(new Set(labels).size).toBe(labels.length)
    const res = await axe.run(el, { runOnly: { type: 'rule', values: ['landmark-unique'] } })
    expect(res.violations).toEqual([])
  })
})
