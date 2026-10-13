import { selectAiEnabled, selectAiRunning, useStudio } from '@/store'

export type AiRuntimeTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral'

/** 运行态圆点色（8px，与 05 §S6 头部 StatusDot 同形态；running 脉冲由调用方加） */
export const AI_RUNTIME_DOT: Record<AiRuntimeTone, string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-dot',
  danger: 'bg-danger-dot',
  neutral: 'bg-fg-disabled',
}

export interface AiRuntime {
  tone: AiRuntimeTone
  /** 一句话运行态（用户视角） */
  label: string
  /** 供应商后缀：mock 与真模型只差这里的文字（「· mock」/「· openai-compatible」），形态一致 */
  suffix: string
  busy: boolean
}

/**
 * AI 运行态（面板头 + 伴随栏头共用）：关闭 → 接入层未就绪（501） → 探测中 → 中转站不可达 → 运行中 → 就绪 / 未配置 key。
 * 只读 store，不发请求。
 */
export function useAiRuntime(): AiRuntime {
  const enabled = useStudio(selectAiEnabled)
  const status = useStudio((s) => s.aiStatus)
  const statusLoading = useStudio((s) => s.aiStatusLoading)
  const unavailable = useStudio((s) => s.aiUnavailable)
  const runningJobs = useStudio(selectAiRunning)
  const streaming = useStudio((s) => s.chatStreaming)
  const liveJobs = useStudio((s) => s.agentJobs.filter((j) => j.status === 'queued' || j.status === 'running').length)
  const busy = streaming || runningJobs > 0 || liveJobs > 0
  const suffix = status ? ` · ${status.provider}` : ''

  if (unavailable) return { tone: 'warn', label: '接入层未就绪（501）', suffix, busy }
  if (!enabled) return { tone: 'neutral', label: '外发关闭', suffix, busy }
  if (statusLoading && !status) return { tone: 'info', label: '探测中…', suffix, busy }
  if (status?.reachable === false || status?.error) return { tone: 'danger', label: '中转站不可达', suffix, busy }
  if (busy) return { tone: 'info', label: '运行中', suffix, busy }
  if (status) return { tone: 'ok', label: status.key_present ? '就绪' : '未配置 key', suffix, busy }
  return { tone: 'neutral', label: '未探测', suffix, busy }
}
