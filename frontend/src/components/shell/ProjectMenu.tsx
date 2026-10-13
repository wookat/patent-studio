import { ChevronDown, CircleDot, Copy, LayoutGrid, Pencil } from 'lucide-react'
import { StatusDot } from '@/components/ui/status-dot'
import { DropdownMenu, DropdownMenuGroup, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { useCaseStatus } from '@/hooks/useCaseStatus'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectDirty } from '@/store'
import { CASE_STATUSES } from '@/types/case'
import { MenuCheckRow, MenuContent, MenuLabel, MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { ShellDialogs } from './ShellDialogs'

export const DirtyDot = ({ className }: { className?: string }) => (
  <span className={cn('size-1.5 shrink-0 rounded-full bg-destructive', className)} aria-hidden data-testid="dirty-dot" />
)

/** compact（移动端）顶栏放不下状态徽章，改状态收进案名下拉：375 容不下右弹子菜单，十档直接内联成一组单选行；只读角色仅展示 */
function StatusRows() {
  const { pid, status, canEdit } = useCaseStatus()
  const setCaseStatus = useStudio((s) => s.setCaseStatus)
  if (!pid || !status) return null
  if (!canEdit) {
    return (
      <>
        <MenuLabel>
          <span className="inline-flex items-center gap-2">
            状态 <StatusDot status={status} size="sm" />
          </span>
        </MenuLabel>
        <MenuSeparator />
      </>
    )
  }
  return (
    <>
      <MenuLabel data-testid="project-status">
        <span className="inline-flex items-center gap-2">
          <CircleDot className="size-3.5" aria-hidden />
          状态 <StatusDot status={status} size="sm" />
        </span>
      </MenuLabel>
      <DropdownMenuGroup aria-label="案卷状态">
        {CASE_STATUSES.map((s) => (
          <MenuCheckRow key={s} checked={s === status} onSelect={() => void setCaseStatus(pid, s)} data-testid={`status-${s}`}>
            <StatusDot status={s} size="sm" />
          </MenuCheckRow>
        ))}
      </DropdownMenuGroup>
      <MenuSeparator />
    </>
  )
}

/**
 * 顶栏居中的案卷标题下拉（07 §2.1 ProjectTitle / 原型 .top .title）：案名 + ▾（脏时 ●）。
 * 下拉：[状态 ▸（仅 compact）─] 重命名… / 复制… ─ 返回案卷面板。切换 / 新建已移到面板 #/（13 §5.3 入口收敛）；
 * 重命名 / 复制 / 回面板全部经 ui.requestNavigation 守卫。移动端顶栏以 compact 复用。
 */
export function ProjectMenu({ compact }: { compact?: boolean }) {
  const pid = useStudio((s) => s.pid)
  const title = useStudio((s) => s.project?.title)
  const dirty = useStudio(selectDirty)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const name = title || pid || '选择案卷'

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-sm px-2 text-base font-semibold transition-colors',
              'hover:bg-hover data-[state=open]:bg-active', FOCUS_RING,
              compact ? 'max-w-[11rem]' : 'max-w-[35rem]',
            )}
            aria-label={`当前案子：${name}${dirty ? '（有未保存修改）' : ''}`}
            title="重命名 / 复制 / 返回面板"
            data-dirty={dirty || undefined}
            data-slot="ProjectMenu"
            data-testid="project-tab"
          >
            <span className="min-w-0 truncate" title={name}>{name}</span>
            {dirty && <DirtyDot />}
            <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <MenuContent align="center" className="max-w-[min(26rem,var(--radix-dropdown-menu-content-available-width))]">
          {compact && <StatusRows />}
          <MenuRow
            icon={<Pencil />}
            disabled={!pid}
            onSelect={() => requestNavigation({ type: 'custom', label: '重命名案卷', run: () => useStudio.getState().openDialog('rename') })}
            data-testid="rename-project"
          >
            重命名…
          </MenuRow>
          <MenuRow
            icon={<Copy />}
            disabled={!pid}
            onSelect={() => requestNavigation({ type: 'custom', label: '复制案卷', run: () => useStudio.getState().openDialog('duplicate') })}
            data-testid="duplicate-project"
          >
            复制…
          </MenuRow>
          <MenuSeparator />
          <MenuRow icon={<LayoutGrid />} onSelect={() => requestNavigation({ type: 'dashboard' })} data-testid="goto-dashboard">
            返回案卷面板
          </MenuRow>
        </MenuContent>
      </DropdownMenu>
      <ShellDialogs />
    </>
  )
}
