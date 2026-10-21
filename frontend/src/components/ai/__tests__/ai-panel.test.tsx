// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import type { Settings } from '@/lib/types'
import { useStudio } from '@/store'
import type { AiStatus } from '@/types/ai'
import type { AgentJob, Proposal, StepEvent } from '@/types/agent'
import { SCENARIOS } from '@/types/agent'
import { AiPanel } from '../AiPanel'
import { splitCritic } from '../CriticPreview'
import { claimTreePack, focusParaNo, proposalSummary, termsPack } from '../aiModel'
import { mergeStepEvents, normalizeStepEvent } from '@/store/agent'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/** 可手动推帧的 EventSource 替身（store/agent.ts 的 SSE 订阅只用 onmessage / onerror / close） */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  close() {
    this.closed = true
  }
}

let root: Root | null = null
let host: HTMLElement
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource
})

const SETTINGS: Settings = { abstract_figure: null, spec_figures: [], sub_except: [], abstract_limit: 300, style: {}, ai_enabled: true }
const STATUS: AiStatus = { provider: 'mock', key_present: true, models: { interactive: 'swe-2-medium', heavy: 'swe-2-max', fallback: 'swe-2-high' }, reachable: true, checked_at: 1, error: null }
const CONTENT = '# 案子\n\n## 摘要\n\n一种装置。\n\n## 权利要求书\n\n1. 一种装置，包括处理单元。\n\n## 说明书\n\n所述处理单元连接存储器。\n'

const JOB: AgentJob = {
  id: 'j-s2',
  kind: 'agent:s2',
  pid: 'method',
  status: 'running',
  progress: 0.3,
  message: '检查独权 1',
  result: null,
  error: null,
  created_at: 1,
  updated_at: 1,
  steps: [],
  queue_key: 'method:heavy',
}

const PROPOSAL: Proposal = {
  id: 'p1',
  job_id: 'j-s2',
  scenario: 's2',
  kind: 'critic',
  anchor: { book: 'claims', block_id: 'c1', line_start: 9, line_end: 9 },
  critic_markdown: '1. 一种装置，包括{~~处理单元~>处理器~~}。',
  comment_body: null,
  patch: null,
  checks: [{ name: 'critic_valid', ok: true, why: '' }],
  model: 'swe-2-max',
  usage: { prompt: 10, completion: 5 },
  created_at: 2,
  state: 'pending',
}

const err = (status: number, kind: string, message: string) => new ApiError(status, message, { kind, message, line: null, detail: null })

beforeEach(() => {
  desktop = true
  FakeEventSource.instances = []
  useStudio.setState({ pid: 'method', dialog: null, toasts: [], items: [], railTab: 'outline', outlineOpen: true, settings: SETTINGS, content: CONTENT, ast: null, project: null })
  useStudio.getState().resetAi()
  useStudio.setState({ agentTab: 'chat' })
  vi.spyOn(api, 'aiStatus').mockResolvedValue(STATUS)
  vi.spyOn(api, 'aiJobs').mockResolvedValue({ jobs: [] })
  vi.spyOn(api, 'aiUsage').mockResolvedValue({ rows: [], total: { prompt_tokens: 0, completion_tokens: 0, requests: 0 }, today_tokens: 0, budget: 0 })
  vi.spyOn(api, 'aiBudget').mockResolvedValue({ today_tokens: 50_000, budget: 200_000 })
  vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [] })
  vi.spyOn(api, 'proposals').mockResolvedValue({ proposals: [] })
  vi.spyOn(api, 'saveSettings').mockResolvedValue(undefined as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  useStudio.getState().resetAgent()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const qa = (sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
/** Radix Tabs 触发器在 mousedown 上切换 */
const press = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))
const goTab = (tab: 'chat' | 'scenarios' | 'proposals' | 'jobs') => act(async () => useStudio.getState().setAgentTab(tab))

describe('AiPanel 四 tab（W5 §6.6）', () => {
  it('四个 tab 触发器齐全，默认「对话」；切 tab 写入 store.agentTab；axe 0 critical/serious', async () => {
    const el = await mount(<AiPanel />)
    for (const t of ['chat', 'scenarios', 'proposals', 'jobs']) expect(q(`[data-testid="ai-tab-${t}"]`, el)).not.toBeNull()
    expect(q('[data-testid="ai-panel"]', el)!.getAttribute('data-tab')).toBe('chat')
    expect(q('[data-testid="ai-chat-input"]', el)).not.toBeNull()
    await press(q('[data-testid="ai-tab-scenarios"]', el)!)
    expect(useStudio.getState().agentTab).toBe('scenarios')
    expect(q('[data-testid="ai-scenarios"]', el)).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })

  it('批71：对话草稿卸载保命——输入一半切走/卸载后回来，草稿原样恢复（aiChatDraft 存 store）', async () => {
    vi.spyOn(api, 'aiChat').mockImplementation(() => new Promise(() => {}))
    let el = await mount(<AiPanel />)
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '半程草稿')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStudio.getState().aiChatDraft).toBe('半程草稿')
    /* 页签切换不卸载（forceMount）——输入仍在；宿主整体卸载再挂也经 store 恢复 */
    await goTab('jobs')
    expect(q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!.value).toBe('半程草稿')
    await act(async () => root?.unmount())
    host.remove()
    el = await mount(<AiPanel />)
    expect(q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!.value).toBe('半程草稿')
  })

  it('对话：附带上下文 术语 / 体检 / 权项树 勾选 → chat context 带 terms / diagnostics / claim_tree', async () => {
    useStudio.setState({
      items: [{ id: 'x', severity: 'warning', message: '缺少附图标记', line: 13, kind: 'lint', fix: undefined } as never],
      terms: [{ name: '处理单元', aliases: ['处理器'] }] as never,
    })
    const chat = vi.spyOn(api, 'aiChat').mockImplementation(() => new Promise(() => {}))
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-context-terms"]', el)).not.toBeNull()
    expect(q('[data-testid="ai-context-health"]', el)).not.toBeNull()
    expect(q('[data-testid="ai-context-claims"]', el)).not.toBeNull()
    expect((q('[data-testid="ai-context-claims"]', el) as HTMLButtonElement).disabled).toBe(true) // 无 AST → 权项树 0 条
    await click(q('[data-testid="ai-context-terms"]', el)!)
    await click(q('[data-testid="ai-context-health"]', el)!)
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '独权缺什么？')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-chat-send"]', el)!)
    await flush()
    expect(chat).toHaveBeenCalledTimes(1)
    const ctx = chat.mock.calls[0][2] as Record<string, unknown> | null
    expect(ctx?.terms).toEqual(['处理单元（处理器）'])
    expect(ctx?.diagnostics).toEqual(['L13 [warning] 缺少附图标记'])
    expect(ctx?.claim_tree).toBeUndefined()
  })

  it('termsPack / claimTreePack / focusParaNo：[00NN] → setFocus{source:ai, book:description, blockId}', () => {
    expect(termsPack([{ name: 'A', aliases: [] }, { name: 'B', aliases: ['b1', 'b2'] }])).toEqual(['A', 'B（b1 / b2）'])
    const ast = {
      books: { abstract: { offset: 0 }, claims: { offset: 0 }, description: { offset: 12 } },
      claims: [
        { num: 1, num_written: null, claim_kind: 'independent', category: 'product', refs: [] },
        { num: 2, num_written: null, claim_kind: 'dependent', category: null, refs: [{ targets: [1] }] },
      ],
      description: [{ id: 'd7', kind: 'paragraph', para_no: 7, lines: { start: 3, end: 3 } }],
    } as never
    expect(claimTreePack(ast)).toEqual(['权1 独立 · product', '权2 ← 1'])
    useStudio.setState({ ast })
    expect(focusParaNo(8)).toBe(false)
    expect(focusParaNo(7)).toBe(true)
    const f = useStudio.getState().focus
    expect(f).toMatchObject({ source: 'ai', book: 'description', blockId: 'd7', line: 15 })
  })

  it('场景：渲染 SCENARIOS 全卡（s8 已随 #339 复活为真检索）；「运行」→ api.agentRun 并切到「任务与历史」', async () => {
    const run = vi.spyOn(api, 'agentRun').mockResolvedValue(JOB)
    /* 批71 夹具契约更新：jobs 页签 forceMount 后 loadAgent 提前/随 enabled 翻转重拉，Once 链按调用序假定的
       「第二次才见 JOB」会在运行前误置 s2 进行中禁用；改 flag 驱动——真实语义即「登记表随 job 入册后可见」 */
    let ran = false
    run.mockImplementation(async () => (ran = true, JOB))
    vi.spyOn(api, 'agentJobs').mockImplementation(async () => ({ jobs: ran ? [JOB] : [] }))
    useStudio.setState({ project: { role: 'editor' } as never })
    const el = await mount(<AiPanel />)
    await goTab('scenarios')
    const cards = qa('[data-testid^="ai-scenario-"]', el).filter((n) => /^ai-scenario-s\d+$/.test(n.dataset.testid ?? ''))
    expect(cards).toHaveLength(SCENARIOS.length)
    expect(cards.map((c) => c.dataset.testid)).toEqual(SCENARIOS.map((s) => `ai-scenario-${s.id}`))
    await click(q('[data-testid="ai-run-s2"]', el)!)
    await flush()
    expect(run).toHaveBeenCalledWith('method', expect.objectContaining({ scenario: 's2' }))
    expect(useStudio.getState().agentTab).toBe('jobs')
    expect(useStudio.getState().agentJobs.map((j) => j.id)).toEqual(['j-s2'])
    expect(FakeEventSource.instances.map((e) => e.url)).toEqual([api.aiJobEventsUrl('j-s2')])
  })

  it('场景：501 → EmptyState「功能开发中」；403 ai_disabled_by_org → 「机构已禁用 AI」；案级关闭 → 开启入口', async () => {
    vi.spyOn(api, 'agentJobs').mockRejectedValue(err(501, 'not_implemented', 'agent-core-backend'))
    const el = await mount(<AiPanel />)
    await goTab('scenarios')
    await flush()
    const empty = q('[data-testid="ai-scenarios-unavailable"]', el)!
    expect(empty).not.toBeNull()
    expect(empty.textContent).toContain('功能开发中')
    expect(q('[data-testid="ai-run-s2"]', el)).toBeNull()

    await act(async () => root?.unmount())
    host.remove()
    useStudio.getState().resetAgent()
    vi.spyOn(api, 'agentJobs').mockRejectedValue(err(403, 'ai_disabled_by_org', '机构已禁用 AI'))
    const el2 = await mount(<AiPanel />)
    await goTab('scenarios')
    await flush()
    // W6：机构禁用 → 面板级 EmptyState（不再渲染四 tab）
    expect(q('[data-testid="ai-org-disabled"]', el2)!.textContent).toContain('机构已禁用 AI')
    expect(q('[data-testid="ai-tab-chat"]', el2)).toBeNull()

    await act(async () => root?.unmount())
    host.remove()
    useStudio.getState().resetAgent()
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [] })
    useStudio.setState({ settings: { ...SETTINGS, ai_enabled: false } })
    const el3 = await mount(<AiPanel />)
    await goTab('scenarios')
    await flush()
    expect(q('[data-testid="ai-scenarios-disabled-case"]', el3)).not.toBeNull()
    expect(q('[data-testid="ai-scenarios-enable"]', el3)).not.toBeNull()
  })

  it('R60-01：status 透出机构关态——org_ai_enabled=false 直接渲染禁用页（不等写路径 403）', async () => {
    vi.spyOn(api, 'aiStatus').mockResolvedValue({ ...STATUS, org_ai_enabled: false })
    useStudio.setState({ aiStatus: null }) // 前测试残留 status 会让挂载效应短路，先清
    const el = await mount(<AiPanel />)
    await flush()
    expect(q('[data-testid="ai-org-disabled"]', el)!.textContent).toContain('机构已禁用 AI')
    expect(q('[data-testid="ai-tab-chat"]', el)).toBeNull()
    expect(useStudio.getState().agentDisabledByOrg).toBe(true)
  })

  it('R60-02/批40：usage「本案用量」走后端 total 全量聚合——rows 截窗不再影响显示', async () => {
    vi.spyOn(api, 'aiUsage').mockResolvedValue({
      rows: [
        { ts: 1, pid: 'method', purpose: 'interactive', kind: 'chat', model: 'm', requested_model: 'm', fallback: false, stream: true, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, ms: 1, ok: true, error: null, job_id: null, user: null },
      ],
      total: { prompt_tokens: 40, completion_tokens: 60, requests: 3 },
      today_tokens: 100,
      budget: 0,
    })
    const el = await mount(<AiPanel />)
    await flush()
    await click(q('[data-testid="ai-details-toggle"]', el)!)
    expect(q('[data-testid="ai-usage"]', el)!.textContent).toContain('3 次 · 100 token')
  })

  it('建议：按 state 分组；预览按 CriticMarkup 渲染 del/ins；apply 调 api 并从待处理移到已写入；忽略 → 已忽略；定位 → setFocus{source:ai}', async () => {
    vi.spyOn(api, 'proposals').mockResolvedValue({ proposals: [PROPOSAL, { ...PROPOSAL, id: 'p2', kind: 'comment', critic_markdown: null, comment_body: '缺先行词', state: 'dismissed' }] })
    const apply = vi.spyOn(api, 'applyProposal').mockResolvedValue({ proposal: { ...PROPOSAL, state: 'applied' }, content: null, changed_lines: null, backup: null })
    const dismiss = vi.spyOn(api, 'dismissProposal').mockImplementation(async (_pid, id) => ({ ...PROPOSAL, id, state: 'dismissed' }))
    useStudio.setState({ project: { role: 'editor' } as never })
    const el = await mount(<AiPanel />)
    await goTab('proposals')
    await flush()
    expect(q('[data-testid="ai-proposals-pending"]', el)!.dataset.count).toBe('1')
    expect(q('[data-testid="ai-proposals-dismissed"]', el)!.dataset.count).toBe('1')
    const card = q('[data-testid="ai-proposal-p1"]', el)!
    expect(card.dataset.state).toBe('pending')
    const preview = q('[data-testid="ai-proposal-preview-p1"]', el)!
    expect(q('del', preview)!.textContent).toBe('处理单元')
    expect(q('ins', preview)!.textContent).toBe('处理器')
    expect(preview.textContent).not.toContain('{~~')

    await click(q('[data-testid="ai-proposal-locate-p1"]', el)!)
    expect(useStudio.getState().focus).toMatchObject({ source: 'ai', book: 'claims', blockId: 'c1', line: 9 })

    await click(q('[data-testid="ai-proposal-apply-p1"]', el)!)
    await flush()
    expect(apply).toHaveBeenCalledWith('method', 'p1')
    expect(q('[data-testid="ai-proposals-pending"]', el)!.dataset.count).toBe('0')
    expect(q('[data-testid="ai-proposals-applied"]', el)!.dataset.count).toBe('1')
    expect(q('[data-testid="ai-proposal-p1"]', el)).toBeNull() // 已写入分组默认折叠
    await click(q('#ai-proposals-applied-h', el)!)
    expect(q('[data-testid="ai-proposal-p1"]', el)!.dataset.state).toBe('applied')
    expect(q('[data-testid="ai-proposal-apply-p1"]', el)).toBeNull()

    // 第二条：已忽略分组里没有动作；重新构造一条待处理走忽略
    useStudio.setState({ proposals: [...useStudio.getState().proposals, { ...PROPOSAL, id: 'p3' }] })
    await flush()
    await click(q('[data-testid="ai-proposal-dismiss-p3"]', el)!)
    await flush()
    expect(dismiss).toHaveBeenCalledWith('method', 'p3')
    expect(q('[data-testid="ai-proposals-dismissed"]', el)!.dataset.count).toBe('2')
    await click(q('#ai-proposals-dismissed-h', el)!)
    expect(q('[data-testid="ai-proposal-p3"]', el)!.dataset.state).toBe('dismissed')
    expect(await violations(el)).toEqual([])
  })

  it('建议：viewer 写入 / 忽略禁用，定位可用', async () => {
    vi.spyOn(api, 'proposals').mockResolvedValue({ proposals: [PROPOSAL] })
    useStudio.setState({ project: { role: 'viewer' } as never })
    const el = await mount(<AiPanel />)
    await goTab('proposals')
    await flush()
    expect((q('[data-testid="ai-proposal-apply-p1"]', el) as HTMLButtonElement).disabled).toBe(true)
    expect((q('[data-testid="ai-proposal-dismiss-p1"]', el) as HTMLButtonElement).disabled).toBe(true)
    expect((q('[data-testid="ai-proposal-locate-p1"]', el) as HTMLButtonElement).disabled).toBe(false)
  })

  it('任务与历史：mock SSE plan→…→done 渲染 7 类事件；truncated → 「上下文已裁剪」；取消 → api.agentCancel；预算进度条', async () => {
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [JOB] })
    const cancel = vi.spyOn(api, 'agentCancel').mockImplementation(async (id) => ({ ...JOB, id, kind: 'agent:s5', status: 'interrupted' }))
    const el = await mount(<AiPanel />)
    await goTab('jobs')
    await flush()
    expect(q('[data-testid="ai-budget"]', el)).not.toBeNull()
    expect(q('[data-testid="ai-budget"] [role="progressbar"]', el)).not.toBeNull()
    expect(q('[data-testid="ai-budget"]', el)!.textContent).toMatch(/5\.0 万 \/ 20\.0 万/)
    expect(q('[data-testid="ai-job-j-s2"]', el)!.dataset.status).toBe('running')

    await click(q('[data-testid="ai-job-j-s2"]', el)!)
    await flush()
    expect(useStudio.getState().agentActiveJobId).toBe('j-s2')
    const es = FakeEventSource.instances.find((e) => e.url === api.aiJobEventsUrl('j-s2'))!
    expect(es).toBeDefined()

    const frames = [
      { seq: 1, ts: 1, kind: 'plan', data: { steps: ['读取权利要求', '逐独权检查'] } },
      { seq: 2, ts: 2, kind: 'tool_call', data: { name: 'read_book', args: { book: 'claims' } } },
      { seq: 3, ts: 3, kind: 'tool_result', data: { name: 'read_book', chars: 1200, ms: 12 } },
      { seq: 4, ts: 4, kind: 'gen_delta', data: { text: '权利要求 1 ' } },
      { seq: 5, ts: 5, kind: 'gen_delta', data: { text: '缺少先行词' } },
      { seq: 6, ts: 6, kind: 'check', data: { name: 'critic_valid', ok: true, why: '' } },
      { seq: 7, ts: 7, kind: 'proposal', data: { id: 'p1', kind: 'critic', anchor: PROPOSAL.anchor, preview: '处理单元 → 处理器' } },
      { seq: 8, ts: 8, kind: 'done', data: { proposals: ['p1'], usage: { prompt: 900, completion: 120 }, truncated: true } },
    ]
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [{ ...JOB, status: 'done', progress: 1 }] }) // done 帧后 loadAgent 拉到终态
    for (const f of frames) await act(async () => es.push(f))
    await flush()
    for (const k of ['plan', 'tool_call', 'tool_result', 'gen_delta', 'check', 'proposal', 'done']) {
      expect(q(`[data-testid="ai-event-${k}"]`, el), k).not.toBeNull()
    }
    expect(qa('[data-testid="ai-event-gen_delta"]', el)).toHaveLength(1) // 相邻 gen_delta 合并
    expect(q('[data-testid="ai-event-gen_delta"]', el)!.textContent).toContain('权利要求 1 缺少先行词')
    expect(q('[data-testid="ai-clipped"]', el)!.textContent).toContain('上下文已裁剪')
    expect(useStudio.getState().agentJobs[0].status).toBe('done')
    expect(es.closed).toBe(true)

    // 再来一条 running job 验证取消
    await act(async () => useStudio.getState().upsertAgentJob({ ...JOB, id: 'j-s5', kind: 'agent:s5' }))
    await flush()
    await click(q('[data-testid="ai-job-cancel-j-s5"]', el)!)
    await flush()
    expect(cancel).toHaveBeenCalledWith('j-s5')
    expect(useStudio.getState().agentJobs.find((j) => j.id === 'j-s5')?.status).toBe('interrupted')
    expect(await violations(el)).toEqual([])
  })

  it('任务与历史：viewer/低角色 live job 的取消钮 disabled 且不发请求（服务端 cancel 门槛 editor——R70-01 死端收口）', async () => {
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [JOB] })
    const cancel = vi.spyOn(api, 'agentCancel')
    useStudio.setState({ project: { role: 'viewer' } as never })
    const el = await mount(<AiPanel />)
    await goTab('jobs')
    await flush()
    const btn = q<HTMLButtonElement>('[data-testid="ai-job-cancel-j-s2"]', el)!
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)
    await click(btn)
    await flush()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('任务与历史：trackAgentJob 订阅非选中 live job（不改 activeId、回放 steps）；终态不订（R70-02）', async () => {
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [JOB, { ...JOB, id: 'j-x', kind: 'agent:s2', status: 'done' }] })
    await mount(<AiPanel />)
    await goTab('jobs')
    await flush()
    useStudio.getState().trackAgentJob('j-x')
    expect(FakeEventSource.instances.some((e) => e.url === api.aiJobEventsUrl('j-x'))).toBe(false)
    const before = useStudio.getState().agentActiveJobId
    useStudio.getState().trackAgentJob('j-s2')
    expect(useStudio.getState().agentActiveJobId).toBe(before)
    expect(FakeEventSource.instances.some((e) => e.url === api.aiJobEventsUrl('j-s2'))).toBe(true)
  })

  it('场景 s1：交底书文本经 params.text 发给后端（契约键对齐——R70-04）', async () => {
    const run = vi.spyOn(api, 'agentRun').mockResolvedValue(JOB)
    useStudio.setState({ project: { role: 'editor' } as never })
    const el = await mount(<AiPanel />)
    await goTab('scenarios')
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-param-s1-disclosure"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '一种处理单元的交底书正文')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-run-s1"]', el)!)
    await flush()
    expect(run).toHaveBeenCalledWith('method', expect.objectContaining({ scenario: 's1', params: expect.objectContaining({ text: '一种处理单元的交底书正文' }) }))
  })

  it('normalizeStepEvent / mergeStepEvents：seq 判重，相邻 gen_delta 合并，未知 kind 丢弃', () => {
    const a = normalizeStepEvent({ seq: 1, ts: 1, kind: 'gen_delta', data: { text: 'a' } })!
    const b = normalizeStepEvent({ seq: 2, ts: 2, kind: 'gen_delta', data: { text: 'b' } })!
    const dup = normalizeStepEvent({ seq: 2, ts: 2, kind: 'gen_delta', data: { text: 'b' } })!
    let list: StepEvent[] = []
    for (const ev of [a, b, dup]) list = mergeStepEvents(list, ev)
    expect(list).toHaveLength(1)
    expect(list[0].kind === 'gen_delta' && list[0].data.text).toBe('ab')
    expect(normalizeStepEvent({ seq: 3, kind: 'nope' })).toBeNull()
  })

  it('splitCritic / proposalSummary：五种 CriticMarkup 标记切段；摘要去标记', () => {
    const segs = splitCritic('甲{++乙++}{--丙--}{~~丁~>戊~~}{>>己<<}{==庚==}')
    expect(segs.map((s) => s.kind)).toEqual(['text', 'ins', 'del', 'sub', 'comment', 'mark'])
    expect(proposalSummary(PROPOSAL)).toBe('权项树批评 · 修订建议：1. 一种装置，包括处理单元处理器。')
  })

  it('移动端（<1024）：四 tab 走 Tabs size=md（面板头 44）、建议卡动作按钮 md 36 + touch-hit 命中 44（W8 视觉分档）；axe 0 critical/serious', async () => {
    desktop = false
    vi.spyOn(api, 'proposals').mockResolvedValue({ proposals: [PROPOSAL] })
    useStudio.setState({ project: { role: 'editor' } as never })
    const el = await mount(<AiPanel />)
    await goTab('proposals')
    await flush()
    const list = q('[data-slot="tabs-list"]', el) ?? q('[role="tablist"]', el)
    expect(list!.getAttribute('data-size')).toBe('md')
    expect(list!.className).not.toContain('h-touch')
    for (const t of ['chat', 'scenarios', 'proposals', 'jobs']) expect(q(`[data-testid="ai-tab-${t}"]`, el)).not.toBeNull()
    for (const a of ['apply', 'dismiss', 'locate']) {
      const cls = q(`[data-testid="ai-proposal-${a}-p1"]`, el)!.className
      expect(cls).toContain('h-md-control')
      expect(cls).toContain('touch-hit')
      expect(cls).not.toContain('h-touch')
    }
    expect(await violations(el)).toEqual([])
  })

  it('P04 概览条：范围/任务/待决定三段渲染 + 直达页签', async () => {
    vi.spyOn(api, 'proposals').mockResolvedValue({ proposals: [PROPOSAL] })
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [{ ...JOB, status: 'running' }, { ...JOB, id: 'j-i1', status: 'interrupted' }] as never })
    useStudio.setState({ aiChatAttachments: [{ name: '交底书.pdf', chars: 10 }] as never })
    const el = await mount(<AiPanel />)
    await flush()
    // 桌面顺序：范围 → 任务 → 待决定
    const cells = qa('[data-testid^="ai-overview-"]:not([data-testid$="-value"])', el).map((c) => c.dataset.testid)
    expect(cells).toEqual(['ai-overview-scope', 'ai-overview-tasks', 'ai-overview-pending'])
    expect(q('[data-testid="ai-overview-scope-value"]', el)!.textContent).toContain('摘要') // 默认书
    expect(q('[data-testid="ai-overview-scope-value"]', el)!.textContent).toContain('1材料')
    expect(q('[data-testid="ai-overview-tasks-value"]', el)!.textContent).toContain('1 进行中')
    expect(q('[data-testid="ai-overview-pending-value"]', el)!.textContent).toBe('1 项')
    await click(q('[data-testid="ai-overview-pending"]', el)!)
    expect(useStudio.getState().agentTab).toBe('proposals')
    await click(q('[data-testid="ai-overview-tasks"]', el)!)
    expect(useStudio.getState().agentTab).toBe('jobs') // 复核9：interrupted 续跑钮在任务页签
    await click(q('[data-testid="ai-overview-scope"]', el)!)
    expect(useStudio.getState().agentTab).toBe('chat')
  })

  it('复核9：待决确认卡计入「待我决定」→ 对话页签；中断任务计数归「任务」→ jobs', async () => {
    const ij = { ...JOB, id: 'j-i1', status: 'interrupted' }
    vi.spyOn(api, 'agentJobs').mockResolvedValue({ jobs: [ij] } as never)
    useStudio.setState({
      agentJobs: [ij] as never,
      chat: [{ id: 'm1', role: 'assistant', content: '', created_at: 1, confirm: { id: 'cf1', tool: 'patch_block', args: {}, danger: false, resume: { assistant: null, calls: [] } } }] as never,
    })
    const el = await mount(<AiPanel />)
    await flush()
    expect(q('[data-testid="ai-overview-pending-value"]', el)!.textContent).toBe('1 项')
    expect(q('[data-testid="ai-overview-tasks-value"]', el)!.textContent).toContain('1 待恢复')
    await click(q('[data-testid="ai-overview-pending"]', el)!)
    expect(useStudio.getState().agentTab).toBe('chat') // 确认卡在对话里裁决
    await click(q('[data-testid="ai-overview-tasks"]', el)!)
    expect(useStudio.getState().agentTab).toBe('jobs')
  })

  it('P07 移动首屏：待决定排最前，触控格 min-h-touch', async () => {
    desktop = false
    useStudio.setState({ chat: [{ id: 'm1', role: 'assistant', content: '', created_at: 1, confirm: { id: 'cf1', tool: 'propose_plan', args: {}, danger: false, resume: { assistant: null, calls: [] } } }] as never })
    const el = await mount(<AiPanel />)
    await flush()
    const cells = qa('[data-testid^="ai-overview-"]:not([data-testid$="-value"])', el).map((c) => c.dataset.testid)
    expect(cells[0]).toBe('ai-overview-pending')
    expect(cells[1]).toBe('ai-overview-tasks')
    expect(q('[data-testid="ai-overview-pending-value"]', el)!.textContent).toBe('1 项') // 确认卡计入待决定
    for (const c of cells) expect(q(`[data-testid="${c}"]`, el)!.className).toContain('min-h-touch')
  })

  it('P03 绑定阻塞：denied/ambiguous/机构策略关 → 禁用页原因如实，不再绿灯', async () => {
    const base = { pid: 'method', case_no: 'CN1', case_id: 'uuid-1', file_role: 'editor', auth: 'on', capabilities: [], binding_capabilities: { read: true, write: true, manage: false }, content_sha: 'ab', revision: 'r1', ai_enabled: true }
    for (const [binding, egress, want] of [
      ['denied', undefined, '没有访问权限'],
      ['ambiguous', { ai_egress: true }, '多个机构'],
      ['bound', { ai_egress: false }, '机构已撤销本案 AI 外发'],
    ] as const) {
      useStudio.setState({ caseContext: { ...base, binding, organization: { id: 'o1', name: 'X', status: 'active' }, egress_policy: egress } as never })
      const el = await mount(<AiPanel />)
      await flush()
      const blocked = q('[data-testid="ai-org-disabled"]', el)
      expect(blocked).not.toBeNull()
      expect(blocked!.textContent).toContain(want)
      expect(q('[data-testid="ai-tab-chat"]', el)).toBeNull()
      await act(async () => root?.unmount())
      root = null
    }
    // bound 且策略开 → 不阻塞
    useStudio.setState({ caseContext: { ...base, binding: 'bound', organization: { id: 'o1', name: 'X', status: 'active' }, egress_policy: { ai_egress: true } } as never })
    const el2 = await mount(<AiPanel />)
    await flush()
    expect(q('[data-testid="ai-org-disabled"]', el2)).toBeNull()
  })
})
