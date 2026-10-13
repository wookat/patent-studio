import { BOOK_LABELS } from '@/lib/docset'
import type { BookName } from '@/types/ast'
import { STATUS_LABEL, type CaseStatus } from '@/types/case'

/**
 * 历史版本的提交摘要（backend/app/domain/history.py 的机器串）→ 面板人话。
 * 后端保持机器串不变（测试与 MCP 依赖），只在展示层翻译；未知串原样返回。
 *
 *   save                         保存
 *   figures                      附图更新
 *   restore <sha7>               恢复自 <sha7>
 *   backup <stamp>               旧备份 <stamp>
 *   collab:content               协同保存
 *   collab:<book>                协同保存 · <书名>
 *   AI 提案 <scenario>：<file>    原样（已是人话）
 *   case: status a → b [· note]  状态：<a> → <b>[ · note]
 *   case: update f1, f2          台账：<字段1>、<字段2>
 *   case: deadlines recompute    期限重算
 *   case: deadline override <id> → <due>   期限改期 → <due>
 *   case: deadline done <id>     期限完成
 */
const CASE_FIELD_LABEL: Record<string, string> = {
  case_no: '案号',
  kind: '类型',
  owner_user_id: '负责人',
  client: '客户',
  applicants: '申请人',
  inventors: '发明人',
  tags: '标签',
  dates: '日期',
  priority: '优先权',
  attorney: '代理师',
  reviewer: '审核人',
  client_contact: '客户联系人',
  fee_status: '费用状态',
  deadlines: '期限',
  archived: '归档',
}

const statusLabel = (s: string) => (s in STATUS_LABEL ? STATUS_LABEL[s as CaseStatus] : s)

export function versionLabel(message: string): string {
  if (message === 'save') return '保存'
  if (message === 'figures') return '附图更新'
  const rb = /^(restore|backup) (.+)$/.exec(message)
  if (rb) return `${rb[1] === 'restore' ? '恢复自' : '旧备份'} ${rb[2]}`
  const collab = /^collab:(.+)$/.exec(message)
  if (collab) {
    const book = collab[1]
    if (book === 'content') return '协同保存'
    return `协同保存 · ${book in BOOK_LABELS ? BOOK_LABELS[book as BookName] : book}`
  }
  const status = /^case: status (\S+) → (\S+)(?: · (.*))?$/.exec(message)
  if (status) return `状态：${statusLabel(status[1])} → ${statusLabel(status[2])}${status[3] ? ` · ${status[3]}` : ''}`
  const update = /^case: update (.+)$/.exec(message)
  if (update) return `台账：${update[1].split(', ').map((f) => CASE_FIELD_LABEL[f] ?? f).join('、')}`
  if (message === 'case: deadlines recompute') return '期限重算'
  const override = /^case: deadline override \S+ → (\S+)$/.exec(message)
  if (override) return `期限改期 → ${override[1]}`
  if (/^case: deadline done /.test(message)) return '期限完成'
  return message
}
