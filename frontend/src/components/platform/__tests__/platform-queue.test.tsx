// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query'
import { useStudio } from '@/store'
import { WorkbenchRedirect } from '@/components/workbench/WorkbenchPage'
import { PlatformQueue } from '@/components/platform/PlatformQueue'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(map: Record<string, { body: unknown; status?: number }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const hit = map[url]
    return hit ? json(hit.body, hit.status ?? 200) : json({ detail: 'not found' }, 404)
  }))
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  window.location.hash = ''
  useStudio.setState({ pid: 'p1', projects: [] })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
  queryClient.clear()
  window.location.replace('#/')
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  await act(async () => { await Promise.resolve() })
  return host
}

describe('M7：#/workbench 退役为 redirect shim', () => {
  it('view=queue（默认）→ #/', async () => {
    window.location.hash = '#/workbench'
    mockApi({})
    await mount(<WorkbenchRedirect />)
    await vi.waitFor(() => expect(window.location.hash).toBe('#/'))
  })
  it('view=approvals → #/inbox?tab=approvals；notifications → #/inbox', async () => {
    mockApi({})
    window.location.hash = '#/workbench?view=approvals'
    await mount(<WorkbenchRedirect />)
    await vi.waitFor(() => expect(window.location.hash).toBe('#/inbox?tab=approvals'))
  })
  it('view=case&case=<id> → 解析 case_key → #/p/<key>；解析失败回落 #/', async () => {
    mockApi({ '/api/v1/cases/c1': { body: { id: 'c1', case_key: 'method', title: 't', kind: 'invention', status: 'drafting', organization_id: 'o1' } } })
    window.location.hash = '#/workbench?view=case&case=c1'
    await mount(<WorkbenchRedirect />)
    await vi.waitFor(() => expect(window.location.hash).toBe('#/p/method'))
  })
})

const ME = { id: 'p1', kind: 'human', display_name: '我' }

describe('M6：dashboard 工作项分段（一案双体去重后按 case_key 导航）', () => {
  it('工作项行渲染 + 打开 → #/p/<case_key>', async () => {
    mockApi({
      '/api/v1/principals/me': { body: ME },
      '/api/v1/cases': { body: [{ id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'drafting' }] },
      '/api/v1/work-items': { body: [{ id: 'w1', case_id: 'c1', type: 'review', title: '复核权项', assignee_principal_id: 'p1', deadline: null, priority: 1, status: 'open', reporter_principal_id: 'p1' }] },
    })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="work-item-w1"]')?.textContent).toContain('复核权项')
    await act(async () => (host.querySelector('[data-testid="work-item-w1"] [data-testid], [data-testid="work-item-w1"] button') as HTMLElement)?.click())
    await vi.waitFor(() => expect(window.location.hash).toBe('#/p/method'))
  })
})

describe('Z06/Z10：角色待办范围与空态', () => {
  const CASES = [{ id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'intake' }]
  const ITEMS = [
    { id: 'w1', case_id: 'c1', type: 'draft', title: '撰写三书', assignee_principal_id: 'p1', deadline: null, priority: 2, status: 'open', reporter_principal_id: 'o1' },
    { id: 'w2', case_id: 'c1', type: 'review', title: '复核权项', assignee_principal_id: null, deadline: null, priority: 3, status: 'open', reporter_principal_id: 'o1' },
    { id: 'w3', case_id: 'c1', type: 'figure', title: '绘图', assignee_principal_id: 'other', deadline: null, priority: 3, status: 'open', reporter_principal_id: 'o1' },
  ]
  const mocks = (items: unknown = ITEMS) => mockApi({
    '/api/v1/principals/me': { body: ME },
    '/api/v1/cases': { body: CASES },
    '/api/v1/work-items': { body: items },
  })

  it('默认「我的待办」只含分派给我的项；切「未分配/全部」换口径', async () => {
    mocks()
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="work-item-w2"]')).toBeNull()
    expect(host.querySelector('[data-testid="work-item-w3"]')).toBeNull()
    // 我的待办可开始处理
    expect(host.querySelector('[data-testid="work-item-start-w1"]')).not.toBeNull()
    await act(async () => (host.querySelector('[data-testid="queue-scope-unassigned"]') as HTMLElement).click())
    await vi.waitFor(() => expect(host.querySelector('[data-testid="work-item-w2"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="work-item-w2"]')?.textContent).toContain('未分配')
    await act(async () => (host.querySelector('[data-testid="queue-scope-all"]') as HTMLElement).click())
    await vi.waitFor(() => expect(host.querySelector('[data-testid="work-item-w3"]')).not.toBeNull())
  })

  it('空态区分：我的待办为空 vs 全部为空', async () => {
    mockApi({
      '/api/v1/principals/me': { body: { id: 'p9', kind: 'human', display_name: '闲人' } },
      '/api/v1/cases': { body: CASES },
      '/api/v1/work-items': { body: [{ id: 'w1', case_id: 'c1', type: 'draft', title: '撰写三书', assignee_principal_id: 'other', deadline: null, priority: 3, status: 'open', reporter_principal_id: 'o1' }] },
    })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="queue-empty"]')?.textContent).toContain('没有分派给你的待办'))
    await act(async () => (host.querySelector('[data-testid="queue-scope-all"]') as HTMLElement).click())
    // 切到「全部」仍非空（他人工作项）
    expect(host.querySelector('[data-testid="work-item-w1"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="queue-empty"]')).toBeNull()
  })

  it('无待办时「全部」空态提示登记新案', async () => {
    mocks([])
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="queue-empty"]')?.textContent).toContain('暂无待办'))
  })
})

describe('Z29：案件台账服务端分页', () => {
  const CASE = (i: number) => ({ id: `c${i}`, organization_id: 'o1', case_key: `K-${i}`, title: `案 ${i}`, kind: 'invention', status: 'intake' })
  function mockLedger(pages: Record<string, { items: unknown[]; total: number }>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/v1/cases/page')) {
        const u = new URL(url, 'http://x')
        const k = `${u.searchParams.get('q') ?? ''}|${u.searchParams.get('offset') ?? '0'}`
        const hit = pages[k] ?? { items: [], total: 0 }
        return json({ ...hit, limit: 20, offset: Number(u.searchParams.get('offset') ?? 0) })
      }
      if (url === '/api/v1/principals/me') return json(ME)
      if (url === '/api/v1/cases') return json([])
      if (url === '/api/v1/work-items') return json([])
      return json({ detail: 'not found' }, 404)
    }))
  }

  it('台账分页渲染 + 下一页拉取第二页；行「打开」按 case_key 导航', async () => {
    mockLedger({ '|0': { items: [CASE(1), CASE(2)], total: 3 }, '|20': { items: [CASE(3)], total: 3 } })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ledger-case-c1"]')).not.toBeNull())
    expect(host.querySelector('[data-testid="ledger-total"]')?.textContent).toContain('共 3 案')
    expect(host.querySelector('[data-testid="ledger-pager"]')?.textContent).toContain('第 1 / 1 页') // limit=20 ≥ total=3
    await act(async () => (host.querySelector('[data-testid="ledger-open-c1"]') as HTMLElement).click())
    await vi.waitFor(() => expect(window.location.hash).toBe('#/p/K-1'))
  })

  it('q 筛选带上服务端参数；无命中 → 空态', async () => {
    mockLedger({ '|0': { items: [CASE(1)], total: 1 }, 'ZZ|0': { items: [], total: 0 } })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ledger-case-c1"]')).not.toBeNull())
    const input = host.querySelector('#ledger-q') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'ZZ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await vi.waitFor(() => expect(host.querySelector('[data-testid="ledger-empty"]')).not.toBeNull())
  })
})

describe('Z11/Z12：机构工作台登记新案', () => {
  it('打开登记新案对话框：机构成员列表驱动承办人选项', async () => {
    mockApi({
      '/api/v1/principals/me': { body: ME },
      '/api/v1/cases': { body: [] },
      '/api/v1/work-items': { body: [] },
      '/api/v1/organizations': { body: [{ id: 'o1', slug: 'acme', name: '知撰代理', status: 'active' }] },
      '/api/v1/organizations/o1/memberships': {
        body: [
          { organization_id: 'o1', principal_id: 'p1', role: 'owner', status: 'active', display_name: '所长' },
          { organization_id: 'o1', principal_id: 'p2', role: 'member', status: 'active', display_name: '代理人甲' },
        ],
      },
    })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="intake-open"]')).not.toBeNull())
    await act(async () => (host.querySelector('[data-testid="intake-open"]') as HTMLElement).click())
    await vi.waitFor(() => expect(document.querySelector('[data-testid="case-intake-dialog"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="intake-key"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="intake-title"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="intake-not-manager"]')).toBeNull()
    expect((document.querySelector('[data-testid="intake-submit"]') as HTMLButtonElement)?.disabled).toBe(true)
  })

  it('无机构成员身份 → 空态，不渲染表单', async () => {
    mockApi({
      '/api/v1/principals/me': { body: ME },
      '/api/v1/cases': { body: [] },
      '/api/v1/work-items': { body: [] },
      '/api/v1/organizations': { body: [] },
    })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="intake-open"]')).not.toBeNull())
    await act(async () => (host.querySelector('[data-testid="intake-open"]') as HTMLElement).click())
    await vi.waitFor(() => expect(document.querySelector('[data-testid="intake-no-org"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="intake-key"]')).toBeNull()
  })

  it('非管理员成员 → 提示无权限且禁用提交', async () => {
    mockApi({
      '/api/v1/principals/me': { body: { id: 'p2', kind: 'human', display_name: '代理人甲' } },
      '/api/v1/cases': { body: [] },
      '/api/v1/work-items': { body: [] },
      '/api/v1/organizations': { body: [{ id: 'o1', slug: 'acme', name: '知撰代理', status: 'active' }] },
      '/api/v1/organizations/o1/memberships': {
        body: [
          { organization_id: 'o1', principal_id: 'p1', role: 'owner', status: 'active', display_name: '所长' },
          { organization_id: 'o1', principal_id: 'p2', role: 'member', status: 'active', display_name: '代理人甲' },
        ],
      },
    })
    await mount(<PlatformQueue />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="intake-open"]')).not.toBeNull())
    await act(async () => (host.querySelector('[data-testid="intake-open"]') as HTMLElement).click())
    await vi.waitFor(() => expect(document.querySelector('[data-testid="intake-not-manager"]')).not.toBeNull())
    expect((document.querySelector('[data-testid="intake-submit"]') as HTMLButtonElement)?.disabled).toBe(true)
  })
})
