/**
 * 工作项枚举中文映射（阶段6）：DB CheckConstraint 全集 + 未知值「未知类型/未知状态」兜底，
 * 任何 UI 不得直接渲染 type/status 原值。
 */

export const WORK_ITEM_TYPE_TEXT: Readonly<Record<string, string>> = {
  draft: '撰写',
  review: '复核',
  figure: '附图',
  'oa-response': 'OA 答复',
  search: '检索',
  'client-confirm': '客户确认',
  deliver: '交付',
}

export const WORK_ITEM_STATUS_TEXT: Readonly<Record<string, string>> = {
  open: '待处理',
  in_progress: '进行中',
  blocked: '已阻塞',
  in_review: '待复核',
  done: '已完成',
  canceled: '已取消',
}

/* 字面量映射是带原型的普通对象：'constructor'/'toString' 等原型属性会命中函数而非
 * 走「未知」兜底，`in` 同理——一律用 Object.hasOwn 只认自有属性。 */
export const workItemTypeText = (type: string) =>
  Object.hasOwn(WORK_ITEM_TYPE_TEXT, type) ? WORK_ITEM_TYPE_TEXT[type] : '未知类型'
export const workItemStatusText = (status: string) =>
  Object.hasOwn(WORK_ITEM_STATUS_TEXT, status) ? WORK_ITEM_STATUS_TEXT[status] : '未知状态'

/** 队列/期限面板徽标统一色口径：done=ok、blocked=danger，其余进行中态=info，未知=neutral。 */
export const workItemStatusTone = (status: string): 'ok' | 'danger' | 'info' | 'neutral' =>
  status === 'done' ? 'ok' : status === 'blocked' ? 'danger' : Object.hasOwn(WORK_ITEM_STATUS_TEXT, status) ? 'info' : 'neutral'

/** 提案状态中文映射（阶段6收口）：DB CheckConstraint 全集 + 未知值兜底，UI 不渲染原值。 */
export const PROPOSAL_STATUS_TEXT: Readonly<Record<string, string>> = {
  draft: '草稿',
  submitted: '待决',
  accepted: '已采纳',
  rejected: '已拒绝',
  superseded: '已取代',
}

export const proposalStatusText = (status: string) =>
  Object.hasOwn(PROPOSAL_STATUS_TEXT, status) ? PROPOSAL_STATUS_TEXT[status] : '未知状态'

export const proposalStatusTone = (status: string): 'ok' | 'info' | 'warn' | 'neutral' =>
  status === 'accepted' ? 'ok' : status === 'submitted' ? 'info' : status === 'draft' ? 'warn' : 'neutral'
