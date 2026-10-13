import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchDupTab } from '@/lib/dupTab'

/**
 * 批74 同案多页签心跳认领（lib/dupTab）：
 * 自心跳不误报 / 他签心跳置 dup / 他签停跳 > STALE_MS(15s) 自行恢复 / 关停补发 onChange(false) /
 * pid=null 与无 BroadcastChannel 环境一律 no-op。
 */

type FakeCh = {
  onmessage: ((ev: MessageEvent) => void) | null
  postMessage(d: unknown): void
  close(): void
}

function fakeCh() {
  const sent: unknown[] = []
  const ch: FakeCh = {
    onmessage: null,
    postMessage: (d) => sent.push(d),
    close: vi.fn(),
  }
  return { ch, sent }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('lib/dupTab watchDupTab', () => {
  it('pid=null 不建 channel（工厂不调用）；channelFor 回 null 一律 no-op', () => {
    const factory = vi.fn(() => fakeCh().ch)
    const stop = watchDupTab(null, () => {}, factory)
    expect(factory).not.toHaveBeenCalled()
    stop()
    const reports: boolean[] = []
    const stop2 = watchDupTab('p1', (d) => reports.push(d), () => null)
    expect(reports).toEqual([])
    stop2()
  })

  it('自心跳不误报、他签心跳置 dup、他签停跳 > STALE_MS 自动恢复', () => {
    vi.useFakeTimers()
    const { ch, sent } = fakeCh()
    const reports: boolean[] = []
    const stop = watchDupTab('p1', (d) => reports.push(d), () => ch)
    // 挂载即一拍自心跳
    expect(sent).toEqual([{ tab: expect.any(String) }])
    const ownTab = (sent[0] as { tab: string }).tab
    ch.onmessage?.({ data: { tab: ownTab } } as MessageEvent)
    ch.onmessage?.({ data: { noTab: true } } as MessageEvent)
    expect(reports).toEqual([])
    ch.onmessage?.({ data: { tab: 'other-tab' } } as MessageEvent)
    expect(reports).toEqual([true])
    // 他签又跳一拍 → 不再重复上报；然后停跳超过 STALE_MS → 心跳 tick 里清陈旧 → 恢复
    ch.onmessage?.({ data: { tab: 'other-tab' } } as MessageEvent)
    vi.advanceTimersByTime(21_000)
    expect(reports).toEqual([true, false])
    stop()
    expect(ch.close).toHaveBeenCalled()
  })

  it('关停时若仍 dup 补发 onChange(false)；从未 dup 则不补发', () => {
    const { ch } = fakeCh()
    const reports: boolean[] = []
    const stop = watchDupTab('p1', (d) => reports.push(d), () => ch)
    ch.onmessage?.({ data: { tab: 'other-tab' } } as MessageEvent)
    expect(reports).toEqual([true])
    stop()
    expect(reports).toEqual([true, false])
    const quiet: boolean[] = []
    const stop2 = watchDupTab('p1', (d) => quiet.push(d), () => fakeCh().ch)
    stop2()
    expect(quiet).toEqual([])
  })
})
