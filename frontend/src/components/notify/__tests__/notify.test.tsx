// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import { useTopBarItems } from '@/lib/slots'
import type { Notification } from '@/types/notify'
import type { Comment } from '@/lib/types'
import { NotifyBell } from '../NotifyBell'
import { TopBarNotifyBell } from '../TopBarNotifyBell'
import { InboxPage } from '../InboxPage'
import { notificationHash } from '../notifyKinds'
import { ReviewDrawer } from '@/components/review/ReviewDrawer'
import { OrgShell } from '@/components/dashboard/OrgShell'
import '@/components/review/ReviewPanel'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

const NOTES: Notification[] = [
  { id: 'n1', kind: 'mention', title: '张三 在批注中提到了你', body: '@我 请看权利要求 1', href: '#/p/p1?c=c1', pid: 'p1', actor: { id: 'u2', display_name: '张三' }, read: false, created_at: 1_700_000_000 },
  { id: 'n2', kind: 'assign', title: '李四 指派你审阅', body: '到期 2026-09-10', href: '#/p/p1', pid: 'p1', actor: { id: 'u3', display_name: '李四' }, read: false, created_at: 1_699_999_000 },
  { id: 'n3', kind: 'deadline', title: '答复期限 3 天后到期', body: '', href: '#/deadlines', pid: null, actor: null, read: true, created_at: 1_699_990_000 },
  { id: 'n4', kind: 'confirm', title: '客户已确认', body: '', href: null, pid: 'p1', actor: null, read: false, created_at: 1_699_980_000 },
  { id: 'n5', kind: 'ai', title: 'AI 审阅完成', body: '3 条建议', href: '#/p/p1?focus=claims/1', pid: 'p1', actor: null, read: true, created_at: 1_699_970_000 },
]
const UNREAD = NOTES.filter((n) => !n.read).length

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(mode: 'ok' | '501' | '500' = 'ok') {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.startsWith('/api/notify')) {
        if (mode === '501') return json({ detail: { kind: 'not_implemented', message: '功能开发中', detail: 'notify-audit-backend' } }, 501)
        if (mode === '500') return json({ detail: 'boom' }, 500)
        if (url === '/api/notify/read-all') return json({ updated: UNREAD })
        const m = /^\/api\/notify\/([^/]+)\/read$/.exec(url)
        if (m) return json({ ...NOTES.find((n) => n.id === decodeURIComponent(m[1]))!, read: true })
        // R115-批33：unread=true 走专属流——mock 按参数分流（真实后端语义），否则此前返回全量会让未读页签断言失真
        const onlyUnread = url.includes('unread=true')
        return json({ items: onlyUnread ? NOTES.filter((n) => !n.read) : NOTES, unread: UNREAD })
      }
      if (/\/api\/projects\/p1\/comments/.test(url)) return json(COMMENTS)
      return json({ detail: 'not found' }, 404)
    }),
  )
  return calls
}

const COMMENTS: Comment[] = [
  { id: 'c0', anchor: { block_id: 'claims/1', line: 3, quote: 'x', stale: false }, body: '首条', author: { id: 'u2', name: '张三' }, created_at: 0, updated_at: 0, resolved: false, replies: [] },
  { id: 'c1', anchor: { block_id: 'claims/2', line: 8, quote: 'y', stale: false }, body: '目标批注', author: { id: 'u2', name: '张三' }, created_at: 0, updated_at: 0, resolved: false, replies: [] },
]

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  desktop = true
  window.location.hash = ''
  useStudio.getState().resetNotify()
  useStudio.setState({
    pid: 'p1', projectLoading: false, comments: [], marks: [], activeCommentId: null, pendingCommentId: null,
    commentsUnavailable: false, marksUnavailable: false, notifyUnavailable: false, reviewDrawerOpen: false, reviewRequest: null,
    authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false } as never,
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
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

function SlotProbe() {
  const ids = useTopBarItems().map((i) => i.id)
  return <div data-testid="slot-probe" data-ids={ids.join(',')} />
}

const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)
const body = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

describe('notificationHash（hash 契约）', () => {
  it('href 优先，去掉前导 #；无 href 有 pid → #/p/<pid>；都无 → null', () => {
    expect(notificationHash({ href: '#/p/p1?c=c1', pid: 'p1' })).toBe('/p/p1?c=c1')
    expect(notificationHash({ href: '/p/p1?focus=claims/1', pid: null })).toBe('/p/p1?focus=claims/1')
    expect(notificationHash({ href: null, pid: 'p x' })).toBe('/p/p%20x')
    expect(notificationHash({ href: null, pid: null })).toBeNull()
  })
})

describe('NotifyBell（R-HOME-07 UI）', () => {
  it('挂到 TopBar 槽位（registerTopBarItem），未读徽章与 mock 一致，Popover 列最近条目并可「全部已读」', async () => {
    const calls = mockApi()
    await mount(
      <>
        <SlotProbe />
        <NotifyBell />
      </>,
    )
    const ids = q('[data-testid="slot-probe"]')!.getAttribute('data-ids')!.split(',')
    expect(ids).toContain('notify-bell')
    expect(ids).toContain('review-drawer')
    expect(calls.some((c) => c.startsWith('GET /api/notify'))).toBe(true)
    expect(useStudio.getState().unreadCount).toBe(UNREAD)
    const btn = q<HTMLButtonElement>('[data-testid="topbar-notify"]')!
    expect(q('[data-testid="topbar-notify-badge"]')!.textContent).toBe(String(UNREAD))
    expect(btn.getAttribute('aria-label')).toContain(`${UNREAD}`)
    await act(async () => btn.click())
    const pop = body('[data-testid="notify-popover"]')!
    expect(pop.querySelectorAll('[data-slot="notification-row"]').length).toBe(NOTES.length)
    expect(await violations(document.body)).toEqual([])
    await act(async () => pop.querySelector<HTMLButtonElement>('[data-testid="notify-all"]')!.click())
    expect(window.location.hash).toBe('#/inbox')
    await act(async () => btn.click())
    await act(async () => body<HTMLButtonElement>('[data-testid="notify-mark-all"]')!.click())
    expect(useStudio.getState().unreadCount).toBe(0)
    expect(calls).toContain('POST /api/notify/read-all')
  })

  it('501 → EmptyState「功能开发中」；500 → 错误态', async () => {
    mockApi('501')
    await mount(<NotifyBell />)
    await act(async () => q<HTMLButtonElement>('[data-testid="topbar-notify"]')!.click())
    const empty = body('[data-testid="notify-empty"]')!
    expect(empty.getAttribute('data-slot')).toBe('empty-state')
    expect(empty.textContent).toContain('功能开发中')
    await act(async () => root?.unmount())
    root = null
    host.remove()
    vi.unstubAllGlobals()
    useStudio.getState().resetNotify()
    useStudio.setState({ notifyUnavailable: false })
    mockApi('500')
    await mount(<NotifyBell />)
    await act(async () => q<HTMLButtonElement>('[data-testid="topbar-notify"]')!.click())
    expect(body('[data-testid="notify-error"]')!.textContent).toContain('boom')
  })

  it('23-w12 §4：顶栏槽位的铃铛在后端 501 后隐藏（不给用户必然为空的按钮）；200 照常显示；500 仍显示（可重试）', async () => {
    mockApi('501')
    await mount(<TopBarNotifyBell />)
    expect(useStudio.getState().notifyUnavailable).toBe(true)
    expect(q('[data-testid="topbar-notify"]')).toBeNull()
    await act(async () => root?.unmount())
    root = null
    host.remove()
    vi.unstubAllGlobals()
    useStudio.getState().resetNotify()
    useStudio.setState({ notifyUnavailable: false })
    mockApi()
    await mount(<TopBarNotifyBell />)
    expect(q('[data-testid="topbar-notify-badge"]')!.textContent).toBe(String(UNREAD))
    await act(async () => root?.unmount())
    root = null
    host.remove()
    vi.unstubAllGlobals()
    useStudio.getState().resetNotify()
    mockApi('500')
    await mount(<TopBarNotifyBell />)
    expect(q('[data-testid="topbar-notify"]')).not.toBeNull()
  })

  it('23-w12 §7：鉴权关闭（authStatus off，后端无用户 ⇒ /api/notify 永远空列表）时顶栏不渲染铃铛、也不发起轮询', async () => {
    const calls = mockApi()
    useStudio.setState({ authStatus: 'off', user: null })
    await mount(<TopBarNotifyBell />)
    expect(q('[data-testid="topbar-notify"]')).toBeNull()
    expect(calls.filter((c) => c.includes('/api/notify'))).toEqual([])
  })

  it('23-w12 §7：loadMe 未返回（authStatus unknown）时不渲染也不请求；变为 authed 后才出现铃铛并开始轮询；变回 off 即撤下', async () => {
    const calls = mockApi()
    useStudio.setState({ authStatus: 'unknown', user: null })
    await mount(<TopBarNotifyBell />)
    expect(q('[data-testid="topbar-notify"]')).toBeNull()
    expect(calls.filter((c) => c.includes('/api/notify'))).toEqual([])

    await act(async () => {
      useStudio.setState({ authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false } as never })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(q('[data-testid="topbar-notify-badge"]')!.textContent).toBe(String(UNREAD))
    expect(calls.filter((c) => c.includes('/api/notify'))).toHaveLength(1)

    await act(async () => {
      useStudio.setState({ authStatus: 'off', user: null })
    })
    expect(q('[data-testid="topbar-notify"]')).toBeNull()
  })

  it('W12 R8-01：机构页壳（首页案卷/期限/通知 OrgShell）的铃铛与工作台顶栏同一门槛——authStatus off 不渲染也不轮询；authed 才出现', async () => {
    const calls = mockApi()
    useStudio.setState({ authStatus: 'off', user: null })
    await mount(<OrgShell name="home" title="案卷" current="cases" mobile={false}>…</OrgShell>)
    expect(q('[data-testid="home-header"]')).not.toBeNull()
    expect(q('[data-testid="topbar-notify"]')).toBeNull()
    expect(calls.filter((c) => c.includes('/api/notify'))).toEqual([])

    await act(async () => {
      useStudio.setState({ authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false } as never })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(q('[data-testid="topbar-notify-badge"]')!.textContent).toBe(String(UNREAD))
    expect(calls.filter((c) => c.includes('/api/notify'))).toHaveLength(1)
  })
})

describe('InboxPage（§4.2 通知页）', () => {
  it('W12 R8-01：鉴权关闭（authStatus off）时通知页不发 GET /api/notify，直接落空态；变为 authed 才拉一次 limit=100', async () => {
    const calls = mockApi()
    useStudio.setState({ authStatus: 'off', user: null })
    await mount(<InboxPage />)
    expect(calls.filter((c) => c.includes('/api/notify'))).toHaveLength(0)
    expect(q('[data-testid="inbox-empty"]')).not.toBeNull()
    expect(q('[data-testid="inbox-loading"]')).toBeNull()
    await act(async () => {
      useStudio.setState({ authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false } as never })
    })
    // 通知页自身一次（limit=100）+ OrgShell 顶栏铃铛起轮询一次（默认参数）
    expect(calls.filter((c) => c.includes('/api/notify?limit=100'))).toHaveLength(1)
    expect(host.querySelectorAll('[data-slot="notification-row"]').length).toBe(NOTES.length)
  })

  it('列出全部，未读粗体 + 类型图标；筛选「未读」只剩未读；「全部已读」清零', async () => {
    mockApi()
    await mount(<InboxPage />)
    expect(q('[data-testid="inbox-unread-count"]')!.textContent).toContain(String(UNREAD))
    // W5 走查 qa-07 / ux-03：通知页与台账、期限共用「案卷 · 期限 · 通知」二级导航
    expect(q('[data-slot="DashNav"] [data-testid="nav-deadlines"]')).not.toBeNull()
    expect(q('[data-slot="DashNav"] [data-testid="nav-cases"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-slot="notification-row"]').length).toBe(NOTES.length)
    const unreadTitle = q('[data-testid="row-n1"] [data-slot="notification-title"]')!
    const readTitle = q('[data-testid="row-n3"] [data-slot="notification-title"]')!
    expect(unreadTitle.className).toContain('font-semibold')
    expect(readTitle.className).not.toContain('font-semibold')
    expect(q('[data-testid="row-n1"] a')!.className).toContain('min-h-row-mobile')
    expect(await violations(host)).toEqual([])
    await act(async () => q<HTMLButtonElement>('[data-testid="inbox-filter-unread"]')!.click())
    expect(host.querySelectorAll('[data-slot="notification-row"]').length).toBe(UNREAD)
    await act(async () => q<HTMLButtonElement>('[data-testid="inbox-mark-all"]')!.click())
    expect(useStudio.getState().unreadCount).toBe(0)
    expect(host.querySelectorAll('[data-state="unread"]').length).toBe(0)
  })

  it('点击通知 → 标已读 + hash 变为 #/p/<pid>?c=<cid>，审阅 Drawer 打开并滚到该批注', async () => {
    const calls = mockApi()
    await mount(
      <>
        <InboxPage />
        <ReviewDrawer />
      </>,
    )
    const link = q<HTMLAnchorElement>('[data-testid="row-n1"] a')!
    expect(link.getAttribute('href')).toBe('#/p/p1?c=c1')
    await act(async () => link.click())
    expect(calls).toContain('POST /api/notify/n1/read')
    expect(window.location.hash === '#/p/p1?c=c1' || window.location.hash === '#/p/p1').toBe(true)
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')))
    const s = useStudio.getState()
    expect(s.reviewDrawerOpen).toBe(true)
    expect(s.reviewRequest).toBeNull()
    expect(s.activeCommentId).toBe('c1')
    await act(async () => {
      await Promise.resolve()
    })
    const drawer = body('[data-testid="review-drawer"]')!
    expect(drawer).not.toBeNull()
    const card = drawer.querySelector('[data-comment-id="c1"]')!
    expect(card).not.toBeNull()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.instances.at(-1)).toBe(card)
    expect(useStudio.getState().pendingCommentId).toBeNull()
    expect(window.location.hash).toBe('#/p/p1')
  })

  it('冷启动 #/p/<pid>?c=<cid>：openProject 收尾 resetReview 后 Drawer 仍打开（微任务延后）', async () => {
    mockApi()
    await mount(<ReviewDrawer />)
    useStudio.setState({ pid: 'p1', projectLoading: true })
    useStudio.getState().requestReviewComment('p1', 'c1')
    await act(async () => {
      // 模拟 openProject：置 projectLoading=false 后同一同步段内 resetReview/resetComments
      useStudio.setState({ projectLoading: false })
      useStudio.getState().resetReview()
      useStudio.getState().resetComments()
      await Promise.resolve()
    })
    const s = useStudio.getState()
    expect(s.reviewDrawerOpen).toBe(true)
    expect(s.reviewRequest).toBeNull()
    expect(s.activeCommentId).toBe('c1')
  })

  it('501 → EmptyState「功能开发中」', async () => {
    mockApi('501')
    await mount(<InboxPage />)
    const empty = q('[data-testid="inbox-empty"]')!
    expect(empty.getAttribute('data-slot')).toBe('empty-state')
    expect(empty.textContent).toContain('功能开发中')
    expect(await violations(host)).toEqual([])
  })

  it('R115-批21：has_more →「加载更早」按末位 id 游标翻页，去重拼接后按钮消失', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url === '/api/notify' || url.startsWith('/api/notify?')) {
          return json(
            url.includes('before_id=')
              ? { items: [NOTES[1], { ...NOTES[0], id: 'n_old', title: '更早的通知' }], unread: UNREAD, has_more: false }
              : { items: NOTES.slice(0, 2), unread: UNREAD, has_more: true },
          )
        }
        if (url.startsWith('/api/notify')) return json({ updated: 0 })
        return json({ detail: 'not found' }, 404)
      }),
    )
    await mount(<InboxPage />)
    const btn = q<HTMLButtonElement>('[data-testid="inbox-load-more"]')!
    expect(btn).not.toBeNull()
    await act(async () => btn.click())
    expect(calls.some((c) => c.includes(`before_id=${NOTES[1].id}`))).toBe(true)
    const rows = [...host.querySelectorAll('[data-slot="notification-row"]')].map((r) => r.getAttribute('data-testid'))
    expect(rows.filter((x) => x === 'row-n2')).toHaveLength(1)  // 重叠项去重
    expect(rows).toContain('row-n_old')
    expect(q('[data-testid="inbox-load-more"]')).toBeNull()  // has_more 耗尽
  })

  it('375：行高 44（min-h-row-mobile），空态', async () => {
    desktop = false
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], unread: 0 })))
    await mount(<InboxPage />)
    expect(q('[data-testid="inbox-empty"]')!.textContent).toContain('暂无通知')
  })

  it('375 W8 §4：MobilePage · Segmented md + 全部已读 icon-md 36（touch-hit）· 列表出血 · 空态 gap-group-m / py-section-m', async () => {
    desktop = false
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], unread: 0 })))
    await mount(<InboxPage />)
    const page = q('[data-testid="inbox-page"]')!
    expect(page.getAttribute('data-slot')).toBe('mobile-page')
    expect(page.className).toContain('px-page-m')
    const seg = q('[data-testid="inbox-toolbar"] [data-slot="segmented"]')!
    expect(seg.getAttribute('data-size')).toBe('md')
    expect(seg.className).not.toContain('min-h-row-mobile')
    const mark = q('[data-testid="inbox-mark-all"]')!
    expect(mark.getAttribute('data-size')).toBe('icon-md')
    expect(mark.className).toContain('size-md-control')
    expect(mark.className).toContain('touch-hit')
    expect(mark.getAttribute('aria-label') ?? mark.textContent).toContain('全部已读')
    expect(q('[data-testid="inbox-toolbar"]')!.className).toContain('gap-group-m')
    expect(q('[data-testid="inbox-body"]')!.className).toContain('-mx-page-m')
    const empty = q('[data-testid="inbox-empty"]')!
    expect(empty.className).toContain('gap-group-m')
    expect(empty.className).toContain('py-section-m')
    expect(await violations(host)).toEqual([])
  })

  it('1440：Segmented 默认档 + 全部已读 sm 文字按钮（桌面不变）', async () => {
    mockApi()
    await mount(<InboxPage />)
    expect(q('[data-testid="inbox-page"]')).toBeNull()
    expect(q('[data-testid="inbox-toolbar"]')).toBeNull()
    const seg = q('[data-testid="inbox-filter-unread"]')!.closest('[data-slot="segmented"]')!
    expect(seg.getAttribute('data-size')).toBe('md')
    expect(seg.className).not.toContain('flex-1')
    const mark = q('[data-testid="inbox-mark-all"]')!
    expect(mark.getAttribute('data-size')).toBe('sm')
    expect(mark.textContent).toContain('全部已读')
    expect(mark.querySelector('.sr-only')).toBeNull()
  })
})
