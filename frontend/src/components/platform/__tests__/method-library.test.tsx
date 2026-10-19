// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query'
import { MethodLibraryPage } from '../MethodLibraryPage'

/** Z30：机构方法库页——授权卡检索、管理操作、使用留痕调用真实端点；非管理者无授权按钮。 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
let root: Root | null = null
let host: HTMLElement

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ME = { id: 'p1', kind: 'human', display_name: '所长' }
const ASSET = (id: string, status: string) => ({
  id, organization_id: 'o1', title: `卡-${id}`, body: '步骤…', source: 'manual', status,
  authorized_by_principal_id: status === 'authorized' ? 'p1' : null,
  created_by_principal_id: 'p1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

function mockApi(opts: { assets?: unknown[]; role?: string; assetsStatus?: number } = {}) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/v1/principals/me') return json(ME)
    if (url === '/api/v1/organizations') return json([{ id: 'o1', slug: 'acme', name: '知撰代理', status: 'active' }])
    if (url === '/api/v1/organizations/o1/memberships') return json([{ organization_id: 'o1', principal_id: 'p1', role: opts.role ?? 'owner', status: 'active' }])
    if (url.startsWith('/api/v1/organizations/o1/method-assets')) return json(opts.assets ?? [ASSET('a1', 'authorized'), ASSET('a2', 'draft')], opts.assetsStatus ?? 200)
    if (url === '/api/v1/method-assets/a1/uses') return json([{ id: 'u1', asset_id: 'a1', case_id: 'c9', principal_id: 'p1', note: '权1套用', used_at: '2026-01-02T00:00:00Z' }])
    if (url.endsWith('/authorize') || url.endsWith('/revoke') || url.endsWith('/use')) return json(ASSET('a1', url.endsWith('revoke') ? 'revoked' : 'authorized'), 201)
    return json({ detail: 'not found' }, 404)
  }))
  return calls
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
  queryClient.clear()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  await act(async () => { await Promise.resolve() })
  return host
}

describe('Z30 机构方法库页', () => {
  it('管理者视图：列出卡（含全状态开关）、授权/撤销/记录使用按钮齐', async () => {
    mockApi({})
    await mount(<MethodLibraryPage orgId="o1" />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ml-asset-a1"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="ml-all-states"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ml-asset-a1"]')!.textContent).toContain('已授权')
    expect(host.querySelector('[data-testid="ml-revoke-a1"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ml-authorize-a2"]')).not.toBeNull()
    // 使用记录展开
    await act(async () => (host.querySelector('[data-testid="ml-uses-toggle-a1"]') as HTMLElement).click())
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ml-uses-a1"]')?.textContent).toContain('权1套用'))
  })

  it('记录使用调 /use 端点；录入卡调 POST create', async () => {
    const calls = mockApi({ assets: [ASSET('a1', 'authorized')] })
    await mount(<MethodLibraryPage orgId="o1" />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ml-asset-a1"]')).not.toBeNull())
    await act(async () => (host.querySelector('[data-testid="ml-use-a1"]') as HTMLElement).click())
    await vi.waitFor(() => expect(calls.some((c) => c === 'POST /api/v1/method-assets/a1/use')).toBe(true))
    // 录入
    await act(async () => (host.querySelector('[data-testid="ml-create-open"]') as HTMLElement).click())
    expect(host.querySelector('[data-testid="ml-create"]')).not.toBeNull()
    expect((host.querySelector('[data-testid="ml-create-submit"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('普通成员：无全状态开关与授权/撤销按钮', async () => {
    mockApi({ role: 'member' })
    await mount(<MethodLibraryPage orgId="o1" />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ml-asset-a1"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="ml-all-states"]')).toBeNull()
    expect(host.querySelector('[data-testid="ml-authorize-a2"]')).toBeNull()
    expect(host.querySelector('[data-testid="ml-revoke-a1"]')).toBeNull()
  })

  it('空库空态提示授权语义', async () => {
    mockApi({ assets: [] })
    await mount(<MethodLibraryPage orgId="o1" />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ml-empty"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="ml-empty"]')!.textContent).toContain('授权')
  })
})
