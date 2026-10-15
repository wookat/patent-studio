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

const CASES = [{ id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'drafting' }]
const APPROVALS = [
  { id: 'a1', run_id: 'r1', case_id: 'c1', approver_principal_id: 'p1', status: 'pending', decided_by_principal_id: null, decided_at: null, reason: null },
]
const PROPOSALS = [
  { id: 'pr0000000001', case_id: 'c1', target_kind: 'document', status: 'submitted', accepted_document_revision_id: null },
  { id: 'pr0000000002', case_id: 'c1', target_kind: 'figure', status: 'draft', accepted_document_revision_id: null },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(mode: 'ok' | '401' = 'ok') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/approvals') return mode === '401' ? json({ detail: { kind: 'auth', message: '需要登录' } }, 401) : json(APPROVALS)
      if (url === '/api/v1/cases') return mode === '401' ? json({ detail: { kind: 'auth', message: '需要登录' } }, 401) : json(CASES)
      if (url === '/api/v1/cases/c1/proposals') return json(PROPOSALS)
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

  it('切到提案 tab → hash 回写 + 跨案提案聚合渲染（按案件分组）', async () => {
    mockApi()
    await mount()
    await act(async () => (q('[data-testid="inbox-tab-proposals"]') as HTMLElement).click())
    expect(window.location.hash).toBe('#/inbox?tab=proposals')
    await vi.waitFor(() => expect(q('[data-testid="inbox-proposal-pr0000000001"]')).not.toBeNull())
    expect(q('[data-testid="inbox-proposals-c1"]')?.textContent).toContain('method')
    expect(q('[data-testid="inbox-proposal-pr0000000002"]')).not.toBeNull()
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
