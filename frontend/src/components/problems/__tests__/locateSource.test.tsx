// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleEntry } from '@/components/console/ConsoleEntry'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import type { Diagnostic } from '@/lib/types'
import { useStudio, type DockHandle } from '@/store'
import { CheckPanel } from '../CheckPanel'
import { SETTLE_MS, bookForLine, locateSourceLine } from '../locateSource'

/**
 * domain-02（W6 走查 deferred）：Problems / Preflight 每条结果点击 → `revealView('source', book)` + `focus{book, line}`。
 * 这里守住三条路径：① 有 dock（1440 / 1024 工作台）：立即开对应书源码卡片 + setFocus(line)；② 桌面但 dock 尚未挂（从递交页跳回工作台）：
 * 先写 focus，dockHandle 就位后再 revealView；③ 无 dock 且非桌面（375）：gotoLine + focus。
 * 后端 lint 诊断没有 book 字段 → 由行号经 AST（blockAtLine）反查书；AST 未到时退回全文书界（bookAtFullLine）。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()
let desktop = false

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

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  window.matchMedia = (q: string) =>
    ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  desktop = false
  useStudio.setState({ ...initial, pid: 'method', content: SYNTH_MD, ast: SYNTH_AST }, false)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const focusOf = () => {
  const f = useStudio.getState().focus
  return f ? { book: f.book, line: f.line, source: f.source } : null
}

describe('bookForLine：无 book 的诊断由行号反查书', () => {
  it('AST 命中块 → 该块的书；标题 / 书界空行不在任何块内 → 退回全文书界', () => {
    expect(bookForLine(SYNTH_AST, SYNTH_MD, 5)).toBe('abstract')
    expect(bookForLine(SYNTH_AST, SYNTH_MD, 9)).toBe('claims')
    expect(bookForLine(SYNTH_AST, SYNTH_MD, 44)).toBe('description')
    expect(bookForLine(null, SYNTH_MD, 9)).toBe('claims')
    expect(bookForLine(null, SYNTH_MD, 44)).toBe('description')
  })
  it('`## 书名` 标题行算该书（权利要求书为空时 XML 错误只能指到标题行，仍要能开该书卡片）；头部 → null', () => {
    expect(bookForLine(null, SYNTH_MD, 7)).toBe('claims')
    expect(bookForLine(SYNTH_AST, SYNTH_MD, 18)).toBe('description')
    expect(bookForLine(SYNTH_AST, SYNTH_MD, 1)).toBeNull()
  })
})

describe('locateSourceLine', () => {
  it('① 有 dock：revealView 开该书源码卡片（已开则激活；未开则在源码 tab 组内新开）+ 光标到该行 + focus{book,line,source:problems}', () => {
    const dock = fakeDock(['source:description', 'pdf'])
    useStudio.setState({ dockHandle: dock, activePanelId: 'pdf', activeBook: 'description' })
    expect(locateSourceLine({ book: null, line: 9 })).toBe('claims')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:claims', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(useStudio.getState().cursor).toEqual({ line: 9, col: 1 })
    expect(focusOf()).toEqual({ book: 'claims', line: 9, source: 'problems' })
    expect(useStudio.getState().focus?.blockId).toBe('claims/1')

    expect(locateSourceLine({ book: null, line: 44 })).toBe('description')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:description', undefined)
    expect(focusOf()).toEqual({ book: 'description', line: 44, source: 'problems' })

    expect(locateSourceLine({ book: 'abstract', line: 5, blockId: 'abstract' })).toBe('abstract')
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:abstract', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(focusOf()).toEqual({ book: 'abstract', line: 5, source: 'problems' })
    expect(useStudio.getState().editorView).toBe('source')
  })

  it('同一行连点两次 seq 递增（源码侧再次滚动闪烁）', () => {
    useStudio.setState({ dockHandle: fakeDock(['source:all']) })
    locateSourceLine({ book: null, line: 44 })
    const a = useStudio.getState().focus!.seq
    locateSourceLine({ book: null, line: 44 })
    expect(useStudio.getState().focus!.seq).toBe(a + 1)
  })

  it('② 桌面、dock 未挂（递交页 → 工作台）：先写 focus + 光标，dockHandle 就位后自动 revealView 并重发 focus', () => {
    desktop = true
    expect(locateSourceLine({ book: null, line: 15 })).toBe('claims')
    expect(focusOf()).toEqual({ book: 'claims', line: 15, source: 'problems' })
    expect(useStudio.getState().scrollRequest).toBeNull()
    const seq0 = useStudio.getState().focus!.seq
    const dock = fakeDock(['source:description'])
    useStudio.setState({ dockHandle: dock })
    expect(dock.openPanel).toHaveBeenCalledWith('source:claims', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(useStudio.getState().focus!.seq).toBe(seq0 + 1)
    expect(focusOf()).toEqual({ book: 'claims', line: 15, source: 'problems' })
  })

  it('② dock 就位后布局稳定（SETTLE_MS）再重发一次同一 focus 让源码卡片重新居中；用户已另行定位则不重发', () => {
    vi.useFakeTimers()
    try {
      desktop = true
      locateSourceLine({ book: null, line: 15 })
      useStudio.setState({ dockHandle: fakeDock(['source:description']) })
      const seq1 = useStudio.getState().focus!.seq
      vi.advanceTimersByTime(SETTLE_MS + 1)
      expect(useStudio.getState().focus!.seq).toBe(seq1 + 1)
      expect(focusOf()).toEqual({ book: 'claims', line: 15, source: 'problems' })

      useStudio.setState({ dockHandle: null })
      locateSourceLine({ book: null, line: 15 })
      useStudio.setState({ dockHandle: fakeDock(['source:description']) })
      useStudio.getState().setFocus({ book: 'description', blockId: 'description/1', line: 44, source: 'outline' })
      const seq2 = useStudio.getState().focus!.seq
      vi.advanceTimersByTime(SETTLE_MS + 1)
      expect(useStudio.getState().focus!.seq).toBe(seq2)
      expect(focusOf()).toEqual({ book: 'description', line: 44, source: 'outline' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('③ 无 dock 且非桌面（375）：gotoLine + focus，并切到该书编辑 Tab', () => {
    useStudio.setState({ activeBook: 'claims', mobileTab: 'preview' })
    expect(locateSourceLine({ book: null, line: 44 })).toBe('description')
    const s = useStudio.getState()
    expect(s.scrollRequest?.line).toBe(44)
    expect(focusOf()).toEqual({ book: 'description', line: 44, source: 'problems' })
  })

  it('③ 375 且伴随栏（?panel=console 底部 Sheet）打开：定位前先收起伴随栏，否则高亮行被 Sheet 盖住；桌面不收', () => {
    useStudio.setState({ companion: 'console' })
    expect(locateSourceLine({ book: null, line: 44 })).toBe('description')
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().scrollRequest?.line).toBe(44)

    desktop = true
    useStudio.setState({ companion: 'console', ast: null, content: '' })
    expect(locateSourceLine({ book: null, line: 3 })).toBeNull()
    expect(useStudio.getState().companion).toBe('console')
  })

  it('AST 与全文都判不出书（空文档）→ 只 gotoLine，返回 null，不写 focus', () => {
    useStudio.setState({ ast: null, content: '' })
    expect(locateSourceLine({ book: null, line: 3 })).toBeNull()
    expect(useStudio.getState().scrollRequest?.line).toBe(3)
    expect(useStudio.getState().focus).toBeNull()
  })
})

const diag = (id: string, line: number | null, message = '诊断'): Diagnostic =>
  ({ id, severity: 'warning', message, line, source: 'lint', section: null, fix: null }) as unknown as Diagnostic

describe('Problems 面板条目点击（ConsoleEntry / CheckPanel）', () => {
  it('ConsoleEntry：每条只保留一个定位入口（标题主行）→ 源码卡片 + focus；无行号的条目不渲染定位控件', async () => {
    const dock = fakeDock(['source:description'])
    useStudio.setState({ dockHandle: dock })
    const el = await mount(
      <ul>
        <ConsoleEntry item={diag('claims.ref', 9)} />
        <ConsoleEntry item={diag('meta.x', null)} />
      </ul>,
    )
    const entries = Array.from(el.querySelectorAll('[data-testid="console-entry"]'))
    await act(async () => entries[0].querySelector<HTMLButtonElement>('[data-testid="console-entry-locate"]')!.click())
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:claims', { position: { referencePanel: 'source:description', direction: 'within' } })
    expect(focusOf()).toEqual({ book: 'claims', line: 9, source: 'problems' })
    expect(entries[0].querySelector('[data-testid="console-entry-goto"]')).toBeNull()
    expect(entries[1].querySelector('[data-testid="console-entry-locate"]')).toBeNull()
    expect(entries[1].querySelector('[data-testid="console-entry-goto"]')).toBeNull()
  })

  it('CheckPanel（递交页体检结果）：位置按钮显示书 / 段落而非行号，点击 → 对应书源码卡片 + focus', async () => {
    const dock = fakeDock(['source:all'])
    useStudio.setState({
      dockHandle: dock,
      settings: {} as never,
      lintItems: [diag('abstract.length', 5, '摘要过长'), diag('description.numeral', 44, '标记不一致')],
      lintRun: { report: { diagnostics: [] } as never, ms: 3, error: null, at: 1 },
    })
    const el = await mount(<CheckPanel />)
    const links = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="lint-goto"]'))
    expect(links.map((b) => b.textContent)).toEqual(['摘要', '说明书 · 段落 [0006]'])
    await act(async () => links[0].click())
    expect(dock.openPanel).toHaveBeenLastCalledWith('source:all', undefined)
    expect(focusOf()).toEqual({ book: 'abstract', line: 5, source: 'problems' })
    await act(async () => links[1].click())
    expect(focusOf()).toEqual({ book: 'description', line: 44, source: 'problems' })
  })

  it('批64：lintContent !== content ⇒ 结果陈旧出 lint-stale 提示；改回匹配即隐', async () => {
    useStudio.setState({
      settings: {} as never,
      lintItems: [diag('abstract.length', 5, '摘要过长')],
      lintRun: { report: { diagnostics: [] } as never, ms: 3, error: null, at: 1 },
      lintContent: '旧正文',
      content: '新正文',
    })
    const el = await mount(<CheckPanel />)
    expect(el.querySelector('[data-testid="lint-stale"]'), '陈旧应有提示').not.toBeNull()
    await act(async () => useStudio.setState({ lintContent: '新正文' }))
    expect(el.querySelector('[data-testid="lint-stale"]'), '匹配后应消隐').toBeNull()
  })
})
