import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Highlight } from './fields'

export interface SettingRowProps {
  label: string
  description?: string
  children?: ReactNode
  /** data-setting-id：搜索 / 已改下拉定位用 */
  id?: string
  /** 搜索词（标题 / 说明高亮） */
  q?: string
  changed?: boolean
  /** 已改下拉跳转后高亮 1 s */
  flash?: boolean
  /** 仅 changed 时显示 ↺ */
  onReset?: () => void
  /** 控件占整行（附图列表 / sub_except） */
  block?: boolean
  /** 无 store 字段的项：禁用并标「下一轮」 */
  pending?: boolean
  className?: string
}

/**
 * 设置面板单行（07 §2.1 / prototype-c .frow）：左「标题 14px + 一句说明 12px 灰 +（已改）绿 chip」，
 * 右控件靠右 + 单行重置 ↺（仅已改）。flex-wrap：左列 flex 1 1 240px，≤1279 或控件较宽时控件落到下一行（1024 截图）。
 * min-height 64 · 底边线。行宽 <280（六列 dock 把设置压到 ~120–190px）时控件列占满整行并可换行，
 * 已改态的 ↺ 落到下一行而不是把固定宽的数字框顶出行外。
 */
export function SettingRow({ label, description, children, id, q = '', changed = false, flash = false, onReset, block, pending, className }: SettingRowProps) {
  return (
    <div
      data-slot="SettingRow"
      data-label={label}
      id={id ? `setting-${id}` : undefined}
      data-setting-id={id}
      data-changed={changed || undefined}
      className={cn(
        '@container flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-2 transition-colors duration-500',
        flash && '-mx-2 bg-primary-soft px-2 duration-0',
        pending && 'opacity-60',
        className,
      )}
    >
      <div className={cn('min-w-0', block ? 'basis-full' : 'flex-[1_1_200px]')}>
        <div className="flex flex-wrap items-center gap-2 text-base leading-5">
          <span className="truncate" title={label}><Highlight text={label} q={q} /></span>
          {changed && (
            <span className="rounded-sm px-1.5 text-2xs font-semibold leading-4 text-link bg-primary-soft" data-testid="setting-changed-chip">已改</span>
          )}
          {pending && (
            <span className="rounded-sm border px-1.5 text-2xs font-medium leading-4 text-fg-muted">下一轮</span>
          )}
        </div>
        {description && <div className="mt-0.5 text-xs leading-4 text-fg-muted"><Highlight text={description} q={q} /></div>}
      </div>
      <div className={cn('flex max-w-full items-center justify-end gap-2', block ? 'basis-full flex-col items-stretch' : 'shrink-0 @max-[280px]:basis-full @max-[280px]:flex-wrap')} data-testid="setting-row-controls">
        {block ? <div className="min-w-0">{children}</div> : children}
        {changed && onReset && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn('size-6 shrink-0 text-fg-muted hover:text-fg [&_svg]:size-3.5', block && 'self-end')}
                onClick={onReset}
                aria-label={`恢复默认：${label}`}
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>恢复默认</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
