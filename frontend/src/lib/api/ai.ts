import { P, handle, netFetch, qs, req } from './net'
import type { AgentJob, AgentRunIn, Proposal, ProposalApplyAllResult, ProposalApplyResult, ProposalState } from '@/types/agent'
import type { AiJob, AiStatus, AiUsageRecord, ChatContext, ChatResume, RewriteRequest, RewriteResult } from '@/types/ai'

export const aiApi = {
  aiStatus: (probe = false) => req<AiStatus>(`/api/ai/status${probe ? '?probe=1' : ''}`),
  /** SSE：返回原始 Response，由 store.ai.sendChat 读 body 流；非 2xx 走 handle 抛 ApiError */
  aiChat: async (id: string, messages: { role: string; content: string }[], context: ChatContext | null, signal?: AbortSignal, resume?: ChatResume) => {
    const r = await netFetch(`${P(id)}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages, context, ...(resume ? { resume: resume.resume, approved: resume.approved } : {}) }),
      signal,
    })
    if (!r.ok) await handle<void>(r)
    return r
  },
  /** 对话附件抽文本：FormData files[]（≤8/50MB）→ per-file ok/text/error */
  aiChatAttach: (id: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    return req<{ results: import('@/types/ai').ChatAttachResult[] }>(`${P(id)}/ai/chat/attach`, { method: 'POST', body: form })
  },
  aiRewrite: (id: string, body: RewriteRequest, signal?: AbortSignal) =>
    req<RewriteResult>(`${P(id)}/ai/rewrite`, { method: 'POST', body: JSON.stringify(body), signal }),
  aiReview: (id: string, body: { scope?: string; content?: string } = {}) =>
    req<AiJob>(`${P(id)}/ai/review`, { method: 'POST', body: JSON.stringify(body) }),
  aiJobs: (id: string) => req<{ jobs: AiJob[] }>(`${P(id)}/ai/jobs`),
  aiJob: (jobId: string) => req<AiJob>(`/api/ai/jobs/${encodeURIComponent(jobId)}`),
  aiJobEventsUrl: (jobId: string) => `/api/ai/jobs/${encodeURIComponent(jobId)}/events`,
  /** rows 只含最近 limit 条；展示用量用 total（后端全量聚合）——截窗求和会在 >limit 记录的案卷上偏少 */
  aiUsage: (id: string, limit = 200) =>
    req<{ rows: AiUsageRecord[]; total: { prompt_tokens: number; completion_tokens: number; requests: number }; today_tokens: number; budget: number }>(
      `${P(id)}/ai/usage?limit=${limit}`,
    ),

  /* ---- 轨道 E · 术语（09 §3.2）---- */
  agentRun: (id: string, body: AgentRunIn) => req<AgentJob>(`${P(id)}/agent/run`, { method: 'POST', body: JSON.stringify(body) }),
  agentJobs: (id: string, signal?: AbortSignal) => req<{ jobs: AgentJob[] }>(`${P(id)}/agent/jobs`, { signal }),
  agentCancel: (jobId: string) => req<AgentJob>(`/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
  proposals: (id: string, state?: ProposalState, signal?: AbortSignal) =>
    req<{ proposals: Proposal[] }>(`${P(id)}/agent/proposals${qs({ state })}`, { signal }),
  applyProposal: (id: string, proposalId: string) =>
    req<ProposalApplyResult>(`${P(id)}/agent/proposals/${encodeURIComponent(proposalId)}/apply`, { method: 'POST' }),
  applyAllProposals: (id: string) =>
    req<ProposalApplyAllResult>(`${P(id)}/agent/proposals/apply-all`, { method: 'POST' }),
  dismissProposal: (id: string, proposalId: string) =>
    req<Proposal>(`${P(id)}/agent/proposals/${encodeURIComponent(proposalId)}/dismiss`, { method: 'POST' }),

  /** 机构管理（notify-audit-backend / agent-core-backend） */
}
