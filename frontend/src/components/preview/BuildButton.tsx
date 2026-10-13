import { ChevronDown, Hammer, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Switch } from '@/components/ui/switch'
import { hotkeyLabel } from '@/lib/hotkeys'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'

export type BuildButtonVariant = 'desktop' | 'mobile'

const HINT = hotkeyLabel('build')
const NEXT_ROUND = '下一轮'
const MENU_ITEM = ''

/**
 * PDF 工具条「构建 ▾」split（05 §3.6）：桌面工作台唯一的构建按钮（顶栏不再重复放 primary「构建」，完整菜单含 运行回归检查 在 菜单栏 构建）。
 * 桌面 24 高 secondary（1px 边 / bg-panel），主体 = 锤子 + 「构建」，▾ 24 宽；构建中：主体只显示 spinner 并禁用。
 * ▾ 下拉：立即构建 / 自动构建开关 / 停止（cancelBuild，保留上次 PDF）─ 清除构建缓存（resetBuild + 重建）/ HTML 快速草稿（无接口 → 禁用标「下一轮」）。
 * 工具条容器 < 410px 时主体退化为图标。
 * 移动变体（06 §2 / 工具条首行）：primary md 36 的 Button split（主体 + icon-md ▾），命中区由 Button touch-hit 扩到 44；构建中主体 spinner 禁用、▾ 仍可开（停止）。
 */
export function BuildButton({ variant = 'desktop', className }: { variant?: BuildButtonVariant; className?: string }) {
  const phase = useStudio((s) => s.phase)
  const pid = useStudio((s) => s.pid)
  const autoBuild = useStudio((s) => s.autoBuild)
  const setAutoBuild = useStudio((s) => s.setAutoBuild)
  const enqueue = useStudio((s) => s.enqueue)
  const cancelBuild = useStudio((s) => s.cancelBuild)
  const resetBuild = useStudio((s) => s.resetBuild)
  const building = phase === 'building'
  const cancellable = phase === 'building' || phase === 'queued'
  const disabled = building || !pid
  const mobile = variant === 'mobile'

  const menu = (
    <DropdownMenuContent align="start" className="min-w-60 py-1" data-testid="build-menu">
      <DropdownMenuItem className={MENU_ITEM} disabled={disabled} onSelect={() => enqueue('manual', true)}>
        立即构建
        <span className="ml-auto text-xs text-fg-muted">{HINT}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        className={cn(MENU_ITEM, 'justify-between')}
        onSelect={(e) => {
          e.preventDefault()
          setAutoBuild(!autoBuild)
        }}
        data-testid="auto-build-item"
      >
        自动构建
        <Switch checked={autoBuild} onCheckedChange={setAutoBuild} aria-label="自动构建" className="ml-3" />
      </DropdownMenuItem>
      <DropdownMenuItem className={MENU_ITEM} disabled={!cancellable} onSelect={() => cancelBuild()} data-testid="build-cancel-item">
        停止
        <span className="ml-auto text-xs text-fg-muted">保留上次 PDF</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={MENU_ITEM}
        disabled={!pid}
        onSelect={() => {
          resetBuild()
          enqueue('manual', true)
        }}
        data-testid="build-reset-item"
      >
        清除构建缓存
        <span className="ml-auto text-xs text-fg-muted">重建</span>
      </DropdownMenuItem>
      <DropdownMenuItem className={MENU_ITEM} disabled>
        HTML 快速草稿
        <span className="ml-auto text-xs text-fg-muted">{NEXT_ROUND}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  if (mobile) {
    return (
      <span data-slot="BuildButton" data-testid="rebuild-split" data-variant="mobile" data-building={building || undefined} className={cn('inline-flex shrink-0 items-stretch', className)}>
        <Button
          size="md"
          className="rounded-r-none"
          loading={building}
          loadingLabel="构建中"
          disabled={disabled}
          onClick={() => enqueue('manual', true)}
          title={`重新构建 (${HINT})`}
          aria-label={building ? '构建中' : '构建'}
          data-testid="rebuild"
        >
          <Hammer aria-hidden />
          构建
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-md" className="rounded-l-none border-l border-l-primary-active" aria-label="构建选项" title="构建选项" disabled={!pid} data-testid="rebuild-menu">
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </span>
    )
  }

  const seg = cn(
    'inline-flex items-center justify-center gap-1 bg-panel text-fg transition-colors duration-(--dur-color) hover:bg-hover hover:text-fg-strong active:bg-active',
    'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled',
    FOCUS_RING,
    'h-xs-control text-xs [&_svg]:size-3.5',
  )

  return (
    <span
      data-slot="BuildButton"
      data-testid="rebuild-split"
      data-building={building || undefined}
      className={cn('inline-flex shrink-0 overflow-hidden rounded-xs border border-border-strong shadow-sm', className)}
    >
      <button
        type="button"
        className={cn(seg, 'px-2 font-medium @max-[410px]/pdftb:px-1.5', building && 'opacity-90')}
        disabled={disabled}
        onClick={() => enqueue('manual', true)}
        title={`重新构建 (${HINT})`}
        aria-label={building ? '构建中' : '构建'}
        aria-busy={building || undefined}
        data-testid="rebuild"
      >
        {building ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <>
            <Hammer aria-hidden />
            <span className="@max-[410px]/pdftb:hidden">构建</span>
          </>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(seg, 'w-xs-control border-l border-border')}
            aria-label="构建选项"
            title="构建选项"
            disabled={!pid}
            data-testid="rebuild-menu"
          >
            <ChevronDown aria-hidden />
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    </span>
  )
}
