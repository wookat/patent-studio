import { useState, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import { Archive, ArchiveRestore, ChevronRight, FileText, GitBranch, LogOut, MoreHorizontal, Trash2, Undo2 } from 'lucide-react'
import { userColor } from '@/collab/colors'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { MenuContent, MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { StatusDot } from '@/components/ui/status-dot'
import { Tag as UiTag } from '@/components/ui/tag'
import { fmtRelative } from '@/lib/format'
import { projectHash } from '@/lib/hash'
import type { ProjectSummary } from '@/lib/types'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { useStudio } from '@/store'
import { targetFilingDaysLeft } from '@/store/dashboard'
import { KIND_LABEL, RELATED_KIND_LABEL, type Collaborator, type RelatedCase, type Tag } from '@/types/case'
import { DeadlineCell } from './DeadlineCell'
import { OwnerPicker } from './OwnerPicker'
import { StatusPicker } from './StatusPicker'

export interface CaseRowProps {
  row: ProjectSummary
  /** 机构标签字典（取色） */
  tags: Tag[]
  selected: boolean
  onToggleSelected(pid: string): void
  /** 当前用户可否写台账（agent+ / 超管；auth=off 恒 true） */
  canEdit: boolean
  className?: string
  /** 看板卡：勾选框不撑 44 触控区（卡片本身 240 宽，行高由内容决定） */
  dense?: boolean
  /** card：看板拖拽节点（dnd-kit setNodeRef） */
  ref?: Ref<HTMLLIElement>
  /** card：整卡指针拖动等额外事件 */
  liProps?: HTMLAttributes<HTMLLIElement>
  /** card：勾选框前的拖柄（键盘拖动入口） */
  handle?: ReactNode
}

/** 行级可写判定（台账勾选 / 状态钮 / 责任人 / ⋯ 菜单共用）：authOff / 超管 / 本案 agent·owner 才可写 */
export const canEditCase = (row: ProjectSummary, authOff: boolean, superuser: boolean) =>
  authOff || superuser || row.my_role === 'agent' || row.my_role === 'owner'

export function useCanEditCase(row: ProjectSummary): boolean {
  const authStatus = useStudio((s) => s.authStatus)
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  return canEditCase(row, authStatus === 'off', superuser)
}

/** 标签列（05 §2.4）：`Tag` 20 高 r4 + 左侧用户数据色点；超出 max 折叠为 +N */
export function TagList({ names, tags, max = 2, className }: { names: string[]; tags: Tag[]; max?: number; className?: string }) {
  if (!names.length) return null
  const shown = names.slice(0, max)
  return (
    <span role="list" className={cn('inline-flex min-w-0 items-center gap-1', className)} aria-label={`标签：${names.join('、')}`}>
      {shown.map((n) => (
        <UiTag key={n} role="listitem" color={tags.find((t) => t.name === n)?.color} title={n}>
          {n}
        </UiTag>
      ))}
      {names.length > max && <span className="text-xs text-fg-muted tabular-nums">+{names.length - max}</span>}
    </span>
  )
}

/** 案间关联徽标（W19 批8）：有 related 时显示 GitBranch + 关联数，title 列出各关联案（TagList 同款悬停口径） */
export function RelatedBadge({ related, className }: { related?: RelatedCase[]; className?: string }) {
  const items = related ?? []
  if (!items.length) return null
  const tip = `关联案卷：${items.map((r) => `${RELATED_KIND_LABEL[r.kind]} ${r.pid}${r.note ? `（${r.note}）` : ''}`).join('、')}`
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-fg-muted', className)} title={tip} aria-label={tip}>
      <GitBranch className="size-3" aria-hidden />
      <span className="tabular-nums">{items.length}</span>
    </span>
  )
}

/** 头像叠放（12 §3.2）：在线者排前带绿点（协同房间），title 附最近访问（W4-B 访问记录）；aria-label 报在线人数 */
export function AvatarStack({ people, max = 3, className }: { people: Collaborator[]; max?: number; className?: string }) {
  if (!people.length) return null
  const ordered = [...people.filter((p) => p.online), ...people.filter((p) => !p.online)]
  const shown = ordered.slice(0, max)
  const online = people.filter((p) => p.online).length
  const label = `协作者：${ordered.map((p) => p.display_name || p.email).join('、')}${online ? `，${online} 人在线` : ''}`
  return (
    <span role="img" className={cn('inline-flex -space-x-1.5', className)} aria-label={label} data-online={online}>
      {shown.map((p) => {
        const name = p.display_name || p.email
        const color = userColor(p)
        const seen = p.online ? '在线' : p.last_seen ? `最近访问 ${fmtRelative(Date.parse(p.last_seen))}` : '未打开过'
        return (
          <span key={p.user_id} className="relative inline-flex" title={`${name} · ${p.role} · ${seen}`} data-online={p.online || undefined} aria-hidden>
            <Avatar size="sm" name={name} color={color} className="ring-2 ring-panel" />
            {p.online && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-panel bg-ok-dot" />}
          </span>
        )
      })}
      {people.length > max && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-sunken text-2xs text-fg-muted ring-2 ring-panel" aria-hidden>
          +{people.length - max}
        </span>
      )}
    </span>
  )
}

/** 行尾 ⋯：归档 / 回收站 / 恢复 / 永久删除（owner）/ 退出（非 owner）（13 §6.6，Overleaf 项目行操作语义） */
export function RowActions({ row, canEdit, touch }: { row: ProjectSummary; canEdit: boolean; /** 375 案卷卡（06 §2.1）：视觉 sm 32，命中区 touchHit ≥ 44 */ touch?: boolean }) {
  const setListState = useStudio((s) => s.setListState)
  const deleteProject = useStudio((s) => s.deleteProject)
  const leaveProject = useStudio((s) => s.leaveProject)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const openCaseForm = useStudio((s) => s.openCaseForm)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const [confirmDel, setConfirmDel] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const state = row.list_state ?? 'active'
  const isOwner = authOff || row.my_role === 'owner'
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex size-sm-control items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg-strong data-[state=open]:bg-active',
              touch ? touchHit : 'max-lg:size-touch',
              FOCUS_RING,
            )}
            aria-label={`${row.title || row.id} 的更多操作`} title="更多操作"
            data-testid={`row-actions-${row.id}`}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <MenuContent align="end" className="min-w-[200px]">
          {row.case && (
            <>
              <MenuRow icon={<FileText />} onSelect={() => openCaseForm(row.id)} data-testid={`edit-case-${row.id}`}>
                案件信息…
              </MenuRow>
              <MenuRow
                icon={<GitBranch />}
                disabled={!canEdit || state !== 'active'}
                onSelect={() => requestNavigation({ type: 'create-project', parent: { pid: row.id, title: row.title || row.id } })}
                data-testid={`new-divisional-${row.id}`}
              >
                新建分案…
              </MenuRow>
              <MenuSeparator />
            </>
          )}
          {state === 'active' && (
            <>
              <MenuRow icon={<Archive />} disabled={!canEdit} onSelect={() => void setListState(row.id, 'archived')}>归档</MenuRow>
              <MenuRow icon={<Trash2 />} disabled={!canEdit} onSelect={() => void setListState(row.id, 'trashed')}>移到回收站</MenuRow>
            </>
          )}
          {state === 'archived' && <MenuRow icon={<ArchiveRestore />} disabled={!canEdit} onSelect={() => void setListState(row.id, 'active')}>取消归档</MenuRow>}
          {state === 'trashed' && (
            <>
              <MenuRow icon={<Undo2 />} disabled={!canEdit} onSelect={() => void setListState(row.id, 'active')}>恢复</MenuRow>
              {isOwner && (
                <>
                  <MenuSeparator />
                  <MenuRow icon={<Trash2 />} className="text-danger-fg" disabled={!canEdit} onSelect={() => setConfirmDel(true)}>
                    永久删除…
                  </MenuRow>
                </>
              )}
            </>
          )}
          {!isOwner && (
            <>
              <MenuSeparator />
              <MenuRow icon={<LogOut />} onSelect={() => void leaveProject(row.id)}>退出此案卷</MenuRow>
            </>
          )}
        </MenuContent>
      </DropdownMenu>
      <Dialog open={confirmDel} onOpenChange={(o) => { if (!delBusy) setConfirmDel(o) }}>
        <DialogContent size="sm" data-testid={`case-delete-dialog-${row.id}`}>
          <DialogHeader>
            <DialogTitle>永久删除案卷</DialogTitle>
            <DialogDescription>「{row.title || row.id}」及其中全部文件、历史与批注将从服务器删除，不可恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDel(false)}>取消</Button>
            <Button
              variant="danger"
              disabled={delBusy}
              data-testid={`case-delete-confirm-${row.id}`}
              onClick={async () => {
                if (delBusy) return
                setDelBusy(true)
                const ok = await deleteProject(row.id)
                setDelBusy(false)
                if (ok) setConfirmDel(false)
              }}
            >
              永久删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 卡片（05 §4 S1-375 卡片行 ≥ 56 / S2 看板卡）：首行 案号 mono 11 + `Heat sm` 右 → 标题 14 两行（链接，命中区 ≥ 44）→ `StatusDot sm` + 责任人 `Avatar 20` + 标签 `Tag` → 协作者 · 最近修改。
 * 桌面表格行由 CaseTable 的 TanStack 列定义渲染，本组件只服务移动端列表与看板卡。
 * 案名是唯一链接（#/p/<pid>）；整卡不做点击目标，避免与勾选 / 状态 / ⋯ 冲突（Overleaf 同做法）。
 */
/** 「未填案号」可点补录：开案件表单聚焦案号字段（台账表 FillableDash 同款深链） */
function FillableCaseNo({ rowId }: { rowId: string }) {
  const openCaseForm = useStudio((s) => s.openCaseForm)
  return (
    <button
      type="button"
      className={cn('-mx-1 min-w-0 truncate rounded-sm px-1 text-left text-2xs text-fg-subtle hover:bg-hover hover:text-link', FOCUS_RING)}
      title="点击补录案号"
      aria-label="补录案号"
      onClick={() => openCaseForm(rowId, 'case_no')}
      data-testid={`fill-case_no-${rowId}`}
    >
      未填案号
    </button>
  )
}

export function CaseRow({ row, tags, selected, onToggleSelected, canEdit, className, ref, liProps, handle, dense }: CaseRowProps) {
  const c = row.case
  const modified = fmtRelative(row.mtime ? row.mtime * 1000 : 0)
  const modifiedBy = row.last_modified_by ? `${row.last_modified_by} · ${modified}` : modified
  const href = `#${projectHash(row.id)}`
  return (
    <li
      ref={ref}
      {...liProps}
      data-slot="CaseRow"
      data-variant="card"
      data-pid={row.id}
      data-selected={selected || undefined}
      className={cn(
        'flex flex-col rounded-md border border-border bg-panel shadow-sm transition-colors duration-(--dur-color)',
        // 375 列表卡（06 §3.1）：内边距 16 / 行间 8；看板卡（dense，桌面共用）保持 10 / 6
        dense ? 'gap-1.5 p-2.5' : 'gap-group-m p-card-m',
        selected && 'border-primary bg-selected',
        className,
      )}
    >
      <div className={cn('flex items-center', dense ? 'gap-2' : 'min-h-sm-control gap-group-m')} data-testid={dense ? undefined : `card-meta-${row.id}`}>
        {handle}
        {/* 只读角色无可执行的批量动作——不给选择 affordance（占位盒保留列位） */}
        {canEdit ? (
          <label className={cn('inline-flex shrink-0 items-center justify-center', dense ? 'size-6 max-lg:-my-2 max-lg:size-touch' : 'size-sm-control')}>
            <Checkbox checked={selected} onCheckedChange={() => onToggleSelected(row.id)} aria-label={`选择 ${row.title || row.id}`} data-testid={`select-${row.id}`} />
          </label>
        ) : (
          <span className={cn('shrink-0', dense ? 'size-6 max-lg:-my-2 max-lg:size-touch' : 'size-sm-control')} aria-hidden />
        )}
        {c?.case_no ? (
          <span className="min-w-0 truncate font-mono text-2xs text-fg-subtle tabular-nums" title={c.case_no}>{c.case_no}</span>
        ) : canEdit ? (
          <FillableCaseNo rowId={row.id} />
        ) : (
          <span className="min-w-0 truncate text-2xs text-fg-subtle">未填案号</span>
        )}
        <DeadlineCell d={c?.next_deadline ?? null} targetDaysLeft={targetFilingDaysLeft(row)} compact className="ml-auto" />
        <RowActions row={row} canEdit={canEdit} touch={!dense} />
      </div>
      <a
        href={href}
        className={cn('-mx-1 flex items-center gap-1 rounded-sm px-1 text-base font-medium leading-snug text-fg-strong hover:bg-hover hover:underline', dense ? 'min-h-11' : cn('min-h-lg-control', touchHit), FOCUS_RING)}
        data-testid={`open-${row.id}`}
      >
        <span className="line-clamp-2 min-w-0 flex-1">{row.title || row.id}</span>
        <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </a>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        {c && (canEdit ? <StatusPicker pid={row.id} status={c.status} size="sm" /> : <StatusDot status={c.status} size="sm" />)}
        {c && <OwnerPicker pid={row.id} ownerUserId={c.owner_user_id} owner={row.owner} collaborators={row.collaborators ?? []} readonly={!canEdit} compact />}
        {c && <span>{KIND_LABEL[c.kind]}</span>}
        <RelatedBadge related={c?.related} />
        {c?.client && <span className="truncate" title={c.client}>{c.client}</span>}
        <TagList names={c?.tags ?? []} tags={tags} className="ml-auto" />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <AvatarStack people={row.collaborators ?? []} />
        <span className="truncate tabular-nums" title={modifiedBy}>{modifiedBy}</span>
      </div>
    </li>
  )
}
