// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from '@/store'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 按调用序排队的 fetch：resolve[i] 兑现第 i 个发出的请求——用来构造「先发者后到」的乱序落地 */
const queuedFetch = () => {
  const pending: { url: string; resolve: (r: Response) => void }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = input instanceof Request ? input.url : String(input)
    return new Promise<Response>((res) => pending.push({ url, resolve: res }))
  })
  return pending
}

const COUNTS = (today: number) => ({ today, '7d': 0, '30d': 0, overdue: 0 })

afterEach(() => {
  vi.restoreAllMocks()
  useStudio.setState({
    pid: null,
    deadlines: [], deadlineTargets: [], deadlineCounts: COUNTS(0), deadlinesLoading: false,
    deadlinesFilter: { range: 'all', owner: null, client: null, kind: null }, deadlinesError: null,
    historyDiff: null,
  })
})

describe('R115-批23 参数化读链乱序闸：重叠请求只让最后发起者落地', () => {
  it('loadDeadlines：筛选 chips 连点，旧筛选响应后到不改写新列表', async () => {
    const pending = queuedFetch()
    const p1 = useStudio.getState().loadDeadlines({ kind: 'oa_office_action' })
    const p2 = useStudio.getState().loadDeadlines({ kind: null })
    pending[1].resolve(json({ items: [], counts: COUNTS(2), target_filings: [], holidays_missing: false }))
    await p2
    expect(useStudio.getState().deadlineCounts.today).toBe(2)
    expect(useStudio.getState().deadlinesLoading).toBe(false)
    pending[0].resolve(json({ items: [], counts: COUNTS(9), target_filings: [], holidays_missing: false }))
    await p1
    expect(useStudio.getState().deadlineCounts.today).toBe(2)   // 旧响应被丢
    expect(useStudio.getState().deadlinesFilter.kind).toBeNull() // 筛选意图仍以最后点击为准
  })



  it('loadDiff：快速换对比基，旧 diff 后不覆盖新 diff', async () => {
    const pending = queuedFetch()
    useStudio.setState({ pid: 'p1' })
    const p1 = useStudio.getState().loadDiff('p1', 'shaA')
    const p2 = useStudio.getState().loadDiff('p1', 'shaB')
    pending[1].resolve(json({ marker: 'B' }))
    await p2
    expect(useStudio.getState().historyDiff).toEqual({ marker: 'B' })
    pending[0].resolve(json({ marker: 'A' }))
    await p1
    expect(useStudio.getState().historyDiff).toEqual({ marker: 'B' })
  })
})
