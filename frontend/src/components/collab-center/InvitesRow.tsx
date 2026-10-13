import { useState } from 'react'
import { Mail, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROLE_LABEL, type Role } from '@/lib/types'
import type { Invite } from '@/types/collab-center'
import { RoleSelect } from './RoleSelect'
import { SHARE_ROLES, fmtSeen } from './format'

/**
 * 待接受邀请一行（W6 05 §3.9；Overleaf「Pending invites」）：虚线信封头像 / 邮箱 / 「待接受」warn 徽章 / 角色 Select 28 / 撤销 24。
 * 对方注册或登录后由后端 consume 自动转成成员（D6），这里不需要「重发」动作（不发邮件，§10）。
 */
export interface InvitesRowProps {
  invite: Invite
  canManage: boolean
  onSetRole: (role: Exclude<Role, 'owner'>) => void
  onRevoke: () => void
}

export function InvitesRow({ invite, canManage, onSetRole, onRevoke }: InvitesRowProps) {
  const [confirming, setConfirming] = useState(false)
  const since = fmtSeen(invite.created_at)
  return (
    <li
      className="flex min-h-row-mobile items-center gap-2 py-1"
      data-slot="InvitesRow"
      data-testid="collab-invite-row"
      data-email={invite.email}
    >
      <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-muted">
        <Mail className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm text-fg">
          <span className="truncate" title={invite.email}>{invite.email}</span>
          <Badge tone="warn" className="shrink-0">待接受</Badge>
        </div>
        {since && <div className="truncate text-xs text-fg-muted" title={`邀请于 ${since}`}>邀请于 {since}</div>}
      </div>
      {canManage ? (
        <>
          <RoleSelect
            value={invite.role}
            options={SHARE_ROLES}
            onChange={onSetRole}
            label={`${invite.email} 的角色`}
            size="sm"
            className="w-24 shrink-0"
            testId={`collab-invite-role-${invite.email}`}
          />
          {confirming ? (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`确认撤销对 ${invite.email} 的邀请`}>
              <span className="text-xs text-danger-fg">撤销？</span>
              <Button variant="danger" size="xs" onClick={() => { setConfirming(false); onRevoke() }} data-testid={`collab-invite-revoke-confirm-${invite.email}`}>
                确认
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setConfirming(false)} data-testid={`collab-invite-revoke-cancel-${invite.email}`}>
                <X aria-hidden />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-fg-muted hover:text-danger-fg"
              aria-label={`撤销对 ${invite.email} 的邀请`}
              title="撤销邀请"
              onClick={() => setConfirming(true)}
              data-testid={`collab-invite-revoke-${invite.email}`}
            >
              <X aria-hidden />
            </Button>
          )}
        </>
      ) : (
        <Badge tone="neutral">{ROLE_LABEL[invite.role]}</Badge>
      )}
    </li>
  )
}
