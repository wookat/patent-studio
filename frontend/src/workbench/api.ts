import { handle, netFetch, req } from '@/lib/api/net'
import type { Approval, Book, CaseStatus, Document, Figure, Invitation, InvitationRole, Membership, Notification, Participant, ParticipantRole, PlatformCase, Principal, Proposal, Ref, Release, Revision, WorkItem, WorkItemStatus, WorkingCopy } from './types'

const V1 = '/api/v1'

const key = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
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
  openWorkingCopy: (documentId: string, baseRevisionId: string | null) =>
    write<WorkingCopy>(`${V1}/documents/${documentId}/working-copies`, {
      body: JSON.stringify({ base_revision_id: baseRevisionId }),
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
