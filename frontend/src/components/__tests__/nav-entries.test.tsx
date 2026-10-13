// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMenu } from '@/components/auth/UserMenu'
import { ConsoleTabs } from '@/components/console/ConsoleTabs'
import { ExportMenuItems } from '@/components/shell/ExportMenu'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown'
import { useStudio } from '@/store'

/**
 * W4-E prep 共享入口（docs/plan/17 §2.5 收敛表）：
 *  - 导出菜单末行「递交页…」→ #/p/<pid>/deliver
 *  - 控制台 tab 条右端「递交页」链接（在 tablist 之外，不改变 tab 键盘环）
 *  - 用户菜单「个人资料…」→ #/account；超管多一项「机构管理…」→ #/admin
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  useStudio.setState(initial, true)
  window.location.hash = '#/p/method'
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

describe('导出菜单 → 递交页', () => {
  it('「递交页…」在有 pid 时可用，选择后写 #/p/<pid>/deliver', async () => {
    useStudio.setState({ pid: 'method' })
    await mount(
      <DropdownMenu open>
        <DropdownMenuContent>
          <ExportMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const row = q('[data-testid="open-deliver-page"]')
    expect(row).not.toBeNull()
    expect(row?.getAttribute('aria-disabled')).not.toBe('true')
    // 收敛：菜单只剩 DOCX / PDF 直下 + 递交页；XML / 修订版 / 交付报告由递交页承接
    expect(q('[data-testid="export-docx"]')).not.toBeNull()
    expect(q('[data-testid="export-pdf"]')).not.toBeNull()
    for (const id of ['open-deliver-report', 'export-xml', 'export-tracked']) expect(q(`[data-testid="${id}"]`)).toBeNull()
    await act(async () => row!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })))
    await act(async () => row!.click())
    expect(window.location.hash).toBe('#/p/method/deliver')
  })
})

describe('控制台 tab 条 → 递交页', () => {
  it('链接在 tablist 外；体检 / XML tab 已下线（4 诊断 + 2 工具）；体检 error 计数挂在链接上；axe', async () => {
    useStudio.setState({
      pid: 'method',
      preflight: { version: 1, items: [], counts: { error: 2, warning: 0, info: 0 }, claim_tree: [], numerals: [], support_map: [], figures: [] },
    })
    await mount(
      <>
        <ConsoleTabs />
        <div id="console-tabpanel" role="tabpanel" aria-labelledby="console-tab-all" />
      </>,
    )
    const tablist = q('[data-testid="console-tabs"]')!
    expect(tablist.getAttribute('role')).toBe('tablist')
    expect(qa('[role="tab"]', tablist)).toHaveLength(6)
    for (const id of ['xml', 'preflight']) expect(q(`[data-testid="console-tab-${id}"]`)).toBeNull()
    const link = q<HTMLAnchorElement>('[data-testid="console-deliver-link"]')!
    expect(link).not.toBeNull()
    expect(tablist.contains(link)).toBe(false)
    expect(link.getAttribute('href')).toBe('#/p/method/deliver')
    expect(link.textContent).toContain('2')
    expect(await serious(host)).toEqual([])
  })
  it('无 pid 不渲染链接', async () => {
    await mount(<ConsoleTabs />)
    expect(q('[data-testid="console-deliver-link"]')).toBeNull()
  })
})

describe('用户菜单 → 账户 / 机构管理', () => {
  const me = { id: 'u1', email: 'a@b.c', display_name: 'zhang', is_superuser: false }
  const open = async () => {
    const el = await mount(<UserMenu />)
    const trigger = q<HTMLButtonElement>('[data-testid="user-menu"]', el)!
    await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })))
    return q('[role="menu"]')!
  }
  it('普通成员：个人资料… 有，机构管理… 无', async () => {
    useStudio.setState({ authStatus: 'authed', user: me })
    const menu = await open()
    expect(q('[data-testid="user-menu-account"]', menu)).not.toBeNull()
    expect(q('[data-testid="user-menu-admin"]', menu)).toBeNull()
    const pw = q('[data-testid="user-menu-password"]', menu)!
    expect(pw).not.toBeNull()
    await act(async () => pw.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })))
    await act(async () => pw.click())
    expect(window.location.hash).toBe('#/account')
    expect(q('[data-testid="password-dialog"]')).toBeNull()
  })
  it('超管：机构管理… 出现；选择「个人资料…」写 #/account', async () => {
    useStudio.setState({ authStatus: 'authed', user: { ...me, is_superuser: true } })
    const menu = await open()
    expect(q('[data-testid="user-menu-admin"]', menu)).not.toBeNull()
    const item = q('[data-testid="user-menu-account"]', menu)!
    await act(async () => item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })))
    await act(async () => item.click())
    expect(window.location.hash).toBe('#/account')
  })
})
