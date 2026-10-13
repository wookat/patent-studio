import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { StatusDot } from '@/components/ui/status-dot'
import { MenuCheckRow, MenuContent, MenuLabel } from '@/components/ui/menu-bits'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { CASE_STATUSES, STATUS_LABEL, type CaseStatus } from '@/types/case'

export interface StatusPickerProps {
  pid: string
  status: CaseStatus
  /** 无写权限（viewer / editor）⇒ 只渲染 StatusDot */
  readonly?: boolean
  size?: 'sm' | 'md'
  /** 自定义触发器（默认 = StatusDot + ▾） */
  children?: ReactNode
  className?: string
}

/**
 * 行内改状态（Linear / Notion 状态属性下拉；05 §2.5 状态一律 `StatusDot` 点 + 文字并列）：
 * 触发器 = StatusDot + ▾，hover 才显底色；触控密度下命中区 ≥ 44。
 * 任意状态可跳转到任意状态，后端记一条 history 事件。成功 / 失败 toast 由 store 处理。
 */
export function StatusPicker({ pid, status, readonly, size = 'md', children, className }: StatusPickerProps) {
  const setCaseStatus = useStudio((s) => s.setCaseStatus)
  if (readonly) return <StatusDot status={status} size={size} className={className} />
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="StatusPicker"
          aria-label={`状态：${STATUS_LABEL[status]}，点击更改`} title={`状态：${STATUS_LABEL[status]}，点击更改`}
          className={cn(
            '-mx-1.5 inline-flex items-center gap-1 px-1.5 hover:bg-hover data-[state=open]:bg-active max-lg:min-h-touch',
            size === 'md' ? 'h-md-control rounded-md' : 'h-sm-control rounded-sm',
            FOCUS_RING,
            TRANSITION_COLOR,
            className,
          )}
        >
          {children ?? (
            <>
              <StatusDot status={status} size={size} />
              <ChevronDown className="size-3 text-fg-subtle" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="start" className="min-w-[180px]">
        <MenuLabel>更改状态</MenuLabel>
        {CASE_STATUSES.map((s) => (
          <MenuCheckRow key={s} checked={s === status} onSelect={() => void setCaseStatus(pid, s)} data-testid={`status-${s}`}>
            <StatusDot status={s} size="sm" />
          </MenuCheckRow>
        ))}
      </MenuContent>
    </DropdownMenu>
  )
}
