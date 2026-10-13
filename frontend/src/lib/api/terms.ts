import { P, req } from './net'
import type { Term, TermsExtractResult, TermsResponse, TermsUnifyResult } from '@/types/terms'

export const termsApi = {
  terms: (id: string) => req<TermsResponse>(`${P(id)}/terms`),
  putTerms: (id: string, terms: Term[]) =>
    req<TermsResponse>(`${P(id)}/terms`, { method: 'PUT', body: JSON.stringify({ terms }) }),
  extractTerms: (id: string, body: { content?: string; ai?: boolean } = {}) =>
    req<TermsExtractResult>(`${P(id)}/terms/extract`, { method: 'POST', body: JSON.stringify(body) }),
  unifyTerms: (id: string, body: { content?: string; names?: string[]; books?: string[] } = {}) =>
    req<TermsUnifyResult>(`${P(id)}/terms/unify`, { method: 'POST', body: JSON.stringify(body) }),

  /* ---- 轨道 E · 一键转专利（09 §3.3；multipart）---- */
}
