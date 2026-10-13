// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, api } from '@/lib/api'
import { ROLE_LABEL, ROLE_RANK, type ProjectDetail, type Role } from '@/lib/types'
import { selectCanSwitchMode, selectEditorMode, selectReadonly, useStudio } from '@/store'
import { CollabDrawer } from '../CollabDrawer'
import { ModeIndicator } from '../ModeIndicator'
import { SettingsSection } from '../SettingsSection'

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

const notImplemented = (unit: string) => new ApiError(501, `${unit} 尚未实现`)

beforeEach(() => {
  useStudio.getState().resetCollabCenter()
  useStudio.setState({ pid: 'method', toasts: [], members: [], membersLoading: false, shareLinks: [], shareLinksLoading: false, user: null, project: null, collabReadonly: false })
  vi.spyOn(api, 'members').mockResolvedValue([])
  vi.spyOn(api, 'shareLinks').mockResolvedValue([])
  vi.spyOn(api, 'invites').mockRejectedValue(notImplemented('B2-reviewer-invites'))
  vi.spyOn(api, 'access').mockRejectedValue(notImplemented('B1-access-log'))
  vi.spyOn(api, 'collabSettings').mockRejectedValue(notImplemented('B1-access-log'))
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
/** Radix Tabs 在 mousedown 激活 */
const press = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))

describe('W4-B prep：Role 加 reviewer（14 §4）', () => {
  it('reviewer 介于 viewer 与 editor 之间且有中文标签', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.reviewer)
    expect(ROLE_RANK.reviewer).toBeLessThan(ROLE_RANK.editor)
    expect(ROLE_LABEL.reviewer).toBe('审阅者')
  })
})

describe('W4-B prep：collabCenter slice（14 §6.1）', () => {
  it('openCollabCenter(tab) 开抽屉并切 tab；close / reset 复位', () => {
    const s = useStudio.getState()
    s.openCollabCenter('access')
    expect(useStudio.getState().collabCenterOpen).toBe(true)
    expect(useStudio.getState().collabCenterTab).toBe('access')
    s.closeCollabCenter()
    expect(useStudio.getState().collabCenterOpen).toBe(false)
    expect(useStudio.getState().collabCenterTab).toBe('access')
    s.resetCollabCenter()
    expect(useStudio.getState().collabCenterTab).toBe('members')
  })

  it('501 ⇒ *Unavailable=true，不弹 toast，settings 保持缺省全 true', async () => {
    const s = useStudio.getState()
    await s.loadAccess('method')
    await s.loadInvites('method')
    await s.loadCollabSettings('method')
    const st = useStudio.getState()
    expect(st.accessUnavailable).toBe(true)
    expect(st.invitesUnavailable).toBe(true)
    expect(st.collabSettingsUnavailable).toBe(true)
    expect(st.collabSettings).toEqual({ allow_download: true, allow_copy: true, allow_comment: true })
    expect(st.toasts).toEqual([])
  })

  it('selectEditorMode：viewer ⇒ readonly；reviewer ⇒ review；editor 取 editorMode 且可切', () => {
    const withRole = (role: Role) => ({ id: 'method', title: 't', role }) as unknown as ProjectDetail
    useStudio.setState({ project: withRole('viewer') })
    expect(selectEditorMode(useStudio.getState())).toBe('readonly')
    expect(selectCanSwitchMode(useStudio.getState())).toBe(false)
    useStudio.setState({ project: withRole('reviewer') })
    expect(selectEditorMode(useStudio.getState())).toBe('review')
    expect(selectCanSwitchMode(useStudio.getState())).toBe(false)
    useStudio.setState({ project: withRole('editor') })
    expect(selectEditorMode(useStudio.getState())).toBe('edit')
    expect(selectCanSwitchMode(useStudio.getState())).toBe(true)
    useStudio.getState().setEditorMode('review')
    expect(selectEditorMode(useStudio.getState())).toBe('review')
    useStudio.setState({ collabReadonly: true })
    expect(selectEditorMode(useStudio.getState())).toBe('readonly')
  })

  it('selectReadonly：viewer / reviewer 角色一到即只读（不等 GET /collab），editor 只随 collabReadonly', () => {
    const withRole = (role: Role) => ({ id: 'method', title: 't', role }) as unknown as ProjectDetail
    useStudio.setState({ project: withRole('viewer'), collabReadonly: false })
    expect(selectReadonly(useStudio.getState())).toBe(true)
    useStudio.setState({ project: withRole('reviewer') })
    expect(selectReadonly(useStudio.getState())).toBe(true)
    expect(selectEditorMode(useStudio.getState())).toBe('review')
    useStudio.setState({ project: withRole('editor') })
    expect(selectReadonly(useStudio.getState())).toBe(false)
    useStudio.setState({ collabReadonly: true })
    expect(selectReadonly(useStudio.getState())).toBe(true)
  })

  it('selectReadonly：openProject 发出到 GET /api/projects 返回之前角色未知 ⇒ 先上锁；返回后按角色放开；失败也解锁加载态', async () => {
    let resolve!: (p: ProjectDetail) => void
    vi.spyOn(api, 'project').mockImplementationOnce(() => new Promise<ProjectDetail>((r) => (resolve = r)))
    useStudio.setState({ pid: null, project: null, collabReadonly: false })
    const opening = useStudio.getState().openProject('method')
    await act(async () => {})
    expect(useStudio.getState().projectLoading).toBe(true)
    expect(selectReadonly(useStudio.getState())).toBe(true)
    resolve({ id: 'method', title: 't', role: null, settings: null, figs: [], backups: [], content: '# a\n' } as unknown as ProjectDetail)
    await opening
    expect(useStudio.getState().projectLoading).toBe(false)
    expect(selectReadonly(useStudio.getState())).toBe(false)

    vi.spyOn(api, 'project').mockRejectedValueOnce(new ApiError(404, 'Not Found'))
    await useStudio.getState().openProject('missing')
    expect(useStudio.getState().projectLoading).toBe(false)
    expect(useStudio.getState().projectError).toContain('missing')
  })
})

describe('W4-B prep：CollabDrawer 四 tab 占位（14 §6.2）', () => {
  it('打开后渲染 dialog + 四个 tab，切换 tab 写 store，501 段显示占位；axe 无违规', async () => {
    useStudio.getState().openCollabCenter()
    const el = await mount(<CollabDrawer />)
    const drawer = q('[data-testid="collab-drawer"]')!
    expect(drawer).not.toBeNull()
    expect(drawer.getAttribute('role')).toBe('dialog')
    for (const t of ['members', 'links', 'access', 'settings']) {
      expect(q(`[data-testid="collab-tab-${t}"]`)!.getAttribute('role')).toBe('tab')
    }
    expect(q('[data-testid="collab-members"]')).not.toBeNull()
    await press(q('[data-testid="collab-tab-access"]')!)
    expect(useStudio.getState().collabCenterTab).toBe('access')
    expect(q('[data-testid="collab-access-unavailable"]')).not.toBeNull()
    await press(q('[data-testid="collab-tab-settings"]')!)
    expect(q('[data-testid="collab-settings-unavailable"]')).not.toBeNull()
    expect(q('#collab-setting-allow_download')!.getAttribute('role')).toBe('switch')
    expect(api.members).toHaveBeenCalledWith('method')
    expect(api.access).toHaveBeenCalledWith('method')
    expect(await violations(el.ownerDocument.body)).toEqual([])
  })
})

describe('W4-B prep：SettingsSection / ModeIndicator', () => {
  it('Switch 有 label；切换调 onChange 单字段 patch', async () => {
    const onChange = vi.fn()
    const el = await mount(
      <SettingsSection settings={{ allow_download: true, allow_copy: true, allow_comment: true }} canManage unavailable={false} onChange={onChange} />,
    )
    const sw = q('#collab-setting-allow_copy', el)!
    expect(q('label[for="collab-setting-allow_copy"]', el)!.textContent).toBe('允许复制')
    await click(sw)
    expect(onChange).toHaveBeenCalledWith({ allow_copy: false })
    expect(await violations(el)).toEqual([])
  })

  it('canSwitch=false ⇒ role=status 静态徽标；true ⇒ 下拉按钮', async () => {
    const onChange = vi.fn()
    const el = await mount(
      <>
        <ModeIndicator mode="review" canSwitch={false} onChange={onChange} />
        <ModeIndicator mode="edit" canSwitch onChange={onChange} />
      </>,
    )
    const [fixed, switchable] = Array.from(el.querySelectorAll('[data-testid="mode-indicator"]'))
    expect(fixed.getAttribute('role')).toBe('status')
    expect(fixed.textContent).toContain('审阅')
    expect(fixed.getAttribute('data-mode')).toBe('review')
    expect(switchable.tagName).toBe('BUTTON')
    expect(switchable.getAttribute('aria-haspopup')).toBe('menu')
    expect(switchable.textContent).toContain('编辑')
    expect(await violations(el)).toEqual([])
  })
})
