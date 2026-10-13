import { Construction } from 'lucide-react'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'

/**
 * 通知偏好（21 §4.6 账户页第三项）：站内 / 邮件开关需 api.notify prefs 契约；
 * 当前 lib/api.ts 只有 notifications 列表 / 已读（notify-audit-backend），无 prefs 读写 → 与其他 501 单元统一用 EmptyState「功能开发中」。
 */
export function NotifyPrefs() {
  return (
    <section data-slot="NotifyPrefs" data-testid="notify-prefs" aria-labelledby="notify-prefs-title" className="max-w-form">
      <h2 id="notify-prefs-title" className="sr-only">通知偏好</h2>
      <EmptyState
        icon={Construction}
        title={NOT_IMPLEMENTED_TITLE}
        reason="站内 / 邮件通知开关等偏好设置接口尚未提供；截止提醒与协作通知目前统一发到「收件箱」。"
        data-testid="notify-prefs-unavailable"
      />
    </section>
  )
}
