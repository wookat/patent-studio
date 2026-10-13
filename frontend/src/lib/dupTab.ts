/**
 * 多页签同案检测（批74）：协同未连接时两个浏览器页签各自编辑同一案卷会经 PUT 互相覆盖——
 * 静默丢彼此的编辑。这里只做「另一页签也开着此案」的检测，由 UI 提示用户。
 * 协同连接时 Yjs 合并本就无冲突，调用方按 collabStatus 决定是否告警。
 *
 * 机制：BroadcastChannel `ps:case-tab:<pid>` 心跳认领——
 * 每页签带随机 tabId，每 HB_MS 广播一次；收其它 tabId 的心跳记入 seen，超过 STALE_MS 未见即清。
 * 页签关闭后其心跳自然停止，对端在 STALE_MS 内自行恢复（无需 leave 消息）。
 * 环境无 BroadcastChannel（老浏览器/jsdom）直接退化 no-op。
 */

const HB_MS = 5_000
const STALE_MS = 15_000

export const DUP_TAB_PREFIX = 'ps:case-tab:'

const TAB_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `t${Math.random().toString(36).slice(2)}`

type DupChannel = Pick<BroadcastChannel, 'postMessage' | 'close'> & {
  onmessage: ((ev: MessageEvent) => void) | null
}

/** 测试可注入假 channel；默认真 BroadcastChannel（环境无则 null → no-op） */
export function watchDupTab(
  pid: string | null,
  onChange: (dup: boolean) => void,
  channelFor: (name: string) => DupChannel | null = (name) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)),
): () => void {
  if (!pid) return () => {}
  const ch = channelFor(`${DUP_TAB_PREFIX}${pid}`)
  if (!ch) return () => {}
  const seen = new Map<string, number>()
  let dup = false
  const report = () => {
    const now = Date.now()
    for (const [id, ts] of seen) if (now - ts > STALE_MS) seen.delete(id)
    const next = seen.size > 0
    if (next !== dup) {
      dup = next
      onChange(dup)
    }
  }
  ch.onmessage = (ev: MessageEvent) => {
    const tab = (ev.data as { tab?: unknown })?.tab
    if (typeof tab === 'string' && tab !== TAB_ID) {
      seen.set(tab, Date.now())
      report()
    }
  }
  const beat = () => ch.postMessage({ tab: TAB_ID })
  beat()
  const timer = setInterval(() => {
    beat()
    report()
  }, HB_MS)
  return () => {
    clearInterval(timer)
    ch.onmessage = null
    ch.close()
    if (dup) onChange(false)
  }
}
