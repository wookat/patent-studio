// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { Settings } from '@/lib/types'
import { useStudio } from '@/store'
import type { AiStatus } from '@/types/ai'
import { AiPanel } from '../AiPanel'
import { SelectionActionBar, type EditorSelectionInfo } from '../SelectionActionBar'
import { AiJobList } from '../AiJobs'
import { aiPanelDefinition, termsPanelDefinition, trackEPanels } from '../index'
import { applySuggestion, bookAtLine, replaceLines, runRewrite, streamChat, stopStreaming } from '../aiModel'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
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
})

const SETTINGS: Settings = { abstract_figure: null, spec_figures: [], sub_except: [], abstract_limit: 300, style: {} }
const STATUS: AiStatus = { provider: 'mock', key_present: true, models: { interactive: 'swe-2-medium', heavy: 'swe-2-max', fallback: 'swe-2-high' }, reachable: true, checked_at: 1, error: null }
const CONTENT = '# 案子\n\n## 摘要\n\n一种装置。\n\n## 权利要求书\n\n1. 一种装置，包括处理单元。\n\n## 说明书\n\n所述处理单元连接存储器。\n'

beforeEach(() => {
  desktop = true
  localStorage.clear()
  useStudio.setState({ pid: 'method', dialog: null, toasts: [], items: [], railTab: 'outline', outlineOpen: true, settings: SETTINGS, content: CONTENT, ast: null })
  useStudio.getState().resetAi()
  vi.spyOn(api, 'aiStatus').mockResolvedValue(STATUS)
  vi.spyOn(api, 'aiJobs').mockResolvedValue({ jobs: [] })
  vi.spyOn(api, 'aiUsage').mockResolvedValue({ rows: [], total: { prompt_tokens: 0, completion_tokens: 0, requests: 0 }, today_tokens: 0, budget: 0 })
  vi.spyOn(api, 'saveSettings').mockResolvedValue(undefined as never)
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
const enable = () => useStudio.setState({ settings: { ...SETTINGS, ai_enabled: true } })

const enc = new TextEncoder()
/** 可手动推送的 SSE Response（模拟 mock 供应商逐块输出） */
function sseResponse() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) })
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
  }
}
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

describe('AI 对话状态机（streamChat：idle → streaming → idle | error；09 §3.1）', () => {
  it('ai_enabled=false：不发请求、不入列', async () => {
    const spy = vi.spyOn(api, 'aiChat')
    await streamChat('你好', null)
    expect(spy).not.toHaveBeenCalled()
    expect(useStudio.getState().chat).toEqual([])
    expect(useStudio.getState().chatStreaming).toBe(false)
  })

  it('qa-01：开关刚打开（PUT settings 仍在 600ms 防抖中）就发送 ⇒ 先落盘再 POST /ai/chat，首次即成功而非后端 403', async () => {
    const order: string[] = []
    let resolvePut!: () => void
    vi.spyOn(api, 'saveSettings').mockImplementation(() => {
      order.push('put')
      return new Promise<void>((r) => (resolvePut = () => { order.push('put-done'); r() })) as never
    })
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockImplementation(async () => {
      order.push('chat')
      return s.response
    })
    useStudio.getState().setAiEnabled(true)
    expect(useStudio.getState().settings?.ai_enabled).toBe(true)
    expect(order).toEqual([])
    const p = streamChat('首次发送', null)
    await flush()
    expect(order).toEqual(['put'])
    expect(useStudio.getState().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    resolvePut()
    await flush()
    expect(order).toEqual(['put', 'put-done', 'chat'])
    s.push('data: {"delta":"好"}\n\n')
    s.push('data: {"done":true,"model":"m"}\n\n')
    s.close()
    await p
    const st = useStudio.getState()
    expect(st.chat[1].error).toBeUndefined()
    expect(st.chat[1].content).toBe('好')
    expect(api.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('delta 逐块追加到最后一条 assistant；done 收尾并记录 model/usage', async () => {
    enable()
    const s = sseResponse()
    const spy = vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const p = streamChat('润色一下', { book: 'claims' })
    await flush()
    let st = useStudio.getState()
    expect(st.chatStreaming).toBe(true)
    expect(st.chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(st.chat[1].streaming).toBe(true)
    s.push('data: {"delta":"所述"}\n\n')
    await flush()
    expect(useStudio.getState().chat[1].content).toBe('所述')
    s.push('data: {"delta":"装置"}\n\ndata: {"done":true,"model":"swe-2-medium","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"fallback":false}\n\n')
    s.close()
    await p
    st = useStudio.getState()
    expect(st.chat[1].content).toBe('所述装置')
    expect(st.chat[1].streaming).toBe(false)
    expect(st.chatStreaming).toBe(false)
    expect(st.chatError).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    const [pid, history, ctx] = spy.mock.calls[0]
    expect(pid).toBe('method')
    expect(history).toEqual([{ role: 'user', content: '润色一下' }])
    expect(ctx).toEqual({ book: 'claims' })
  })

  it('流中 error 事件 → assistant.error + chatError；stop 中断保留已收到内容且不报错', async () => {
    enable()
    const s1 = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValueOnce(s1.response)
    const p1 = streamChat('a', null)
    await flush()
    s1.push('data: {"delta":"半"}\n\ndata: {"error":{"kind":"upstream","message":"上游 502"}}\n\n')
    s1.close()
    await p1
    let st = useStudio.getState()
    expect(st.chat[1].content).toBe('半')
    expect(st.chat[1].error).toBe('上游 502')
    expect(st.chatError).toBe('上游 502')
    expect(st.chatStreaming).toBe(false)

    const s2 = sseResponse()
    vi.spyOn(api, 'aiChat').mockImplementationOnce((_pid, _h, _c, signal) => {
      signal?.addEventListener('abort', () => s2.close())
      return Promise.resolve(s2.response)
    })
    const p2 = streamChat('b', null)
    await flush()
    s2.push('data: {"delta":"部分"}\n\n')
    await flush()
    stopStreaming()
    await p2
    st = useStudio.getState()
    const last = st.chat.at(-1)!
    expect(last.content).toBe('部分')
    expect(last.streaming).toBe(false)
    expect(last.error).toBeUndefined()
    expect(st.chatStreaming).toBe(false)
    expect(st.chatError).toBeNull()
  })

  it('历史里带错误的消息不进入下一轮 messages', async () => {
    enable()
    useStudio.setState({
      chat: [
        { id: 'u1', role: 'user', content: 'x', created_at: 1 },
        { id: 'a1', role: 'assistant', content: '', error: 'boom', created_at: 2 },
      ],
    })
    const s = sseResponse()
    const spy = vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const p = streamChat('y', null)
    await flush()
    s.push('data: {"done":true}\n\n')
    s.close()
    await p
    expect(spy.mock.calls[0][1]).toEqual([
      { role: 'user', content: 'x' },
      { role: 'user', content: 'y' },
    ])
  })
})

describe('aiModel：book 判定 / 行替换 / 建议写入', () => {
  it('bookAtLine 无 AST 时按二级标题折算', () => {
    expect(bookAtLine(null, CONTENT, 5)).toBe('abstract')
    expect(bookAtLine(null, CONTENT, 9)).toBe('claims')
    expect(bookAtLine(null, CONTENT, 13)).toBe('description')
  })
  it('replaceLines 覆盖闭区间、保留其余行', () => {
    expect(replaceLines('a\nb\nc\nd', 2, 3, 'X\nY')).toBe('a\nX\nY\nd')
    expect(replaceLines('a\nb', 1, 1, '{~~a~>A~~}')).toBe('{~~a~>A~~}\nb')
  })
  it('applySuggestion 把 CriticMarkup 写到 content 对应行并移出建议列表（不静默改写）', () => {
    const sug = { id: 's1', source: 'rewrite' as const, book: 'claims', line_start: 9, line_end: 9, critic_markdown: '1. 一种装置，包括{~~处理单元~>处理器~~}。', created_at: 1 }
    useStudio.setState({ suggestions: [sug] })
    applySuggestion(sug)
    const st = useStudio.getState()
    expect(st.content.split('\n')[8]).toBe('1. 一种装置，包括{~~处理单元~>处理器~~}。')
    expect(st.content.split('\n')).toHaveLength(CONTENT.split('\n').length)
    expect(st.suggestions).toEqual([])
  })
  it('跨轨道：applySuggestion 写入的 CriticMarkup 经 /critic 进 marks，审阅面板 acceptMark / rejectMark 落到正文', async () => {
    const sug = { id: 's1', source: 'rewrite' as const, book: 'claims', line_start: 9, line_end: 9, critic_markdown: '1. 一种装置，包括{~~处理单元~>处理器~~}。', created_at: 1 }
    useStudio.setState({ suggestions: [sug], project: { id: 'method', title: 't' } as never, marks: [], marksUnavailable: false })
    const critic = vi.spyOn(api, 'critic').mockImplementation(async (_pid, body) => {
      const line = (body?.content ?? '').split('\n')[8]
      const from = line.indexOf('{~~')
      const to = line.indexOf('~~}') + 3
      return { marks: from < 0 ? [] : [{ id: 'm1', kind: 'sub' as const, line: 9, from, to, a: '处理单元', b: '处理器', final: '处理器', original: '处理单元' }] }
    })
    applySuggestion(sug)
    await act(async () => { await useStudio.getState().loadMarks('method') })
    expect(critic).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().marks.map((m) => m.id)).toEqual(['m1'])
    useStudio.getState().acceptMark('m1')
    expect(useStudio.getState().content.split('\n')[8]).toBe('1. 一种装置，包括处理器。')
    expect(useStudio.getState().marks).toEqual([])

    useStudio.setState({ content: CONTENT, suggestions: [sug] })
    applySuggestion(sug)
    await act(async () => { await useStudio.getState().loadMarks('method') })
    useStudio.getState().rejectMark('m1')
    expect(useStudio.getState().content.split('\n')[8]).toBe('1. 一种装置，包括处理单元。')
  })
  it('runRewrite：关闭态不调 rewrite；开启后按 book/行区间调用；explain 进对话不留建议', async () => {
    const spy = vi.spyOn(api, 'aiRewrite').mockResolvedValue({ critic_markdown: '所述{++处理++}单元', changed_lines: [13], line_start: 13, line_end: 13, model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, fallback: false })
    expect(await runRewrite('polish', { lineStart: 13, lineEnd: 13 })).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    enable()
    expect(await runRewrite('polish', { lineStart: 13, lineEnd: 13 })).toBe(true)
    expect(spy.mock.calls[0][1]).toMatchObject({ action: 'polish', book: 'description', line_start: 13, line_end: 13 })
    expect(useStudio.getState().suggestions).toHaveLength(1)
    spy.mockResolvedValueOnce({ critic_markdown: '', explanation: '这是解释', changed_lines: [], model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } as never)
    expect(await runRewrite('explain', { lineStart: 9, lineEnd: 9 })).toBe(true)
    expect(useStudio.getState().suggestions).toHaveLength(1)
    expect(useStudio.getState().chat.at(-1)?.content).toContain('这是解释')
  })
})

describe('AiPanel（Rail「AI」/ NavDrawer 共用；09 §6.1）', () => {
  it('关闭态：明示开关关、说明 + 开启入口、动作禁用、零 AI 请求；axe 0 critical/serious', async () => {
    const chat = vi.spyOn(api, 'aiChat')
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-panel"]', el)!.getAttribute('data-enabled')).toBe('false')
    expect(q('[data-testid="ai-enabled-switch"]', el)!.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-testid="ai-disabled-notice"]', el)!.textContent).toContain('未允许外发')
    // W6：供应商 / 模型等运维信息折叠在「详情」里，默认不占版面
    expect(q('[data-testid="ai-provider"]', el)).toBeNull()
    await click(q('[data-testid="ai-details-toggle"]', el)!)
    expect(q('[data-testid="ai-provider"]', el)!.textContent).toContain('mock')
    expect(q('[data-testid="ai-models"]', el)!.textContent).toContain('swe-2-medium')
    for (const a of ['polish', 'formalize', 'expand', 'explain']) expect((q(`[data-testid="ai-quick-${a}"]`, el) as HTMLButtonElement).disabled).toBe(true)
    expect((q('[data-testid="ai-review-button"]', el) as HTMLButtonElement).disabled).toBe(true)
    expect((q('[data-testid="ai-chat-send"]', el) as HTMLButtonElement).disabled).toBe(true)
    expect(api.aiJobs).not.toHaveBeenCalled()
    expect(api.aiUsage).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    expect(await violations(el)).toEqual([])
    // 开启入口 → saveSettings（乐观更新 settings.ai_enabled）
    await click(q('[data-testid="ai-enable-button"]', el)!)
    expect(useStudio.getState().settings?.ai_enabled).toBe(true)
    expect(q('[data-testid="ai-panel"]', el)!.getAttribute('data-enabled')).toBe('true')
    expect(q('[data-testid="ai-disabled-notice"]', el)).toBeNull()
  })

  it('开启态：上下文芯片、发送 → 流式渲染（role=status → aria-live）、停止/清空；axe 0 critical/serious', async () => {
    enable()
    useStudio.setState({ cursor: { line: 9, col: 1 } as never, items: [{ id: 'x', severity: 'warning', message: '缺少附图标记', line: 13, kind: 'lint', fix: undefined } as never] })
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-chip-book"]', el)!.textContent).toContain('权利要求书')
    expect(q('[data-testid="ai-context-health-label"]', el)!.textContent).toContain('1')
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '请解释权利要求 1')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-chat-send"]', el)!)
    await flush()
    expect(q('[data-testid="ai-streaming-status"]', el)).not.toBeNull()
    expect(q('[data-testid="ai-streaming-status"]', el)!.getAttribute('role')).toBe('status')
    expect(q('[data-testid="ai-chat-stop"]', el)).not.toBeNull()
    await act(async () => s.push('data: {"delta":"权利要求 1 保护"}\n\n'))
    await flush()
    expect(q('[data-testid="ai-msg-assistant"]', el)!.textContent).toContain('权利要求 1 保护')
    await act(async () => {
      s.push('data: {"done":true,"model":"swe-2-medium","fallback":false}\n\n')
      s.close()
    })
    await flush()
    expect(q('[data-testid="ai-streaming-status"]', el)).toBeNull()
    expect(q('[data-testid="ai-chat-live"]', el)!.getAttribute('aria-live')).toBe('polite')
    expect(qa('[data-testid="ai-msg-user"]', el)).toHaveLength(1)
    // qa-06：回复「详情」触发器 375 曾只有 38 宽（高由 --h-xs 升到 44）；touch 密度下补 min-w-touch
    const meta = q('[data-testid="ai-chat-meta-toggle"]', el)!
    expect(meta.className).toContain('h-xs-control')
    expect(meta.className).toContain('in-data-[density=touch]:min-w-touch')
    expect(await violations(el)).toEqual([])
    await click(q('[data-testid="ai-chat-clear"]', el)!)
    expect(useStudio.getState().chat).toEqual([])
  })

  it('qa-01（375）：按下发送 / 停止 / 清空时 pointerdown 被 preventDefault，textarea 不失焦 ⇒ MobileTabs 不会在 tap 中途回来顶开按钮', async () => {
    desktop = false
    enable()
    const el = await mount(<AiPanel />)
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => ta.focus())
    expect(document.activeElement).toBe(ta)
    for (const id of ['ai-chat-send', 'ai-chat-clear']) {
      const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })
      await act(async () => q(`[data-testid="${id}"]`, el)!.dispatchEvent(ev))
      expect(ev.defaultPrevented, id).toBe(true)
    }
    expect(document.activeElement).toBe(ta)
  })

  it('AI 审阅按钮：startReview → 任务卡 role=progressbar；停止跟踪；去审阅切 railTab', async () => {
    enable()
    const job = { id: 'j1', kind: 'review' as const, pid: 'method', status: 'running' as const, progress: 0.4, message: '第 2/5 项', result: null, error: null, created_at: 1, updated_at: 1 }
    vi.spyOn(api, 'aiReview').mockResolvedValue(job)
    vi.spyOn(api, 'aiJob').mockResolvedValue(job)
    const el = await mount(<AiPanel />)
    await click(q('[data-testid="ai-review-button"]', el)!)
    const bar = q('[data-testid="ai-job"] [role="progressbar"]', el)!
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(q('[data-testid="ai-job-message"]', el)!.textContent).toContain('第 2/5 项')
    await click(q('[data-testid="ai-job-cancel"]', el)!)
    expect(useStudio.getState().jobs[0].status).toBe('interrupted')
    await act(async () => useStudio.getState().upsertJob({ ...job, status: 'done', progress: 1, message: '完成' }))
    await click(q('[data-testid="ai-job-review"]', el)!)
    expect(useStudio.getState().railTab).toBe('review')
    expect(await violations(el)).toEqual([])
  })

  it('移动端（<1024）：面板与任务列表可渲染，axe 0 critical/serious', async () => {
    desktop = false
    enable()
    vi.spyOn(api, 'aiJobs').mockResolvedValue({ jobs: [{ id: 'j2', kind: 'review', pid: 'method', status: 'error', progress: 0.2, message: '', result: null, error: { kind: 'upstream', message: '超时' }, created_at: 1, updated_at: 1 }] })
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-job"]', el)!.textContent).toContain('超时')
    expect(await violations(el)).toEqual([])
  })

  it('导出面板定义供 dockview 注册', () => {
    expect(trackEPanels.map((p) => p.id)).toEqual(['ai', 'terms'])
    expect(aiPanelDefinition.component).toBe(AiPanel)
    expect(termsPanelDefinition.title).toBe('术语')
  })

  it('AiJobList 单独渲染：无任务时不渲染', async () => {
    const el = await mount(<AiJobList />)
    expect(q('[data-testid="ai-jobs"]', el)).toBeNull()
  })
})

const SEL: EditorSelectionInfo = { from: 60, to: 70, lineStart: 9, lineEnd: 9, text: '包括处理单元', rect: { top: 120, left: 40, bottom: 140 } }

function Harness({ selection }: { selection: EditorSelectionInfo | null }) {
  return (
    <div data-testid="editor-slot-host" className="relative" style={{ width: 800 }} ref={(el) => void el}>
      <div className="cm-content" tabIndex={0} />
      <SelectionActionBar selection={selection} container={host} />
    </div>
  )
}

describe('SelectionActionBar（09 §6.2；toolbar a11y）', () => {
  it('无选区不渲染；有选区 → role=toolbar 4 动作，按 rect 定位在选区上方', async () => {
    enable()
    const el = await mount(<Harness selection={null} />)
    expect(q('[data-testid="selection-action-bar"]', el)).toBeNull()
    await act(async () => root!.render(<TooltipProvider><Harness selection={SEL} /></TooltipProvider>))
    const bar = q('[data-testid="selection-action-bar"]', el)!
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('选区 AI 动作')
    expect(bar.getAttribute('data-lines')).toBe('9-9')
    expect(qa('button', bar).map((b) => b.dataset.testid)).toEqual(['selection-action-polish', 'selection-action-formalize', 'selection-action-expand', 'selection-action-explain'])
    expect(parseInt(bar.style.top)).toBeLessThan(120)
    expect(await violations(el)).toEqual([])
  })

  it('关闭态：显示说明与「去开启」，不含动作按钮，点击不发请求', async () => {
    const rw = vi.spyOn(api, 'aiRewrite')
    const el = await mount(<Harness selection={SEL} />)
    expect(q('[data-testid="selection-action-disabled"]', el)!.textContent).toContain('关闭')
    expect(q('[data-testid="selection-action-polish"]', el)).toBeNull()
    await click(q('[data-testid="selection-action-bar"] button', el)!)
    expect(useStudio.getState().companion).toBe('ai')
    expect(rw).not.toHaveBeenCalled()
  })

  it('←/→ 移焦、Esc 关闭并把焦点还给编辑器、Alt+A 重新打开', async () => {
    enable()
    const el = await mount(<Harness selection={SEL} />)
    const bar = q('[data-testid="selection-action-bar"]', el)!
    const btns = qa('button', bar)
    await act(async () => btns[0].focus())
    await act(async () => bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(q('[data-testid="selection-action-formalize"]', el))
    await act(async () => bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(document.activeElement).toBe(q('[data-testid="selection-action-polish"]', el))
    await act(async () => bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(q('[data-testid="selection-action-bar"]', el)).toBeNull()
    expect(document.activeElement).toBe(q('.cm-content', el))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', altKey: true })))
    expect(q('[data-testid="selection-action-bar"]', el)).not.toBeNull()
  })

  it('点「润色」→ rewrite(polish,{book:claims,line_start:9,line_end:9}) → CriticMarkup 写入 content → railTab=review', async () => {
    enable()
    const rw = vi.spyOn(api, 'aiRewrite').mockResolvedValue({ critic_markdown: '1. 一种装置，包括{~~处理单元~>处理器~~}。', changed_lines: [9], line_start: 9, line_end: 9, model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, fallback: false })
    const el = await mount(<Harness selection={SEL} />)
    await click(q('[data-testid="selection-action-polish"]', el)!)
    expect(rw.mock.calls[0][1]).toMatchObject({ action: 'polish', book: 'claims', line_start: 9, line_end: 9 })
    expect(useStudio.getState().content).toContain('{~~处理单元~>处理器~~}')
    expect(useStudio.getState().suggestions).toEqual([])
    expect(useStudio.getState().railTab).toBe('review')
    expect(q('[data-testid="selection-action-bar"]', el)).toBeNull()
  })

  it('移动端（<1024）：底部通栏、按钮 ≥44px 触控目标类', async () => {
    desktop = false
    enable()
    const el = await mount(<Harness selection={SEL} />)
    const bar = q('[data-testid="selection-action-bar"]', el)!
    expect(bar.style.bottom).toBe('0px')
    expect(bar.style.left).toBe('0px')
    expect(q('[data-testid="selection-action-polish"]', el)!.className).toMatch(/min-h-11|h-11/)
    expect(await violations(el)).toEqual([])
  })
})

  it('对话附件：上传解析→chip→随 context.attachments 发出→发送后保留为已授权材料；markdown 渲染净化', async () => {
    enable()
    vi.spyOn(api, 'aiChatAttach').mockResolvedValue({
      results: [
        { name: '交底书.docx', ok: true, text: '发明点：固态电解质', chars: 9 },
        { name: '图.png', ok: false, error: '当前模型不支持读图' },
      ],
    } as never)
    const s = sseResponse()
    const chatSpy = vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    // 上传：触发隐藏 file input change
    const fi = q<HTMLInputElement>('[data-testid="ai-attach-input"]', el)!
    const file = new File(['x'], '交底书.docx')
    await act(async () => {
      Object.defineProperty(fi, 'files', { value: [file], configurable: true })
      fi.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    // chip 出现（ok 的进 chips，拒的 toast）
    const chips = q('[data-testid="ai-attach-chips"]', el)!
    expect(chips.textContent).toContain('交底书.docx')
    expect(chips.textContent).toContain('9字')
    expect(useStudio.getState().aiChatAttachments).toHaveLength(1)
    // 发送
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '结合附件评估')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-chat-send"]', el)!)
    await flush()
    // context.attachments 已带文本发出 + 发送后 chip 保留为已授权材料 + user 消息带 meta
    const ctx = chatSpy.mock.calls[0][2] as { attachments?: { name: string; text: string }[] }
    expect(ctx?.attachments?.[0]).toEqual({ name: '交底书.docx', text: '发明点：固态电解质' })
    expect(useStudio.getState().aiChatAttachments).toHaveLength(1)
    expect(useStudio.getState().aiChatAttachments[0].sent).toBe(true)
    expect(chips.textContent).toContain('已授权')
    expect(useStudio.getState().sentScopeKeys).toContain('mat:交底书.docx')
    const um = useStudio.getState().chat.find((m) => m.role === 'user')!
    expect(um.attachments?.[0]?.name).toBe('交底书.docx')
    expect(q('[data-testid="ai-msg-attach"]', el)!.textContent).toContain('交底书.docx')
    // assistant markdown：**bold** → <strong>、<script> 净化、## 标题、[0001] 段号仍可点
    await act(async () => {
      s.push('data: {"delta":"## 前景\\n**有利**：见[0001]<script>alert(1)</script>"}\n\n')
      s.push('data: {"done":true,"model":"swe-2-medium"}\n\n')
      s.close()
    })
    await flush()
    const am = q('[data-testid="ai-msg-assistant"]', el)!
    expect(am.querySelector('strong')?.textContent).toBe('有利')
    expect(am.querySelector('h2')?.textContent).toBe('前景')
    expect(am.querySelector('script')).toBeNull()
    expect(am.textContent).not.toContain('<script>')
    expect(q('[data-testid="ai-para-ref-0001"]', el)).not.toBeNull()
  })

  it('撤销已发送材料授权 → 清对话+收窄提示；授权键含材料名/书身份', async () => {
    enable()
    vi.spyOn(api, 'aiChatAttach').mockResolvedValue({
      results: [{ name: '现有技术.txt', ok: true, text: 'm', chars: 1 }],
    } as never)
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    const fi = q<HTMLInputElement>('[data-testid="ai-attach-input"]', el)!
    await act(async () => {
      Object.defineProperty(fi, 'files', { value: [new File(['x'], '现有技术.txt')], configurable: true })
      fi.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '看材料')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-chat-send"]', el)!)
    await flush()
    expect(useStudio.getState().sentScopeKeys).toContain('mat:现有技术.txt')
    expect(useStudio.getState().chat.length).toBeGreaterThan(0)
    /* 用户明确移除已授权材料 → 授权键收窄 → 清历史 + 提示 */
    await click(q('[data-testid="ai-attach-rm-现有技术.txt"]', el)!)
    await flush()
    expect(useStudio.getState().chat).toEqual([])
    expect(q('[data-testid="ai-scope-note"]', el)!.textContent).toContain('已缩小')
    el.remove()
  })

  it('当前书 chip 撤销跨重挂保持（store 态，不随组件重建复活）', async () => {
    enable()
    const el = await mount(<AiPanel />)
    await click(q('[data-testid="ai-chip-book"]', el)!)
    await flush()
    expect(useStudio.getState().aiUseBook).toBe(false)
    el.remove()
    const el2 = await mount(<AiPanel />)
    await flush()
    /* 重挂不恢复——book chip 仍 off，scope 降级为选区/无授权，不含整书 book 授权 */
    expect(useStudio.getState().aiUseBook).toBe(false)
    expect(q<HTMLElement>('[data-testid="ai-chip-book"]', el2)!.getAttribute('aria-pressed')).toBe('false')
    const src = useStudio.getState().aiScope?.source
    expect(src === undefined || Array.isArray(src.lines)).toBe(true)
    el2.remove()
  })

  it('md 精修：代码高亮 / KaTeX 数学式 / GFM 勾选框', async () => {
    enable()
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    const ta = q<HTMLTextAreaElement>('[data-testid="ai-chat-input"]', el)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '给出示例')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(q('[data-testid="ai-chat-send"]', el)!)
    await flush()
    await act(async () => {
      const md = ['```python', 'def f(x):', '    return x+1', '```',
                  '效率 $\\eta=0.9$ 与 $$\\sum_i w_i=1$$',
                  '- [x] 已查新', '- [ ] 待代理人复核'].join('\n')
      s.push('data: ' + JSON.stringify({ delta: md }) + '\n\n')
      s.push('data: {"done":true,"model":"swe-2-medium"}\n\n')
      s.close()
    })
    await flush()
    const am = q('[data-testid="ai-msg-assistant"]', el)!
    // hljs：class + 至少一个 token span
    const code = am.querySelector('pre code.hljs')
    expect(code).not.toBeNull()
    expect(code!.className).toContain('language-python')
    expect(code!.querySelector('.hljs-keyword')).not.toBeNull()
    // KaTeX：行内 + display 各一，且 style 属性存活（KaTeX 依赖 inline style 定位）
    expect(am.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
    expect(am.querySelector('.katex-display')).not.toBeNull()
    expect(am.querySelector('.katex [style]')).not.toBeNull()
    // GFM checkbox：disabled + type=checkbox（别种 input 不得存活）
    const boxes = am.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    for (const b of boxes) expect((b as HTMLInputElement).disabled).toBe(true)
    expect(am.querySelector('input[type="text"], input[type="password"], input:not([type])')).toBeNull()
  })

describe('agent 工具循环（批2：step 小票 + confirm 卡 + resume 续跑）', () => {
  const RESUME = { assistant: { role: 'assistant', tool_calls: [{ id: 't1' }] }, calls: [{ id: 't1' }] }

  it('step 事件按 id upsert；confirm 事件落卡停流（无 done 也收 streaming）', async () => {
    enable()
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    const p = streamChat('查一下', null)
    await flush()
    await act(async () => {
      s.push('data: {"step":{"id":"s1","name":"get_ast","status":"running","summary":""}}\n\n')
      s.push('data: {"step":{"id":"s1","name":"get_ast","status":"ok","summary":"AST 2 块"}}\n\n')
      s.push('data: {"confirm":{"id":"c1","tool":"patch_block","args":{"pid":"method","block_id":"abstract/p1"},"danger":false,"resume":' +
        JSON.stringify(RESUME) + '}}\n\n')
      s.close()
    })
    await p
    const m = useStudio.getState().chat[1]
    expect(m.streaming).toBe(false)
    expect(m.steps).toEqual([{ id: 's1', name: 'get_ast', status: 'ok', summary: 'AST 2 块' }])
    expect(m.confirm?.tool).toBe('patch_block')
    expect(qa('[data-testid="ai-step-ok"]', el)).toHaveLength(1)
    const card = q('[data-testid="ai-confirm"]', el)!
    expect(card.textContent).toContain('patch_block')
    expect(card.textContent).toContain('abstract/p1')
    expect(card.getAttribute('data-danger')).toBeNull()
    expect(q('[data-testid="ai-confirm-approve"]', card)!.textContent).toBe('执行')
  })

  it('批准 → answerConfirm 带 resume/approved 重发并续流同一消息；decline → approved=false', async () => {
    enable()
    const s1 = sseResponse()
    const s2 = sseResponse()
    const spy = vi.spyOn(api, 'aiChat').mockResolvedValueOnce(s1.response).mockResolvedValueOnce(s2.response)
    const el = await mount(<AiPanel />)
    const p = streamChat('改掉摘要', null)
    await flush()
    await act(async () => {
      s1.push('data: {"confirm":{"id":"c1","tool":"patch_block","args":{"pid":"method"},"danger":true,"resume":' +
        JSON.stringify(RESUME) + '}}\n\n')
      s1.close()
    })
    const card = q('[data-testid="ai-confirm"]', el)!
    expect(card.getAttribute('data-danger')).toBe('true')
    expect(card.textContent).toContain('危险操作')
    await click(q('[data-testid="ai-confirm-approve"]', card)!)
    await flush()
    // 第二次调用带 resume+approved
    const lastCall = spy.mock.calls[1]
    expect(lastCall[4]).toEqual({ resume: RESUME, approved: true })
    await act(async () => {
      s2.push('data: {"step":{"id":"s2","name":"patch_block","status":"ok","summary":"已写入建议"}}\n\n')
      s2.push('data: {"delta":"已挂提案。"}\n\n')
      s2.push('data: {"done":true,"model":"m","steps":1}\n\n')
      s2.close()
    })
    await flush()
    const m = useStudio.getState().chat[1]
    expect(m.content).toBe('已挂提案。')
    expect(m.confirm?.decision).toBe('approved')
    expect(m.meta?.steps).toBe(1)
    expect(q('[data-testid="ai-confirm-decision"]', el)!.textContent).toContain('已批准')
    await p
  })

  it('propose_plan 卡：plan_md 走 markdown 渲染 + 按钮文案「按计划执行」', async () => {
    enable()
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const el = await mount(<AiPanel />)
    const p = streamChat('做个计划', null)
    await flush()
    await act(async () => {
      s.push('data: {"confirm":{"id":"c9","tool":"propose_plan","args":{},"danger":false,"plan_md":"1. 读三书\\n2. 体检","resume":' +
        JSON.stringify(RESUME) + '}}\n\n')
      s.close()
    })
    const plan = q('[data-testid="ai-confirm-plan"]', el)!
    expect(plan.textContent).toContain('读三书')
    expect(plan.querySelector('ol,li')).not.toBeNull()
    expect(q('[data-testid="ai-confirm-approve"]', el)!.textContent).toBe('按计划执行')
    await p
  })

  it('P05：aiScope 随 /ai/chat 显式发出（chat 与 confirm-resume 同绑）；切案清空 scope', async () => {
    enable()
    // 附件 chip 决定 scope.materials（AiChat 快照效应覆盖手工 aiScope——断言派生态而非手工值）
    useStudio.setState({ aiChatAttachments: [{ name: '交底书.pdf', chars: 10 }] as never })
    const s1 = sseResponse()
    const s2 = sseResponse()
    const spy = vi.spyOn(api, 'aiChat').mockResolvedValueOnce(s1.response).mockResolvedValueOnce(s2.response)
    const el = await mount(<AiPanel />)
    await flush()  // 等快照效应落 aiScope
    const p = streamChat('查权1', null)
    await flush()
    await act(async () => {
      s1.push('data: {"confirm":{"id":"c1","tool":"patch_block","args":{},"danger":false,"resume":' + JSON.stringify(RESUME) + '}}\n\n')
      s1.close()
    })
    expect(spy.mock.calls[0][5]?.materials).toEqual(['交底书.pdf'])
    expect(spy.mock.calls[0][5]?.source).toBeTruthy()
    await click(q('[data-testid="ai-confirm-approve"]', el)!)
    await flush()
    expect(spy.mock.calls[1][5]?.materials).toEqual(['交底书.pdf'])
    await act(async () => s2.close())
    await p
    // 切案：pid 复位清 scope/已发键/提示（防跨案残留）
    useStudio.setState({ sentScopeKeys: ['book:claims'], chatScopeNote: 'x' })
    useStudio.getState().resetAi()
    const st = useStudio.getState()
    expect(st.aiScope).toBeNull()
    expect(st.sentScopeKeys).toEqual([])
    expect(st.chatScopeNote).toBeNull()
  })
})

describe('对话持久化（批3-A：ps:chat:<pid> 刷新不丢）', () => {
  it('流式完成即落盘；hydrateChat 恢复历史且 streaming 不落盘', async () => {
    enable()
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const p = streamChat('历史一条', null)
    await flush()
    s.push('data: {"delta":"旧话"}\n\n')
    s.push('data: {"done":true,"model":"m"}\n\n')
    s.close()
    await p
    const raw = localStorage.getItem('ps:chat:method')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw!) as { m: { role: string; content: string; streaming?: boolean }[]; k: string[] }
    expect(saved.m.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(saved.m[1].content).toBe('旧话')
    expect(saved.m.every((m) => m.streaming === undefined)).toBe(true)
    expect(Array.isArray(saved.k)).toBe(true)
    /* 模拟刷新重开：内存清空 → hydrate 恢复 */
    useStudio.setState({ chat: [] })
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(useStudio.getState().chat[1].content).toBe('旧话')
    /* chat 非空不覆写（防双写） */
    useStudio.setState({ chat: [{ id: 'x', role: 'user', content: '在聊', created_at: 1 }] })
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat[0].content).toBe('在聊')
    /* 他案键不串门 */
    expect(localStorage.getItem('ps:chat:other')).toBeNull()
  })

  it('clearChat 清空存储；腐坏 JSON 回落空；超 50 条截尾', async () => {
    enable()
    const s = sseResponse()
    vi.spyOn(api, 'aiChat').mockResolvedValue(s.response)
    const p = streamChat('一条', null)
    await flush()
    s.push('data: {"delta":"回"}\n\n')
    s.push('data: {"done":true}\n\n')
    s.close()
    await p
    expect(localStorage.getItem('ps:chat:method')).toBeTruthy()
    useStudio.getState().clearChat()
    expect(JSON.parse(localStorage.getItem('ps:chat:method')!)).toEqual({ m: [], k: [] })
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat).toEqual([])
    localStorage.setItem('ps:chat:method', '{腐坏')
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat).toEqual([])
    /* P05：无授权键的旧格式（裸数组）不可核验——不恢复历史 */
    const legacy = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: `第${i}条`, created_at: i }))
    localStorage.setItem('ps:chat:method', JSON.stringify(legacy))
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat).toEqual([])
    /* 新格式带授权键 → 恢复消息+键，交由收窄检测核验 */
    localStorage.setItem('ps:chat:method', JSON.stringify({ m: legacy.slice(0, 60), k: ['book:claims'] }))
    useStudio.getState().hydrateChat('method')
    expect(useStudio.getState().chat).toHaveLength(50)
    expect(useStudio.getState().chat[0].content).toBe('第10条')
    expect(useStudio.getState().sentScopeKeys).toEqual(['book:claims'])
  })
})

describe('VersionTag：绑定版本标识（P05 修正——savedSha 优先，跨案 context 不兜底）', () => {
  /* savedSha 由 store 订阅按 saved 实测异步重算——断言真 sha（sha256(CONTENT)=2e473673…），
     ctx 的 f411ba00… 充当「提案应用前的旧快照」 */
  const CTX = (pid: string, sha: string) => ({
    pid,
    case_no: null,
    binding: 'bound' as const,
    case_id: 'c1',
    organization: null,
    file_role: 'editor' as const,
    auth: 'off',
    capabilities: [],
    content_sha: sha,
    revision: null,
    ai_enabled: true,
  })

  it('缓存 context 旧 sha + 新 savedSha → 显示新（提案应用/保存后不再误导）', async () => {
    enable()
    useStudio.setState({
      caseContext: CTX('method', 'f411ba00' + '0'.repeat(56)),
      saved: CONTENT,
      content: CONTENT,
    })
    const el = await mount(<AiPanel />)
    await flush() // savedSha 订阅异步落值
    const tag = q('[data-testid="ai-scope-version"]', el)!
    expect(tag).not.toBeNull()
    expect(tag.textContent).toBe('method@2e473673')
    expect(tag.getAttribute('title')).toContain('2e473673')
    expect(tag.getAttribute('title')).not.toContain('f411ba00')
  })

  it('savedSha 为空且同案 context → 回退 context 快照（加载中唯一真值源）', async () => {
    enable()
    useStudio.setState({ savedSha: '', caseContext: CTX('method', 'a1b2c3d4' + '0'.repeat(56)), saved: '', content: '' })
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-scope-version"]', el)!.textContent).toBe('method@a1b2c3d4')
  })

  it('savedSha 为空且 context 属别的案 → 不显示（跨案旧快照不得冒充本案版本）', async () => {
    enable()
    useStudio.setState({ savedSha: '', caseContext: CTX('system', 'deadbeef' + '0'.repeat(56)), saved: '', content: '' })
    const el = await mount(<AiPanel />)
    expect(q('[data-testid="ai-scope-version"]', el)).toBeNull()
  })

  it('本地未保存修改 → 标注「·未存」且 title 明示绑定的是服务端已存版本', async () => {
    enable()
    useStudio.setState({
      caseContext: CTX('method', 'f411ba00' + '0'.repeat(56)),
      saved: CONTENT,
      content: CONTENT + '\n本地新增一句。\n',
      collabStatus: 'off',
    })
    const el = await mount(<AiPanel />)
    await flush()
    const tag = q('[data-testid="ai-scope-version"]', el)!
    expect(tag.textContent).toBe('method@2e473673·未存')
    expect(tag.getAttribute('title')).toContain('未保存修改不在上下文内')
    // 保存（saved=content）后标注消失（sha 随之重算为新值，断言未存标记消失即可）
    await act(async () => useStudio.setState({ saved: useStudio.getState().content }))
    expect(q('[data-testid="ai-scope-version"]', el)!.textContent).not.toContain('未存')
  })
})
