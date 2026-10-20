// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import { AiJobsTab } from '../AiJobsTab'
import type { AgentMetrics } from '@/lib/api/ai'

/** Z32：成果度量卡——分桶计数渲染、未采集标注、失败/待审可点回、空样本不渲染。 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
let root: Root | null = null
let host: HTMLElement

const M: AgentMetrics = {
  sample: { jobs: 4, proposals: 3, usage_rows: 2 },
  jobs: {
    total: 4, queued: 0, running: 1, done: 1, error: 1, interrupted: 1, resumed: 1,
    items: [
      { id: 'job_aaaaaa', kind: 'agent:s1', status: 'error', progress: 0, created_at: 1, updated_at: 2, duration_s: 1, resumed: false, proposal_ids: [], error: { kind: 'ai_upstream', message: 'boom' } },
      { id: 'job_bbbbbb', kind: 'agent:s6', status: 'done', progress: 1, created_at: 1, updated_at: 3, duration_s: 2, resumed: true, proposal_ids: ['p1'], error: null },
    ],
  },
  proposals: {
    produced: 3, pending: 1, applied: 1, dismissed: 1,
    items: [{ id: 'prop_xyz123', job_id: 'job_bbbbbb', scenario: 's6', kind: 'critic', state: 'pending', model: 'm', created_at: 1 }],
  },
  usage: { rows: 2, total_tokens: 150 },
  cost: { collected: false, reason: 'r' },
  human_edits: { collected: false, reason: 'r' },
  limits: ['采纳率不作质量排名'],
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

describe('Z32 MetricsCard', () => {
  it('分桶计数 + 未采集标注 + 明细可点回任务/提案', async () => {
    vi.spyOn(api, 'agentMetrics').mockResolvedValue(M)
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [] })
    vi.spyOn(api, 'aiBudget').mockResolvedValue({ today_tokens: 0, budget: 0 })
    const h = await mount(<AiJobsTab pid="p1" compact={false} />)
    await act(async () => Promise.resolve())
    const counts = h.querySelector('[data-testid="ai-metrics-counts"]')
    expect(counts?.textContent).toContain('产出 3')
    expect(counts?.textContent).toContain('待审 1')
    expect(counts?.textContent).toContain('采纳 1')
    expect(counts?.textContent).toContain('拒绝 1')
    expect(counts?.textContent).toContain('失败 1')
    expect(counts?.textContent).toContain('中断 1')
    expect(counts?.textContent).toContain('恢复 1')
    expect(h.querySelector('[data-testid="ai-metrics"]')!.textContent).toContain('未采集')
    // 展开明细：失败任务与待审提案可点回
    await act(async () => (h.querySelector('[data-testid="ai-metrics-toggle"]') as HTMLElement).click())
    expect(h.querySelector('[data-testid="ai-metrics-job-job_aaaaaa"]')).not.toBeNull()
    expect(h.querySelector('[data-testid="ai-metrics-prop-prop_xyz123"]')).not.toBeNull()
    expect(h.querySelector('[data-testid="ai-metrics-limits"]')!.textContent).toContain('质量排名')
    await act(async () => (h.querySelector('[data-testid="ai-metrics-job-job_aaaaaa"]') as HTMLElement).click())
    expect(useStudio.getState().agentActiveJobId).toBe('job_aaaaaa')
  })

  it('空样本不渲染卡片', async () => {
    vi.spyOn(api, 'agentMetrics').mockResolvedValue({ ...M, sample: { jobs: 0, proposals: 0, usage_rows: 0 } })
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [] })
    vi.spyOn(api, 'aiBudget').mockResolvedValue({ today_tokens: 0, budget: 0 })
    const h = await mount(<AiJobsTab pid="p1" compact={false} />)
    await act(async () => Promise.resolve())
    expect(h.querySelector('[data-testid="ai-metrics"]')).toBeNull()
  })
})
