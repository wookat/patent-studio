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

export const workItemTypeText = (type: string) => WORK_ITEM_TYPE_TEXT[type] ?? '未知类型'
export const workItemStatusText = (status: string) => WORK_ITEM_STATUS_TEXT[status] ?? '未知状态'

/** 队列/期限面板徽标统一色口径：done=ok、blocked=danger，其余进行中态=info，未知=neutral。 */
export const workItemStatusTone = (status: string): 'ok' | 'danger' | 'info' | 'neutral' =>
  status === 'done' ? 'ok' : status === 'blocked' ? 'danger' : status in WORK_ITEM_STATUS_TEXT ? 'info' : 'neutral'
