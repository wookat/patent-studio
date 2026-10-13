// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/lib/types'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { disabledPreflight, PREFLIGHT_WARNING_CODES, togglePreflightCode } from '@/store/checks'
import type { OrgSettings } from '@/types/org'
import { CaseAiPanel, CaseSettingsDialog, PreflightTogglesPanel } from '../CaseSettingsDialog'

/**
 * W5 案级设置（docs/plan/21 §4.6；R-CHK-05；R-AI-01）：
 *  - Dialog size=md（560）；四页 Segmented 排版 / 体检开关 / AI / 集成
 *  - 体检开关：列出可关闭 warning code；关一项 → saveSettings 写 settings.preflight.disabled[]
 *  - AI：机构 orgSettings.ai_enabled=false → 案级开关 disabled + 说明；机构开启 → 可切换并写 settings.ai_enabled
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const initial = useStudio.getInitialState()

const settings: Settings = {
  abstract_figure: null,
  spec_figures: [],
  sub_except: [],
  abstract_limit: 300,
  style: {},
  ai_enabled: true,
}
const org: OrgSettings = { ai_enabled: true, default_collab: { editor_mode: 'edit', allow_viewer_comment: true }, smtp: null, ai_daily_tokens: 200000 }

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
  useStudio.setState({ pid: 'method', settings, saveSettings: vi.fn(async () => {}) as never })
  desktop = true
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

describe('体检开关（R-CHK-05）', () => {
  it('togglePreflightCode 写 preflight.disabled[]（排序、去重、开回则移除）', () => {
    const off = togglePreflightCode(settings, 'figures.unreferenced', false)
    expect(disabledPreflight(off)).toEqual(['figures.unreferenced'])
    const off2 = togglePreflightCode(off, 'abstract.limit', false)
    expect(disabledPreflight(off2)).toEqual(['abstract.limit', 'figures.unreferenced'])
    expect(disabledPreflight(togglePreflightCode(off2, 'abstract.limit', false))).toEqual(['abstract.limit', 'figures.unreferenced'])
    expect(disabledPreflight(togglePreflightCode(off2, 'figures.unreferenced', true))).toEqual(['abstract.limit'])
    expect(disabledPreflight(null)).toEqual([])
  })
  it('面板列出全部可关闭 warning code；关一项 → saveSettings({...settings, preflight:{disabled:[code]}})', async () => {
    await mount(<PreflightTogglesPanel />)
    const switches = qa('[data-testid^="preflight-toggle-"]')
    expect(switches).toHaveLength(PREFLIGHT_WARNING_CODES.length)
    expect(switches.every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
    await click(q('[data-testid="preflight-toggle-figures.unreferenced"]'))
    expect(useStudio.getState().saveSettings).toHaveBeenCalledWith({ ...settings, preflight: { disabled: ['figures.unreferenced'] } })
    await act(async () => useStudio.setState({ settings: togglePreflightCode(settings, 'figures.unreferenced', false) }))
    expect(q('[data-testid="preflight-toggle-figures.unreferenced"]')?.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-testid="preflight-toggle-abstract.limit"]')?.getAttribute('aria-checked')).toBe('true')
    expect(await serious(host)).toEqual([])
  })
})

describe('案级 AI（R-AI-01）', () => {
  it('机构禁用 → 案级开关 disabled + 说明 Alert；机构开启 → 可切换并写 settings.ai_enabled', async () => {
    useStudio.setState({ orgSettings: { ...org, ai_enabled: false } })
    await mount(<CaseAiPanel />)
    const sw = q<HTMLButtonElement>('[data-testid="case-ai-toggle"]')!
    expect(sw.disabled).toBe(true)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-testid="case-ai-org-disabled"]')?.textContent).toContain('机构已关闭 AI')
    expect(await serious(host)).toEqual([])

    await act(async () => useStudio.setState({ orgSettings: org }))
    const on = q<HTMLButtonElement>('[data-testid="case-ai-toggle"]')!
    expect(on.disabled).toBe(false)
    expect(on.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-testid="case-ai-org-disabled"]')).toBeNull()
    await click(on)
    expect(useStudio.getState().saveSettings).toHaveBeenCalledWith({ ...settings, ai_enabled: false })
  })
  it('机构设置未知（非超管拿不到 orgSettings）→ 不按禁用处理', async () => {
    useStudio.setState({ orgSettings: null })
    await mount(<CaseAiPanel />)
    expect(q<HTMLButtonElement>('[data-testid="case-ai-toggle"]')?.disabled).toBe(false)
    expect(q('[data-testid="case-ai-org-disabled"]')).toBeNull()
  })
})

describe('CaseSettingsDialog', () => {
  it('1440：size=md Dialog；Segmented 四页可切换到「体检开关」与「AI」；超管打开时拉 orgSettings + axe', async () => {
    const loadOrgSettings = vi.fn(async () => {})
    useStudio.setState({ user: { id: 'u1', email: 'a@x', is_superuser: true } as never, loadOrgSettings, project: { id: 'method', title: '一种方法' } as never })
    await mount(<CaseSettingsDialog open onOpenChange={() => {}} initialTab="checks" />)
    const dialog = q('[data-testid="case-settings-dialog"]')!
    expect(dialog.getAttribute('data-size')).toBe('md')
    expect(loadOrgSettings).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="case-settings-checks"]')).not.toBeNull()
    const radios = qa('[data-testid="case-settings-tabs"] [role="radio"]')
    expect(radios.map((r) => r.textContent)).toEqual(['排版', '体检', 'AI', '集成'])
    await click(q('[data-testid="case-settings-tab-ai"]'))
    expect(q('[data-testid="case-settings-ai"]')).not.toBeNull()
    expect(q('[data-testid="case-settings-checks"]')).toBeNull()
    expect(await serious(dialog)).toEqual([])
  })
  it('375：同一 Dialog 组件（DialogContent 在 <sm 全屏）；Segmented 横滑', async () => {
    desktop = false
    await mount(<CaseSettingsDialog open onOpenChange={() => {}} initialTab="ai" />)
    const dialog = q('[data-testid="case-settings-dialog"]')!
    expect(dialog.className).toContain('max-h-dvh')
    expect(q('[data-testid="case-settings-tabs"]')?.className).toContain('max-sm:w-max')
    expect(q('[data-testid="case-settings-ai"]')).not.toBeNull()
    expect(await serious(dialog)).toEqual([])
  })
  it('R59-01：viewer 角色下写 settings 的控件全部 disabled（体检开关 / AI 开关 / 排版字段 / 导入 / 恢复默认）', async () => {
    useStudio.setState({
      project: { id: 'method', title: '一种方法', role: 'viewer' } as never,
      projectLoading: false,
      orgSettings: org,
    })
    await mount(<PreflightTogglesPanel />)
    expect(qa('[data-testid^="preflight-toggle-"]').every((s) => (s as HTMLButtonElement).disabled)).toBe(true)
    await act(async () => root?.unmount())

    await mount(<CaseAiPanel />)
    expect(q<HTMLButtonElement>('[data-testid="case-ai-toggle"]')!.disabled).toBe(true)
  })
})
