// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query'
import { QueueView } from '../WorkbenchPage'

let root: Root | null = null
let host: HTMLDivElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  queryClient.clear()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
})

async function mount(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root?.render(element))
  return host
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const CASE = { id: 'c1', organization_id: 'o1', case_key: 'CN-1', title: '一种方法', kind: 'invention', status: 'drafting' }
const W1 = { id: 'w1', case_id: 'c1', type: 'review', title: '复核权利要求', assignee_principal_id: 'p1', deadline: '2099-01-01T00:00:00Z', priority: 2, status: 'open', reporter_principal_id: 'p1', case: CASE }
const W2 = { id: 'w2', case_id: 'c1', type: 'draft', title: '已完成草稿', assignee_principal_id: 'p1', deadline: null, priority: 3, status: 'done', reporter_principal_id: 'p1', case: CASE }

/** 阶段6：QueueView 自拉服务端分页数据；pages 用 `{status}` 或 `{status}|{q}` 键取页 */
function mockWorkItems(pages: Record<string, { items: unknown[]; total?: number }>, urls?: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.startsWith('/api/v1/work-items')) return json({ detail: 'not found' }, 404)
    urls?.push(url)
    const u = new URL(url, 'http://x')
    const key = `${u.searchParams.get('status') ?? ''}|${u.searchParams.get('q') ?? ''}`
    const hit = pages[key] ?? pages[u.searchParams.get('status') ?? ''] ?? { items: [], total: 0 }
    return json({ items: hit.items, total: hit.total ?? hit.items.length, limit: Number(u.searchParams.get('limit') ?? 20), offset: Number(u.searchParams.get('offset') ?? 0) })
  }))
}

describe('workbench queue（阶段6 服务端分页契约）', () => {
  it('渲染工作项行、案件列随附 case、打开回调带 case_key；中文徽标不外露枚举', async () => {
    let opened: [string, string?] = ['', undefined]
    mockWorkItems({ '|': { items: [W1, W2], total: 2 } })
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={(id, key) => { opened = [id, key] }} meId="p1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    const row1 = el.querySelector('[data-testid="work-item-w1"]')!
    expect(row1.textContent).toContain('复核权利要求')
    expect(row1.textContent).toContain('CN-1')
    expect(row1.textContent).toContain('一种方法')
    expect(row1.textContent).toContain('复核')
    expect(row1.textContent).toContain('待处理')
    expect(row1.textContent).not.toContain('review')
    expect(el.querySelector('[data-testid="work-item-w2"]')).not.toBeNull()
    await act(async () => (el.querySelector('[data-testid="work-item-open-w1"]') as HTMLButtonElement).click())
    expect(opened).toEqual(['c1', 'CN-1'])
  })

  it('状态筛选进入服务端 status 参数并重置到第一页', async () => {
    const urls: string[] = []
    mockWorkItems({ '|': { items: [W1, W2], total: 2 }, 'open|': { items: [W1], total: 1 } }, urls)
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={() => {}} meId="p1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w2"]')).not.toBeNull())
    const select = el.querySelector('select[aria-label="工作项状态"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'open'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // 阶段6收口：筛选变更不再保留上一筛选行（placeholder 仅同筛选翻页）——w2 立即消失，
    // 等 'open' 页数据到达后 w1 渲染
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    expect(el.querySelector('[data-testid="work-item-w2"]')).toBeNull()
    expect(urls.some((u) => new URL(u, 'http://x').searchParams.get('status') === 'open')).toBe(true)
  })

  it('上一页/下一页真正翻页；总数来自服务端 total', async () => {
    const urls: string[] = []
    mockWorkItems({
      '|': { items: [W1], total: 21 },
    }, urls)
    // 第二页（offset=20）返回 W2
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      const u = new URL(url, 'http://x')
      const offset = Number(u.searchParams.get('offset') ?? 0)
      return json({ items: offset === 0 ? [W1] : [W2], total: 21, limit: 20, offset })
    }))
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={() => {}} meId="p1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    expect(el.querySelector('[data-testid="queue-total"]')?.textContent).toContain('共 21 项')
    expect(el.querySelector('[data-testid="queue-pager"]')?.textContent).toContain('第 1 / 2 页')
    await act(async () => (el.querySelector('[data-testid="queue-pager"] button:last-child') as HTMLElement).click())
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w2"]')).not.toBeNull())
    expect(el.querySelector('[data-testid="queue-pager"]')?.textContent).toContain('第 2 / 2 页')
    expect(urls.some((u) => new URL(u, 'http://x').searchParams.get('offset') === '20')).toBe(true)
    await act(async () => (el.querySelector('[data-testid="queue-pager"] button:first-child') as HTMLElement).click())
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
  })

  it('服务端 total 缩小使当前页越界时自动回退最后有效页（不停在空页）', async () => {
    let total = 40
    const all = Array.from({ length: 40 }, (_, i) => ({ ...W1, id: `w${i}`, title: `事项${i}` }))
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/v1/work-items')) return json({ detail: 'not found' }, 404)
      urls.push(url)
      const u = new URL(url, 'http://x')
      const offset = Number(u.searchParams.get('offset') ?? 0)
      const limit = Number(u.searchParams.get('limit') ?? 20)
      return json({ items: all.slice(offset, Math.min(offset + limit, total)), total, limit, offset })
    }))
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={() => {}} meId="p1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w0"]')).not.toBeNull())
    await act(async () => (el.querySelector('[data-testid="queue-pager"] button:last-child') as HTMLElement).click())
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w20"]')).not.toBeNull())
    expect(el.querySelector('[data-testid="queue-pager"]')?.textContent).toContain('第 2 / 2 页')
    // mutation/权限变化：total 40→20，offset=20 已越界——失效重取后应自动回第1页
    total = 20
    await act(async () => { await queryClient.invalidateQueries() })
    await vi.waitFor(() => {
      expect(el.querySelector('[data-testid="queue-pager"]')?.textContent).toContain('第 1 / 1 页')
      expect(el.querySelector('[data-testid="work-item-w0"]')).not.toBeNull()
    })
  })

  it('筛选变更不残留上一筛选的行（placeholder 仅同筛选翻页保留）', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/v1/work-items')) return json({ detail: 'not found' }, 404)
      urls.push(url)
      const u = new URL(url, 'http://x')
      const assignee = u.searchParams.get('assignee') ?? ''
      // 未分配筛选的响应故意挂起——若 placeholder 跨筛选保留，w1 会在加载中仍可见（回归形态）
      if (assignee === 'none') return new Promise<Response>(() => {})
      return json({ items: [W1], total: 1, limit: 20, offset: 0 })
    }))
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={() => {}} meId="p1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull())
    await act(async () => (el.querySelector('[data-testid="queue-scope-unassigned"]') as HTMLElement).click())
    await vi.waitFor(() => expect(urls.some((u) => u.includes('assignee=none'))).toBe(true))
    // 切换瞬间：上一筛选的 w1 立即消失，显示加载态而非「未分配」下的我的待办行
    expect(el.querySelector('[data-testid="work-item-w1"]')).toBeNull()
    expect(el.querySelector('[role="status"]')).not.toBeNull()
    // fetch 仍挂起时强制父组件 rerender（再 render 同树）：旧筛选行仍不可见——
    // placeholderData 只认 previousQuery 的同筛选 key，不因多次 render 重新启用
    await act(async () => root!.render(
      <QueryClientProvider client={queryClient}>
        <QueueView onOpenCase={() => {}} meId="p1" />
      </QueryClientProvider>,
    ))
    expect(el.querySelector('[data-testid="work-item-w1"]')).toBeNull()
    expect(el.querySelector('[role="status"]')).not.toBeNull()
  })
})
