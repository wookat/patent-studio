// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import type { Diagnostic } from '@/lib/types'
import { useStudio } from '@/store'
import { ConsoleEntry } from '../ConsoleEntry'

/**
 * R66-01：apply 模式一键修复是按内容写权限的控件——viewer/reviewer/collabReadonly 下
 * 必须降级为「复制建议」（suggest），否则本地文档被改但写不进协同层 → 静默分叉。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
const initial = useStudio.getInitialState()
const q = (sel: string) => host?.querySelector(sel) ?? null

const ITEM: Diagnostic = {
  id: 'lint.replace#1',
  severity: 'warning',
  source: 'lint',
  message: '建议把「第一行X」改为「第一行Y」',
  line: 1,
  fix: '把「第一行X」改为「第一行Y」',
}
const CONTENT = '第一行X\n第二行'

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})
beforeEach(() => {
  useStudio.setState(initial, true)
  useStudio.setState({
    pid: 'p1',
    content: CONTENT,
    ast: SYNTH_AST,
    project: { id: 'p1', role: 'owner' },
    projectLoading: false,
  } as never)
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
  await act(async () => root!.render(el))
}
async function click(el: Element | null) {
  await act(async () => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('R66-01 一键修复写权限门控', () => {
  it('可写角色：apply 模式「改为…」点击实改内容', async () => {
    await mount(<ul><ConsoleEntry item={ITEM} /></ul>)
    const btn = q('[data-testid="console-entry-fix-btn"]')!
    expect(btn.getAttribute('data-mode')).toBe('apply')
    await click(btn)
    expect(useStudio.getState().content).toBe('第一行Y\n第二行')
  })

  it.each(['viewer', 'reviewer'])('只读角色 %s：降级复制建议且不改内容', async (role) => {
    useStudio.setState({ project: { id: 'p1', role } } as never)
    await mount(<ul><ConsoleEntry item={ITEM} /></ul>)
    const btn = q('[data-testid="console-entry-fix-btn"]')!
    expect(btn.getAttribute('data-mode')).toBe('suggest')
    expect(btn.textContent).toContain('复制建议')
    await click(btn)
    expect(useStudio.getState().content).toBe(CONTENT)
  })

  it('collabReadonly：降级复制建议', async () => {
    useStudio.setState({ collabReadonly: true } as never)
    await mount(<ul><ConsoleEntry item={ITEM} /></ul>)
    expect(q('[data-testid="console-entry-fix-btn"]')!.getAttribute('data-mode')).toBe('suggest')
  })
})
