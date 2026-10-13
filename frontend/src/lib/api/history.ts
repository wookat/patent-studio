import { P, req } from './net'
import type { HistoryBlocksDiff } from './net'
import type { Version } from '../types'

export const historyApi = {
  history: (id: string) => req<Version[]>(`${P(id)}/history`),
  historyVersion: (id: string, sha: string) => req<{ sha: string; content: string }>(`${P(id)}/history/${encodeURIComponent(sha)}`),
  historyDiff: (id: string, a: string, b = 'work') =>
    req<{ a: string; b: string; diff: string }>(`${P(id)}/history/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  historyDiffBlocks: (id: string, a: string, b = 'work', signal?: AbortSignal) =>
    req<HistoryBlocksDiff>(`${P(id)}/history/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&format=blocks`, { signal }),
  restoreVersion: (id: string, sha: string) =>
    req<{ ok: boolean; content: string; sha_new: string; changed: boolean }>(`${P(id)}/history/${sha}/restore`, { method: 'POST' }),

  /* ---- 轨道 E · AI（09 §3.1；占位 501 not_implemented，detail=单元名）---- */
}
