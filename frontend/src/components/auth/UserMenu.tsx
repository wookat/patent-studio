import { Building2, CircleUserRound, KeyRound, LogOut, ShieldCheck, UserRoundCog } from 'lucide-react'
import { initialOf, labelText, userColor } from '@/collab/colors'
import { Avatar } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { signOut } from './session'

/**
 * 顶栏右端用户菜单（C4-auth-ui；docs/plan/07 §7.1）：头像圆（邮箱 / 显示名首字母）→ 邮箱（只读）/ 修改密码… / 退出登录。
 * 借鉴 Overleaf 顶栏「Account ▾」。auth=off / unknown 时不渲染，顶栏与 R1 一致；anon 时只给「登录」链接。
 * W4-E（17 §3）：「个人资料…」→ #/account，「修改密码…」→ #/account 的密码节（PasswordForm，PUT /api/users/me 核对旧密码），
 * 超管再增「机构管理…」→ #/admin。
 * 头像色 = userColor(账号)：账户预设色优先，否则按显示名 || 邮箱哈希，与台账责任人 / 协作者 / 协同光标同源，同一人全站同色。
 */
export function UserMenu({ className }: { className?: string }) {
  const status = useStudio((s) => s.authStatus)
  const user = useStudio((s) => s.user)
  if (status === 'off' || status === 'unknown') return null
  if (status === 'anon' || !user) {
    return (
      <a href="#/login" className={cn('text-xs text-primary underline-offset-2 hover:underline', className)} data-testid="topbar-login">
        登录
      </a>
    )
  }
  const name = user.display_name || user.email
  const color = userColor(user)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex size-md-control shrink-0 items-center justify-center rounded-md in-data-[density=touch]:size-touch hover:bg-hover data-[state=open]:bg-hover',
            FOCUS_RING,
            className,
          )}
          aria-label={`账号：${user.email}`}
          data-slot="UserMenu"
          data-testid="user-menu"
        >
          {initialOf(name) === '?' ? (
            <CircleUserRound className="size-4" aria-hidden />
          ) : (
            <Avatar size="sm" name={name} color={color} style={{ color: labelText(color) }} aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <div className="px-2 py-1.5" data-testid="user-menu-email">
          {user.display_name && <div className="truncate text-sm font-medium" title={user.display_name}>{user.display_name}</div>}
          <div className="truncate text-xs text-fg-muted" title={user.email}>{user.email}</div>
          {user.is_superuser && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 py-0.5 text-2xs font-medium text-primary-text">
              <ShieldCheck className="size-3" aria-hidden />
              管理员
            </div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { window.location.hash = '/account' }} data-testid="user-menu-account">
          <UserRoundCog className="size-4 text-fg-muted" aria-hidden />
          个人资料…
        </DropdownMenuItem>
        {user.is_superuser && (
          <DropdownMenuItem onSelect={() => { window.location.hash = '/admin' }} data-testid="user-menu-admin">
            <Building2 className="size-4 text-fg-muted" aria-hidden />
            机构管理…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => { window.location.hash = '/account' }} data-testid="user-menu-password">
          <KeyRound className="size-4 text-fg-muted" aria-hidden />
          修改密码…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()} data-testid="user-menu-logout">
          <LogOut className="size-4 text-fg-muted" aria-hidden />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
