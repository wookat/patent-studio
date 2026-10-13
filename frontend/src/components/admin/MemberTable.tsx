import { useState } from 'react'
import { ShieldCheck, UserRoundX, UserRoundCheck, Users, X } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { userColor } from '@/collab/colors'
import { USER_TITLES, type AdminUser, type AdminUserIn, type UserTitle } from '@/types/account'

export interface MemberTableProps {
  rows: AdminUser[]
  /** 当前登录用户 id：不能禁用自己 / 撤销自己的超管 */
  selfId: string | null
  loading: boolean
  unavailable: boolean
  error: string | null
  onUpdate(userId: string, patch: AdminUserIn): void
  mobile?: boolean
}

export function fmtLastLogin(iso: string | null): string {
  if (!iso) return '从未登录'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  const day = 86_400_000
  if (diff < 3_600_000) return '1 小时内'
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const NONE = '__none__'

function MemberAvatar({ u, size }: { u: AdminUser; size: 'sm' | 'md' }) {
  return <Avatar size={size} name={u.display_name || u.email} color={userColor(u)} className={cn(!u.is_active && 'opacity-40')} aria-hidden />
}

function TitleSelect({ u, disabled, mobile, onChange }: { u: AdminUser; disabled: boolean; mobile: boolean; onChange(t: UserTitle): void }) {
  return (
    <Select value={u.title || NONE} disabled={disabled} onValueChange={(v) => onChange((v === NONE ? '' : v) as UserTitle)}>
      <SelectTrigger size={mobile ? 'lg' : 'sm'} className={mobile ? 'w-full' : 'w-28'} aria-label={`${u.email} 的头衔`} data-testid="member-title">
        <SelectValue placeholder="无头衔" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>无头衔</SelectItem>
        {USER_TITLES.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? 'ok' : 'neutral'}>
      {active ? '正常' : '已禁用'}
    </Badge>
  )
}

/**
 * 成员列表：头像 · 邮箱 / 显示名 · 头衔（Select）· 角色 · 最近登录 · 状态 · 启用 / 禁用。
 * 与案件台账同一 Table 原语（只有横线、36 表头 / 40 行）；375 转卡片（同一份 rows）。
 * 对自己、对最后一位可用管理员的禁用 / 降级开关禁用（后端同样 409，这里只是不让人点了再报错）。
 */
export function MemberTable({ rows, selfId, loading, unavailable, error, onUpdate, mobile = false }: MemberTableProps) {
  // 高权限动作（授/撤超管、禁用账号）一键即写，与案内「移除成员」同规两阶确认；「启用」是恢复向不设防
  const [armed, setArmed] = useState<{ id: string; label: string; patch: AdminUserIn } | null>(null)
  if (loading && rows.length === 0 && !unavailable && !error) {
    return (
      <div className="grid gap-2" role="status" aria-label="正在加载成员" data-testid="member-table-empty">
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-2/3" />
      </div>
    )
  }
  if (unavailable || error || rows.length === 0) {
    const title = unavailable ? '成员接口尚未实现' : error ? '成员列表加载失败' : '还没有成员'
    const reason = unavailable ? `服务端返回 ${error ?? '501'}，成员管理待后端落地。` : error ? error : '新成员注册后会出现在这里；按案邀请请到案卷「协作」。'
    return <EmptyState icon={Users} size="sm" title={title} reason={reason} role="status" data-testid="member-table-empty" className="rounded-md border border-dashed border-border" />
  }

  const admins = rows.filter((u) => u.is_superuser && u.is_active)
  const lastAdminId = admins.length === 1 ? admins[0].id : null
  const actions = (u: AdminUser) => {
    const self = u.id === selfId
    const locked = self || u.id === lastAdminId
    if (armed?.id === u.id) {
      return (
        <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`确认${armed.label}：${u.email}`}>
          <span className="text-xs text-danger-fg">{armed.label}？</span>
          <Button variant="danger" size="xs" onClick={() => { const patch = armed.patch; setArmed(null); onUpdate(u.id, patch) }} data-testid={`member-confirm-${u.id}`}>
            确认
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="取消" onClick={() => setArmed(null)} data-testid={`member-cancel-${u.id}`}>
            <X aria-hidden />
          </Button>
        </span>
      )
    }
    return (
      <div className={cn('flex items-center', mobile ? 'w-full gap-group-m [&>button]:flex-1' : 'gap-1')}>
        <Button
          variant="ghost"
          size={mobile ? 'md' : 'sm'}
          disabled={locked}
          onClick={() => setArmed({ id: u.id, label: u.is_superuser ? '撤销超管' : '授予超管', patch: { is_superuser: !u.is_superuser } })}
          aria-pressed={u.is_superuser}
          aria-label={`${u.is_superuser ? '撤销' : '设为'}超级管理员：${u.email}`}
          data-testid="member-toggle-super"
        >
          <ShieldCheck aria-hidden className={cn(u.is_superuser ? 'text-link' : 'text-fg-muted')} />
          {u.is_superuser ? '管理员' : '成员'}
        </Button>
        <Button
          variant="secondary"
          size={mobile ? 'md' : 'sm'}
          disabled={locked}
          onClick={() => (u.is_active ? setArmed({ id: u.id, label: '禁用账号', patch: { is_active: false } }) : onUpdate(u.id, { is_active: true }))}
          aria-label={`${u.is_active ? '禁用' : '启用'}：${u.email}`}
          data-testid="member-toggle-active"
        >
          {u.is_active ? <UserRoundX aria-hidden /> : <UserRoundCheck aria-hidden />}
          {u.is_active ? '禁用' : '启用'}
        </Button>
      </div>
    )
  }

  if (mobile) {
    return (
      <ul className="grid gap-cards-m" data-slot="MemberTable" data-variant="mobile" data-testid="member-table" aria-busy={loading || undefined}>
        {rows.map((u) => (
          <li key={u.id} className={cn('grid gap-group-m rounded-md border border-border bg-panel p-card-m', !u.is_active && 'opacity-70')} data-testid="member-row" data-active={u.is_active}>
            <div className="flex items-center gap-3">
              <MemberAvatar u={u} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium text-fg-strong" title={u.display_name || u.email}>{u.display_name || u.email}</div>
                <div className="truncate text-xs text-fg-muted" title={u.email}>{u.email}</div>
              </div>
              <ActiveBadge active={u.is_active} />
            </div>
            <TitleSelect u={u} disabled={loading} mobile onChange={(t) => onUpdate(u.id, { title: t })} />
            <div className="text-xs text-fg-muted">最近登录 · {fmtLastLogin(u.last_login_at)}</div>
            {actions(u)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="rounded-md border border-border bg-panel" data-slot="MemberTable" data-variant="desktop">
      <Table data-testid="member-table" aria-busy={loading || undefined}>
        <TableHeader className="bg-panel">
          <TableRow className="hover:bg-transparent">
            <TableHead>成员</TableHead>
            <TableHead className="w-36">头衔</TableHead>
            <TableHead className="w-32">最近登录</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-56 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id} className={cn(!u.is_active && 'text-fg-muted')} data-testid="member-row" data-active={u.is_active}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <MemberAvatar u={u} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg-strong" title={u.display_name || u.email}>{u.display_name || u.email}</div>
                    {u.display_name && <div className="truncate text-xs text-fg-muted" title={u.email}>{u.email}</div>}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <TitleSelect u={u} disabled={loading} mobile={false} onChange={(t) => onUpdate(u.id, { title: t })} />
              </TableCell>
              <TableCell className="text-xs tabular-nums text-fg-muted">{fmtLastLogin(u.last_login_at)}</TableCell>
              <TableCell>
                <ActiveBadge active={u.is_active} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end">{actions(u)}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
