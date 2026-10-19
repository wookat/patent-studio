// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import type { AgentJob } from '@/types/agent'
import { AiJobsTab } from '../AiJobsTab'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    agentJobs: [],
    agentEvents: {},
    agentActiveJobId: null,
    agentLoading: false,
    agentUnavailable: false,
    agentBudget: null,
    settings: { ai_enabled: true } as never,
    project: { role: 'editor' } as never,
    proposals: [],
  })
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
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

const job = (over: Partial<AgentJob>): AgentJob => ({
  id: 'job_1',
  kind: 'agent:s6',
  pid: 'p1',
  status: 'interrupted',
  progress: 0.4,
  message: '服务重启，任务中断',
  result: null,
  error: null,
  created_at: 0,
  updated_at: 0,
  steps: [],
  queue_key: null,
  ...over,
})

describe('Z14/Z25/Z27 任务卡续跑与产物链', () => {
  it('interrupted + payload → 显示「续跑」；点击调 resume 并重订阅', async () => {
    const spy = vi.spyOn(api, 'agentResume').mockResolvedValue(job({ id: 'job_1', status: 'queued' }))
    useStudio.setState({ agentJobs: [job({ payload: { scenario: 's6', params: {} }, proposal_ids: ['prop_a'] })] })
    const el = await mount(<AiJobsTab pid="p1" compact={false} />)
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="ai-job-resume-job_1"]')!
    expect(btn.textContent).toContain('续跑')
    // Z27：产出台账 chip 存在
    expect(el.querySelector('[data-testid="ai-job-proposals-job_1"]')?.textContent).toContain('1')
    await act(async () => btn.click())
    expect(spy).toHaveBeenCalledWith('job_1')
    expect(useStudio.getState().agentJobs[0].status).toBe('queued')
  })

  it('error + payload → 「重试」；无 payload 的中断任务不显示入口', async () => {
    useStudio.setState({
      agentJobs: [
        job({ id: 'job_e', status: 'error', error: { kind: 'ai_timeout', message: '超时' }, payload: { scenario: 's6' } }),
        job({ id: 'job_n', status: 'interrupted', payload: null }),
      ],
    })
    const el = await mount(<AiJobsTab pid="p1" compact={false} />)
    expect(el.querySelector('[data-testid="ai-job-resume-job_e"]')?.textContent).toContain('重试')
    expect(el.querySelector('[data-testid="ai-job-resume-job_n"]')).toBeNull()
  })
})
