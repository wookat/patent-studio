import { req } from './net'
import type { EvidenceStatus, NoveltyEvidence, NoveltyRecord } from '@/types/novelty'

export interface EvidenceInput {
  hit: string
  claim?: number | null
  feature?: string
  quote?: string
  status?: EvidenceStatus | ''
}

/** Z31：批注返回（comments.create 同形，source=ai） */
export interface NoveltyComment {
  id: string
  anchor: { block_id: string; line: number; book?: string }
  body: string
  source: string
}

export const noveltyApi = {
  getNovelty: (id: string, signal?: AbortSignal) =>
    req<NoveltyRecord>(`/api/projects/${encodeURIComponent(id)}/novelty`, { signal }),
  putNovelty: (id: string, rec: Omit<NoveltyRecord, 'updated_at'>) =>
    req<NoveltyRecord>(`/api/projects/${encodeURIComponent(id)}/novelty`, { method: 'PUT', body: JSON.stringify(rec) }),
  /** Z31：追加证据对照行（hit 须已登记；quote 空 ⇒ pending 待核对） */
  addEvidence: (id: string, ev: EvidenceInput) =>
    req<{ record: NoveltyRecord; evidence: NoveltyEvidence }>(`/api/projects/${encodeURIComponent(id)}/novelty/evidence`, {
      method: 'POST',
      body: JSON.stringify(ev),
    }),
  /** Z31：证据行 + claims/{claim} 块审阅批注（不改正文；权项不存在/未登记 hit ⇒ 422） */
  annotateEvidence: (id: string, ev: EvidenceInput & { claim: number }) =>
    req<{ comment: NoveltyComment; evidence: NoveltyEvidence }>(
      `/api/projects/${encodeURIComponent(id)}/novelty/annotate`,
      { method: 'POST', body: JSON.stringify(ev) },
    ),
}
