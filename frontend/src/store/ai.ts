import { ApiError, api } from '@/lib/api'
import { readSse } from '@/lib/sse'
import type { AiJob, AiStatus, AiSuggestion, ChatAttachment, ChatAttachmentMeta, ChatContext, ChatMessage, ChatResume, RewriteAction, RewriteResult } from '@/types/ai'
import type { Slice } from './types'

/**
 * 轨道 E · AI 助手（docs/plan/09 §5.1）。
 * - `aiStatus`：GET /api/ai/status（不出站）；`aiEnabled` 派生自 project.settings.ai_enabled（selectAiEnabled）。
 * - `chat`：按案 localStorage 持久化（`ps:chat:<pid>`，尾 50 条）——刷新/重开案卷经 `hydrateChat` 恢复；
 *   `sendChat` 读 POST /ai/chat 的 text/event-stream：delta 逐块追加到 assistant.content，done 带回 model/usage/fallback 落 meta；
 *   ai_enabled=false 不发请求（后端也会 403）。agent 模式的 confirm 卡随消息落盘——resume 无状态，刷新后仍可裁决续跑。
 * - `suggestions`：rewrite/unify 产生、待用户接受/拒绝的 CriticMarkup 建议；接受 = 把 critic_markdown 写入源码
 *   （components/ai/aiModel.applySuggestion 走 editorCommands.replaceLines；review slice 再逐条 accept/reject），从不直接改写。
 * - `jobs`：本案后台任务（review/convert/oa_answer）；`watchJob(id)` 用 EventSource(api.aiJobEventsUrl) 推进，
 *   SSE 不可用（501 / 断线）时退回 `JOB_POLL_MS` 轮询 GET /api/ai/jobs/{id}，终态后停止。
 */
export const JOB_POLL_MS = 1500
export const isJobDone = (j: AiJob) => j.status === 'done' || j.status === 'error' || j.status === 'interrupted'
export interface AiSlice {
  aiStatus: AiStatus | null
  aiStatusLoading: boolean
  /** 任一 AI 路由 501（E1 未落地）：本案内不再自动重试 */
  aiUnavailable: boolean
  chat: ChatMessage[]
  chatStreaming: boolean
  chatError: string | null
  /** 批71：对话输入框草稿——AI 面板页签切换/面板关闭卸载 AiChat，本地态草稿会随实例死；存 store 保命
     （卸载丢草稿族收口，与 commentDraft/oaAnswerDraft/termDraft/timelineNote 同契） */
  aiChatDraft: string
  /** 待发送附件（同 aiChatDraft 契：卸载存 store 保命；发送/清场即清） */
  aiChatAttachments: ChatAttachment[]
  suggestions: AiSuggestion[]
  jobs: AiJob[]
  jobsLoading: boolean

  loadAiStatus(probe?: boolean): Promise<AiStatus | null>
  /** project.saveSettings({...settings, ai_enabled}) 的快捷方式；UI 明示 */
  setAiEnabled(enabled: boolean): void
  sendChat(text: string, context?: ChatContext | null, attachmentMeta?: ChatAttachmentMeta[]): Promise<void>
  /** agent 确认卡裁决：带 resume 续跑到同一 assistant 消息 */
  answerConfirm(msgId: string, approved: boolean): Promise<void>
  /** openProject 成功后调用：从 localStorage 恢复本案对话（chat 空才恢复，防双写） */
  hydrateChat(pid: string): void
  stopChat(): void
  clearChat(): void
  /** 选区动作：成功 → 追加一条 suggestion 并返回；501 → aiUnavailable */
  rewrite(action: RewriteAction, sel: { book: string; line_start: number; line_end: number }, instruction?: string): Promise<RewriteResult | null>
  acceptSuggestion(id: string): void
  dismissSuggestion(id: string): void
  startReview(scope?: string): Promise<AiJob | null>
  loadJobs(pid: string): Promise<void>
  upsertJob(job: AiJob): void
  /** 从任务列表剔除（客户端隐藏，不影响服务端） */
  hideJob(id: string): void
  /** 跟踪一个任务直到终态（SSE 优先，失败退回轮询）；重复调用同一 id 无副作用 */
  watchJob(id: string): void
  unwatchJob(id: string): void
  setAiChatDraft(text: string): void
  addAiChatAttachments(list: ChatAttachment[]): void
  removeAiChatAttachment(name: string): void
  clearAiChatAttachments(): void
  resetAi(): void
}

let chatAbort: AbortController | null = null
const watchers = new Map<string, () => void>()
let seq = 0
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`

type SliceArgs = Parameters<Slice<AiSlice>>

/* ---------- 对话持久化（批3-A）：ps:chat:<pid>，尾 50 条，streaming 旗不落盘 ---------- */
const CHAT_KEY = (pid: string) => `ps:chat:${pid}`
const CHAT_CAP = 50
const chatStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

export function readPersistedChat(pid: string, storage: Pick<Storage, 'getItem'> | null = chatStorage()): ChatMessage[] {
  try {
    const raw = storage?.getItem(CHAT_KEY(pid))
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((m): m is ChatMessage =>
      !!m && typeof m === 'object' &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
      typeof (m as ChatMessage).content === 'string',
    ).slice(-CHAT_CAP)
  } catch { return [] }
}

function persistChat(pid: string, chat: ChatMessage[]) {
  try {
    chatStorage()?.setItem(CHAT_KEY(pid), JSON.stringify(chat.slice(-CHAT_CAP).map((m) => ({ ...m, streaming: undefined }))))
  } catch { /* quota/隐私模式：放弃持久化不打扰 */ }
}

/** POST /ai/chat 的 SSE 消费（sendChat 首发与 answerConfirm 续跑共用）：
 * delta 追加内容；step 按 id upsert（running→ok|error）；confirm 落卡停流等裁决；done 记 meta；
 * confirm 也是流的终点（服务端不再发 done）——均统一收 streaming:false/chatStreaming:false。 */
async function streamInto(
  set: SliceArgs[0], get: SliceArgs[1],
  pid: string, bot: ChatMessage,
  call: (resume?: ChatResume) => Promise<Response>, resume?: ChatResume,
) {
  const patch = (p: Partial<ChatMessage>) => set({ chat: get().chat.map((m) => (m.id === bot.id ? { ...m, ...p } : m)) })
  const r = await call(resume)
  if (get().pid && get().pid !== pid) return
  if (!r.body) throw new Error('响应无正文')
  let streamError: string | null = null
  await readSse(r.body, (ev) => {
    if (ev.type === 'delta') set({ chat: get().chat.map((m) => (m.id === bot.id ? { ...m, content: m.content + ev.text } : m)) })
    else if (ev.type === 'step') {
      const cur = get().chat.find((m) => m.id === bot.id)?.steps ?? []
      const i = cur.findIndex((s) => s.id === ev.step.id)
      const steps = i >= 0 ? cur.map((s, j) => (j === i ? ev.step : s)) : [...cur, ev.step]
      patch({ steps })
    } else if (ev.type === 'confirm') patch({ confirm: ev.confirm })
    else if (ev.type === 'done') patch({ meta: { model: ev.model, usage: ev.usage, fallback: ev.fallback, steps: ev.steps } })
    else streamError = ev.message
  })
  if (get().pid && get().pid !== pid) return
  if (streamError) throw new Error(streamError)
  patch({ streaming: false })
  set({ chatStreaming: false })
  persistChat(pid, get().chat)
}

export const aiSlice: Slice<AiSlice> = (set, get) => ({
  aiStatus: null,
  aiStatusLoading: false,
  aiUnavailable: false,
  chat: [],
  chatStreaming: false,
  chatError: null,
  aiChatDraft: '',
  aiChatAttachments: [],
  suggestions: [],
  jobs: [],
  jobsLoading: false,

  loadAiStatus: async (probe = false) => {
    set({ aiStatusLoading: true })
    try {
      const s = await api.aiStatus(probe)
      set({ aiStatus: s, aiStatusLoading: false, agentDisabledByOrg: s.org_ai_enabled === false })
      return s
    } catch (e) {
      set({ aiStatusLoading: false, aiUnavailable: e instanceof ApiError && e.status === 501 })
      return null
    }
  },
  setAiEnabled: (enabled) => {
    const s = get().settings
    if (!s || (s.ai_enabled ?? false) === enabled) return
    get().saveSettings({ ...s, ai_enabled: enabled })
  },
  sendChat: async (text, context = null, attachmentMeta) => {
    const { pid, chat, settings } = get()
    if (!pid || !text.trim() || get().chatStreaming || settings?.ai_enabled !== true) return
    const user: ChatMessage = { id: nextId('u'), role: 'user', content: text, attachments: attachmentMeta?.length ? attachmentMeta : undefined, created_at: Date.now() }
    const bot: ChatMessage = { id: nextId('a'), role: 'assistant', content: '', streaming: true, created_at: Date.now() }
    set({ chat: [...chat, user, bot], chatStreaming: true, chatError: null })
    chatAbort?.abort()
    const ac = new AbortController()
    chatAbort = ac
    const patch = (p: Partial<ChatMessage>) => set({ chat: get().chat.map((m) => (m.id === bot.id ? { ...m, ...p } : m)) })
    try {
      const history = [...chat, user].filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content }))
      await get().flushSettings()
      await streamInto(set, get, pid, bot, (extra) => api.aiChat(pid, history, context, ac.signal, extra))
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      const msg = aborted ? '已停止' : e instanceof Error ? e.message : String(e)
      patch({ streaming: false, error: aborted ? undefined : msg })
      set({
        chatStreaming: false,
        chatError: aborted ? null : msg,
        ...(e instanceof ApiError && e.status === 501 ? { aiUnavailable: true } : {}),
      })
      persistChat(pid, get().chat)
    } finally {
      if (chatAbort === ac) chatAbort = null
    }
  },
  answerConfirm: async (msgId, approved) => {
    const { pid, chat } = get()
    const bot = chat.find((m) => m.id === msgId)
    if (!pid || !bot?.confirm || bot.confirm.decision || get().chatStreaming) return
    const patch = (p: Partial<ChatMessage>) => set({ chat: get().chat.map((m) => (m.id === msgId ? { ...m, ...p } : m)) })
    patch({ confirm: { ...bot.confirm, decision: approved ? 'approved' : 'declined' }, streaming: true })
    set({ chatStreaming: true, chatError: null })
    chatAbort?.abort()
    const ac = new AbortController()
    chatAbort = ac
    try {
      // resume 路径服务端自行拼回 assistant tool_calls 消息——历史里剔除这条 bot 气泡免重复
      const history = chat.filter((m) => m.id !== msgId && !m.error && m.content).map((m) => ({ role: m.role, content: m.content }))
      await get().flushSettings()
      await streamInto(set, get, pid, bot,
        (extra) => api.aiChat(pid, history, null, ac.signal, extra),
        { resume: bot.confirm.resume, approved })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      const msg = aborted ? '已停止' : e instanceof Error ? e.message : String(e)
      patch({ streaming: false, error: aborted ? undefined : msg })
      set({
        chatStreaming: false,
        chatError: aborted ? null : msg,
        ...(e instanceof ApiError && e.status === 501 ? { aiUnavailable: true } : {}),
      })
      persistChat(pid, get().chat)
    } finally {
      if (chatAbort === ac) chatAbort = null
    }
  },
  hydrateChat: (pid) => {
    const saved = readPersistedChat(pid)
    if (saved.length && get().chat.length === 0) set({ chat: saved })
  },
  stopChat: () => {
    chatAbort?.abort()
    chatAbort = null
    set({ chat: get().chat.map((m) => (m.streaming ? { ...m, streaming: false } : m)), chatStreaming: false })
    const pid = get().pid
    if (pid) persistChat(pid, get().chat)
  },
  clearChat: () => {
    set({ chat: [], chatError: null })
    const pid = get().pid
    if (pid) persistChat(pid, [])
  },
  rewrite: async (action, sel, instruction) => {
    const { pid, content } = get()
    if (!pid) return null
    try {
      const r = await api.aiRewrite(pid, { ...sel, action, content, instruction })
      if (get().pid && get().pid !== pid) return null
      if (r.critic_markdown) {
        const sug: AiSuggestion = { id: nextId('s'), source: 'rewrite', ...sel, critic_markdown: r.critic_markdown, created_at: Date.now() }
        set({ suggestions: [...get().suggestions, sug] })
      }
      return r
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) set({ aiUnavailable: true })
      else get().toast(`AI 改写失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return null
    }
  },
  acceptSuggestion: (id) => set({ suggestions: get().suggestions.filter((s) => s.id !== id) }),
  dismissSuggestion: (id) => set({ suggestions: get().suggestions.filter((s) => s.id !== id) }),
  startReview: async (scope = 'all') => {
    const { pid, content } = get()
    if (!pid) return null
    try {
      const job = await api.aiReview(pid, { scope, content })
      if (get().pid && get().pid !== pid) return job
      get().upsertJob(job)
      get().watchJob(job.id)
      return job
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) set({ aiUnavailable: true })
      else get().toast(`AI 审阅启动失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return null
    }
  },
  loadJobs: async (pid) => {
    set({ jobsLoading: true })
    try {
      const jobs = (await api.aiJobs(pid)).jobs
      if (get().pid && get().pid !== pid) return
      set({ jobs, jobsLoading: false })
    } catch (e) {
      // 501 → 功能未上线；其余（5xx 等）toast——静默吞成空任务列表是 R74-01 同族假象（仅挂载路径调用，非轮询）
      if (e instanceof ApiError && e.status === 501) set({ jobsLoading: false, aiUnavailable: true })
      else {
        set({ jobsLoading: false })
        get().toast(`任务列表加载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    }
  },
  upsertJob: (job) => {
    // convert→新建案卷：job.pid 已是新案 id——按 convertJobId 认领进 convertJob 仓（store/convert），不走 pid 判
    if (job.id === get().convertJobId) set({ convertJob: job })
    // 晚到帧写外案：不入表，但终态任务仍要收掉它的 watcher
    if (get().pid && job.pid !== get().pid) {
      if (isJobDone(job)) get().unwatchJob(job.id)
      return
    }
    const jobs = get().jobs
    set({ jobs: jobs.some((j) => j.id === job.id) ? jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...jobs] })
    if (isJobDone(job)) get().unwatchJob(job.id)
  },
  hideJob: (id) => set({ jobs: get().jobs.filter((x) => x.id !== id) }),
  watchJob: (id) => {
    if (watchers.has(id)) return
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const poll = async () => {
      if (stopped) return
      try {
        get().upsertJob(await api.aiJob(id))
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
          get().unwatchJob(id)
          return
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), JOB_POLL_MS)
    }
    const fallback = () => {
      es?.close()
      es = null
      if (!timer) void poll()
    }
    watchers.set(id, () => {
      stopped = true
      es?.close()
      if (timer) clearTimeout(timer)
    })
    if (typeof EventSource === 'undefined') {
      fallback()
      return
    }
    es = new EventSource(api.aiJobEventsUrl(id))
    es.onmessage = (ev) => {
      try {
        get().upsertJob(JSON.parse(ev.data) as AiJob)
      } catch {
        /* 畸形帧丢弃，SSE 续传（同 agent.ts onFrame 口径） */
      }
    }
    es.onerror = fallback
  },
  unwatchJob: (id) => {
    watchers.get(id)?.()
    watchers.delete(id)
  },
  setAiChatDraft: (text) => set({ aiChatDraft: text }),
  addAiChatAttachments: (list) => set({ aiChatAttachments: [...get().aiChatAttachments, ...list.filter((a) => a.text)] }),
  removeAiChatAttachment: (name) => set({ aiChatAttachments: get().aiChatAttachments.filter((a) => a.name !== name) }),
  clearAiChatAttachments: () => set({ aiChatAttachments: [] }),
  resetAi: () => {
    chatAbort?.abort()
    chatAbort = null
    for (const stop of watchers.values()) stop()
    watchers.clear()
    set({ aiUnavailable: false, chat: [], chatStreaming: false, chatError: null, aiChatDraft: '', aiChatAttachments: [], suggestions: [], jobs: [], jobsLoading: false })
    get().resetAgent()
  },
})

/** 本案是否允许外发到 AI（settings.ai_enabled，默认 false） */
export const selectAiEnabled = (s: { settings: { ai_enabled?: boolean } | null }) => s.settings?.ai_enabled === true
/** 进行中的后台任务数（Rail「AI」徽标） */
export const selectAiRunning = (s: { jobs: AiJob[] }) => s.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length
