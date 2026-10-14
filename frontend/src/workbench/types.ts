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
export type Approval = S['ApprovalOut']
export type Notification = S['NotificationOut']
export type Participant = S['ParticipantOut']
export type ParticipantRole = S['ParticipantIn']['role']
export type Membership = S['MembershipOut']
export type Invitation = S['InvitationOut']
export type InvitationRole = S['InvitationIn']['role']
export type Principal = S['PrincipalOut']
export type Operation = S['OperationOut']

// 服务端 status 是开放式 string；UI 仍按已知集合收窄做筛选/标色。
export type CaseStatus = 'intake' | 'drafting' | 'review' | 'client_review' | 'final' | 'filed' | 'oa' | 'granted' | 'rejected' | 'closed'
export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'canceled'
