// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { TimelineEvent } from '@/types/timeline'
import type { Member } from '@/lib/types'
import { CaseTimelinePanel } from '../CaseTimelinePanel'
import { CaseTimelineDrawer } from '../CaseTimelineDrawer'
import { splitMentions, TIMELINE_KIND } from '../timelineKinds'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

const EVENTS: TimelineEvent[] = [
  { id: 'e1', kind: 'case.created', ts: 1_700_000_000, actor: { id: 'u1', display_name: '我' }, text: '创建案件', mentions: [], data: {} },
  { id: 'e2', kind: 'share.confirmed', ts: 1_700_000_100, actor: null, text: '客户已确认说明书', mentions: [], data: {} },
  { id: 'e3', kind: 'deliver.filed', ts: 1_700_000_200, actor: { id: 'u1', display_name: '我' }, text: '已递交 CNIPA', mentions: [], data: {} },
  { id: 'e4', kind: 'oa.round', ts: 1_700_000_300, actor: null, text: '第 1 次审查意见', mentions: [], data: { round: 1 } },
  { id: 'e5', kind: 'note', ts: 1_700_000_400, actor: { id: 'u2', display_name: '张三' }, text: '@李四 请复核权利要求 2', mentions: ['李四'], data: {} },
  { id: 'e6', kind: 'review.assigned', ts: 1_700_000_500, actor: { id: 'u2', display_name: '张三' }, text: '指派 李四 审阅', mentions: [], data: {} },
  { id: 'e7', kind: 'ai.proposal', ts: 1_700_000_600, actor: null, text: 'AI 提出 3 条建议', mentions: [], data: {} },
  { id: 'e8', kind: 'deadline.undone', ts: 1_700_000_700, actor: { id: 'u1', display_name: '我' }, text: '撤销期限完成', mentions: [], data: {} },
  { id: 'e9', kind: 'deadline.override', ts: 1_700_000_800, actor: { id: 'u1', display_name: '我' }, text: '期限改期 → 2026-11-01（证据补充需要）', mentions: [], data: {} },
]
const MEMBERS: Member[] = [
  { user_id: 'u1', email: 'me@x.com', display_name: '我', role: 'owner' },
  { user_id: 'u3', email: 'li@x.com', display_name: '李四', role: 'reviewer' },
]

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi(mode: 'ok' | '501' | '500' = 'ok') {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      if (mode === '501') return json({ detail: { kind: 'not_implemented', message: '功能开发中', detail: 'timeline' } }, 501)
      if (mode === '500') return json({ detail: 'boom' }, 500)
      if (url.endsWith('/notes')) {
        const body = (init?.body ? JSON.parse(String(init.body)) : {}) as { body: string }
        const ev: TimelineEvent = { id: 'n1', kind: 'note', ts: 1_700_001_000, actor: { id: 'u1', display_name: '我' }, text: body.body, mentions: ['李四'], data: {} }
        return json(ev)
      }
      return json({ items: EVENTS })
    }),
  )
  return calls
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q.includes('min-width') ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  desktop = true
  useStudio.setState({
    pid: 'p1', authStatus: 'authed', user: { id: 'u1', email: 'me@x.com', display_name: '我', is_superuser: false }, members: MEMBERS,
    loadMembers: async () => {}, project: null, projectLoading: false, timelineOpen: false, timelineNote: null,
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.unstubAllGlobals()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
function type(ta: HTMLTextAreaElement, v: string) {
  nativeValue.call(ta, v)
  ta.setSelectionRange(v.length, v.length)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}
const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)
const body = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

describe('timelineKinds', () => {
  it('13 类事件都有图标与标签（含 deadline.undone——R57-01 曾漏定义致 GET 500）；splitMentions 切出 @片段', () => {
    for (const ev of EVENTS) expect(TIMELINE_KIND[ev.kind].label).toBeTruthy()
    expect(Object.keys(TIMELINE_KIND)).toHaveLength(13)
    const segs = splitMentions('@李四 请复核，@王五 抄送', ['李四', '王五'])
    expect(segs.filter((s) => s.mention).map((s) => s.text)).toEqual(['@李四', '@王五'])
    expect(segs.map((s) => s.text).join('')).toBe('@李四 请复核，@王五 抄送')
    expect(splitMentions('无提及', [])).toEqual([{ text: '无提及', mention: false }])
  })
})

describe('CaseTimelinePanel（R-CASE-05 UI）', () => {
  it('加载 GET /timeline，合并事件（创建/确认/递交/OA/备注/指派/AI）按时间倒序，@ 提及高亮；axe 0 serious/critical', async () => {
    const calls = mockApi()
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(calls[0].url).toBe('/api/projects/p1/timeline')
    const items = [...host.querySelectorAll<HTMLElement>('[data-testid="timeline-event"]')]
    expect(items.map((i) => i.dataset.kind)).toEqual(['deadline.override', 'deadline.undone', 'ai.proposal', 'review.assigned', 'note', 'oa.round', 'deliver.filed', 'share.confirmed', 'case.created'])
    expect(q('[data-testid="timeline-mention"]')!.textContent).toBe('@李四')
    expect(await violations(host)).toEqual([])
  })

  it('「添加备注」→ @ 弹成员 → 提交 POST /notes {body}，新备注置顶', async () => {
    const calls = mockApi()
    await mount(<CaseTimelinePanel pid="p1" />)
    await act(async () => q<HTMLButtonElement>('[data-testid="timeline-add-note"]')!.click())
    const ta = q<HTMLTextAreaElement>('[data-testid="timeline-note-body"]')!
    expect(ta).not.toBeNull()
    await act(async () => type(ta, '请 @'))
    expect(q('[data-testid="mention-list"]')!.querySelectorAll('[data-testid^="mention-item-"]').length).toBe(2)
    await act(async () => type(ta, '请 @李'))
    await act(async () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(ta.value).toBe('请 @李四 ')
    await act(async () => type(ta, '请 @李四 复核'))
    await act(async () => q<HTMLButtonElement>('[data-testid="timeline-note-submit"]')!.click())
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/projects/p1/notes')
    expect(post.body).toEqual({ body: '请 @李四 复核' })
    const first = q<HTMLElement>('[data-testid="timeline-event"]')!
    expect(first.dataset.kind).toBe('note')
    expect(first.textContent).toContain('请 @李四 复核')
    expect(q('[data-testid="timeline-note-form"]')).toBeNull()
  })

  it('501 → EmptyState「功能开发中」；500 → 错误态可重试；空列表 → 空态', async () => {
    mockApi('501')
    await mount(<CaseTimelinePanel pid="p1" />)
    const empty = q('[data-testid="timeline-unavailable"]')!
    expect(empty.getAttribute('data-slot')).toBe('empty-state')
    expect(empty.textContent).toContain('功能开发中')
    await act(async () => root?.unmount())
    host.remove()
    vi.unstubAllGlobals()

    mockApi('500')
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q('[data-testid="timeline-error"]')!.textContent).toContain('boom')
    await act(async () => root?.unmount())
    host.remove()
    vi.unstubAllGlobals()

    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })))
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q('[data-testid="timeline-empty"]')).not.toBeNull()
    expect(q('[data-testid="timeline-add-note"]')).not.toBeNull()
  })

  it('未登录不显示「添加备注」', async () => {
    mockApi()
    useStudio.setState({ authStatus: 'off', user: null })
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q('[data-testid="timeline-add-note"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid="timeline-event"]').length).toBe(EVENTS.length)
  })

  it('批71：备注草稿卸载保命——输入一半卸载重挂面板，撰写态与文本原样恢复', async () => {
    mockApi()
    await mount(<CaseTimelinePanel pid="p1" />)
    await act(async () => q<HTMLButtonElement>('[data-testid="timeline-add-note"]')!.click())
    await act(async () => type(q<HTMLTextAreaElement>('[data-testid="timeline-note-body"]')!, '半程草稿'))
    await act(async () => root?.unmount())
    host.remove()
    /* 宿主（Drawer/伴随栏）重挂面板：store 草稿接管，表单自动回到撰写态 */
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q<HTMLTextAreaElement>('[data-testid="timeline-note-body"]')!.value).toBe('半程草稿')
  })

  it('R57-02：viewer 不渲「添加备注」死端钮（服务端 POST /notes 门槛 reviewer+），reviewer 照旧', async () => {
    mockApi()
    useStudio.setState({ project: { id: 'p1', role: 'viewer' } as never })
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q('[data-testid="timeline-add-note"]')).toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    useStudio.setState({ project: { id: 'p1', role: 'reviewer' } as never })
    await mount(<CaseTimelinePanel pid="p1" />)
    expect(q('[data-testid="timeline-add-note"]')).not.toBeNull()
  })
})

describe('CaseTimelineDrawer（Rail 槽位）', () => {
  it('桌面：Rail 按钮打开右侧 320 Drawer；375：全屏 Sheet，事件行 44px', async () => {
    mockApi()
    await mount(<CaseTimelineDrawer />)
    const btn = q<HTMLButtonElement>('[data-testid="rail-timeline"]')!
    expect(btn).not.toBeNull()
    await act(async () => btn.click())
    const drawer = body('[data-testid="timeline-drawer"]')!
    expect(drawer).not.toBeNull()
    expect(drawer.className).toContain('w-drawer')
    expect(drawer.querySelectorAll('[data-testid="timeline-event"]').length).toBe(EVENTS.length)
    expect(await violations(document.body)).toEqual([])
    await act(async () => root?.unmount())
    host.remove()

    desktop = false
    await mount(<CaseTimelineDrawer />)
    // R57-03：移动端无 Rail 钮（入口在 MoreSheet「案件时间线」行）——同一 timelineOpen 开关开全屏 Sheet
    expect(q('[data-testid="rail-timeline"]')).toBeNull()
    await act(async () => useStudio.getState().toggleTimeline(true))
    const sheet = body('[data-testid="timeline-drawer"]')!
    expect(sheet.className).not.toContain('w-drawer')
    // R58-01：portal 脱出 MobileShell density 祖先，Sheet 须自带 data-density=touch 让 touch-hit 生效
    expect(sheet.getAttribute('data-density')).toBe('touch')
    expect(sheet.querySelector('[data-testid="timeline-event"]')!.className).toContain('min-h-row-mobile')
  })
})
