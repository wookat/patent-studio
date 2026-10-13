/** 轨道 E · 术语表契约（docs/plan/09 §3.2；<project>/terms.json，backend/app/domain/terms.py） */

export interface Term {
  /** 主名（唯一、非空） */
  name: string
  aliases: string[]
  en: string | null
  definition: string | null
  /** 全文 1-based 首现行；未知为 null */
  first_line: number | null
}

/** GET/PUT /api/projects/{pid}/terms */
export interface TermsResponse {
  version: number
  terms: Term[]
}

/** POST …/terms/extract 的一条候选（确定性 + 可选 AI 补充） */
export interface TermCandidate {
  name: string
  count: number
  lines: number[]
  source: 'freq' | 'figure-label' | 'ai'
  aliases?: string[]
  en?: string | null
  definition?: string | null
}

export interface TermsExtractResult {
  candidates: TermCandidate[]
  /** ai=true 时才有 */
  ai_used: boolean
}

/** POST …/terms/unify：CriticMarkup 全文 + 改动行，前端 setContent 后由审阅面板接受 / 拒绝 */
export interface TermsUnifyResult {
  critic_markdown: string
  changed_lines: number[]
  count: number
}
