import { P, req } from './net'
import type { AiJob } from '@/types/ai'
import type { OaAnswer, OaItem, OaParseResult, OaRound, OaRoundIn } from '@/types/oa'

export const oaApi = {
  oaParse: (id: string, text: string) =>
    req<OaParseResult>(`${P(id)}/oa/parse`, { method: 'POST', body: JSON.stringify({ text }) }),
  /** 当前拆条工作集：刷新后重建 OA 面板（D-OA-1——此前 items 只写不读，刷新即丢） */
  oaItems: (id: string) => req<{ items: OaItem[]; warnings: string[]; answers: OaAnswer[] }>(`${P(id)}/oa/items`),
  oaAnswer: (id: string, itemIds: string[] | null = null) =>
    req<AiJob>(`${P(id)}/oa/answer`, { method: 'POST', body: JSON.stringify({ item_ids: itemIds }) }),
  /** 用户改过的要点落盘（.studio/oa/<item>.json），导出 DOCX 读的就是这份 */
  oaUpdateAnswer: (id: string, itemId: string, points: string[]) =>
    req<OaAnswer>(`${P(id)}/oa/answers/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    }),
  oaExportUrl: (id: string) => `${P(id)}/oa/export.docx`,

  /* ---------- R7 MCP / PAT / 审计（docs/plan/10 §3.4；AUTH=off 时 PAT 三条 501） ---------- */
  oaRounds: (id: string) => req<{ rounds: OaRound[] }>(`${P(id)}/oa/rounds`),
  createOaRound: (id: string, body: OaRoundIn) => req<OaRound>(`${P(id)}/oa/rounds`, { method: 'POST', body: JSON.stringify(body) }),
  updateOaRound: (id: string, rid: string, patch: Partial<OaRoundIn> & { extension_months?: number; filed_on?: string }) =>
    req<OaRound>(`${P(id)}/oa/rounds/${encodeURIComponent(rid)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** 延期申请（细则第六条：单次 1|2 月、累计 ≤2；超 → 409 conflict） */
  oaExtendRound: (id: string, rid: string, months: 1 | 2) =>
    req<OaRound>(`${P(id)}/oa/rounds/${encodeURIComponent(rid)}/extend`, { method: 'POST', body: JSON.stringify({ months }) }),
  deleteOaRound: (id: string, rid: string) => req<void>(`${P(id)}/oa/rounds/${encodeURIComponent(rid)}`, { method: 'DELETE' }),
  oaParsePdf: (id: string, file: File, roundId?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (roundId) fd.append('round_id', roundId)
    return req<OaParseResult>(`${P(id)}/oa/parse`, { method: 'POST', body: fd })
  },

  /** 递交页字段级错误（preflight-backend：manifest 增 errors[]） */
}
