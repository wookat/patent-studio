// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { avatarColorFor, type AdminUser } from '@/types/account'
import { AdminPage } from '@/components/admin/AdminPage'
import { fmtLastLogin, MemberTable } from '@/components/admin/MemberTable'
import { AccountPage } from '../AccountPage'
import { PasswordForm } from '../PasswordForm'
import { ProfileForm } from '../ProfileForm'

/**
 * W4-E E2（docs/plan/17 §3 / §4）：#/account 与 #/admin 的 DOM 合约 + axe 冒烟。
 *  - ProfileForm：显示名 / 头衔 / 头像色 → onSave(MeIn)；501 时禁用
 *  - PasswordForm：两次新密码不一致阻止提交；onSave({ password: { current, new } })
 *  - MemberTable：1440 表格 / 375 卡片；对自己 / 最后一位管理员不能禁用或降级；501 空态
 *  - AccountPage / AdminPage：auth=off（admin 只请求 org，不碰 /api/admin/users）、非超管 forbidden、两断点 axe
 *  - 真契约：PUT /users/me 200 覆盖 auth.user；GET /admin/users 200 渲染成员行，PUT 后替换该行；403 / 409 走 toast
 * 后端 501（auth=off 的 /users/me PUT 与 /admin/users）：store 收到 ApiError 501 ⇒ meUnavailable / adminUnavailable。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const initial = useStudio.getInitialState()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notImplemented = () => json({ detail: { kind: 'not-implemented', message: 'W4-E E2 未实现', line: null, detail: null } }, 501)

const me: User = { id: 'u1', email: 'me@x', display_name: '王代理', is_superuser: true, title: '代理师', avatar_color: '' }
const rows: AdminUser[] = [
  { id: 'u1', email: 'me@x', display_name: '王代理', title: '代理师', avatar_color: 'blue', is_superuser: true, is_active: true, last_login_at: '2026-09-05T08:00:00+00:00' },
  { id: 'u2', email: 'b@x', display_name: '', title: '', avatar_color: '', is_superuser: false, is_active: false, last_login_at: null },
]

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  useStudio.setState(initial, true)
  desktop = true
  window.location.hash = ''
})

/** 二级导航切页（W5：#/account?tab= / #/admin?tab=）；jsdom 的 hashchange 异步，这里同步派发 */
const goTab = (hash: string) =>
  act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
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
  await act(async () => root!.render(el))
  return host
}

async function serious(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel)
const qa = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}
const type = async (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = (sel: string) => act(async () => q<HTMLFormElement>(sel)!.requestSubmit())

describe('ProfileForm / PasswordForm', () => {
  it('头像色按名字派生且稳定；改显示名后保存 → onSave 只带改动字段', async () => {
    expect(avatarColorFor('王代理')).toBe(avatarColorFor('王代理'))
    const onSave = vi.fn(async () => null)
    await mount(<ProfileForm user={me} saving={false} unavailable={false} onSave={onSave} />)
    expect(q<HTMLButtonElement>('[data-testid="profile-save"]')?.disabled).toBe(true)
    await type(q<HTMLInputElement>('[data-testid="profile-name"]')!, '李代理')
    expect(q<HTMLButtonElement>('[data-testid="profile-save"]')?.disabled).toBe(false)
    await submit('[data-testid="profile-form"]')
    expect(onSave).toHaveBeenCalledWith({ display_name: '李代理' })
    expect(await serious(host)).toEqual([])
  })
  it('501 → 输入与保存禁用并提示', async () => {
    await mount(<ProfileForm user={me} saving={false} unavailable onSave={async () => null} />)
    expect(q<HTMLInputElement>('[data-testid="profile-name"]')?.disabled).toBe(true)
    expect(q('[data-testid="profile-unavailable"]')).not.toBeNull()
  })
  it('两次新密码不一致 → alert；一致 → onSave({ password })', async () => {
    const onSave = vi.fn(async () => null)
    await mount(<PasswordForm saving={false} unavailable={false} onSave={onSave} />)
    await type(q<HTMLInputElement>('[data-testid="password-current"]')!, 'old-secret')
    await type(q<HTMLInputElement>('[data-testid="password-new"]')!, 'new-secret-1')
    await type(q<HTMLInputElement>('[data-testid="password-confirm"]')!, 'new-secret-2')
    await submit('[data-testid="password-form"]')
    expect(q('[data-testid="password-error"]')).not.toBeNull()
    expect(onSave).not.toHaveBeenCalled()
    await type(q<HTMLInputElement>('[data-testid="password-confirm"]')!, 'new-secret-1')
    await submit('[data-testid="password-form"]')
    expect(onSave).toHaveBeenCalledWith({ password: { current: 'old-secret', new: 'new-secret-1' } })
  })
  it('服务端字段错落字段（R71-02）：{current: ...} → 当前密码字段标红；{_form} → 表单级 alert', async () => {
    const onSave = vi.fn(async () => ({ current: '当前密码不正确' }))
    await mount(<PasswordForm saving={false} unavailable={false} onSave={onSave} />)
    await type(q<HTMLInputElement>('[data-testid="password-current"]')!, 'wrong-secret')
    await type(q<HTMLInputElement>('[data-testid="password-new"]')!, 'new-secret-1')
    await type(q<HTMLInputElement>('[data-testid="password-confirm"]')!, 'new-secret-1')
    await submit('[data-testid="password-form"]')
    expect(q('[data-testid="password-current-error"]')?.textContent).toBe('当前密码不正确')
    await act(async () => root?.unmount())
    const onSave2 = vi.fn(async () => ({ _form: '服务不可用' }))
    await mount(<PasswordForm saving={false} unavailable={false} onSave={onSave2} />)
    await type(q<HTMLInputElement>('[data-testid="password-current"]')!, 'old-secret')
    await type(q<HTMLInputElement>('[data-testid="password-new"]')!, 'new-secret-1')
    await type(q<HTMLInputElement>('[data-testid="password-confirm"]')!, 'new-secret-1')
    await submit('[data-testid="password-form"]')
    expect(q('[data-testid="password-error"]')?.textContent).toBe('服务不可用')
  })
})

describe('MemberTable', () => {
  it('1440 表格：每行头衔 / 最近登录 / 超管与启用开关；对自己禁用开关不可用', async () => {
    const onUpdate = vi.fn(async () => true)
    await mount(<MemberTable rows={rows} selfId="u1" loading={false} unavailable={false} error={null} onUpdate={onUpdate} />)
    expect(q('table[data-testid="member-table"]')).not.toBeNull()
    const trs = qa('[data-testid="member-row"]')
    expect(trs).toHaveLength(2)
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-active"]', trs[0])?.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-super"]', trs[0])?.disabled).toBe(true)
    expect(trs[1].dataset.active).toBe('false')
    await click(q('[data-testid="member-toggle-active"]', trs[1]))
    expect(onUpdate).toHaveBeenCalledWith('u2', { is_active: true })
    expect(fmtLastLogin(null)).toBe('从未登录')
    expect(await serious(host)).toEqual([])
  })
  it('最后一位可用管理员的禁用 / 降级锁定（即使操作者是另一人）；有两位管理员时可操作', async () => {
    const two: AdminUser[] = [rows[0], { ...rows[1], is_active: true, is_superuser: false }]
    await mount(<MemberTable rows={two} selfId="u2" loading={false} unavailable={false} error={null} onUpdate={async () => true} />)
    let trs = qa('[data-testid="member-row"]')
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-super"]', trs[0])?.disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-active"]', trs[0])?.disabled).toBe(true)
    await act(async () => root?.unmount())
    root = null
    await mount(<MemberTable rows={[two[0], { ...two[1], is_superuser: true }]} selfId="u2" loading={false} unavailable={false} error={null} onUpdate={async () => true} />)
    trs = qa('[data-testid="member-row"]')
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-super"]', trs[0])?.disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="member-toggle-active"]', trs[0])?.disabled).toBe(false)
  })
  it('375 卡片列表；501 → 空态', async () => {
    await mount(<MemberTable rows={rows} selfId="u1" loading={false} unavailable={false} error={null} onUpdate={async () => true} mobile />)
    expect(q('ul[data-testid="member-table"]')).not.toBeNull()
    expect(qa('[data-testid="member-row"]')).toHaveLength(2)
    await act(async () => root?.unmount())
    root = null
    await mount(<MemberTable rows={[]} selfId="u1" loading={false} unavailable error="not-implemented" onUpdate={async () => true} />)
    expect(q('[data-testid="member-table-empty"]')?.textContent).toContain('尚未实现')
  })
})

describe('AccountPage / AdminPage', () => {
  it('auth=off → account 空态；admin 无成员但机构名 / 标签 / 模板可用，不请求 /api/admin/users', async () => {
    useStudio.setState({ authStatus: 'off', user: null })
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://x').pathname
      calls.push(url)
      if (url === '/api/tags') return json({ tags: [] })
      if (url === '/api/templates') return json([])
      if (url === '/api/admin/org') return json(init?.method === 'PUT' ? JSON.parse(String(init.body)) : { name: '甲乙丙知识产权' })
      throw new Error(`unexpected fetch ${url}`)
    })
    await mount(<AccountPage />)
    expect(q('[data-testid="account-auth-off"]')).not.toBeNull()
    await act(async () => root?.unmount())
    root = null
    await mount(<AdminPage />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(q('[data-testid="admin-auth-off"]')).not.toBeNull()
    expect(q('[data-testid="member-table"]')).toBeNull()
    expect(calls).not.toContain('/api/admin/users')
    expect(q('[data-testid="admin-manage-tags"]')).not.toBeNull()
    await goTab('#/admin?tab=org')
    expect(q<HTMLInputElement>('[data-testid="org-name"]')?.value).toBe('甲乙丙知识产权')
    expect(q<HTMLInputElement>('[data-testid="org-name"]')?.disabled).toBe(false)
    await type(q<HTMLInputElement>('[data-testid="org-name"]')!, '丁戊己专利事务所')
    await submit('[data-testid="org-form"]')
    expect(useStudio.getState().org).toEqual({ name: '丁戊己专利事务所' })
    expect(await serious(host)).toEqual([])
  })
  it('#/account：PUT 200 → auth.user 覆盖 + toast；旧密码错 403 → 字段级错误（R71-02），表单仍可用', async () => {
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://x').pathname
      if (url === '/api/users/me' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { display_name?: string; password?: { current: string } }
        if (body.password) return json({ detail: { kind: 'forbidden', message: '当前密码不正确', line: null, detail: 'password' } }, 403)
        return json({ ...me, ...body })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    await mount(<AccountPage />)
    await type(q<HTMLInputElement>('[data-testid="profile-name"]')!, '李代理')
    await submit('[data-testid="profile-form"]')
    expect(useStudio.getState().user?.display_name).toBe('李代理')
    expect(useStudio.getState().meUnavailable).toBe(false)
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('个人资料已保存')

    await goTab('#/account?tab=security')
    await type(q<HTMLInputElement>('[data-testid="password-current"]')!, 'bad-old-pass')
    await type(q<HTMLInputElement>('[data-testid="password-new"]')!, 'new-secret-1')
    await type(q<HTMLInputElement>('[data-testid="password-confirm"]')!, 'new-secret-1')
    await submit('[data-testid="password-form"]')
    // R71-02：detail='password' 映射到当前密码字段，不再依赖 toast
    expect(q('[data-testid="password-current-error"]')?.textContent).toContain('当前密码不正确')
    expect(useStudio.getState().meUnavailable).toBe(false)
    expect(q<HTMLInputElement>('[data-testid="password-current"]')?.value).toBe('bad-old-pass') // 失败不清空
  })
  it('#/admin 真契约：成员行渲染，禁用后替换该行；409 走 toast', async () => {
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://x').pathname
      if (url === '/api/admin/users') return json(rows)
      if (url === '/api/admin/org') return json({ name: '甲乙丙知识产权' })
      if (url === '/api/admin/users/u2' && init?.method === 'PUT') {
        const patch = JSON.parse(String(init.body)) as { is_active?: boolean; is_superuser?: boolean }
        if (patch.is_superuser === false) return json({ detail: { kind: 'conflict', message: '机构至少保留一位可用的管理员', line: null, detail: null } }, 409)
        return json({ ...rows[1], ...patch })
      }
      if (url === '/api/tags') return json({ tags: [] })
      if (url === '/api/templates') return json([])
      throw new Error(`unexpected fetch ${url}`)
    })
    await mount(<AdminPage />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(useStudio.getState().adminUnavailable).toBe(false)
    expect(q('[data-testid="admin-header"]')?.textContent).toContain('甲乙丙知识产权')
    let trs = qa('[data-testid="member-row"]')
    expect(trs).toHaveLength(2)
    expect(trs[1].dataset.active).toBe('false')
    await click(q('[data-testid="member-toggle-active"]', trs[1]))
    trs = qa('[data-testid="member-row"]')
    expect(trs[1].dataset.active).toBe('true')
    expect(useStudio.getState().adminUsers[1].is_active).toBe(true)
    // 模拟后端 409：先把 u2 设为管理员（成功），再撤销 → 409 toast，行不变
    // 测试契约更新：授/撤超管走两阶确认（批52 arm→confirm），先 arm 再点确认钮
    await click(q('[data-testid="member-toggle-super"]', trs[1]))
    trs = qa('[data-testid="member-row"]')
    await click(q('[data-testid="member-confirm-u2"]', trs[1]))
    expect(useStudio.getState().adminUsers[1].is_superuser).toBe(true)
    trs = qa('[data-testid="member-row"]')
    await click(q('[data-testid="member-toggle-super"]', trs[1]))
    trs = qa('[data-testid="member-row"]')
    await click(q('[data-testid="member-confirm-u2"]', trs[1]))
    expect(useStudio.getState().adminUsers[1].is_superuser).toBe(true)
    expect(useStudio.getState().toasts.map((t) => t.text)).toContain('机构至少保留一位可用的管理员')
    expect(useStudio.getState().adminUnavailable).toBe(false)
    expect(await serious(host)).toEqual([])
  })
  it('#/account：资料卡 + 改密 + 超管的机构管理链接；PUT 501 → meUnavailable；1440/375 axe', async () => {
    useStudio.setState({ authStatus: 'authed', user: me })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/users/me')) return notImplemented()
      throw new Error(`unexpected fetch ${url}`)
    })
    await mount(<AccountPage />)
    expect(q('[data-testid="account-card"]')).not.toBeNull()
    expect(q('[data-testid="account-admin-link"]')).not.toBeNull()
    await type(q<HTMLInputElement>('[data-testid="profile-name"]')!, '李代理')
    await submit('[data-testid="profile-form"]')
    expect(useStudio.getState().meUnavailable).toBe(true)
    expect(q('[data-testid="profile-unavailable"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
    await act(async () => root?.unmount())
    root = null
    desktop = false
    await mount(<AccountPage />)
    expect(await serious(host)).toEqual([])
  })
  it('#/admin：非超管 forbidden；超管加载成员 + 机构 + 标签 + 模板，501 → 不可用态；1440/375 axe', async () => {
    useStudio.setState({ authStatus: 'authed', user: { ...me, is_superuser: false } })
    await mount(<AdminPage />)
    expect(q('[data-testid="admin-forbidden"]')).not.toBeNull()
    await act(async () => root?.unmount())
    root = null

    useStudio.setState({ authStatus: 'authed', user: me })
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://x').pathname
      calls.push(url)
      if (url === '/api/admin/users' || url === '/api/admin/org') return notImplemented()
      if (url === '/api/tags') return json({ tags: [{ name: '加急', color: '#ef4444' }] })
      if (url === '/api/templates') return json([])
      throw new Error(`unexpected fetch ${url}`)
    })
    await mount(<AdminPage />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls).toEqual(expect.arrayContaining(['/api/admin/users', '/api/admin/org', '/api/tags']))
    expect(useStudio.getState().adminUnavailable).toBe(true)
    expect(q('[data-testid="member-table-empty"]')).not.toBeNull()
    expect(q('[data-testid="admin-tags"]')?.textContent).toContain('加急')
    expect(q('[data-testid="admin-manage-tags"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
    await goTab('#/admin?tab=org')
    expect(q('[data-testid="org-form"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
    await goTab('#/admin?tab=members')
    await act(async () => root?.unmount())
    root = null
    desktop = false
    await mount(<AdminPage />)
    expect(await serious(host)).toEqual([])
  })
})
