// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/net'
import type { useWorkbenchQueries } from '@/workbench/queries'
import type { Notification, Proposal } from '@/workbench/types'
import { ErrorPanel, MembersPanel, NotificationsView, ProposalsPanel } from '../WorkbenchPage'

let root: Root | null = null
let host: HTMLDivElement
let queryClient: QueryClient

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  root = createRoot(host)
  await act(async () => root?.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>))
  return host
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
})

const stub = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null }) as never

const proposal: Proposal = {
  id: 'p1', case_id: 'c1', status: 'submitted', target_kind: 'document',
  accepted_document_revision_id: null, accepted_figure_revision_id: null,
}
const notice: Notification = {
  id: 'n1', case_id: 'c1', recipient_principal_id: 'p1', notification_type: 'work_item.assigned',
  work_item_id: 'w1', read_at: null, payload: null,
}
const caseItem = { id: 'c1', organization_id: 'o1', case_key: 'CN-1', title: '一种方法', kind: 'invention' as const, status: 'drafting' }

describe('workbench flows', () => {
  it('shows a dedicated sign-in panel on 401 instead of a blank area', async () => {
    const el = await mount(<ErrorPanel error={new ApiError(401, 'auth required')} />)
    expect(el.textContent).toContain('需要登录')
    expect(el.querySelector('[data-testid="workbench-auth-error"] a')?.getAttribute('href')).toBe('#/login')
  })

  it('surfaces submission-barrier 409 reasons structurally', async () => {
    // 服务端 submission_barrier 的 detail.detail 是原因数组（net.ts 类型标的是 string|null，运行时透传数组）。
    const err = new ApiError(409, 'blocked', { kind: 'submission_barrier', message: 'blocked', line: null, detail: ['附图 3 缺失', '摘要未更新'] as unknown as string })
    const el = await mount(<ErrorPanel error={err} />)
    expect(el.querySelector('[data-testid="workbench-conflict"]')?.textContent).toContain('提交被阻断')
    expect(el.textContent).toContain('附图 3 缺失')
  })

  it('proposal decision posts to the accept route with an Idempotency-Key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...proposal, status: 'accepted' }))
    const el = await mount(<ProposalsPanel caseId="c1" proposals={stub([proposal])} />)
    const accept = Array.from(el.querySelectorAll('[data-testid="proposal-p1"] button')).find((b) => b.textContent === '采纳') as HTMLButtonElement
    await act(async () => accept.click())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/proposals/p1/accept')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Idempotency-Key')).toMatch(/^[a-z0-9-]{8,}$/)
  })

  it('marks an unread notification read via POST', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...notice, read_at: '2026-10-14T00:00:00Z' }))
    const el = await mount(<NotificationsView notifications={stub([notice])} />)
    expect(el.textContent).toContain('未读')
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '标记已读') as HTMLButtonElement
    await act(async () => button.click())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/notifications/n1/read')
    expect(init.method).toBe('POST')
  })

  it('adds a case participant with principal id and role', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ principal_id: 'p9', role: 'reviewer', case_id: 'c1', status: 'active' }))
    const queries = {
      participants: stub([{ principal_id: '12345678-0000-0000-0000-000000000000', role: 'case_manager', case_id: 'c1', status: 'active' }]),
      memberships: stub([{ organization_id: 'o1', principal_id: '12345678-0000-0000-0000-000000000000', role: 'owner', status: 'active' }]),
    } as unknown as ReturnType<typeof useWorkbenchQueries>
    const el = await mount(<MembersPanel caseItem={caseItem} queries={queries} />)
    expect(el.querySelector('[data-testid^="participant-"]')?.textContent).toContain('case_manager')
    const input = el.querySelector('input[aria-label="参与者 Principal"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '99999999-0000-0000-0000-000000000000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const add = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('加入参与者')) as HTMLButtonElement
    await act(async () => add.click())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/cases/c1/participants')
    expect(JSON.parse(String(init.body))).toMatchObject({ principal_id: '99999999-0000-0000-0000-000000000000', role: 'reviewer' })
  })
})
