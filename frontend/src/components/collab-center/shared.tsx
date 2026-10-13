import type { ReactNode } from 'react'
import { colorFor, labelText, userColor } from '@/collab/colors'
import { Avatar as UiAvatar, type AvatarProps as UiAvatarProps } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 协作者中心各段共用的小件（docs/plan/14 §6.2 / §6.4 / §6.6；W6 05 §3.9）；纯函数见 ./format.ts。 */

export interface AvatarProps {
  name: string
  /** 有账号对象时传它：取账户预设头像色（与顶栏 / 台账同色），否则按 name 派生 */
  user?: { display_name?: string | null; email?: string | null; avatar_color?: string | null } | null
  /** 直接给色（如协同 awareness 里对方广播的光标色），优先于 user / name */
  color?: string
  size?: UiAvatarProps['size']
  className?: string
  /** 在线：右下 --ok-dot 点（不只靠颜色，带 aria-label） */
  online?: boolean
  /** 离线 / 未查看：降低不透明度 */
  dimmed?: boolean
}

/** 首字头像（ui/Avatar 24 / 32 / 40）：底色与顶栏在线头像 / 远端光标一致（colorFor(name) 是协同数据色，非样式） */
export function Avatar({ name, user, color: colorProp, size = 'sm', className, online, dimmed }: AvatarProps) {
  const color = colorProp ?? (user ? userColor(user) : colorFor(name))
  return (
    <span className={cn('relative inline-flex shrink-0', dimmed && 'opacity-60')} data-testid="collab-avatar" data-online={online || undefined}>
      <UiAvatar size={size} name={name} color={color} style={{ color: labelText(color) }} className={className} />
      {online && (
        <span
          role="img"
          aria-label="在线"
          title="在线"
          className={cn('absolute -bottom-px -right-px rounded-full bg-ok-dot ring-2 ring-panel', size === 'sm' ? 'size-2' : 'size-2.5')}
          data-testid="collab-online-dot"
        />
      )}
    </span>
  )
}

/** 在线点（§6.6：不只靠颜色——role=img + aria-label，离线时不渲染点但保留 sr-only 文字） */
/** 段内提示（501 / 权限门槛）：虚线框 + --bg-sunken，12px */
export function SectionHint({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-sunken px-3 py-2 text-xs leading-5 text-fg-muted" role="status" data-testid={testId}>
      {children}
    </p>
  )
}

/** 段内读失败行：危险底 + 错误文案 + 行内重试（auditError / publicLinksError 同款；501 不可用走 SectionHint，不走这里） */
export function ErrorLine({ label, error, onRetry, testId }: { label: string; error: string; onRetry: () => void; testId: string }) {
  return (
    <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger-fg" data-testid={testId}>
      {label}：{error}
      <Button size="xs" variant="link" className="ml-1 px-1" onClick={onRetry} data-testid={`${testId}-retry`}>
        重试
      </Button>
    </p>
  )
}

/** 列表空行：居中 12px --fg-muted */
export function EmptyLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="py-4 text-center text-xs text-fg-muted" data-testid={testId}>
      {children}
    </p>
  )
}

/** 段标题行（12px 500 --fg-muted + 右侧计数 / 动作） */
export function SectionHead({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex h-md-control items-center justify-between gap-2">
      <h3 id={id} className="truncate text-xs font-medium text-fg-muted">
        {children}
      </h3>
      {aside && <div className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">{aside}</div>}
    </div>
  )
}
