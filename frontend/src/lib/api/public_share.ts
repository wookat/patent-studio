import { P, PUB, REQ_TIMEOUT_MS, netFetch, req, reqSignal, handle } from './net'
import type { Ast } from '@/types/ast'
import type { Confirmation, PublicComment, PublicCommentIn, PublicConfirmIn, PublicShareLink, PublicShareLinkIn, PublicShareMeta } from '@/types/public-share'

const revisionQuery = (revision?: Pick<PublicShareMeta, 'version' | 'sha' | 'content_sha'> | null) => revision
  ? `?${new URLSearchParams({ expected_version: String(revision.version), expected_sha: revision.sha, expected_content_sha: revision.content_sha })}`
  : ''

export const publicShareApi = {
  publicLinks: (id: string) => req<PublicShareLink[]>(`${P(id)}/public-links`),
  createPublicLink: (id: string, body: PublicShareLinkIn) =>
    req<PublicShareLink>(`${P(id)}/public-links`, { method: 'POST', body: JSON.stringify(body) }),
  revokePublicLink: (id: string, token: string) =>
    req<void>(`${P(id)}/public-links/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  /** 免登录客户审阅 `/api/public/{token}/*`（不暴露 export / 源码 / 附件） */
  publicMeta: (token: string, signal?: AbortSignal) => req<PublicShareMeta>(`${PUB(token)}/meta`, { signal }),
  publicPdfUrl: (token: string, revision?: PublicShareMeta | null) => `${PUB(token)}/pdf${revisionQuery(revision)}`,
  publicAst: (token: string, signal?: AbortSignal, revision?: PublicShareMeta) => req<Ast>(`${PUB(token)}/ast${revisionQuery(revision)}`, { signal }),
  publicLayoutCss: async (token: string, signal?: AbortSignal) => {
    const r = await netFetch(`${PUB(token)}/layout-css`, { signal: reqSignal(signal, REQ_TIMEOUT_MS) })
    if (!r.ok) return handle<string>(r)
    return r.text()
  },
  publicComments: (token: string, signal?: AbortSignal) => req<PublicComment[]>(`${PUB(token)}/comments`, { signal }),
  addPublicComment: (token: string, body: PublicCommentIn) =>
    req<PublicComment>(`${PUB(token)}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  publicConfirm: (token: string, body: PublicConfirmIn) =>
    req<Confirmation>(`${PUB(token)}/confirm`, { method: 'POST', body: JSON.stringify(body) }),

  /** 案件时间线 / 备注 / 审阅指派（share-confirm-backend） */
  /** 时间线：后端返回合并全量（stored+history+audit≤500+case），无服务端 limit——勿再传死参 */
}
