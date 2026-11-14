// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileTopBar } from '../MobileTopBar'
import { MoreSheet } from '../MoreSheet'
import { MobileTabs } from '../MobileTabs'
import { MobileAiTab } from '../MobileAiTab'
import { PdfLongPressSheet } from '../PdfLongPressSheet'
import { MobileStatusStrip } from '../MobileStatusStrip'
import { useStudio } from '@/store'
import type { ProjectDetail } from '@/lib/types'

/** AiPanel 用轻量替身，只验容器（Segmented 四 tab ↔ store.agentTab） */
vi.mock('@/components/ai', () => ({
  AiPanel: () => <div data-testid="ai-panel" />,
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')
const token = (name: string) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim()

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
  useStudio.setState({
    pid: 'p1',
    project: {
      id: 'p1',
      name: '一种方法',
      role: 'editor',
    } as unknown as ProjectDetail,
    mobileTab: 'edit',
    mobileSettingsOpen: false,
    moreOpen: false,
    authStatus: 'authed',
    pdfLongPress: null,
    editorView: 'source',
    mobilePreviewKind: 'pdf',
    agentTab: 'chat',
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

const q = <T extends HTMLElement = HTMLButtonElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)!
const click = (sel: string) => act(async () => q(sel).click())
const key = (el: Element, k: string) => act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

describe('MobileTopBar（21 §1.2 U3：44）', () => {
  it('高度走 --h-mobile-topbar token 且 token = 44px；返回 / 导航 视觉 sm 32、构建（唯一 primary）md 36，均带 touch-hit 命中 44（W8 分档）；更多不在顶栏', async () => {
    useStudio.setState({ pid: 'p1', mobileTab: 'edit' })
    const el = await mount(<MobileTopBar />)
    const bar = q('[data-testid="header"]', el)
    expect(bar.className).toContain('h-mobile-topbar')
    expect(token('--h-mobile-topbar')).toBe('44px')
    expect(token('--h-touch')).toBe('44px')
    for (const id of ['back-to-dashboard', 'open-nav']) expect(q(`[data-testid="${id}"]`, el).className).toContain('size-sm-control')
    expect(q('[data-testid="mobile-build"]', el).className).toContain('size-md-control')
    for (const id of ['back-to-dashboard', 'open-nav', 'mobile-build']) {
      const cls = q(`[data-testid="${id}"]`, el).className
      expect(cls).toContain('touch-hit')
      expect(cls).not.toContain('size-touch')
    }
    expect(bar.className).toContain('px-page-m')
    expect(el.querySelector('[data-testid="more-menu"]')).toBeNull()
    expect(el.querySelectorAll('[data-slot="button"][data-variant="primary"]').length).toBe(1)
    await act(async () => useStudio.getState().setMobileTab('ai'))
    expect(el.querySelector('[data-testid="mobile-build"]')).toBeNull()
  })
})

describe('MoreSheet（R-MOB-05）', () => {
  it('每项 44（min-h-touch，06 §Sheet 列表项），Sheet 内边距 16（px-sheet-m）；≤85dvh 可滚；Esc 关闭', async () => {
    useStudio.setState({ moreOpen: true })
    await mount(<MoreSheet />)
    const sheet = q('[data-testid="more-sheet"]')
    // R58-01：Sheet portal 脱出 MobileShell 的 data-density=touch 祖先 → 须自带注入，否则 touch-hit ::after 失效、命中区 <44
    expect(sheet.getAttribute('data-density')).toBe('touch')
    expect(sheet.className).toContain('max-h-[85dvh]')
    expect(sheet.className).toContain('overflow-y-auto')
    const items = Array.from(sheet.querySelectorAll<HTMLElement>('[role="group"] > a, [role="group"] > button'))
    expect(items.length).toBeGreaterThanOrEqual(10)
    for (const it of items) {
      expect(it.className).toContain('min-h-touch')
      expect(it.className).not.toContain('min-h-row-mobile')
    }
    // ux-10：Sheet px 16（不再 8+8），行 hover 底 -mx-2 出血但文本仍对齐 16；行间无 1px gap
    expect(sheet.className).toContain('px-sheet-m')
    expect(sheet.className).not.toContain('px-2')
    for (const g of Array.from(sheet.querySelectorAll<HTMLElement>('[role="group"]'))) expect(g.className).not.toContain('gap-px')
    expect(token('--pad-sheet-m')).toBe('16px')
    // R10：导入 Word / 转专利（手机工作台无入口）、密度（手机账户页无入口）等无替代入口项保留
    for (const id of ['open-deliver-page', 'more-share', 'more-settings', 'more-density', 'more-console', 'more-review', 'more-palette', 'more-syntax', 'more-about', 'more-import-docx', 'more-convert', 'more-open-pdf']) {
      expect(sheet.querySelector(`[data-testid="${id}"]`)).not.toBeNull()
    }
    // R10：有替代入口的重复项不再出现——源码/版面（ViewSwitch）、DOCX/PDF 下载（递交页）、新建（工作台）、主题（账户页）
    for (const id of ['export-docx', 'export-pdf', 'more-create-project', 'more-theme', 'mobile-editor-view-tabs']) {
      expect(sheet.querySelector(`[data-testid="${id}"]`)).toBeNull()
    }
    // 密度只在此处（手机账户页无入口）：Segmented md 36（选项 touch-hit 命中 44）；行 44
    {
      const seg = q('[data-testid="more-density"]', sheet)
      expect(seg.className).toContain('h-md-control')
      expect(seg.className).not.toContain('h-touch')
      expect(seg.parentElement!.className).toContain('min-h-touch')
    }
    expect(sheet.className).toContain('pt-sheet-top-m')
    expect(sheet.className).toContain('pb-[calc(var(--pad-sheet-m)+env(safe-area-inset-bottom))]')
    expect(await violations(sheet)).toEqual([])
    await key(sheet, 'Escape')
    expect(useStudio.getState().moreOpen).toBe(false)
  })

  it('T8：与导航抽屉同目标同行为的入口不再出现在「更多」（大纲·历史·术语·附图）；独有入口保留', async () => {
    useStudio.setState({ moreOpen: true })
    await mount(<MoreSheet />)
    for (const id of ['more-outline', 'more-history', 'more-terms', 'more-figures']) expect(q(`[data-testid="${id}"]`)).toBeNull()
    for (const id of ['more-review', 'more-materials', 'more-timeline', 'more-console', 'more-oa', 'more-search']) expect(q(`[data-testid="${id}"]`)).not.toBeNull()
  })

  it('R115-批29：面板组补 OA 答复入口——more-oa → openConsole(oa) 并关 Sheet', async () => {
    useStudio.setState({ moreOpen: true })
    await mount(<MoreSheet />)
    await act(async () => q<HTMLElement>('[data-testid="more-oa"]')!.click())
    const s = useStudio.getState()
    expect(s.consoleTab).toBe('oa')
    expect(s.mobileTab).toBe('console')
    expect(s.moreOpen).toBe(false)
  })

  it('帮助组三项打开各自对话框并关闭 Sheet（批18 移动端可达性补齐）', async () => {
    useStudio.setState({ moreOpen: true })
    await mount(<MoreSheet />)
    for (const [btn, dlg] of [['more-palette', 'palette'], ['more-syntax', 'syntax'], ['more-about', 'about']] as const) {
      await act(async () => q<HTMLElement>(`[data-testid="${btn}"]`)!.click())
      expect(useStudio.getState().dialog).toBe(dlg)
      expect(useStudio.getState().moreOpen).toBe(false)
      useStudio.setState({ dialog: null, moreOpen: true })
      await act(async () => {})
    }
  })

  it('密度 Segmented 写 store（不关闭 Sheet，便于连续调整；主题已移交手机账户页）', async () => {
    useStudio.setState({
      moreOpen: true,
      density: 'comfortable',
    })
    await mount(<MoreSheet />)
    await click('[data-testid="more-density-compact"]')
    expect(useStudio.getState().density).toBe('compact')
    expect(useStudio.getState().moreOpen).toBe(true)
  })
})

describe('MobileTabs（五项 + 输入聚焦隐藏，05 §3.19）', () => {
  it('案卷 / 编辑 / 预览 / AI / 更多 五项；input 聚焦 → 隐藏，失焦 → 恢复', async () => {
    const el = await mount(
      <div>
        <input aria-label="标题" data-testid="probe-input" />
        <MobileTabs />
      </div>,
    )
    const nav = q('[data-testid="mobile-tabs"]', el)
    expect(Array.from(nav.querySelectorAll('[role="tab"]')).map((b) => b.id)).toEqual([
      'mobile-tab-files',
      'mobile-tab-edit',
      'mobile-tab-preview',
      'mobile-tab-ai',
      'mobile-tab-more',
    ])
    expect(nav.className).toContain('grid-cols-5')
    expect(nav.className).toContain('h-mobile-tabs')
    expect(token('--h-mobile-tabs')).toBe('56px')
    for (const b of nav.querySelectorAll('[role="tab"]')) expect(b.className).toContain('min-h-touch')
    expect(nav.hidden).toBe(false)

    const input = q<HTMLInputElement>('[data-testid="probe-input"]', el)
    await act(async () => input.focus())
    expect(nav.hidden).toBe(true)
    expect(nav.getAttribute('data-input-focused')).toBe('true')
    await act(async () => input.blur())
    expect(nav.hidden).toBe(false)

    await act(async () => q('#mobile-tab-ai', el).click())
    expect(useStudio.getState().mobileTab).toBe('ai')
  })
})

describe('MobileAiTab（ai-panel 已合入）', () => {
  it('只做容器：不叠壳级 Tab（页签由 AiPanel 面板内 Tabs 提供，见 ai 单元测试）；body 透出 agentTab', async () => {
    useStudio.setState({ agentTab: 'chat' })
    const el = await mount(<MobileAiTab />)
    expect(el.querySelector('[data-testid="mobile-ai-tabs"]')).toBeNull()
    expect(el.querySelectorAll('[role="tablist"], [role="radiogroup"]')).toHaveLength(0)
    expect(el.querySelector('[data-testid="ai-panel"]')).not.toBeNull()
    expect(q('[data-testid="mobile-ai-body"]', el).getAttribute('data-agent-tab')).toBe('chat')
    await act(async () => useStudio.getState().setAgentTab('proposals'))
    expect(q('[data-testid="mobile-ai-body"]', el).getAttribute('data-agent-tab')).toBe('proposals')
    expect(await violations(el)).toEqual([])
  })
})

describe('PdfLongPressSheet（store.ui.pdfLongPress 契约）', () => {
  it('dispatch setPdfLongPress → 底部 Sheet 四项；「在源码打开」切 Tab 编辑 + setFocus(source=pdf) 并关闭', async () => {
    await mount(<PdfLongPressSheet />)
    expect(document.querySelector('[data-testid="pdf-long-press-sheet"]')).toBeNull()

    await act(async () =>
      useStudio.getState().setPdfLongPress({
        book: 'claims',
        blockId: 'claims:1',
        line: 12,
        page: 2,
      }),
    )
    const sheet = q('[data-testid="pdf-long-press-sheet"]')
    expect(sheet.getAttribute('data-snap')).toBe('half')
    // 标题是语义位置，不露块 id（claims:1 / abstract/p1）与源码行号
    expect(sheet.textContent).not.toMatch(/claims:1|abstract\/p1|L\d+|第 \d+ 行/)
    expect(sheet.textContent).toContain('第 2 页')
    const items = Array.from(sheet.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((b) => b.dataset.testid)).toEqual(['plp-open-source', 'plp-open-layout', 'plp-comment', 'plp-edit-block'])
    expect(items.map((b) => b.textContent)).toEqual(['在源码打开', '在版面打开', '添加批注', '编辑此块'])
    for (const it of items) expect(it.className).toContain('min-h-row-mobile')
    expect(await violations(sheet)).toEqual([])

    useStudio.setState({ mobileTab: 'preview' })
    await click('[data-testid="plp-open-source"]')
    const s = useStudio.getState()
    expect(s.mobileTab).toBe('edit')
    expect(s.editorView).toBe('source')
    expect(s.focus).toMatchObject({
      book: 'claims',
      blockId: 'claims:1',
      line: 12,
      page: 2,
      source: 'pdf',
    })
    expect(s.pdfLongPress).toBeNull()
    expect(document.querySelector('[data-testid="pdf-long-press-sheet"]')).toBeNull()
  })

  it('「在源码打开」跨书：当前书 claims、选中摘要 → activeBook 切到 abstract（W5 走查 domain-02）；全文视图不切书', async () => {
    await mount(<PdfLongPressSheet />)
    useStudio.setState({ activeBook: 'claims', mobileTab: 'preview' })
    await act(async () => useStudio.getState().setPdfLongPress({ book: 'abstract', blockId: 'abstract/p1', page: 1 }))
    await click('[data-testid="plp-open-source"]')
    expect(useStudio.getState().activeBook).toBe('abstract')
    expect(useStudio.getState().mobileTab).toBe('edit')

    useStudio.setState({ activeBook: 'all', mobileTab: 'preview' })
    await act(async () => useStudio.getState().setPdfLongPress({ book: 'claims', blockId: 'claims/1', line: 12 }))
    await click('[data-testid="plp-open-source"]')
    expect(useStudio.getState().activeBook).toBe('all')
    expect(useStudio.getState().scrollRequest?.line).toBe(12)
  })

  it('「在版面打开」→ 预览 Tab + 版面 Segmented + setFocus；Esc 关闭', async () => {
    await mount(<PdfLongPressSheet />)
    await act(async () =>
      useStudio.getState().setPdfLongPress({
        book: 'description',
        blockId: 'description:3',
        page: 1,
      }),
    )
    await click('[data-testid="plp-open-layout"]')
    const s = useStudio.getState()
    expect(s.mobileTab).toBe('preview')
    expect(s.mobilePreviewKind).toBe('layout')
    expect(s.focus?.blockId).toBe('description:3')

    await act(async () => useStudio.getState().setPdfLongPress({ book: 'description', blockId: 'description:3' }))
    await key(q('[data-testid="pdf-long-press-sheet"]'), 'Escape')
    expect(useStudio.getState().pdfLongPress).toBeNull()
  })

  it('「添加批注」切到批注表单（snap full，可滚）', async () => {
    await mount(<PdfLongPressSheet />)
    await act(async () => useStudio.getState().setPdfLongPress({ book: 'abstract', blockId: 'abstract:1' }))
    await click('[data-testid="plp-comment"]')
    const sheet = q('[data-testid="pdf-long-press-sheet"]')
    expect(sheet.getAttribute('data-snap')).toBe('full')
    expect(sheet.className).toContain('max-h-[85dvh]')
    expect(sheet.querySelector('[data-testid="plp-comment-body"]')).not.toBeNull()
  })
})

describe('MobileStatusStrip（两行）', () => {
  it('第一行定位文案 aria-live；第二行角色 / 构建 / 协同', async () => {
    useStudio.setState({ collabStatus: 'connected', peers: [] })
    const el = await mount(<MobileStatusStrip />)
    const live = q('[aria-live="polite"]', el)
    expect(live).not.toBeNull()
    expect(el.textContent).toContain('编辑者')
    expect(el.textContent).toContain('协同中')
  })
})
