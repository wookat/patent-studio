// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { ProjectSummary } from '@/lib/types'
import { DESKTOP_QUERY, selectDashboardRows, selectDueRows, useStudio } from '@/store'
import { DashboardPage } from '../DashboardPage'
import { StatusDot } from '@/components/ui/status-dot'

/**
 * W4-A 面板冒烟（13 §9）：1440（FilterRail 竖栏 + 表格）与 375（scope chips + 卡片）都能渲染、
 * 空态 / 骨架 / 看板列齐全、筛选选择器语义正确、axe 无 serious/critical。
 * 拖卡 / 行内改状态的交互在 A2 落地后补；这里只保证占位插槽与 store 合约。
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
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function serious(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const today = new Date()
const iso = (d: number) => {
  const t = new Date(today)
  t.setDate(t.getDate() + d)
  return t.toISOString().slice(0, 10)
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
  row('a', {}, { status: 'drafting', next_deadline: { kind: 'target_filing', due: iso(2), note: '', days_left: 2, level: 'red' } }),
  row('b', { my_role: 'editor' }, { status: 'review', owner_user_id: 'u2', tags: ['急'] }),
  row('c', { list_state: 'archived' }, { status: 'filed' }),
  row('d', { list_state: 'trashed' }, { status: 'closed' }),
]

beforeEach(() => {
  desktop = true
  useStudio.getState().resetDashboard()
  useStudio.setState({
    projects: [],
    authStatus: 'authed',
    user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: false },
    tags: [{ name: '急', color: '#ef4444' }],
  })
  vi.spyOn(api, 'projects').mockResolvedValue(ROWS)
  vi.spyOn(api, 'tags').mockResolvedValue({ tags: [{ name: '急', color: '#ef4444' }] })
})

describe('selectDashboardRows / selectDueRows', () => {
  const base = { projects: ROWS, user: useStudio.getState().user, dashStatuses: [], dashTags: [], dashQuery: '' }
  it('scope：all 排除归档/回收站；mine 按 owner_user_id；shared 按非 owner；archived / trash 各取其一', () => {
    const ids = (dashScope: Parameters<typeof selectDashboardRows>[0]['dashScope'], q = '') =>
      selectDashboardRows({ ...base, user: { id: 'u1' } as never, dashScope, dashQuery: q }).map((r) => r.id)
    expect(ids('all')).toEqual(['a', 'b'])
    expect(ids('mine')).toEqual(['a'])
    expect(ids('shared')).toEqual(['b'])
    expect(ids('archived')).toEqual(['c'])
    expect(ids('trash')).toEqual(['d'])
    expect(ids('all', 'P-b')).toEqual(['b'])
    expect(ids('all', '客户甲')).toEqual(['a', 'b'])
  })
  it('状态 / 标签筛选取交集', () => {
    expect(selectDashboardRows({ ...base, dashScope: 'all', dashStatuses: ['review'] }).map((r) => r.id)).toEqual(['b'])
    expect(selectDashboardRows({ ...base, dashScope: 'all', dashTags: ['急'] }).map((r) => r.id)).toEqual(['b'])
    expect(selectDashboardRows({ ...base, dashScope: 'all', dashStatuses: ['review'], dashTags: ['无'] })).toEqual([])
  })
  it('到期条：7 天内且进行中', () => {
    expect(selectDueRows({ projects: ROWS }).map((r) => r.id)).toEqual(['a'])
  })
})

describe('DashboardPage 1440', () => {
  it('骨架 → 表格：8 列表头 + 竖向 FilterRail + 今日摘要条（无 DueBar / TodayCards）；axe 无 serious/critical', async () => {
    const el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-testid="dashboard"]')).not.toBeNull()
    expect(el.querySelector('[data-slot="FilterRail"][data-variant="chips"]')).toBeNull()
    expect(el.querySelector('[data-testid="scope-mine"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="scope-all"]')?.getAttribute('aria-current')).toBe('true')
    const table = el.querySelector('table')
    expect(table).not.toBeNull()
    expect(table!.querySelectorAll('thead th').length).toBeGreaterThanOrEqual(8)
    expect(el.querySelectorAll('tbody tr[data-testid^="row-"]').length).toBe(2)
    expect(el.querySelector('[data-slot="DueBar"]')).toBeNull()
    expect(el.querySelector('[data-slot="TodayCards"]')).toBeNull()
    expect(el.querySelector('[data-slot="TodaySummaryBar"]')).not.toBeNull()
    expect(el.querySelector('tbody [data-slot="status-dot"]')?.textContent).toBe('撰写')
    expect(el.querySelector('[data-testid="nav-cases"]')?.getAttribute('aria-current')).toBe('page')
    expect(el.querySelector('[data-testid="nav-deadlines"]')?.getAttribute('href')).toBe('#/deadlines')
    expect(el.querySelector('[data-testid="nav-inbox"]')?.getAttribute('href')).toBe('#/inbox')
    expect(await serious(el)).toEqual([])
  })

  it('scope 切换 → 回收站行 + 永久删除按钮只对 owner；空态文案随 scope', async () => {
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashScope('trash'))
    expect(el.querySelectorAll('tbody tr[data-testid^="row-"]').length).toBe(1)
    expect(el.querySelector('[data-testid="open-d"]')?.getAttribute('href')).toBe('#/p/d')
    await act(async () => useStudio.getState().setDashScope('shared'))
    await act(async () => useStudio.getState().setDashQuery('不存在'))
    expect(el.querySelector('[data-slot="DashboardEmpty"]')?.textContent).toContain('没有符合筛选条件')
    await act(async () => useStudio.getState().setDashQuery(''))
    await act(async () => useStudio.getState().setDashScope('archived'))
    await act(async () => useStudio.setState({ projects: ROWS.filter((r) => r.id !== 'c') }))
    expect(el.querySelector('[data-slot="DashboardEmpty"]')?.textContent).toContain('归档')
  })

  it('看板：十列按状态齐全（含空列），data-status 供 dnd-kit 落点', async () => {
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashView('board'))
    const cols = el.querySelectorAll('[data-slot="CaseBoard"] > [data-status]')
    expect(cols.length).toBe(10)
    expect(el.querySelector('[data-status="drafting"] [data-pid="a"]')).not.toBeNull()
    expect(el.querySelector('[data-status="review"] [data-pid="b"]')).not.toBeNull()
    expect(await serious(el)).toEqual([])
  })

  it('多选出现 BulkBar；清除后消失', async () => {
    const el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-slot="BulkBar"]')).toBeNull()
    await act(async () => useStudio.getState().toggleDashSelected('a'))
    expect(el.querySelector('[data-slot="BulkBar"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="bulk-archive"]')).not.toBeNull()
    await act(async () => (el.querySelector('[data-testid="bulk-clear"]') as HTMLButtonElement).click())
    expect(el.querySelector('[data-slot="BulkBar"]')).toBeNull()
  })

  it('空列表 → 空态 + 新建按钮', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue([])
    const el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-slot="DashboardEmpty"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="empty-create"]')).not.toBeNull()
  })
})

describe('DashboardPage 375', () => {
  beforeEach(() => {
    desktop = false
  })
  it('横向 scope chips + 卡片列表（无 table）；axe 无 serious/critical', async () => {
    const el = await mount(<DashboardPage />)
    expect(el.querySelector('[data-slot="FilterRail"][data-variant="chips"]')).not.toBeNull()
    expect(el.querySelector('table')).toBeNull()
    expect(el.querySelectorAll('[data-slot="CaseRow"]').length).toBe(2)
    expect(el.querySelector('[data-testid="open-a"]')?.getAttribute('href')).toBe('#/p/a')
    expect(await serious(el)).toEqual([])
  })
})

describe('StatusDot 状态呈现', () => {
  it('十档状态各有中文标签，点 + 文字并列', async () => {
    const el = await mount(
      <div>
        {(['intake', 'drafting', 'review', 'client_review', 'final', 'filed', 'oa', 'granted', 'rejected', 'closed'] as const).map((s) => (
          <StatusDot key={s} status={s} />
        ))}
      </div>,
    )
    const badges = [...el.querySelectorAll('[data-slot="status-dot"]')]
    expect(badges.every((b) => b.querySelector('[data-slot="status-dot-mark"]') && b.querySelector('[data-slot="status-dot-label"]')?.textContent)).toBe(true)
    expect(badges.map((b) => b.getAttribute('data-status'))).toEqual(['intake', 'drafting', 'review', 'client_review', 'final', 'filed', 'oa', 'granted', 'rejected', 'closed'])
    const labels = badges.map((b) => b.textContent)
    expect(labels).toHaveLength(10)
    expect(new Set(labels).size).toBe(10)
  })
})
