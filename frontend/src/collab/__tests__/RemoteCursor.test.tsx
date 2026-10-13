// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RemoteCursorLabel, colorFor } from '@/collab'

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

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
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
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = (sel: string, el: ParentNode = document) => el.querySelector<HTMLElement>(sel)
describe('RemoteCursorLabel', () => {
  it('渲染名字与配色；axe 无违规', async () => {
    const el = await mount(<RemoteCursorLabel name="代理人" color={colorFor('代理人')} />)
    const lab = q('[data-slot="RemoteCursorLabel"]', el)!
    expect(lab.textContent).toBe('代理人')
    expect(lab.style.backgroundColor).not.toBe('')
    expect(await violations(el)).toEqual([])
  })
})
