// 服务端数据类型唯一来源：openapi-typescript 由后端 /openapi.json 生成（见 package.json gen:api-types）。
// 本文件只做别名与 UI 侧的字面量收窄，不重复手写字段。
import type { components } from './openapi.gen'

type S = components['schemas']

export type PlatformCase = S['CaseOut']
export type CaseKind = PlatformCase['kind']
export type WorkItem = S['WorkItemOut']
export type Ref = S['Ref']
export type Document = S['DocumentOut']
export type Book = Document['book']
export type Revision = S['RevisionOut']
export type WorkingCopy = S['WorkingCopyOut']
export type Proposal = S['ProposalOut']
export type Figure = S['FigureOut']
export type Release = S['ReleaseOut']
export type ReleaseItem = S['ReleaseItemOut']
export type Approval = S['ApprovalOut']
export type Notification = S['NotificationOut']
export type Participant = S['ParticipantOut']
// Z12：DB 约束与 InvitationIn 已含 'agent'（承办人角色），openapi.gen 冻结早于该扩展——手写补齐
export type ParticipantRole = S['ParticipantIn']['role'] | 'agent'
export type PlatformOrg = S['OrganizationOut']
export type Membership = S['MembershipOut'] & { display_name?: string | null }
export type Invitation = S['InvitationOut']
export type InvitationRole = S['InvitationIn']['role'] | 'agent'
export type Principal = S['PrincipalOut']
export type Operation = S['OperationOut']
export type Run = S['RunOut']
export type RunEvent = S['RunEventOut']

// 服务端 status 是开放式 string；UI 仍按已知集合收窄做筛选/标色。
export type CaseStatus = 'intake' | 'drafting' | 'review' | 'client_review' | 'final' | 'filed' | 'oa' | 'granted' | 'rejected' | 'closed'
export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'canceled'

/** B17 M4：openapi.gen 冻结早于 B10（materials/facts）——与 FigureRevision/Artifact 同法手写对齐 schemas。 */
export interface Material {
  id: string
  case_id: string
  kind: string
  title: string
  source_url: string | null
  content_ref: Ref | null
  status: string
  created_at: string
}
export interface Fact {
  id: string
  case_id: string
  material_id: string | null
  anchor_id: string | null
  statement: string
  status: string
  rejection_reason: string | null
  decided_by_principal_id: string | null
  decided_at: string | null
  created_at: string
}
