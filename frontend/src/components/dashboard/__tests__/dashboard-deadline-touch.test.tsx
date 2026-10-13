// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { ProjectSummary } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { DASH_COMPACT_KEY, DASH_DEFAULT_COLUMNS, DASH_GROUP_COLLAPSED_KEY, UNGROUPED_KEY, groupCaseRows, readDashCompact, readDashGroupCollapsed, selectDashboardRows, selectTodayCounts, targetFilingDaysLeft, type CaseSummaryW7 } from '@/store/dashboard'
import { CaseBoard } from '../CaseBoard'
import { DashboardPage } from '../DashboardPage'
import { DeadlineCell, targetFilingLabel } from '../DeadlineCell'
import { OrgShell } from '../OrgShell'
import { sortValueOf, sortingOfValue } from '../TableToolbar'

/**
 * W7 dashboard-deadline-touch 单元回归（handoff §7c）：
 * ux-04 台账「目标递交 T-N」只读倒计时（后端 case.target_filing_days_left 直出，前端不算日期）；
 * qa-06 看板折叠列展开按钮 / 顶栏首页链接 375 命中区 ≥ 44（类名断言，真实尺寸靠浏览器探针）；
 * ux-05 表格工具行（分组 / 筛选 / 排序 / 紧凑）与今日摘要 chip 全部真实起作用、键盘可达。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

const row = (id: string, extra: Partial<ProjectSummary> = {}, c: Partial<CaseSummaryW7> = {}): ProjectSummary => ({
  id,
  title: `案 ${id}`,
  mtime: 1_700_000_000,
  collaborators: [],
  last_modified_by: null,
  my_role: 'owner',
  list_state: 'active',
  case: {
    version: 1,
    case_no: `P-${id}`,
    kind: 'invention',
    status: 'drafting',
    owner_user_id: 'u1',
    client: '客户甲',
    applicants: [],
    inventors: [],
    tags: [],
    dates: { opened: '2026-01-01', target_filing: null, filed: null, application_no: null },
    deadlines: [],
    archived: false,
    next_deadline: null,
    ...c,
  } as CaseSummaryW7,
  ...extra,
})

/** a：普通期限 + 目标递交 T-12；b：只有目标递交（逾期 T+3）；c：都没有；d：无 case */
const ROWS: ProjectSummary[] = [
  row('a', {}, { next_deadline: { kind: 'oa_reply', due: '2026-09-08', note: '', days_left: 2, level: 'red' }, target_filing_days_left: 12, dates: { opened: '2026-01-01', target_filing: '2026-09-18', filed: null, application_no: null } }),
  row('b', {}, { status: 'review', owner_user_id: 'u2', client: '客户乙', target_filing_days_left: -3, dates: { opened: '2026-01-01', target_filing: '2026-09-03', filed: null, application_no: null } }),
  row('c', {}, { status: 'client_review', client: '' }),
  row('d', { case: undefined }),
]

const visibleRows = (el: HTMLElement) => el.querySelectorAll('tbody tr[data-testid^="row-"]').length

beforeEach(() => {
  desktop = true
  localStorage.clear()
  useStudio.getState().resetDashboard()
  useStudio.setState({
    projects: [],
    authStatus: 'authed',
    user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: false },
    tags: [],
    dashColumns: { ...DASH_DEFAULT_COLUMNS },
    dashCompact: false,
    dashGroup: 'none',
    dashView: 'list',
    dashSorting: [],
    dashBoardExpanded: [],
    dashGroupCollapsed: {},
  })
  vi.spyOn(api, 'projects').mockResolvedValue(ROWS)
  vi.spyOn(api, 'tags').mockResolvedValue({ tags: [] })
  vi.spyOn(api, 'notifications').mockResolvedValue({ items: [], unread: 0, has_more: false })
})

describe('ux-04 目标递交 T-N（只读）', () => {
  it('targetFilingLabel：N ≥ 0 ⇒ T-N，N < 0 ⇒ T+N，null ⇒ 空；targetFilingDaysLeft 缺字段 / 无 case ⇒ null', () => {
    expect(targetFilingLabel(12)).toBe('目标递交 T-12')
    expect(targetFilingLabel(0)).toBe('目标递交 T-0')
    expect(targetFilingLabel(-3)).toBe('目标递交 T+3')
    expect(targetFilingLabel(null)).toBe('')
    expect(targetFilingLabel(undefined)).toBe('')
    expect(targetFilingDaysLeft(ROWS[0])).toBe(12)
    expect(targetFilingDaysLeft(ROWS[1])).toBe(-3)
    expect(targetFilingDaysLeft(ROWS[2])).toBeNull()
    expect(targetFilingDaysLeft(ROWS[3])).toBeNull()
  })

  it('DeadlineCell：普通期限 + 目标递交并列；只有目标递交也显示；两者都无显示 —', async () => {
    const el = await mount(
      <>
        <DeadlineCell d={{ kind: 'oa_reply', due: '2026-09-08', note: '', days_left: 2, level: 'red' }} targetDaysLeft={12} />
        <DeadlineCell d={null} targetDaysLeft={-3} />
        <DeadlineCell d={null} targetDaysLeft={null} />
      </>,
    )
    const cells = el.querySelectorAll('[data-testid="deadline-cell"]')
    expect(cells.length).toBe(2)
    expect(cells[0].querySelectorAll('[data-slot="heat"]').length).toBe(2)
    expect(cells[0].querySelector('[data-testid="target-filing-heat"]')?.textContent).toBe('目标递交 T-12')
    expect(cells[0].textContent).toContain('09-08 OA 答复')
    expect(cells[1].querySelectorAll('[data-slot="heat"]').length).toBe(1)
    expect(cells[1].querySelector('[data-testid="target-filing-heat"]')?.textContent).toBe('目标递交 T+3')
    expect(el.textContent).toContain('—')
  })

  it('1440 台账「最近期限」列：有 target_filing 的行显示 T-N，无的不显示；375 卡片同样', async () => {
    let el = await mount(<DashboardPage />)
    expect(visibleRows(el)).toBe(4)
    const heat = (pid: string) => el.querySelector(`[data-testid="row-${pid}"] [data-testid="target-filing-heat"]`)
    expect(heat('a')?.textContent).toBe('目标递交 T-12')
    expect(heat('b')?.textContent).toBe('目标递交 T+3')
    expect(heat('c')).toBeNull()
    expect(heat('d')).toBeNull()
    expect(el.querySelectorAll('[data-testid="target-filing-heat"]').length).toBe(2)

    await act(async () => root?.unmount())
    root = null
    host.remove()
    desktop = false
    el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-pid="a"] [data-testid="target-filing-heat"]')?.textContent).toBe('目标递交 T-12')
    expect(el.querySelector('[data-pid="c"] [data-testid="target-filing-heat"]')).toBeNull()
  })
})

describe('qa-06 375 命中区 ≥ 44（类名契约；真实尺寸由浏览器探针验证）', () => {
  it('看板折叠列展开按钮：<lg 宽 = --h-touch（max-lg:w-touch），min-h-touch 不变', async () => {
    useStudio.setState({ projects: ROWS })
    const el = await mount(<CaseBoard rows={ROWS} tags={[]} selected={[]} onToggleSelected={() => {}} onMove={() => {}} mobile />)
    const btn = el.querySelector('[data-testid="board-expand-filed"]')
    expect(btn, '空列「已递交」折叠').not.toBeNull()
    expect(btn!.className).toContain('max-lg:w-touch')
    expect(btn!.className).toContain('min-h-touch')
    expect(btn!.getAttribute('aria-expanded')).toBe('false')
    await click(btn)
    expect(el.querySelector('[data-testid="board-expand-filed"]')).toBeNull()
  })

  it('顶栏首页链接：整高 self-stretch + after: 伪元素外扩热区，仍是 a[href="#/"] 键盘可达', async () => {
    const el = await mount(
      <OrgShell name="t" title="t" current="cases" mobile={false}>
        <div />
      </OrgShell>,
    )
    const a = el.querySelector('[data-testid="org-home-link"]') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('#/')
    expect(a.className).toContain('self-stretch')
    expect(a.className).toMatch(/after:-inset-y/)
    expect(a.tabIndex).toBe(0)
  })
})

describe('ux-05 表格工具行 + 今日摘要 chip', () => {
  it('sortValueOf / sortingOfValue：Select 值 ⇄ TanStack sorting，同列保留升降，none 清空', () => {
    expect(sortValueOf([])).toBe('none')
    expect(sortValueOf([{ id: 'deadline', desc: true }])).toBe('deadline')
    expect(sortingOfValue('deadline', [])).toEqual([{ id: 'deadline', desc: false }])
    expect(sortingOfValue('deadline', [{ id: 'deadline', desc: true }])).toEqual([{ id: 'deadline', desc: true }])
    expect(sortingOfValue('title', [{ id: 'deadline', desc: true }])).toEqual([{ id: 'title', desc: false }])
    expect(sortingOfValue('none', [{ id: 'deadline', desc: true }])).toEqual([])
  })

  it('groupCaseRows：按状态按 STATUS 顺序；按客户空值归「未指定」排末；组内保持传入顺序', () => {
    const byStatus = groupCaseRows(ROWS, 'status')
    expect(byStatus.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ['drafting', ['a', 'd']],
      ['review', ['b']],
      ['client_review', ['c']],
    ])
    const byClient = groupCaseRows(ROWS, 'client')
    expect(byClient.map((g) => g.label)).toEqual(['客户甲', '客户乙', '未指定'])
    expect(byClient.at(-1)!.key).toBe(UNGROUPED_KEY)
    expect(byClient.at(-1)!.rows.map((r) => r.id)).toEqual(['c', 'd'])
    expect(groupCaseRows(ROWS, 'none')).toEqual([{ key: 'all', label: '全部', rows: ROWS }])
  })

  it('工具行只在列表视图；四个控件都是可聚焦控件（键盘可达）且有 aria-label', async () => {
    const el = await mount(<DashboardPage />)
    const bar = el.querySelector('[data-testid="table-toolbar"]')!
    expect(bar.getAttribute('role')).toBe('toolbar')
    for (const id of ['toolbar-group', 'toolbar-filter', 'toolbar-sort', 'toolbar-compact']) {
      const c = bar.querySelector(`[data-testid="${id}"]`) as HTMLElement
      expect(c, id).not.toBeNull()
      expect(c.tagName).toBe('BUTTON')
      expect(c.tabIndex).toBe(0)
      expect(c.getAttribute('aria-label')).toBeTruthy()
    }
    expect((bar.querySelector('[data-testid="toolbar-sort-dir"]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => useStudio.getState().setDashView('board'))
    expect(el.querySelector('[data-testid="table-toolbar"]')).toBeNull()
  })

  it('分组：store.dashGroup=status ⇒ 每状态一段 + 组头计数 = 组内行数（总行数不变）；组头可折叠', async () => {
    const el = await mount(<DashboardPage />)
    expect(visibleRows(el)).toBe(4)
    await act(async () => useStudio.getState().setDashGroup('status'))
    const table = el.querySelector('[data-testid="case-table"]')!
    expect(table.getAttribute('data-variant')).toBe('grouped')
    const groups = [...el.querySelectorAll('[data-testid^="case-group-toggle-"]')]
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual(['case-group-toggle-drafting', 'case-group-toggle-review', 'case-group-toggle-client_review'])
    expect(el.querySelector('[data-testid="case-group-count-drafting"]')?.textContent).toBe('2')
    expect(el.querySelectorAll('[data-testid="case-group-drafting"] tbody tr[data-testid^="row-"]').length).toBe(2)
    expect(visibleRows(el)).toBe(4)
    await click(groups[0])
    expect(groups[0].getAttribute('aria-expanded')).toBe('false')
    expect(visibleRows(el)).toBe(2)
    // 折叠偏好持久化（R115 批10b）：localStorage 记录 `status:drafting`；重读沿用
    expect(JSON.parse(localStorage.getItem(DASH_GROUP_COLLAPSED_KEY)!)).toEqual({ 'status:drafting': true })
    expect(readDashGroupCollapsed()).toEqual({ 'status:drafting': true })
    await act(async () => useStudio.getState().setDashGroup('none'))
    expect(el.querySelector('[data-testid="case-table"]')?.getAttribute('data-variant')).toBeNull()
    expect(visibleRows(el)).toBe(4)
  })

  it('筛选：工具行「筛选」打开状态勾选，勾「内审中」⇒ 与左栏同一 store.dashStatuses，行数 = 1，徽标 1；清除恢复', async () => {
    const el = await mount(<DashboardPage />)
    await click(el.querySelector('[data-testid="toolbar-filter"]'))
    const pop = document.querySelector('[data-testid="toolbar-filter-content"]')
    expect(pop, '筛选 Popover').not.toBeNull()
    await click(pop!.querySelector('[data-testid="status-filter-review"]'))
    expect(useStudio.getState().dashStatuses).toEqual(['review'])
    expect(visibleRows(el)).toBe(1)
    expect(el.querySelector('[data-testid="toolbar-filter"]')?.getAttribute('aria-label')).toContain('已选 1')
    await click(document.querySelector('[data-testid="toolbar-filter-clear"]'))
    expect(useStudio.getState().dashStatuses).toEqual([])
    expect(visibleRows(el)).toBe(4)
  })

  it('readDashGroupCollapsed：无值/坏值/非对象/非布尔项落回或过滤', () => {
    expect(readDashGroupCollapsed(null)).toEqual({})
    expect(readDashGroupCollapsed({ getItem: () => '{oops' })).toEqual({})
    expect(readDashGroupCollapsed({ getItem: () => '[1]' })).toEqual({})
    expect(readDashGroupCollapsed({ getItem: () => JSON.stringify({ 'status:drafting': true, x: 'no' }) })).toEqual({ 'status:drafting': true })
  })

  it('紧凑：Toggle ⇒ 表根 --row-h 切到 --row-h-compact 并持久化；重读 = 上次选择', async () => {
    const el = await mount(<DashboardPage />)
    const toggle = () => el.querySelector('[data-testid="toolbar-compact"]') as HTMLButtonElement
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(el.querySelector('[data-testid="case-table"]')?.className).not.toContain('--row-h-compact')
    await click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(useStudio.getState().dashCompact).toBe(true)
    expect(el.querySelector('[data-testid="case-table"]')?.className).toContain('[--row-h:var(--row-h-compact)]')
    expect(localStorage.getItem(DASH_COMPACT_KEY)).toBe('1')
    expect(readDashCompact()).toBe(true)
    expect(readDashCompact({ getItem: () => null })).toBe(false)
    await click(toggle())
    expect(useStudio.getState().dashCompact).toBe(false)
  })

  it('排序：sort-dir 按钮在有排序时可用且切换升降（与表头点击同一 sorting）', async () => {
    const el = await mount(<DashboardPage />)
    const order = () => [...el.querySelectorAll('tbody tr[data-testid^="row-"]')].map((tr) => tr.getAttribute('data-testid')!.slice(4))
    await click(el.querySelector('thead [data-testid="sort-title"]')!.closest('button'))
    const dir = () => el.querySelector('[data-testid="toolbar-sort-dir"]') as HTMLButtonElement
    expect(dir().disabled).toBe(false)
    const before = order()
    await click(dir())
    expect(order()).toEqual([...before].reverse())
  })

  it('今日摘要 chip：四张筛选 chip 都是 aria-pressed 按钮、点击 = 筛选且数字 = 行数；到期 chip 是去期限中心的链接', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue({
      items: [{ id: 'n1', kind: 'mention', pid: 'c', href: '#/p/c', actor: null, read: false, title: '', body: '', created_at: 1 }],
      unread: 1,
    has_more: false,
    })
    const el = await mount(<DashboardPage />)
    const counts = selectTodayCounts(useStudio.getState())
    expect(counts).toEqual({ mine: 2, review: 1, mention: 1, confirm: 1 })
    for (const f of ['mine', 'review', 'mention', 'confirm'] as const) {
      const chip = el.querySelector(`[data-testid="today-${f}"]`) as HTMLButtonElement
      expect(chip.tagName).toBe('BUTTON')
      expect(chip.tabIndex).toBe(0)
      await click(chip)
      expect(chip.getAttribute('aria-pressed')).toBe('true')
      expect(visibleRows(el)).toBe(counts[f])
      expect(selectDashboardRows(useStudio.getState()).length).toBe(counts[f])
      await click(el.querySelector(`[data-testid="today-${f}"]`))
      expect(useStudio.getState().dashFocus).toBeNull()
    }
    const due3 = el.querySelector('[data-testid="today-due3"]') as HTMLAnchorElement
    expect(due3.tagName).toBe('A')
    expect(due3.getAttribute('href')).toBe('#/deadlines')
    expect(el.querySelector('[data-testid="today-count-due3"]')?.textContent).toBe('1')
  })
})
