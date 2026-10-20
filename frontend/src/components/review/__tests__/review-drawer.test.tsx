// @vitest-environment jsdom
import axe from 'axe-core'
import { act, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import { DEFAULT_COMMENT_FILTER, matchesCommentFilter, selectFilteredComments } from '@/store/comments'
import type { Comment, CriticMark, Member } from '@/lib/types'
import { ReviewDrawer, ReviewDrawerButton, openReviewHost, selectReviewHost } from '../ReviewDrawer'
import { ReviewPanel } from '../ReviewPanel'
import { AssignReviewDialog } from '../AssignReviewDialog'
import { MentionTextarea } from '../MentionTextarea'
import { bookForAnchor } from '../reviewUtils'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

/** 三行各一条建议（不同行 → 逐条接受后其余偏移仍有效） */
const DOC = '权利要求 {++一种++}装置\n包括 {~~壳体~>外壳~~}\n以及 {--多余的--}连接件'
const line = (n: number) => DOC.split('\n')[n - 1]
function mk(id: string, kind: CriticMark['kind'], ln: number, open: string, close: string, a: string, b: string, final: string, original: string): CriticMark {
  const s = line(ln)
  const from = s.indexOf(open)
  const to = s.indexOf(close, from) + close.length
  return { id, kind, line: ln, from, to, a, b, final, original }
}
const MARKS: CriticMark[] = [
  mk('m1', 'ins', 1, '{++', '++}', '', '一种', '一种', ''),
  mk('m2', 'sub', 2, '{~~', '~~}', '壳体', '外壳', '外壳', '壳体'),
  mk('m3', 'del', 3, '{--', '--}', '多余的', '', '', '多余的'),
]
const CLEAN = '权利要求 一种装置\n包括 外壳\n以及 连接件'

const comment = (id: string, o: Partial<Comment> & { author?: Comment['author'] } = {}): Comment => ({
  id,
  anchor: { block_id: 'claims/1', line: 1, quote: 'q', stale: false },
  body: `批注 ${id}`,
  author: { id: 'u2', name: '张三' },
  created_at: 0,
  updated_at: 0,
  resolved: false,
  replies: [],
  ...o,
})
const MEMBERS: Member[] = [
  { user_id: 'u1', email: 'me@x.com', display_name: '我', role: 'owner' },
  { user_id: 'u2', email: 'zhang@x.com', display_name: '张三', role: 'editor' },
  { user_id: 'u3', email: 'li@x.com', display_name: '李四', role: 'reviewer' },
]

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
  useStudio.setState({
    pid: 'p1', projectLoading: false, content: DOC, ast: null, comments: [], marks: [], reviewMode: 'final', cursor: { line: 1, col: 1 },
    commentsUnavailable: false, marksUnavailable: false, commentsLoading: false, commentsError: null, activeCommentId: null, pendingCommentId: null,
    commentFilter: DEFAULT_COMMENT_FILTER, reviewDrawerOpen: false, reviewRequest: null, reviewAssignUnavailable: false, reviewRailTab: 'marks', activeMarkId: null, replyDraft: null,
    commentDraft: null, replyBodies: {},
    historyBlocks: null, historyBlocksBase: null, historyBlocksLoading: false, historyBlocksError: null, loadBlockChanges: async () => {},
    authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false }, members: MEMBERS,
    loadComments: async () => {}, loadMembers: async () => {},
    mobileTab: 'edit', mobileNav: { open: false, tab: 'outline' },
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
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
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const body = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel)
const bodyAll = <T extends HTMLElement>(sel: string) => [...document.body.querySelectorAll<T>(sel)]
/** Radix Tabs 在 mousedown 激活 */
const press = (el: Element) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
/** 绕过 React 的 value tracker：用原生 setter 写值再派发 input，onChange 才会触发 */
const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
function type(ta: HTMLTextAreaElement, v: string) {
  nativeValue.call(ta, v)
  ta.setSelectionRange(v.length, v.length)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('store/comments 筛选', () => {
  it('状态 / 来源 / 人 三维筛选；默认只看未解决', () => {
    const cs = [
      comment('a'),
      comment('b', { resolved: true }),
      comment('c', { author: { id: 'ai', name: 'AI 审阅' } }),
      { ...comment('d', { author: { id: null, name: '客户王五' } }), guest: '客户王五' } as Comment,
    ]
    expect(selectFilteredComments({ comments: cs, commentFilter: DEFAULT_COMMENT_FILTER }).map((c) => c.id)).toEqual(['a', 'c', 'd'])
    expect(cs.filter((c) => matchesCommentFilter(c, { status: 'resolved', source: 'all', author: null })).map((c) => c.id)).toEqual(['b'])
    expect(cs.filter((c) => matchesCommentFilter(c, { status: 'all', source: 'ai', author: null })).map((c) => c.id)).toEqual(['c'])
    expect(cs.filter((c) => matchesCommentFilter(c, { status: 'all', source: 'client', author: null })).map((c) => c.id)).toEqual(['d'])
    expect(cs.filter((c) => matchesCommentFilter(c, { status: 'all', source: 'human', author: null })).map((c) => c.id)).toEqual(['a', 'b'])
    expect(cs.filter((c) => matchesCommentFilter(c, { status: 'all', source: 'all', author: 'u2' })).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('bookForAnchor：按 block_id 前缀 / AST 归书，默认说明书', () => {
    expect(bookForAnchor(null, 'claims/1', 1)).toBe('claims')
    expect(bookForAnchor(null, 'abstract', 1)).toBe('abstract')
    expect(bookForAnchor(null, 'description/3', 1)).toBe('description')
    expect(bookForAnchor(null, 'blk', 1)).toBe('description')
  })
})

describe('ReviewDrawer 桌面（U10：右侧 320 Drawer，编辑器保持可见）', () => {
  it('TopBar 按钮切换 Drawer；Drawer 为非模态 Sheet（无遮罩），含修订与批注；Esc 关闭；axe 0 serious/critical', async () => {
    useStudio.setState({ marks: MARKS, comments: [comment('a'), comment('b', { resolved: true })] })
    await mount(<ReviewDrawer />)
    expect(body('[data-testid="review-drawer"]')).toBeNull()
    await act(async () => useStudio.getState().openReviewDrawer())
    const drawer = body('[data-testid="review-drawer"]')!
    expect(drawer).not.toBeNull()
    expect(drawer.className).toContain('w-drawer')
    expect(body('[data-slot="sheet-overlay"]')).toBeNull()
    expect(drawer.getAttribute('aria-modal')).not.toBe('true')
    expect(drawer.querySelectorAll('[data-testid="review-mark"]').length).toBe(3)
    expect(drawer.querySelector('[data-testid="markup-level"]')).not.toBeNull()
    expect(await violations(document.body)).toEqual([])
    await act(async () => press(drawer.querySelector<HTMLButtonElement>('[data-testid="review-rail-tab-comments"]')!))
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    expect(drawer.querySelector('[data-testid="review-open-count"]')!.textContent).toBe('1')
    // 批70：修订页签 forceMount 常驻——切走不卸载（保住输入中的回复草稿），仅转 inactive（data-[state=inactive]:hidden 隐藏）
    const marksPane = [...drawer.querySelectorAll('[role="tabpanel"]')].find((p) => p.querySelector('[data-testid="review-mark"]'))!
    expect(drawer.querySelectorAll('[data-testid="review-mark"]').length).toBe(3)
    expect(marksPane.getAttribute('data-state')).toBe('inactive')
    expect(marksPane.className).toContain('data-[state=inactive]:hidden')
    expect(await violations(document.body)).toEqual([])
    await act(async () => key(drawer, 'Escape'))
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })

  it('批注筛选：默认「未解决」只列未解决并折叠已解决；切「已解决」/「全部」；来源筛选 AI 只剩 AI 批注', async () => {
    useStudio.setState({
      reviewDrawerOpen: true,
      reviewRailTab: 'comments',
      comments: [comment('a'), comment('b', { resolved: true }), comment('c', { author: { id: 'ai', name: 'AI 审阅' }, anchor: { block_id: 'claims/2', line: 2, quote: 'q', stale: false } })],
    })
    await mount(<ReviewDrawer />)
    const drawer = body('[data-testid="review-drawer"]')!
    const ids = () => bodyAll('[data-testid="review-comment"]').map((el) => el.getAttribute('data-comment-id'))
    expect(ids()).toEqual(['a', 'c'])
    expect(drawer.querySelector('[data-testid="review-toggle-resolved"]')!.textContent).toContain('1')
    expect(drawer.querySelector('[data-testid="comment-ai-badge"]')).not.toBeNull()
    await act(async () => drawer.querySelector<HTMLButtonElement>('[data-testid="review-filter-resolved"]')!.click())
    expect(useStudio.getState().commentFilter.status).toBe('resolved')
    expect(ids()).toEqual(['b'])
    await act(async () => drawer.querySelector<HTMLButtonElement>('[data-testid="review-filter-all"]')!.click())
    expect(ids()).toEqual(['a', 'b', 'c'])
    await act(async () => useStudio.getState().setCommentFilter({ source: 'ai' }))
    expect(ids()).toEqual(['c'])
    await act(async () => useStudio.getState().setCommentFilter({ source: 'all', author: 'u2' }))
    expect(ids()).toEqual(['a', 'b'])
    await act(async () => useStudio.getState().setCommentFilter({ author: 'nobody' }))
    expect(drawer.querySelector('[data-testid="review-filter-empty"]')).not.toBeNull()
  })

  it('定位 = setFocus{source:review, book, blockId, line} + gotoLine；回复 / 解决 / 重开 走 store', async () => {
    const gotoLine = vi.fn()
    const setFocus = vi.fn()
    const resolveComment = vi.fn(async (_p: string, cid: string, resolved = true) => {
      useStudio.setState({ comments: useStudio.getState().comments.map((c) => (c.id === cid ? { ...c, resolved } : c)) })
    })
    const replyComment = vi.fn(async (_p: string, cid: string, text: string) => {
      useStudio.setState({
        comments: useStudio.getState().comments.map((c) => (c.id === cid ? { ...c, replies: [...c.replies, { id: 'r1', body: text, author: { id: 'u1', name: '我' }, created_at: 1 }] } : c)),
      })
    })
    useStudio.setState({ reviewDrawerOpen: true, reviewRailTab: 'comments', comments: [comment('a', { anchor: { block_id: 'claims/2', line: 2, quote: 'q', stale: false } })], gotoLine, setFocus, resolveComment, replyComment })
    await mount(<ReviewDrawer />)
    const card = body('[data-comment-id="a"]')!
    await act(async () => card.querySelector<HTMLButtonElement>('[data-testid="review-locate"]')!.click())
    expect(setFocus).toHaveBeenCalledWith({ source: 'review', book: 'claims', blockId: 'claims/2', line: 2 })
    expect(gotoLine).toHaveBeenCalledWith(2)
    expect(useStudio.getState().activeCommentId).toBe('a')

    await act(async () => card.querySelector<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    const ta = body<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!
    await act(async () => {
      type(ta, '收到 @张三')
    })
    await act(async () => body<HTMLButtonElement>('[data-testid="review-reply-submit"]')!.click())
    expect(replyComment).toHaveBeenCalledWith('p1', 'a', '收到 @张三')
    expect(body('[data-comment-id="a"]')!.textContent).toContain('收到 @张三')

    await act(async () => body<HTMLButtonElement>('[data-comment-id="a"] [data-testid="review-resolve"]')!.click())
    expect(resolveComment).toHaveBeenLastCalledWith('p1', 'a', true)
    await act(async () => body<HTMLButtonElement>('[data-testid="review-toggle-resolved"]')!.click())
    await act(async () => body<HTMLButtonElement>('[data-comment-id="a"] [data-testid="review-resolve"]')!.click())
    expect(resolveComment).toHaveBeenLastCalledWith('p1', 'a', false)
  })

  it('修订「定位」也 setFocus；501（comments）→ EmptyState「功能开发中」', async () => {
    const setFocus = vi.fn()
    useStudio.setState({ reviewDrawerOpen: true, marks: MARKS, setFocus, gotoLine: vi.fn() })
    await mount(<ReviewDrawer />)
    await act(async () => body<HTMLButtonElement>('[data-mark-id="m2"] [data-testid="review-mark-locate"]')!.click())
    expect(setFocus).not.toHaveBeenCalled() // 无 AST → 无 blockId，仅 gotoLine（焦点契约要求 blockId）
    await act(async () => useStudio.setState({ commentsUnavailable: true }))
    const empty = body('[data-testid="review-unavailable"]')!
    expect(empty.getAttribute('data-slot')).toBe('empty-state')
    expect(empty.textContent).toContain('功能开发中')
  })

  it('ReviewPanel（旧 dock 卡 / Rail 页签）下线为伴随栏入口：不再内嵌列表，按钮切换 reviewDrawerOpen', async () => {
    useStudio.setState({ marks: MARKS, comments: [comment('a')] })
    const el = await mount(<ReviewPanel />)
    expect(el.querySelectorAll('[data-testid="review-mark"]').length).toBe(0)
    expect(el.textContent).toContain('修订 3 处')
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="review-open-sheet"]')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    await act(async () => btn.click())
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.textContent).toContain('收起审阅栏')
  })
})

describe('23-w12 §4 第二步：顶栏唯一「审阅」入口（ReviewDrawerButton）按视图 / 视口选一个宿主', () => {
  let originalMatchMedia: typeof window.matchMedia
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })
  /** 按视口宽度回答 (min-width: Npx)，覆盖文件级 matchMedia 的「所有 min-width 同真」 */
  function viewport(width: number) {
    window.matchMedia = (q: string) => {
      const m = /min-width:\s*(\d+)px/.exec(q)
      return { matches: m ? width >= Number(m[1]) : false, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList
    }
  }
  const layout = () => useStudio.setState({ activePanelId: 'layout:all', editorView: 'layout', rightRailOpen: false, rightRailSheetOpen: false, rightRailColumnFits: true })
  const source = () => useStudio.setState({ activePanelId: 'source:all', editorView: 'source', rightRailOpen: false, rightRailSheetOpen: false, rightRailColumnFits: true })
  const btn = () => body<HTMLButtonElement>('[data-testid="topbar-review"]')!

  it('selectReviewHost：桌面版面 → 列（够宽）/ Sheet（不够宽或 <1280）；源码 / PDF 或 <1024 → drawer', () => {
    const L = { activePanelId: 'layout:all', editorView: 'layout', rightRailColumnFits: true } as const
    expect(selectReviewHost(L, true, true)).toBe('rail-column')
    expect(selectReviewHost({ ...L, rightRailColumnFits: false }, true, true)).toBe('rail-sheet')
    expect(selectReviewHost(L, true, false)).toBe('rail-sheet')
    expect(selectReviewHost(L, false, false)).toBe('drawer')
    expect(selectReviewHost({ activePanelId: 'source:all', editorView: 'source', rightRailColumnFits: true }, true, true)).toBe('drawer')
    expect(selectReviewHost({ activePanelId: 'pdf:all', editorView: 'source', rightRailColumnFits: true }, true, true)).toBe('drawer')
  })

  it('源码视图 1440：按钮带字「审阅」+ 合计 Count（修订 3 + 未解决 1 = 4），切 reviewDrawerOpen；ReviewDrawer 出现；axe 0', async () => {
    viewport(1440)
    source()
    useStudio.setState({ marks: MARKS, comments: [comment('a'), comment('b', { resolved: true })] })
    await mount(
      <>
        <ReviewDrawerButton />
        <ReviewDrawer />
      </>,
    )
    const b = btn()
    expect(b.getAttribute('data-review-host')).toBe('drawer')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('aria-label')).toContain('3 处修订、1 条未解决批注')
    expect(b.querySelector('[data-testid="topbar-review-badge"]')!.textContent).toBe('4')
    const text = [...b.querySelectorAll('span')].find((n) => n.textContent === '审阅修订')!
    expect(text.className).toMatch(/\bhidden\b/)
    expect(text.className).toMatch(/\bxl:inline\b/)
    await act(async () => b.click())
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(useStudio.getState().rightRailOpen).toBe(false)
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    expect(body('[data-testid="review-drawer"]')).not.toBeNull()
    expect(await violations(document.body)).toEqual([])
    await act(async () => btn().click())
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })

  it('版面视图 1440（卡身够宽）：同一按钮切 rightRailOpen 列；ReviewDrawer 不再另开（即使 reviewDrawerOpen=true）', async () => {
    viewport(1440)
    layout()
    useStudio.setState({ reviewDrawerOpen: true })
    await mount(
      <>
        <ReviewDrawerButton />
        <ReviewDrawer />
      </>,
    )
    expect(body('[data-testid="review-drawer"]')).toBeNull()
    const b = btn()
    expect(b.getAttribute('data-review-host')).toBe('rail-column')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    await act(async () => b.click())
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
    expect(btn().getAttribute('aria-pressed')).toBe('true')
    await act(async () => btn().click())
    expect(useStudio.getState().rightRailOpen).toBe(false)
  })

  it('版面视图 1024（<1280，桌面）：同一按钮切 rightRailSheetOpen（版面卡右 Sheet），不再走底部 Drawer；ReviewDrawer 不渲染', async () => {
    viewport(1024)
    layout()
    useStudio.setState({ reviewDrawerOpen: true })
    await mount(
      <>
        <ReviewDrawerButton />
        <ReviewDrawer />
      </>,
    )
    expect(body('[data-testid="review-drawer"]')).toBeNull()
    const b = btn()
    expect(b.getAttribute('data-review-host')).toBe('rail-sheet')
    await act(async () => b.click())
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(btn().getAttribute('aria-pressed')).toBe('true')
  })

  it('版面视图 375（<1024）：宿主回到 drawer（底部 Sheet），与源码视图一致', async () => {
    viewport(375)
    layout()
    await mount(
      <>
        <ReviewDrawerButton />
        <ReviewDrawer />
      </>,
    )
    const b = btn()
    expect(b.getAttribute('data-review-host')).toBe('drawer')
    await act(async () => b.click())
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(body('[data-testid="review-sheet"]')).not.toBeNull()
  })

  it('375 NavDrawer「审阅」页签：ReviewPanel 挂载即 openReviewDrawer → 关掉 NavDrawer（互斥）→ 面板卸载；Sheet 本体不在面板内、由外壳常驻挂载才留得住', async () => {
    viewport(375)
    source()
    useStudio.setState({ mobileNav: { open: true, tab: 'review' }, reviewDrawerOpen: false })
    // 模拟 NavDrawer：mobileNav.open 才渲染 ReviewPanel
    function Nav() {
      const navOpen = useStudio((s) => s.mobileNav.open)
      return navOpen ? <ReviewPanel /> : null
    }
    const el = await mount(<Nav />)
    await act(async () => {})
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(useStudio.getState().mobileNav.open).toBe(false)
    expect(el.querySelector('[data-testid="review-panel"]')).toBeNull()
    // 面板自己不挂 Sheet（挂了也随卸载消失）；Sheet 由 MobileShell 常驻挂载（见 mobile.layout-view.test）
    expect(body('[data-testid="review-sheet"]')).toBeNull()
    await act(async () => root?.unmount())
    await mount(<ReviewDrawer />)
    expect(body('[data-testid="review-sheet"]')).not.toBeNull()
  })

  it('openReviewHost：源码 → openReviewDrawer；版面 1440 → rightRailOpen + 批注页签 + focusComment；版面 1024 → rightRailSheetOpen；伴随栏让位', () => {
    viewport(1440)
    source()
    useStudio.setState({ companion: 'ai' })
    openReviewHost({ commentId: 'c1' })
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(useStudio.getState().activeCommentId).toBe('c1')
    expect(useStudio.getState().companion).toBeNull()
    useStudio.setState({ reviewDrawerOpen: false, activeCommentId: null, reviewRailTab: 'marks', companion: 'ai' })
    layout()
    openReviewHost({ commentId: 'c2' })
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    expect(useStudio.getState().activeCommentId).toBe('c2')
    expect(useStudio.getState().companion).toBeNull()
    viewport(1024)
    layout()
    openReviewHost()
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })

  it('openReviewHost 1440 版面在版面卡量宽之前到达（fits 仍默认 true → 按列打开）：随后实测窄卡退到 Sheet 时 Sheet 要接着开，批注焦点保留（W12 R4 深链什么都不见）', () => {
    viewport(1440)
    layout()
    openReviewHost({ commentId: 'c9' })
    expect(useStudio.getState().rightRailOpen).toBe(true)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
    expect(useStudio.getState().rightRailReveal).toBe(true)
    // LayoutRightRail ResizeObserver 量到三栏 dock 窄卡
    useStudio.getState().setRightRailColumnFits(false)
    expect(useStudio.getState().rightRailSheetOpen).toBe(true)
    expect(useStudio.getState().rightRailReveal).toBe(false)
    expect(useStudio.getState().activeCommentId).toBe('c9')
    expect(useStudio.getState().reviewRailTab).toBe('comments')
    // 宽卡：列本来就渲染，意图结清、不弹 Sheet
    useStudio.setState({ rightRailSheetOpen: false, rightRailColumnFits: true })
    openReviewHost()
    useStudio.getState().setRightRailColumnFits(true)
    expect(useStudio.getState().rightRailReveal).toBe(false)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
    // 没有打开意图时，用户把卡拖窄只是退到（关着的）Sheet，不会凭空弹出
    useStudio.getState().setRightRailColumnFits(false)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
    // 手动收起列即撤销意图
    useStudio.setState({ rightRailColumnFits: true })
    openReviewHost()
    useStudio.getState().setRightRailOpen(false)
    useStudio.getState().setRightRailColumnFits(false)
    expect(useStudio.getState().rightRailSheetOpen).toBe(false)
  })

  it('无 pid 不渲染', async () => {
    useStudio.setState({ pid: null })
    await mount(<ReviewDrawerButton />)
    expect(body('[data-testid="topbar-review"]')).toBeNull()
  })
})

describe('@ 提及（cmdk Command 成员列表）', () => {
  it('输入 @ 弹出成员列表，过滤、方向键、Enter 插入 @显示名', async () => {
    const onValueChange = vi.fn()
    function Host() {
      const [v, setV] = useState('')
      return (
        <MentionTextarea
          value={v}
          onValueChange={(x) => {
            setV(x)
            onValueChange(x)
          }}
          aria-label="正文"
          data-testid="ta"
        />
      )
    }
    await mount(<Host />)
    const ta = host.querySelector<HTMLTextAreaElement>('[data-testid="ta"]')!
    expect(host.querySelector('[data-testid="mention-list"]')).toBeNull()
    await act(async () => {
      type(ta, '请 @')
    })
    const list = host.querySelector('[data-testid="mention-list"]')!
    expect(list).not.toBeNull()
    expect(list.querySelectorAll('[data-testid^="mention-item-"]').length).toBe(3)
    expect(list.querySelector('[data-testid="mention-item-u1"]')!.getAttribute('aria-selected')).toBe('true')
    expect(await violations(host)).toEqual([])
    await act(async () => key(ta, 'ArrowDown'))
    expect(list.querySelector('[data-testid="mention-item-u2"]')!.getAttribute('aria-selected')).toBe('true')
    await act(async () => {
      type(ta, '请 @李')
    })
    expect(host.querySelectorAll('[data-testid^="mention-item-"]').length).toBe(1)
    await act(async () => key(ta, 'Enter'))
    expect(onValueChange).toHaveBeenLastCalledWith('请 @李四 ')
    expect(host.querySelector('[data-testid="mention-list"]')).toBeNull()
  })

  it('Escape 关列表不清正文；无匹配显示「没有匹配的成员」', async () => {
    const onValueChange = vi.fn()
    await mount(<MentionTextarea value="" onValueChange={onValueChange} aria-label="正文" data-testid="ta" />)
    const ta = host.querySelector<HTMLTextAreaElement>('[data-testid="ta"]')!
    await act(async () => {
      type(ta, '@张')
    })
    expect(host.querySelector('[data-testid="mention-list"]')).not.toBeNull()
    await act(async () => key(ta, 'Escape'))
    expect(host.querySelector('[data-testid="mention-list"]')).toBeNull()
    await act(async () => {
      type(ta, '@zzz')
    })
    expect(host.querySelector('[data-testid="mention-list"]')!.textContent).toContain('没有匹配的成员')
    expect(onValueChange).toHaveBeenLastCalledWith('@zzz')
  })
})

describe('W12 R12-02（docs/plan/31）：审阅 Sheet 内批注 / 回复草稿 Esc 一下只收表单，不关宿主', () => {
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)))
  /** 上一组用例把视图切到 layout 后 ReviewDrawer 不再是审阅宿主，这里回到源码视图 */
  beforeEach(() => useStudio.setState({ activePanelId: 'source:all', editorView: 'source', rightRailOpen: false, rightRailSheetOpen: false }))

  it('回复表单带 data-esc-local；textarea 上 Esc → 表单收、Drawer 仍开、焦点回「回复」；再 Esc 才关 Drawer', async () => {
    useStudio.setState({ reviewDrawerOpen: true, reviewRailTab: 'comments', comments: [comment('a')] })
    await mount(<ReviewDrawer />)
    const drawer = body('[data-testid="review-drawer"]')!
    expect(drawer.querySelector('[data-esc-local]')).toBeNull()
    await act(async () => body<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    const form = body<HTMLFormElement>('[data-testid="review-reply-form"]')!
    expect(form.hasAttribute('data-esc-local')).toBe(true)
    const ta = body<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!
    await act(async () => {
      type(ta, 'R12-02 未发送')
    })
    ta.focus()
    // 批69：脏稿 Esc 先弹 DiscardDialog——表单留住，确认放弃才收
    await act(async () => key(ta, 'Escape'))
    await settle()
    expect(body('[data-testid="review-reply-form"]')).not.toBeNull()
    expect(body('[data-testid="discard-dialog"]')).not.toBeNull()
    await act(async () => body<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click())
    await settle()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(body('[data-testid="review-drawer"]')).not.toBeNull()
    expect(body('[data-testid="review-reply-form"]')).toBeNull()
    expect(body('[data-esc-local]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('review-reply-open')
    await act(async () => key(document.activeElement!, 'Escape'))
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
  })

  it('焦点在表单「取消」按钮上 Esc 同样只收表单；成员菜单打开时 Esc 只关菜单、草稿与 Drawer 都留住', async () => {
    useStudio.setState({ reviewDrawerOpen: true, reviewRailTab: 'comments', comments: [comment('a')] })
    await mount(<ReviewDrawer />)
    await act(async () => body<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    const cancel = [...body<HTMLFormElement>('[data-testid="review-reply-form"]')!.querySelectorAll('button')].find((b) => b.textContent === '取消')!
    cancel.focus()
    await act(async () => key(cancel, 'Escape'))
    await settle()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(body('[data-testid="review-reply-form"]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('review-reply-open')

    await act(async () => body<HTMLButtonElement>('[data-testid="review-reply-open"]')!.click())
    const ta = body<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!
    await act(async () => {
      type(ta, 'R12-02 @张')
    })
    expect(body('[data-testid="mention-list"]')).not.toBeNull()
    await act(async () => key(ta, 'Escape'))
    await settle()
    expect(body('[data-testid="mention-list"]')).toBeNull()
    expect(body<HTMLTextAreaElement>('[data-testid="review-reply-body"]')!.value).toBe('R12-02 @张')
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
  })

  it('新批注草稿（修订卡「回复」→ replyDraft 开的表单）带 data-esc-local；Esc → 表单收、Drawer 仍开、焦点回「添加批注」', async () => {
    useStudio.setState({ reviewDrawerOpen: true, reviewRailTab: 'comments', comments: [comment('a')] })
    await mount(<ReviewDrawer />)
    await act(async () => useStudio.setState({ replyDraft: { line: 1, quote: '权利要求' } }))
    const form = body<HTMLFormElement>('[data-testid="review-draft"]')!
    expect(form).not.toBeNull()
    expect(form.hasAttribute('data-esc-local')).toBe(true)
    const ta = body<HTMLTextAreaElement>('[data-testid="review-draft-body"]')!
    await act(async () => {
      type(ta, 'R12-02 草稿')
    })
    // 批69：脏稿 Esc 先弹 DiscardDialog——确认放弃才收表单、回焦
    await act(async () => key(ta, 'Escape'))
    await settle()
    expect(body('[data-testid="review-draft"]')).not.toBeNull()
    await act(async () => body<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click())
    await settle()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(body('[data-testid="review-draft"]')).toBeNull()
    expect(body('[data-esc-local]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('review-add-comment')
  })
})

describe('指派审阅 Dialog（api.reviewAssign）', () => {
  it('提交 POST /review-assign {user_id, due}；501 → 功能开发中提示且禁用提交', async () => {
    const calls: { url: string; body: unknown }[] = []
    let status = 200
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (status === 501) return new Response(JSON.stringify({ detail: { kind: 'not_implemented', message: 'x', detail: 'review' } }), { status: 501 })
        return new Response(JSON.stringify({ deadline_id: 'd1' }), { status: 200 })
      }),
    )
    const toast = vi.fn()
    useStudio.setState({ toast })
    const r = await useStudio.getState().assignReview('p1', 'u3', '2026-09-30')
    expect(r).toEqual({ deadline_id: 'd1' })
    expect(calls[0]).toEqual({ url: '/api/projects/p1/review-assign', body: { user_id: 'u3', due: '2026-09-30' } })
    status = 501
    expect(await useStudio.getState().assignReview('p1', 'u3', null)).toBeNull()
    expect(useStudio.getState().reviewAssignUnavailable).toBe(true)
    await mount(<AssignReviewDialog open onOpenChange={() => {}} />)
    const dlg = body('[data-testid="assign-dialog"]')!
    expect(dlg.querySelector('[data-testid="assign-unavailable"]')!.textContent).toContain('功能开发中')
    expect(dlg.querySelector<HTMLButtonElement>('[data-testid="assign-submit"]')!.disabled).toBe(true)
    expect(dlg.querySelector('[data-testid="assign-due"]')!.getAttribute('type')).toBe('date')
    expect(await violations(document.body)).toEqual([])
  })
})

describe('375（U12：全屏 Sheet，44px 逐条处置）', () => {
  it('三条建议逐条接受后源码干净、marks 清空；控件 md 36 + touch-hit（W8）；定位切编辑 Tab 并关 Sheet', async () => {
    desktop = false
    const setFocus = vi.fn()
    useStudio.setState({ marks: MARKS, reviewDrawerOpen: true, setFocus, comments: [comment('a', { anchor: { block_id: 'claims/1', line: 1, quote: 'q', stale: false } })], mobileTab: 'preview' })
    await mount(<ReviewDrawer />)
    const sheet = body('[data-testid="review-sheet"]')!
    expect(sheet).not.toBeNull()
    expect(body('[data-testid="review-drawer"]')).toBeNull()
    const accept = sheet.querySelector<HTMLButtonElement>('[data-mark-id="m1"] [data-testid="review-accept"]')!
    for (const c of [accept, sheet.querySelector('[data-testid="review-mark-reply"]')!]) {
      expect(c.className).toContain('h-md-control')
      expect(c.className).toContain('touch-hit')
      expect(c.className).not.toContain('h-touch')
    }
    for (const id of ['m1', 'm2', 'm3']) {
      await act(async () => sheet.querySelector<HTMLButtonElement>(`[data-mark-id="${id}"] [data-testid="review-accept"]`)!.click())
    }
    expect(useStudio.getState().content).toBe(CLEAN)
    expect(useStudio.getState().marks).toEqual([])
    expect(sheet.textContent).toContain('无修订标记')
    expect(await violations(document.body)).toEqual([])

    await act(async () => press(sheet.querySelector<HTMLButtonElement>('[data-testid="review-rail-tab-comments"]')!))
    for (const c of [sheet.querySelector('[data-testid="review-reply-open"]')!, sheet.querySelector('[data-testid="review-resolve"]')!]) {
      expect(c.className).toContain('h-md-control')
      expect(c.className).toContain('touch-hit')
    }
    await act(async () => sheet.querySelector<HTMLButtonElement>('[data-testid="review-locate"]')!.click())
    expect(setFocus).toHaveBeenCalledWith({ source: 'review', book: 'claims', blockId: 'claims/1', line: 1 })
    expect(useStudio.getState().reviewDrawerOpen).toBe(false)
    expect(useStudio.getState().mobileTab).toBe('preview')
  })

  it('375 拒绝三条 → 恢复原文；键盘：Tab 序内所有控件为 button/textarea', async () => {
    desktop = false
    useStudio.setState({ marks: MARKS, reviewDrawerOpen: true })
    await mount(<ReviewDrawer />)
    const sheet = body('[data-testid="review-sheet"]')!
    for (const id of ['m1', 'm2', 'm3']) {
      await act(async () => sheet.querySelector<HTMLButtonElement>(`[data-mark-id="${id}"] [data-testid="review-reject"]`)!.click())
    }
    expect(useStudio.getState().content).toBe('权利要求 装置\n包括 壳体\n以及 多余的连接件')
    const focusables = () => [...sheet.querySelectorAll<HTMLElement>('button, [href], textarea, input, [tabindex]')]
    expect(focusables().some((el) => el.dataset.testid === 'review-rail-tab-comments')).toBe(true)
    await act(async () => press(sheet.querySelector<HTMLButtonElement>('[data-testid="review-rail-tab-comments"]')!))
    expect(focusables().some((el) => el.dataset.testid === 'review-add-comment')).toBe(true)
    expect(focusables().filter((el) => el.getAttribute('tabindex') === '-1' && !['tab', 'radio'].includes(el.getAttribute('role') ?? ''))).toEqual([])
  })
})

describe('R64：批注链修复回归', () => {
  it('R64-02 无显示名成员 @ 插入 email 本地段（整 email 的第二个 @ 会被后端解析截断）', async () => {
    const noName: Member = { user_id: 'u9', email: 'solo@x.com', display_name: '', role: 'viewer' }
    const onValueChange = vi.fn()
    function Host() {
      const [v, setV] = useState('')
      return <MentionTextarea value={v} onValueChange={(x) => { setV(x); onValueChange(x) }} members={[noName]} aria-label="正文" data-testid="ta" />
    }
    await mount(<Host />)
    const ta = host.querySelector<HTMLTextAreaElement>('[data-testid="ta"]')!
    await act(async () => type(ta, '@so'))
    expect(host.querySelectorAll('[data-testid^="mention-item-"]').length).toBe(1)
    await act(async () => key(ta, 'Enter'))
    expect(onValueChange).toHaveBeenLastCalledWith('@solo ')
  })

  it('R64-01 viewer 对他人批注：解决/删除钮禁用；自己的批注可用', async () => {
    useStudio.setState({
      project: { role: 'viewer' } as never,
      reviewDrawerOpen: true, reviewRailTab: 'comments',
      comments: [comment('other'), comment('mine', { author: { id: 'u1', name: '我' } })],
    })
    await mount(<ReviewDrawer />)
    const other = body<HTMLElement>('[data-comment-id="other"]')!
    expect(other.querySelector<HTMLButtonElement>('[data-testid="review-resolve"]')!.disabled).toBe(true)
    expect(other.querySelector<HTMLButtonElement>('[data-testid="review-delete"]')!.disabled).toBe(true)
    expect(other.querySelector<HTMLButtonElement>('[data-testid="review-reply-open"]')!.disabled).toBe(false)
    const mine = body<HTMLElement>('[data-comment-id="mine"]')!
    expect(mine.querySelector<HTMLButtonElement>('[data-testid="review-resolve"]')!.disabled).toBe(false)
    expect(mine.querySelector<HTMLButtonElement>('[data-testid="review-delete"]')!.disabled).toBe(false)
  })

  it('R64-04 API 透 source=client 的批注渲染「客户」徽标', async () => {
    useStudio.setState({
      reviewDrawerOpen: true, reviewRailTab: 'comments',
      comments: [comment('c1', { author: { id: null, name: '客户甲' }, source: 'client' })],
    })
    await mount(<ReviewDrawer />)
    expect(body('[data-testid="comment-client-badge"]')!.textContent).toBe('客户')
  })

  it('R64-03 ?c= 深链到未加载批注：强刷一次仍无 ⇒ toast + 清 pending（不再静默丢参数）', async () => {
    const toast = vi.fn()
    const loadComments = vi.fn(async () => { useStudio.setState({ comments: [], commentsLoading: false }) })
    useStudio.setState({
      reviewDrawerOpen: true, reviewRailTab: 'comments', pendingCommentId: 'ghost',
      comments: [], commentsLoading: false, toast, loadComments,
    })
    await mount(<ReviewDrawer />)
    await act(async () => new Promise((r) => setTimeout(r, 10)))
    expect(loadComments).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('该批注不存在或已被删除', 'info')
    expect(useStudio.getState().pendingCommentId).toBeNull()
  })
})
