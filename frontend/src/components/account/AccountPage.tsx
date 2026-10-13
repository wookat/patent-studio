import { Bell, Building2, ChevronRight, KeyRound, ShieldCheck, UserRound } from 'lucide-react'
import { PageChrome } from '@/components/shell/PageChrome'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMisc'
import { useStudio } from '@/store'
import { AppearanceSection } from './AppearanceSection'
import { NotifyPrefs } from './NotifyPrefs'
import { PasswordForm } from './PasswordForm'
import { PatPanel } from './PatPanel'
import { ProfileForm } from './ProfileForm'
import { SubNav, useHashTab, type SubNavItem } from './SubNav'

export type AccountTab = 'profile' | 'security' | 'notify' | 'pat'
export const ACCOUNT_TABS: readonly AccountTab[] = ['profile', 'security', 'notify', 'pat']

const NAV: readonly SubNavItem<AccountTab>[] = [
  { value: 'profile', label: '资料', icon: <UserRound aria-hidden />, href: '#/account?tab=profile', 'data-testid': 'account-tab-profile' },
  { value: 'security', label: '安全', icon: <ShieldCheck aria-hidden />, href: '#/account?tab=security', 'data-testid': 'account-tab-security' },
  { value: 'notify', label: '通知偏好', icon: <Bell aria-hidden />, href: '#/account?tab=notify', 'data-testid': 'account-tab-notify' },
  { value: 'pat', label: '集成 PAT', icon: <KeyRound aria-hidden />, href: '#/account?tab=pat', 'data-testid': 'account-tab-pat' },
]

const TITLE: Record<AccountTab, { h: string; p: string }> = {
  profile: { h: '资料', p: '显示名、头衔与头像色会出现在成员列表与批注署名；外观设置只影响本浏览器。' },
  security: { h: '安全', p: '修改登录密码；其他设备会被要求重新登录。' },
  notify: { h: '通知偏好', p: '站内与邮件通知的接收方式。' },
  pat: { h: '集成 · 个人访问令牌', p: '供 Codex / Claude Code 等智能体通过 MCP 访问你的案卷。' },
}

/**
 * `#/account?tab=profile|security|notify|pat`（21 §4.6）：左二级导航 200 + 表单列 640；375 Segmented 横滑 + 单列。
 * auth=off ⇒ 「账号系统未启用」；anon 由 App 导向登录页。超管在头部有「机构管理」入口。
 */
export function AccountPage() {
  const status = useStudio((s) => s.authStatus)
  const user = useStudio((s) => s.user)
  const saving = useStudio((s) => s.meSaving)
  const unavailable = useStudio((s) => s.meUnavailable)
  const saveMe = useStudio((s) => s.saveMe)
  const authError = useStudio((s) => s.authError)
  const loadMe = useStudio((s) => s.loadMe)
  const desktop = useIsDesktop()
  const tab = useHashTab(ACCOUNT_TABS, 'profile')
  const setTab = (t: AccountTab) => {
    window.location.hash = `#/account?tab=${t}`
  }

  const actions = user?.is_superuser ? (
    <Button asChild variant="secondary" size="md">
      <a href="#/admin" data-testid="account-admin-link">
        <Building2 aria-hidden /> 机构管理
      </a>
    </Button>
  ) : null

  return (
    <PageChrome name="account" title="账户" description={user ? user.email : undefined} actions={desktop ? actions : undefined}>
      {status === 'off' ? (
        <EmptyState icon={ShieldCheck} title="账号系统未启用" reason="本部署未开启账号系统（PATENT_STUDIO_AUTH=off），没有个人资料可编辑。" className="mx-auto max-w-form" data-testid="account-auth-off" />
      ) : !user && authError ? (
        <EmptyState
          icon={ShieldCheck}
          title="账号信息加载失败"
          reason={authError}
          action={<Button onClick={() => void loadMe()}>重试</Button>}
          className="mx-auto max-w-form"
          data-testid="account-auth-error"
        />
      ) : !user ? (
        <div className="mx-auto grid max-w-form gap-3" role="status" aria-label="正在加载账号" data-testid="account-loading">
          <Skeleton className="h-md-control w-1/3" />
          <Skeleton className="h-lg-control" />
          <Skeleton className="h-lg-control" />
        </div>
      ) : (
        <div className={desktop ? 'flex items-start gap-10' : 'grid gap-section-m'} data-testid="account-card" data-tab={tab}>
          <SubNav items={NAV} value={tab} onValueChange={setTab} aria-label="账户设置" className={desktop ? 'sticky top-0 w-settings-nav' : undefined} />
          <div className="grid min-w-0 max-w-form flex-1 gap-6">
            <header>
              <h2 className="text-xl font-semibold text-fg-strong" data-testid="account-section-title">
                {TITLE[tab].h}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">{TITLE[tab].p}</p>
            </header>
            {tab === 'profile' && (
              <>
                <ProfileForm key={`${user.display_name}|${user.title ?? ''}|${user.avatar_color ?? ''}`} user={user} saving={saving} unavailable={unavailable} onSave={saveMe} mobile={!desktop} />
                <AppearanceSection mobile={!desktop} />
              </>
            )}
            {tab === 'security' && <PasswordForm saving={saving} unavailable={unavailable} onSave={saveMe} />}
            {tab === 'notify' && <NotifyPrefs />}
            {tab === 'pat' && <PatPanel />}
            {!desktop && user.is_superuser && (
              <a
                href="#/admin"
                className="flex h-md-control items-center gap-2 border-t border-border text-sm text-fg hover:text-link"
                data-testid="account-admin-link"
              >
                <Building2 className="size-4 text-fg-icon" aria-hidden />
                机构管理
                <ChevronRight className="ml-auto size-4 text-fg-subtle" aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </PageChrome>
  )
}
