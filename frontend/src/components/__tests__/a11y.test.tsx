// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SplitPane } from '@/components/shell/SplitPane'
import { MenuBar } from '@/components/shell/MenuBar'

/**
 * axe-core 静态冒烟：组件挂进 jsdom 后跑 axe。
 * jsdom 无布局/配色，color-contrast、scrollable-region-focusable 等需真实浏览器的规则在此禁用，
 * 只守 ARIA 结构类规则（aria-required-attr / aria-allowed-role / button-name / …）；真实浏览器 axe 见 testing skill。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

describe('a11y smoke (axe-core, jsdom)', () => {
  it('SplitPane separator exposes required aria-value*', async () => {
    const el = await mount(<SplitPane left={<div>L</div>} right={<div>R</div>} />)
    const sep = el.querySelector('[role="separator"]')
    expect(sep?.getAttribute('aria-valuenow')).toBe('50')
    expect(sep?.getAttribute('aria-valuemin')).toBe('20')
    expect(sep?.getAttribute('aria-valuemax')).toBe('80')
    expect(await violations(el)).toEqual([])
  })

  it('MenuBar is a menubar of five focusable menuitem triggers', async () => {
    const el = await mount(<MenuBar />)
    expect(el.querySelector('[role="menubar"]')).not.toBeNull()
    expect(el.querySelectorAll('[role="menubar"] > * [role="menuitem"], [role="menubar"] > [role="menuitem"]').length).toBe(5)
    expect(await violations(el)).toEqual([])
  })
})
