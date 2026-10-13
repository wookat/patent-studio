import { Switch } from '@/components/ui/switch'
import type { CollabSettings } from '@/types/collab-center'
import { cn } from '@/lib/utils'
import { ErrorLine } from './shared'

/**
 * 设置段（docs/plan/14 §6.2；飞书「文档设置」三开关）：允许下载 / 允许复制 / 允许评论。
 * D8：只存字段、前端按字段隐藏入口，服务端不拦截。prep 已可用（三个 Switch 调 onChange）。
 */
export interface SettingsSectionProps {
  settings: CollabSettings
  canManage: boolean
  unavailable: boolean
  /** 读取中：settings 还是默认值，开关禁用防误按（同 error 闸） */
  loading?: boolean
  /** 读失败（非 501）：错误行 + 重试；失败时 settings 是默认值，开关同时禁用 */
  error?: string | null
  onRetry?: () => void
  onChange: (patch: Partial<CollabSettings>) => void
}

const ITEMS: { key: keyof CollabSettings; label: string; hint: string }[] = [
  { key: 'allow_download', label: '允许下载', hint: '关闭后 viewer 看不到 DOCX / PDF 下载入口' },
  { key: 'allow_copy', label: '允许复制', hint: '关闭后 viewer 的编辑器禁用复制' },
  { key: 'allow_comment', label: '允许评论', hint: '关闭后 viewer 不能添加批注' },
]

export function SettingsSection({ settings, canManage, unavailable, loading = false, error = null, onRetry, onChange }: SettingsSectionProps) {
  return (
    <div className="flex flex-col divide-y divide-border px-3 text-sm" data-slot="SettingsSection" data-testid="collab-settings">
      {unavailable && (
        <p className="py-3 text-xs text-fg-muted" data-testid="collab-settings-unavailable">协作设置（B1-access-log）尚未实现，以下为缺省值。</p>
      )}
      {error && onRetry && <ErrorLine label="协作设置加载失败" error={error} onRetry={onRetry} testId="collab-settings-error" />}
      {ITEMS.map(({ key, label, hint }) => {
        const id = `collab-setting-${key}`
        return (
          <div key={key} className={cn('flex min-h-row-mobile items-center gap-3 py-2', unavailable && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <label htmlFor={id} className="text-sm font-medium text-fg-strong">{label}</label>
              <p className="text-xs leading-5 text-fg-muted">{hint}</p>
            </div>
            <Switch id={id} checked={settings[key]} disabled={!canManage || unavailable || !!error || loading} onCheckedChange={(v) => onChange({ [key]: v })} data-testid={id} />
          </div>
        )
      })}
    </div>
  )
}
