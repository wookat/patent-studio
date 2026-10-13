import { blockPath, req } from './net'
import type { BlockEditResult, BlockTemplate, InsertBlockInput } from './net'
import type { Settings } from '../types'
import type { PreflightReport } from '@/types/preflight'

export const blocksApi = {
  getPreflight: (id: string, body: { content?: string; settings?: Settings } = {}, signal?: AbortSignal) =>
    req<PreflightReport>(`/api/projects/${encodeURIComponent(id)}/preflight`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  /** R3：改块。content 传编辑区当前全文（未保存改动不丢） */
  patchBlock: (id: string, blockId: string, body: { markdown: string; content?: string; settings?: Settings; base?: string }) =>
    req<BlockEditResult>(`/api/projects/${encodeURIComponent(id)}/blocks/${blockPath(blockId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  insertBlock: (id: string, body: InsertBlockInput & { content?: string; settings?: Settings }) =>
    req<BlockEditResult>(`/api/projects/${encodeURIComponent(id)}/blocks`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBlock: (id: string, blockId: string, body: { content?: string; settings?: Settings } = {}) =>
    req<BlockEditResult>(`/api/projects/${encodeURIComponent(id)}/blocks/${blockPath(blockId)}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),
  /** W4-D D1：项目排版参数 → 版面视图 CSS（text/css；prep 501 → ApiError） */
  blockTemplates: () => req<{ templates: BlockTemplate[] }>('/api/block-templates'),

  /* ---- R6 账号（07 §4.1；auth=off 时后端 501 not_implemented）---- */
  /** 204（auth=off，无用户）→ undefined；401 → ApiError（需登录） */
}
