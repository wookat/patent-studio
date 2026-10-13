import { ChevronDown, UserRound, UserRoundX } from 'lucide-react'
import { userColor } from '@/collab/colors'
import { Avatar } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { MenuCheckRow, MenuContent, MenuLabel, MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { Collaborator, UserBrief } from '@/types/case'

export interface OwnerPickerProps {
  pid: string
  ownerUserId: string | null | undefined
  /** GET /api/projects 每行的 owner（不经 ACL 直查：负责人可能已不在成员列表）；缺省从 collaborators 里找 */
  owner?: UserBrief | null
  /** GET /api/projects 每行的 collaborators = 该案全部 ACL 成员（含 role），即候选名单 */
  collaborators: Collaborator[]
  /** 无写权限 ⇒ 只渲染姓名 */
  readonly?: boolean
  /** 只显头像（移动端卡片） */
  compact?: boolean
  className?: string
}

const nameOf = (m: Pick<UserBrief, 'display_name' | 'email'> | null | undefined) => (m ? m.display_name || m.email : undefined)

/** 责任人展示名：有账号 ⇒ 姓名 / 邮箱；指了但账号已不存在 ⇒ 「已离开的成员」（不露 id）；未指 ⇒ 「未指派」 */
export const OWNER_GONE = '已离开的成员'
export function ownerDisplayName(ownerUserId: string | null | undefined, owner: UserBrief | null | undefined): string {
  return nameOf(owner) ?? (ownerUserId ? OWNER_GONE : '未指派')
}

/**
 * 行内改责任人（13 §6.4）：候选 = 该案卷成员（需 auth=on），选人 ⇒ patchCase({owner_user_id})。
 * auth=off 没有账号体系，责任人无意义 ⇒ 渲染 —。
 */
export function OwnerPicker({ pid, ownerUserId, owner: ownerProp, collaborators, readonly, compact, className }: OwnerPickerProps) {
  const patchCase = useStudio((s) => s.patchCase)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const owner = ownerProp ?? collaborators.find((m) => m.user_id === ownerUserId)
  const ownerName = ownerDisplayName(ownerUserId, owner)
  const face = (
    <>
      {owner ? <Avatar size="sm" name={ownerName} color={userColor(owner)} /> : <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-muted" aria-hidden><UserRound className="size-3" /></span>}
      {!compact && <span className={cn('truncate', !owner && 'text-xs')} title={ownerName}>{ownerName}</span>}
    </>
  )

  if (authOff) return <span className={cn('text-fg-muted', className)}>—</span>
  if (readonly)
    return (
      <span className={cn('inline-flex max-w-full items-center gap-1.5', className)} title={compact ? `责任人：${ownerName}` : undefined}>
        {face}
      </span>
    )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="OwnerPicker"
          aria-label={`责任人：${ownerName}，点击更改`} title={`责任人：${ownerName}，点击更改`}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-sm text-left hover:underline max-lg:min-h-touch max-lg:min-w-touch',
            FOCUS_RING,
            !owner && 'text-fg-muted',
            className,
          )}
          data-testid={`owner-${pid}`}
        >
          {face}
          <ChevronDown className="size-3 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="start" className="min-w-[200px]">
        <MenuLabel>指定责任人</MenuLabel>
        {collaborators.length === 0 && <MenuLabel className="pt-0">此案卷暂无成员</MenuLabel>}
        {collaborators.map((m) => (
          <MenuCheckRow
            key={m.user_id}
            checked={m.user_id === ownerUserId}
            icon={<UserRound />}
            sub={m.role}
            onSelect={() => void patchCase(pid, { owner_user_id: m.user_id })}
          >
            {nameOf(m)}
          </MenuCheckRow>
        ))}
        {ownerUserId && (
          <>
            <MenuSeparator />
            <MenuRow icon={<UserRoundX />} onSelect={() => void patchCase(pid, { owner_user_id: null })}>
              清除责任人
            </MenuRow>
          </>
        )}
      </MenuContent>
    </DropdownMenu>
  )
}
