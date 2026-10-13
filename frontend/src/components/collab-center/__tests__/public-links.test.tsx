// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { Member, User } from '@/lib/types'
import { useStudio } from '@/store'
import type { PublicShareLink } from '@/types/public-share'
import { CollabDrawer } from '../CollabDrawer'
import { PublicLinksSection } from '../PublicLinksSection'
import { fmtPublicExpiry, publicReviewUrl } from '../format'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

const owner: Member = { user_id: 'u-owner', email: 'owner@x.io', display_name: '王所有', role: 'owner' }
const me: User = { id: 'u-owner', email: owner.email, display_name: owner.display_name, is_superuser: false }
const now = Math.floor(Date.now() / 1000)
const links: PublicShareLink[] = [
  { token: 'pub-a', pid: 'method', scope: 'confirm', baseline: 'original', allow_download: false, expires_at: now + 7 * 86400, revoked: false, created_by: { id: 'u-owner', display_name: '王所有' }, created_at: now - 3600, visits: 3, last_visit_at: now - 60 },
  { token: 'pub-b', pid: 'method', scope: 'read', baseline: 'original', allow_download: true, expires_at: null, revoked: true, created_by: { id: 'u-owner', display_name: '王所有' }, created_at: now - 86400, visits: 0, last_visit_at: null },
]

beforeEach(() => {
  useStudio.getState().resetCollabCenter()
  useStudio.setState({ pid: 'method', toasts: [], members: [], shareLinks: [], publicLinks: [], publicLinksUnavailable: false, user: me, project: null, collabReadonly: false, peers: [] })
  vi.spyOn(api, 'members').mockResolvedValue([owner])
  vi.spyOn(api, 'shareLinks').mockResolvedValue([])
  vi.spyOn(api, 'invites').mockResolvedValue([])
  vi.spyOn(api, 'access').mockResolvedValue({ viewed: [], not_viewed: [] })
  vi.spyOn(api, 'collabSettings').mockResolvedValue({ allow_download: true, allow_copy: false, allow_comment: true })
  vi.spyOn(api, 'publicLinks').mockResolvedValue(links)
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
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
  await act(async () => {})
  return host
}

async function violations(el: Element = document.body) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)
const qa = (sel: string, el: ParentNode = document) => Array.from(el.querySelectorAll<HTMLElement>(sel))
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const openSelect = (trigger: Element) =>
  act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }))
  })
const option = (label: string) => qa('[role="option"]').find((o) => o.textContent === label)!

describe('format · 客户审阅链接', () => {
  it('fmtPublicExpiry：已撤销 / 永久 / 已过期 / 到期日；publicReviewUrl 指向 #/c/<token>', () => {
    expect(fmtPublicExpiry({ expires_at: null, revoked: true })).toBe('已撤销')
    expect(fmtPublicExpiry({ expires_at: null, revoked: false })).toBe('永久有效')
    expect(fmtPublicExpiry({ expires_at: 946_684_800, revoked: false })).toBe('已过期')
    expect(fmtPublicExpiry({ expires_at: Date.UTC(2026, 11, 31, 12) / 1000, revoked: false })).toMatch(/^2026-12-31 到期$/)
    expect(publicReviewUrl('a b')).toContain('#/c/a%20b')
  })
})

describe('PublicLinksSection（21 §4.5 / §7.2 行 12）', () => {
  const noop = () => {}

  it('owner：表单（权限缺省「可确认定稿」、有效期 7 天、下载缺省不勾）+ 两行（权限 / 到期 / 访问 / 最近 / 创建人）；已撤销行无复制 / 撤销；axe 无 serious/critical', async () => {
    const el = await mount(<PublicLinksSection links={links} loading={false} unavailable={false} canManage onCreate={async () => null} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-link-scope"]', el)!.textContent).toBe('可确认定稿')
    expect(q('[data-testid="collab-public-link-ttl"]', el)!.textContent).toBe('7 天')
    expect(q('[data-testid="collab-public-link-download"]', el)!.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-testid="collab-public-links-summary"]', el)!.textContent).toContain('有效链接 1')
    expect(q('[data-testid="collab-public-links-summary"]', el)!.textContent).toContain('累计访问 3')

    const a = q('[data-testid="row-pub-a"]', el)!
    expect(a.textContent).toContain('可确认定稿')
    expect(a.textContent).toMatch(/\d{4}-\d{2}-\d{2} 到期/)
    expect(q('[data-testid="collab-public-link-visits-pub-a"]', el)!.textContent).toContain('访问 3 次')
    expect(q('[data-testid="collab-public-link-visits-pub-a"]', el)!.textContent).toContain('最近')
    expect(q('[data-testid="collab-public-link-visits-pub-a"]', el)!.textContent).toContain('王所有 创建于')
    expect(q('[data-testid="collab-public-link-copy-pub-a"]', el)).not.toBeNull()
    expect(q('[data-testid="collab-public-link-revoke-pub-a"]', el)).not.toBeNull()

    const b = q('[data-testid="row-pub-b"]', el)!
    expect(b.textContent).toContain('已撤销')
    expect(b.textContent).toContain('可下载')
    expect(b.textContent).toContain('尚未被打开')
    expect(q('[data-testid="collab-public-link-copy-pub-b"]', el)).toBeNull()
    expect(q('[data-testid="collab-public-link-revoke-pub-b"]', el)).toBeNull()

    expect(await violations(el)).toEqual([])
  })

  it('生成：选「可批注」+「1 天」+ 勾下载 → onCreate({scope, ttl_days:1, allow_download:true})，成功后自动复制 URL；撤销回调带 token', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ...links[0], token: 'pub-new', scope: 'comment' })
    const onRevoke = vi.fn()
    const el = await mount(<PublicLinksSection links={links} loading={false} unavailable={false} canManage onCreate={onCreate} onRevoke={onRevoke} />)
    await openSelect(q('[data-testid="collab-public-link-scope"]', el)!)
    await click(option('可批注'))
    await openSelect(q('[data-testid="collab-public-link-ttl"]', el)!)
    await click(option('1 天'))
    await click(q('[data-testid="collab-public-link-download"]', el)!)
    await click(q('[data-testid="collab-public-link-create"]', el)!)
    expect(onCreate).toHaveBeenCalledWith({ scope: 'comment', ttl_days: 1, allow_download: true })
    await act(async () => {})
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicReviewUrl('pub-new'))
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('审阅链接已生成')

    await click(q('[data-testid="collab-public-link-copy-pub-a"]', el)!)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicReviewUrl('pub-a'))
    await click(q('[data-testid="collab-public-link-revoke-pub-a"]', el)!)
    await click(q('[data-testid="collab-public-link-revoke-confirm-pub-a"]', el)!)
    expect(onRevoke).toHaveBeenCalledWith('pub-a')
  })

  it('W9 domain-02：无未决修订 ⇒ 无警告 / 无基线选择且 onCreate 不带 baseline；有 N 条 ⇒ 警告含 N、缺省「我已定的正文」→ baseline:original，改选「含未决修订」→ final；final 链接卡有徽章', async () => {
    const onCreate = vi.fn().mockResolvedValue(null)
    let el = await mount(<PublicLinksSection links={links} loading={false} unavailable={false} canManage onCreate={onCreate} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-link-pending"]', el)).toBeNull()
    expect(q('[data-testid="collab-public-link-baseline"]', el)).toBeNull()
    expect(q('[data-testid="collab-public-link-baseline-pub-a"]', el)).toBeNull()
    await click(q('[data-testid="collab-public-link-create"]', el)!)
    expect(onCreate).toHaveBeenLastCalledWith({ scope: 'confirm', ttl_days: 7, allow_download: false })

    await act(async () => root?.unmount())
    host?.remove()
    const finalLink: PublicShareLink = { ...links[0], token: 'pub-final', baseline: 'final' }
    el = await mount(<PublicLinksSection links={[...links, finalLink]} loading={false} unavailable={false} canManage pendingRevisions={2} onCreate={onCreate} onRevoke={noop} />)
    const warn = q('[data-testid="collab-public-link-pending"]', el)!
    expect(warn.getAttribute('role')).toBe('status')
    expect(q('[data-testid="collab-public-link-pending-count"]', el)!.textContent).toBe('2')
    expect(warn.textContent).toContain('不会把待定建议当作定稿')
    expect(q('[data-testid="collab-public-link-baseline"]', el)!.textContent).toContain('我已定的正文')
    expect(q('[data-testid="collab-public-link-baseline-pub-final"]', el)!.textContent).toBe('含未决修订')
    expect(q('[data-testid="collab-public-link-baseline-pub-a"]', el)).toBeNull()
    await click(q('[data-testid="collab-public-link-create"]', el)!)
    expect(onCreate).toHaveBeenLastCalledWith({ scope: 'confirm', ttl_days: 7, allow_download: false, baseline: 'original' })

    await openSelect(q('[data-testid="collab-public-link-baseline"]', el)!)
    await click(option('含未决修订（建议全部视为接受）'))
    await click(q('[data-testid="collab-public-link-create"]', el)!)
    expect(onCreate).toHaveBeenLastCalledWith({ scope: 'confirm', ttl_days: 7, allow_download: false, baseline: 'final' })
    expect(await violations(el)).toEqual([])
  })

  it('加载骨架 / 空态 / 501 占位「功能开发中」', async () => {
    let el = await mount(<PublicLinksSection links={[]} loading unavailable={false} canManage onCreate={async () => null} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-links-loading"]', el)).not.toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    el = await mount(<PublicLinksSection links={[]} loading={false} unavailable={false} canManage onCreate={async () => null} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-links-empty"]', el)!.textContent).toContain('尚无客户审阅链接')
    await act(async () => root?.unmount())
    host.remove()

    el = await mount(<PublicLinksSection links={[]} loading={false} unavailable canManage onCreate={async () => null} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-links-unavailable"]', el)!.textContent).toContain('功能开发中')
    expect(q('[data-testid="collab-public-link-form"]', el)).toBeNull()
    await act(async () => root?.unmount())
    host.remove()

    el = await mount(<PublicLinksSection links={[]} loading={false} unavailable={false} error="服务器开小差" canManage onCreate={async () => null} onRevoke={noop} />)
    expect(q('[data-testid="collab-public-links-error"]', el)!.textContent).toContain('服务器开小差')
    expect(q('[data-testid="collab-public-link-form"]', el)).not.toBeNull()
  })
})

describe('CollabDrawer 集成', () => {
  it('owner 打开「链接」tab：登录协作链接段之后出现客户审阅链接段并已拉取 GET /public-links；撤销走 store', async () => {
    vi.spyOn(api, 'revokePublicLink').mockResolvedValue(undefined)
    useStudio.setState({ members: [owner] })
    useStudio.getState().openCollabCenter('links')
    const el = await mount(<CollabDrawer />)
    expect(api.publicLinks).toHaveBeenCalledWith('method')
    const drawer = q('[data-testid="collab-drawer"]')!
    expect(q('[data-testid="collab-links"]', drawer) ?? q('[data-slot="LinksSection"]', drawer)).not.toBeNull()
    expect(q('[data-testid="collab-public-links"]', drawer)).not.toBeNull()
    expect(qa('[data-testid^="row-pub-"]', drawer)).toHaveLength(2)

    await click(q('[data-testid="collab-public-link-revoke-pub-a"]', drawer)!)
    await click(q('[data-testid="collab-public-link-revoke-confirm-pub-a"]', drawer)!)
    expect(api.revokePublicLink).toHaveBeenCalledWith('method', 'pub-a')
    expect(useStudio.getState().publicLinks.find((l) => l.token === 'pub-a')?.revoked).toBe(true)
    expect(q('[data-testid="collab-public-link-revoke-pub-a"]', drawer)).toBeNull()
    void el
  })

  it('非 owner：不拉 public-links，也不显示客户审阅链接段', async () => {
    useStudio.setState({ user: { ...me, id: 'u-editor' }, members: [owner, { user_id: 'u-editor', email: 'e@x.io', display_name: '李编辑', role: 'editor' }] })
    useStudio.getState().openCollabCenter('links')
    await mount(<CollabDrawer />)
    expect(api.publicLinks).not.toHaveBeenCalled()
    expect(q('[data-testid="collab-public-links"]')).toBeNull()
  })
})
