// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceCard } from '../SourceCard'
import { FullTextCard } from '../FullTextCard'
import { StructureCard } from '../StructureCard'
import { CardHeader } from '../CardHeader'
import { resetHeaderSlots, setHeaderSlot } from '@/layout/headerSlot'
import { usePairedBlock } from '../useCompareLock'
import { bookAtFullLine, locateBlock, minimalChange, openOptions, toCardDiagnostics, toCardMarks } from '../sync'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import { splitBooks } from '@/lib/docset'
import { SYNTH_AST, SYNTH_MD } from '@/lib/__tests__/astFixture'
import type { CriticMark, Diagnostic } from '@/lib/types'

/**
 * D2-cards 行为测试（docs/plan/08-r4-dockview-design.md §4.1–§4.4）：
 * 单书 CodeMirror 编辑只改本书切片、Mod-s 走 saveBook(book)、多卡片 undo 栈独立、全文卡片只读、
 * scrollRequest 按书过滤、光标上报全文行、对照锁同序配对（不回环）、结构卡片单书过滤。CodeMirror 在 jsdom 下能建 view，
 * 只是量不到几何（Range.getClientRects 补空实现）。
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
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= rects
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

function viewOf(el: Element, testId: string): EditorView {
  const content = el.querySelector(`[data-testid="${testId}"] .cm-content`)
  const v = content && EditorView.findFromDOM(content as HTMLElement)
  if (!v) throw new Error(`no EditorView under ${testId}`)
  return v
}

/** 在 view 第 line 行末尾插入文本（模拟用户输入） */
async function typeAtLine(view: EditorView, line: number, text: string) {
  const l = view.state.doc.line(line)
  await act(async () => view.dispatch({ changes: { from: l.to, insert: text }, selection: { anchor: l.to + text.length }, userEvent: 'input.type' }))
}

const DOC = '# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2\n\n## 说明书\nD1\nD2\n'

beforeEach(() => {
  useStudio.setState({
    content: DOC,
    saved: DOC,
    contentEditedAt: 0,
    scrollRequest: null,
    compareLock: false,
    activeBlock: null,
    activePanelId: null,
    ast: null,
    editorHandle: null,
  })
})

describe('sync 纯函数', () => {
  it('minimalChange 只替换首尾公共部分之间的区间', () => {
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
    expect(minimalChange('1. C1\n2. C2', '1. C1\n2. C2\n')).toEqual({ from: 11, to: 11, insert: '\n' })
    expect(minimalChange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' })
    expect(minimalChange('aXb', 'aYYb')).toEqual({ from: 1, to: 2, insert: 'YY' })
    expect(minimalChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
  })

  it('bookAtFullLine：头部 / 书标题行 → null，正文行 → 所属书', () => {
    expect(bookAtFullLine(DOC, 1)).toBeNull()
    expect(bookAtFullLine(DOC, 3)).toBeNull()
    expect(bookAtFullLine(DOC, 4)).toBe('abstract')
    expect(bookAtFullLine(DOC, 6)).toBeNull()
    expect(bookAtFullLine(DOC, 7)).toBe('claims')
    expect(bookAtFullLine(DOC, 9)).toBe('claims')
    expect(bookAtFullLine(DOC, 12)).toBe('description')
    expect(bookAtFullLine(DOC, 99)).toBeNull()
  })

  it('诊断 / 标记按书过滤并换算成书相对行；all 原样', () => {
    const d = (id: string, line: number | null): Diagnostic => ({ id, severity: 'warning', source: 'lint', message: id, line }) as Diagnostic
    const items = [d('h', 1), d('a', 4), d('c1', 7), d('c2', 8), d('d', 11), d('none', null)]
    expect(toCardDiagnostics(items, DOC, 'claims').map((x) => [x.id, x.line])).toEqual([
      ['c1', 1],
      ['c2', 2],
    ])
    expect(toCardDiagnostics(items, DOC, 'description').map((x) => x.id)).toEqual(['d'])
    expect(toCardDiagnostics(items, DOC, 'all')).toEqual(items)
    const m = (id: string, line: number): CriticMark => ({ id, kind: 'ins', line, from: 0, to: 1, a: '', b: 'x', final: 'x', original: '' })
    expect(toCardMarks([m('x', 8), m('y', 12)], DOC, 'claims').map((x) => x.line)).toEqual([2])
  })

  it('locateBlock 覆盖 abstract 本体 / 摘要段 / 权项 / 说明书块', () => {
    expect(locateBlock(SYNTH_AST, 'abstract')?.book).toBe('abstract')
    expect(locateBlock(SYNTH_AST, 'abstract/p1')?.book).toBe('abstract')
    expect(locateBlock(SYNTH_AST, 'claims/2')?.book).toBe('claims')
    expect(locateBlock(SYNTH_AST, 'description/背景技术/p0002')?.book).toBe('description')
    expect(locateBlock(SYNTH_AST, 'nope')).toBeNull()
  })

  it('openOptions：右 / 下 → 相对本面板 position，浮动 → floating', () => {
    expect(openOptions('source:claims', 'right')).toEqual({ position: { referencePanel: 'source:claims', direction: 'right' } })
    expect(openOptions('source:claims', 'below')).toEqual({ position: { referencePanel: 'source:claims', direction: 'below' } })
    expect(openOptions('source:claims', 'floating')).toEqual({ floating: true })
  })
})

describe('SourceCard 单书编辑', () => {
  it('R48-01：挂载时接住「为了开我」刚发的新鲜 scrollRequest 并消费', async () => {
    // 模拟 gotoLine：先 openPanel（挂载晚一拍）再 requestScroll——新鲜 pending 必须在挂载时被消费
    useStudio.setState({ scrollRequest: { line: 8, seq: 5, at: Date.now() } })
    await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    expect(useStudio.getState().scrollRequest).toBeNull()
  })

  it('R48-01：陈旧 pending（>3s）不在新挂载卡片上回放', async () => {
    useStudio.setState({ scrollRequest: { line: 11, seq: 6, at: Date.now() - 60_000 } })
    await mount(<SourceCard panelId="source:description" kind="source" book="description" active />)
    expect(useStudio.getState().scrollRequest?.seq).toBe(6)
  })

  it('编辑 claims 卡片一行 → content 只该行变，其它书逐字节不动；脏标只在本卡片', async () => {
    const el = await mount(
      <>
        <SourceCard panelId="source:claims" kind="source" book="claims" active />
        <SourceCard panelId="source:description" kind="source" book="description" active={false} />
      </>,
    )
    const claims = viewOf(el, 'card-editor-claims')
    const desc = viewOf(el, 'card-editor-description')
    expect(claims.state.doc.toString()).toBe('1. C1\n2. C2\n\n')
    expect(desc.state.doc.toString()).toBe('D1\nD2\n')

    await typeAtLine(claims, 2, ' 改')
    const content = useStudio.getState().content
    expect(content).toBe('# 题\n\n## 摘要\nA1\n\n## 权利要求书\n1. C1\n2. C2 改\n\n## 说明书\nD1\nD2\n')
    expect(content.split('\n').filter((l, i) => l !== DOC.split('\n')[i])).toEqual(['2. C2 改'])
    expect(splitBooks(content).books.description?.text).toBe(splitBooks(DOC).books.description?.text)
    // 另一卡片的 view 没被重建也没被改
    expect(desc.state.doc.toString()).toBe('D1\nD2\n')
    expect(el.querySelector('[data-testid="card-source-claims"] [data-testid="card-dirty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="card-source-description"] [data-testid="card-dirty"]')).toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('两张卡片 undo 栈独立：撤销 description 不影响 claims 的修改', async () => {
    const el = await mount(
      <>
        <SourceCard panelId="source:claims" kind="source" book="claims" active />
        <SourceCard panelId="source:description" kind="source" book="description" active={false} />
      </>,
    )
    const claims = viewOf(el, 'card-editor-claims')
    const desc = viewOf(el, 'card-editor-description')
    await typeAtLine(claims, 1, ' X')
    await typeAtLine(desc, 2, ' Y')
    expect(useStudio.getState().content).toContain('1. C1 X')
    expect(useStudio.getState().content).toContain('D2 Y')
    await act(async () => void undo(desc))
    expect(useStudio.getState().content).toContain('1. C1 X')
    expect(useStudio.getState().content).toContain('D1\nD2\n')
    expect(useStudio.getState().content).not.toContain('D2 Y')
  })

  it('PDF / 大纲 focus 指向本书且卡片藏在 tab 组后 → dock.openPanel 露出本卡片，光标落到对应行；别的书不动（W5 走查 qa-02）', async () => {
    const openPanel = vi.fn()
    const hidden = new Set(['source:description'])
    useStudio.setState({ focus: null, editorView: 'source', dockHandle: { openPanel, isPanelVisible: (id: string) => !hidden.has(id), panelIds: () => ['source:claims', 'source:description', 'pdf'] } as never })
    const el = await mount(
      <>
        <SourceCard panelId="source:claims" kind="source" book="claims" active />
        <SourceCard panelId="source:description" kind="source" book="description" active={false} />
      </>,
    )
    const desc = viewOf(el, 'card-editor-description')
    await act(async () => useStudio.getState().setFocus({ book: 'description', blockId: 'description/x', line: 12, source: 'pdf' }))
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(openPanel).toHaveBeenCalledWith('source:description')
    expect(desc.state.doc.lineAt(desc.state.selection.main.head).number).toBe(2)

    openPanel.mockClear()
    await act(async () => useStudio.getState().setFocus({ book: 'claims', blockId: 'claims/2', line: 8, source: 'outline' }))
    expect(openPanel).not.toHaveBeenCalled()
    expect(viewOf(el, 'card-editor-claims').state.doc.lineAt(viewOf(el, 'card-editor-claims').state.selection.main.head).number).toBe(2)

    // 用户当前编辑视图是版面 → 源码卡不抢着露出（由版面卡露出），但仍跟随行
    useStudio.setState({ editorView: 'layout' })
    await act(async () => useStudio.getState().setFocus({ book: 'description', blockId: 'description/y', line: 11, source: 'outline' }))
    expect(openPanel).not.toHaveBeenCalled()
    expect(desc.state.doc.lineAt(desc.state.selection.main.head).number).toBe(1)
    useStudio.setState({ dockHandle: null, focus: null, editorView: 'source' })
  })

  it('Mod-s → saveBook(book)；标题栏保存按钮同源', async () => {
    const saveBook = vi.fn(async () => true)
    useStudio.setState({ saveBook })
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    const claims = viewOf(el, 'card-editor-claims')
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="card-save"]')!
    expect(btn.disabled).toBe(true)
    await typeAtLine(claims, 1, '!')
    expect(btn.disabled).toBe(false)
    await act(async () => {
      claims.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(saveBook).toHaveBeenCalledWith('claims')
    await act(async () => btn.click())
    expect(saveBook).toHaveBeenCalledTimes(2)
  })

  it('外部 setBookContent 只做最小替换（不重建 view / 不丢选区）', async () => {
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    const claims = viewOf(el, 'card-editor-claims')
    await act(async () => claims.dispatch({ selection: { anchor: 2 } }))
    await act(async () => useStudio.getState().setBookContent('claims', '1. C1\n2. C2\n3. C3\n\n'))
    expect(claims.state.doc.toString()).toBe('1. C1\n2. C2\n3. C3\n\n')
    expect(claims.state.selection.main.head).toBe(2)
    expect(viewOf(el, 'card-editor-claims')).toBe(claims)
  })

  it('加载期挂载（只读）→ 加载完成但正文未变：解锁不依赖 value 变化（404 → 原案回切）', async () => {
    useStudio.setState({ projectLoading: true })
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    const claims = viewOf(el, 'card-editor-claims')
    expect(claims.state.facet(EditorState.readOnly)).toBe(true)
    expect(claims.contentDOM.getAttribute('aria-readonly')).toBe('true')
    await act(async () => useStudio.setState({ projectLoading: false }))
    expect(viewOf(el, 'card-editor-claims')).toBe(claims)
    expect(claims.state.facet(EditorState.readOnly)).toBe(false)
    expect(claims.state.facet(EditorView.editable)).toBe(true)
    expect(claims.contentDOM.getAttribute('aria-readonly')).toBe('false')
    await typeAtLine(claims, 1, ' Z')
    expect(splitBooks(useStudio.getState().content).books.claims?.text).toBe('1. C1 Z\n2. C2\n\n')
  })

  it('content.md 缺本书章节时显示提示而不是空编辑器', async () => {
    useStudio.setState({ content: '# 题\n\n## 摘要\nA1\n', saved: '# 题\n\n## 摘要\nA1\n' })
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    expect(el.querySelector('[data-testid="card-no-book"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="card-editor-claims"]')).toBeNull()
  })
})

describe('FullTextCard 只读镜像', () => {
  it('value === content，只读 facet 生效，其它卡片编辑后镜像同步且不重建', async () => {
    const el = await mount(
      <>
        <FullTextCard panelId="source:all" kind="source" book="all" active />
        <SourceCard panelId="source:claims" kind="source" book="claims" active={false} />
      </>,
    )
    const all = viewOf(el, 'card-editor-all')
    expect(all.state.doc.toString()).toBe(DOC)
    expect(all.state.facet(EditorState.readOnly)).toBe(true)
    expect(all.state.facet(EditorView.editable)).toBe(false)
    expect(all.contentDOM.getAttribute('aria-readonly')).toBe('true')
    expect(el.querySelector('[data-testid="card-readonly"]')).not.toBeNull()
    // 可访问名 / title 不露内部文件名（content.md / claims.md）
    expect(all.contentDOM.getAttribute('aria-label')).toBe('全文源码（只读镜像）')
    expect(viewOf(el, 'card-editor-claims').contentDOM.getAttribute('aria-label')).toBe('权利要求书源码编辑器')
    expect(el.querySelector('[data-testid="card-save"]')?.getAttribute('aria-label')).toBe('保存权利要求书')
    for (const node of el.querySelectorAll('[aria-label], [title]')) {
      expect(`${node.getAttribute('aria-label')} ${node.getAttribute('title')}`).not.toMatch(/\.md\b/)
    }
    await typeAtLine(viewOf(el, 'card-editor-claims'), 1, ' Z')
    expect(all.state.doc.toString()).toBe(useStudio.getState().content)
    expect(viewOf(el, 'card-editor-all')).toBe(all)
    expect(await violations(el)).toEqual([])
  })

  it('「编辑」按钮把光标所在书的源码卡片拆分到右侧', async () => {
    const openPanel = vi.fn()
    useStudio.setState({ openPanel, cursor: { line: 8, col: 1, section: '' } })
    const el = await mount(<FullTextCard panelId="source:all" kind="source" book="all" active />)
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="card-edit-book"]')!
    expect(btn.textContent).toContain('权利要求书')
    await act(async () => btn.click())
    expect(openPanel).toHaveBeenCalledWith('source:claims', { position: { referencePanel: 'source:all', direction: 'right' } })
  })
})

describe('跨卡片同步', () => {
  it('scrollRequest 只被行所在书的卡片消费，并清掉', async () => {
    const el = await mount(
      <>
        <SourceCard panelId="source:claims" kind="source" book="claims" active />
        <SourceCard panelId="source:description" kind="source" book="description" active={false} />
      </>,
    )
    const claims = viewOf(el, 'card-editor-claims')
    const desc = viewOf(el, 'card-editor-description')
    await act(async () => useStudio.getState().requestScroll(8)) // 全文第 8 行 = claims 第 2 行
    expect(claims.state.doc.lineAt(claims.state.selection.main.head).number).toBe(2)
    expect(desc.state.selection.main.head).toBe(0)
    expect(useStudio.getState().scrollRequest).toBeNull()
    await act(async () => useStudio.getState().requestScroll(12)) // 说明书第 2 行
    expect(desc.state.doc.lineAt(desc.state.selection.main.head).number).toBe(2)
    expect(useStudio.getState().scrollRequest).toBeNull()
    await act(async () => useStudio.getState().requestScroll(1)) // 头部：无人消费，保留给全文卡片 / 主编辑器
    expect(useStudio.getState().scrollRequest?.line).toBe(1)
  })

  it('聚焦卡片的光标以全文行上报 doc.cursor，并写 activeBlock', async () => {
    vi.useFakeTimers()
    useStudio.setState({ content: SYNTH_MD, saved: SYNTH_MD, ast: SYNTH_AST })
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    const claims = viewOf(el, 'card-editor-claims')
    await act(async () => claims.focus())
    expect(claims.hasFocus).toBe(true)
    const l4 = claims.state.doc.line(4)
    await act(async () => claims.dispatch({ selection: { anchor: l4.from } }))
    await act(async () => void vi.advanceTimersByTime(150))
    expect(useStudio.getState().cursor.line).toBe(7 + 4)
    expect(useStudio.getState().activeBlock).toEqual({ id: 'claims/2', source: 'editor' })
    expect(useStudio.getState().editorHandle).not.toBeNull()
    await act(async () => root?.unmount())
    root = null
    expect(useStudio.getState().editorHandle).toBeNull()
  })

  it('未聚焦卡片的外部 doc 变化不上报光标', async () => {
    vi.useFakeTimers()
    const el = await mount(<FullTextCard panelId="source:all" kind="source" book="all" active />)
    useStudio.setState({ cursor: { line: 42, col: 1, section: '' } })
    await act(async () => useStudio.getState().setBookContent('claims', '1. C1 改\n2. C2\n\n'))
    await act(async () => void vi.advanceTimersByTime(150))
    expect(viewOf(el, 'card-editor-all').state.doc.toString()).toContain('1. C1 改')
    expect(useStudio.getState().cursor.line).toBe(42)
  })
})

describe('对照滚动锁 usePairedBlock', () => {
  function Probe({ book, panelId }: { book: 'claims' | 'description' | 'all'; panelId: string }) {
    const paired = usePairedBlock(book, panelId)
    return <output data-testid={`probe-${panelId}`}>{paired ? `${paired.book}:${paired.block.id}` : ''}</output>
  }
  const text = (el: Element, id: string) => el.querySelector(`[data-testid="probe-${id}"]`)!.textContent

  it('锁开时另一书的活动块 → 本书同序块；本卡片 / 同书 / all / 锁关 → null', async () => {
    useStudio.setState({ ast: SYNTH_AST, compareLock: true, activePanelId: 'source:claims', activeBlock: { id: 'claims/2', source: 'editor' } })
    const el = await mount(
      <>
        <Probe book="description" panelId="source:description" />
        <Probe book="claims" panelId="source:claims" />
        <Probe book="claims" panelId="layout:claims" />
        <Probe book="all" panelId="source:all" />
      </>,
    )
    // 说明书侧只配对段落（bookBlocks 过滤掉章节标题）：claims/2 = 第 2 个权项 → 第 2 段
    expect(text(el, 'source:description')).toBe('description:description/背景技术/p0002')
    expect(text(el, 'source:claims')).toBe('')
    expect(text(el, 'layout:claims')).toBe('')
    expect(text(el, 'source:all')).toBe('')
    await act(async () => useStudio.getState().setActiveBlock('claims/3', 'editor'))
    expect(text(el, 'source:description')).toBe('description:description/发明内容/技术方案/p0003')
    await act(async () => useStudio.getState().setCompareLock(false))
    expect(text(el, 'source:description')).toBe('')
    await act(async () => useStudio.getState().setCompareLock(true))
    // 活动块来自 description 卡片 → claims 卡片跟随；description 自己不动（不回环）
    useStudio.setState({ activePanelId: 'source:description' })
    await act(async () => useStudio.getState().setActiveBlock('description/背景技术/p0002', 'editor'))
    expect(text(el, 'layout:claims')).toBe('claims:claims/2')
    expect(text(el, 'source:description')).toBe('')
  })

  it('标题栏锁按钮 aria-pressed 跟 layout.compareLock', async () => {
    const el = await mount(<SourceCard panelId="source:claims" kind="source" book="claims" active />)
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="card-compare-lock"]')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    await act(async () => btn.click())
    expect(useStudio.getState().compareLock).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('StructureCard / CardHeader', () => {
  it('版面卡片单书只渲染该书纸面（不在 DOM / a11y 树），两张卡片同挂 id 不重复；all 渲染全部；axe 通过', async () => {
    useStudio.setState({ ast: SYNTH_AST, content: SYNTH_MD, saved: SYNTH_MD })
    const el = await mount(
      <>
        <StructureCard panelId="layout:claims" kind="layout" book="claims" active />
        <StructureCard panelId="layout:description" kind="layout" book="description" active={false} />
      </>,
    )
    const claims = el.querySelector('[data-testid="card-structure-claims"]')!
    expect(claims.querySelectorAll('section[data-part]').length).toBe(1)
    expect(claims.querySelector('section[data-part="claims"]')).not.toBeNull()
    expect(claims.querySelector('section[data-part="abstract"], section[data-part="description"]')).toBeNull()
    expect(claims.querySelector('h1')).toBeNull()
    expect(claims.querySelectorAll('[data-testid="structure-editable-toggle"], [data-testid="card-structure-editable"]').length).toBe(0)
    // W9 决策 5：模式开关与三视图 Tab 已上移顶栏（WorkbenchControls），卡头不再有
    expect(claims.querySelector('[data-testid="mode-indicator"], [data-testid="view-tabs"], [data-testid="view-switch"]')).toBeNull()
    const desc = el.querySelector('[data-testid="card-structure-description"]')!
    expect(desc.querySelector('section[data-part="description"]')).not.toBeNull()
    expect(desc.querySelector('section[data-part="claims"]')).toBeNull()
    // 键盘漫游范围 = 本卡片渲染的块
    const claimBlocks = Array.from(claims.querySelectorAll<HTMLElement>('[data-block-id]')).map((b) => b.dataset.blockId)
    expect(claimBlocks).toEqual(SYNTH_AST.claims.map((c) => c.id))
    const ids = Array.from(el.querySelectorAll('[id]')).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(await violations(el)).toEqual([])
    await act(async () => root?.unmount())
    root = null
    host.remove()
    const all = await mount(<StructureCard panelId="layout:all" kind="layout" book="all" active />)
    expect(all.querySelectorAll('section[data-part]').length).toBeGreaterThanOrEqual(3)
    expect(all.querySelector('h1')).not.toBeNull()
  })

  it('有 panelId 时显示「打开为…」；无 panelId 不显示', async () => {
    const el = await mount(
      <>
        <CardHeader title="a" book="claims" panelId="source:claims" switchable={['abstract', 'claims', 'description', 'all']} />
        <CardHeader title="b" book="all" />
      </>,
    )
    expect(el.querySelectorAll('[data-testid="card-open-as"]').length).toBe(1)
    expect(el.textContent).toContain('b')
    expect(await violations(el)).toEqual([])
  })

  it('ux-01：dock 为本卡片登记了面板头插槽 ⇒ 脏标 + actions + 打开为… portal 进 dockview tab 行，卡片内不再多一行头（也不重复书切换）；插槽注销后退回卡片内头', async () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    try {
      setHeaderSlot('source:claims', slot)
      const el = await mount(
        <CardHeader title="claims.md" book="claims" dirty panelId="source:claims" switchable={['abstract', 'claims', 'description', 'all']} actions={<span data-testid="x-action" />} />,
      )
      expect(el.querySelector('[data-testid="card-header"]')).toBeNull()
      const docked = slot.querySelector('[data-testid="card-header"]')!
      expect(docked.getAttribute('data-docked')).toBe('true')
      expect(docked.querySelector('[data-testid="x-action"]')).not.toBeNull()
      expect(docked.querySelector('[data-testid="card-dirty"]')).not.toBeNull()
      expect(docked.querySelector('[data-testid="card-open-as"]')).not.toBeNull()
      expect(docked.querySelector('[role="radiogroup"]')).toBeNull()
      expect(await violations(slot)).toEqual([])
      await act(async () => setHeaderSlot('source:claims', null))
      expect(slot.children.length).toBe(0)
      expect(el.querySelector('[data-testid="card-header"] [role="radiogroup"]')).not.toBeNull()
      expect(el.querySelector('[data-testid="card-header"] [data-testid="x-action"]')).not.toBeNull()
    } finally {
      resetHeaderSlots()
      slot.remove()
    }
  })
})
