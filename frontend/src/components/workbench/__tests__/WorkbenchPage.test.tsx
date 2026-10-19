// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { queryClient } from '@/lib/query'
import { QueueView } from '../WorkbenchPage'
import type { PlatformCase, WorkItem } from '@/workbench/types'

let root: Root | null = null
let host: HTMLDivElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root?.render(element))
  return host
}

const cases: PlatformCase[] = [{ id: 'c1', organization_id: 'o1', case_key: 'CN-1', title: '一种方法', kind: 'invention', status: 'drafting' }]
const items: WorkItem[] = [
  { id: 'w1', case_id: 'c1', type: 'review', title: '复核权利要求', assignee_principal_id: 'p1', deadline: '2099-01-01T00:00:00Z', priority: 2, status: 'open', reporter_principal_id: 'p1' },
  { id: 'w2', case_id: 'c1', type: 'draft', title: '已完成草稿', assignee_principal_id: 'p1', deadline: null, priority: 3, status: 'done', reporter_principal_id: 'p1' },
]

describe('workbench queue', () => {
  it('renders queue rows, filters by status, and opens the case', async () => {
    let opened = ''
    const el = await mount(
      <QueryClientProvider client={queryClient}>
        <QueueView cases={cases} items={items} onOpenCase={(id) => { opened = id }} meId="p1" />
      </QueryClientProvider>,
    )
    expect(el.querySelector('[data-testid="work-item-w1"]')?.textContent).toContain('复核权利要求')
    expect(el.querySelector('[data-testid="work-item-w2"]')).not.toBeNull()
    const select = el.querySelector('select[aria-label="工作项状态"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'open'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="work-item-w1"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="work-item-w2"]')).toBeNull()
    await act(async () => (el.querySelector('[data-testid="work-item-w1"] button') as HTMLButtonElement).click())
    expect(opened).toBe('c1')
  })
})
