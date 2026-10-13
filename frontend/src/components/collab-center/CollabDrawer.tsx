import { useEffect } from 'react'
import { Users, X } from 'lucide-react'
import { Count } from '@/components/ui/count'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsDesktop } from '@/hooks/useMisc'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { userColor } from '@/collab/colors'
import { useStudio, selectCanManage, selectOnlineCount, peerNameOf } from '@/store'
import type { Member } from '@/lib/types'
import { COLLAB_CENTER_TABS, type CollabCenterTab } from '@/types/collab-center'
import { AccessSection } from './AccessSection'
import { LinksSection } from './LinksSection'
import { MembersSection } from './MembersSection'
import { PublicLinksSection } from './PublicLinksSection'
import { SettingsSection } from './SettingsSection'
import { Avatar, SectionHint } from './shared'

/**
 * 协作者中心抽屉（W6 05 §3.9 / §4.5 S5；docs/plan/14 §6.2）：
 * - 桌面 ≥1024：右侧 360（--w-companion）伴随栏式非模态列——32 头（图标 + 标题 + 成员 Count + 在线头像组）+ 下划线 Tabs + 自滚正文；
 *   不遮罩、不锁编辑器（`collab` 尚不在 CompanionId 里，见 integration_requests）。
 * - 375：side="bottom" 85dvh Sheet，data-density=touch 全控件 44。
 * - 四 tab：协作者 | 链接 | 访问记录 | 设置。open = store.collabCenterOpen；打开时拉 members / shareLinks / invites / access / collab-settings（501 ⇒ 段内占位）。
 * 成员 / 链接 / 邀请 / 访问记录四个读接口都是 owner 门槛：非 owner 只拉 collab-settings，协作者段改显示 awareness 在线名单。
 * 在线：成员行以 access.viewed[].online（后端 Yjs 房间）⊕ 同名 peer 为准；头部 N 与顶栏同源 selectOnlineCount。
 */
export function CollabDrawer() {
  const open = useStudio((s) => s.collabCenterOpen)
  const tab = useStudio((s) => s.collabCenterTab)
  const setTab = useStudio((s) => s.setCollabCenterTab)
  const close = useStudio((s) => s.closeCollabCenter)
  const pid = useStudio((s) => s.pid)
  const title = useStudio((s) => s.project?.title)
  const user = useStudio((s) => s.user)
  const members = useStudio((s) => s.members)
  const membersLoading = useStudio((s) => s.membersLoading)
  const membersError = useStudio((s) => s.membersError)
  const links = useStudio((s) => s.shareLinks)
  const linksLoading = useStudio((s) => s.shareLinksLoading)
  const linksError = useStudio((s) => s.shareLinksError)
  const publicLinks = useStudio((s) => s.publicLinks)
  const publicLinksLoading = useStudio((s) => s.publicLinksLoading)
  const publicLinksUnavailable = useStudio((s) => s.publicLinksUnavailable)
  const publicLinksError = useStudio((s) => s.publicLinksError)
  const pendingRevisions = useStudio((s) => s.marks.reduce((n, m) => (m.kind === 'ins' || m.kind === 'del' || m.kind === 'sub' ? n + 1 : n), 0))
  const invites = useStudio((s) => s.invites)
  const invitesLoading = useStudio((s) => s.invitesLoading)
  const invitesUnavailable = useStudio((s) => s.invitesUnavailable)
  const invitesError = useStudio((s) => s.invitesError)
  const access = useStudio((s) => s.access)
  const accessLoading = useStudio((s) => s.accessLoading)
  const accessUnavailable = useStudio((s) => s.accessUnavailable)
  const accessError = useStudio((s) => s.accessError)
  const settings = useStudio((s) => s.collabSettings)
  const settingsLoading = useStudio((s) => s.collabSettingsLoading)
  const settingsUnavailable = useStudio((s) => s.collabSettingsUnavailable)
  const settingsError = useStudio((s) => s.collabSettingsError)
  const peers = useStudio((s) => s.peers)
  const canManage = useStudio(selectCanManage)
  const online = useStudio(selectOnlineCount)
  const desktop = useIsDesktop()

  useEffect(() => {
    if (!open || !pid) return
    const s = useStudio.getState()
    void s.loadCollabSettings(pid)
    if (!canManage) return
    void s.loadMembers(pid)
    void s.loadShareLinks(pid)
    void s.loadPublicLinks(pid)
    void s.loadInvites(pid)
    void s.loadAccess(pid)
  }, [open, pid, canManage])

  /* 成员变更无 WS 推送：抽屉开着期间轮询成员表，他端改角色/移除及时回流 */
  useEffect(() => {
    if (!open || !pid || !canManage) return
    const t = setInterval(() => {
      /* 隐藏页签不轮询（notify.ts 同闸） */
      if (document.visibilityState === 'hidden') return
      void useStudio.getState().loadMembers(pid)
    }, 30_000)
    return () => clearInterval(t)
  }, [open, pid, canManage])

  /* peers 集合成员一变（有人上/下线）→ 服务端 access.online 尚未刷新，成员行「在线」点会滞后一轮轮询；
     去抖补一次 access 让行态随 peers 及时收敛。dep 用 uid 签名——光标行变化不该触发重取 */
  const peersKey = peers.map((p) => p.uid ?? p.name).join('|')
  useEffect(() => {
    if (!open || !pid || !canManage) return
    const t = setTimeout(() => void useStudio.getState().loadAccess(pid), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pid, canManage, peersKey])

  const viewed = access?.viewed ?? []
  const peerOf = (m: Member) => peers.find((p) => (p.uid ? p.uid === m.user_id : p.name === peerNameOf(m)))
  const onlineIds = new Set([
    ...viewed.filter((r) => r.online).map((r) => r.user.user_id),
    ...members.filter((m) => peerOf(m)).map((m) => m.user_id),
  ])
  const lastSeen = new Map(viewed.map((r) => [r.user.user_id, r.last_seen]))
  const onlineCount = online ?? onlineIds.size
  const onlineNames: { name: string; color: string }[] = [
    ...members.filter((m) => onlineIds.has(m.user_id)).map((m) => ({ name: peerNameOf(m), color: userColor(m) })),
    ...peers.filter((p) => !members.some((m) => p.uid === m.user_id)).map((p) => ({ name: p.name, color: p.color })),
  ].slice(0, 3)
  const st = useStudio.getState

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} modal={!desktop}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        hideClose
        className={cn('flex flex-col gap-0 p-0', desktop ? 'top-topbar bottom-statusbar h-auto w-companion border-l shadow-md' : 'h-[85dvh] max-h-[85dvh]')}
        onInteractOutside={desktop ? (e) => e.preventDefault() : undefined}
        data-testid="collab-drawer"
        data-density={desktop ? undefined : 'touch'}
      >
        <header className={cn('flex shrink-0 items-center gap-2 border-b border-border', desktop ? 'h-panel-header pl-3 pr-1' : 'h-touch pl-sheet-m pr-2')} data-slot="collab-header">
          <Users className="size-4 shrink-0 text-fg-icon" aria-hidden />
          <SheetTitle className="min-w-0 flex-1 truncate text-sm font-medium text-fg-strong">
            协作者
            {canManage && <Count value={members.length} showZero={members.length > 0 || !membersLoading} className="ml-1.5 align-middle" data-testid="collab-member-count" />}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {title ? `${title} · ` : ''}
            {canManage ? `成员 ${members.length} · ` : ''}在线 {onlineCount} 人
          </SheetDescription>
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted" data-testid="collab-drawer-online" aria-label={`在线 ${onlineCount} 人`}>
            {onlineNames.length > 0 && (
              <span className="flex items-center -space-x-1.5" aria-hidden data-testid="collab-online-avatars">
                {onlineNames.map((n) => <Avatar key={n.name} name={n.name} color={n.color} className="ring-2 ring-panel" />)}
              </span>
            )}
            <span className="tabular-nums">
              {canManage && (
                <span className="sr-only">成员 {members.length} · </span>
              )}
              在线 {onlineCount} 人
            </span>
          </div>
          <button
            type="button"
            aria-label="关闭面板" title="关闭面板"
            onClick={close}
            className={cn('inline-flex shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg-strong', desktop ? 'size-xs-control' : cn('size-sm-control', touchHit), FOCUS_RING, TRANSITION_COLOR)}
            data-testid="collab-drawer-close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <Tabs value={tab} onValueChange={(v) => setTab(v as CollabCenterTab)} className="flex min-h-0 flex-1 flex-col">
          {/* 触控：Tab 条 md（面板头 44）套 ScrollRow 可滑不裁切；桌面不套 */}
          {desktop ? (
            <TabsList size="md" aria-label="协作者中心" className="shrink-0 px-2">
              {COLLAB_CENTER_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="flex-1 px-1.5" data-testid={`collab-tab-${t.id}`}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            <ScrollRow bleed={false} className="my-0 py-0 px-0 [&>*]:min-w-full" data-testid="collab-tabs-row">
              <TabsList size="md" aria-label="协作者中心" className="shrink-0 px-sheet-m">
                {COLLAB_CENTER_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="flex-1 px-1.5" data-testid={`collab-tab-${t.id}`}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </ScrollRow>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto" data-slot="collab-body">
            <TabsContent value="members">
              {pid && (
                <MembersSection
                  pid={pid}
                  members={members}
                  invites={invites}
                  onlineIds={onlineIds}
                  peers={peers}
                  onGoto={(line) => st().gotoLine(line)}
                  canManage={canManage}
                  meId={user?.id ?? null}
                  lastSeen={lastSeen}
                  invitesUnavailable={invitesUnavailable}
                  loading={membersLoading || invitesLoading}
                  error={membersError ?? invitesError}
                  onRetry={() => {
                    void st().loadMembers(pid)
                    void st().loadInvites(pid)
                  }}
                  onInvite={(email, role) => void st().invite(pid, email, role)}
                  onSetMemberRole={(uid, role) => void st().setMemberRole(pid, uid, role)}
                  onRemoveMember={(uid) => void st().removeMember(pid, uid)}
                  onSetInviteRole={(email, role) => void st().setInviteRole(pid, email, role)}
                  onRevokeInvite={(email) => void st().revokeInvite(pid, email)}
                />
              )}
            </TabsContent>
            <TabsContent value="links">
              {pid && (
                <LinksSection
                  pid={pid}
                  links={links}
                  canManage={canManage}
                  loading={linksLoading}
                  error={linksError}
                  onRetry={() => void st().loadShareLinks(pid)}
                  onCreate={(role, days) => void st().createShareLink(pid, role, days)}
                  onRevoke={(token) => void st().revokeShareLink(pid, token)}
                />
              )}
              {pid && canManage && (
                <PublicLinksSection
                  links={publicLinks}
                  loading={publicLinksLoading}
                  unavailable={publicLinksUnavailable}
                  error={publicLinksError}
                  canManage={canManage}
                  pendingRevisions={pendingRevisions}
                  onRetry={() => void st().loadPublicLinks(pid)}
                  onCreate={(body) => st().createPublicLink(pid, body)}
                  onRevoke={(token) => void st().revokePublicLink(pid, token)}
                />
              )}
            </TabsContent>
            <TabsContent value="access">
              {canManage ? (
                <AccessSection access={access} loading={accessLoading} unavailable={accessUnavailable} error={accessError} onRetry={() => { if (pid) void st().loadAccess(pid) }} />
              ) : (
                <div className="p-3"><SectionHint testId="collab-access-owner-only">访问记录仅所有者可见。</SectionHint></div>
              )}
            </TabsContent>
            <TabsContent value="settings">
              <SettingsSection
                settings={settings}
                canManage={canManage}
                unavailable={settingsUnavailable}
                loading={settingsLoading}
                error={settingsError}
                onRetry={() => {
                  if (pid) void st().loadCollabSettings(pid)
                }}
                onChange={(patch) => {
                  if (pid) void st().saveCollabSettings(pid, patch)
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
