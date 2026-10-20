import { handle, netFetch, req } from '@/lib/api/net'

/** B17：平台 v1 面统一不触发全局 expireSession——纯旧案（PG 无此用户）时 v1 恒 401，
    由调用方 fail-closed 隐藏新面，不把旧会话踢下线。 */
const v1req = <T>(url: string, init?: Parameters<typeof req>[1]) => req<T>(url, { ...(init ?? {}), expireOn401: false })
import type { Ast } from '@/types/ast'
import type { PreflightReport } from '@/types/preflight'
import type { Approval, Book, CaseStatus, Document, Fact, Figure, Invitation, InvitationRole, Material, Membership, MethodAsset, MethodAssetUse, Notification, Participant, ParticipantRole, PlatformCase, PlatformOrg, Principal, Proposal, Ref, Release, ReleaseItem, Revision, Run, RunEvent, WorkItem, WorkItemQueuePage, WorkItemStatus, WorkingCopy } from './types'

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

/** B13：POST /figures/{id}/revisions 返回（openapi.gen 冻结早于该端点，手写对齐 schemas.FigureRevisionOut）。 */
export interface FigureRevision {
  id: string
  figure_document_id: string
  revision_no: number
  parent_revision_id: string | null
  content_ref: Ref
  source: string
}

/** B13：POST /releases/{id}/build 返回（openapi.gen 冻结早于该端点，手写对齐 schemas.ArtifactOut）。 */
export interface Artifact {
  id: string
  release_id: string
  filename: string
  content_ref: Ref
  inputs: Record<string, unknown>[]
  created_at: string
}

// 所有写操作统一注入 Idempotency-Key；重放同一 key 服务端返回首个已完成的响应。
const write = <T>(url: string, init: RequestInit = {}) =>
  v1req<T>(url, { method: 'POST', ...init, headers: { 'Idempotency-Key': key(), ...(init.headers ?? {}) } })

export const workbenchApi = {
  me: (signal?: AbortSignal) => v1req<Principal>(`${V1}/principals/me`, { signal }),
  organizations: (signal?: AbortSignal) => v1req<PlatformOrg[]>(`${V1}/organizations`, { signal }),
  createCase: (organizationId: string, input: { case_key: string; title: string; kind?: PlatformCase['kind'] }) =>
    write<PlatformCase>(`${V1}/organizations/${organizationId}/cases`, { body: JSON.stringify(input) }),
  /** Z29 规模化台账：服务端分页（稳定排序 updated_at desc, case_key, id）；q=case_key 前缀或 title 子串 */
  casesPage: (params: { limit?: number; offset?: number; q?: string; kind?: string; status?: string; organization_id?: string }, signal?: AbortSignal) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, String(v))
    return v1req<{ items: PlatformCase[]; total: number; limit: number; offset: number }>(`${V1}/cases/page?${sp}`, { signal })
  },
  /** Z29：legacy pid → 平台案精确作用域；返回全部同 key 可见案（0/1/N），不拉全库 */
  casesByKey: (caseKey: string, signal?: AbortSignal) =>
    v1req<PlatformCase[]>(`${V1}/cases/by-key/${encodeURIComponent(caseKey)}`, { signal }),
  case: (caseId: string, signal?: AbortSignal) => v1req<PlatformCase>(`${V1}/cases/${caseId}`, { signal }),
  /** 阶段6：工作项队列服务端分页（与 /cases/page 同款 limit/offset 口径）。
      assignee=me|none、status、q（标题/案件号子串）先于分页过滤，total 与筛选口径一致。 */
  workItems: (params: { limit?: number; offset?: number; status?: string; q?: string; assignee?: 'me' | 'none' }, signal?: AbortSignal) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, String(v))
    return v1req<WorkItemQueuePage>(`${V1}/work-items?${sp}`, { signal })
  },
  caseWorkItems: (caseId: string, signal?: AbortSignal) => v1req<WorkItem[]>(`${V1}/cases/${caseId}/work-items`, { signal }),
  /* ---- Z30 机构私有方法库：人工录入脱敏方法卡；仅 authorized 可检索；use 留痕 ---- */
  methodAssets: (orgId: string, q?: string, allStates?: boolean, signal?: AbortSignal) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (allStates) sp.set('all_states', 'true')
    return v1req<MethodAsset[]>(`${V1}/organizations/${orgId}/method-assets?${sp}`, { signal })
  },
  createMethodAsset: (
    orgId: string,
    input: {
      title: string
      body: string
      source?: 'manual' | 'curated'
      asset_type: 'method' | 'expression'
      provenance: string
      authorized_scope: string
      deidentified_confirmed: boolean
    },
  ) => write<MethodAsset>(`${V1}/organizations/${orgId}/method-assets`, { body: JSON.stringify(input) }),
  confirmMethodAsset: (
    assetId: string,
    input: { asset_type: 'method' | 'expression'; provenance: string; authorized_scope: string; deidentified_confirmed: boolean },
  ) => write<MethodAsset>(`${V1}/method-assets/${assetId}/confirm`, { body: JSON.stringify(input) }),
  authorizeMethodAsset: (assetId: string) => write<MethodAsset>(`${V1}/method-assets/${assetId}/authorize`),
  revokeMethodAsset: (assetId: string) => write<MethodAsset>(`${V1}/method-assets/${assetId}/revoke`),
  useMethodAsset: (assetId: string, input: { case_id?: string; note?: string }) =>
    write<MethodAssetUse>(`${V1}/method-assets/${assetId}/use`, { body: JSON.stringify(input) }),
  methodAssetUses: (assetId: string, signal?: AbortSignal) =>
    v1req<MethodAssetUse[]>(`${V1}/method-assets/${assetId}/uses`, { signal }),
  documents: (caseId: string, signal?: AbortSignal) => v1req<Document[]>(`${V1}/cases/${caseId}/documents`, { signal }),
  createDocument: (caseId: string, book: Book) =>
    write<Document>(`${V1}/cases/${caseId}/documents`, { body: JSON.stringify({ book }) }),
  revisions: (documentId: string, signal?: AbortSignal) => v1req<Revision[]>(`${V1}/documents/${documentId}/revisions`, { signal }),
  document: (documentId: string, signal?: AbortSignal) => v1req<Document>(`${V1}/documents/${documentId}`, { signal }),
  /** B12：kernel AST。content=null → 解析 current revision；否则按所给单书正文解析（编辑器未落盘内容的预览/刷新）。 */
  documentAst: (documentId: string, content: string | null, signal?: AbortSignal) =>
    v1req<DocumentAstResult>(`${V1}/documents/${documentId}/ast`, { method: 'POST', body: JSON.stringify({ content }), signal }),
  /** B12：本人对该文稿的工作副本列表（最近更新在前），编辑器页据此恢复未提交草稿。 */
  workingCopies: (documentId: string, signal?: AbortSignal) =>
    v1req<WorkingCopy[]>(`${V1}/documents/${documentId}/working-copies`, { signal }),
  openWorkingCopy: (documentId: string, baseRevisionId: string | null, contentRef?: Ref) =>
    write<WorkingCopy>(`${V1}/documents/${documentId}/working-copies`, {
      // 无修订文档必须显式给 content_ref（域层 DocumentError）
      body: JSON.stringify({ base_revision_id: baseRevisionId, content_ref: contentRef ?? null }),
    }),
  workingCopyContent: async (workingCopyId: string, signal?: AbortSignal) => {
    const response = await netFetch(`${V1}/working-copies/${workingCopyId}/content`, { signal })
    if (!response.ok) return handle<string>(response, { expireOn401: false })
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
  figures: (caseId: string, signal?: AbortSignal) => v1req<Figure[]>(`${V1}/cases/${caseId}/figures`, { signal }),
  createFigure: (caseId: string, input: { figure_no: number | null; title: string }) =>
    write<Figure>(`${V1}/cases/${caseId}/figures`, { body: JSON.stringify(input) }),
  /** B13：multipart 上传图片 → 新 FigureRevision（req 对 FormData 自动免 JSON 头/超时）。 */
  uploadFigureImage: (figureId: string, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return write<FigureRevision>(`${V1}/figures/${figureId}/revisions`, { body: form })
  },
  /** 附图当前修订图片地址：cookie 会话鉴权，<img src> 直连；current_revision_id 作 cache-bust。 */
  figureContentUrl: (figure: Figure) =>
    `${V1}/figures/${figure.id}/content?v=${figure.current_revision_id ?? 'empty'}`,
  proposals: (caseId: string, signal?: AbortSignal) => v1req<Proposal[]>(`${V1}/cases/${caseId}/proposals`, { signal }),
  decideProposal: (proposalId: string, decision: 'submit' | 'accept' | 'reject') =>
    write<Proposal>(`${V1}/proposals/${proposalId}/${decision}`),
  releases: (caseId: string, signal?: AbortSignal) => v1req<Release[]>(`${V1}/cases/${caseId}/releases`, { signal }),
  createRelease: (caseId: string) => write<Release>(`${V1}/cases/${caseId}/releases`),
  sealRelease: (releaseId: string) => write<Release>(`${V1}/releases/${releaseId}/seal`),
  releaseItems: (releaseId: string, signal?: AbortSignal) =>
    v1req<ReleaseItem[]>(`${V1}/releases/${releaseId}/items`, { signal }),
  addReleaseItem: (releaseId: string, item: { item_kind: 'document' | 'figure'; revision_id: string; ordinal?: number }) =>
    write<ReleaseItem>(`${V1}/releases/${releaseId}/items`, { body: JSON.stringify(item) }),
  buildRelease: (releaseId: string) => write<Artifact>(`${V1}/releases/${releaseId}/build`),
  releaseArtifacts: (releaseId: string, signal?: AbortSignal) =>
    v1req<Artifact[]>(`${V1}/releases/${releaseId}/artifacts`, { signal }),
  /** DOCX 产物下载地址：cookie 会话鉴权，<a download> 直连。 */
  artifactUrl: (artifactId: string) => `${V1}/artifacts/${artifactId}/content`,
  /** B13：案件体检（三书 current revisions → kernel preflight.run）。 */
  preflight: (caseId: string, signal?: AbortSignal) =>
    v1req<PreflightReport>(`${V1}/cases/${caseId}/preflight`, { signal }),
  setWorkItemDeadline: (workItemId: string, deadline: string | null) =>
    write<WorkItem>(`${V1}/work-items/${workItemId}/deadline`, {
      method: 'PUT',
      body: JSON.stringify({ deadline }),
    }),
  participants: (caseId: string, signal?: AbortSignal) => v1req<Participant[]>(`${V1}/cases/${caseId}/participants`, { signal }),
  addParticipant: (caseId: string, principalId: string, role: ParticipantRole) =>
    write<Participant>(`${V1}/cases/${caseId}/participants`, {
      body: JSON.stringify({ principal_id: principalId, role }),
    }),
  memberships: (organizationId: string, signal?: AbortSignal) =>
    v1req<Membership[]>(`${V1}/organizations/${organizationId}/memberships`, { signal }),
  invite: (organizationId: string, inviteePrincipalId: string, role: InvitationRole, caseId: string | null, expiresAt: string) =>
    write<Invitation>(`${V1}/organizations/${organizationId}/invitations`, {
      body: JSON.stringify({
        invitee_principal_id: inviteePrincipalId,
        role,
        case_id: caseId,
        expires_at: expiresAt,
      }),
    }),
  approvals: (signal?: AbortSignal) => v1req<Approval[]>(`${V1}/approvals`, { signal }),
  notifications: (signal?: AbortSignal) => v1req<Notification[]>(`${V1}/notifications`, { signal }),
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
  /** Z11/Z12：登记新案生成撰写工作项（type='draft'；可随案直接分派承办人） */
  createWorkItem: (caseId: string, input: { type: WorkItem['type']; title: string; assignee_principal_id?: string | null; deadline?: string | null; priority?: number }) =>
    write<WorkItem>(`${V1}/cases/${caseId}/work-items`, { body: JSON.stringify(input) }),
  saveWorkingCopy: (workingCopyId: string, expectedVersion: number, contentRef: Ref) =>
    write<WorkingCopy>(`${V1}/working-copies/${workingCopyId}`, {
      method: 'PUT',
      body: JSON.stringify({ expected_version: expectedVersion, content_ref: contentRef }),
    }),
  /** B17 M4：案件资料（B10）——上传件/链接材料，事实确认的真源。 */
  materials: (caseId: string, signal?: AbortSignal) => v1req<Material[]>(`${V1}/cases/${caseId}/materials`, { signal }),
  /** 资料原文下载地址：cookie 会话鉴权，<a> 直连。 */
  materialContentUrl: (materialId: string) => `${V1}/materials/${materialId}/content`,
  facts: (caseId: string, signal?: AbortSignal) => v1req<Fact[]>(`${V1}/cases/${caseId}/facts`, { signal }),
  confirmFact: (factId: string) => write<Fact>(`${V1}/facts/${factId}/confirm`),
  rejectFact: (factId: string, reason: string | null) =>
    write<Fact>(`${V1}/facts/${factId}/reject`, { body: JSON.stringify({ reason }) }),
  /** B17 M4 补口：案件运行列表（GET /cases/{id}/runs）与运行事件（GET /runs/{id}/events）。 */
  runs: (caseId: string, signal?: AbortSignal) => v1req<Run[]>(`${V1}/cases/${caseId}/runs`, { signal }),
  runEvents: (runId: string, signal?: AbortSignal) => v1req<RunEvent[]>(`${V1}/runs/${runId}/events`, { signal }),
  statusLabel: (status: CaseStatus | string) => ({
    intake: '接案', drafting: '撰写', review: '内审', client_review: '客户确认', final: '定稿', filed: '已递交',
    oa: '审查意见', granted: '授权', rejected: '驳回', closed: '结案',
  } as Record<string, string>)[status] ?? status,
}
