// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { LifecyclePanel } from '../LifecyclePanel'

/**
 * 「流程」伴随面板（w19 批1）：十档步进 + 当前阶段导引。
 * 可写角色点档调用 api.setCaseStatus；viewer/无案时步进只读；
 * 导引动作深链开伴随栏/跳递交页。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: q === DESKTOP_QUERY, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  useStudio.setState({
    pid: 'p1',
    authStatus: 'authed',
    companion: null,
    project: { id: 'p1', role: 'agent', case: { status: 'drafting' } } as never,
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
  await act(async () => root!.render(el))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

describe('LifecyclePanel', () => {
  it('渲染十档，当前档高亮并展示对应导引', async () => {
    const h = await mount(<LifecyclePanel />)
    expect(h.querySelector('[data-testid="lifecycle-panel"]')).not.toBeNull()
    for (const s of ['intake', 'drafting', 'review', 'client_review', 'final', 'filed', 'oa', 'granted', 'rejected', 'closed'])
      expect(h.querySelector(`[data-testid="lifecycle-stage-${s}"]`), s).not.toBeNull()
    expect(h.querySelector('[data-testid="lifecycle-stage-drafting"]')?.getAttribute('aria-current')).toBe('step')
    expect(h.querySelector('[data-testid="lifecycle-guide"]')?.textContent).toContain('三书')
  })

  it('agent 点档预览导引，点「切换到」才 api.setCaseStatus 换态', async () => {
    const spy = vi.spyOn(api, 'setCaseStatus').mockResolvedValue({ status: 'filed' } as never)
    const h = await mount(<LifecyclePanel />)
    await click(h.querySelector('[data-testid="lifecycle-stage-filed"]'))
    expect(spy).not.toHaveBeenCalled()
    expect(h.querySelector('[data-testid="lifecycle-guide"]')?.textContent).toContain('预览 · 已递交')
    await click(h.querySelector('[data-testid="lifecycle-apply"]'))
    expect(spy).toHaveBeenCalledWith('p1', 'filed', '')
  })

  it('viewer 无写权 → 档钮可预览但无切换钮', async () => {
    useStudio.setState({ project: { id: 'p1', role: 'viewer', case: { status: 'intake' } } as never })
    const h = await mount(<LifecyclePanel />)
    await click(h.querySelector('[data-testid="lifecycle-stage-oa"]'))
    expect(h.querySelector('[data-testid="lifecycle-guide"]')?.textContent).toContain('预览 · 审查意见')
    expect(h.querySelector('[data-testid="lifecycle-apply"]')).toBeNull()
  })

  it('导引深链：递交页动作 → goDeliver；OA 动作 → 开 console + oa tab', async () => {
    useStudio.setState({ project: { id: 'p1', role: 'agent', case: { status: 'final' } } as never })
    const h = await mount(<LifecyclePanel />)
    window.location.hash = '/'
    await click(h.querySelector('[data-testid="lifecycle-link-deliver"]'))
    expect(window.location.hash).toContain('p1')
    expect(window.location.hash).toContain('deliver')
    await act(async () => {
      useStudio.setState({ project: { id: 'p1', role: 'agent', case: { status: 'oa' } } as never })
    })
    await click(h.querySelector('[data-testid="lifecycle-link-oa"]'))
    const s = useStudio.getState()
    expect(s.companion).toBe('console')
    expect(s.consoleTab).toBe('oa')
  })

  it('intake 阶段查新动作 → goNovelty 跳查新卡页', async () => {
    useStudio.setState({ project: { id: 'p1', role: 'agent', case: { status: 'intake' } } as never })
    const h = await mount(<LifecyclePanel />)
    window.location.hash = '#/p/p1'
    await click(h.querySelector('[data-testid="lifecycle-link-novelty"]'))
    expect(window.location.hash).toBe('#/p/p1/novelty')
  })
})
