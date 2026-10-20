import type { BookName } from './ast'
import type { AiJob } from './ai'

/**
 * 智能体契约（docs/plan/21-w5-spec.md §6.2 / §6.3；与 backend/app/agent/types.py 逐字段对应）。
 * 本文件只读：ai-panel-frontend 单元消费，agent-core-backend 单元的 Pydantic 模型以此为准。
 */

/** 场景 S1–S10；S8 查新笔记为「待检索」诚实版：产检索式+笔记框架，不伪造检索结论 */
export type Scenario = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8' | 's9' | 's10'

export interface ScenarioInfo {
  id: Scenario
  label: string
  /** 一句话说明（场景卡副标题） */
  hint: string
  /** 产出形态 */
  produces: ProposalKind[]
  /** heavy = 含规划步，排 `{pid}:heavy` FIFO 队列；interactive 不排队 */
  weight: 'heavy' | 'interactive'
  /** 最低角色（viewer 只读场景可跑 comment 类） */
  minRole: 'viewer' | 'reviewer' | 'editor'
}

export const SCENARIOS: readonly ScenarioInfo[] = [
  { id: 's1', label: '交底书 → 三书初稿', hint: '规划大纲后分书成稿（新案走导入管线，现案生成新块）', produces: ['patch'], weight: 'heavy', minRole: 'editor' },
  { id: 's2', label: '权项树批评', hint: '逐独权检查支持性 / 清楚性 / 先行词，批注引 [00NN]', produces: ['comment'], weight: 'heavy', minRole: 'viewer' },
  { id: 's3', label: '支持性补全', hint: '从批评结果补写说明书支持段（修订建议）', produces: ['critic'], weight: 'interactive', minRole: 'reviewer' },
  { id: 's4', label: '术语一致性', hint: '确定性候选 + 选主术语，生成 {~~旧~>新~~}', produces: ['critic'], weight: 'interactive', minRole: 'reviewer' },
  { id: 's5', label: '附图标记对齐', hint: '附图标记与说明书差分并解释', produces: ['comment'], weight: 'interactive', minRole: 'viewer' },
  { id: 's6', label: '摘要生成', hint: '读权项与说明书生成 ≤300 字摘要', produces: ['critic', 'patch'], weight: 'interactive', minRole: 'reviewer' },
  { id: 's7', label: 'OA 争辩稿', hint: '每条审查意见生成争辩要点，可选修改权项建议', produces: ['comment', 'critic'], weight: 'heavy', minRole: 'reviewer' },
  { id: 's8', label: '查新笔记', hint: '读三书提发明点与检索式并实跑先行技术检索，产出命中表查新笔记批注', produces: ['comment'], weight: 'interactive', minRole: 'viewer' },
  { id: 's9', label: '双语翻译', hint: '分书翻译为 docs/<book>.en.md 并回译校验', produces: ['patch'], weight: 'interactive', minRole: 'editor' },
  { id: 's10', label: '客户简报', hint: '生成 docs/brief.md 面向客户的简报', produces: ['patch'], weight: 'interactive', minRole: 'editor' },
]

export type StepEventKind = 'plan' | 'tool_call' | 'tool_result' | 'gen_delta' | 'check' | 'proposal' | 'done'

export interface StepEventDataMap {
  plan: { steps: string[] }
  tool_call: { name: string; args: Record<string, unknown> }
  tool_result: { name: string; chars: number; ms: number }
  gen_delta: { text: string }
  check: CheckResult
  proposal: { id: string; kind: ProposalKind; anchor: Anchor; preview: string }
  done: { proposals: string[]; usage: Usage; error?: string; truncated: boolean }
}

/** SSE `GET /api/ai/jobs/{id}/events` 每帧；lib/sse.ts 解析 */
export type StepEvent = {
  [K in StepEventKind]: { seq: number; kind: K; ts: number; data: StepEventDataMap[K] }
}[StepEventKind]

export type ProposalKind = 'critic' | 'comment' | 'patch'
export type ProposalState = 'pending' | 'applied' | 'dismissed'

/** 锚点：块级（book + block_id + 行区间）或文件级（新文件 patch） */
export type Anchor =
  | { book: BookName; block_id: string; line_start: number; line_end: number }
  | { file: string }

export interface CheckResult {
  name: string
  ok: boolean
  why: string
}

export interface Usage {
  prompt: number
  completion: number
}

export type Patch =
  | { blocks: { after_block_id: string; markdown: string; replace_block_id?: string | null }[] }
  | { file: string; content: string }

/** 提案来源（Z18）：comment = 由批注（客户 / 内部）一键转出的修改提案 */
export interface ProposalSource {
  kind: 'comment'
  comment_id: string
  quote: string
  author: string
  body: string
}

/** 永不直接改 content.md 最终文本：critic → 用户点「写入为修订」；comment → 批注；patch → 用户点「应用」 */
export interface Proposal {
  id: string
  job_id: string
  scenario: Scenario
  kind: ProposalKind
  anchor: Anchor
  critic_markdown: string | null
  comment_body: string | null
  patch: Patch | null
  checks: CheckResult[]
  model: string
  usage: Usage
  created_at: number
  state: ProposalState
  source?: ProposalSource | null
}

/** W5 扩展的 job（现有 AiJob + steps / queue_key）；kind 增 `agent:<scenario>` */
export interface AgentJob extends Omit<AiJob, 'kind'> {
  kind: AiJob['kind'] | `agent:${Scenario}`
  /** StepEvent 摘要（不含 gen 全文），供历史回放 */
  steps: StepEvent[]
  /** `${pid}:heavy` → 同 key FIFO 串行；interactive 为 null */
  queue_key: string | null
  /** 续跑入参（Z14）；null ⇒ 不可续跑 */
  payload?: { scenario?: Scenario; params?: Record<string, unknown>; scope?: string } | null
  /** 产出提案 id（Z27 诊断链：任务 → 提案） */
  proposal_ids?: string[]
}

export interface AgentRunIn {
  scenario: Scenario
  /** 场景参数（S7：oa item id；S3：来源 comment id；S9：目标语言…） */
  params?: Record<string, unknown>
}

/** 与 BlockEditResult 同构：critic / 块 patch 写入 content.md 后回带新全文；文件 patch（docs/*.md）不动正文 ⇒ content 为 null */
export interface ProposalApplyResult {
  proposal: Proposal
  content: string | null
  /** 全文变更行（1-based 闭区间） */
  changed_lines: { start: number; end: number } | null
  backup: string | null
}

export const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = { critic: '修订建议', comment: '批注', patch: '新增内容' }

/** 批量应用（apply-all）——applied 为成功提案 id；failed 单条带因由；content 为末次正文（patch/critic 命中时为最新全文） */
export interface ProposalApplyAllResult {
  applied: string[]
  failed: { id: string; error: string }[]
  content: string | null
}
