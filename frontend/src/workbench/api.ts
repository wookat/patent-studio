import { handle, netFetch, req } from '@/lib/api/net'
import type { Ast } from '@/types/ast'
import type { Approval, Book, CaseStatus, Document, Figure, Invitation, InvitationRole, Membership, Notification, Participant, ParticipantRole, PlatformCase, Principal, Proposal, Ref, Release, Revision, WorkItem, WorkItemStatus, WorkingCopy } from './types'

const V1 = '/api/v1'

const key = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** B12 编辑器：POST /documents/{id}/ast 的返回（ast = kernel ast_schema.json v1；content = 实际被解析的三书合一文本）。 */
export interface DocumentAstResult {
  ast: Ast
  content: string
}

/** 无修订文档开工作副本时服务端要求的显式 content_ref（空正文的 sha256 寻址 ref）。 */
export const EMPTY_CONTENT_REF: Ref = {
  key: 'sha256/e3/b0/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  size: 0,
  content_type: 'text/markdown; charset=utf-8',
}

// 所有写操作统一注入 Idempotency-Key；重放同一 key 服务端返回首个已完成的响应。
const write = <T>(url: string, init: RequestInit = {}) =>
  req<T>(url, { method: 'POST', ...init, headers: { 'Idempotency-Key': key(), ...(init.headers ?? {}) } })

export const workbenchApi = {
  me: (signal?: AbortSignal) => req<Principal>(`${V1}/principals/me`, { signal }),
  cases: (signal?: AbortSignal) => req<PlatformCase[]>(`${V1}/cases`, { signal }),
  case: (caseId: string, signal?: AbortSignal) => req<PlatformCase>(`${V1}/cases/${caseId}`, { signal }),
  workItems: (signal?: AbortSignal) => req<WorkItem[]>(`${V1}/work-items`, { signal }),
  caseWorkItems: (caseId: string, signal?: AbortSignal) => req<WorkItem[]>(`${V1}/cases/${caseId}/work-items`, { signal }),
  documents: (caseId: string, signal?: AbortSignal) => req<Document[]>(`${V1}/cases/${caseId}/documents`, { signal }),
  createDocument: (caseId: string, book: Book) =>
    write<Document>(`${V1}/cases/${caseId}/documents`, { body: JSON.stringify({ book }) }),
  revisions: (documentId: string, signal?: AbortSignal) => req<Revision[]>(`${V1}/documents/${documentId}/revisions`, { signal }),
  document: (documentId: string, signal?: AbortSignal) => req<Document>(`${V1}/documents/${documentId}`, { signal }),
  /** B12：kernel AST。content=null → 解析 current revision；否则按所给单书正文解析（编辑器未落盘内容的预览/刷新）。 */
  documentAst: (documentId: string, content: string | null, signal?: AbortSignal) =>
    req<DocumentAstResult>(`${V1}/documents/${documentId}/ast`, { method: 'POST', body: JSON.stringify({ content }), signal }),
  /** B12：本人对该文稿的工作副本列表（最近更新在前），编辑器页据此恢复未提交草稿。 */
  workingCopies: (documentId: string, signal?: AbortSignal) =>
    req<WorkingCopy[]>(`${V1}/documents/${documentId}/working-copies`, { signal }),
  openWorkingCopy: (documentId: string, baseRevisionId: string | null, contentRef?: Ref) =>
    write<WorkingCopy>(`${V1}/documents/${documentId}/working-copies`, {
      // 无修订文档必须显式给 content_ref（域层 DocumentError）
      body: JSON.stringify({ base_revision_id: baseRevisionId, content_ref: contentRef ?? null }),
    }),
  workingCopyContent: async (workingCopyId: string, signal?: AbortSignal) => {
    const response = await netFetch(`${V1}/working-copies/${workingCopyId}/content`, { signal })
    if (!response.ok) return handle<string>(response)
    return response.text()
  },
  saveWorkingCopyContent: (workingCopyId: string, expectedVersion: number, content: string) =>
    write<WorkingCopy>(`${V1}/working-copies/${workingCopyId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ expected_version: expectedVersion, content }),
    }),
  commitWorkingCopy: (workingCopyId: string, expectedVersion: number) =>
    write<{ operation_id: string; status: string }>(`${V1}/working-copies/${workingCopyId}/commit`, {
      body: JSON.stringify({ expected_version: expectedVersion }),
    }),
  flushCollab: (workingCopyId: string) =>
    write<{ flushed: number }>(`${V1}/working-copies/${workingCopyId}/collab/flush`),
  figures: (caseId: string, signal?: AbortSignal) => req<Figure[]>(`${V1}/cases/${caseId}/figures`, { signal }),
  proposals: (caseId: string, signal?: AbortSignal) => req<Proposal[]>(`${V1}/cases/${caseId}/proposals`, { signal }),
  decideProposal: (proposalId: string, decision: 'submit' | 'accept' | 'reject') =>
    write<Proposal>(`${V1}/proposals/${proposalId}/${decision}`),
  releases: (caseId: string, signal?: AbortSignal) => req<Release[]>(`${V1}/cases/${caseId}/releases`, { signal }),
  createRelease: (caseId: string) => write<Release>(`${V1}/cases/${caseId}/releases`),
  sealRelease: (releaseId: string) => write<Release>(`${V1}/releases/${releaseId}/seal`),
  participants: (caseId: string, signal?: AbortSignal) => req<Participant[]>(`${V1}/cases/${caseId}/participants`, { signal }),
  addParticipant: (caseId: string, principalId: string, role: ParticipantRole) =>
    write<Participant>(`${V1}/cases/${caseId}/participants`, {
      body: JSON.stringify({ principal_id: principalId, role }),
    }),
  memberships: (organizationId: string, signal?: AbortSignal) =>
    req<Membership[]>(`${V1}/organizations/${organizationId}/memberships`, { signal }),
  invite: (organizationId: string, inviteePrincipalId: string, role: InvitationRole, caseId: string | null, expiresAt: string) =>
    write<Invitation>(`${V1}/organizations/${organizationId}/invitations`, {
      body: JSON.stringify({
        invitee_principal_id: inviteePrincipalId,
        role,
        case_id: caseId,
        expires_at: expiresAt,
      }),
    }),
  approvals: (signal?: AbortSignal) => req<Approval[]>(`${V1}/approvals`, { signal }),
  notifications: (signal?: AbortSignal) => req<Notification[]>(`${V1}/notifications`, { signal }),
  markNotificationRead: (notificationId: string) =>
    write<Notification>(`${V1}/notifications/${notificationId}/read`),
  decideApproval: (approvalId: string, decision: 'approved' | 'rejected', reason?: string) =>
    write<Approval>(`${V1}/approvals/${approvalId}/decision`, {
      body: JSON.stringify({ decision, reason: reason || null }),
    }),
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) =>
    write<WorkItem>(`${V1}/work-items/${workItemId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  saveWorkingCopy: (workingCopyId: string, expectedVersion: number, contentRef: Ref) =>
    write<WorkingCopy>(`${V1}/working-copies/${workingCopyId}`, {
      method: 'PUT',
      body: JSON.stringify({ expected_version: expectedVersion, content_ref: contentRef }),
    }),
  statusLabel: (status: CaseStatus | string) => ({
    intake: '接案', drafting: '撰写', review: '内审', client_review: '客户确认', final: '定稿', filed: '已递交',
    oa: '审查意见', granted: '授权', rejected: '驳回', closed: '结案',
  } as Record<string, string>)[status] ?? status,
}
