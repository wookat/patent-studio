// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { ProjectSummary } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import type { NextDeadline } from '@/types/case'
import { resolveDrop } from '../CaseBoard'
import { AvatarStack, RelatedBadge, RowActions } from '../CaseRow'
import { DeadlineCell } from '../DeadlineCell'
import { sortCaseRows } from '../caseColumns'
import { DashboardPage } from '../DashboardPage'

/**
 * A2-dashboard-ui：排序 / 倒计时 / 批量选择 / 拖放解析 的纯逻辑，加 1440 表格排序、375 筛选 Sheet + 贴底 BulkBar、
 * 权限只读、标签管理入口 的 DOM 合约与 axe 冒烟。dnd-kit 的指针 / 键盘传感器依赖真实布局，浏览器走查由编排者统一做。
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
  // Radix 菜单 / Sheet 在 jsdom 需要这些
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
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

const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}
const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel)
const ids = (rows: ProjectSummary[]) => rows.map((r) => r.id)
const order = (el: ParentNode) => [...el.querySelectorAll('tbody tr[data-testid^="row-"]')].map((tr) => tr.getAttribute('data-testid')!.slice(4))
const checked = (el: Element | null) => el?.getAttribute('aria-checked')

const dl = (days_left: number, level: NextDeadline['level']): NextDeadline => ({ kind: 'target_filing', due: '2026-09-10', note: '', days_left, level })
const row = (id: string, extra: Partial<ProjectSummary> = {}, c: Partial<NonNullable<ProjectSummary['case']>> = {}): ProjectSummary => ({
  id,
  title: `案 ${id}`,
  mtime: 1_700_000_000,
  collaborators: [
    { user_id: 'u1', email: 'a@x', display_name: 'A', role: 'owner', online: false, last_seen: '2026-09-01T00:00:00+00:00' },
    { user_id: 'u2', email: 'b@x', display_name: 'B', role: 'agent', online: true, last_seen: null },
  ],
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

/** a：owner、期限 2 天（红）；b：editor（只读）、无期限、标签 急、最新修改；c：agent、期限 10 天（黄）、无案号 */
const ROWS: ProjectSummary[] = [
  row('a', { title: '乙案', mtime: 100 }, { status: 'drafting', next_deadline: dl(2, 'red') }),
  row('b', { title: '甲案', mtime: 300, my_role: 'editor' }, { status: 'review', owner_user_id: 'u2', tags: ['急'] }),
  row('c', { title: '丙案', mtime: 200, my_role: 'agent' }, { status: 'intake', case_no: '', owner_user_id: null, next_deadline: dl(10, 'yellow') }),
]

beforeEach(() => {
  desktop = true
  useStudio.getState().resetDashboard()
  useStudio.setState({
    projects: [],
    authStatus: 'authed',
    user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: false },
    tags: [{ name: '急', color: '#ef4444' }],
    dashView: 'list',
    dashGroup: 'none',
    dashSorting: [],
    dashBoardExpanded: [],
  })
  vi.spyOn(api, 'projects').mockResolvedValue(ROWS)
  vi.spyOn(api, 'tags').mockResolvedValue({ tags: [{ name: '急', color: '#ef4444' }] })
})

describe('sortCaseRows（CSV 复现屏幕顺序，与 DataTable 同键）', () => {
  it('案名按中文排序，升降可逆；无排序保持服务端顺序', () => {
    expect(ids(sortCaseRows(ROWS, []))).toEqual(['a', 'b', 'c'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'title', desc: false }]))).toEqual(['c', 'b', 'a'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'title', desc: true }]))).toEqual(['a', 'b', 'c'])
  })
  it('期限：天数少的在前，无期限无论升降都排末尾', () => {
    expect(ids(sortCaseRows(ROWS, [{ id: 'deadline', desc: false }]))).toEqual(['a', 'c', 'b'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'deadline', desc: true }]))).toEqual(['c', 'a', 'b'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'case_no', desc: true }]))).toEqual(['b', 'a', 'c'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'owner', desc: false }]))).toEqual(['a', 'b', 'c'])
  })
  it('状态按十档状态机顺序；最近修改降序 = 最新在前', () => {
    expect(ids(sortCaseRows(ROWS, [{ id: 'status', desc: false }]))).toEqual(['c', 'a', 'b'])
    expect(ids(sortCaseRows(ROWS, [{ id: 'modified', desc: true }]))).toEqual(['b', 'c', 'a'])
  })
})

describe('resolveDrop', () => {
  it('落到别的状态列 ⇒ {pid,status}；同列 / 非状态 / 未知卡 ⇒ null', () => {
    expect(resolveDrop(ROWS, 'a', 'review')).toEqual({ pid: 'a', status: 'review' })
    expect(resolveDrop(ROWS, 'a', 'drafting')).toBeNull()
    expect(resolveDrop(ROWS, 'a', undefined)).toBeNull()
    expect(resolveDrop(ROWS, 'a', 'nope')).toBeNull()
    expect(resolveDrop(ROWS, 'zzz', 'review')).toBeNull()
    expect(resolveDrop(ROWS, 42, 'review')).toBeNull()
  })
})

describe('DeadlineCell（W6 Heat 7d / 30d 分桶）', () => {
  it('倒计时文案与 data-heat：逾期 / 今天 / ≤7 / ≤30 / >30 / 无期限 —', async () => {
    const el = await mount(
      <div>
        <DeadlineCell d={dl(-3, 'overdue')} />
        <DeadlineCell d={dl(0, 'red')} />
        <DeadlineCell d={dl(2, 'red')} />
        <DeadlineCell d={dl(10, 'yellow')} />
        <DeadlineCell d={dl(40, 'normal')} />
        <DeadlineCell d={null} />
      </div>,
    )
    const heats = [...el.querySelectorAll('[data-slot="DeadlineCell"] [data-slot="heat"]')]
    expect(heats.map((c) => c.getAttribute('data-heat'))).toEqual(['2', '2', '2', '1', '0'])
    expect(heats.map((c) => c.textContent)).toEqual(['逾期 3 天', '今天', '剩 2 天', '剩 10 天', '剩 40 天'])
    expect(el.textContent).toContain('—')
  })
})

describe('AvatarStack（W4 集成：B 的访问 / 在线数据）', () => {
  it('在线者排前带绿点，aria-label 报在线人数；离线者 title 带最近访问 / 未打开过', async () => {
    const el = await mount(
      <AvatarStack
        people={[
          { user_id: 'u1', email: 'a@x', display_name: 'A', role: 'owner', online: false, last_seen: '2026-09-01T00:00:00+00:00' },
          { user_id: 'u2', email: 'b@x', display_name: 'B', role: 'agent', online: true, last_seen: null },
          { user_id: 'u3', email: 'c@x', display_name: 'C', role: 'viewer', online: false, last_seen: null },
        ]}
      />,
    )
    const stack = el.querySelector('[role="img"]')!
    expect(stack.getAttribute('aria-label')).toBe('协作者：B、A、C，1 人在线')
    expect(stack.getAttribute('data-online')).toBe('1')
    const avatars = [...stack.querySelectorAll(':scope > span')]
    expect(avatars[0].getAttribute('data-online')).toBe('true')
    expect(avatars[0].getAttribute('title')).toBe('B · agent · 在线')
    expect(avatars[0].querySelector('.bg-ok-dot')).not.toBeNull()
    expect(avatars[1].getAttribute('title')).toMatch(/^A · owner · 最近访问 /)
    expect(avatars[1].querySelector('.bg-ok-dot')).toBeNull()
    expect(avatars[2].getAttribute('title')).toBe('C · viewer · 未打开过')
  })
})

describe('RelatedBadge（W19 批8 案间关联徽标）', () => {
  it('无关联不渲染；有关联显示 GitBranch + 总数，title 列各案', async () => {
    const el = await mount(
      <div>
        <RelatedBadge related={[]} />
        <RelatedBadge
          related={[
            { pid: 'p2', kind: 'divisional', note: '' },
            { pid: 'p9', kind: 'associated', note: '同族' },
          ]}
        />
      </div>,
    )
    const badges = el.querySelectorAll('[aria-label^="关联案卷："]')
    expect(badges).toHaveLength(1)
    const b = badges[0] as HTMLElement
    expect(b.getAttribute('aria-label')).toBe('关联案卷：分案 p2、关联案 p9（同族）')
    expect(b.textContent).toContain('2')
  })
})

describe('1440 表格', () => {
  it('点列头排序：aria-sort 升 → 降 → 无；行顺序随之变', async () => {
    const el = await mount(<DashboardPage />)
    const th = () => q('th:has([data-testid="sort-title"])', el)!
    expect(th().getAttribute('aria-sort')).toBeNull()
    expect(order(el)).toEqual(['a', 'b', 'c'])
    await click(q('[data-testid="sort-title"]', el))
    expect(th().getAttribute('aria-sort')).toBe('ascending')
    expect(order(el)).toEqual(['c', 'b', 'a'])
    await click(q('[data-testid="sort-title"]', el))
    expect(th().getAttribute('aria-sort')).toBe('descending')
    expect(order(el)).toEqual(['a', 'b', 'c'])
    await click(q('[data-testid="sort-title"]', el))
    expect(th().getAttribute('aria-sort')).toBeNull()
    await click(q('[data-testid="sort-deadline"]', el))
    expect(order(el)).toEqual(['a', 'c', 'b'])
    expect(q('th:has([data-testid="sort-deadline"])', el)?.getAttribute('aria-sort')).toBe('ascending')
    await click(q('[data-testid="sort-modified"]', el))
    expect(q('th:has([data-testid="sort-modified"])', el)?.getAttribute('aria-sort')).toBe('descending')
    expect(order(el)).toEqual(['b', 'c', 'a'])
    expect(await serious(el)).toEqual([])
  })

  it('R115 批6：进案卷再回来，列表滚动位置复原（list 真滚动器 = CaseTable 内层）', async () => {
    const el = await mount(<DashboardPage />)
    const scroller = q('[data-slot="CaseTable"]', el)!
    expect(scroller).not.toBeNull()
    scroller.scrollTop = 240
    await act(async () => root?.unmount())
    root = null
    const el2 = await mount(<DashboardPage />)
    expect(q('[data-slot="CaseTable"]', el2)!.scrollTop).toBe(240)
  })

  it('批量选择：全选 / 反选 / 单选同步；BulkBar 出现责任人（auth=on）', async () => {
    const el = await mount(<DashboardPage />)
    // b 行 my_role='editor'（无案卷管理权，与后端 bulk check_access 'agent' 同口径）——无勾选格且全选跳过
    expect(q('[data-testid="select-b"]', el)).toBeNull()
    await click(q('[data-testid="select-all"]', el))
    expect(useStudio.getState().dashSelected.sort()).toEqual(['a', 'c'])
    expect(checked(q('[data-testid="select-all"]', el))).toBe('true')
    expect(q('[data-slot="BulkBar"]')?.getAttribute('aria-label')).toBe('已选 2 个案卷')
    expect(q('[data-testid="bulk-owner"]', el)).not.toBeNull()
    await click(q('[data-testid="select-c"]', el))
    expect(useStudio.getState().dashSelected).toEqual(['a'])
    expect(checked(q('[data-testid="select-all"]', el))).toBe('mixed')
    await click(q('[data-testid="select-all"]', el))
    expect(useStudio.getState().dashSelected.sort()).toEqual(['a', 'c'])
    await click(q('[data-testid="select-all"]', el))
    expect(useStudio.getState().dashSelected).toEqual([])
    expect(q('[data-slot="BulkBar"]', el)).toBeNull()
  })

  it('批量责任人菜单：候选 = 所选协作者并集，选人走 bulk(owner)', async () => {
    const bulk = vi.spyOn(api, 'bulk').mockResolvedValue({ results: [] })
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashSelected(['a', 'c']))
    const trigger = q('[data-testid="bulk-owner"]', el)!
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    })
    expect(q('[data-testid="bulk-owner-u2"]')).not.toBeNull()
    expect(q('[data-testid="bulk-owner-u1"]')?.getAttribute('aria-checked')).toBe('false')
    await click(q('[data-testid="bulk-owner-u2"]'))
    expect(bulk).toHaveBeenCalledWith({ action: 'owner', pids: ['a', 'c'], owner_user_id: 'u2' })
  })

  it('权限：owner/agent 行有状态下拉 + 责任人下拉；editor 行只读徽章 + 纯文本', async () => {
    const el = await mount(<DashboardPage />)
    expect(q('[data-testid="row-a"] [data-slot="StatusPicker"]', el)).not.toBeNull()
    expect(q('[data-testid="row-c"] [data-slot="StatusPicker"]', el)).not.toBeNull()
    expect(q('[data-testid="row-b"] [data-slot="StatusPicker"]', el)).toBeNull()
    const badge = q('[data-testid="row-b"] [data-slot="status-dot"]', el)
    expect(badge?.textContent).toBe('内审')
    expect(badge?.getAttribute('data-status')).toBe('review')
    expect(q('[data-testid="owner-a"]', el)?.textContent).toContain('A')
    expect(q('[data-testid="owner-b"]', el)).toBeNull()
    expect(q('[data-testid="row-b"] td:nth-child(6)', el)?.textContent).toContain('B')
    expect(q('[data-testid="row-b"] td:nth-child(6) [data-slot="avatar"]', el)).not.toBeNull()
    expect(q('[data-testid="owner-c"]', el)?.textContent).toContain('未指派')
  })

  it('行内改责任人：候选 = 行内 collaborators（不另请求 members），选人 ⇒ patchCase', async () => {
    const members = vi.spyOn(api, 'members')
    const put = vi.spyOn(api, 'putCase').mockImplementation(async (_pid, patch) => ({ ...ROWS[0].case!, ...patch }) as never)
    const el = await mount(<DashboardPage />)
    const trigger = q('[data-testid="owner-a"]', el)!
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    })
    expect(members).not.toHaveBeenCalled()
    const items = [...document.querySelectorAll('[role="menu"] [role="menuitemradio"]')]
    expect(items.map((i) => i.textContent)).toEqual(['Aowner', 'Bagent'])
    await click(items[1])
    expect(put).toHaveBeenCalledWith('a', { owner_user_id: 'u2' })
    expect(useStudio.getState().projects.find((p) => p.id === 'a')?.case?.owner_user_id).toBe('u2')
  })

  it('auth=off：无责任人列内容、无「我负责 / 共享给我」、有「管理标签」', async () => {
    useStudio.setState({ authStatus: 'off', user: null })
    const el = await mount(<DashboardPage />)
    expect(q('[data-testid="scope-mine"]', el)).toBeNull()
    expect(q('[data-testid="owner-a"]', el)).toBeNull()
    expect(q('[data-testid="row-a"] td:nth-child(6)', el)?.textContent).toBe('—')
    expect(q('[data-testid="today-summary"]', el)).not.toBeNull()
    expect(q('[data-testid="manage-tags"]', el)).not.toBeNull()
    await act(async () => useStudio.getState().toggleDashSelected('a'))
    expect(q('[data-testid="bulk-owner"]', el)).toBeNull()
  })

  it('W12 R8-01：未读通知只在 authed 时拉——off 不发 GET /api/notify；unknown → authed 才发一次', async () => {
    const notif = vi.spyOn(api, 'notifications').mockResolvedValue({ items: [], unread: 0, has_more: false })
    useStudio.setState({ authStatus: 'off', user: null })
    await mount(<DashboardPage />)
    expect(notif).not.toHaveBeenCalled()
    await act(async () => root?.unmount())
    root = null
    host.remove()

    useStudio.setState({ authStatus: 'unknown', user: null })
    await mount(<DashboardPage />)
    expect(notif).not.toHaveBeenCalled()
    await act(async () => useStudio.setState({ authStatus: 'authed', user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: false } }))
    // authed 后两路各一次：顶栏铃铛起轮询（默认参数）+ 首页未读加载（unread 200）
    expect(notif).toHaveBeenCalledTimes(2)
    expect(notif.mock.calls.filter((c) => c[0]?.unread === true && c[0]?.limit === 200)).toHaveLength(1)
  })

  it('标签管理：非超管无入口；超管可新建（saveTag → api.createTag）与删除（二次确认）', async () => {
    const el0 = await mount(<DashboardPage />)
    expect(q('[data-testid="manage-tags"]', el0)).toBeNull()
    await act(async () => root?.unmount())
    root = null
    host.remove()

    useStudio.setState({ user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: true } })
    const create = vi.spyOn(api, 'createTag').mockResolvedValue({ tags: [{ name: '急', color: '#ef4444' }, { name: '涉外', color: '#3b82f6' }] })
    const del = vi.spyOn(api, 'deleteTag').mockResolvedValue(undefined)
    const el = await mount(<DashboardPage />)
    await click(q('[data-testid="manage-tags"]', el))
    expect(q('[data-slot="TagManagerDialog"]')).not.toBeNull()
    await click(q('[data-testid="tag-new"]'))
    const input = q<HTMLInputElement>('[data-testid="tag-name"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '涉外')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="tag-save"]'))
    expect(create).toHaveBeenCalledWith({ name: '涉外', color: expect.stringMatching(/^#/) })
    expect(useStudio.getState().tags.map((t) => t.name)).toEqual(['急', '涉外'])
    expect(q('[data-testid="tag-filter-涉外"]', el)).not.toBeNull()
    await click(q('[data-testid="tag-delete-急"]'))
    expect(del).not.toHaveBeenCalled()
    await click(q('[data-testid="tag-delete-confirm-急"]'))
    expect(del).toHaveBeenCalledWith('急')
    expect(useStudio.getState().tags.map((t) => t.name)).toEqual(['涉外'])
    expect(await serious(document.body)).toEqual([])
  })

  it('筛选：状态 + 标签叠加，「清除筛选」一键复位', async () => {
    const el = await mount(<DashboardPage />)
    // 十档只显计数 > 0：ROWS 只有 drafting / review / intake
    expect([...el.querySelectorAll('[data-testid^="status-filter-"]')].length).toBe(3)
    expect(q('[data-testid="status-count-review"]', el)?.textContent).toBe('1')
    await click(q('[data-testid="status-filter-review"]', el))
    expect(order(el)).toEqual(['b'])
    await click(q('[data-testid="status-filter-intake"]', el))
    expect(order(el).length).toBe(2)
    await click(q('[data-testid="tag-filter-急"]', el))
    expect(order(el).length).toBe(1)
    expect(q('[data-testid="filter-clear"]', el)?.textContent).toContain('3')
    await click(q('[data-testid="filter-clear"]', el))
    expect(useStudio.getState().dashStatuses).toEqual([])
    expect(useStudio.getState().dashTags).toEqual([])
    expect(order(el).length).toBe(3)
    // 左栏分组标题仍是 sm 32（不套用抽屉的 44）
    expect(q('[data-testid="filter-section-责任人"]', el)?.className).toContain('h-sm-control')
    expect(q('[data-testid="filter-section-责任人"]', el)?.className).not.toContain('min-h-touch')
    // 责任人筛选（auth=on）：u1 拥有 a；勾选后只剩 a
    await click(q('[data-testid="filter-section-责任人"]', el))
    await click(q('[data-testid="owner-filter-u1"]', el))
    expect(order(el)).toEqual(['a'])
    await click(q('[data-testid="owner-filter-u1"]', el))
    expect(order(el).length).toBe(3)
  })
})

describe('1440 看板', () => {
  it('可编辑卡有拖柄（dnd-kit 可聚焦按钮）、editor 卡没有；DndContext 就位；axe 干净', async () => {
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashView('board'))
    const handle = q('[data-testid="drag-a"]', el)
    expect(handle).not.toBeNull()
    expect(handle?.getAttribute('role')).toBe('button')
    expect(handle?.getAttribute('aria-roledescription')).toBeTruthy()
    expect(handle?.getAttribute('aria-describedby')).toBeTruthy()
    expect(q('[data-testid="drag-c"]', el)).not.toBeNull()
    expect(q('[data-testid="drag-b"]', el)).toBeNull()
    expect(q('[data-status="intake"] [data-pid="c"]', el)).not.toBeNull()
    expect(el.querySelectorAll('[data-slot="CaseBoard"] > [data-status]').length).toBe(10)
    expect(await serious(el)).toEqual([])
  })

  it('onMove ⇒ store.setCaseStatus ⇒ 卡片换列（store 合约，不依赖传感器）', async () => {
    vi.spyOn(api, 'setCaseStatus').mockImplementation(async (_pid, status) => ({ ...ROWS[0].case!, status }))
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashView('board'))
    const drop = resolveDrop(useStudio.getState().projects, 'a', 'review')!
    await act(async () => void useStudio.getState().setCaseStatus(drop.pid, drop.status))
    expect(q('[data-status="review"] [data-pid="a"]', el)).not.toBeNull()
    expect(q('[data-status="drafting"] [data-pid="a"]', el)).toBeNull()
  })
})

describe('375', () => {
  beforeEach(() => {
    desktop = false
  })

  it('筛选 Sheet：状态 / 标签在 Sheet 内，勾选过滤卡片，按钮显示已选数；axe 干净', async () => {
    const el = await mount(<DashboardPage />)
    expect(q('[data-testid="status-filter-review"]', el)).toBeNull()
    expect(q('[data-testid="scope-all"]', el)).not.toBeNull()
    await click(q('[data-testid="filter-sheet-trigger"]', el))
    const sheet = q('[data-testid="filter-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.getAttribute('data-side')).toBe('bottom')
    expect(sheet?.getAttribute('data-slot')).toBe('bottom-drawer')
    await click(q('[data-testid="status-filter-review"]', sheet!))
    expect(el.querySelectorAll('[data-slot="CaseRow"]').length).toBe(1)
    expect(q('[data-testid="filter-sheet-trigger"]', el)?.textContent).toContain('1')
    expect(await serious(document.body)).toEqual([])
    await click(q('[data-testid="filter-clear"]', sheet!))
    expect(el.querySelectorAll('[data-slot="CaseRow"]').length).toBe(3)
    await click(q('[data-testid="filter-done"]'))
    expect(q('[data-testid="filter-sheet"]')).toBeNull()
  })

  it('筛选 Sheet 内「状态 / 标签」折叠开关与项同为 44（min-h-touch），不再是左栏的 sm 32（W12 R12-01）', async () => {
    const el = await mount(<DashboardPage />)
    await click(q('[data-testid="filter-sheet-trigger"]', el))
    const sheet = q('[data-testid="filter-sheet"]')!
    for (const title of ['状态', '标签']) {
      const trigger = q(`[data-testid="filter-section-${title}"]`, sheet)!
      expect(trigger.tagName).toBe('BUTTON')
      expect(trigger.className).toContain('min-h-touch')
      expect(trigger.className).not.toContain('h-sm-control')
      expect(trigger.className).not.toContain('touch-hit')
    }
    // 折叠仍可用：点「状态」收起后其复选框不在 DOM
    await click(q('[data-testid="filter-section-状态"]', sheet))
    expect(q('[data-testid="status-filter-review"]', sheet)).toBeNull()
  })

  it('BulkBar 贴底（data-variant=sticky），在滚动区之后；卡片带 data-pid', async () => {
    const el = await mount(<DashboardPage />)
    await click(q('[data-testid="select-a"]', el))
    const bar = q('[data-slot="BulkBar"]', el)!
    expect(bar.getAttribute('data-variant')).toBe('sticky')
    expect(bar.className).toContain('bottom-0')
    expect(bar.compareDocumentPosition(q('[data-slot="CaseTable"]', el)!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(await serious(el)).toEqual([])
  })

  it('看板横滚 + 卡片拖柄', async () => {
    const el = await mount(<DashboardPage />)
    await act(async () => useStudio.getState().setDashView('board'))
    expect(q('[data-slot="CaseBoard"]', el)?.className).toContain('overflow-x-auto')
    expect(q('[data-testid="drag-a"]', el)).not.toBeNull()
    expect(await serious(el)).toEqual([])
  })

  it('W8 §4 首页：MobilePage · Segmented md · 今日摘要 / 范围 chip ScrollRow sm 32 touch-hit · 卡片 p-card-m / gap-group-m · 卡片间 gap-cards-m', async () => {
    const el = await mount(<DashboardPage />)
    const page = q('[data-testid="dashboard-page"]', el)!
    expect(page.getAttribute('data-slot')).toBe('mobile-page')
    expect(page.className).toContain('px-page-m')
    expect(page.className).toContain('gap-section-m')
    const seg = q('[data-slot="segmented"]', el)!
    expect(seg.getAttribute('data-size')).toBe('md')
    expect(seg.getAttribute('aria-label')).toBe('视图')
    // 三行行距 12：上一行向下伸出的 touch-hit（md 4 / sm 6）+ 下一行 ScrollRow 出血（8 / 6）要放进行距（docs/plan/28）
    const controls = q('[data-testid="dashboard-controls"]', el)!
    expect(controls.className).toContain('gap-cards-m')
    expect(controls.className).not.toContain('gap-group-m')
    // 今日摘要 / 范围 chips 都是 ScrollRow（可滑不裁切）
    const today = q('[data-testid="today-summary"]', el)!
    expect(today.className).toContain('overflow-x-auto')
    expect(today.className).toContain('scrollbar-none')
    const scopes = q('[data-testid="scope-chips"]', el)!
    expect(scopes.getAttribute('data-slot')).toBe('scroll-row')
    expect(scopes.className).toContain('overflow-x-auto')
    // 范围 chips 行出血 6：32 chip 的 44 热区恰需 6，默认 8 会盖住上一行今日摘要热区的下缘
    expect(scopes.className).toMatch(/(^|\s)-my-1\.5(\s|$)/)
    expect(scopes.className).toMatch(/(^|\s)py-1\.5(\s|$)/)
    expect(scopes.className).not.toMatch(/(^|\s)-?[mp]y-2(\s|$)/)
    for (const id of ['scope-all', 'scope-mine', 'scope-shared', 'scope-archived', 'filter-sheet-trigger']) {
      const chip = q(`[data-testid="${id}"]`, scopes)!
      expect(chip.className).toContain('h-sm-control')
      expect(chip.className).toContain('touch-hit')
      expect(chip.className).not.toContain('h-touch')
    }
    // 卡片：内 16 / 行 8 / 间 12；「…」与复选框同在头行，视觉 sm 32 + touch-hit
    expect(q('[data-slot="CaseTable"]', el)!.className).toContain('gap-cards-m')
    const card = q('[data-slot="CaseRow"][data-pid="a"]', el)!
    expect(card.className).toContain('p-card-m')
    expect(card.className).toContain('gap-group-m')
    const meta = q('[data-testid="card-meta-a"]', el)!
    expect(meta.className).toContain('gap-group-m')
    expect(meta.contains(q('[data-testid="select-a"]', el))).toBe(true)
    expect(meta.contains(q('[data-testid="row-actions-a"]', el))).toBe(true)
    const menu = q('[data-testid="row-actions-a"]', el)!
    expect(menu.className).toContain('size-sm-control')
    expect(menu.className).toContain('touch-hit')
    expect(q('[data-testid="open-a"]', el)!.className).toContain('touch-hit')
    expect(await serious(el)).toEqual([])
  })
})

describe('R51 RowActions', () => {
  const openMenu = async (pid: string) => {
    const trigger = q(`[data-testid="row-actions-${pid}"]`)!
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    })
  }
  const menuItem = (text: string) => [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent?.includes(text))

  it('R51-01 永久删除走两步确认 Dialog：菜单项不发 DELETE，确认后才删', async () => {
    const del = vi.spyOn(api, 'deleteProject').mockResolvedValue(undefined)
    await mount(<RowActions row={row('t', { list_state: 'trashed' })} canEdit />)
    await openMenu('t')
    await click(menuItem('永久删除')!)
    expect(q('[data-testid="case-delete-dialog-t"]')).not.toBeNull()
    expect(del).not.toHaveBeenCalled()
    await click(q('[data-testid="case-delete-confirm-t"]'))
    expect(del).toHaveBeenCalledWith('t')
    expect(q('[data-testid="case-delete-dialog-t"]')).toBeNull()
  })

  it('R51-02 只读角色（canEdit=false）：归档/回收站禁用，退出保留', async () => {
    await mount(<RowActions row={row('v', { my_role: 'viewer' })} canEdit={false} />)
    await openMenu('v')
    expect(menuItem('归档')?.getAttribute('aria-disabled')).toBe('true')
    expect(menuItem('移到回收站')?.getAttribute('aria-disabled')).toBe('true')
    expect(menuItem('退出此案卷')?.getAttribute('aria-disabled')).not.toBe('true')
  })
})
