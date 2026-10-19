import { req } from './net'
import type { SupportRow } from '@/types/preflight'

/** Z20 权项沙盘：后端 domain/claim_sandbox 的返回形状。 */
export interface ClaimBlocker {
  kind: 'unknown_claim' | 'missing' | 'self' | 'forward' | 'cycle'
  message: string
  refs?: number[]
  path?: number[]
}
export interface ClaimWarning {
  kind: 'becomes_independent' | 'first_dependent' | 'multi'
  message: string
}

export interface ClaimDetail {
  claim: number
  ok: boolean
  node?: { num: number; kind: string; category: string | null; refs: number[]; issues: string[]; line: number }
  current_refs?: number[]
  direct_dependents?: number[]
  downstream?: number[]
  upstream?: number[]
  support?: SupportRow[]
  blockers?: ClaimBlocker[]
}

export interface ClaimPreview {
  claim: number
  ok: boolean
  blockers: ClaimBlocker[]
  warnings: ClaimWarning[]
  current_refs?: number[]
  proposed_refs?: number[]
  ref_diff?: { added: number[]; removed: number[] }
  downstream?: number[]
  upstream?: number[]
  support?: SupportRow[]
}

export const claimsApi = {
  claimDetail: (pid: string, num: number, signal?: AbortSignal) =>
    req<ClaimDetail>(`/api/projects/${encodeURIComponent(pid)}/claims/${num}`, { signal }),
  claimPreview: (pid: string, num: number, refs: number[]) =>
    req<ClaimPreview>(`/api/projects/${encodeURIComponent(pid)}/claims/${num}/preview`, {
      method: 'POST',
      body: JSON.stringify({ refs }),
    }),
}
