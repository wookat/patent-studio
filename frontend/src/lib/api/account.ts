import { P, REQ_TIMEOUT_MS, netFetch, qs, req, handle } from './net'
import type { AuditEntry, Pat, PatCreated, User } from '../types'
import type { AdminUser, AdminUserIn, MeIn, Org } from '@/types/account'
import type { AiUsageSummary, OrgAuditQuery, OrgAuditResponse, OrgSettings } from '@/types/org'

export const accountApi = {
  me: () => req<User | undefined>('/api/users/me'),
  register: (email: string, password: string, display_name = '') =>
    req<User>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),
  /** fastapi-users 规范：form-urlencoded username/password；204 + Set-Cookie studio_session */
  login: async (email: string, password: string) => {
    const r = await netFetch('/api/auth/cookie/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }).toString(),
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    })
    await handle<void>(r)
  },
  logout: () => req<void>('/api/auth/cookie/logout', { method: 'POST' }),
  putMe: (body: MeIn) => req<User>('/api/users/me', { method: 'PUT', body: JSON.stringify(body) }),
  adminUsers: () => req<AdminUser[]>('/api/admin/users'),
  updateAdminUser: (userId: string, patch: AdminUserIn) =>
    req<AdminUser>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  org: () => req<Org>('/api/admin/org'),
  putOrg: (body: Org) => req<Org>('/api/admin/org', { method: 'PUT', body: JSON.stringify(body) }),

  /* ---- R8 实时协同（docs/plan/11 §3；后端 app/collab/routes.py）---- */
  /** 房间状态；PATENT_STUDIO_COLLAB=off ⇒ {enabled:false, rooms:[]}；G1 未落地 ⇒ 501 */
  orgAudit: (q: OrgAuditQuery = {}, signal?: AbortSignal) => req<OrgAuditResponse>(`/api/admin/audit${qs(q)}`, { signal }),
  orgAuditCsvUrl: (q: OrgAuditQuery = {}) => `/api/admin/audit.csv${qs(q)}`,
  orgSettings: () => req<OrgSettings>('/api/admin/settings'),
  putOrgSettings: (patch: Partial<OrgSettings>) => req<OrgSettings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  orgAiUsage: (signal?: AbortSignal) => req<AiUsageSummary>('/api/admin/ai-usage', { signal }),
  /** 案级 `GET /ai/usage` 增 today_tokens / budget（R-AI-09） */
  aiBudget: (id: string) => req<{ today_tokens: number; budget: number }>(`${P(id)}/ai/budget`),

  /** OA 轮次（oa-import-backend）；解析 PDF 走 multipart，无文字层 → 422 oa.pdf_no_text */
  pats: () => req<Pat[]>('/api/pat'),
  createPat: (name: string) => req<PatCreated>('/api/pat', { method: 'POST', body: JSON.stringify({ name }) }),
  revokePat: (patId: string) => req<void>(`/api/pat/${encodeURIComponent(patId)}`, { method: 'DELETE' }),
  audit: (id: string, limit = 50) => req<AuditEntry[]>(`${P(id)}/audit?limit=${limit}`),

  /* ---------- R7 Word（带修订）导出（docs/plan/10 §4.2） ---------- */
}
