// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import { InboxPage } from '@/components/notify/InboxPage'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let client: QueryClient

const CASES = [
  { id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'drafting' },
  { id: 'c2', organization_id: 'o1', case_key: 'search-mark', title: '检索标记案', kind: 'utility', status: 'drafting' },
]
const APPROVALS = [
  { id: 'a1', run_id: 'r1', case_id: 'c1', approver_principal_id: 'p1', status: 'pending', decided_by_principal_id: null, decided_at: null, reason: null },
]
const mkProposal = (id: string, caseItem: (typeof CASES)[number], status = 'submitted') => ({
  id, case_id: caseItem.id, case: caseItem, target_kind: 'document', status,
  target_revision_id: null, result_content_ref: null, accepted_document_revision_id: null, accepted_figure_revision_id: null,
})
// 25 条跨两案（>1 页，验证服务端分页契约）
const PROPOSALS = Array.from({ length: 25 }, (_, i) =>
  mkProposal(`pr${String(i).padStart(6, '0')}`, CASES[i % 2]),
)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let shrinkTotal = false

function mockApi(mode: 'ok' | '401' = 'ok') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/approvals') return mode === '401' ? json({ detail: { kind: 'auth', message: '需要登录' } }, 401) : json(APPROVALS)
      // 阶段6收口哨兵：跨案提案走 /api/v1/proposals 单页查询；全量 /cases、/cases/page、
      // 逐案 /proposals 任何一处被发起都视为回归直接抛错。
      if (url === '/api/v1/cases' || url.startsWith('/api/v1/cases/page')) throw new Error('不应拉案件列表')
      if (/^\/api\/v1\/cases\/[^/]+\/proposals/.test(url)) throw new Error('不应逐案拉 proposals')
      if (url.startsWith('/api/v1/proposals')) {
        if (mode === '401') return json({ detail: { kind: 'auth', message: '需要登录' } }, 401)
        const u = new URL(url, 'http://x')
        const limit = Number(u.searchParams.get('limit') ?? 20)
        const offset = Number(u.searchParams.get('offset') ?? 0)
        const status = u.searchParams.get('status') ?? ''
        const qq = u.searchParams.get('q') ?? ''
        let items = PROPOSALS
        if (status) items = items.filter((p) => p.status === status)
        if (qq) items = items.filter((p) => p.case.case_key.includes(qq) || p.case.title.includes(qq))
        const total = shrinkTotal ? Math.min(items.length, 5) : items.length
        return json({ items: items.slice(offset, offset + limit), total, limit, offset })
      }
      if (url.startsWith('/api/v1/proposals/')) return json({ id: url.split('/').at(-2), status: 'accepted' })
      if (url.startsWith('/api/notify')) return json({ items: [], unread: 0 })
      return json({ detail: 'not found' }, 404)
    }),
  )
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.location.hash = ''
  shrinkTotal = false
  useStudio.getState().resetNotify()
  useStudio.setState({
    pid: 'p1', authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false } as never,
    notifyUnavailable: false,
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
  window.location.hash = ''
})

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <QueryClientProvider client={client}><TooltipProvider><InboxPage /></TooltipProvider></QueryClientProvider>,
  ))
  await act(async () => { await Promise.resolve() })
  return host
}

const q = (sel: string) => host.querySelector(sel)

describe('M2 inbox 页签：#/inbox?tab= 并入审批与提案', () => {
  it('默认 notify tab：三个页签渲染，通知列表行为不变', async () => {
    mockApi()
    await mount()
    expect(q('[data-testid="inbox-tab-notify"]')).not.toBeNull()
    expect(q('[data-testid="inbox-tab-approvals"]')).not.toBeNull()
    expect(q('[data-testid="inbox-tab-proposals"]')).not.toBeNull()
    // 通知筛选与空态仍在
    expect(q('[data-testid="inbox-filter-all"]')).not.toBeNull()
    expect(q('[data-testid="inbox-empty"]')).not.toBeNull()
  })

  it('#/inbox?tab=approvals 深链 → 渲染 /api/v1 审批卡', async () => {
    mockApi()
    window.location.hash = '#/inbox?tab=approvals'
    await mount()
    await vi.waitFor(() => expect(q('[data-testid="approval-a1"]')).not.toBeNull())
    expect(q('[data-testid="approval-a1"]')?.textContent).toContain('待审批运行')
  })

  it('切到提案 tab → hash 回写 + 跨案分页收件箱（本页分组渲染、total/翻页）', async () => {
    mockApi()
    await mount()
    await act(async () => (q('[data-testid="inbox-tab-proposals"]') as HTMLElement).click())
    expect(window.location.hash).toBe('#/inbox?tab=proposals')
    await vi.waitFor(() => expect(q('[data-testid="inbox-proposal-pr000000"]')).not.toBeNull())
    // 本页 20 条跨两案分组，组头标「本页」
    expect(q('[data-testid="inbox-proposals-c1"]')?.textContent).toContain('method')
    expect(q('[data-testid="inbox-proposals-c1"]')?.textContent).toContain('（本页）')
    expect(q('[data-testid="inbox-proposals-c2"]')?.textContent).toContain('search-mark')
    expect(q('[data-testid="inbox-proposals-total"]')?.textContent).toContain('共 25 条')
    // 末行 pr000018 在第1页、pr000024 不在
    expect(q('[data-testid="inbox-proposal-pr000018"]')).not.toBeNull()
    expect(q('[data-testid="inbox-proposal-pr000024"]')).toBeNull()
    // 中文状态徽标而非原枚举
    expect(q('[data-testid="inbox-proposal-pr000000"]')?.textContent).toContain('待决')
    expect(q('[data-testid="inbox-proposal-pr000000"]')?.textContent).not.toContain('submitted')
    // 第2页：offset=20 请求真实发出
    const pager = q('[data-testid="inbox-pager"]')!
    const next = [...pager.querySelectorAll('button')].find((b) => b.textContent === '下一页') as HTMLElement
    await act(async () => next.click())
    await vi.waitFor(() => expect(q('[data-testid="inbox-proposal-pr000024"]')).not.toBeNull())
    expect(q('[data-testid="inbox-pager"]')?.textContent).toContain('第 2 / 2 页')
    expect(q('[data-testid="inbox-proposal-pr000000"]')).toBeNull()
  })

  it('提案搜索：q 参数走服务端，命中案件标题分组', async () => {
    mockApi()
    window.location.hash = '#/inbox?tab=proposals'
    await mount()
    await vi.waitFor(() => expect(q('[data-testid="inbox-proposal-pr000000"]')).not.toBeNull())
    await act(async () => {
      const input = q('[data-testid="inbox-proposals-search"]') as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '检索')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(q('[data-testid="inbox-proposals-total"]')?.textContent).toContain('共 12 条')
      expect(q('[data-testid="inbox-proposals-c1"]')).toBeNull()
      expect(q('[data-testid="inbox-proposals-c2"]')).not.toBeNull()
    })
  })

  it('提案收件箱 total 缩小后越界页自动回退有效页', async () => {
    mockApi()
    window.location.hash = '#/inbox?tab=proposals'
    await mount()
    await vi.waitFor(() => expect(q('[data-testid="inbox-proposal-pr000000"]')).not.toBeNull())
    const pager = q('[data-testid="inbox-pager"]')!
    const next = [...pager.querySelectorAll('button')].find((b) => b.textContent === '下一页') as HTMLElement
    await act(async () => next.click())
    await vi.waitFor(() => expect(q('[data-testid="inbox-pager"]')?.textContent).toContain('第 2 / 2 页'))
    // 服务端 total 缩到 5（mutation/权限变化模拟）：失效后 offset=20 请求返回空 items
    shrinkTotal = true
    await act(async () => { await client.invalidateQueries() })
    await vi.waitFor(() => {
      // 自动回退第1页并重新取到前5条，而不是停在空页
      expect(q('[data-testid="inbox-pager"]')?.textContent).toContain('第 1 / 1 页')
      expect(q('[data-testid="inbox-proposal-pr000000"]')).not.toBeNull()
    })
  })

  it('审批 tab：/api/v1 401 → 需要登录空态（fail-closed，不崩页）', async () => {
    mockApi('401')
    window.location.hash = '#/inbox?tab=approvals'
    await mount()
    await vi.waitFor(() => expect(q('[data-testid="workbench-auth-error"]')).not.toBeNull())
  })

  it('未知 tab 值回落 notify', async () => {
    mockApi()
    window.location.hash = '#/inbox?tab=bogus'
    await mount()
    expect(q('[data-testid="inbox-empty"]')).not.toBeNull()
    expect(q('[data-testid="inbox-filter-all"]')).not.toBeNull()
  })
})
