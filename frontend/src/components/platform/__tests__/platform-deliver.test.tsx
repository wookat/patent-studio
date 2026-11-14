// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PlatformPreflightCard, PlatformReleasesCard } from '../PlatformDeliver'
import { queryClient } from '@/lib/query'
import type { PlatformCase } from '@/workbench/types'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const CASE: PlatformCase = { id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'drafting' } as PlatformCase

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(overrides: Record<string, { body: unknown; status?: number }> = {}) {
  const defaults: Record<string, { body: unknown; status?: number }> = {
    '/api/v1/cases/c1/releases': { body: [{ id: 'rel1', case_id: 'c1', status: 'sealed' }] },
    '/api/v1/cases/c1/documents': { body: [] },
    '/api/v1/cases/c1/figures': { body: [] },
    '/api/v1/releases/rel1/items': { body: [{ id: 'i1' }, { id: 'i2' }] },
    '/api/v1/releases/rel1/artifacts': { body: [{ id: 'art1', release_id: 'rel1', filename: '递交包.docx', content_ref: {}, inputs: [], created_at: '2026-01-01T00:00:00Z' }] },
    '/api/v1/cases/c1/preflight': { body: { counts: { error: 1, warning: 0, info: 0 }, items: [{ severity: 'error', rule: 'claims.forward_ref', message: '前引权项未定义', book: 'claims', line: 3 }] } },
    ...overrides,
  }
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const hit = defaults[url]
      return hit ? json(hit.body, hit.status ?? 200) : json({ detail: 'not found' }, 404)
    }),
  )
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
  queryClient.clear() // 共享 client 的缓存跨用例残留（staleTime 30s），逐例清
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  await act(async () => { await Promise.resolve() })
  return host
}

const q = (sel: string) => host.querySelector(sel)

describe('M3 递交页平台卡（自带 QueryClientProvider，页面裸挂载兼容）', () => {
  it('发布包卡：sealed 发布 → 组包项计数 + 构建按钮 + DOCX 下载链接', async () => {
    mockApi()
    await mount(<PlatformReleasesCard caseItem={CASE} />)
    await vi.waitFor(() => expect(q('[data-testid="release-rel1"]')?.textContent).toContain('组包项 2 件'))
    expect(q('[data-testid="build-rel1"]')?.textContent).toContain('构建 DOCX')
    const link = q('[data-testid="artifact-art1"]') as HTMLAnchorElement
    expect(link?.getAttribute('href')).toBe('/api/v1/artifacts/art1/content')
    expect(link.textContent).toContain('递交包.docx')
  })

  it('平台体检卡：preflight 计数 + 按规则分组的条目', async () => {
    mockApi()
    await mount(<PlatformPreflightCard caseId="c1" />)
    await vi.waitFor(() => expect(q('[data-testid="health-counts"]')?.textContent).toContain('错误 1'))
    expect(q('[data-testid="workbench-health"]')?.textContent).toContain('前引权项未定义')
    // T10：平台体检明示为诊断参考，不参与递交就绪判定
    expect(q('[data-testid="deliver-platform-preflight"]')?.textContent).toContain('诊断参考')
    expect(q('[data-testid="deliver-platform-preflight"]')?.textContent).toContain('不参与递交就绪判定')
  })

  it('后端 404/无发布 → 空态而非报错', async () => {
    mockApi({ '/api/v1/cases/c1/releases': { body: [] } })
    await mount(<PlatformReleasesCard caseItem={CASE} />)
    await vi.waitFor(() => expect(q('[data-testid="workbench-releases"]')?.textContent).toContain('暂无发布版本'))
  })
})
