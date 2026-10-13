// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { DEADLINE_GROUPS, DEADLINE_GROUP_OPEN_KEY, deadlineGroupOf, readDeadlineGroupOpen, selectDeadlineFilterOptions, selectDeadlineGroups, type DeadlineListResponseW7, type TargetFilingItem } from '@/store/deadlines'
import type { DeadlineItem, DeadlineListResponse } from '@/types/deadlines'
import { DeadlinesPage } from '../DeadlinesPage'
import { DeadlinesCompanionBody } from '../DeadlinesCompanion'

/**
 * 期限中心（21 §4.2 / R-HOME-08）：分组计数 = mock 接口 counts；催办 / 完成走 store 契约；501 → EmptyState「功能开发中」；
 * 1440 表格行 / 375 卡片 + 44px 按钮；axe 无 serious/critical。前端只分桶后端 days_left，不推算日期（B7）。
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
  Element.prototype.scrollIntoView ??= () => {}
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

const item = (id: string, days_left: number, patch: Partial<DeadlineItem> = {}): DeadlineItem => ({
  id,
  pid: `p-${id}`,
  case_no: `PS-2026-${id.padStart(3, '0')}`,
  title: `案卷 ${id}`,
  kind: 'oa_reply',
  due: '2026-09-20',
  base_date: null,
  rule: 'oa1',
  legal_basis: null,
  source: 'auto',
  override_reason: null,
  status: days_left < 0 ? 'overdue' : days_left <= 7 ? 'due_soon' : 'upcoming',
  days_left,
  owner: { id: 'u1', display_name: '张律' },
  client: '客户甲',
  done: false,
  done_at: null,
  extensions: [],
  ...patch,
})

/** 逾期 2 / 今日 1 / 7 天 2 / 30 天 1 / 更晚 1 / 已完成 1（done 不计入 counts） */
const ITEMS: DeadlineItem[] = [
  item('1', -5),
  item('2', -1, { kind: 'annual_fee', owner: { id: 'u2', display_name: '李代理' }, client: '客户乙' }),
  item('3', 0),
  item('4', 3, { kind: 'exam_request' }),
  item('5', 7, { owner: null }),
  item('6', 20, { client: null }),
  item('7', 60),
  item('8', 2, { done: true, done_at: 1, status: 'done' }),
]
const RESP: DeadlineListResponse = { items: ITEMS, counts: { overdue: 2, today: 1, '7d': 2, '30d': 1 }, holidays_missing: false }

beforeEach(() => {
  desktop = true
  localStorage.clear()
  useStudio.getState().resetDeadlines()
  useStudio.setState({ deadlinesUnavailable: false, authStatus: 'authed', user: { id: 'u1', email: 'a@x', display_name: 'A', is_superuser: false } })
  vi.spyOn(api, 'notifications').mockResolvedValue({ items: [], unread: 0, has_more: false })
})

describe('selectDeadlineGroups', () => {
  it('分桶只看后端 days_left / done；组内按剩余天升序', () => {
    const g = selectDeadlineGroups({ deadlines: ITEMS })
    expect(Object.fromEntries(DEADLINE_GROUPS.map((k) => [k, g[k].map((d) => d.id)]))).toEqual({
      overdue: ['1', '2'],
      today: ['3'],
      '7d': ['4', '5'],
      '30d': ['6'],
      later: ['7'],
      done: ['8'],
    })
    expect(deadlineGroupOf(item('x', 30))).toBe('30d')
    expect(deadlineGroupOf(item('x', 31))).toBe('later')
    expect(deadlineGroupOf(item('x', 1))).toBe('7d')
  })
  it('筛选候选来自返回项：责任人去重、客户去空、类型集合', () => {
    const o = selectDeadlineFilterOptions({ deadlines: ITEMS })
    expect(o.owners.map((x) => x.id).sort()).toEqual(['u1', 'u2'])
    expect(o.clients).toEqual(['客户甲', '客户乙'])
    expect(o.kinds).toEqual(['oa_reply', 'annual_fee', 'exam_request'])
  })
})

describe('DeadlinesPage 1440', () => {
  it('分组计数与 mock 接口 counts 一致；行含 案号/案名/类型/届满/剩余/责任人/催办/完成；免责页脚；axe 通过', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    const count = (g: string) => Number(el.querySelector(`[data-testid="group-count-${g}"]`)?.textContent)
    expect(count('overdue')).toBe(RESP.counts.overdue)
    expect(count('today')).toBe(RESP.counts.today)
    expect(count('7d')).toBe(RESP.counts['7d'])
    expect(count('30d')).toBe(RESP.counts['30d'])
    expect(count('later')).toBe(1)
    expect(count('done')).toBe(1)
    expect(el.querySelector('[data-testid="deadline-pending"]')?.textContent).toBe('7 项待办')

    const row = el.querySelector('[data-testid="deadline-1"]')!
    expect(row.tagName).toBe('TR')
    expect(row.textContent).toContain('PS-2026-001')
    expect(row.textContent).toContain('案卷 1')
    expect(row.textContent).toContain('OA 答复')
    expect(row.textContent).toContain('2026-09-20')
    expect(row.querySelector('[data-testid="left-1"]')?.textContent).toBe('逾期 5 天')
    expect(row.textContent).toContain('张律')
    expect(row.querySelector('a')?.getAttribute('href')).toBe('#/p/p-1')
    expect(el.querySelector('[data-testid="left-3"]')?.textContent).toBe('今天')
    expect(el.querySelector('[data-testid="left-4"]')?.textContent).toBe('剩 3 天')
    // 无责任人 ⇒ 催办禁用
    expect((el.querySelector('[data-testid="nudge-5"]') as HTMLButtonElement).disabled).toBe(true)
    // 已完成组默认折叠
    expect(el.querySelector('[data-testid="group-done"]')?.getAttribute('data-state')).toBe('closed')
    expect(el.querySelector('[data-testid="deadline-8"]')).toBeNull()
    expect(el.querySelector('[data-testid="deadline-disclaimer"]')?.textContent).toBe('系统推算，以官方通知书为准')
    expect(el.querySelector('[data-testid="nav-deadlines"]')?.getAttribute('aria-current')).toBe('page')
    expect(await serious(el)).toEqual([])
  })

  it('两案同规则 id（exam_request）同时在列 ⇒ 无重复 key 警告，两行都渲染（1440 表格 + 375 卡片）', async () => {
    const dup = [item('exam_request', 3, { pid: 'method', title: '方法案' }), item('exam_request', 5, { pid: 'system', title: '系统案' })]
    vi.spyOn(api, 'deadlines').mockResolvedValue({ items: dup, counts: { overdue: 0, today: 0, '7d': 2, '30d': 0 }, holidays_missing: false })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const isDesktop of [true, false]) {
      desktop = isDesktop
      const el = await mount(<DeadlinesPage />)
      expect(el.querySelectorAll('[data-testid="deadline-exam_request"]')).toHaveLength(2)
      expect(el.textContent).toContain('方法案')
      expect(el.textContent).toContain('系统案')
      await act(async () => root?.unmount())
      root = null
    }
    expect(err.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('same key'))).toEqual([])
  })

  it('催办 → api.nudge(pid, {deadline_id}) + toast；完成 → api.doneDeadline 并移入已完成组', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const nudge = vi.spyOn(api, 'nudge').mockResolvedValue({ notified: 1, message_id: 'n1' } as never)
    const done = vi.spyOn(api, 'doneDeadline').mockImplementation(async (_pid, id, d) => ({ ...ITEMS.find((x) => x.id === id)!, done: d ?? true, done_at: 1, status: 'done' }))
    const el = await mount(<DeadlinesPage />)
    await click(el.querySelector('[data-testid="nudge-1"]'))
    expect(nudge).toHaveBeenCalledWith('p-1', { deadline_id: '1', message: undefined })
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('已催办 1 人')
    await click(el.querySelector('[data-testid="done-1"]'))
    expect(done).toHaveBeenCalledWith('p-1', '1', true)
    expect(Number(el.querySelector('[data-testid="group-count-overdue"]')?.textContent)).toBe(1)
    expect(Number(el.querySelector('[data-testid="group-count-done"]')?.textContent)).toBe(2)
  })

  it('R101：改期钮弹窗收 due+原因 → api.overrideDeadline + toast；已完成行无改期钮', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const ov = vi.spyOn(api, 'overrideDeadline').mockImplementation(async (_pid, id, body) => ({ ...ITEMS.find((x) => x.id === id)!, due: body.due!, source: 'manual', override_reason: body.override_reason }))
    const el = await mount(<DeadlinesPage />)
    await click(el.querySelector('[data-testid="reschedule-1"]'))
    const dlg = document.querySelector('[data-testid="reschedule-dialog-1"]')!
    expect(dlg.textContent).toContain('案卷 1')
    const submit = dlg.querySelector('[data-testid="reschedule-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true) // 原因必填
    const reasonInput = dlg.querySelector('[data-testid="reschedule-reason"]') as HTMLInputElement
    await act(async () => {
      // 受控 input 走原生 setter + input 事件
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(reasonInput, '官方通知延期')
      reasonInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((dlg.querySelector('[data-testid="reschedule-due"]') as HTMLInputElement).value).toBe('2026-09-20')
    expect(submit.disabled).toBe(false)
    await act(async () => (dlg.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(ov).toHaveBeenCalledWith('p-1', '1', { due: '2026-09-20', override_reason: '官方通知延期' })
    expect(useStudio.getState().toasts.at(-1)?.text).toContain('已改期')
    expect(useStudio.getState().deadlines.find((d) => d.id === '1')?.source).toBe('manual')
    expect(document.querySelector('[data-testid="reschedule-dialog-1"]')).toBeNull()
    // 完成行：展开已完成组也没有改期钮
    await click(el.querySelector('[data-testid="group-toggle-done"]'))
    expect(el.querySelector('[data-testid="reschedule-8"]')).toBeNull()
  })

  it('R77-01：my_role=viewer 的行完成/催办禁用；agent 可点；缺省（AUTH off）可写', async () => {
    const rows = [
      item('v', 3, { my_role: 'viewer' }),
      item('a', 3, { my_role: 'agent' }),
      item('n', 3, { my_role: null }),
    ]
    vi.spyOn(api, 'deadlines').mockResolvedValue({ items: rows, counts: { overdue: 0, today: 0, '7d': 3, '30d': 0 }, holidays_missing: false })
    const el = await mount(<DeadlinesPage />)
    for (const id of ['done-v', 'nudge-v', 'reschedule-v']) {
      const b = el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
      expect(b.disabled).toBe(true)
      expect(b.title).toContain('主管')
    }
    expect((el.querySelector('[data-testid="reschedule-a"]') as HTMLButtonElement).disabled).toBe(false)
    expect((el.querySelector('[data-testid="done-a"]') as HTMLButtonElement).disabled).toBe(false)
    expect((el.querySelector('[data-testid="nudge-a"]') as HTMLButtonElement).disabled).toBe(false)
    expect((el.querySelector('[data-testid="done-n"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('筛选变更 ⇒ 重新请求接口（参数透传，后端筛选）；清除筛选复位', async () => {
    const list = vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    expect(list).toHaveBeenLastCalledWith({ range: 'all', owner: undefined, client: undefined, kind: undefined })
    await act(async () => useStudio.getState().loadDeadlines({ owner: 'u2' }))
    expect(list).toHaveBeenLastCalledWith({ range: 'all', owner: 'u2', client: undefined, kind: undefined })
    expect(el.querySelector('[data-testid="deadline-filter-clear"]')?.textContent).toContain('1')
    await click(el.querySelector('[data-testid="deadline-filter-clear"]'))
    expect(useStudio.getState().deadlinesFilter.owner).toBeNull()
    expect(el.querySelector('[data-testid="deadline-filter-clear"]')).toBeNull()
  })

  it('501 → EmptyState「功能开发中」；网络错误 → 重试；空列表 → 暂无期限', async () => {
    vi.spyOn(api, 'deadlines').mockRejectedValue(new ApiError(501, 'not implemented'))
    let el = await mount(<DeadlinesPage />)
    const empty = el.querySelector('[data-testid="deadlines-empty"]')
    expect(empty?.getAttribute('data-slot')).toBe('empty-state')
    expect(empty?.textContent).toContain('功能开发中')
    expect(el.querySelector('[data-testid="deadline-groups"]')).toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    useStudio.getState().resetDeadlines()
    useStudio.setState({ deadlinesUnavailable: false })
    vi.spyOn(api, 'deadlines').mockRejectedValue(new ApiError(500, '服务器打盹了'))
    el = await mount(<DeadlinesPage />)
    expect(el.querySelector('[data-testid="deadlines-error"]')?.textContent).toContain('服务器打盹了')
    vi.spyOn(api, 'deadlines').mockResolvedValue({ items: [], counts: { overdue: 0, today: 0, '7d': 0, '30d': 0 }, holidays_missing: true })
    await click(el.querySelector('[data-testid="deadlines-retry"]'))
    expect(el.querySelector('[data-testid="deadlines-empty"]')?.textContent).toContain('暂无期限')
    expect(el.querySelector('[data-testid="deadlines-holidays-missing"]')).not.toBeNull()
  })
})

describe('DeadlinesPage 375', () => {
  it('卡片列表（li）+ md 36 动作（touch-hit ≥ 44）+ 头像紧凑；分组仍一致', async () => {
    desktop = false
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    const card = el.querySelector('[data-testid="deadline-1"]')!
    expect(card.tagName).toBe('LI')
    expect(card.textContent).toContain('PS-2026-001')
    expect(card.querySelector('[data-slot="avatar"]')).not.toBeNull()
    for (const id of ['nudge-1', 'reschedule-1', 'done-1']) {
      const cls = card.querySelector(`[data-testid="${id}"]`)!.className
      expect(cls).toContain('h-md-control')
      expect(cls).toContain('touch-hit')
      expect(cls).not.toContain('h-touch')
    }
    expect(Number(el.querySelector('[data-testid="group-count-overdue"]')?.textContent)).toBe(RESP.counts.overdue)
    expect(el.querySelector('[data-testid="deadline-filters"]')).not.toBeNull()
    expect(await serious(el)).toEqual([])
  })

  it('W8 §4：MobilePage · 类型 chips ScrollRow sm 32 + 责任人 / 客户 Select lg 一行两列；组头 32 · 卡片 p-card-m / gap-group-m / gap-cards-m；免责在 MobilePage 内', async () => {
    desktop = false
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    const page = el.querySelector('[data-testid="deadlines-page"]')!
    expect(page.getAttribute('data-slot')).toBe('mobile-page')
    expect(page.className).toContain('px-page-m')
    expect(page.className).toContain('gap-section-m')
    // 筛选：类型不再是 Select，而是 ScrollRow 里的 sm chip
    expect(el.querySelector('[data-testid="filter-kind"]')).toBeNull()
    const chips = el.querySelector('[data-testid="filter-kind-chips"]')!
    expect(chips.getAttribute('data-slot')).toBe('scroll-row')
    const all = chips.querySelector('[data-testid="filter-kind-all"]')!
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(all.className).toContain('h-sm-control')
    expect(all.className).toContain('touch-hit')
    expect(chips.querySelector('[data-testid="filter-kind-oa_reply"]')).not.toBeNull()
    const selects = el.querySelector('[data-testid="deadline-filter-selects"]')!
    expect(selects.className).toContain('grid-cols-2')
    expect(selects.className).toContain('gap-group-m')
    expect(el.querySelector('[data-testid="filter-owner"]')?.getAttribute('data-size')).toBe('lg')
    expect(el.querySelector('[data-testid="filter-client"]')?.getAttribute('data-size')).toBe('lg')
    // 组头 sm 32 + touch-hit，不再粘性 44
    const head = el.querySelector('[data-testid="group-toggle-overdue"]')!
    expect(head.className).toContain('min-h-sm-control')
    expect(head.className).toContain('touch-hit')
    expect(head.className).not.toContain('min-h-touch')
    const section = el.querySelector('[data-testid="group-overdue"]')!
    expect(section.className).toContain('gap-group-m')
    expect(section.querySelector('ul')!.className).toContain('gap-cards-m')
    const card = el.querySelector('[data-testid="deadline-1"]')!
    expect(card.className).toContain('p-card-m')
    expect(card.className).toContain('gap-group-m')
    expect(card.className).not.toContain('p-3')
    // 免责为 MobilePage 最后一个子元素（由 pb 为 Tab bar 让位）
    const disclaimer = el.querySelector('[data-testid="deadline-disclaimer"]')!
    expect(page.lastElementChild).toBe(disclaimer)
    expect(disclaimer.className).not.toContain('border-t')
    expect(await serious(el)).toEqual([])
  })

  it('W8：点类型 chip → loadDeadlines({kind})，再点取消；清除为 chip 行末 sm ghost', async () => {
    desktop = false
    const spy = vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="filter-kind-oa_reply"]')!.click())
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'oa_reply' })
    expect(el.querySelector('[data-testid="filter-kind-oa_reply"]')?.getAttribute('aria-pressed')).toBe('true')
    const clear = el.querySelector('[data-testid="deadline-filter-clear"]')!
    expect(clear.closest('[data-testid="filter-kind-chips"]')).not.toBeNull()
    expect(clear.getAttribute('data-size')).toBe('sm')
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="filter-kind-oa_reply"]')!.click())
    expect(spy.mock.calls.at(-1)?.[0]?.kind).toBeUndefined()
    expect(el.querySelector('[data-testid="filter-kind-all"]')?.getAttribute('aria-pressed')).toBe('true')
  })
})

/** W7 ux-04：`target_filings` 独立于 items/counts；只读「目标递交 T-N」，不进普通分桶、无催办/完成动作 */
describe('目标递交倒计时（W7 ux-04）', () => {
  const TARGETS: TargetFilingItem[] = [
    { pid: 'p-t1', case_no: 'PS-2026-T01', title: '目标案 1', target_filing: '2026-09-18', target_filing_days_left: 12, owner: { id: 'u1', display_name: '张律' }, client: '客户甲' },
    { pid: 'p-t2', case_no: null, title: '目标案 2（逾期）', target_filing: '2026-09-03', target_filing_days_left: -3, owner: null, client: null },
  ]
  const RESP_T: DeadlineListResponseW7 = { ...RESP, target_filings: TARGETS }

  it('store：deadlineTargets 来自 target_filings；缺字段（旧后端）⇒ []；普通分桶不含目标递交', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP_T as DeadlineListResponse)
    await act(async () => useStudio.getState().loadDeadlines())
    expect(useStudio.getState().deadlineTargets.map((t) => t.pid)).toEqual(['p-t1', 'p-t2'])
    expect(useStudio.getState().deadlines.length).toBe(ITEMS.length)
    const g = selectDeadlineGroups({ deadlines: useStudio.getState().deadlines })
    expect(DEADLINE_GROUPS.flatMap((k) => g[k].map((d) => d.pid))).not.toContain('p-t1')
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    await act(async () => useStudio.getState().loadDeadlines())
    expect(useStudio.getState().deadlineTargets).toEqual([])
  })

  it('1440：独立「目标递交」组，行 = 案号/案名/目标日/T-N（Heat）/责任人/只读，无催办/完成；普通组计数不变；axe 通过', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP_T as DeadlineListResponse)
    const el = await mount(<DeadlinesPage />)
    expect(el.querySelector('[data-testid="group-count-target"]')?.textContent).toBe('2')
    expect(Number(el.querySelector('[data-testid="group-count-overdue"]')?.textContent)).toBe(RESP.counts.overdue)
    expect(el.querySelector('[data-testid="deadline-pending"]')?.textContent).toBe('7 项待办')
    expect(el.querySelector('[data-testid="deadline-target-count"]')?.textContent).toBe('；另 2 项目标递交不计入待办')
    const row = el.querySelector('[data-testid="target-p-t1"]')!
    expect(row.tagName).toBe('TR')
    expect(row.textContent).toContain('PS-2026-T01')
    expect(row.textContent).toContain('目标案 1')
    expect(row.textContent).toContain('2026-09-18')
    expect(row.textContent).toContain('张律')
    expect(row.querySelector('[data-testid="target-left-p-t1"]')?.textContent).toBe('目标递交 T-12')
    expect(row.querySelector('[data-testid="target-left-p-t1"]')?.getAttribute('data-slot')).toBe('heat')
    expect(row.querySelector('a')?.getAttribute('href')).toBe('#/p/p-t1')
    expect(row.querySelector('button')).toBeNull()
    expect(el.querySelector('[data-testid="target-left-p-t2"]')?.textContent).toBe('目标递交 T+3')
    await click(el.querySelector('[data-testid="group-toggle-target"]'))
    expect(el.querySelector('[data-testid="group-target"]')?.getAttribute('data-state')).toBe('closed')
    expect(el.querySelector('[data-testid="target-p-t1"]')).toBeNull()
    expect(await serious(el)).toEqual([])
  })

  it('只有目标递交、无普通期限 ⇒ 不显示「暂无期限」，仍渲染目标组；375 卡片 li + 标题 44 命中', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue({ items: [], counts: { overdue: 0, today: 0, '7d': 0, '30d': 0 }, holidays_missing: false, target_filings: TARGETS } as DeadlineListResponse)
    let el = await mount(<DeadlinesPage />)
    expect(el.querySelector('[data-testid="deadlines-empty"]')).toBeNull()
    expect(el.querySelector('[data-testid="target-left-p-t1"]')?.textContent).toBe('目标递交 T-12')
    // W7 qa-07：页头「0 项待办」旁注明目标递交不计入，与下方「目标递交 2」组不再看似矛盾
    expect(el.querySelector('[data-testid="deadline-pending"]')?.textContent).toBe('0 项待办')
    expect(el.querySelector('[data-testid="deadline-target-count"]')?.textContent).toBe('；另 2 项目标递交不计入待办')
    await act(async () => root?.unmount())
    host.remove()

    desktop = false
    useStudio.getState().resetDeadlines()
    el = await mount(<DeadlinesPage />)
    const card = el.querySelector('[data-testid="target-p-t2"]')!
    expect(card.tagName).toBe('LI')
    expect(card.textContent).toContain('目标案 2（逾期）')
    expect(card.querySelector('[data-testid="target-left-p-t2"]')?.textContent).toBe('目标递交 T+3')
    expect(card.querySelector('[data-testid="target-link-p-t2"]')?.className).toContain('min-h-touch')
    expect(card.querySelector('button')).toBeNull()
    expect(await serious(el)).toEqual([])
  })
})

describe('分组折叠偏好持久化（R115 批10b：patent-studio.deadlines.group-open）', () => {
  const DEFAULTS = { target: true, overdue: true, today: true, '7d': true, '30d': true, later: true, done: false }
  it('readDeadlineGroupOpen：无值/坏值/非对象/未知键落回默认；有值按已知键合并', () => {
    expect(readDeadlineGroupOpen(DEFAULTS, null)).toEqual(DEFAULTS)
    expect(readDeadlineGroupOpen(DEFAULTS, { getItem: () => '{oops' })).toEqual(DEFAULTS)
    expect(readDeadlineGroupOpen(DEFAULTS, { getItem: () => '[1]' })).toEqual(DEFAULTS)
    expect(readDeadlineGroupOpen(DEFAULTS, { getItem: () => JSON.stringify({ done: true, bogus: false, '7d': 'x' }) })).toEqual({ ...DEFAULTS, done: true })
  })

  it('折叠/展开写 localStorage；重挂载沿用上次选择', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    const el = await mount(<DeadlinesPage />)
    // 默认：done 组折叠（已完成行不见）
    expect(el.querySelector('[data-testid="deadline-8"]')).toBeNull()
    await click(el.querySelector('[data-testid="group-toggle-done"]'))
    expect(el.querySelector('[data-testid="deadline-8"]')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem(DEADLINE_GROUP_OPEN_KEY)!)).toMatchObject({ done: true })
    // 折叠 7d 组
    await click(el.querySelector('[data-testid="group-toggle-7d"]'))
    expect(JSON.parse(localStorage.getItem(DEADLINE_GROUP_OPEN_KEY)!)).toMatchObject({ done: true, '7d': false })
    await act(async () => root!.unmount())
    const el2 = await mount(<DeadlinesPage />)
    expect(el2.querySelector('[data-testid="deadline-8"]')).not.toBeNull() // done 仍展开
    expect(el2.querySelector('[data-testid="deadline-4"]')).toBeNull() // 7d 组行不可见（组头仍在）
    expect(el2.querySelector('[data-testid="group-toggle-7d"]')!.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('DeadlinesCompanion ?dl= 深链', () => {
  it('?panel=deadlines&dl=<id> 滚到对应行并短暂高亮；一次性 query 被消费', async () => {
    vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    window.location.hash = '#/p/p-3?panel=deadlines&dl=3'
    await mount(<DeadlinesCompanionBody />)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    const el = document.querySelector('[data-deadline-key="p-3/3"]')
    expect(el).not.toBeNull()
    expect(el!.className).toContain('bg-selected')
    expect(window.location.hash).toBe('#/p/p-3?panel=deadlines')
    window.location.hash = '#/'
  })

  it('dl 指向不存在/已完成期限：强刷一次仍无 ⇒ toast + query 被消费（与 ?c= 失效锚定同契约）', async () => {
    const dlSpy = vi.spyOn(api, 'deadlines').mockResolvedValue(RESP)
    window.location.hash = '#/p/p-3?panel=deadlines&dl=nonexistent'
    await mount(<DeadlinesCompanionBody />)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(dlSpy).toHaveBeenCalledTimes(2) // 挂载拉取 + 未命中强刷一次
    expect(useStudio.getState().toasts.some((t) => t.text === '该期限不存在或已完成')).toBe(true)
    expect(window.location.hash).toBe('#/p/p-3?panel=deadlines')
    window.location.hash = '#/'
  })
})
