// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { CriticMark, Version } from '@/lib/types'
import { useStudio } from '@/store'
import { DEFAULT_COMMENT_FILTER } from '@/store/comments'
import { syncRailWithMode } from '@/components/review/slots'
import { ReviewRail } from '../ReviewRail'
import type { HistoryBlocksDiff } from '@/lib/api'
import { levelForReviewMode, reviewModeFor } from '../markupLevel'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

const DOC = '权利要求 {++一种++}装置\n包括 {~~壳体~>外壳~~}\n以及 {--多余的--}连接件'
const MARKS: CriticMark[] = [
  { id: '1:5', kind: 'ins', line: 1, from: 5, to: 13, a: '', b: '一种', final: '一种', original: '' },
  { id: '2:3', kind: 'sub', line: 2, from: 3, to: 15, a: '壳体', b: '外壳', final: '外壳', original: '壳体' },
  { id: '3:3', kind: 'del', line: 3, from: 3, to: 12, a: '多余的', b: '', final: '', original: '多余的' },
]
const VERSION: Version = { sha: 'abcdef1234567', at: 1_700_000_000, message: 'save', author: '张三', added: 1, deleted: 0 }
const DIFF: HistoryBlocksDiff = {
  a: VERSION.sha,
  b: 'work',
  diff: '',
  blocks: [
    { book: 'claims', block_id: 'claims/1', kind: 'changed', lines: [1, 1] },
    { book: 'claims', block_id: 'claims/9', kind: 'removed', lines: [3, 2] },
    { book: 'description', block_id: 'description/p2', kind: 'added', lines: [7, 8] },
  ],
  blocks_error: null,
}

const fetchMock = vi.fn()
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  desktop = true
  useStudio.setState({ ...initial }, false)
  useStudio.setState({
    pid: 'p1', projectLoading: false, content: DOC, ast: null, marks: MARKS, comments: [], reviewMode: 'final', cursor: { line: 1, col: 1 },
    commentsUnavailable: false, marksUnavailable: false, commentFilter: DEFAULT_COMMENT_FILTER,
    authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false }, members: [],
    loadComments: async () => {}, loadMembers: async () => {},
    enqueue: vi.fn() as never,
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/history/diff')) return new Response(JSON.stringify(DIFF), { status: 200 })
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(api, 'history').mockResolvedValue([VERSION])
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}
const press = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('MarkupLevel ↔ store.review.reviewMode（同一状态驱动版面与 PDF 卡）', () => {
  it('纯映射：all→markup、original→original、simple/none→final；反向 final 保留 simple/none 选择', () => {
    expect(reviewModeFor('all')).toBe('markup')
    expect(reviewModeFor('simple')).toBe('final')
    expect(reviewModeFor('none')).toBe('final')
    expect(reviewModeFor('original')).toBe('original')
    expect(levelForReviewMode('markup', 'none')).toBe('all')
    expect(levelForReviewMode('original', 'all')).toBe('original')
    expect(levelForReviewMode('final', 'simple')).toBe('simple')
    expect(levelForReviewMode('final', 'all')).toBe('none')
  })

  it('setMarkupLevel 联动 reviewMode 并触发重建（enqueue manual）；PDF 卡 setReviewMode 反向联动档位', () => {
    const s = useStudio.getState()
    s.setMarkupLevel('all')
    expect(useStudio.getState().reviewMode).toBe('markup')
    expect(useStudio.getState().enqueue).toHaveBeenCalledWith('manual', true)
    s.setMarkupLevel('simple')
    expect(useStudio.getState().reviewMode).toBe('final')
    s.setMarkupLevel('original')
    expect(useStudio.getState().reviewMode).toBe('original')
    useStudio.getState().setReviewMode('final')
    expect(useStudio.getState().markupLevel).toBe('none')
    useStudio.getState().setReviewMode('markup')
    expect(useStudio.getState().markupLevel).toBe('all')
  })

  it('syncRailWithMode：审阅模式 → 所有标记 + 桌面自动展开；编辑模式 → 无标记且不关栏；带 commentId 打开 → 批注页签；375 不自动弹 Sheet', () => {
    syncRailWithMode('review')
    expect(useStudio.getState().markupLevel).toBe('all')
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    syncRailWithMode('edit')
    expect(useStudio.getState().markupLevel).toBe('none')
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    useStudio.getState().openReviewDrawer({ commentId: 'c1' })
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    useStudio.setState({ reviewDrawerOpen: false })
    desktop = false
    syncRailWithMode('review')
    expect(useStudio.getState().markupLevel).toBe('all')
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })
})

describe('ReviewRail：三 Tab + 四档 + 卡片 ↔ 正文', () => {
  it('修订页签：逐条卡片（类型 / 旧→新 / 接受 / 拒绝 / 回复）；四档 Segmented 切档写 store；axe 0', async () => {
    await mount(<ReviewRail pid="p1" />)
    expect(qa('[data-testid="review-mark"]').length).toBe(3)
    const card = q('[data-mark-id="2:3"]')!
    expect(card.textContent).toContain('壳体')
    expect(card.textContent).toContain('外壳')
    expect(card.querySelector('[data-testid="review-accept"]')).not.toBeNull()
    expect(card.querySelector('[data-testid="review-reject"]')).not.toBeNull()
    expect(card.querySelector('[data-testid="review-mark-reply"]')).not.toBeNull()
    await click(q('[data-testid="markup-level-original"]')!)
    expect(useStudio.getState().markupLevel).toBe('original')
    expect(useStudio.getState().reviewMode).toBe('original')
    expect(await violations(host)).toEqual([])
  })

  it('点卡片 → activeMarkId（正文装饰高亮的依据）；正文 setActiveMark → 卡片 data-active', async () => {
    await mount(<ReviewRail pid="p1" />)
    await click(q('[data-mark-id="1:5"] [data-testid="review-mark-locate"]')!)
    expect(useStudio.getState().activeMarkId).toBe('1:5')
    await act(async () => useStudio.getState().setActiveMark('3:3'))
    expect(q('[data-mark-id="3:3"]')!.getAttribute('data-active')).toBe('true')
    expect(q('[data-mark-id="1:5"]')!.getAttribute('data-active')).toBeNull()
  })

  it('回复：修订卡「回复」→ 切到批注页签并预填引用草稿（anchor line + quote）', async () => {
    await mount(<ReviewRail pid="p1" />)
    await click(q('[data-mark-id="2:3"] [data-testid="review-mark-reply"]')!)
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    const ta = q<HTMLTextAreaElement>('[data-testid="review-comment-body"]') ?? q<HTMLTextAreaElement>('textarea')
    expect(ta).not.toBeNull()
    expect(host.textContent).toContain('壳体')
    expect(useStudio.getState().replyDraft).toBeNull()
  })

  it('已修改页签：拉 versions[0] → work 的 format=blocks；列出块 / 谁 / 何时；点击定位（gotoLine + setFocus）', async () => {
    const gotoLine = vi.fn()
    const setFocus = vi.fn()
    useStudio.setState({ gotoLine, setFocus })
    await mount(<ReviewRail pid="p1" />)
    await press(q('[data-testid="review-rail-tab-changes"]')!)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalled()
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/api/projects/p1/history/diff?')
    expect(url).toContain(`a=${VERSION.sha}`)
    expect(url).toContain('b=work')
    expect(url).toContain('format=blocks')
    expect(q('[data-testid="review-changes-base"]')!.textContent).toContain('相对上一版')
    expect(q('[data-testid="review-changes-base"]')!.textContent).toContain('张三')
    const cards = qa('[data-testid="review-change"]')
    expect(cards.map((c) => c.dataset.kind)).toEqual(['changed', 'removed', 'added'])
    expect(cards[2]!.textContent).not.toMatch(/L\d/)
    await click(cards[0]!.querySelector('[data-testid="review-change-locate"]')!)
    expect(gotoLine).toHaveBeenCalledWith(1)
    expect(setFocus).toHaveBeenCalledWith(expect.objectContaining({ source: 'review', blockId: 'claims/1', line: 1 }))
    expect(await violations(host)).toEqual([])
  })

  it('已修改：无历史版本 → 空态；接口 blocks_error → 错误提示', async () => {
    vi.spyOn(api, 'history').mockResolvedValue([])
    await mount(<ReviewRail pid="p1" />)
    await press(q('[data-testid="review-rail-tab-changes"]')!)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(q('[data-testid="review-changes"]')!.textContent).toContain('尚无历史版本')
    expect(useStudio.getState().historyBlocks).toEqual([])
    // W9 ux-04：无骨架残留；空态说明版本如何产生并给刷新入口
    expect(q('[data-testid="review-changes-skeleton"]')).toBeNull()
    const empty = q('[data-testid="review-changes-empty"]')!
    expect(empty.textContent).toContain('还没有可对比的版本')
    expect(empty.textContent).toContain('每次保存')
    expect(q('[data-testid="review-changes-retry"]')).not.toBeNull()

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...DIFF, blocks: null, blocks_error: { kind: 'structure', message: '缺少权利要求书' } }), { status: 200 }))
    vi.spyOn(api, 'history').mockResolvedValue([VERSION])
    useStudio.setState({ versions: [VERSION] })
    await act(async () => useStudio.getState().loadBlockChanges('p1'))
    expect(useStudio.getState().historyBlocksError).toBe('缺少权利要求书')
    expect(q('[data-testid="review-changes-error"]')!.textContent).toContain('缺少权利要求书')
  })

  it('375：控件 44px 命中区（touch-hit / min-h-touch）', async () => {
    desktop = false
    await mount(<ReviewRail pid="p1" />)
    const accept = q('[data-mark-id="1:5"] [data-testid="review-accept"]')!
    expect(accept.className).toContain('touch-hit')
    await press(q('[data-testid="review-rail-tab-changes"]')!)
    await act(async () => {
      await Promise.resolve()
    })
    const locate = q('[data-testid="review-change-locate"]')!
    expect(locate.className).toContain('min-h-touch')
  })
})
