// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import * as csv from '@/lib/csv'
import { CSV_BOM } from '@/lib/csv'
import type { ProjectSummary } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { DASH_COLUMNS_KEY, DASH_DEFAULT_COLUMNS, readDashColumns, selectDashboardRows, selectTodayCounts } from '@/store/dashboard'
import { DashboardPage } from '../DashboardPage'

/**
 * W5 dashboard-frontend 单元必含用例（21 §7）：列显隐持久化、CSV 行数 = 表格行数（含期限列）、
 * 「我的今天」计数卡与点卡后列表一致、>200 行虚拟不影响 CSV、案件信息对话框可从行菜单打开。
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
  URL.createObjectURL ??= () => 'blob:x'
  URL.revokeObjectURL ??= () => {}
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

const row = (id: string, extra: Partial<ProjectSummary> = {}, c: Partial<NonNullable<ProjectSummary['case']>> = {}): ProjectSummary => ({
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
  },
  ...extra,
})

const ROWS: ProjectSummary[] = [
  row('a', {}, { next_deadline: { kind: 'target_filing', due: '2026-09-08', note: '', days_left: 2, level: 'red' } }),
  row('b', { my_role: 'editor' }, { status: 'review', owner_user_id: 'u2', client: '客户乙, 有逗号' }),
  row('c', {}, { status: 'client_review' }),
  row('d', { list_state: 'archived' }, { status: 'filed' }),
]

const visibleRows = (el: HTMLElement) => el.querySelectorAll('tbody tr[data-testid^="row-"]').length
const csvLines = (text: string) => text.replace(CSV_BOM, '').trimEnd().split('\r\n')

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
  })
  vi.spyOn(api, 'projects').mockResolvedValue(ROWS)
  vi.spyOn(api, 'tags').mockResolvedValue({ tags: [] })
})

describe('列显隐持久化（R-HOME-10）', () => {
  it('readDashColumns：无值 / 坏值 ⇒ 默认；有值与默认合并', () => {
    expect(readDashColumns(null)).toEqual(DASH_DEFAULT_COLUMNS)
    expect(readDashColumns({ getItem: () => '{oops' })).toEqual(DASH_DEFAULT_COLUMNS)
    expect(readDashColumns({ getItem: () => '[1]' })).toEqual(DASH_DEFAULT_COLUMNS)
    expect(readDashColumns({ getItem: () => JSON.stringify({ client: false }) })).toEqual({ ...DASH_DEFAULT_COLUMNS, client: false })
  })

  it('隐藏「客户」列 ⇒ 表头消失 + localStorage 写入；重读 store 初值 = 上次选择', async () => {
    const el = await mount(<DashboardPage />)
    const headers = () => [...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
    expect(headers()).toContain('客户')
    await act(async () => useStudio.getState().setDashColumns((v) => ({ ...v, client: false })))
    expect(headers()).not.toContain('客户')
    expect(JSON.parse(localStorage.getItem(DASH_COLUMNS_KEY)!)).toMatchObject({ client: false })
    expect(readDashColumns()).toMatchObject({ client: false, application_no: false })
    expect(el.querySelector('[data-testid="column-menu"]')?.getAttribute('aria-label')).toContain('已隐藏')
  })
})

describe('CSV 导出 = 屏幕所见', () => {
  it('行数 = 表格行数（含逗号转义），列 = 可见列且含「最近期限」；隐藏列不导出', async () => {
    const spy = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {})
    const el = await mount(<DashboardPage />)
    const clickExport = async () => {
      // R9：列表视图下导出入口在「列」菜单内
      await act(async () => (el.querySelector('[data-testid="column-menu"]') as HTMLElement).click())
      await act(async () => (el.querySelector('[data-testid="export-csv"]') as HTMLButtonElement).click())
    }
    expect(visibleRows(el)).toBe(3)
    await clickExport()
    expect(spy).toHaveBeenCalledTimes(1)
    const [name, text] = spy.mock.calls[0]
    expect(name).toMatch(/^案卷台账-\d{8}\.csv$/)
    expect(text.startsWith(CSV_BOM)).toBe(true)
    const lines = csvLines(text)
    expect(lines.length - 1).toBe(visibleRows(el))
    const header = lines[0].split(',')
    expect(header).toContain('最近期限')
    expect(header).toContain('客户')
    expect(header).not.toContain('申请号')
    expect(text).toContain('"客户乙, 有逗号"')

    await act(async () => useStudio.getState().setDashColumns((v) => ({ ...v, client: false, application_no: true })))
    await act(async () => useStudio.getState().setDashQuery('P-a'))
    expect(visibleRows(el)).toBe(1)
    await clickExport()
    const text2 = spy.mock.calls[1][1]
    const lines2 = csvLines(text2)
    expect(lines2.length - 1).toBe(1)
    expect(lines2[0].split(',')).not.toContain('客户')
    expect(lines2[0].split(',')).toContain('申请号')
    expect(lines2[1]).toContain('P-a')
  })

  it('>200 行虚拟：CSV 仍导出全部筛选行，而 DOM 只渲染一部分', async () => {
    const many = Array.from({ length: 260 }, (_, i) => row(`m${i}`))
    vi.spyOn(api, 'projects').mockResolvedValue(many)
    const spy = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {})
    const el = await mount(<DashboardPage />)
    expect(visibleRows(el)).toBeLessThan(260)
    // R9：先开「列」菜单再点导出
    await act(async () => (el.querySelector('[data-testid="column-menu"]') as HTMLElement).click())
    await act(async () => (el.querySelector('[data-testid="export-csv"]') as HTMLButtonElement).click())
    expect(csvLines(spy.mock.calls[0][1]).length - 1).toBe(260)
  })
})

describe('「我的今天」摘要条（R-HOME-06 / W6 §3.12）', () => {
  it('卡上数字 = 点卡后列表行数；再点取消恢复；selectTodayCounts 与 selectDashboardRows 一致', async () => {
    const el = await mount(<DashboardPage />)
    const s = useStudio.getState()
    const counts = selectTodayCounts(s)
    expect(counts).toEqual({ mine: 2, review: 1, mention: 0, confirm: 1 })
    for (const f of ['mine', 'review', 'confirm'] as const) {
      expect(el.querySelector(`[data-testid="today-count-${f}"]`)?.textContent).toBe(String(counts[f]))
      await act(async () => (el.querySelector(`[data-testid="today-${f}"]`) as HTMLButtonElement).click())
      expect(el.querySelector(`[data-testid="today-${f}"]`)?.getAttribute('aria-pressed')).toBe('true')
      expect(visibleRows(el)).toBe(counts[f])
      expect(selectDashboardRows(useStudio.getState()).length).toBe(counts[f])
      await act(async () => (el.querySelector(`[data-testid="today-${f}"]`) as HTMLButtonElement).click())
      expect(useStudio.getState().dashFocus).toBeNull()
    }
    expect(visibleRows(el)).toBe(3)
  })

  it('375：今日摘要条只渲染非零 pill（mention=0 不占位），点 pill 筛选卡片列表', async () => {
    desktop = false
    const el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-slot="TodayCards"]')).toBeNull()
    expect(el.querySelectorAll('[data-slot="TodaySummaryBar"] button').length).toBe(3)
    expect(el.querySelector('[data-testid="today-mention"]')).toBeNull()
    await act(async () => (el.querySelector('[data-testid="today-review"]') as HTMLButtonElement).click())
    expect(el.querySelectorAll('[data-pid]').length).toBe(1)
    expect(el.querySelector('[data-pid="b"]')).not.toBeNull()
  })
})

describe('案件信息对话框（R-CASE-02 入口）', () => {
  it('store.openCaseForm(pid) ⇒ Dialog 打开并预填案号；保存前无改动按钮禁用；取消关闭', async () => {
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().openCaseForm('a'))
    const dlg = document.querySelector('[data-testid="case-form-dialog"]')
    expect(dlg).not.toBeNull()
    expect((dlg!.querySelector('[data-testid="case-caseNo"]') as HTMLInputElement).value).toBe('P-a')
    expect((dlg!.querySelector('[data-testid="case-form-save"]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => (dlg!.querySelector('[data-testid="case-form-cancel"]') as HTMLButtonElement).click())
    expect(useStudio.getState().caseFormPid).toBeNull()
    expect(el.querySelector('[data-testid="dashboard"]')).not.toBeNull()
  })
})
