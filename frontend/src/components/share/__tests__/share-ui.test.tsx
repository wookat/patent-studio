// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { User } from '@/lib/types'
import { useStudio } from '@/store'
import { ShareAccept } from '../ShareAccept'
import { ShareButton } from '../ShareButton'

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
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

const me: User = { id: 'u1', email: 'owner@b.c', display_name: 'Owner', is_superuser: false }

beforeEach(() => {
  window.location.hash = ''
  useStudio.setState({
    pid: 'method', project: null, projects: [], dialog: null, toasts: [],
    authStatus: 'authed', user: me, authError: null, members: [], shareLinks: [],
    collabCenterOpen: false, collabCenterTab: 'members', collabStatus: 'off', collabUnavailable: false, peers: [],
  })
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
const click = (el: Element) => act(async () => (el as HTMLElement).click())

describe('ShareButton（14 §6.3 D10）', () => {
  it('仅 authed 显示；点击 openCollabCenter(members)；协同 off ⇒ 无在线数 / 头像', async () => {
    useStudio.setState({ authStatus: 'off' })
    let el = await mount(<ShareButton />)
    expect(q('[data-testid="share-button"]', el)).toBeNull()
    await act(async () => root?.unmount())
    host.remove()
    useStudio.setState({ authStatus: 'authed' })
    el = await mount(<ShareButton />)
    const btn = q('[data-testid="share-button"]', el)!
    expect(btn.textContent).toBe('分享')
    expect(q('[data-testid="presence-avatars"]', el)).toBeNull()
    await click(btn)
    const st = useStudio.getState()
    expect(st.collabCenterOpen).toBe(true)
    expect(st.collabCenterTab).toBe('members')
    expect(st.dialog).toBeNull()
  })

  it('协同已连接：N = 去重({我} ∪ peers)；≤3 个头像；点头像跳行，无光标不可点；axe 无违规', async () => {
    const gotoLine = vi.fn()
    useStudio.setState({
      collabStatus: 'connected', collabUnavailable: false, gotoLine,
      peers: [
        { id: 1, uid: 'u1', name: 'Owner', color: '#000', line: 3, readonly: false },
        { id: 2, uid: 'u2', name: '代理人', color: '#111', line: null, readonly: true },
        { id: 3, uid: 'u3', name: '审阅', color: '#222', line: 9, readonly: false },
        { id: 4, uid: 'u4', name: '第四', color: '#333', line: 1, readonly: false },
      ],
    })
    const el = await mount(<ShareButton />)
    expect(q('[data-testid="share-online"]', el)!.textContent).toContain('4 在线')
    const avatars = el.querySelectorAll<HTMLButtonElement>('[data-testid="presence-avatar"]')
    expect(avatars).toHaveLength(3)
    expect(avatars[1].disabled).toBe(true)
    expect(avatars[1].getAttribute('aria-label')).toContain('只读')
    await click(avatars[2])
    expect(gotoLine).toHaveBeenCalledWith(9)
    expect(await violations(el)).toEqual([])
  })

  it('reconnecting ⇒ data-status 与 tooltip 状态字样', async () => {
    useStudio.setState({ collabStatus: 'reconnecting', collabUnavailable: false, peers: [] })
    const el = await mount(<ShareButton />)
    const btn = q('[data-testid="share-button"]', el)!
    expect(btn.dataset.status).toBe('reconnecting')
    expect(q('[data-testid="share-online"]', el)!.textContent).toContain('1 在线')
  })
})

describe('ShareAccept #/share/<token>（07 §4.1）', () => {
  it('无 token → alert + 返回工作台', async () => {
    const el = await mount(<ShareAccept />)
    expect(q('[data-testid="share-accept-missing"] [role="alert"]', el)).not.toBeNull()
    expect(q<HTMLAnchorElement>('[data-testid="share-accept-home"]', el)?.getAttribute('href')).toBe('#/')
    expect(await violations(el)).toEqual([])
  })

  it('anon → 引导登录，不调用 acceptShare', async () => {
    window.location.hash = '#/share/tok'
    const acceptShare = vi.fn(async () => 'method')
    useStudio.setState({ authStatus: 'anon', user: null, acceptShare })
    const el = await mount(<ShareAccept />)
    expect(acceptShare).not.toHaveBeenCalled()
    expect(q<HTMLAnchorElement>('[data-testid="share-accept-login"]', el)?.getAttribute('href')).toBe('#/login')
    expect(await violations(el)).toEqual([])
  })

  it('anon 点「登录 / 注册」前把 share token 暂存 sessionStorage（R14-01：#/login 覆盖 hash 后 enterWorkspace 能找回）', async () => {
    window.location.hash = '#/share/tokStash'
    useStudio.setState({ authStatus: 'anon', user: null })
    const el = await mount(<ShareAccept />)
    await act(async () => q<HTMLAnchorElement>('[data-testid="share-accept-login"]', el)!.click())
    // jsdom 不执行锚点导航；真实浏览器里 hash 会被 #/login 覆盖，暂存因此必要
    expect(sessionStorage.getItem('patent-studio:share-return')).toBe('tokStash')
    sessionStorage.removeItem('patent-studio:share-return')
  })

  it('authed → acceptShare(token) → loadProjects + openProject(pid)', async () => {
    window.location.hash = '#/share/tok%201'
    const acceptShare = vi.fn(async () => 'system')
    const loadProjects = vi.fn(async () => {})
    const openProject = vi.fn(async () => {})
    useStudio.setState({ acceptShare, loadProjects, openProject })
    const el = await mount(<ShareAccept />)
    expect(acceptShare).toHaveBeenCalledWith('tok 1')
    expect(loadProjects).toHaveBeenCalledTimes(1)
    expect(openProject).toHaveBeenCalledWith('system')
    expect(q('[data-testid="share-accept-done"]', el)?.textContent).toContain('system')
  })

  it('领取失败（过期 / 501）→ alert 显示 store.authError', async () => {
    window.location.hash = '#/share/tok'
    useStudio.setState({
      acceptShare: vi.fn(async () => {
        useStudio.setState({ authError: '链接已过期' })
        return null
      }),
    })
    const el = await mount(<ShareAccept />)
    const err = q('[data-testid="share-accept-failed"] [role="alert"]', el)!
    expect(err.textContent).toContain('链接已过期')
    expect(await violations(el)).toEqual([])
  })

  it('auth=off 也发起领取（后端 501）→ 显示说明而非一直「正在领取」', async () => {
    window.location.hash = '#/share/tok'
    const acceptShare = vi.fn(async () => {
      useStudio.setState({ authError: '账号未开启（PATENT_STUDIO_AUTH=off）' })
      return null
    })
    useStudio.setState({ authStatus: 'off', user: null, acceptShare })
    const el = await mount(<ShareAccept />)
    expect(acceptShare).toHaveBeenCalledWith('tok')
    expect(q('[data-testid="share-accept-failed"] [role="alert"]', el)?.textContent).toContain('账号未开启')
  })
})
