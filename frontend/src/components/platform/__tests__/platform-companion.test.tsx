// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'
import { queryClient } from '@/lib/query'
import { MaterialsCompanionBody, ProposalsCompanionBody } from '../PlatformCompanion'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

const CASE = { id: 'c1', organization_id: 'o1', case_key: 'method', title: '方法案', kind: 'invention', status: 'drafting' }
const PROPOSALS = [{ id: 'pr0000000001', case_id: 'c1', target_kind: 'document', status: 'submitted', accepted_document_revision_id: null }]
const MATERIALS = [
  { id: 'm1', case_id: 'c1', kind: 'paper', title: 'Transformer 论文', source_url: 'https://arxiv.org/x', content_ref: { key: 'k', sha256: 's', size: 1, content_type: 'text/plain' }, status: 'active', created_at: '2026-01-01T00:00:00Z' },
]
const FACTS = [
  { id: 'f1', case_id: 'c1', material_id: 'm1', anchor_id: null, statement: '注意力复杂度 O(n²)', status: 'pending', rejection_reason: null, decided_by_principal_id: null, decided_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'f2', case_id: 'c1', material_id: null, anchor_id: null, statement: '训练集 10k', status: 'confirmed', rejection_reason: null, decided_by_principal_id: 'p1', decided_at: '2026-01-02T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(opts: { cases?: unknown; casesStatus?: number } = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      if (url === '/api/v1/cases') return json(opts.cases ?? [CASE], opts.casesStatus ?? 200)
      if (url === '/api/v1/cases/c1/proposals') return json(PROPOSALS)
      if (url === '/api/v1/cases/c1/materials') return json(MATERIALS)
      if (url === '/api/v1/cases/c1/facts') return json(FACTS)
      return json({ detail: 'not found' }, 404)
    }),
  )
  return calls
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  useStudio.setState({ pid: 'method' })
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

const q = (sel: string) => host.querySelector(sel)

describe('M4 工作台伴随栏：平台案件作用域', () => {
  it('proposals 面板：pid→case_key 命中 → 提案列表 + 提交/采纳/拒绝按钮', async () => {
    mockApi()
    await mount(<ProposalsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="proposal-pr0000000001"]')).not.toBeNull())
    expect(q('[data-testid="proposal-pr0000000001"]')?.textContent).toContain('文稿提案')
  })

  it('materials 面板：资料列表（查看原文链接）+ 事实确认/驳回行', async () => {
    mockApi()
    await mount(<MaterialsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="material-m1"]')).not.toBeNull())
    expect(q('[data-testid="material-content-m1"]')?.getAttribute('href')).toBe('/api/v1/materials/m1/content')
    await vi.waitFor(() => expect(q('[data-testid="fact-f1"]')).not.toBeNull())
    expect(q('[data-testid="fact-f1"]')?.textContent).toContain('注意力复杂度')
    expect(q('[data-testid="fact-confirm-f1"]')).not.toBeNull()
    expect(q('[data-testid="fact-reject-f1"]')).not.toBeNull()
    // 已确认事实无操作按钮
    expect(q('[data-testid="fact-confirm-f2"]')).toBeNull()
    expect(q('[data-testid="fact-f2"]')?.textContent).toContain('已确认')
  })

  it('纯旧案（cases 里无同 key）→ 未迁移空态，不报错', async () => {
    mockApi({ cases: [] })
    await mount(<ProposalsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="platform-not-migrated"]')).not.toBeNull())
  })

  it('/api/v1/cases 401 → 显示加载失败，不冒充未关联', async () => {
    mockApi({ casesStatus: 401 })
    await mount(<ProposalsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="platform-error"]')).not.toBeNull())
    expect(q('[data-testid="platform-not-migrated"]')).toBeNull()
  })

  it('无 pid → 未打开案卷空态', async () => {
    useStudio.setState({ pid: null })
    mockApi()
    await mount(<ProposalsCompanionBody />)
    expect(q('[data-testid="platform-no-case"]')).not.toBeNull()
  })

  it('跨机构同案号不读取任何案件的提案或材料', async () => {
    const calls = mockApi({ cases: [CASE, { ...CASE, id: 'c2', organization_id: 'other-org' }] })
    await mount(<ProposalsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="platform-error"]')?.textContent).toContain('多个同案号'))
    expect(calls.some((url) => /\/cases\/[^/]+\/(proposals|materials|facts)/.test(url))).toBe(false)
  })

  it('服务 503 不显示为未关联案件', async () => {
    mockApi({ casesStatus: 503 })
    await mount(<MaterialsCompanionBody />)
    await vi.waitFor(() => expect(q('[data-testid="platform-error"]')).not.toBeNull())
    expect(q('[data-testid="platform-not-migrated"]')).toBeNull()
  })
})
