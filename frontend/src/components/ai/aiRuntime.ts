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
 * AI 运行态（面板头 + 伴随栏头共用）：接入层未就绪（501） → 机构未许可 → 本案未开启 → 探测中 → 中转站不可达 → 凭证未配置 → 运行中 → 已就绪。
 * 只读 store，不发请求。无凭证不得显示绿色就绪。
 */
export function useAiRuntime(): AiRuntime {
  const enabled = useStudio(selectAiEnabled)
  const status = useStudio((s) => s.aiStatus)
  const statusLoading = useStudio((s) => s.aiStatusLoading)
  const unavailable = useStudio((s) => s.aiUnavailable)
  const disabledByOrg = useStudio((s) => s.agentDisabledByOrg)
  const pid = useStudio((s) => s.pid)
  const caseCtx = useStudio((s) => s.caseContext)
  const authStatus = useStudio((s) => s.authStatus)
  /* 本案真实就绪（同 AiPanel.bindingBlocked 口径）：全局 provider ready ≠ 本案 ready——
     denied/ambiguous/AUTH=on+unavailable/机构策略关/机构非 active 一律不得显示绿色就绪；
     上下文未取回（authed 而无 caseCtx）同样不得绿灯 */
  const caseBlocked = !!pid && caseCtx?.pid === pid && (
    caseCtx.binding === 'denied' || caseCtx.binding === 'ambiguous' ||
    (caseCtx.binding === 'bound' && caseCtx.egress_policy?.ai_egress === false) ||
    (caseCtx.auth === 'on' && caseCtx.binding === 'unavailable') ||
    (caseCtx.binding === 'bound' && !!caseCtx.organization && caseCtx.organization.status !== 'active')
  )
  const ctxPending = !!pid && authStatus === 'authed' && (!caseCtx || caseCtx.pid !== pid)
  const runningJobs = useStudio(selectAiRunning)
  const streaming = useStudio((s) => s.chatStreaming)
  const liveJobs = useStudio((s) => s.agentJobs.filter((j) => j.status === 'queued' || j.status === 'running').length)
  const busy = streaming || runningJobs > 0 || liveJobs > 0
  const suffix = status ? ` · ${status.provider}` : ''

  if (unavailable) return { tone: 'warn', label: '接入层未就绪（501）', suffix, busy }
  if (disabledByOrg || status?.org_ai_enabled === false) return { tone: 'warn', label: '机构未许可 AI', suffix, busy }
  if (caseBlocked) return { tone: 'warn', label: '本案未许可 AI', suffix, busy }
  if (ctxPending) return { tone: 'info', label: '核验中', suffix, busy }
  if (!enabled) return { tone: 'neutral', label: '本案未开启', suffix, busy }
  if (statusLoading && !status) return { tone: 'info', label: '探测中…', suffix, busy }
  if (status?.reachable === false || status?.error) return { tone: 'danger', label: '中转站不可达', suffix, busy }
  if (status && !status.key_present) return { tone: 'warn', label: '凭证未配置', suffix, busy }
  if (busy) return { tone: 'info', label: '运行中', suffix, busy }
  if (status) return { tone: 'ok', label: '已就绪', suffix, busy }
  return { tone: 'neutral', label: '未探测', suffix, busy }
}
