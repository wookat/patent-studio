import { P, qs, req } from './net'
import type { BulkAction, BulkResult, CasePatch, CaseStatus, CaseSummary, ListState, Tag } from '@/types/case'
import type { DeadlineItem, DeadlineListResponse, DeadlineOverrideIn, DeadlineRange } from '@/types/deadlines'
import type { BundleIn, DeliverError, DeliverManifest } from '@/types/deliver'
import type { Notification, NotificationListResponse, NudgeIn, NudgeResult } from '@/types/notify'
import type { NoteIn, ReviewAssignIn, ReviewAssignResult, TimelineEvent, TimelineResponse } from '@/types/timeline'

export const lifecycleApi = {
  getCase: (id: string) => req<CaseSummary>(`${P(id)}/case`),
  putCase: (id: string, patch: CasePatch) => req<CaseSummary>(`${P(id)}/case`, { method: 'PUT', body: JSON.stringify(patch) }),
  setCaseStatus: (id: string, status: CaseStatus, note = '') =>
    req<CaseSummary>(`${P(id)}/case/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  tags: () => req<{ tags: Tag[] }>('/api/tags'),
  createTag: (tag: Tag) => req<{ tags: Tag[] }>('/api/tags', { method: 'POST', body: JSON.stringify(tag) }),
  updateTag: (name: string, patch: Partial<Tag>) =>
    req<{ tags: Tag[] }>(`/api/tags/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteTag: (name: string) => req<void>(`/api/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** 当前用户视角的归档 / 回收站 / 恢复 */
  setListState: (id: string, state: ListState) =>
    req<{ pid: string; list_state: ListState }>(`${P(id)}/list-state`, { method: 'POST', body: JSON.stringify({ state }) }),
  /** 永久删除（owner；须先在回收站） */
  deleteProject: (id: string) => req<void>(P(id), { method: 'DELETE' }),
  /** 退出共享给我的案卷（非 owner） */
  leaveProject: (id: string) => req<void>(`${P(id)}/leave`, { method: 'POST' }),
  bulk: (body: BulkAction) => req<BulkResult>('/api/projects/bulk', { method: 'POST', body: JSON.stringify(body) }),

  // ---- W4-E E1 递交页（docs/plan/17 §2.3；E1 落地前后端 501 not_implemented）----
  /** 导出包清单：六项各自最近产物的时间 / 大小 / 下载 URL */
  deliverManifest: (id: string) => req<DeliverManifest>(`${P(id)}/deliver`),
  /** 全部打包：同步跑 build(PDF)+XML+修订 DOCX+附图 zip → .studio/deliver/bundle.zip，返回新清单 */
  deliverBundle: (id: string, body: BundleIn = {}) =>
    req<DeliverManifest>(`${P(id)}/deliver/bundle`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: false, // 同步跑 build+XML+修订 DOCX+zip
    }),
  deliverBundleUrl: (id: string) => `${P(id)}/deliver/bundle.zip`,

  // ---- W4-E E2 账户 / 机构管理（17 §3；auth=off 时 me / admin users 501，org 可读写）----
  /** 个人资料 + 改密（带当前密码核对）；唯一的资料/改密入口（fastapi-users 原生 PATCH 已下线） */
  deliverErrors: (id: string, signal?: AbortSignal) => req<{ errors: DeliverError[] }>(`${P(id)}/deliver/errors`, { signal }),
  deadlines: (params: { range?: DeadlineRange; owner?: string; client?: string; kind?: string; pid?: string } = {}, signal?: AbortSignal) =>
    req<DeadlineListResponse>(`/api/deadlines${qs(params)}`, { signal }),
  /** 按 case.dates.* 重算 auto 期限（不动 manual / done） */
  overrideDeadline: (id: string, deadlineId: string, body: DeadlineOverrideIn) =>
    req<DeadlineItem>(`${P(id)}/deadlines/${encodeURIComponent(deadlineId)}`, { method: 'PUT', body: JSON.stringify(body) }),
  doneDeadline: (id: string, deadlineId: string, done = true) =>
    req<DeadlineItem>(`${P(id)}/deadlines/${encodeURIComponent(deadlineId)}/done`, { method: 'POST', body: JSON.stringify({ done }) }),

  /** 通知（notify-audit-backend） */
  notifications: (params: { unread?: boolean; limit?: number; before_id?: string } = {}, signal?: AbortSignal) =>
    req<NotificationListResponse>(`/api/notify${qs(params)}`, { signal }),
  readNotification: (nid: string) => req<Notification>(`/api/notify/${encodeURIComponent(nid)}/read`, { method: 'POST' }),
  readAllNotifications: () => req<{ updated: number }>('/api/notify/read-all', { method: 'POST' }),
  /** 主管催办 → 责任人通知 +1 */
  nudge: (id: string, body: NudgeIn = {}) => req<NudgeResult>(`${P(id)}/nudge`, { method: 'POST', body: JSON.stringify(body) }),
  /** webhook 发送测试（空 url = 用已存 settings.notify_webhook_url） */
  testWebhook: (id: string, url?: string) =>
    req<{ ok: boolean; detail: string }>(`${P(id)}/notify/test`, { method: 'POST', body: JSON.stringify({ url: url ?? null }) }),

  /** 公开链接管理（登录态；share-confirm-backend） */
  timeline: (id: string, signal?: AbortSignal) => req<TimelineResponse>(`${P(id)}/timeline`, { signal }),
  addNote: (id: string, body: NoteIn) => req<TimelineEvent>(`${P(id)}/notes`, { method: 'POST', body: JSON.stringify(body) }),
  reviewAssign: (id: string, body: ReviewAssignIn) =>
    req<ReviewAssignResult>(`${P(id)}/review-assign`, { method: 'POST', body: JSON.stringify(body) }),

  /** 智能体（agent-core-backend）：job 与事件沉用 aiJob / aiJobEventsUrl（帧为 StepEvent） */
}
