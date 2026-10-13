import { req } from './net'
import type { NoveltyRecord } from '@/types/novelty'

export const noveltyApi = {
  getNovelty: (id: string, signal?: AbortSignal) =>
    req<NoveltyRecord>(`/api/projects/${encodeURIComponent(id)}/novelty`, { signal }),
  putNovelty: (id: string, rec: Omit<NoveltyRecord, 'updated_at'>) =>
    req<NoveltyRecord>(`/api/projects/${encodeURIComponent(id)}/novelty`, { method: 'PUT', body: JSON.stringify(rec) }),
  /** 原文件（预览 inline）；download=true → Content-Disposition attachment */
}
