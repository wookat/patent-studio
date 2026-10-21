import { useEffect, useState } from 'react'
import { Bot, Building2, LayoutTemplate, ScrollText, Tags, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tag } from '@/components/ui/tag'
import { SubNav, useHashTab, type SubNavItem } from '@/components/account/SubNav'
import { TagManagerDialog } from '@/components/dashboard/TagManagerDialog'
import { PageChrome } from '@/components/shell/PageChrome'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useIsDesktop } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import { fmtDateTimeIso } from '@/lib/format'
import { useStudio } from '@/store'
import { cn } from '@/lib/utils'
import type { Org } from '@/types/account'
import { AiPanel } from './AiPanel'
import { AuditPanel } from './AuditPanel'
import { MemberTable } from './MemberTable'
import { OrgPanel } from './OrgPanel'

export type AdminTab = 'members' | 'org' | 'audit' | 'ai'
export const ADMIN_TABS: readonly AdminTab[] = ['members', 'org', 'audit', 'ai']

const NAV: readonly SubNavItem<AdminTab>[] = [
  { value: 'members', label: '成员', icon: <Users aria-hidden />, href: '#/admin?tab=members', 'data-testid': 'admin-tab-members' },
  { value: 'org', label: '机构', icon: <Building2 aria-hidden />, href: '#/admin?tab=org', 'data-testid': 'admin-tab-org' },
  { value: 'audit', label: '审计', icon: <ScrollText aria-hidden />, href: '#/admin?tab=audit', 'data-testid': 'admin-tab-audit' },
  { value: 'ai', label: 'AI', icon: <Bot aria-hidden />, href: '#/admin?tab=ai', 'data-testid': 'admin-tab-ai' },
]

const TITLE: Record<AdminTab, { h: string; p: string }> = {
  members: { h: '成员', p: '机构成员的角色与启用状态；标签与模板预设为全机构共享。' },
  org: { h: '机构', p: '机构名称、新建案卷的默认协作策略与期限计算依赖的节假日表。' },
  audit: { h: '审计', p: '登录、案卷、分享、下载、AI 外发与递交等关键操作的留痕，可按条件导出 CSV。' },
  ai: { h: 'AI', p: '机构级 AI 外发开关、模型路由与用量预算。' },
}

/**
 * `#/admin?tab=members|org|audit|ai`（21 §4.6，超管）：左二级导航 200 / 375 Segmented 横滑。
 * 成员：MemberTable（1440 DataTable / 375 卡片）+ 标签 + 模板预设（现有功能迁移）。机构 / 审计 / AI 见各 Panel。
 * 非超管 ⇒ forbidden；auth=off ⇒ 成员 tab 显示「账号系统未启用」，机构名称 / 标签 / 模板仍可用（只请求 /api/admin/org）。
 */
export function AdminPage() {
  const isDesktop = useIsDesktop()
  const status = useStudio((s) => s.authStatus)
  const user = useStudio((s) => s.user)
  const rows = useStudio((s) => s.adminUsers)
  const loading = useStudio((s) => s.adminLoading)
  const unavailable = useStudio((s) => s.adminUnavailable)
  const error = useStudio((s) => s.adminError)
  const org = useStudio((s) => s.org)
  const loadAdmin = useStudio((s) => s.loadAdmin)
  const updateAdminUser = useStudio((s) => s.updateAdminUser)
  const saveOrg = useStudio((s) => s.saveOrg)
  const tags = useStudio((s) => s.tags)
  const loadTags = useStudio((s) => s.loadTags)
  const templates = useStudio((s) => s.templates)
  const templatesUnavailable = useStudio((s) => s.templatesUnavailable)
  const loadTemplates = useStudio((s) => s.loadTemplates)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [offOrg, setOffOrg] = useState<Org | null>(null)
  const tab = useHashTab(ADMIN_TABS, 'members')
  const setTab = (t: AdminTab) => {
    window.location.hash = `#/admin?tab=${t}`
  }

  const authed = status === 'authed' && !!user
  const allowed = status === 'off' || (authed && user.is_superuser)

  useEffect(() => {
    if (!allowed) return
    void loadTags()
    void loadTemplates()
    if (status === 'authed') void loadAdmin()
    else if (status === 'off') void api.org().then(setOffOrg, () => setOffOrg({ name: '' }))
  }, [allowed, status, loadTags, loadTemplates, loadAdmin])

  const orgShown = org ?? (status === 'off' ? offOrg : null)
  const title = orgShown?.name ? `机构管理 · ${orgShown.name}` : '机构管理'

  return (
    <PageChrome name="admin" title={title} description="成员、机构策略、审计与 AI 外发；仅超级管理员可见。" backHref="#/account" backLabel="返回账户">
      {!allowed ? (
        <EmptyState
          icon={Building2}
          title={status === 'unknown' ? '正在加载账号…' : '机构管理仅超级管理员可用'}
          reason={status === 'unknown' ? undefined : '请联系机构管理员为你开通权限。'}
          className="mx-auto max-w-form"
          role="status"
          data-testid="admin-forbidden"
        />
      ) : (
        <div className={isDesktop ? 'flex items-start gap-10' : 'grid gap-section-m'} data-testid="admin-card" data-tab={tab}>
          <SubNav items={NAV} value={tab} onValueChange={setTab} aria-label="机构管理" className={isDesktop ? 'sticky top-0 w-settings-nav' : undefined} />
          <div className={cn('grid min-w-0 flex-1 gap-6', tab !== 'members' && tab !== 'audit' && 'max-w-form')}>
            <header>
              <h2 className="text-xl font-semibold text-fg-strong" data-testid="admin-section-title">
                {TITLE[tab].h}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">{TITLE[tab].p}</p>
            </header>

            {tab === 'members' && (
              <div className="grid gap-6" data-testid="admin-members-panel">
                {status === 'off' ? (
                  <Alert variant="info" role="status" data-testid="admin-auth-off">
                    <AlertDescription>账号系统未启用（PATENT_STUDIO_AUTH=off），没有成员可管理；机构名称、标签与模板预设仍可用。</AlertDescription>
                  </Alert>
                ) : (
                  <section aria-labelledby="admin-members-h" className="grid gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id="admin-members-h" className="text-base font-semibold text-fg-strong">
                        成员
                      </h3>
                      {rows.length > 0 && <span className="text-xs tabular-nums text-fg-muted">{rows.length} 人</span>}
                      <p className="ml-auto text-xs text-fg-muted">邀请成员：在案卷「协作」里按案分享</p>
                    </div>
                    <MemberTable rows={rows} selfId={user?.id ?? null} loading={loading} unavailable={unavailable} error={error} onUpdate={(id, patch) => void updateAdminUser(id, patch)} mobile={!isDesktop} />
                  </section>
                )}

                <div className={isDesktop ? 'grid grid-cols-2 gap-4' : 'grid gap-cards-m'}>
                  <section aria-labelledby="admin-tags-h" className={cn('grid rounded-md border border-border bg-panel p-4', isDesktop ? 'gap-3' : 'gap-group-m')} data-testid="admin-tags-card">
                    <div className={cn('flex items-center gap-2', !isDesktop && 'min-h-md-control')}>
                      <h3 id="admin-tags-h" className="text-sm font-semibold text-fg-strong">
                        标签
                      </h3>
                      <span className="text-xs tabular-nums text-fg-muted">{tags.length} 个</span>
                      <Button variant="secondary" size={isDesktop ? 'sm' : 'md'} className="ml-auto" onClick={() => setTagsOpen(true)} data-testid="admin-manage-tags">
                        <Tags aria-hidden /> 管理标签…
                      </Button>
                    </div>
                    <ul className={cn('flex flex-wrap', isDesktop ? 'gap-1.5' : 'gap-group-m')} aria-label="机构标签" data-testid="admin-tags">
                      {tags.map((t) => (
                        <li key={t.name}>
                          <Tag color={t.color}>{t.name}</Tag>
                        </li>
                      ))}
                      {tags.length === 0 && <li className="text-xs text-fg-muted">还没有标签，在台账里给案卷打标签后会出现在这里。</li>}
                    </ul>
                  </section>

                  <section aria-labelledby="admin-templates-h" className={cn('grid rounded-md border border-border bg-panel p-4', isDesktop ? 'gap-3' : 'gap-group-m')} data-testid="admin-templates-card">
                    <div className={cn('flex items-center gap-2', !isDesktop && 'min-h-md-control')}>
                      <h3 id="admin-templates-h" className="text-sm font-semibold text-fg-strong">
                        模板预设
                      </h3>
                      <span className="text-xs tabular-nums text-fg-muted">{templates.length} 个</span>
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted">
                        <LayoutTemplate className="size-3.5" aria-hidden /> 在案卷设置 → 模板 里保存 / 应用
                      </span>
                    </div>
                    {templatesUnavailable ? (
                      <p className="text-xs text-fg-muted">模板接口尚未实现（501）</p>
                    ) : (
                      <ul className="divide-y divide-border text-sm" aria-label="模板预设" data-testid="admin-templates">
                        {templates.map((t) => (
                          <li key={t.name} className="flex min-h-row items-center gap-2 py-1.5">
                            <span className="font-medium text-fg-strong">{t.name}</span>
                            <span className="truncate text-xs text-fg-muted" title={t.description}>{t.description}</span>
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">{fmtDateTimeIso(t.updated_at)}</span>
                          </li>
                        ))}
                        {templates.length === 0 && <li className="py-1.5 text-xs text-fg-muted">还没有模板预设</li>}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            )}

            {tab === 'org' && <OrgPanel org={orgShown} orgUnavailable={status === 'authed' && unavailable} platformExpected={status === 'authed'} onSaveName={saveOrg} />}
            {tab === 'audit' && <AuditPanel />}
            {tab === 'ai' && <AiPanel />}
          </div>
        </div>
      )}
      <TagManagerDialog open={tagsOpen} onOpenChange={setTagsOpen} />
    </PageChrome>
  )
}
