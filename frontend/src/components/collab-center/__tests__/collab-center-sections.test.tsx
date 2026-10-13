// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import type { Member, ShareLink, User } from '@/lib/types'
import { useStudio } from '@/store'
import type { AccessReport, Invite } from '@/types/collab-center'
import { AccessSection } from '../AccessSection'
import { CollabDrawer } from '../CollabDrawer'
import { LinksSection } from '../LinksSection'
import { MembersSection } from '../MembersSection'
import { ModeIndicator } from '../ModeIndicator'
import { SettingsSection } from '../SettingsSection'
import { fmtExpiry, fmtSeen } from '../format'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
/** window.matchMedia 的返回值：true = 桌面（≥1024），false = 375 移动 */
let desktop = true

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

const notImplemented = (unit: string) => new ApiError(501, `${unit} 尚未实现`)

const owner: Member = { user_id: 'u-owner', email: 'owner@x.io', display_name: '王所有', role: 'owner' }
const editor: Member = { user_id: 'u-editor', email: 'editor@x.io', display_name: '李编辑', role: 'editor' }
const reviewer: Member = { user_id: 'u-rev', email: 'rev@x.io', display_name: '', role: 'reviewer' }
const members = [owner, editor, reviewer]
const me: User = { id: 'u-owner', email: owner.email, display_name: owner.display_name, is_superuser: false }
const invites: Invite[] = [{ email: 'new@x.io', role: 'reviewer', invited_by: 'u-owner', created_at: '2026-09-01T00:00:00Z' }]
const links: ShareLink[] = [
  {
    token: 'tok-1',
    role: 'reviewer',
    expires_at: null,
    url: 'http://localhost/#/share/tok-1',
    created_at: '2026-09-01T00:00:00Z',
    accepted_by: [
      { user_id: 'u-rev', email: 'rev@x.io', display_name: '', accepted_at: '2026-09-02T00:00:00Z' },
      { user_id: 'u-guest', email: 'guest@x.io', display_name: '客人', accepted_at: '2026-09-03T00:00:00Z' },
    ],
  },
  { token: 'tok-2', role: 'viewer', expires_at: '2000-01-01T00:00:00Z', url: 'http://localhost/#/share/tok-2', created_at: '2026-09-01T00:00:00Z', accepted_by: [] },
]
const access: AccessReport = {
  viewed: [
    { user: owner, first_seen: '2026-09-01T00:00:00Z', last_seen: '2026-09-05T12:00:00Z', count: 5, online: true },
    { user: editor, first_seen: '2026-09-01T00:00:00Z', last_seen: '2026-09-04T12:00:00Z', count: 2, online: false },
  ],
  not_viewed: [
    { user: reviewer, email: reviewer.email, via: 'member' },
    { user: null, email: 'new@x.io', via: 'invite' },
    { user: null, email: 'guest@x.io', via: 'link' },
  ],
}

beforeEach(() => {
  desktop = true
  useStudio.getState().resetCollabCenter()
  useStudio.setState({ pid: 'method', toasts: [], members: [], membersLoading: false, shareLinks: [], shareLinksLoading: false, user: null, project: null, collabReadonly: false, peers: [] })
  vi.spyOn(api, 'members').mockResolvedValue(members)
  vi.spyOn(api, 'shareLinks').mockResolvedValue(links)
  vi.spyOn(api, 'publicLinks').mockResolvedValue([])
  vi.spyOn(api, 'invites').mockResolvedValue(invites)
  vi.spyOn(api, 'access').mockResolvedValue(access)
  vi.spyOn(api, 'collabSettings').mockResolvedValue({ allow_download: true, allow_copy: false, allow_comment: true })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const qa = (sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
/** Radix Tabs 在 mousedown 激活 */
const press = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
/** Radix Select 触发器：pointerdown 打开，选项 pointerup 选中（jsdom 下 click 也可） */
const openSelect = (trigger: Element) =>
  act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }))
  })
const option = (label: string) => qa('[role="option"]').find((o) => o.textContent === label)!
const noop = () => {}

describe('B3 format', () => {
  it('fmtSeen / fmtExpiry：相对时间、永久、到期、已过期、原串回退', () => {
    const now = Date.parse('2026-09-05T12:00:00Z')
    expect(fmtSeen('2026-09-05T11:57:00Z', now)).toBe('3 分钟前')
    expect(fmtSeen(undefined)).toBe('')
    expect(fmtSeen('not-a-date')).toBe('not-a-date')
    expect(fmtExpiry({ expires_at: null })).toBe('永久有效')
    expect(fmtExpiry({ expires_at: '2000-01-01T00:00:00Z' }, now)).toBe('已过期')
    expect(fmtExpiry({ expires_at: '2026-12-31T12:00:00Z' }, now)).toMatch(/^2026-12-31 到期$/)
  })
})

describe('B3 MembersSection（14 §6.2 / D11）', () => {
  const base = {
    pid: 'method',
    members,
    invites,
    onlineIds: new Set(['u-owner']),
    meId: 'u-owner',
    lastSeen: new Map([['u-editor', '2026-09-04T12:00:00Z']]),
    onInvite: noop,
    onSetMemberRole: noop,
    onRemoveMember: noop,
    onSetInviteRole: noop,
    onRevokeInvite: noop,
  }

  it('owner：邀请表单 + 三成员行（头像 / 在线点 / 最近访问 / 角色下拉）+ 待接受行；不能移除自己；axe 无违规', async () => {
    const el = await mount(<MembersSection {...base} canManage />)
    expect(q('[data-testid="collab-invite-form"]', el)).not.toBeNull()
    expect(qa('[data-testid="collab-member-row"]', el)).toHaveLength(3)
    expect(qa('[data-testid="collab-invite-row"]', el)).toHaveLength(1)
    expect(q('[data-testid="collab-invite-row"]', el)!.textContent).toContain('待接受')
    expect(qa('[data-testid="collab-online-dot"]', el)).toHaveLength(1)
    expect(q('[data-testid="collab-member-seen"]', el)!.textContent).toContain('最近')
    // reviewer 无 display_name ⇒ 显示邮箱
    expect(q('[data-user-id="u-rev"]', el)!.textContent).toContain('rev@x.io')
    expect(q('[data-testid="collab-members-summary"]', el)!.textContent).toContain('成员 3')
    expect(q('[data-testid="collab-members-summary"]', el)!.textContent).toContain('待接受 1')
    expect(q<HTMLButtonElement>('[data-testid="collab-member-remove-u-owner"]', el)!.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="collab-member-remove-u-editor"]', el)!.disabled).toBe(false)
    expect(await violations(el)).toEqual([])
  })

  it('成员角色下拉含 reviewer；唯一 owner 的降级项禁用；editor 行可选 owner', async () => {
    const onSetMemberRole = vi.fn()
    const el = await mount(<MembersSection {...base} canManage onSetMemberRole={onSetMemberRole} />)
    await openSelect(q('[data-testid="collab-member-role-u-owner"]', el)!)
    const labels = qa('[role="option"]').map((o) => o.textContent)
    expect(labels).toEqual(['所有者', '代理人', '编辑者', '审阅者', '查看者'])
    expect(option('审阅者').getAttribute('aria-disabled')).toBe('true')
    expect(option('编辑者').getAttribute('aria-disabled')).toBe('true')
    expect(option('所有者').getAttribute('aria-disabled')).not.toBe('true')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    await openSelect(q('[data-testid="collab-member-role-u-editor"]', el)!)
    expect(option('所有者').getAttribute('aria-disabled')).not.toBe('true')
    await click(option('审阅者'))
    expect(onSetMemberRole).toHaveBeenCalledWith('u-editor', 'reviewer')
  })

  it('批52：成员选「所有者」先 arm 不直写——确认才 onSetRole(owner)，取消复位', async () => {
    const onSetMemberRole = vi.fn()
    const el = await mount(<MembersSection {...base} canManage onSetMemberRole={onSetMemberRole} />)
    await openSelect(q('[data-testid="collab-member-role-u-editor"]', el)!)
    await click(option('所有者'))
    expect(onSetMemberRole).not.toHaveBeenCalled()
    expect(q('[data-testid="collab-member-owner-confirm-u-editor"]', el)).not.toBeNull()
    await act(async () => q('[data-testid="collab-member-owner-cancel-u-editor"]', el)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(q('[data-testid="collab-member-role-u-editor"]', el)).not.toBeNull()
    await openSelect(q('[data-testid="collab-member-role-u-editor"]', el)!)
    await click(option('所有者'))
    await act(async () => q('[data-testid="collab-member-owner-confirm-u-editor"]', el)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSetMemberRole).toHaveBeenCalledWith('u-editor', 'owner')
  })

  it('非 owner（canManage=false）：无邀请表单、无下拉、角色只显示徽标', async () => {
    const el = await mount(<MembersSection {...base} canManage={false} meId="u-editor" />)
    expect(q('[data-testid="collab-invite-form"]', el)).toBeNull()
    expect(qa('[role="combobox"]', el)).toHaveLength(0)
    expect(q('[data-testid="collab-member-role-u-owner"]', el)!.textContent).toBe('所有者')
    expect(q('[data-testid="collab-invite-row"]', el)!.textContent).toContain('审阅者')
    expect(await violations(el)).toEqual([])
  })

  it('邀请表单：输入邮箱 + 选 reviewer 提交 ⇒ onInvite(email, "reviewer") 并清空；待接受行撤销 ⇒ onRevokeInvite', async () => {
    const onInvite = vi.fn()
    const onRevokeInvite = vi.fn()
    const onSetInviteRole = vi.fn()
    const el = await mount(<MembersSection {...base} canManage onInvite={onInvite} onRevokeInvite={onRevokeInvite} onSetInviteRole={onSetInviteRole} />)
    const input = q<HTMLInputElement>('[data-testid="collab-invite-email"]', el)!
    const submit = q<HTMLButtonElement>('[data-testid="collab-invite-submit"]', el)!
    expect(submit.disabled).toBe(true)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'someone@x.io')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(submit.disabled).toBe(false)
    await openSelect(q('[data-testid="collab-invite-role"]', el)!)
    expect(qa('[role="option"]').map((o) => o.textContent)).toEqual(['代理人', '编辑者', '审阅者', '查看者'])
    await click(option('审阅者'))
    await act(async () => q('form', el)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(onInvite).toHaveBeenCalledWith('someone@x.io', 'reviewer')
    expect(input.value).toBe('')

    await click(q('[data-testid="collab-invite-revoke-new@x.io"]', el)!)
    await click(q('[data-testid="collab-invite-revoke-confirm-new@x.io"]', el)!)
    expect(onRevokeInvite).toHaveBeenCalledWith('new@x.io')
    await openSelect(q('[data-testid="collab-invite-role-new@x.io"]', el)!)
    await click(option('编辑者'))
    expect(onSetInviteRole).toHaveBeenCalledWith('new@x.io', 'editor')
  })

  it('批71：邀请邮箱草稿卸载保命——抽屉关即卸载 MembersSection，重挂后邮箱/角色原样恢复', async () => {
    let el = await mount(<MembersSection {...base} canManage />)
    await act(async () => {
      const input = q<HTMLInputElement>('[data-testid="collab-invite-email"]', el)!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'half@x.io')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await openSelect(q('[data-testid="collab-invite-role"]', el)!)
    await click(option('审阅者'))
    expect(useStudio.getState().inviteDraft).toEqual({ email: 'half@x.io', role: 'reviewer' })
    await act(async () => root?.unmount())
    host.remove()
    el = await mount(<MembersSection {...base} canManage />)
    expect(q<HTMLInputElement>('[data-testid="collab-invite-email"]', el)!.value).toBe('half@x.io')
    expect(q('[data-testid="collab-invite-role"]', el)!.textContent).toContain('审阅者')
  })

  it('invitesUnavailable ⇒ 段内占位提示', async () => {
    const el = await mount(<MembersSection {...base} invites={[]} canManage invitesUnavailable />)
    expect(q('[data-testid="collab-invites-unavailable"]', el)).not.toBeNull()
  })
})

describe('B3 LinksSection（14 §6.2）', () => {
  it('链接行：角色标签 / 到期 / 复制 / 撤销 / accepted_by 展开；已过期标红；axe 无违规', async () => {
    const onRevoke = vi.fn()
    const onCreate = vi.fn()
    const el = await mount(<LinksSection pid="method" links={links} canManage onCreate={onCreate} onRevoke={onRevoke} />)
    const rows = qa('[data-testid="collab-link-row"]', el)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('审阅者')
    expect(rows[0].textContent).toContain('永久有效')
    expect(rows[1].textContent).toContain('已过期')
    expect(q('[data-testid="collab-links-summary"]', el)!.textContent).toContain('经链接进入 2 人')
    expect(q('[data-testid="collab-link-accepted-none-tok-2"]', el)).not.toBeNull()

    const toggle = q('[data-testid="collab-link-accepted-toggle-tok-1"]', el)!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-testid="collab-link-accepted-tok-1"]', el)).toBeNull()
    await click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const accepted = q('[data-testid="collab-link-accepted-tok-1"]', el)!
    expect(qa('li', accepted).map((li) => li.textContent)).toEqual([expect.stringContaining('rev@x.io'), expect.stringContaining('客人')])

    await click(q('[data-testid="collab-link-revoke-tok-2"]', el)!)
    await click(q('[data-testid="collab-link-revoke-confirm-tok-2"]', el)!)
    expect(onRevoke).toHaveBeenCalledWith('tok-2')
    expect(await violations(el)).toEqual([])
  })

  it('新建：角色含 reviewer，有效期 7/30/永久 ⇒ onCreate(role, days|null)', async () => {
    const onCreate = vi.fn()
    const el = await mount(<LinksSection pid="method" links={[]} canManage onCreate={onCreate} onRevoke={noop} />)
    expect(q('[data-testid="collab-links-empty"]', el)).not.toBeNull()
    await click(q('[data-testid="collab-link-create"]', el)!)
    expect(onCreate).toHaveBeenLastCalledWith('viewer', 7)
    await openSelect(q('[data-testid="collab-link-role"]', el)!)
    await click(option('审阅者'))
    await openSelect(q('[data-testid="collab-link-expiry"]', el)!)
    expect(qa('[role="option"]').map((o) => o.textContent)).toEqual(['7 天', '30 天', '永久'])
    await click(option('永久'))
    await click(q('[data-testid="collab-link-create"]', el)!)
    expect(onCreate).toHaveBeenLastCalledWith('reviewer', null)
  })

  it('复制成功 ⇒ 按钮变「已复制」+ toast；非 owner 无新建 / 撤销', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const el = await mount(<LinksSection pid="method" links={links} canManage={false} onCreate={noop} onRevoke={noop} />)
    expect(q('[data-testid="collab-link-form"]', el)).toBeNull()
    expect(q('[data-testid="collab-link-revoke-tok-1"]', el)).toBeNull()
    await click(q('[data-testid="collab-link-copy-tok-1"]', el)!)
    expect(writeText).toHaveBeenCalledWith('http://localhost/#/share/tok-1')
    expect(q('[data-testid="collab-link-copy-tok-1"]', el)!.textContent).toContain('已复制')
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('链接已复制')
  })
})

describe('B3 AccessSection（14 §6.2；腾讯文档已查看 / 未查看）', () => {
  it('两子 tab：已查看行（在线点 / 次数 / 最近）；未查看行（来源 成员 / 邀请 / 链接）；axe 无违规', async () => {
    const el = await mount(<AccessSection access={access} loading={false} unavailable={false} />)
    expect(q('[data-testid="collab-access-tab-viewed"]', el)!.textContent).toContain('2')
    expect(q('[data-testid="collab-access-tab-not-viewed"]', el)!.textContent).toContain('3')
    // W7 qa-06：pill TabsList p-0.5 使触发器 375 实测 40 → touch 密度 box-content 让内高回到 44
    expect(q('[data-testid="collab-access-tab-viewed"]', el)!.parentElement!.className).toContain('in-data-[density=touch]:box-content')
    const viewed = qa('[data-testid="collab-access-row"]', el)
    expect(viewed).toHaveLength(2)
    expect(viewed[0].dataset.online).toBe('true')
    expect(qa('[data-testid="collab-online-dot"]', viewed[0])).toHaveLength(1)
    expect(viewed[0].textContent).toContain('5 次')
    expect(viewed[1].textContent).toContain('最近')
    expect(qa('[data-testid="collab-access-not-viewed-row"]', el)).toHaveLength(0)

    await press(q('[data-testid="collab-access-tab-not-viewed"]', el)!)
    const nv = qa('[data-testid="collab-access-not-viewed-row"]', el)
    expect(nv.map((r) => r.dataset.via)).toEqual(['member', 'invite', 'link'])
    expect(nv[0].textContent).toContain('rev@x.io')
    expect(nv[0].textContent).toContain('经成员')
    expect(nv[1].textContent).toContain('经邀请')
    expect(nv[2].textContent).toContain('经链接')
    expect(qa('[data-testid="collab-access-row"]', el)).toHaveLength(0)
    expect(await violations(el)).toEqual([])
  })

  it('loading / unavailable / 空态', async () => {
    let el = await mount(<AccessSection access={null} loading unavailable={false} />)
    expect(q('[data-testid="collab-access-loading"]', el)).not.toBeNull()
    await act(async () => root!.unmount())
    el = await mount(<AccessSection access={null} loading={false} unavailable />)
    expect(q('[data-testid="collab-access-unavailable"]', el)).not.toBeNull()
    expect(q('[role="tab"]', el)).toBeNull()
    await act(async () => root!.unmount())
    el = await mount(<AccessSection access={{ viewed: [], not_viewed: [] }} loading={false} unavailable={false} />)
    expect(q('[data-testid="collab-access-viewed-empty"]', el)).not.toBeNull()
  })
})

describe('B3 CollabDrawer 整合（store + fixture）', () => {
  it('1440：右侧 Sheet，四段有数据；在线数来自 access.viewed[].online；owner 可管理；axe 无违规', async () => {
    useStudio.setState({ user: me })
    useStudio.getState().openCollabCenter()
    const el = await mount(<CollabDrawer />)
    const drawer = q('[data-testid="collab-drawer"]')!
    expect(drawer.getAttribute('data-side')).toBe('right')
    expect(drawer.className).toContain('w-companion')
    expect(q('[data-testid="collab-drawer-online"]')!.textContent).toContain('在线 1 人')
    expect(qa('[data-testid="collab-member-row"]')).toHaveLength(3)
    expect(qa('[data-testid="collab-invite-row"]')).toHaveLength(1)
    expect(q('[data-testid="collab-invite-form"]')).not.toBeNull()
    // 在线点 + 最近访问由 access 派生
    expect(qa('[data-testid="collab-online-dot"]', q('[data-user-id="u-owner"]')!)).toHaveLength(1)
    expect(q('[data-testid="collab-member-seen"]', q('[data-user-id="u-editor"]')!)).not.toBeNull()

    await press(q('[data-testid="collab-tab-links"]')!)
    expect(qa('[data-testid="collab-link-row"]')).toHaveLength(2)
    await press(q('[data-testid="collab-tab-access"]')!)
    expect(qa('[data-testid="collab-access-row"]')).toHaveLength(2)
    await press(q('[data-testid="collab-tab-settings"]')!)
    expect(q('#collab-setting-allow_copy')!.getAttribute('aria-checked')).toBe('false')
    expect(useStudio.getState().toasts).toEqual([])
    expect(await violations(el.ownerDocument.body)).toEqual([])
  })

  it('editor 打开：无邀请表单 / 下拉，设置开关禁用', async () => {
    useStudio.setState({ user: { ...me, id: 'u-editor' } })
    useStudio.getState().openCollabCenter('settings')
    await mount(<CollabDrawer />)
    expect(q<HTMLButtonElement>('#collab-setting-allow_download')!.disabled).toBe(true)
    await press(q('[data-testid="collab-tab-members"]')!)
    expect(q('[data-testid="collab-invite-form"]')).toBeNull()
    expect(qa('[role="combobox"]')).toHaveLength(0)
  })

  it('375：底部 Sheet 85dvh，四 tab 仍在；axe 无违规', async () => {
    desktop = false
    useStudio.setState({ user: me })
    useStudio.getState().openCollabCenter()
    const el = await mount(<CollabDrawer />)
    const drawer = q('[data-testid="collab-drawer"]')!
    expect(drawer.getAttribute('data-side')).toBe('bottom')
    expect(drawer.className).toContain('h-[85dvh]')
    expect(qa('[role="tab"]', drawer)).toHaveLength(4)
    expect(await violations(el.ownerDocument.body)).toEqual([])
  })

  it('写动作 501 ⇒ invitesUnavailable / collabSettingsUnavailable，不弹 toast', async () => {
    vi.spyOn(api, 'invite').mockRejectedValue(notImplemented('B2-reviewer-invites'))
    vi.spyOn(api, 'saveCollabSettings').mockRejectedValue(notImplemented('B1-access-log'))
    const s = useStudio.getState()
    expect(await s.invite('method', 'a@x.io', 'reviewer')).toBe(false)
    await s.saveCollabSettings('method', { allow_copy: false })
    const st = useStudio.getState()
    expect(st.invitesUnavailable).toBe(true)
    expect(st.collabSettingsUnavailable).toBe(true)
    expect(st.collabSettings.allow_copy).toBe(true)
    expect(st.toasts).toEqual([])
  })

  it('setMemberRole 成功 ⇒ members 更新；失败 ⇒ toast', async () => {
    vi.spyOn(api, 'setMemberRole').mockResolvedValueOnce([{ ...editor, role: 'reviewer' }, owner])
    await useStudio.getState().setMemberRole('method', 'u-editor', 'reviewer')
    expect(useStudio.getState().members.find((m) => m.user_id === 'u-editor')?.role).toBe('reviewer')
    vi.spyOn(api, 'setMemberRole').mockRejectedValueOnce(new ApiError(409, '至少保留一名所有者'))
    await useStudio.getState().setMemberRole('method', 'u-owner', 'editor')
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('至少保留一名所有者')
  })
})

describe('B3 ModeIndicator（编辑 / 审阅 / 只读）', () => {
  it('readonly 静态徽标；compact 只显示图标但保留 aria-label；可切时下拉含 编辑 / 审阅', async () => {
    const onChange = vi.fn()
    const el = await mount(
      <>
        <ModeIndicator mode="readonly" canSwitch={false} onChange={onChange} />
        <ModeIndicator mode="review" canSwitch={false} onChange={onChange} compact />
        <ModeIndicator mode="edit" canSwitch onChange={onChange} />
      </>,
    )
    const [ro, compact, sw] = qa('[data-testid="mode-indicator"]', el)
    expect(ro.textContent).toContain('只读')
    expect(ro.getAttribute('data-mode')).toBe('readonly')
    expect(compact.textContent).toBe('')
    expect(compact.getAttribute('aria-label')).toBe('审阅模式')
    // W7 ux-08：compact 视觉 40×40，after: 伪元素外扩 4px（包含块 = padding box 38 ⇒ 46）到 ≥44 热区；浏览器实测 -inset-0.5 只到 42
    expect(compact.className).toMatch(/\bsize-10\b/)
    expect(compact.className).toMatch(/\brelative\b/)
    expect(compact.className).toMatch(/\bafter:absolute\b/)
    expect(compact.className).toMatch(/\bafter:-inset-1\b/)
    expect(compact.className).toMatch(/after:content-\['']/)
    expect(sw.className).not.toMatch(/after:/)
    await act(async () => sw.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
    const items = qa('[role="menuitem"]')
    expect(items.map((i) => i.dataset.testid)).toEqual(['mode-option-edit', 'mode-option-review'])
    // 非模态（同全站其余 DropdownMenu）：开菜单不给页面其余内容加 aria-hidden，避免 axe aria-hidden-focus
    expect(ro.closest('[aria-hidden="true"]')).toBeNull()
    expect(document.querySelectorAll('[data-aria-hidden="true"]')).toHaveLength(0)
    await click(q('[data-testid="mode-option-review"]')!)
    expect(onChange).toHaveBeenCalledWith('review')
    expect(await violations(el)).toEqual([])
  })
})

describe('B3 段内错误行（R115 批10：读失败上屏 + 重试，不再静默假空态）', () => {
  it('MembersSection：error 时显错误行且压住空态，点重试调 onRetry', async () => {
    const onRetry = vi.fn()
    const el = await mount(<MembersSection {...{ pid: 'method', members: [], invites: [], onlineIds: new Set(), meId: 'u-owner', lastSeen: new Map(), onInvite: noop, onSetMemberRole: noop, onRemoveMember: noop, onSetInviteRole: noop, onRevokeInvite: noop }} canManage error="boom" onRetry={onRetry} />)
    const err = q('[data-testid="collab-members-error"]', el)!
    expect(err).not.toBeNull()
    expect(err.textContent).toContain('成员列表加载失败')
    expect(q('[data-testid="collab-members-empty"]', el)).toBeNull()
    await click(q('[data-testid="collab-members-error-retry"]', el)!)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('LinksSection / AccessSection：error 上屏，空态与 tabs 骨架让位', async () => {
    const onRetry = vi.fn()
    let el = await mount(<LinksSection pid="method" links={[]} canManage onCreate={noop} onRevoke={noop} error="boom" onRetry={onRetry} />)
    expect(q('[data-testid="collab-links-error"]', el)).not.toBeNull()
    expect(q('[data-testid="collab-links-empty"]', el)).toBeNull()
    await click(q('[data-testid="collab-links-error-retry"]', el)!)
    expect(onRetry).toHaveBeenCalledTimes(1)
    await act(async () => root!.unmount())
    el = await mount(<AccessSection access={null} loading={false} unavailable={false} error="boom" onRetry={onRetry} />)
    expect(q('[data-testid="collab-access-error"]', el)).not.toBeNull()
    expect(q('[data-testid="collab-access-loading"]', el)).toBeNull()
    expect(q('[role="tab"]', el)).toBeNull()
  })

  it('store：loadMembers/loadShareLinks 失败写各自 error 字段（不再进 authError），成功自清', async () => {
    useStudio.setState({ membersError: null, shareLinksError: null, authError: null })
    vi.spyOn(api, 'members').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadMembers('method')
    expect(useStudio.getState().membersError).toBe('boom')
    expect(useStudio.getState().authError).toBeNull()
    await useStudio.getState().loadMembers('method')
    expect(useStudio.getState().membersError).toBeNull()

    vi.spyOn(api, 'shareLinks').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadShareLinks('method')
    expect(useStudio.getState().shareLinksError).toBe('boom')
    expect(useStudio.getState().authError).toBeNull()
  })

  it('store：loadAccess/loadInvites/loadCollabSettings 非 501 写 error 不弹 toast；501 仍走 unavailable', async () => {
    useStudio.getState().resetCollabCenter()
    vi.spyOn(api, 'access').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadAccess('method')
    expect(useStudio.getState().accessError).toBe('boom')
    expect(useStudio.getState().toasts).toHaveLength(0)
    vi.spyOn(api, 'access').mockRejectedValueOnce(notImplemented('access'))
    await useStudio.getState().loadAccess('method')
    expect(useStudio.getState().accessError).toBeNull()
    expect(useStudio.getState().accessUnavailable).toBe(true)

    vi.spyOn(api, 'invites').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadInvites('method')
    expect(useStudio.getState().invitesError).toBe('boom')

    vi.spyOn(api, 'collabSettings').mockRejectedValueOnce(new ApiError(500, 'boom'))
    await useStudio.getState().loadCollabSettings('method')
    expect(useStudio.getState().collabSettingsError).toBe('boom')
    await useStudio.getState().loadCollabSettings('method')
    expect(useStudio.getState().collabSettingsError).toBeNull()
  })
})

describe('B3 读取闸（R115 批11a：首开不再闪「暂无成员 / 链接 0」假空态）', () => {
  const sectionProps = { pid: 'method', members: [], invites: [], onlineIds: new Set<string>(), meId: 'u-owner', lastSeen: new Map<string, string>(), onInvite: noop, onSetMemberRole: noop, onRemoveMember: noop, onSetInviteRole: noop, onRevokeInvite: noop }

  it('MembersSection：loading + 空表显骨架，空态文案与汇总计数都不上屏', async () => {
    const el = await mount(<MembersSection {...sectionProps} canManage loading />)
    expect(q('[data-testid="collab-members-loading"]', el)).not.toBeNull()
    expect(q('[data-testid="collab-members-empty"]', el)).toBeNull()
    expect(q('[data-testid="collab-members-summary"]', el)).toBeNull()
  })

  it('MembersSection：有缓存成员时 loading 不盖列表（轮询重取不闪骨架）', async () => {
    const el = await mount(<MembersSection {...sectionProps} members={members} canManage loading />)
    expect(q('[data-testid="collab-members-loading"]', el)).toBeNull()
    expect(qa('[data-testid="collab-member-row"]', el).length).toBe(members.length)
  })

  it('LinksSection：loading + 空表显骨架，「链接 0」计数与空态都不上屏', async () => {
    const el = await mount(<LinksSection pid="method" links={[]} canManage loading onCreate={noop} onRevoke={noop} />)
    expect(q('[data-testid="collab-links-loading"]', el)).not.toBeNull()
    expect(q('[data-testid="collab-links-summary"]', el)).toBeNull()
    expect(q('[data-testid="collab-links-empty"]', el)).toBeNull()
  })

  it('SettingsSection：loading 时开关禁用（默认值不可信，同 error 闸）', async () => {
    const settings = { allow_download: true, allow_copy: true, allow_comment: true }
    const el = await mount(<SettingsSection settings={settings} canManage unavailable={false} loading onChange={noop} />)
    for (const k of ['allow_download', 'allow_copy', 'allow_comment']) {
      expect(q<HTMLButtonElement>(`[data-testid="collab-setting-${k}"]`, el)!.disabled).toBe(true)
    }
  })

  it('store：loadMembers/loadShareLinks/loadCollabSettings 在飞置 loading，落地清零', async () => {
    const defer = <T,>() => { let resolve!: (v: T) => void; return { promise: new Promise<T>((r) => (resolve = r)), resolve } }
    const m = defer<typeof members>()
    vi.spyOn(api, 'members').mockImplementationOnce(() => m.promise)
    const p1 = useStudio.getState().loadMembers('method')
    expect(useStudio.getState().membersLoading).toBe(true)
    m.resolve(members)
    await p1
    expect(useStudio.getState().membersLoading).toBe(false)

    const l = defer<typeof links>()
    vi.spyOn(api, 'shareLinks').mockImplementationOnce(() => l.promise)
    const p2 = useStudio.getState().loadShareLinks('method')
    expect(useStudio.getState().shareLinksLoading).toBe(true)
    l.resolve(links)
    await p2
    expect(useStudio.getState().shareLinksLoading).toBe(false)

    const c = defer<Awaited<ReturnType<typeof api.collabSettings>>>()
    vi.spyOn(api, 'collabSettings').mockImplementationOnce(() => c.promise)
    const p3 = useStudio.getState().loadCollabSettings('method')
    expect(useStudio.getState().collabSettingsLoading).toBe(true)
    c.resolve({ allow_download: true, allow_copy: true, allow_comment: true })
    await p3
    expect(useStudio.getState().collabSettingsLoading).toBe(false)
  })
})
