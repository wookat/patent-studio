import { useMemo, useState } from 'react'
import { Archive, Tag as TagIcon, Trash2, UserRound, UserRoundX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { MenuCheckRow, MenuContent, MenuLabel, MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { CASE_STATUSES, type Collaborator, type Tag } from '@/types/case'
import { StatusDot } from '@/components/ui/status-dot'

export interface BulkBarProps {
  selected: string[]
  tags: Tag[]
  /** 当前筛选处于回收站（显示恢复 / 永久删除而非归档） */
  inTrash?: boolean
  onClear(): void
  /** 375：底部固定条（父级放在滚动区之后），按钮横向可滚 */
  mobile?: boolean
  className?: string
}

/**
 * 多选批量条（13 §6.7；借鉴 Overleaf 项目页勾选后顶部出现「Download / Archive / Trash」的做法，
 * 加状态 / 标签 / 责任人三项：专利代理换责任人、批量进入客户确认是常见集体操作）。
 * 标签菜单是复选：全选中都有 ⇒ ✓，点一下对全选中批量摘掉，否则批量加上。
 * 责任人候选 = 所选案卷协作者的并集（auth=off 无账号 ⇒ 不显示）。
 */
export function BulkBar({ selected, tags, inTrash, onClear, mobile, className }: BulkBarProps) {
  const bulk = useStudio((s) => s.bulk)
  const projects = useStudio((s) => s.projects)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const [busy, setBusy] = useState(false)
  const n = selected.length
  const rows = useMemo(() => projects.filter((p) => selected.includes(p.id)), [projects, selected])
  const people = useMemo(() => {
    const seen = new Map<string, Collaborator>()
    rows.forEach((r) => r.collaborators?.forEach((c) => seen.set(c.user_id, c)))
    return [...seen.values()].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email, 'zh-Hans-CN'))
  }, [rows])
  if (!n) return null
  const tagState = (name: string) => {
    const withTag = rows.filter((r) => r.case?.tags.includes(name)).length
    return withTag === rows.length ? 'all' : withTag ? 'some' : 'none'
  }
  const ownerOf = (uid: string) => rows.every((r) => r.case?.owner_user_id === uid)
  // 批量写单飞：连点/连选不重复发 POST
  const fire = (action: Parameters<typeof bulk>[0]) => {
    if (busy) return
    setBusy(true)
    void bulk(action).finally(() => setBusy(false))
  }

  return (
    <div
      data-slot="BulkBar"
      data-variant={mobile ? 'sticky' : undefined}
      role="toolbar"
      aria-label={`已选 ${n} 个案卷`}
      className={cn(
        'flex items-center gap-2 bg-primary-soft px-4 py-2 text-sm',
        mobile ? 'sticky bottom-0 z-panel shrink-0 overflow-x-auto border-t pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-md' : 'flex-wrap border-b',
        className,
      )}
    >
      <span className="shrink-0 font-medium text-primary-text">已选 {n} 项</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-status">状态</Button>
        </DropdownMenuTrigger>
        <MenuContent align="start" className="min-w-[180px]">
          <MenuLabel>批量改状态</MenuLabel>
          {CASE_STATUSES.map((s) => (
            <MenuCheckRow
              key={s}
              checked={rows.every((r) => (r.case?.status ?? 'drafting') === s)}
              onSelect={() => fire({ action: 'status', pids: selected, status: s })}
              data-testid={`bulk-status-${s}`}
            >
              <StatusDot status={s} size="sm" />
            </MenuCheckRow>
          ))}
        </MenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-tags">
            <TagIcon aria-hidden /> 标签
          </Button>
        </DropdownMenuTrigger>
        <MenuContent align="start" className="min-w-[180px]">
          <MenuLabel>标签（✓ = 所选全有）</MenuLabel>
          {tags.length === 0 && <MenuLabel className="pt-0">暂无机构标签</MenuLabel>}
          {tags.map((t) => {
            const st = tagState(t.name)
            return (
              <MenuCheckRow
                key={t.name}
                kind="checkbox"
                checked={st === 'all'}
                icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />}
                sub={st === 'some' ? '部分' : undefined}
                onSelect={() =>
                  fire(st === 'all' ? { action: 'tags', pids: selected, remove_tags: [t.name] } : { action: 'tags', pids: selected, add_tags: [t.name] })
                }
                data-testid={`bulk-tag-${t.name}`}
              >
                {t.name}
              </MenuCheckRow>
            )
          })}
        </MenuContent>
      </DropdownMenu>
      {!authOff && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-owner">
              <UserRound aria-hidden /> 责任人
            </Button>
          </DropdownMenuTrigger>
          <MenuContent align="start" className="min-w-[200px]">
            <MenuLabel>批量指定责任人</MenuLabel>
            {people.length === 0 && <MenuLabel className="pt-0">所选案卷没有协作者</MenuLabel>}
            {people.map((p) => (
              <MenuCheckRow
                key={p.user_id}
                checked={ownerOf(p.user_id)}
                icon={<UserRound />}
                sub={p.role}
                onSelect={() => fire({ action: 'owner', pids: selected, owner_user_id: p.user_id })}
                data-testid={`bulk-owner-${p.user_id}`}
              >
                {p.display_name || p.email}
              </MenuCheckRow>
            ))}
            <MenuSeparator />
            <MenuRow icon={<UserRoundX />} onSelect={() => fire({ action: 'owner', pids: selected, owner_user_id: null })} data-testid="bulk-owner-clear">
              清除责任人
            </MenuRow>
          </MenuContent>
        </DropdownMenu>
      )}
      {inTrash ? (
        <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-restore" disabled={busy} onClick={() => fire({ action: 'list_state', pids: selected, state: 'active' })}>
          恢复
        </Button>
      ) : (
        <>
          <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-archive" disabled={busy} onClick={() => fire({ action: 'list_state', pids: selected, state: 'archived' })}>
            <Archive aria-hidden /> 归档
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" data-testid="bulk-trash" disabled={busy} onClick={() => fire({ action: 'list_state', pids: selected, state: 'trashed' })}>
            <Trash2 aria-hidden /> 回收站
          </Button>
        </>
      )}
      <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={onClear} aria-label="取消选择" data-testid="bulk-clear">
        <X aria-hidden /> 取消
      </Button>
    </div>
  )
}
