// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import type { AiJob } from '@/types/ai'
import { useStudio } from '@/store'
import { JOB_POLL_MS, isJobDone, selectAiEnabled } from '../ai'

const job = (status: AiJob['status'], progress = 0): AiJob => ({
  id: 'job_1', kind: 'review', pid: 'method', status, progress, message: '', result: null, error: null, created_at: 1, updated_at: 1,
})

beforeEach(() => {
  vi.useFakeTimers()
  useStudio.getState().resetAi()
})
afterEach(() => {
  useStudio.getState().resetAi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ai slice · watchJob（09 §2.3：SSE 优先，退回轮询，终态停止）', () => {
  it('无 EventSource（jsdom/Node）⇒ 按 JOB_POLL_MS 轮询 GET /api/ai/jobs/{id}，done 后不再请求', async () => {
    const spy = vi.spyOn(api, 'aiJob')
      .mockResolvedValueOnce(job('running', 0.5))
      .mockResolvedValueOnce(job('done', 1))
    useStudio.getState().watchJob('job_1')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().jobs[0]?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(JOB_POLL_MS)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(useStudio.getState().jobs[0]?.status).toBe('done')
    await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 3)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('重复 watch 同一 id 不重复轮询；501 停止跟踪', async () => {
    const spy = vi.spyOn(api, 'aiJob').mockRejectedValue(new ApiError(501, '尚未落地'))
    useStudio.getState().watchJob('job_1')
    useStudio.getState().watchJob('job_1')
    await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 2)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('upsertJob 新增置顶、同 id 替换；isJobDone 覆盖三个终态', () => {
    const s = useStudio.getState()
    s.upsertJob({ ...job('queued'), id: 'a' })
    s.upsertJob({ ...job('queued'), id: 'b' })
    s.upsertJob({ ...job('running', 0.2), id: 'a' })
    expect(useStudio.getState().jobs.map((j) => `${j.id}:${j.status}`)).toEqual(['b:queued', 'a:running'])
    expect(['done', 'error', 'interrupted'].every((st) => isJobDone(job(st as AiJob['status'])))).toBe(true)
    expect(isJobDone(job('running'))).toBe(false)
  })

  it('convert→新建案卷：job.pid=新案 id 的帧按 convertJobId 认领进 convertJob（批37 D2 回归）', () => {
    useStudio.setState({ pid: 'method', convertJobId: 'job_cv', convertJob: null, jobs: [] })
    const s = useStudio.getState()
    // 外案 pid 的帧：进 convertJob，不入 jobs，不丢
    s.upsertJob({ ...job('running', 0.4), id: 'job_cv', pid: 'conv_new' })
    expect(useStudio.getState().convertJob?.status).toBe('running')
    expect(useStudio.getState().jobs).toHaveLength(0)
    s.upsertJob({ ...job('done', 1), id: 'job_cv', pid: 'conv_new' })
    expect(useStudio.getState().convertJob?.status).toBe('done')
    // 未认领的外案帧依旧被守卫丢
    s.upsertJob({ ...job('queued'), id: 'other', pid: 'conv_new' })
    expect(useStudio.getState().convertJob?.id).toBe('job_cv')
    expect(useStudio.getState().jobs).toHaveLength(0)
    // 同 id 本案帧：convertJob + jobs 双写（convert→draft 既有行为）
    s.upsertJob({ ...job('running', 0.6), id: 'job_cv', pid: 'method' })
    expect(useStudio.getState().jobs).toHaveLength(1)
  })

  it('selectAiEnabled：settings 缺省 / 无 settings ⇒ false', () => {
    expect(selectAiEnabled({ settings: null })).toBe(false)
    expect(selectAiEnabled({ settings: {} })).toBe(false)
    expect(selectAiEnabled({ settings: { ai_enabled: true } })).toBe(true)
  })

  it('loadJobs：非 501 失败 toast（R74-01 同族——不静默吞成空列表）；501 → aiUnavailable', async () => {
    const spy = vi.spyOn(api, 'aiJobs').mockRejectedValue(new ApiError(500, 'db locked'))
    await useStudio.getState().loadJobs('method')
    expect(useStudio.getState().jobsLoading).toBe(false)
    expect(useStudio.getState().aiUnavailable).toBe(false)
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('任务列表加载失败')
    spy.mockRejectedValue(new ApiError(501, '尚未落地'))
    await useStudio.getState().loadJobs('method')
    expect(useStudio.getState().aiUnavailable).toBe(true)
  })
})
