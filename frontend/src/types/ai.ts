/** 轨道 E · AI 接入层契约（docs/plan/09 §2 / §3.1；与 backend/app/ai/* 逐字段对应） */

export type AiPurpose = 'interactive' | 'heavy'

/** GET /api/ai/status */
export interface AiStatus {
  provider: 'aicdks' | 'mock' | string
  key_present: boolean
  models: { interactive: string; heavy: string; fallback: string }
  /** 未探测（probe=0）时 null */
  reachable: boolean | null
  checked_at: number | null
  error: string | null
  /** 机构级 AI 开关（org.ai_enabled）；缺省视为开启（旧服务端/测试桩兼容） */
  org_ai_enabled?: boolean
}

export type AiJobKind = 'review' | 'convert' | 'oa_answer' | 'rewrite' | 'comment2proposal'
export type AiJobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted'

/** GET /api/ai/jobs/{id}；SSE `job` 事件的 data 同形 */
export interface AiJob {
  id: string
  kind: AiJobKind
  pid: string
  status: AiJobStatus
  /** 0–1 */
  progress: number
  message: string
  result: Record<string, unknown> | null
  error: { kind: string; message: string } | null
  created_at: number
  updated_at: number
  /** 续跑入参（Z14）；null / 缺省 ⇒ 不可续跑 */
  payload?: Record<string, unknown> | null
  /** 产出提案 id（Z27 诊断链） */
  proposal_ids?: string[]
}

export type ChatRole = 'system' | 'user' | 'assistant'

/** agent 工具步（SSE step 事件）：name 工具名，status running→ok|error，summary 一行摘要 */
export interface AgentStep {
  id: string
  name: string
  status: 'running' | 'ok' | 'error'
  summary: string
}

/** agent 写面/计划确认卡（SSE confirm 事件）：resume 透传回 /ai/chat 续跑 */
export interface ChatConfirm {
  id: string
  tool: string
  args: Record<string, unknown>
  danger: boolean
  /** 双确认层：2 = 第二次确认卡（高危操作两阶放行） */
  stage?: number
  /** propose_plan 的执行计划 markdown */
  plan_md?: string
  resume: { assistant: unknown; calls: unknown[] }
  /** 用户裁决（本地状态） */
  decision?: 'approved' | 'declined'
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** 流式进行中 */
  streaming?: boolean
  error?: string
  /** SSE done 事件带回的模型 / 用量 / 是否兜底（仅 assistant） */
  meta?: ChatMeta
  /** 该条消息随带的附件（仅 user：发送时落的名+字数快照，文本本体不进历史） */
  attachments?: ChatAttachmentMeta[]
  /** agent 模式：工具执行步（仅 assistant） */
  steps?: AgentStep[]
  /** agent 模式：待裁决确认卡（仅 assistant，decision 空即待决） */
  confirm?: ChatConfirm
  created_at: number
}

/** 对话附件：服务端已抽好文本随 context.attachments 发出 */
export interface ChatAttachment {
  name: string
  text: string
  chars: number
  truncated?: boolean | null
}
export type ChatAttachmentMeta = Pick<ChatAttachment, 'name' | 'chars' | 'truncated'>
/** POST …/ai/chat/attach 响应 per-file */
export interface ChatAttachResult {
  name: string
  ok: boolean
  text?: string
  chars?: number
  truncated?: boolean | null
  error?: string
}

export interface ChatMeta {
  model: string | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  fallback: boolean
  /** agent 模式：本轮工具步数 */
  steps?: number
}

/** POST …/ai/chat 请求体：案卷上下文由前端拼（当前书 / 选区 / 体检摘要），后端只做 require_enabled 与转发 */
export interface ChatContext {
  book?: string
  selection?: { line_start: number; line_end: number; text: string }
  diagnostics?: string[]
  /** 随消息附带的资料文本（后端拼进 context 尾部，截断先裁它） */
  attachments?: { name: string; text: string }[]
}

/** /ai/chat resume 续跑体（确认卡裁决后透传 resume + approved） */
export interface ChatResume {
  resume: { assistant: unknown; calls: unknown[] }
  approved: boolean
}

export type RewriteAction = 'polish' | 'formalize' | 'expand' | 'explain' | 'decopy'

export interface RewriteRequest {
  book: string
  line_start: number
  line_end: number
  action: RewriteAction
  content?: string
  instruction?: string
}

/**
 * POST …/ai/rewrite 响应：critic_markdown 是选区整段的 CriticMarkup 版本（行数与选区一致），前端按 line_start..line_end 回填（不直接改写）；
 * action=explain 时无 critic_markdown，只有 explanation。
 */
export interface RewriteResult {
  critic_markdown?: string
  changed_lines?: number[]
  explanation?: string
  line_start: number
  line_end: number
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  fallback: boolean
}

/** 一条待用户接受 / 拒绝的 AI 建议（rewrite 结果或 unify 结果在前端的统一表示） */
export interface AiSuggestion {
  id: string
  source: 'rewrite' | 'unify' | 'oa'
  book: string
  line_start: number
  line_end: number
  critic_markdown: string
  created_at: number
}

/** .studio/ai-usage.jsonl 一行（GET …/ai/usage） */
export interface AiUsageRecord {
  ts: number
  pid: string | null
  purpose: AiPurpose
  kind: string
  model: string
  requested_model: string
  fallback: boolean
  stream: boolean
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  ms: number
  ok: boolean
  error: string | null
  job_id: string | null
  user: string | null
}
