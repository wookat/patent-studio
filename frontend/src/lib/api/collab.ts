import { P, req } from './net'
import type { Member, Role, ShareLink } from '../types'
import type { BookName } from '@/types/ast'
import type { AccessReport, CollabSettings, EditorMode, Invite } from '@/types/collab-center'

/** 房间 = (pid, book)；`content` = 装配镜像 content.md（现有单编辑器），三书名与 BookName 一致（R4 多卡片后使用） */
export type CollabBook = BookName | 'content'
export interface CollabRoomInfo {
  book: CollabBook
  peers: number
}
export interface CollabStatusResponse {
  enabled: boolean
  /** 请求者在本案是 viewer / reviewer（AUTH=on）；off/匿名 ⇒ false */
  readonly: boolean
  /** W4-B（14 D5.2）：viewer ⇒ readonly，reviewer ⇒ review，其他 edit */
  mode: EditorMode
  rooms: CollabRoomInfo[]
}

export const collabApi = {
  members: (id: string) => req<Member[]>(`${P(id)}/members`),
  setMember: (id: string, email: string, role: Role) =>
    req<Member[]>(`${P(id)}/members`, { method: 'PUT', body: JSON.stringify({ email, role }) }),
  removeMember: (id: string, userId: string) =>
    req<Member[]>(`${P(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  shareLinks: (id: string) => req<ShareLink[]>(`${P(id)}/share`),
  createShareLink: (id: string, role: Exclude<Role, 'owner'>, expires_in_days: number | null) =>
    req<ShareLink>(`${P(id)}/share`, { method: 'POST', body: JSON.stringify({ role, expires_in_days }) }),
  revokeShareLink: (id: string, token: string) =>
    req<ShareLink[]>(`${P(id)}/share/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  /* ---- W4-B 协作者中心（docs/plan/14 §4；prep 状态下新路由 501 detail=单元名）---- */
  setMemberRole: (id: string, userId: string, role: Role) =>
    req<Member[]>(`${P(id)}/members/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  access: (id: string) => req<AccessReport>(`${P(id)}/access`),
  collabSettings: (id: string) => req<CollabSettings>(`${P(id)}/collab-settings`),
  saveCollabSettings: (id: string, patch: Partial<CollabSettings>) =>
    req<CollabSettings>(`${P(id)}/collab-settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  invites: (id: string) => req<Invite[]>(`${P(id)}/invites`),
  /** 邮箱已注册 ⇒ 200 {member}（直接成员，不建 pending）；否则 201 Invite */
  invite: (id: string, email: string, role: Exclude<Role, 'owner'>) =>
    req<Invite | { member: Member }>(`${P(id)}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  setInviteRole: (id: string, email: string, role: Exclude<Role, 'owner'>) =>
    req<Invite>(`${P(id)}/invites/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  revokeInvite: (id: string, email: string) =>
    req<Invite[]>(`${P(id)}/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  acceptShare: (token: string) =>
    req<{ pid: string; role: Role }>(`/api/share/${encodeURIComponent(token)}/accept`, { method: 'POST' }),

  /* ---- R6 修订标记与批注（07 §4.2）---- */
  collabStatus: (id: string) => req<CollabStatusResponse>(`${P(id)}/collab`),
  /** y-websocket provider 的 (serverUrl, roomname)：ws(s)://host/api/projects/{pid}/collab/{book}（同源，cookie 随握手） */
  collabWs: (id: string, book: CollabBook, loc: Pick<Location, 'protocol' | 'host'> = window.location) => ({
    serverUrl: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${P(id)}/collab`,
    roomname: book,
  }),

  /* ---------- W5 契约（docs/plan/21 §7.4.7；单元落地前后端 501 not_implemented） ---------- */

  /** 期限（deadlines-backend）：跨案列表，后端算好 due/status/days_left */
}
