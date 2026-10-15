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

describe('M6：dashboard 工作项分段（一案双体去重后按 case_key 导航）', () => {
  it('工作项行渲染 + 打开 → #/p/<case_key>', async () => {
    mockApi({
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
