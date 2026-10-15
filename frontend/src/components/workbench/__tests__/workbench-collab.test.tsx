// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeServer, flush } from '@/collab/__tests__/fakeServer'
import { connectWorkingCopy, YTEXT_KEY } from '@/workbench/collab'
import type { Document } from '@/workbench/types'
import { WorkingCopyEditor } from '../WorkingCopyEditor'

let root: Root | null = null
let host: HTMLDivElement
let queryClient: QueryClient
const calls: Array<{ url: string; method: string }> = []

const doc: Document = { id: 'd1', case_id: 'c1', book: 'claims', current_revision_id: 'r1' }
const copy = (version: number) => ({
  id: 'wc1', document_id: 'd1', principal_id: 'p1', base_revision_id: 'r1',
  version, content_ref: { key: 'k', sha256: 'a'.repeat(64), size: 1, content_type: 'text/markdown' },
})

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
})

function route(url: string, method: string): Response {
  if (method === 'GET' && url === '/api/v1/principals/me') return json({ id: 'p1', kind: 'human', display_name: '代理师甲' })
  if (method === 'POST' && url === '/api/v1/documents/d1/working-copies') return json(copy(1), { status: 201 })
  if (method === 'GET' && url === '/api/v1/working-copies/wc1/content') {
    return new Response('原始内容', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
  }
  if (method === 'PUT' && url === '/api/v1/working-copies/wc1/content') return json(copy(2))
  if (method === 'POST' && url === '/api/v1/working-copies/wc1/collab/flush') return json({ flushed: 1 })
  if (method === 'POST' && url === '/api/v1/working-copies/wc1/commit') return json({ operation_id: 'op1', status: 'done' })
  return json({ detail: { kind: 'not_found', message: url, line: null, detail: null } }, { status: 404 })
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    calls.push({ url, method })
    return route(url, method)
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  calls.length = 0
})

async function mount(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  root = createRoot(host)
  await act(async () => root?.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>))
  return host
}

async function openEditor(server: FakeServer) {
  const el = await mount(<WorkingCopyEditor document={doc} websocketPolyfill={server.WebSocket} />)
  const openBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('打开工作副本')) as HTMLButtonElement
  await act(async () => openBtn.click())
  await act(() => flush())
  await vi.waitFor(() => {
    expect(el.querySelector('[data-testid="collab-status"]')?.textContent).toContain('协同已连接')
  })
  return el
}

function textarea(el: HTMLElement): HTMLTextAreaElement {
  return el.querySelector('textarea') as HTMLTextAreaElement
}

async function type(el: HTMLElement, value: string) {
  const area = textarea(el)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickButton(el: HTMLElement, name: string) {
  const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(name)) as HTMLButtonElement
  expect(btn, `button ${name}`).toBeTruthy()
  await act(async () => btn.click())
  await act(() => flush())
}

describe('working copy collab editor', () => {
  it('本地编辑上行、远端更新下行：双端同房间实时合并', async () => {
    const server = new FakeServer()
    const el = await openEditor(server)
    // 首个 sync 后 REST 内容种入空房间
    expect(textarea(el).value).toBe('原始内容')
    expect(server.text('collab')).toBe('原始内容')

    // 远端对等端：不经 React 直连同一房间
    const remote = connectWorkingCopy('wc1', { name: '协作者乙' }, {
      onStatus: () => {}, onPeers: () => {},
    }, { WebSocketPolyfill: server.WebSocket })
    await act(() => flush(50))
    expect(remote).not.toBeNull()
    await act(async () => {
      remote!.doc.transact(() => remote!.text.insert(remote!.text.length, '\n\n4. 新增从属权项'), 'remote')
    })
    await act(() => flush(50))
    await vi.waitFor(() => expect(textarea(el).value).toContain('新增从属权项'))

    // 本端编辑 → 远端 Y.Text 立即可见
    await type(el, textarea(el).value + '\n\n5. 本端补写')
    await act(() => flush(50))
    await vi.waitFor(() => expect(remote!.text.toString()).toContain('本端补写'))
    remote!.destroy()
  })

  it('存在未 flush 更新时提交：先保存内容、再 flush、最后 commit', async () => {
    const server = new FakeServer()
    const el = await openEditor(server)
    await type(el, '原始内容\n\n修订一行')
    await act(() => flush(30))
    await vi.waitFor(() => expect(el.querySelector('[data-testid="collab-pending"]')).toBeTruthy())

    await clickButton(el, '同步并提交')
    const seq = calls.map((c) => `${c.method} ${c.url}`)
    const order = [
      seq.indexOf('PUT /api/v1/working-copies/wc1/content'),
      seq.indexOf('POST /api/v1/working-copies/wc1/collab/flush'),
      seq.indexOf('POST /api/v1/working-copies/wc1/commit'),
    ]
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(el.textContent).toContain('已提交为新 revision')
  })

  it('断线提示重连中；重连后同步远端内容', async () => {
    const server = new FakeServer()
    const el = await openEditor(server)
    server.dropAll(1006)
    await vi.waitFor(() => {
      expect(el.querySelector('[data-testid="collab-status"]')?.textContent).toContain('重连中')
    })
    // 断线期间远端房内有写入（服务端权威文本变化）
    server.room('collab').doc.getText(YTEXT_KEY).insert(0, '【远端插入】')
    await vi.waitFor(
      () => expect(el.querySelector('[data-testid="collab-status"]')?.textContent).toContain('协同已连接'),
      { timeout: 8000 },
    )
    await vi.waitFor(() => expect(textarea(el).value).toContain('【远端插入】'))
  }, 15000)

  it('服务端 1008 拒绝：回退本地模式，REST 保存仍可用', async () => {
    const server = new FakeServer()
    server.reject = { code: 1008, reason: 'forbidden' }
    const el = await mount(<WorkingCopyEditor document={doc} websocketPolyfill={server.WebSocket} />)
    const openBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('打开工作副本')) as HTMLButtonElement
    await act(async () => openBtn.click())
    await act(() => flush(30))
    await vi.waitFor(() => {
      expect(el.querySelector('[data-testid="collab-status"]')?.textContent).toContain('本地模式')
    })
    await type(el, '离线编辑内容')
    calls.length = 0
    await clickButton(el, '保存')
    const seq = calls.map((c) => `${c.method} ${c.url}`)
    expect(seq).toContain('PUT /api/v1/working-copies/wc1/content')
    expect(seq).not.toContain('POST /api/v1/working-copies/wc1/collab/flush')
  })
})
