// @vitest-environment jsdom
import axe from 'axe-core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { AI_MODEL_ROUTES, auditCsvUrl } from '@/store/admin'
import type { AiUsageSummary, OrgAuditEvent, OrgSettings } from '@/types/org'
import { AdminPage } from '../AdminPage'
import { MemberTable } from '../MemberTable'
import type { AdminUser } from '@/types/account'
import { validateBudget } from '../AiPanel'
import { fmtDateTime } from '@/lib/format'
import { auditQueryFrom, describeAudit } from '../AuditPanel'

/**
 * W5 机构管理（docs/plan/21 §4.6；R-ADM-02 / R-ADM-03 / R-AI-01 / R-AI-09）：
 *  - #/admin?tab=members|org|audit|ai 二级导航（1440 左栏 / 375 Segmented）
 *  - 审计：筛选 actor / pid / 时间 / 类型 → GET /api/admin/audit 查询串；「导出 CSV」href 带同一筛选；501 → EmptyState「功能开发中」
 *  - AI：机构级开关 → PUT /api/admin/settings {ai_enabled}；关闭时全机构生效提示；路由只读三条；日预算校验 → PUT {ai_daily_tokens}
 *  - 机构：节假日状态只读（deadlines.holidays_missing）；默认协作设置 → PUT {default_collab}
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const testQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
const initial = useStudio.getInitialState()

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notImplemented = (unit: string) => json({ kind: 'not_implemented', detail: unit }, 501)

const me: User = { id: 'u1', email: 'me@x', display_name: '王代理', is_superuser: true, title: '代理师', avatar_color: '' }
const orgSettings: OrgSettings = {
  ai_enabled: true,
  default_collab: { editor_mode: 'edit', allow_viewer_comment: true },
  smtp: null,
  ai_daily_tokens: 200000,
}
const usage: AiUsageSummary = {
  today_tokens: 12345,
  budget: 200000,
  by_project: [{ pid: 'method', title: '一种方法', today_tokens: 12345 }],
  by_model: [{ model: 'swe-2-max', tokens: 12345, calls: 3 }],
}
const events: OrgAuditEvent[] = [
  { id: 'e1', ts: 1_757_000_000, kind: 'ai.sent', actor: { id: 'u1', display_name: '王代理' }, pid: 'method', data: { model: 'swe-2-max' } },
  { id: 'e2', ts: 1_757_000_100.5, kind: 'share.confirmed', actor: null, pid: 'method', data: { version: 3 } },
]

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
})

beforeEach(() => {
  useStudio.setState(initial, true)
  useStudio.setState({ authStatus: 'authed', user: me })
  desktop = true
  window.location.hash = '#/admin'
})

afterEach(async () => {
  testQC.clear()
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<QueryClientProvider client={testQC}>{el}</QueryClientProvider>))
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

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel)
const qa = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}
const type = async (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = (sel: string) => act(async () => q<HTMLFormElement>(sel)!.requestSubmit())
const goTab = (hash: string) =>
  act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

/** 一套 fetch 路由：记录 url + init，未知路径 501 */
function router(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const u = new URL(String(input), 'http://x')
    const key = u.pathname
    calls.push({ url: u.pathname + u.search, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    if (overrides[key]) return overrides[key](init)
    if (key === '/api/admin/users') return json([])
    if (key === '/api/admin/org') return json({ name: '甲乙丙知识产权' })
    if (key === '/api/tags') return json({ tags: [] })
    if (key === '/api/templates') return json([])
    if (key === '/api/deadlines') return json({ items: [], counts: {}, holidays_missing: true })
    if (key === '/api/admin/settings') return json(init?.method === 'PUT' ? { ...orgSettings, ...JSON.parse(String(init.body)) } : orgSettings)
    if (key === '/api/admin/ai-usage') return json(usage)
    if (key === '/api/admin/audit') return json({ items: events, total: events.length })
    return notImplemented(key)
  })
  return calls
}

describe('二级导航 #/admin?tab=', () => {
  it('1440：左栏四项，默认成员；hash 切换到 org / audit / ai 渲染对应面板 + axe', async () => {
    router()
    await mount(<AdminPage />)
    expect(q('[data-testid="subnav-desktop"]')).not.toBeNull()
    expect(qa('[data-testid^="admin-tab-"]').map((el) => el.dataset.testid)).toEqual(['admin-tab-members', 'admin-tab-org', 'admin-tab-audit', 'admin-tab-ai'])
    expect(q('[data-testid="admin-tab-members"]')?.getAttribute('aria-current')).toBe('page')
    expect(q('[data-testid="admin-tab-org"]')?.getAttribute('href')).toBe('#/admin?tab=org')
    expect(q('[data-testid="member-table"], [data-testid="member-table-empty"]')).not.toBeNull()
    await goTab('#/admin?tab=org')
    await flush()
    expect(q('[data-testid="admin-org-panel"]')).not.toBeNull()
    expect(q('[data-testid="admin-holidays"]')?.textContent).toContain('缺失')
    expect(await serious(host)).toEqual([])
    await goTab('#/admin?tab=audit')
    await flush()
    expect(q('[data-testid="admin-audit-panel"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
    await goTab('#/admin?tab=ai')
    await flush()
    expect(q('[data-testid="admin-ai-panel"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
  })
  it('375：Segmented 横滑导航；审计表转卡片', async () => {
    desktop = false
    router()
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    expect(q('[data-testid="subnav-mobile"]')).not.toBeNull()
    expect(q('[data-testid="subnav-desktop"]')).toBeNull()
    expect(q('[data-testid="audit-table"]')).toBeNull()
    expect(qa('[data-testid="audit-cards"] li')).toHaveLength(2)
    expect(await serious(host)).toEqual([])
  })

  it('W8 375：SubNav ScrollRow；成员卡 p-card-m + gap-group-m、卡间 gap-cards-m；Select lg；管理员/禁用 md 等宽；标签/模板卡 gap-group-m + 按钮 md', async () => {
    desktop = false
    const members = [
      { id: 'u1', email: 'me@x', display_name: '王代理', title: '代理师', avatar_color: '', is_superuser: true, is_active: true, last_login_at: null },
      { id: 'u2', email: 'b@x', display_name: '李代理', title: '', avatar_color: '', is_superuser: false, is_active: true, last_login_at: null },
    ]
    router({ '/api/admin/users': () => json(members) })
    window.location.hash = '#/admin'
    await mount(<AdminPage />)
    await flush()
    const nav = q('[data-testid="subnav-mobile"]')!
    expect(nav.getAttribute('data-slot')).toBe('scroll-row')
    expect(q('[role="radiogroup"]', nav)?.className).not.toContain('h-touch')
    expect(q('[data-testid="admin-card"]')?.className).toContain('gap-section-m')
    const table = q('[data-testid="member-table"]')!
    expect(table.dataset.variant).toBe('mobile')
    expect(table.className).toContain('gap-cards-m')
    const row = q('[data-testid="member-row"]')!
    expect(row.className).toContain('p-card-m')
    expect(row.className).toContain('gap-group-m')
    expect(q('[data-testid="member-title"]', row)?.className).toContain('h-lg-control')
    const sup = q('[data-testid="member-toggle-super"]', row)!
    const act_ = q('[data-testid="member-toggle-active"]', row)!
    expect(sup.className).toContain('h-md-control')
    expect(act_.className).toContain('h-md-control')
    expect(sup.parentElement?.className).toContain('[&>button]:flex-1')
    expect(sup.parentElement?.className).toContain('gap-group-m')
    expect(q('[data-testid="admin-tags-card"]')?.className).toContain('gap-group-m')
    expect(q('[data-testid="admin-templates-card"]')?.className).toContain('gap-group-m')
    expect(q('[data-testid="admin-manage-tags"]')?.className).toContain('h-md-control')
    expect(await serious(host)).toEqual([])
  })

  it('W8 1440：桌面不变——成员表 <table>、行内按钮 sm、卡片 gap-3', async () => {
    const members = [
      { id: 'u1', email: 'me@x', display_name: '王代理', title: '代理师', avatar_color: '', is_superuser: true, is_active: true, last_login_at: null },
    ]
    router({ '/api/admin/users': () => json(members) })
    window.location.hash = '#/admin'
    await mount(<AdminPage />)
    await flush()
    expect(q('table[data-testid="member-table"]')).not.toBeNull()
    expect(q('[data-testid="member-toggle-super"]')?.className).toContain('h-sm-control')
    expect(q('[data-testid="admin-tags-card"]')?.className).toContain('gap-3')
    expect(q('[data-testid="admin-card"]')?.className).toContain('gap-10')
  })
})

describe('批52 高权限动作两阶确认', () => {
  const rows: AdminUser[] = [
    { id: 'u1', email: 'me@x', display_name: '王代理', title: '代理师', avatar_color: '', is_superuser: true, is_active: true, last_login_at: null },
    { id: 'u2', email: 'b@x', display_name: '李代理', title: '', avatar_color: '', is_superuser: false, is_active: true, last_login_at: null },
  ]

  it('授予超管/禁用：点击先 arm 不写库，确认才 onUpdate；取消复位', async () => {
    const onUpdate = vi.fn()
    const el = await mount(<MemberTable rows={rows} selfId="u1" loading={false} unavailable={false} error={null} onUpdate={onUpdate} />)
    const row = qa('[data-testid="member-row"]', el)[1] // u2 行
    await click(q('[data-testid="member-toggle-super"]', row))
    expect(onUpdate).not.toHaveBeenCalled()
    await click(q('[data-testid="member-confirm-u2"]', el))
    expect(onUpdate).toHaveBeenCalledWith('u2', { is_superuser: true })

    await click(q('[data-testid="member-toggle-active"]', row))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    await click(q('[data-testid="member-cancel-u2"]', el))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="member-toggle-super"]', row)).not.toBeNull()
  })

  it('「启用」（恢复向）不设防：直接 onUpdate', async () => {
    const onUpdate = vi.fn()
    const el = await mount(<MemberTable rows={[rows[0], { ...rows[1], is_active: false }]} selfId="u1" loading={false} unavailable={false} error={null} onUpdate={onUpdate} />)
    const row = qa('[data-testid="member-row"]', el)[1]
    await click(q('[data-testid="member-toggle-active"]', row))
    expect(onUpdate).toHaveBeenCalledWith('u2', { is_active: true })
  })
})

describe('R-ADM-02 审计', () => {
  it('fmtDateTime：后端 epoch 秒 → 真实日期（不是 1970）；表格 <time dateTime> 同步', async () => {
    expect(fmtDateTime(1_757_000_000)).toMatch(/^2025-09-0[45] /)
    router()
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    const times = qa('[data-testid="audit-table"] tbody time')
    expect(times).toHaveLength(2)
    for (const t of times) {
      expect(t.textContent).not.toMatch(/^1970/)
      expect(t.getAttribute('dateTime')).toMatch(/^2025-09-04T/)
    }
  })
  it('describeAudit：详情是人话，不露 token / job_id / sha / user_id / 模型内部字段', () => {
    const ev = (kind: OrgAuditEvent['kind'], data: Record<string, unknown>): OrgAuditEvent =>
      ({ id: 'x', ts: 1_757_000_000, kind, actor: null, pid: 'method', data })
    expect(describeAudit(ev('member.changed', { user_id: 'b4c1…', role: 'reviewer', email: 'li@x.com' }))).toBe('li@x.com → 审阅者')
    expect(describeAudit(ev('member.changed', { user_id: 'b4c1…', role: null, email: 'li@x.com' }))).toBe('移除 li@x.com')
    expect(describeAudit(ev('share.created', { token: 'tok_secret', scope: 'comment', baseline: 'abc', expires_at: null }))).toBe('可批注 · 长期有效')
    expect(describeAudit(ev('share.revoked', { token: 'tok_secret' }))).toBe('')
    expect(describeAudit(ev('share.confirmed', { token: 'tok', name: '张客户', version: 2, sha: 'deadbeef', note: '同意' }))).toBe('确认人 张客户 · 第 2 版 · 同意')
    expect(describeAudit(ev('export.downloaded', { fmt: 'bundle.zip' }))).toBe('递交包')
    expect(describeAudit(ev('ai.sent', { job_id: 'j-1', scenario: '改写', calls: 2, chars: 1200, model: 'swe-2-max', usage: {}, truncated: true }))).toBe('改写 · swe-2-max · 1200 字 · 已截断')
    expect(describeAudit(ev('deliver.filed', { application_no: '2026101234567', filed: '2026-09-01' }))).toBe('申请号 2026101234567 · 递交日 2026-09-01')
    expect(describeAudit(ev('admin.user', { user_id: 'u1', email: 'li@x.com', changes: { is_superuser: true, title: '代理师' } })))
      .toBe('li@x.com → 授予超管、头衔「代理师」')
    expect(describeAudit(ev('admin.user', { user_id: 'u1', email: 'li@x.com', changes: { is_active: false } })))
      .toBe('li@x.com → 禁用账号')
    expect(describeAudit(ev('case.created', { title: '甲案' }))).toBe('甲案')
    for (const e of [
      ev('share.created', { token: 'tok_secret', scope: 'read' }),
      ev('member.changed', { user_id: 'b4c1', role: 'owner', email: 'a@b' }),
      ev('ai.sent', { job_id: 'j-1', scenario: 's' }),
    ]) expect(describeAudit(e)).not.toMatch(/tok_secret|b4c1|j-1|=/)
  })
  it('审计表「案卷」列显示案名而非 pid；详情列为人话', async () => {
    router()
    useStudio.setState({ projects: [{ id: 'method', title: '一种时间序列预测方法', mtime: 0 }] })
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    const rows = qa('[data-testid="audit-table"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('一种时间序列预测方法')
    expect(rows[0].textContent).toContain('swe-2-max')
    expect(rows[0].textContent).not.toMatch(/model=|案卷 method/)
    expect(rows[1].textContent).toContain('第 3 版')
    expect(q<HTMLAnchorElement>('[data-testid="audit-table"] tbody a')?.getAttribute('href')).toBe('#/p/method')
  })
  it('auditQueryFrom：空值不进查询；kind=全部 → undefined', () => {
    expect(auditQueryFrom({ actor: ' ', pid: '', from: '', to: '', kind: '__any' })).toEqual({ actor: undefined, pid: undefined, from: undefined, to: undefined, kind: undefined })
    expect(auditQueryFrom({ actor: '王', pid: 'method', from: '2026-09-01', to: '2026-09-06', kind: 'ai.sent' })).toEqual({
      actor: '王',
      pid: 'method',
      from: '2026-09-01',
      to: '2026-09-06',
      kind: 'ai.sent',
    })
    expect(auditCsvUrl({ actor: '王', limit: 50 })).toBe('/api/admin/audit.csv?actor=%E7%8E%8B')
  })
  it('筛选 actor / pid / 起止 → GET /api/admin/audit 查询串；「导出 CSV」href 带同一筛选；表格渲染事件', async () => {
    const calls = router()
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    expect(calls.some((c) => c.url.startsWith('/api/admin/audit'))).toBe(true)
    expect(qa('[data-testid="audit-table"] tbody tr')).toHaveLength(2)
    expect(q('[data-testid="audit-total"]')?.textContent).toContain('2')

    await type(q<HTMLInputElement>('[data-testid="audit-actor"]')!, '王代理')
    await type(q<HTMLInputElement>('[data-testid="audit-pid"]')!, 'method')
    await type(q<HTMLInputElement>('[data-testid="audit-from"]')!, '2026-09-01')
    await type(q<HTMLInputElement>('[data-testid="audit-to"]')!, '2026-09-06')
    await submit('[data-testid="audit-filter-form"]')
    await flush()
    const last = calls.filter((c) => c.url.startsWith('/api/admin/audit?')).at(-1)!
    const sp = new URLSearchParams(last.url.split('?')[1])
    expect(sp.get('actor')).toBe('王代理')
    expect(sp.get('pid')).toBe('method')
    expect(sp.get('from')).toBe('2026-09-01')
    expect(sp.get('to')).toBe('2026-09-06')
    expect(sp.get('kind')).toBeNull()

    const csv = q<HTMLAnchorElement>('[data-testid="audit-export-csv"]')!
    const csvSp = new URLSearchParams(csv.getAttribute('href')!.split('?')[1])
    expect(csv.getAttribute('href')!.startsWith('/api/admin/audit.csv?')).toBe(true)
    expect(csvSp.get('actor')).toBe('王代理')
    expect(csvSp.get('pid')).toBe('method')
    expect(csvSp.get('from')).toBe('2026-09-01')
    expect(csvSp.has('limit')).toBe(false)
    expect(await serious(host)).toEqual([])
  })
  it('R115-批22：total>items →「加载更多」窗口 +PAGE 重查；到齐后按钮消失', async () => {
    const events3: OrgAuditEvent[] = [...events, { id: 'e3', ts: 1_757_000_050, kind: 'auth.login', actor: null, pid: null, data: {} }]
    let expanded = false
    const calls = router({ '/api/admin/audit': () => json(expanded ? { items: events3, total: 3 } : { items: events, total: 3 }) })
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    const more = q<HTMLButtonElement>('[data-testid="audit-load-more"]')!
    expect(more).not.toBeNull()
    expanded = true
    await act(async () => more.click())
    await flush()
    const last = calls.filter((c) => c.url.startsWith('/api/admin/audit?')).at(-1)!
    expect(new URLSearchParams(last.url.split('?')[1]).get('limit')).toBe('200')
    await vi.waitFor(() => {
      expect(q('[data-testid="audit-load-more"]')).toBeNull()
      expect(qa('[data-testid="audit-table"] tbody tr')).toHaveLength(3)
    })
  })
  it('501 → EmptyState「功能开发中」', async () => {
    router({ '/api/admin/audit': () => notImplemented('org-audit') })
    window.location.hash = '#/admin?tab=audit'
    await mount(<AdminPage />)
    await flush()
    const empty = q('[data-testid="admin-audit-unavailable"]')
    expect(empty?.getAttribute('data-slot')).toBe('empty-state')
    expect(empty?.textContent).toContain('功能开发中')
    expect(useStudio.getState().toasts).toHaveLength(0)
  })
})

describe('R-AI-01 / R-AI-09 机构 AI', () => {
  it('开关 → PUT /api/admin/settings {ai_enabled:false}；关闭后提示全机构生效；路由只读三条；用量图 lazy 挂载', async () => {
    const calls = router()
    window.location.hash = '#/admin?tab=ai'
    await mount(<AdminPage />)
    await flush()
    const sw = q<HTMLButtonElement>('[data-testid="org-ai-enabled"]')!
    expect(sw.getAttribute('role')).toBe('switch')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-testid="org-ai-disabled-alert"]')).toBeNull()
    // 顺序镜像 backend/app/ai/client.py MODELS（interactive → heavy → fallback）
    expect(AI_MODEL_ROUTES.map((r) => r.model)).toEqual(['swe-2-medium', 'swe-2-max', 'swe-2-high'])
    const routes = q('[data-testid="ai-model-routes"]')!
    for (const m of ['swe-2-max', 'swe-2-medium', 'swe-2-high']) expect(routes.textContent).toContain(m)
    expect(routes.querySelector('input, [role="switch"]')).toBeNull()
    expect(q('[data-testid="ai-usage"]')?.textContent).toContain('1.2 万')

    await click(sw)
    await flush()
    const put = calls.find((c) => c.url === '/api/admin/settings' && c.method === 'PUT')!
    expect(put.body).toEqual({ ai_enabled: false })
    expect(useStudio.getState().orgSettings?.ai_enabled).toBe(false)
    expect(q('[data-testid="org-ai-enabled"]')?.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-testid="org-ai-disabled-alert"]')?.textContent).toContain('全机构')
    expect(await serious(host)).toEqual([])
  })
  it('日预算：非整数 / 负数报字段错误；合法 → PUT {ai_daily_tokens}', async () => {
    expect(validateBudget('')).toBeTruthy()
    expect(validateBudget('-1')).toBeTruthy()
    expect(validateBudget('1.5')).toBeTruthy()
    expect(validateBudget('0')).toBeUndefined()
    expect(validateBudget('300000')).toBeUndefined()
    const calls = router()
    window.location.hash = '#/admin?tab=ai'
    await mount(<AdminPage />)
    await flush()
    const input = q<HTMLInputElement>('[data-testid="ai-budget"]')!
    expect(input.value).toBe('200000')
    await type(input, '-5')
    await submit('[data-testid="ai-budget-form"]')
    expect(q('[data-testid="ai-budget-error"]')).not.toBeNull()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await type(input, '300000')
    await submit('[data-testid="ai-budget-form"]')
    await flush()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ai_daily_tokens: 300000 })
  })
  it('settings 501 → EmptyState；ai-usage 501 → 用量区不可用提示但开关仍可用', async () => {
    router({ '/api/admin/settings': () => notImplemented('org-settings') })
    window.location.hash = '#/admin?tab=ai'
    await mount(<AdminPage />)
    await flush()
    expect(q('[data-testid="admin-ai-unavailable"]')?.textContent).toContain('功能开发中')
    await act(async () => root?.unmount())
    root = null
    useStudio.setState(initial, true)
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.restoreAllMocks()
    router({ '/api/admin/ai-usage': () => notImplemented('ai-usage') })
    await mount(<AdminPage />)
    await flush()
    expect(q('[data-testid="org-ai-enabled"]')).not.toBeNull()
    expect(q('[data-testid="ai-usage-unavailable"]')).not.toBeNull()
  })
})

describe('机构面板', () => {
  it('默认协作：允许 viewer 评论开关 → PUT {default_collab}；节假日「缺失」只读徽章；settings 501 → 协作区 EmptyState', async () => {
    const calls = router()
    window.location.hash = '#/admin?tab=org'
    await mount(<AdminPage />)
    await flush()
    expect(q<HTMLInputElement>('[data-testid="org-name"]')?.value).toBe('甲乙丙知识产权')
    const holidays = q('[data-testid="admin-holidays"]')!
    expect(holidays.textContent).toContain('缺失')
    expect(holidays.querySelector('input, button, [role="switch"]')).toBeNull()
    const sw = q('[data-testid="collab-viewer-comment"]')!
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await click(sw)
    await click(q('[data-testid="collab-save"]'))
    await flush()
    const put = calls.find((c) => c.url === '/api/admin/settings' && c.method === 'PUT')!
    expect(put.body).toEqual({ default_collab: { editor_mode: 'edit', allow_viewer_comment: false } })
    expect(await serious(host)).toEqual([])

    await act(async () => root?.unmount())
    root = null
    useStudio.setState(initial, true)
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.restoreAllMocks()
    router({ '/api/admin/settings': () => notImplemented('org-settings') })
    await mount(<AdminPage />)
    await flush()
    expect(q('[data-testid="admin-collab-unavailable"]')?.textContent).toContain('功能开发中')
  })
})
