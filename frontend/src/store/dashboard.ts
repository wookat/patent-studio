import type { SortingState, VisibilityState } from '@tanstack/react-table'
import { api } from '@/lib/api'
import type { ProjectSummary } from '@/lib/types'
import type { BulkAction, CasePatch, CaseStatus, ListState, Tag } from '@/types/case'
import type { CaseFormValues } from '@/lib/caseForm'
import { CASE_STATUSES, STATUS_LABEL } from '@/types/case'
import type { Notification } from '@/types/notify'
import type { Slice, Studio } from './types'

/**
 * W4-A 案卷面板 slice（docs/plan/13-w4a-case-dashboard-design.md §4.1）。
 * 面板 UI 在 `components/dashboard/**`，后端在 `backend/app/routes/cases.py`。
 *
 * 数据源仍是 `project.projects`（GET /api/projects 已扩展 case / collaborators / my_role / list_state），
 * 本 slice 只放筛选 / 视图 / 多选 / 标签字典与写动作；写动作成功后就地更新 `projects` 行，不整表重拉；失败 toast 后端文案。
 */
export type DashScope = 'all' | 'mine' | 'shared' | 'archived' | 'trash'
export type DashView = 'list' | 'board'
/** 「我的今天」四张摘要 chip（21 §2 R-HOME-06 / 05 §3.12）：点 chip 即在当前 scope 之上再筛一层；再点取消；计数 = 行数 */
export type DashFocus = 'mine' | 'review' | 'mention' | 'confirm'
export const DASH_FOCUS_LABEL: Record<DashFocus, string> = { mine: '我负责', review: '待我审阅', mention: '@我', confirm: '待确认' }
export const DASH_FOCUSES: readonly DashFocus[] = ['mine', 'review', 'mention', 'confirm']

/** 台账分组（05 §4 S1 工具行「分组」）：不分 / 按状态 / 责任人 / 客户；分组行 32 可折叠，组内仍按当前排序 */
export type DashGroup = 'none' | 'status' | 'owner' | 'client'
export const DASH_GROUPS: readonly DashGroup[] = ['none', 'status', 'owner', 'client']
export const DASH_GROUP_LABEL: Record<DashGroup, string> = { none: '不分组', status: '按状态', owner: '按责任人', client: '按客户' }
/** 紧凑行高（40 → 36，05 §0.3-7）持久化键；只作用于台账表，不动全局 ui.density */
export const DASH_COMPACT_KEY = 'patent-studio.dash.compact'

export function readDashCompact(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    return storage?.getItem(DASH_COMPACT_KEY) === '1'
  } catch {
    return false
  }
}

/** 已并入 types/case CaseSummary.target_filing_days_left；别名保留给现有调用 */
export type CaseSummaryW7 = NonNullable<ProjectSummary['case']>

export function targetFilingDaysLeft(p: ProjectSummary): number | null {
  return p.case?.target_filing_days_left ?? null
}

/** 台账列显隐（R-HOME-10 列菜单）持久化键；值 = TanStack VisibilityState（只存被隐藏 / 显示过的列） */
export const DASH_COLUMNS_KEY = 'patent-studio.dash.columns'
export const DASH_DEFAULT_COLUMNS: VisibilityState = { application_no: false, filing_date: false, collab: false }

export function readDashColumns(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): VisibilityState {
  try {
    const raw = storage?.getItem(DASH_COLUMNS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...DASH_DEFAULT_COLUMNS, ...(parsed as VisibilityState) }
  } catch {
    /* 坏值当无 */
  }
  return { ...DASH_DEFAULT_COLUMNS }
}

/**
 * 台账「查看偏好」持久化（R115 批4）：视图方式 / 分组 / 排序 / 看板空列展开。
 * 与列显隐 / 紧凑行高同属呈现偏好；筛选、范围、多选、搜索词属数据范围，刻意不持久——
 * 刷新后回到「全部案卷」而非停在回收站 / 某个筛选里。
 */
export const DASH_VIEW_KEY = 'patent-studio.dash.view'
export const DASH_GROUP_KEY = 'patent-studio.dash.group'
export const DASH_SORT_KEY = 'patent-studio.dash.sort'
export const DASH_BOARD_EXPANDED_KEY = 'patent-studio.dash.board-expanded'

type StorageLike = Pick<Storage, 'getItem'> | null
const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

export function readDashView(storage: StorageLike = defaultStorage()): DashView {
  try {
    return storage?.getItem(DASH_VIEW_KEY) === 'board' ? 'board' : 'list'
  } catch {
    return 'list'
  }
}

export function readDashGroup(storage: StorageLike = defaultStorage()): DashGroup {
  try {
    const v = storage?.getItem(DASH_GROUP_KEY)
    return (DASH_GROUPS as readonly string[]).includes(v ?? '') ? (v as DashGroup) : 'none'
  } catch {
    return 'none'
  }
}

export function readDashSort(storage: StorageLike = defaultStorage()): SortingState {
  try {
    const parsed = storage?.getItem(DASH_SORT_KEY) ? (JSON.parse(storage!.getItem(DASH_SORT_KEY)!) as unknown) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is { id: string; desc: boolean } =>
        typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string' && typeof (x as { desc?: unknown }).desc === 'boolean',
    )
  } catch {
    return []
  }
}

export function readDashBoardExpanded(storage: StorageLike = defaultStorage()): CaseStatus[] {
  try {
    const parsed = storage?.getItem(DASH_BOARD_EXPANDED_KEY) ? (JSON.parse(storage!.getItem(DASH_BOARD_EXPANDED_KEY)!) as unknown) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is CaseStatus => (CASE_STATUSES as readonly string[]).includes(x as string))
  } catch {
    return []
  }
}

export const DASH_GROUP_COLLAPSED_KEY = 'patent-studio.dash.group-collapsed'

/** 分组视图折叠组集合（key 形如 `status:drafting`，随分组模式命名空间）；持久化查看偏好 */
export function readDashGroupCollapsed(storage: StorageLike = defaultStorage()): Record<string, boolean> {
  try {
    const raw = storage?.getItem(DASH_GROUP_COLLAPSED_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean'))
  } catch {
    return {}
  }
}
export interface DashboardSlice {
  dashScope: DashScope
  dashStatuses: CaseStatus[]
  dashTags: string[]
  dashQuery: string
  dashView: DashView
  /** 责任人筛选（user_id；auth=off 无候选） */
  dashOwners: string[]
  dashFocus: DashFocus | null
  dashColumns: VisibilityState
  dashGroup: DashGroup
  dashCompact: boolean
  /** 台账排序（TanStack SortingState）；持久化查看偏好 */
  dashSorting: SortingState
  /** 看板用户手动展开的空列；持久化查看偏好 */
  dashBoardExpanded: CaseStatus[]
  /** 分组列表用户折叠的组（key=`${dashGroup}:${组键}`）；持久化查看偏好 */
  dashGroupCollapsed: Record<string, boolean>
  /** 案件元数据表单（components/case-form）当前编辑的案卷；null = 关闭 */
  caseFormPid: string | null
  /** 打开时要聚焦的字段（递交页字段级错误 → 表单；后端 DeliverError.field，如 `applicants` / `dates.application_no`） */
  caseFormField: string | null
  /** 批74：表单草稿上提 store——对话框宿主（DashboardPage）随 hash 路由卸载时表单不丢。
     单槽 {key=pid, values}：同案重开恢复草稿，异案开表单自然换键；关闭/提交/放弃各路径显式清 */
  caseFormDraft: { key: string; values: CaseFormValues } | null
  /** 多选（pid） */
  dashSelected: string[]
  dashLoading: boolean
  /** 机构标签字典（GET /api/tags） */
  tags: Tag[]

  /** 进面板：loadProjects + tags（可重入；失败 toast） */
  loadDashboard(): Promise<void>
  setDashScope(scope: DashScope): void
  toggleDashStatus(status: CaseStatus): void
  toggleDashTag(tag: string): void
  setDashQuery(q: string): void
  setDashView(view: DashView): void
  toggleDashOwner(userId: string): void
  /** 同一卡再点 ⇒ 取消 */
  setDashFocus(focus: DashFocus | null): void
  setDashColumns(next: VisibilityState | ((prev: VisibilityState) => VisibilityState)): void
  setDashGroup(group: DashGroup): void
  setDashCompact(compact: boolean): void
  setDashSorting(next: SortingState | ((prev: SortingState) => SortingState)): void
  setDashBoardExpanded(next: CaseStatus[] | ((prev: CaseStatus[]) => CaseStatus[])): void
  setDashGroupCollapsed(key: string, collapsed: boolean): void
  /** 打开案件表单（field 可选：聚焦该字段）；pid=null 等价 closeCaseForm */
  openCaseForm(pid: string | null, field?: string): void
  closeCaseForm(): void
  /** 批74：写表单草稿（组件每次变更调用）；null 清除（关闭/提交/放弃） */
  setCaseFormDraft(draft: { key: string; values: CaseFormValues } | null): void
  clearDashFilters(): void
  toggleDashSelected(pid: string): void
  setDashSelected(pids: string[]): void

  /** POST /case/status：徽章行内改 / 看板拖卡；返回是否成功 */
  setCaseStatus(pid: string, status: CaseStatus, note?: string): Promise<boolean>
  /** PUT /case：责任人 / 标签 / 案号 / 客户 / 期限… */
  patchCase(pid: string, patch: CasePatch): Promise<boolean>
  /** GET /case：别处（客户确认 / MCP / 同事）改了 case.json 后重拉，刷新 project.case 与台账行 */
  refreshCase(pid: string): Promise<void>
  /** 归档 / 移入回收站 / 恢复（当前用户视角） */
  setListState(pid: string, state: ListState): Promise<boolean>
  /** 回收站 › 永久删除（owner） */
  deleteProject(pid: string): Promise<boolean>
  /** 共享给我 › 退出（非 owner） */
  leaveProject(pid: string): Promise<boolean>
  /** 多选批量；成功后清空多选 */
  bulk(action: BulkAction): Promise<boolean>
  loadTags(): Promise<void>
  saveTag(tag: Tag, prevName?: string): Promise<boolean>
  deleteTag(name: string): Promise<boolean>
  resetDashboard(): void
}

const INITIAL = {
  dashScope: 'all' as DashScope,
  dashStatuses: [] as CaseStatus[],
  dashTags: [] as string[],
  dashQuery: '',
  dashView: 'list' as DashView,
  dashOwners: [] as string[],
  dashFocus: null as DashFocus | null,
  dashGroup: 'none' as DashGroup,
  caseFormPid: null as string | null,
  caseFormDraft: null as { key: string; values: CaseFormValues } | null,
  caseFormField: null as string | null,
  dashSelected: [] as string[],
  dashLoading: false,
  tags: [] as Tag[],
}

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

export const dashboardSlice: Slice<DashboardSlice> = (set, get) => {
  const fail = (e: unknown): false => {
    get().toast((e as Error).message, 'error')
    return false
  }
  const patchRow = (pid: string, f: (row: ProjectSummary) => ProjectSummary) =>
    set({ projects: get().projects.map((p) => (p.id === pid ? f(p) : p)) })

  return {
    ...INITIAL,
    dashView: readDashView(),
    dashGroup: readDashGroup(),
    dashColumns: readDashColumns(),
    dashCompact: readDashCompact(),
    dashSorting: readDashSort(),
    dashBoardExpanded: readDashBoardExpanded(),
    dashGroupCollapsed: readDashGroupCollapsed(),

    loadDashboard: async () => {
      set({ dashLoading: true })
      try {
        await Promise.all([get().loadProjects(), get().loadTags()])
      } catch (e) {
        get().toast(`后端不可用：${(e as Error).message}`, 'error')
      } finally {
        set({ dashLoading: false })
      }
    },
    setDashScope: (dashScope) => set({ dashScope, dashSelected: [] }),
    toggleDashStatus: (s) => set({ dashStatuses: toggle(get().dashStatuses, s) }),
    toggleDashTag: (t) => set({ dashTags: toggle(get().dashTags, t) }),
    setDashQuery: (dashQuery) => set({ dashQuery }),
    setDashView: (dashView) => {
      set({ dashView, dashSelected: [] })
      try {
        localStorage.setItem(DASH_VIEW_KEY, dashView)
      } catch {
        /* 隐私模式等 */
      }
    },
    toggleDashOwner: (u) => set({ dashOwners: toggle(get().dashOwners, u) }),
    setDashFocus: (f) => set({ dashFocus: get().dashFocus === f ? null : f, dashSelected: [] }),
    openCaseForm: (pid, field) => set({ caseFormPid: pid, caseFormField: pid ? field ?? null : null }),
    closeCaseForm: () => set({ caseFormPid: null, caseFormField: null }),
    setCaseFormDraft: (draft) => set({ caseFormDraft: draft }),
    setDashColumns: (next) => {
      const dashColumns = typeof next === 'function' ? next(get().dashColumns) : next
      set({ dashColumns })
      try {
        localStorage.setItem(DASH_COLUMNS_KEY, JSON.stringify(dashColumns))
      } catch {
        /* 隐私模式等 */
      }
    },
    setDashGroup: (dashGroup) => {
      set({ dashGroup })
      try {
        localStorage.setItem(DASH_GROUP_KEY, dashGroup)
      } catch {
        /* 隐私模式等 */
      }
    },
    setDashSorting: (next) => {
      const dashSorting = typeof next === 'function' ? next(get().dashSorting) : next
      set({ dashSorting })
      try {
        localStorage.setItem(DASH_SORT_KEY, JSON.stringify(dashSorting))
      } catch {
        /* 隐私模式等 */
      }
    },
    setDashBoardExpanded: (next) => {
      const dashBoardExpanded = typeof next === 'function' ? next(get().dashBoardExpanded) : next
      set({ dashBoardExpanded })
      try {
        localStorage.setItem(DASH_BOARD_EXPANDED_KEY, JSON.stringify(dashBoardExpanded))
      } catch {
        /* 隐私模式等 */
      }
    },
    setDashGroupCollapsed: (key, collapsed) => {
      const dashGroupCollapsed = { ...get().dashGroupCollapsed, [key]: collapsed }
      set({ dashGroupCollapsed })
      try {
        localStorage.setItem(DASH_GROUP_COLLAPSED_KEY, JSON.stringify(dashGroupCollapsed))
      } catch {
        /* 隐私模式等 */
      }
    },
    setDashCompact: (dashCompact) => {
      set({ dashCompact })
      try {
        localStorage.setItem(DASH_COMPACT_KEY, dashCompact ? '1' : '0')
      } catch {
        /* 隐私模式等 */
      }
    },
    clearDashFilters: () => set({ dashStatuses: [], dashTags: [], dashOwners: [], dashFocus: null, dashQuery: '' }),
    toggleDashSelected: (pid) => set({ dashSelected: toggle(get().dashSelected, pid) }),
    setDashSelected: (dashSelected) => set({ dashSelected }),

    setCaseStatus: async (pid, status, note = '') => {
      try {
        const c = await api.setCaseStatus(pid, status, note)
        patchRow(pid, (p) => ({ ...p, case: p.case ? { ...p.case, ...c } : p.case }))
        if (get().project?.id === pid) set({ project: { ...get().project!, case: c } })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    patchCase: async (pid, patch) => {
      try {
        const c = await api.putCase(pid, patch)
        patchRow(pid, (p) => ({ ...p, case: p.case ? { ...p.case, ...c } : p.case }))
        if (get().project?.id === pid) set({ project: { ...get().project!, case: c } })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    refreshCase: async (pid) => {
      try {
        const c = await api.getCase(pid)
        patchRow(pid, (p) => ({ ...p, case: p.case ? { ...p.case, ...c } : p.case }))
        if (get().project?.id === pid) set({ project: { ...get().project!, case: c } })
      } catch (e) {
        fail(e)
      }
    },
    setListState: async (pid, state) => {
      try {
        const r = await api.setListState(pid, state)
        patchRow(pid, (p) => ({ ...p, list_state: r.list_state }))
        return true
      } catch (e) {
        return fail(e)
      }
    },
    deleteProject: async (pid) => {
      try {
        await api.deleteProject(pid)
        set({ projects: get().projects.filter((p) => p.id !== pid), dashSelected: get().dashSelected.filter((x) => x !== pid) })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    leaveProject: async (pid) => {
      try {
        await api.leaveProject(pid)
        set({ projects: get().projects.filter((p) => p.id !== pid), dashSelected: get().dashSelected.filter((x) => x !== pid) })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    bulk: async (action) => {
      try {
        const r = await api.bulk(action)
        const failed = r.results.filter((x) => !x.ok)
        if (failed.length) get().toast(`${failed.length} 个案卷未能更新：${failed.map((x) => x.pid).join('、')}`, 'error')
        await get().loadProjects()
        set({ dashSelected: [] })
        return failed.length === 0
      } catch (e) {
        return fail(e)
      }
    },
    loadTags: async () => {
      set({ tags: (await api.tags()).tags })
    },
    saveTag: async (tag, prevName) => {
      try {
        const r = prevName ? await api.updateTag(prevName, tag) : await api.createTag(tag)
        const renamed = prevName && prevName !== tag.name
        set({ tags: r.tags, dashTags: renamed ? get().dashTags.map((n) => (n === prevName ? tag.name : n)) : get().dashTags })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    deleteTag: async (name) => {
      try {
        await api.deleteTag(name)
        set({ tags: get().tags.filter((t) => t.name !== name), dashTags: get().dashTags.filter((n) => n !== name) })
        return true
      } catch (e) {
        return fail(e)
      }
    },
    resetDashboard: () =>
      set({
        ...INITIAL,
        tags: get().tags,
        dashColumns: get().dashColumns,
        dashCompact: get().dashCompact,
        dashView: get().dashView,
        dashGroup: get().dashGroup,
        dashSorting: get().dashSorting,
        dashBoardExpanded: get().dashBoardExpanded,
        dashGroupCollapsed: get().dashGroupCollapsed,
      }),
  }
}

export type RowsInput = Pick<Studio, 'projects' | 'user' | 'dashScope' | 'dashStatuses' | 'dashTags' | 'dashQuery'> & Partial<Pick<Studio, 'dashOwners' | 'dashFocus' | 'dashUnread'>>

/** 未读 @我 / 待确认通知涉及的 pid（api.notify 契约：kind mention / confirm，pid 可空） */
const pidsOf = (ns: Notification[], kind: Notification['kind']) => new Set(ns.filter((n) => n.kind === kind && !n.read && n.pid).map((n) => n.pid as string))

/**
 * 「我的今天」四卡的判定（与列表共用一份，计数 = 列表行数）：
 * 我负责 = owner 是我；待我审阅 = 内审中且我不是 owner（auth=off 时 = 内审中全部）；
 * @我 = 有未读 mention 通知指向该案；待确认 = 客户确认中，或有未读 confirm 通知指向该案。
 */
export function matchFocus(p: ProjectSummary, focus: DashFocus, me: string | null, ns: Notification[]): boolean {
  const status = p.case?.status ?? 'drafting'
  switch (focus) {
    case 'mine':
      return me === null || p.case?.owner_user_id === me
    case 'review':
      return status === 'review' && (me === null || p.case?.owner_user_id !== me)
    case 'mention':
      return pidsOf(ns, 'mention').has(p.id)
    case 'confirm':
      return status === 'client_review' || pidsOf(ns, 'confirm').has(p.id)
  }
}

/** 搜索框 `stage:<档>` 记号：值命中十档任一（枚举名 / 中文标签 / 前缀）即从搜索词剥离转状态过滤——三处状态筛选同一入口 */
const STAGE_TOKEN = /(?:^|\s)stage:([^\s]+)/gi
function parseStageTokens(q: string): { text: string; stages: CaseStatus[] } {
  const stages = new Set<CaseStatus>()
  const text = q.replace(STAGE_TOKEN, (_m, v: string) => {
    const low = v.toLowerCase()
    const hit = CASE_STATUSES.find((st) => st === low || STATUS_LABEL[st] === v || STATUS_LABEL[st].startsWith(v) || st.startsWith(low))
    if (hit) { stages.add(hit); return ' ' }
    return _m
  }).replace(/\s+/g, ' ').trim()
  return { text, stages: [...stages] }
}

/** 面板主区可见行：scope → list_state / 角色；状态 / 标签 / 责任人 / 今日卡 / 搜索（案名·案号·客户·申请人，大小写不敏感）叠加 */
export function selectDashboardRows(s: RowsInput): ProjectSummary[] {
  const parsed = parseStageTokens(s.dashQuery.trim().toLowerCase())
  const q = parsed.text
  const statusFilter = parsed.stages.length ? parsed.stages : s.dashStatuses
  const me = s.user?.id ?? null
  return s.projects.filter((p) => {
    const state: ListState = p.list_state ?? 'active'
    switch (s.dashScope) {
      case 'archived':
        if (state !== 'archived') return false
        break
      case 'trash':
        if (state !== 'trashed') return false
        break
      case 'mine':
        if (state !== 'active' || (me !== null && p.case?.owner_user_id !== me)) return false
        break
      case 'shared':
        if (state !== 'active' || me === null || p.case?.owner_user_id === me || p.my_role === 'owner') return false
        break
      default:
        if (state !== 'active') return false
    }
    if (statusFilter.length && !statusFilter.includes(p.case?.status ?? 'drafting')) return false
    if (s.dashTags.length && !s.dashTags.some((t) => p.case?.tags.includes(t))) return false
    if (s.dashOwners?.length && !s.dashOwners.includes(p.case?.owner_user_id ?? '')) return false
    if (s.dashFocus && !matchFocus(p, s.dashFocus, me, s.dashUnread ?? [])) return false
    if (q) {
      const hay = [p.title, p.id, p.case?.case_no, p.case?.client, ...(p.case?.applicants ?? [])].filter(Boolean).join('\n').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** 摘要 chip 计数：在「当前 scope + 其它筛选」之上分别套一张 chip 的结果行数，所以点 chip 后列表行数 = chip 上数字 */
export function selectTodayCounts(s: RowsInput): Record<DashFocus, number> {
  const out: Record<DashFocus, number> = { mine: 0, review: 0, mention: 0, confirm: 0 }
  for (const f of DASH_FOCUSES) out[f] = selectDashboardRows({ ...s, dashFocus: f }).length
  return out
}

export interface CaseRowGroup {
  key: string
  label: string
  /** group=status 时的状态（组头画 StatusDot 点 + 字） */
  status?: CaseStatus
  rows: ProjectSummary[]
}

const zhCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
/** 责任人 / 客户为空的行归入「未指定」组（排最后） */
export const UNGROUPED_KEY = '__none__'

/**
 * 台账分组（工具行「分组」）：保持传入行序（= 当前排序），按状态十档顺序 / 责任人名 / 客户名排组；
 * 无责任人 / 无客户归「未指定」排末。group=none ⇒ 单组（调用方不画组头）。
 */
export function groupCaseRows(rows: readonly ProjectSummary[], group: DashGroup, ownerName: (p: ProjectSummary) => string = (p) => p.case?.owner_user_id ?? ''): CaseRowGroup[] {
  if (group === 'none') return [{ key: 'all', label: '全部', rows: [...rows] }]
  const map = new Map<string, CaseRowGroup>()
  for (const p of rows) {
    let key: string
    let label: string
    let status: CaseStatus | undefined
    if (group === 'status') {
      status = p.case?.status ?? 'drafting'
      key = status
      label = STATUS_LABEL[status]
    } else {
      const v = group === 'owner' ? ownerName(p) : (p.case?.client ?? '')
      key = v || UNGROUPED_KEY
      label = v || '未指定'
    }
    const g = map.get(key)
    if (g) g.rows.push(p)
    else map.set(key, { key, label, status, rows: [p] })
  }
  const groups = [...map.values()]
  if (group === 'status') {
    const order = Object.keys(STATUS_LABEL)
    groups.sort((a, b) => order.indexOf(a.status!) - order.indexOf(b.status!))
  } else {
    groups.sort((a, b) => (a.key === UNGROUPED_KEY ? 1 : b.key === UNGROUPED_KEY ? -1 : zhCollator.compare(a.label, b.label)))
  }
  return groups
}

/** 状态十档在当前 scope（不含状态筛选自身）下的计数；筛选栏只显示 >0 的档 */
export function selectStatusCounts(s: RowsInput): Partial<Record<CaseStatus, number>> {
  const out: Partial<Record<CaseStatus, number>> = {}
  for (const p of selectDashboardRows({ ...s, dashStatuses: [] })) {
    const st = p.case?.status ?? 'drafting'
    out[st] = (out[st] ?? 0) + 1
  }
  return out
}

export interface OwnerOption {
  id: string
  name: string
  count: number
}

/** 责任人候选 = 当前 scope 下各案 owner（名字取协作者表），按案数降序 */
export function selectOwnerOptions(s: RowsInput): OwnerOption[] {
  const map = new Map<string, OwnerOption>()
  for (const p of selectDashboardRows({ ...s, dashOwners: [] })) {
    const id = p.case?.owner_user_id
    if (!id) continue
    const cur = map.get(id)
    if (cur) cur.count++
    else {
      const m = p.collaborators?.find((c) => c.user_id === id)
      map.set(id, { id, name: m?.display_name || m?.email || id, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
}

/** 「今日 / 本周到期」条：仅进行中案卷、未完成的下一期限，按剩余天数升序 */
export function selectDueRows(s: Pick<Studio, 'projects'>, withinDays = 7): ProjectSummary[] {
  return s.projects
    .filter((p) => (p.list_state ?? 'active') === 'active' && p.case?.next_deadline && p.case.next_deadline.days_left <= withinDays)
    .sort((a, b) => a.case!.next_deadline!.days_left - b.case!.next_deadline!.days_left)
}
