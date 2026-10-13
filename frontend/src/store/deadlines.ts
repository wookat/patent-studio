import { api, isNotImplemented } from '@/lib/api'
import type { DeadlineItem, DeadlineListResponse, DeadlineRange, TargetFilingItem } from '@/types/deadlines'
import type { Slice } from './types'

/**
 * W5 期限中心 `#/deadlines`（docs/plan/21 §4.2；dashboard-frontend 单元消费，deadlines-backend 单元填实）。
 * 后端唯一权威：due / status / days_left 由 GET /api/deadlines 算好；前端只分组显示。
 */
export interface DeadlinesFilter {
  range: DeadlineRange
  owner: string | null
  client: string | null
  kind: string | null
}

export type { TargetFilingItem }
/** 已并入 types/deadlines DeadlineListResponse.target_filings；别名保留给现有调用 */
export type DeadlineListResponseW7 = DeadlineListResponse

export interface DeadlinesSlice {
  deadlines: DeadlineItem[]
  /** 目标递交倒计时（按 target_filing 升序）；旧后端无此字段 ⇒ [] */
  deadlineTargets: TargetFilingItem[]
  deadlineCounts: DeadlineListResponse['counts']
  deadlinesHolidaysMissing: boolean
  deadlinesFilter: DeadlinesFilter
  deadlinesLoading: boolean
  deadlinesUnavailable: boolean
  deadlinesError: string | null

  loadDeadlines(filter?: Partial<DeadlinesFilter>): Promise<void>
  setDeadlinesFilter(patch: Partial<DeadlinesFilter>): void
  /** 标记完成 / 取消完成（写 case.json deadlines[].done） */
  setDeadlineDone(pid: string, deadlineId: string, done?: boolean): Promise<boolean>
  overrideDeadline(pid: string, deadlineId: string, due: string, reason: string): Promise<boolean>
  /** 催办：责任人通知 +1（走 notify） */
  nudgeDeadline(pid: string, deadlineId: string, message?: string): Promise<boolean>
  resetDeadlines(): void
}

const EMPTY_COUNTS: DeadlineListResponse['counts'] = { today: 0, '7d': 0, '30d': 0, overdue: 0 }
const DEFAULT_FILTER: DeadlinesFilter = { range: 'all', owner: null, client: null, kind: null }

/** loadDeadlines 在飞去重序号：参数不同的重叠请求只让最后发起者落地（筛选 chips 连点乱序闸，astSeq 同例） */
let deadlinesReqSeq = 0

/** 页面分组：后端 days_left / done 分桶（不算日期，只归类）；later = 30 天以后，done = 已完成 */
export type DeadlineGroup = 'overdue' | 'today' | '7d' | '30d' | 'later' | 'done'
export const DEADLINE_GROUPS: readonly DeadlineGroup[] = ['overdue', 'today', '7d', '30d', 'later', 'done']
export const DEADLINE_GROUP_LABEL: Record<DeadlineGroup, string> = {
  overdue: '逾期',
  today: '今日',
  '7d': '7 天内',
  '30d': '30 天内',
  later: '30 天以后',
  done: '已完成',
}

export const DEADLINE_GROUP_OPEN_KEY = 'patent-studio.deadlines.group-open'

/** 分组折叠偏好持久化读（台账 readDash* 同例）：坏 JSON / 非对象 / 未知键一律落回默认 */
export function readDeadlineGroupOpen<K extends string>(
  defaults: Record<K, boolean>,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): Record<K, boolean> {
  try {
    const raw = storage?.getItem(DEADLINE_GROUP_OPEN_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...defaults }
    const out = { ...defaults }
    for (const k of Object.keys(defaults) as K[]) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return { ...defaults }
  }
}

export function deadlineGroupOf(d: DeadlineItem): DeadlineGroup {
  if (d.done) return 'done'
  if (d.days_left < 0) return 'overdue'
  if (d.days_left === 0) return 'today'
  if (d.days_left <= 7) return '7d'
  if (d.days_left <= 30) return '30d'
  return 'later'
}

export function selectDeadlineGroups(s: Pick<DeadlinesSlice, 'deadlines'>): Record<DeadlineGroup, DeadlineItem[]> {
  const out: Record<DeadlineGroup, DeadlineItem[]> = { overdue: [], today: [], '7d': [], '30d': [], later: [], done: [] }
  for (const d of s.deadlines) out[deadlineGroupOf(d)].push(d)
  for (const g of DEADLINE_GROUPS) out[g].sort((a, b) => a.days_left - b.days_left || a.due.localeCompare(b.due))
  return out
}

export interface DeadlineFilterOptions {
  owners: { id: string; name: string }[]
  clients: string[]
  kinds: DeadlineItem['kind'][]
}

/** 筛选候选 = 当前返回项里出现过的责任人 / 客户 / 类型 */
export function selectDeadlineFilterOptions(s: Pick<DeadlinesSlice, 'deadlines'>): DeadlineFilterOptions {
  const owners = new Map<string, string>()
  const clients = new Set<string>()
  const kinds = new Set<DeadlineItem['kind']>()
  for (const d of s.deadlines) {
    if (d.owner) owners.set(d.owner.id, d.owner.display_name)
    if (d.client) clients.add(d.client)
    kinds.add(d.kind)
  }
  return {
    owners: [...owners].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    clients: [...clients].sort((a, b) => a.localeCompare(b, 'zh')),
    kinds: [...kinds],
  }
}

export const deadlinesSlice: Slice<DeadlinesSlice> = (set, get) => {
  const replace = (item: DeadlineItem) => set((s) => ({ deadlines: s.deadlines.map((d) => (d.id === item.id ? item : d)) }))
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (isNotImplemented(e)) set({ deadlinesUnavailable: true, deadlinesError: msg })
    else get().toast(msg, 'error')
    return false
  }

  return {
    deadlines: [],
    deadlineTargets: [],
    deadlineCounts: EMPTY_COUNTS,
    deadlinesHolidaysMissing: false,
    deadlinesFilter: DEFAULT_FILTER,
    deadlinesLoading: false,
    deadlinesUnavailable: false,
    deadlinesError: null,

    loadDeadlines: async (patch) => {
      const filter = { ...get().deadlinesFilter, ...patch }
      const seq = ++deadlinesReqSeq
      set({ deadlinesFilter: filter, deadlinesLoading: true, deadlinesError: null })
      try {
        const r: DeadlineListResponseW7 = await api.deadlines({ range: filter.range, owner: filter.owner ?? undefined, client: filter.client ?? undefined, kind: filter.kind ?? undefined })
        if (seq !== deadlinesReqSeq) return
        set({ deadlines: r.items, deadlineTargets: r.target_filings ?? [], deadlineCounts: r.counts, deadlinesHolidaysMissing: r.holidays_missing, deadlinesUnavailable: false, deadlinesLoading: false })
      } catch (e) {
        if (seq !== deadlinesReqSeq) return
        const msg = e instanceof Error ? e.message : String(e)
        set({ deadlinesError: msg, deadlinesUnavailable: isNotImplemented(e), deadlinesLoading: false })
      }
    },

    setDeadlinesFilter: (patch) => set((s) => ({ deadlinesFilter: { ...s.deadlinesFilter, ...patch } })),

    setDeadlineDone: async (pid, deadlineId, done = true) => {
      try {
        replace(await api.doneDeadline(pid, deadlineId, done))
        return true
      } catch (e) {
        return fail(e)
      }
    },

    overrideDeadline: async (pid, deadlineId, due, reason) => {
      try {
        replace(await api.overrideDeadline(pid, deadlineId, { due, override_reason: reason }))
        return true
      } catch (e) {
        return fail(e)
      }
    },

    nudgeDeadline: async (pid, deadlineId, message) => {
      try {
        const r = await api.nudge(pid, { deadline_id: deadlineId, message })
        get().toast(r.notified > 0 ? `已催办 ${r.notified} 人` : '无可通知的责任人', r.notified > 0 ? 'success' : 'info')
        return true
      } catch (e) {
        return fail(e)
      }
    },

    resetDeadlines: () =>
      set({ deadlines: [], deadlineTargets: [], deadlineCounts: EMPTY_COUNTS, deadlinesHolidaysMissing: false, deadlinesFilter: DEFAULT_FILTER, deadlinesLoading: false, deadlinesUnavailable: false, deadlinesError: null }),
  }
}
