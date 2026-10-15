// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { User } from '@/lib/types'
import { useStudio } from '@/store'
import { LoginPage } from '../LoginPage'
import { UserMenu } from '../UserMenu'
import { authErrorText, enterWorkspace } from '../session'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

const me: User = { id: 'u1', email: 'a@b.c', display_name: '', is_superuser: false }

beforeEach(() => {
  window.location.hash = ''
  useStudio.setState({ pid: null, projects: [], authStatus: 'anon', user: null, authError: null, dialog: null, toasts: [] })
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
const setValue = (input: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const submit = (form: HTMLFormElement) => act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

describe('LoginPage（07 §7.1）', () => {
  it('登录 / 注册同卡片 Segmented 切换：注册多出显示名，提交文案变化，axe 无违规', async () => {
    const el = await mount(<LoginPage />)
    expect(q<HTMLInputElement>('[data-testid="login-email"]', el)?.type).toBe('email')
    expect(q('[data-testid="login-display-name"]', el)).toBeNull()
    expect(q('[data-testid="login-submit"]', el)?.textContent).toBe('登录')
    expect(q('[data-testid="login-tab-login"]', el)?.getAttribute('aria-checked')).toBe('true')
    await act(async () => q<HTMLButtonElement>('[data-testid="login-tab-register"]', el)!.click())
    expect(q('[data-testid="login-tab-register"]', el)?.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-testid="login-display-name"]', el)).not.toBeNull()
    expect(q('[data-testid="login-submit"]', el)?.textContent).toBe('注册并登录')
    expect(q<HTMLInputElement>('[data-testid="login-password"]', el)?.autocomplete).toBe('new-password')
    expect(await violations(el)).toEqual([])
  })

  it('W5 走查 ux-07：主按钮 桌面 lg（h-lg-control）/ 375 xl（h-touch 44），不再手写 h-10', async () => {
    const mm = window.matchMedia
    window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    try {
      const el = await mount(<LoginPage />)
      const cls = q('[data-testid="login-submit"]', el)!.className
      expect(cls).toContain('h-touch')
      expect(cls).not.toMatch(/\bh-10\b/)
    } finally {
      window.matchMedia = mm
    }
  })

  it('W8 375：主按钮唯一 44（h-touch）；Segmented md；密码眼 icon-xs；次要链接 sm + touch-hit；字段 gap-1、表单 gap-4', async () => {
    const mm = window.matchMedia
    window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    try {
      const el = await mount(<LoginPage />)
      const touch = Array.from(el.querySelectorAll('button')).filter((b) => /\bh-touch\b/.test(b.className))
      expect(touch.map((b) => b.dataset.testid)).toEqual(['login-submit'])
      expect(q('[role="radiogroup"]', el)?.className).toContain('h-md-control')
      expect(q('[data-testid="login-password-toggle"]', el)?.className).toContain('size-xs-control')
      const link = q('[data-testid="login-toggle-mode"]', el)!
      expect(link.className).toContain('h-sm-control')
      expect(link.className).toContain('touch-hit')
      expect(q('form', el)?.className).toContain('gap-4')
      expect(q('[data-slot="field"]', el)?.className).toContain('gap-1')
      expect(q('h1', el)?.className).toContain('text-2xl')
    } finally {
      window.matchMedia = mm
    }
  })

  it('W8 1440：桌面不变——密码眼 icon-lg、字段默认 gap-1.5', async () => {
    const el = await mount(<LoginPage />)
    expect(q('[data-testid="login-password-toggle"]', el)?.className).toContain('size-lg-control')
    expect(q('[data-slot="field"]', el)?.className).toContain('gap-1.5')
  })

  it('密码不足 8 位不发请求：本地 role=alert 提示并 aria-describedby 关联', async () => {
    const login = vi.fn(async () => true)
    useStudio.setState({ login })
    const el = await mount(<LoginPage />)
    setValue(q<HTMLInputElement>('[data-testid="login-email"]', el)!, 'a@b.c')
    setValue(q<HTMLInputElement>('[data-testid="login-password"]', el)!, 'short')
    await submit(el.querySelector('form')!)
    expect(login).not.toHaveBeenCalled()
    const hint = q('[data-testid="login-password-hint"]', el)!
    expect(hint.getAttribute('role')).toBe('alert')
    expect(hint.textContent).toContain('8')
    const pwd = q<HTMLInputElement>('[data-testid="login-password"]', el)!
    expect(pwd.getAttribute('aria-invalid')).toBe('true')
    expect(pwd.getAttribute('aria-describedby')).toBe(hint.id)
    expect(await violations(el)).toEqual([])
  })

  it('登录失败：store.authError（fastapi-users 错误码→中文）以 role=alert 显示并挂到表单 aria-describedby；切换模式即清除', async () => {
    useStudio.setState({
      login: vi.fn(async () => {
        useStudio.setState({ authError: 'LOGIN_BAD_CREDENTIALS' })
        return false
      }),
    })
    const el = await mount(<LoginPage />)
    setValue(q<HTMLInputElement>('[data-testid="login-email"]', el)!, 'a@b.c')
    setValue(q<HTMLInputElement>('[data-testid="login-password"]', el)!, 'password1')
    await submit(el.querySelector('form')!)
    const err = q('[data-testid="login-error"]', el)!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.textContent).toBe('邮箱或密码错误')
    expect(authErrorText('自定义文案')).toBe('自定义文案')
    expect(el.querySelector('form')?.getAttribute('aria-describedby')).toBe(err.id)
    expect(await violations(el)).toEqual([])
    await act(async () => q<HTMLButtonElement>('[data-testid="login-toggle-mode"]', el)!.click())
    expect(q('[data-testid="login-error"]', el)).toBeNull()
  })

  it('注册成功 = 自动登录：register(email, pwd, name) 后落新工作台', async () => {
    window.location.hash = '#/method'
    const register = vi.fn(async () => true)
    const openProject = vi.fn(async (pid: string) => {
      useStudio.setState({ pid })
    })
    const loadProjects = vi.fn(async () => {
      useStudio.setState({ projects: [{ id: 'system', title: 'S', mtime: 0 }, { id: 'method', title: 'M', mtime: 0 }] })
    })
    useStudio.setState({ register, openProject, loadProjects })
    const el = await mount(<LoginPage />)
    window.location.hash = '#/login'
    await act(async () => q<HTMLButtonElement>('[data-testid="login-tab-register"]', el)!.click())
    setValue(q<HTMLInputElement>('[data-testid="login-display-name"]', el)!, ' Ann ')
    setValue(q<HTMLInputElement>('[data-testid="login-email"]', el)!, 'ann@b.c')
    setValue(q<HTMLInputElement>('[data-testid="login-password"]', el)!, 'password1')
    await submit(el.querySelector('form')!)
    expect(register).toHaveBeenCalledWith('ann@b.c', 'password1', 'Ann')
    expect(loadProjects).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/workbench')
  })

  it('enterWorkspace：来处 pid 落新工作台 #/workbench；#/share/<token> 保持不动交给 ShareAccept', async () => {
    const openProject = vi.fn(async () => {})
    useStudio.setState({
      openProject,
      loadProjects: async () => {
        useStudio.setState({ projects: [{ id: 'system', title: 'S', mtime: 0 }] })
      },
    })
    window.location.hash = '#/login'
    await enterWorkspace('ghost')
    expect(openProject).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/workbench')
    window.location.hash = '#/share/tok1'
    openProject.mockClear()
    await enterWorkspace(null)
    expect(openProject).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/share/tok1')
  })

  it('enterWorkspace：#/login 覆盖 share hash 后凭暂存 token 恢复 #/share/<token>（R14-01）；暂存只消费一次', async () => {
    const { stashShareToken } = await import('@/lib/hash')
    useStudio.setState({
      openProject: vi.fn(async () => {}),
      loadProjects: async () => {
        useStudio.setState({ projects: [{ id: 'system', title: 'S', mtime: 0 }] })
      },
    })
    // 场景：领取页 → 登录页途中 hash 被覆盖；暂存的 token 让登录成功后回到领取页
    window.location.hash = '#/share/tok9'
    stashShareToken('tok9')
    window.location.hash = '#/login'
    await enterWorkspace(null)
    expect(window.location.hash).toBe('#/share/tok9')
    // 暂存已消费：下一次正常登录（无 share 来处）落新工作台
    window.location.hash = '#/login'
    await enterWorkspace(null)
    expect(window.location.hash).toBe('#/workbench')
  })

  it('auth=off：说明文案 + 进入工作台链接；已登录：显示邮箱与「进入工作台 / 切换账号」', async () => {
    useStudio.setState({ authStatus: 'off' })
    let el = await mount(<LoginPage />)
    expect(q('[data-testid="login-auth-off"]', el)?.textContent).toContain('PATENT_STUDIO_AUTH=off')
    await act(async () => root?.unmount())
    host.remove()
    useStudio.setState({ authStatus: 'authed', user: me })
    el = await mount(<LoginPage />)
    expect(q('[data-testid="login-authed"]', el)?.textContent).toContain('a@b.c')
    expect(q('form', el)).toBeNull()
    expect(q('[data-testid="login-switch"]', el)).not.toBeNull()
    expect(await violations(el)).toEqual([])
  })
})

describe('UserMenu（07 §7.1；W4-E 改密收敛到 #/account）', () => {
  it('off / unknown 不渲染；anon 只给登录链接', async () => {
    useStudio.setState({ authStatus: 'off' })
    let el = await mount(<UserMenu />)
    expect(el.textContent).toBe('')
    await act(async () => root?.unmount())
    host.remove()
    useStudio.setState({ authStatus: 'anon' })
    el = await mount(<UserMenu />)
    expect(q<HTMLAnchorElement>('[data-testid="topbar-login"]', el)?.getAttribute('href')).toBe('#/login')
  })

  it('authed：头像首字母；菜单含只读邮箱 / 修改密码… / 退出登录；「修改密码…」跳 #/account（W4-E：无旧改密对话框）', async () => {
    const logout = vi.fn(async () => {})
    useStudio.setState({ authStatus: 'authed', user: { ...me, display_name: 'zhang', is_superuser: true }, logout })
    const el = await mount(<UserMenu />)
    const trigger = q<HTMLButtonElement>('[data-testid="user-menu"]', el)!
    expect(trigger.getAttribute('aria-label')).toContain('a@b.c')
    expect(trigger.textContent).toBe('Z')
    expect(await violations(el)).toEqual([])

    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
    const menu = q('[role="menu"]')
    expect(menu).not.toBeNull()
    expect(q('[data-testid="user-menu-email"]', menu!)?.textContent).toContain('a@b.c')
    expect(q('[data-testid="user-menu-email"]', menu!)?.textContent).toContain('管理员')
    expect(q('[data-testid="user-menu-logout"]', menu!)).not.toBeNull()
    expect(await violations(document.body)).toEqual([])

    const pw = q<HTMLElement>('[data-testid="user-menu-password"]', menu!)!
    await act(async () => pw.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })))
    await act(async () => pw.click())
    expect(window.location.hash).toBe('#/account')
    expect(useStudio.getState().dialog).toBeNull()
    expect(q('[data-testid="password-dialog"]')).toBeNull()
  })

  it('退出登录调用 store.logout', async () => {
    const logout = vi.fn(async () => {})
    useStudio.setState({ authStatus: 'authed', user: me, logout })
    const el = await mount(<UserMenu />)
    await act(async () =>
      q<HTMLButtonElement>('[data-testid="user-menu"]', el)!.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      ),
    )
    await act(async () => q<HTMLElement>('[data-testid="user-menu-logout"]')!.click())
    // signOut 先动态 import collab/registry 拆房间，再 logout——等动态 import 链走完
    await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })
})
