// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Document, Figure, Release, WorkItem } from '@/workbench/types'
import { DeadlinesPanel, FiguresPanel, HealthPanel, ReleasesPanel } from '../WorkbenchPage'

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

const figure: Figure = {
  id: 'f1', case_id: 'c1', document_id: null, figure_no: 1, title: '方法流程图',
  current_revision_id: 'r1',
}
const doc: Document = { id: 'd1', case_id: 'c1', book: 'claims', current_revision_id: 'rev-d1' }
const release: Release = { id: 'rel1', case_id: 'c1', status: 'created' }
const sealed: Release = { id: 'rel2', case_id: 'c1', status: 'sealed', sealed_at: '2026-10-18T08:30:00Z' }
const item: WorkItem = {
  id: 'w1', case_id: 'c1', type: 'oa-response', title: 'OA1 答复', status: 'open',
  reporter_principal_id: 'p1', assignee_principal_id: null,
  deadline: '2020-01-01T00:00:00Z', priority: 3, document_id: null, figure_document_id: null,
  release_id: null, official_no: null, oa_deadline: '2020-02-01T00:00:00Z', response_document_id: null,
}

describe('B13 workbench panels', () => {
  it('figures panel renders thumbnail via content endpoint and creates a figure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...figure, id: 'f2' }))
    const el = await mount(<FiguresPanel caseId="c1" figures={stub([figure])} />)
    const img = el.querySelector('[data-testid="figure-img-f1"]') as HTMLImageElement
    expect(img.src).toContain('/api/v1/figures/f1/content?v=r1')

    const title = el.querySelector('input[aria-label="附图名称"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(title, '结构示意图')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const create = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('新建附图')) as HTMLButtonElement
    await act(async () => create.click())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/cases/c1/figures')
    expect(JSON.parse(String(init.body))).toMatchObject({ figure_no: null, title: '结构示意图' })
  })

  it('figure upload posts multipart file to revisions route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ id: 'fr1', revision_no: 2 }))
    const el = await mount(<FiguresPanel caseId="c1" figures={stub([figure])} />)
    const input = el.querySelector('[data-testid="figure-upload-f1"] input') as HTMLInputElement
    const file = new File([new Uint8Array([0x89, 0x50])], 'fig1.png', { type: 'image/png' })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/v1/figures/f1/revisions'))
    expect(call).toBeTruthy()
    const init = call![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy()
  })

  it('deadlines panel marks overdue items and reschedules via PUT deadline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...item }))
    const el = await mount(<DeadlinesPanel caseId="c1" items={stub([item])} />)
    const row = el.querySelector('[data-testid="deadline-w1"]')!
    expect(row.textContent).toContain('逾期')
    expect(row.textContent).toContain('OA 答复期限')

    const input = row.querySelector('input[type="datetime-local"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '2030-05-01T09:00')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '改期') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await act(async () => save.click())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/work-items/w1/deadline')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toMatchObject({ deadline: new Date('2030-05-01T09:00').toISOString() })
  })

  it('releases panel packs current revisions, seals, builds and links the artifact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.endsWith('/items') && method === 'GET')
        return json(url.includes('rel2') ? [{ id: 'i2', release_id: 'rel2', ordinal: 1, item_kind: 'document', document_revision_id: 'revd-1234-abcd', figure_revision_id: null, content_sha256: 'b'.repeat(64) }] : [])
      if (url.includes('/artifacts')) return json([{ id: 'a1', release_id: 'rel2', filename: 'CN-1-rel2.docx', content_ref: { key: 'k', sha256: 'a'.repeat(64), size: 10, content_type: 'application/x' }, inputs: [], created_at: '2026-10-14T00:00:00Z' }])
      if (url.endsWith('/items')) return json({ id: 'i1', release_id: 'rel1', ordinal: 1, item_kind: 'document' })
      if (url.endsWith('/seal')) return json({ ...release, status: 'sealed' })
      if (url.endsWith('/build')) return json({ id: 'a1', release_id: 'rel2', filename: 'CN-1-rel2.docx' })
      return json({})
    })
    const releases = stub([release, sealed])
    const el = await mount(<ReleasesPanel caseId="c1" releases={releases} documents={[doc]} figures={[figure]} />)

    // draft release：组包三书+附图 → document revision + figure current revision 各一件
    const pack = el.querySelector('[data-testid="pack-rel1"]') as HTMLButtonElement
    await act(async () => pack.click())
    await act(async () => { await Promise.resolve() })
    const itemCalls = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/items') && (i as RequestInit)?.method === 'POST')
    expect(itemCalls.map(([, i]) => JSON.parse(String((i as RequestInit).body)))).toEqual([
      { item_kind: 'document', revision_id: 'rev-d1', ordinal: 1 },
      { item_kind: 'figure', revision_id: 'r1', ordinal: 2 },
    ])

    // sealed release：构建 DOCX + 已存在的产物下载链接
    const build = el.querySelector('[data-testid="build-rel2"]') as HTMLButtonElement
    expect(build).toBeTruthy()
    await act(async () => build.click())
    const buildCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/rel2/build'))
    expect(buildCall).toBeTruthy()
    expect((buildCall![1] as RequestInit).method).toBe('POST')
    const link = el.querySelector('[data-testid="artifact-a1"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/v1/artifacts/a1/content')
    expect(link.getAttribute('download')).toBe('CN-1-rel2.docx')
    expect(link.getAttribute('title')).toBe(`sha256:${'a'.repeat(64)}`)

    // Z24：sealed 行透出冻结时间与逐项版本指纹（revision+sha256）
    expect(el.querySelector('[data-testid="sealed-at-rel2"]')!.textContent).toContain('冻结于')
    const snap = el.querySelector('[data-testid="snapshot-i2"]')!
    expect(snap.textContent).toContain('revd-123')
    expect(snap.textContent).toContain('b'.repeat(12))
  })

  it('health panel groups kernel preflight items by rule', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      version: 1,
      counts: { error: 1, warning: 1, info: 0 },
      items: [
        { rule: 'figures.ref_missing', severity: 'error', message: '正文引用了图1，但未设置说明书附图', book: 'description', line: 12, block_id: 'description/3', detail: null },
        { rule: 'abstract.limit', severity: 'warning', message: '摘要 320 字', book: 'abstract', line: 4, block_id: 'abstract', detail: null },
      ],
      claim_tree: [], numerals: [], support_map: [], figures: [],
    }))
    const el = await mount(<HealthPanel caseId="c1" />)
    await vi.waitFor(() => expect(el.querySelector('[data-testid="health-counts"]')).toBeTruthy())
    expect(el.querySelector('[data-testid="health-counts"]')?.textContent).toContain('错误 1')
    expect(el.querySelector('[data-testid="health-rule-figures.ref_missing"]')?.textContent).toContain('引用了不存在的图')
    expect(el.textContent).toContain('说明书 · 第 12 行')
    expect(el.textContent).toContain('摘要超字数')
  })
})
