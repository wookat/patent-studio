// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStudio } from '@/store'
import type { Comment, CriticMark } from '@/lib/types'
import { Rail } from '@/components/shell/Rail'
import { TopBar } from '@/components/shell/TopBar'
import { LoginPage } from '@/components/auth/LoginPage'
import { ModeSwitch } from '../ModeSwitch'
import { ReviewPanel } from '../ReviewPanel'
import { ReviewBody } from '../ReviewBody'

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

beforeEach(() => {
  useStudio.setState({
    pid: 'p1', railTab: 'outline', outlineOpen: true, items: [], comments: [], marks: [], reviewMode: 'final',
    authStatus: 'off', user: null, commentsUnavailable: false, marksUnavailable: false, commentDraft: null, replyBodies: {},
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement, tag = 'main') {
  host = document.createElement(tag)
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<TooltipProvider>{el}</TooltipProvider>))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const comment = (id: string, resolved: boolean): Comment => ({
  id, anchor: { block_id: 'p1', line: 3, quote: 'x', stale: false }, body: 'b',
  author: { id: null, name: 'me' }, created_at: 0, updated_at: 0, resolved, replies: [],
})
const mark: CriticMark = { id: 'm1', kind: 'ins', line: 1, from: 0, to: 7, a: '', b: 'x', final: 'x', original: '' }

describe('R6 prep UI（docs/plan/07 §5.2 / §7）', () => {
  it('W6 / 23-w12 §4 第二步：审阅入口在顶栏且唯一，Rail 不再有「审阅」tab；非版面视图点击开 ReviewDrawer（不再开伴随栏 review），未解决批注计入角标', async () => {
    useStudio.setState({ comments: [comment('a', false), comment('b', true)] })
    const rail = await mount(<Rail />)
    expect(rail.querySelector('[data-testid="rail-review"]')).toBeNull()
    await act(async () => root?.unmount())
    rail.remove()
    const el = await mount(<TopBar />)
    expect(el.querySelectorAll('[data-testid="topbar-review"]').length).toBe(1)
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="topbar-review"]')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.getAttribute('aria-label')).toContain('1 条')
    expect(btn.textContent).toContain('1')
    await act(async () => btn.click())
    expect(useStudio.getState().companion).toBeNull()
    expect(useStudio.getState().reviewDrawerOpen).toBe(true)
    expect(el.querySelector('[data-testid="topbar-review"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(await violations(el)).toEqual([])
  })

  it('ModeSwitch：无标记且 final 时隐藏；有标记时是三选一 radiogroup，切换写 reviewMode', async () => {
    let el = await mount(<ModeSwitch />)
    expect(el.querySelector('[data-testid="review-mode-switch"]')).toBeNull()
    await act(async () => root?.unmount())
    root = null
    host.remove()

    useStudio.setState({ marks: [mark] })
    el = await mount(<ModeSwitch />)
    const radios = el.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(radios).toHaveLength(3)
    expect(el.querySelector('[data-testid="review-mode-final"]')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="review-mode-markup"]')!.click())
    expect(useStudio.getState().reviewMode).toBe('markup')
    expect(await violations(el)).toEqual([])
  })

  it('ReviewPanel 渲染计数占位；后端 501 时显示未落地文案', async () => {
    useStudio.setState({ marks: [mark], comments: [comment('a', false)], loadComments: async () => {} })
    let el = await mount(<ReviewPanel />)
    expect(el.textContent).toContain('修订 1 处')
    expect(el.textContent).toContain('未解决批注 1 条')
    await act(async () => root?.unmount())
    root = null
    host.remove()

    useStudio.setState({ commentsUnavailable: true })
    el = await mount(<ReviewBody pid="p1" />)
    expect(el.textContent).toContain('501')
  })

  it('TopBar：auth=off 时无分享 / 用户菜单；authed 时二者出现', async () => {
    let el = await mount(<TopBar />)
    expect(el.querySelector('[data-testid="share-button"]')).toBeNull()
    expect(el.querySelector('[data-testid="user-menu"]')).toBeNull()
    await act(async () => root?.unmount())
    root = null
    host.remove()

    useStudio.setState({ authStatus: 'authed', user: { id: 'u', email: 'a@b.c', display_name: '', is_superuser: false } })
    el = await mount(<TopBar />)
    expect(el.querySelector('[data-testid="share-button"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="user-menu"]')?.getAttribute('aria-label')).toContain('a@b.c')
    expect(await violations(el)).toEqual([])
  })

  it('LoginPage：表单带 label 的邮箱 / 密码与提交按钮，axe 无违规', async () => {
    const el = await mount(<LoginPage />, 'div')
    expect(el.querySelector<HTMLInputElement>('[data-testid="login-email"]')?.type).toBe('email')
    expect(el.querySelector<HTMLInputElement>('[data-testid="login-password"]')?.type).toBe('password')
    expect(el.querySelector('[data-testid="login-submit"]')?.textContent).toBe('登录')
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="login-toggle-mode"]')!.click())
    expect(el.querySelector('[data-testid="login-submit"]')?.textContent).toBe('注册并登录')
    expect(await violations(el)).toEqual([])
  })
})
