import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * EmptyState（05 §2.7）：32px 图标（lucide strokeWidth 1.5）置于 56px r12 --bg-sunken 容器 + 标题 16/24 + 说明 14/22 + 一个次要动作（secondary / soft，不是 primary）。
 * size sm（面板 / 列内：40 容器 + 20 图标 + 13/12 字）用于伴随栏、看板空列。
 * 501 / 未实现单元统一：`<EmptyState icon={Construction} title="功能开发中" reason="…" />`
 */
/** 501 / 未落地单元统一标题（EmptyState title 与内联提示共用） */
export const NOT_IMPLEMENTED_TITLE = '功能开发中'

export interface EmptyStateProps extends React.ComponentProps<'div'> {
  icon?: LucideIcon
  /** 雕刻线插画（仅 md 英雄空态：台账全空等首屏位）——给则替代图标芯片，暗色下 invert 翻墨青→暖白 */
  illustration?: string
  title: string
  /** 为什么是空的 / 下一步 */
  reason?: React.ReactNode
  /** 次要动作（通常一个 secondary/soft <Button>） */
  action?: React.ReactNode
  size?: 'sm' | 'md'
}

function EmptyState({ className, icon: Icon, illustration, title, reason, action, size = 'md', ...props }: EmptyStateProps) {
  const reduce = useReducedMotion()
  // motion 与 HTML 同名事件签名冲突（onDrag/onAnimationStart 等）——剥离后再展开
  const { onDrag, onDragStart, onDragEnd, onAnimationStart, onAnimationEnd, onAnimationIteration, ...rest } = props
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: size === 'md' ? 8 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      data-slot="empty-state"
      data-size={size}
      role="status"
      className={cn('flex flex-col items-center justify-center text-center', size === 'md' ? 'gap-2 px-6 py-12' : 'gap-1.5 px-4 py-6', className)}
      {...rest}
    >
      {illustration && size === 'md' && (
        <img
          data-slot="empty-state-illustration"
          src={illustration}
          alt=""
          loading="lazy"
          className="mb-1 size-40 select-none dark:invert dark:opacity-90"
          aria-hidden
        />
      )}
      {(!illustration || size === 'sm') && Icon && (
        <span
          data-slot="empty-state-icon"
          className={cn('mb-1 inline-flex shrink-0 items-center justify-center rounded-xl bg-sunken text-fg-muted', size === 'md' ? 'size-14' : 'size-10 rounded-lg')}
          aria-hidden
        >
          <Icon className={size === 'md' ? 'size-8' : 'size-5'} strokeWidth={1.5} />
        </span>
      )}
      <div className={cn('font-medium text-fg-strong', size === 'md' ? 'text-lg' : 'text-sm')} data-slot="empty-state-title">{title}</div>
      {reason && <div className={cn('max-w-form-col text-fg-muted', size === 'md' ? 'text-base' : 'text-xs')} data-slot="empty-state-reason">{reason}</div>}
      {action && <div className="mt-2" data-slot="empty-state-action">{action}</div>}
    </motion.div>
  )
}

export { EmptyState }
