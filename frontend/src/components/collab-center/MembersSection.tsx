import { useId, useState, type FormEvent } from 'react'
import { Trash2, UserPlus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { ROLE_LABEL, type Member, type Role } from '@/lib/types'
import { lineChipLabel } from '@/lib/diagLocation'
import { userColor } from '@/collab/colors'
import { peerNameOf, useStudio, type CollabPeer } from '@/store'
import type { Invite } from '@/types/collab-center'
import { InvitesRow } from './InvitesRow'
import { RoleSelect } from './RoleSelect'
import { LAST_OWNER_HINT, MEMBER_ROLES, SHARE_ROLES, fmtSeen, type ShareRole } from './format'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, EmptyLine, ErrorLine, SectionHead, SectionHint } from './shared'

/**
 * 协作者段（W6 05 §3.9；借鉴 Overleaf「Share this project」邮箱行 + Pending invites）：
 * 邀请行（Input + 角色 Select + secondary「邀请」，无 primary）/ 成员行 48（头像 24 + 在线点 / 姓名 / 最近活动 / 角色 Select 28 / 移除 24）/ 待接受邀请行。
 * 角色规则（D11）：只有 owner（canManage）能改角色 / 移除；owner 选项只在成员下拉出现；
 * 最后一个 owner 的行禁用降级项（后端 409 兜底）；不能移除自己。
 * D10：在线成员的头像可点 → 跳到对方光标所在行；非 owner 拿不到成员表，改列 awareness 在线名单（PeerRow）。
 */
export interface MembersSectionProps {
  pid: string
  members: Member[]
  invites: Invite[]
  /** 在线用户 id（来自 access.viewed[].online 或 peers） */
  onlineIds: ReadonlySet<string>
  canManage: boolean
  onInvite: (email: string, role: Exclude<Role, 'owner'>) => void
  onSetMemberRole: (userId: string, role: Role) => void
  onRemoveMember: (userId: string) => void
  onSetInviteRole: (email: string, role: Exclude<Role, 'owner'>) => void
  onRevokeInvite: (email: string) => void
  /** 当前用户 id：标「（我）」、禁止移除自己 */
  meId?: string | null
  /** user_id → 最近访问 ISO（access.viewed）；缺 ⇒ 不显示 */
  lastSeen?: ReadonlyMap<string, string>
  /** 邀请接口 501（B2 未落地）⇒ 表单仍可用（走 PUT /members 语义），但列表显示占位 */
  invitesUnavailable?: boolean
  /** 成员表 / 邀请表读取中：无缓存数据时显骨架，压住「暂无成员」假空态闪烁 */
  loading?: boolean
  /** 成员表 / 邀请表读失败（非 501）：错误行 + 重试（onRetry 应同时重取 members 与 invites） */
  error?: string | null
  onRetry?: () => void
  /** Yjs awareness 在线端：成员行头像可点跳行；不在成员表里的（非 owner 视角 / 匿名链接）单独列出 */
  peers?: readonly CollabPeer[]
  onGoto?: (line: number) => void
}

export const ROLE_TONE: Record<Role, 'brand' | 'info' | 'violet' | 'teal' | 'neutral'> = {
  owner: 'brand',
  agent: 'violet',
  editor: 'info',
  reviewer: 'teal',
  viewer: 'neutral',
}

export function MembersSection({
  members,
  invites,
  onlineIds,
  canManage,
  onInvite,
  onSetMemberRole,
  onRemoveMember,
  onSetInviteRole,
  onRevokeInvite,
  meId = null,
  lastSeen,
  invitesUnavailable = false,
  loading = false,
  error = null,
  onRetry,
  peers = [],
  onGoto,
}: MembersSectionProps) {
  const uid = useId()
  /* 批71：邀请表单草稿存 store（inviteDraft）——协同抽屉 Sheet 关闭即卸载本组件，
     输入一半的邮箱随实例死（卸载丢草稿族收口；role 随草稿一并保存） */
  const inviteDraft = useStudio((s) => s.inviteDraft)
  const setInviteDraft = useStudio((s) => s.setInviteDraft)
  const email = inviteDraft?.email ?? ''
  const role: ShareRole = inviteDraft?.role ?? 'editor'
  const patchDraft = (p: Partial<{ email: string; role: ShareRole }>) =>
    setInviteDraft({ email: inviteDraft?.email ?? '', role: inviteDraft?.role ?? 'editor', ...p })
  /* 批76：store 草稿保重挂不保刷新（批73 口径）——邀请邮箱输入中关页签先确认 */
  useBeforeUnload(() => email.trim() !== '')
  const ownerCount = members.filter((m) => m.role === 'owner').length
  // peer ↔ member 对齐优先 uid（同名成员不能按名字塌缩 / 错位），uid 缺省（访客 / 旧端）退回 name
  const peerByUid = new Map(peers.filter((p) => p.uid).map((p) => [p.uid!, p]))
  const peerByName = new Map(peers.filter((p) => !p.uid).map((p) => [p.name, p]))
  const peerOf = (m: Member) => peerByUid.get(m.user_id) ?? peerByName.get(peerNameOf(m))
  const strangers = peers.filter((p) => !members.some((m) => peerOf(m) === p))
  const onlineCount = members.filter((m) => onlineIds.has(m.user_id)).length + strangers.length
  const listEmpty = members.length === 0 && invites.length === 0 && strangers.length === 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return
    onInvite(v, role)
    /* 发出即清邮箱、留角色——连邀多人大概率同角色 */
    patchDraft({ email: '' })
  }

  // 触控（06-w8 协作者 Sheet）：Input / Select lg 44，「邀请」按钮 md 36；Select 与按钮同行，不够宽时按钮换行占满；内边距按卡片 16 / 页边 16
  const desktop = useIsDesktop()
  return (
    <div className={cn('flex flex-col text-sm', desktop ? 'gap-2 p-3' : 'gap-cards-m px-sheet-m pb-sheet-m pt-sheet-top-m')} data-slot="MembersSection" data-testid="collab-members">
      {canManage && (
        <form
          className={cn('flex flex-col rounded-md border border-border bg-sunken', desktop ? 'gap-2 p-2' : 'gap-group-m p-card-m')}
          onSubmit={submit}
          data-testid="collab-invite-form"
          aria-label="邀请协作者"
        >
          <Label htmlFor={`${uid}-email`} className="text-xs text-fg-muted">邀请协作者</Label>
          <Input
            id={`${uid}-email`}
            type="email"
            required
            autoComplete="off"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            size={desktop ? 'sm' : 'lg'}
            placeholder="邮箱（未注册也可，登录后自动入项）"
            value={email}
            onChange={(e) => patchDraft({ email: e.target.value })}
            data-testid="collab-invite-email"
          />
          <div className={cn('flex', desktop ? 'gap-2' : 'flex-wrap items-center gap-group-m')} data-testid="collab-invite-controls">
            <RoleSelect value={role} options={SHARE_ROLES} onChange={(r) => patchDraft({ role: r })} label="邀请角色" size={desktop ? 'sm' : 'lg'} className={cn('flex-1', !desktop && 'min-w-40')} testId="collab-invite-role" />
            <Button type="submit" variant="secondary" size={desktop ? 'sm' : 'lg'} className={cn('shrink-0', !desktop && 'grow')} disabled={!email.trim()} data-testid="collab-invite-submit">
              <UserPlus aria-hidden />
              邀请
            </Button>
          </div>
        </form>
      )}

      {error && onRetry && (/_501_|未开启|账号/.test(error)
        ? <SectionHint testId="collab-members-unavailable">协同成员管理未开启（当前部署未开账号功能 / 返回 501）。</SectionHint>
        : <ErrorLine label="成员列表加载失败" error={error} onRetry={onRetry} testId="collab-members-error" />)}

      {loading && !error && listEmpty ? (
        <div className="flex flex-col gap-2 py-1" role="status" aria-label="加载中" data-testid="collab-members-loading">
          <span className="sr-only">加载中…</span>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-md-control" />
          <Skeleton className="h-md-control" />
        </div>
      ) : (
        <>
          <SectionHead
            aside={
              <span data-testid="collab-members-online">
                在线 <span className="tabular-nums text-fg">{onlineCount}</span>
              </span>
            }
          >
            <span data-testid="collab-members-summary">
              成员 <span className="tabular-nums text-fg">{members.length}</span>
              {invites.length > 0 && (
                <>
                  {' '}· 待接受 <span className="tabular-nums text-fg">{invites.length}</span>
                </>
              )}
              <span className="sr-only"> · 在线 {onlineCount}</span>
            </span>
          </SectionHead>

          {!canManage && members.length === 0 && (
            <SectionHint testId="collab-members-owner-only">成员表与邀请仅所有者可管理；下方为当前在线的协作者。</SectionHint>
          )}

          {listEmpty ? (
            !error && <EmptyLine testId="collab-members-empty">{canManage ? '暂无成员记录。' : '暂无其他人在线。'}</EmptyLine>
          ) : (
            <ul className="flex flex-col divide-y divide-border" aria-label="协作者">
              {members.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  online={onlineIds.has(m.user_id)}
                  isSelf={m.user_id === meId}
                  lastSeen={lastSeen?.get(m.user_id)}
                  canManage={canManage}
                  lastOwner={m.role === 'owner' && ownerCount <= 1}
                  peerLine={peerOf(m)?.line ?? null}
                  onGoto={onGoto}
                  onSetRole={(r) => onSetMemberRole(m.user_id, r)}
                  onRemove={() => onRemoveMember(m.user_id)}
                />
              ))}
              {invites.map((i) => (
                <InvitesRow key={i.email} invite={i} canManage={canManage} onSetRole={(r) => onSetInviteRole(i.email, r)} onRevoke={() => onRevokeInvite(i.email)} />
              ))}
              {strangers.map((p) => (
                <PeerRow key={p.id} peer={p} onGoto={onGoto} />
              ))}
            </ul>
          )}
        </>
      )}

      {invitesUnavailable && <SectionHint testId="collab-invites-unavailable">待接受邀请列表不可用（后端未开启账号 / 返回 501）。</SectionHint>}
    </div>
  )
}

interface MemberRowProps {
  member: Member
  online: boolean
  isSelf: boolean
  lastSeen?: string
  canManage: boolean
  lastOwner: boolean
  /** 对方光标所在全文行（awareness）；有值时头像可点跳行 */
  peerLine: number | null
  onGoto?: (line: number) => void
  onSetRole: (role: Role) => void
  onRemove: () => void
}

function MemberRow({ member: m, online, isSelf, lastSeen, canManage, lastOwner, peerLine, onGoto, onSetRole, onRemove }: MemberRowProps) {
  const [confirming, setConfirming] = useState(false)
  const [confirmingOwner, setConfirmingOwner] = useState(false)
  const name = peerNameOf(m)
  const seen = fmtSeen(lastSeen)
  const ast = useStudio((s) => s.ast)
  const where = peerLine != null ? lineChipLabel(peerLine, ast) : null
  const disabledRoles = lastOwner ? MEMBER_ROLES.filter((r) => r !== 'owner') : []
  return (
    <li
      className="flex min-h-row-mobile items-center gap-2 py-1"
      data-testid="collab-member-row"
      data-user-id={m.user_id}
      data-role={m.role}
      data-online={online || undefined}
    >
      <GotoAvatar name={name} color={userColor(m)} line={peerLine} onGoto={onGoto} online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm text-fg-strong" title={name}>
          <span className="truncate">{name}</span>
          {isSelf && <span className="shrink-0 text-xs text-fg-muted">（我）</span>}
          <span className="sr-only">{online ? '在线' : '离线'}</span>
        </div>
        <div className="flex gap-2 truncate text-xs text-fg-muted">
          {seen ? (
            <span className="shrink-0" data-testid="collab-member-seen">
              最近 {seen}
              {online && <span className="text-ok-fg">{where ? ` · 正在编辑 ${where}` : ' · 在线'}</span>}
            </span>
          ) : online ? (
            <span className="shrink-0 text-ok-fg" data-testid="collab-member-editing">正在编辑{where ? ` · ${where}` : ''}</span>
          ) : (
            m.display_name && <span className="truncate" title={m.email}>{m.email}</span>
          )}
        </div>
      </div>
      {canManage ? (
        <>
          {confirmingOwner ? (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`确认授予 ${name} 所有者`}>
              <span className="text-xs text-danger-fg">授主？</span>
              <Button variant="danger" size="xs" onClick={() => { setConfirmingOwner(false); onSetRole('owner') }} data-testid={`collab-member-owner-confirm-${m.user_id}`}>
                确认
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setConfirmingOwner(false)} data-testid={`collab-member-owner-cancel-${m.user_id}`}>
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <RoleSelect
              value={m.role}
              options={MEMBER_ROLES}
              onChange={(r) => (r === 'owner' && m.role !== 'owner' ? setConfirmingOwner(true) : onSetRole(r))}
              label={`${name} 的角色`}
              size="sm"
              className="w-24 shrink-0"
              disabledRoles={disabledRoles}
              testId={`collab-member-role-${m.user_id}`}
            />
          )}
          {confirming ? (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`确认移除 ${name}`}>
              <span className="text-xs text-danger-fg">移除？</span>
              <Button variant="danger" size="xs" onClick={() => { setConfirming(false); onRemove() }} data-testid={`collab-member-remove-confirm-${m.user_id}`}>
                确认
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setConfirming(false)} data-testid={`collab-member-remove-cancel-${m.user_id}`}>
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-fg-muted hover:text-danger-fg"
              disabled={isSelf || lastOwner}
              aria-label={`移除 ${name}`}
              title={isSelf ? '不能移除自己' : lastOwner ? LAST_OWNER_HINT : `移除 ${name}`}
              onClick={() => setConfirming(true)}
              data-testid={`collab-member-remove-${m.user_id}`}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </>
      ) : (
        <Badge tone={ROLE_TONE[m.role]} data-testid={`collab-member-role-${m.user_id}`}>
          {ROLE_LABEL[m.role]}
        </Badge>
      )}
    </li>
  )
}

/** 头像：对方有光标行时是按钮（点击跳行，aria-label 带行号），否则纯装饰 */
function GotoAvatar({ name, color, line, online, onGoto }: { name: string; color: string; line: number | null; online?: boolean; onGoto?: (line: number) => void }) {
  const ast = useStudio((s) => s.ast)
  if (line == null || !onGoto) return <Avatar name={name} color={color} online={online} dimmed={online === false} />
  const where = lineChipLabel(line, ast)
  return (
    <button
      type="button"
      className={cn('inline-flex size-xs-control items-center justify-center rounded-full', FOCUS_RING, touchHit)}
      onClick={() => onGoto(line)}
      aria-label={`跳到 ${name} 所在位置：${where}`}
      title={where}
      data-testid="collab-goto-peer"
    >
      <Avatar name={name} color={color} online={online} />
    </button>
  )
}

/** 不在成员表里的在线端（非 owner 视角看不到成员表；或匿名 / 已移出但仍连着房间） */
function PeerRow({ peer: p, onGoto }: { peer: CollabPeer; onGoto?: (line: number) => void }) {
  const ast = useStudio((s) => s.ast)
  return (
    <li className="flex min-h-row-mobile items-center gap-2 py-1" data-testid="collab-peer-row">
      <GotoAvatar name={p.name} color={p.color} line={p.line} onGoto={onGoto} online />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm text-fg-strong">
          <span className="truncate" title={p.name}>{p.name}</span>
          <span className="sr-only">在线</span>
        </div>
        <div className="text-xs text-ok-fg">正在编辑{p.line != null ? ` · ${lineChipLabel(p.line, ast)}` : ''}</div>
      </div>
      {p.readonly && <Badge tone="neutral">只读</Badge>}
    </li>
  )
}
